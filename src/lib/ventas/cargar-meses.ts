import { armarReporteMes } from "./informe";
import {
  esReintentable,
  esperadoDeMes,
  mensajeNoConcilia,
  mesBloqueado,
  tandasDeMes,
} from "./cargas";
import type { ApiVentas } from "./cliente-api";
import {
  REINTENTOS_TANDA,
  TANDA_CLIENTE,
  type Consolidado,
  type InformeCarga,
  type InformeMes,
  type MedidasCarga,
  type TotalesQlik,
} from "./tipos";

/**
 * Orquesta la carga de varios meses (docs/modulos/05-venta-stock.md, "Avance y
 * reanudación"). Independiente de React y de `fetch`: recibe la API por
 * parámetro y avisa del avance por un callback, así que la pantalla solo la
 * llama y pinta, y los tests la ejercitan con una API falsa.
 *
 * Cada mes es una carga independiente que se publica en cuanto termina: un corte
 * deja meses completos publicados, un mes en curso invisible y el resto sin
 * empezar. Una tanda que falla por red o `5xx` se reintenta hasta
 * `REINTENTOS_TANDA` veces (es idempotente); si no, o ante un `4xx`, se descarta
 * ese mes (`DELETE` de su carga), se marca con su motivo y se CONTINÚA con el
 * siguiente. Publicar NO es cancelable una vez iniciado (la función SQL es una
 * transacción): `signal` se revisa justo antes y corta las tandas en vuelo. Si
 * `publicar` falla de forma ambigua (red o 5xx), se consulta el estado real de la
 * carga antes de decidir; nunca se retira un mes ya publicado.
 */

export type EstadoMesCarga = "pendiente" | "cargando" | "publicado" | "saltado" | "error" | "cancelado";

export type MotivoSalto = "identico" | "bloqueado" | "sin_filas";

export type EventoCarga = {
  periodo: string;
  estado: EstadoMesCarga;
  /** Tanda en curso (1..tandas) mientras `estado` es `cargando`. */
  tanda?: number;
  tandas?: number;
  /** Mensaje para pantalla (motivo del salto o del error). */
  mensaje?: string;
};

export type ResultadoMes = {
  periodo: string;
  estado: EstadoMesCarga;
  motivo?: MotivoSalto;
  mensaje?: string;
  cargaId?: string;
  filas?: number;
  /** Reintentos de tanda que hicieron falta. */
  reintentos: number;
  /** Quedó marcado Incompleto (forzado con errores >= 2 %). */
  incompleto: boolean;
};

export type OpcionesCargaMeses = {
  /** Carga también los meses bloqueados por errores (quedan marcados Incompleto). */
  forzarIncompleto?: boolean;
  /** Salta los meses "idénticos a lo ya cargado" (por defecto sí). */
  saltarIdenticos?: boolean;
  /** Tamaño de tanda (por defecto 10 000). */
  tamanoTanda?: number;
  /** Espera entre reintentos, en ms (por defecto 500 · intento). */
  esperaReintento?: (intento: number) => Promise<void>;
};

export type EntradaCargaMeses = {
  api: Pick<ApiVentas, "abrirCarga" | "enviarTanda" | "publicar" | "descartar" | "limpiar" | "detalle">;
  informe: InformeCarga;
  /** Con las marcas nuevas ya sustituidas por sus ids (`sustituirMarcasNuevas`). */
  consolidado: Consolidado;
  /** Meses a cargar, en el orden en que se cargan. */
  periodos: string[];
  archivoNombre: string;
  codificacion?: string;
  separador?: string;
  totalesQlik?: Record<string, TotalesQlik>;
  alEvento?: (e: EventoCarga) => void;
  signal?: AbortSignal;
  opciones?: OpcionesCargaMeses;
};

const esperaPorDefecto = (intento: number) => new Promise<void>((r) => setTimeout(r, 500 * intento));

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido.";
}

/** Carga los meses pedidos de uno en uno. Nunca lanza: cada mes termina con su resultado. */
export async function cargarMeses(entrada: EntradaCargaMeses): Promise<ResultadoMes[]> {
  const { api, informe, consolidado, signal } = entrada;
  const o = entrada.opciones ?? {};
  const forzar = o.forzarIncompleto ?? false;
  const saltarIdenticos = o.saltarIdenticos ?? true;
  const espera = o.esperaReintento ?? esperaPorDefecto;
  const avisar = (e: EventoCarga) => entrada.alEvento?.(e);
  const resultados: ResultadoMes[] = [];

  for (const periodo of entrada.periodos) {
    const base: ResultadoMes = { periodo, estado: "pendiente", reintentos: 0, incompleto: false };

    if (signal?.aborted) {
      resultados.push({ ...base, estado: "cancelado" });
      avisar({ periodo, estado: "cancelado" });
      continue;
    }

    const mes: InformeMes | undefined = informe.meses.find((m) => m.periodo === periodo);
    if (!mes) {
      const mensaje = "Ese mes no está en el archivo.";
      resultados.push({ ...base, estado: "error", mensaje });
      avisar({ periodo, estado: "error", mensaje });
      continue;
    }

    const saltar = (motivo: MotivoSalto, mensaje: string) => {
      resultados.push({ ...base, estado: "saltado", motivo, mensaje });
      avisar({ periodo, estado: "saltado", mensaje });
    };
    if (saltarIdenticos && mes.estado === "identico") {
      saltar("identico", "Idéntico a lo ya cargado: se omite.");
      continue;
    }
    if (mesBloqueado(mes, forzar)) {
      saltar("bloqueado", `Bloqueado: ${mes.errores.maximo} % en errores.`);
      continue;
    }
    if (mes.cargado.filas === 0 || !consolidado.meses.has(periodo)) {
      saltar("sin_filas", "No hay filas que cargar en este mes.");
      continue;
    }
    if (!mes.identidad_ok) {
      const mensaje = "Las cifras del archivo no cuadran con lo que se cargaría: es un error de la herramienta, no de los datos.";
      resultados.push({ ...base, estado: "error", mensaje });
      avisar({ periodo, estado: "error", mensaje });
      continue;
    }

    const incompleto = forzar && mes.bloqueado;
    const tandas = tandasDeMes(consolidado, periodo, o.tamanoTanda ?? TANDA_CLIENTE);
    let cargaId: string | null = null;
    let reintentos = 0;
    let fase: "abrir" | "tandas" | "publicar" = "abrir";

    /**
     * Cierra el mes con error o cancelación. Con `descartar` (por defecto) abandona
     * la carga en curso, SOLO si sigue en curso (`?solo=en_curso`): un descarte
     * automático nunca retira un mes ya publicado.
     */
    const fallar = async (estado: "error" | "cancelado", mensaje: string, descartar = true): Promise<ResultadoMes> => {
      if (cargaId && descartar) {
        try {
          await api.descartar(cargaId, true);
        } catch {
          // Si no se pudo, la carga caduca sola a los 30 minutos y queda invisible.
        }
      }
      avisar({ periodo, estado, mensaje });
      return { ...base, estado, mensaje, cargaId: cargaId ?? undefined, reintentos, incompleto };
    };

    try {
      avisar({ periodo, estado: "cargando", tanda: 0, tandas: tandas.length });

      const abierta = await api.abrirCarga({
        periodo,
        archivo_nombre: entrada.archivoNombre,
        archivo: mes.archivo,
        reporte: armarReporteMes(informe, periodo, {
          archivo_nombre: entrada.archivoNombre,
          codificacion: entrada.codificacion,
          separador: entrada.separador,
          totalesQlik: entrada.totalesQlik?.[periodo],
          forzado: incompleto,
        }),
        reemplazar: mes.estado !== "nuevo",
        mes_abierto: mes.abierto,
        forzar_incompleto: incompleto,
      });
      cargaId = abierta.carga.id;
      fase = "tandas";

      let cancelado = false;
      envio: for (const tanda of tandas) {
        if (signal?.aborted) {
          cancelado = true;
          break;
        }
        avisar({ periodo, estado: "cargando", tanda: tanda.tanda, tandas: tandas.length });
        for (let intento = 1; ; intento++) {
          try {
            await api.enviarTanda(cargaId, tanda, signal);
            break;
          } catch (e) {
            // Cancelar corta la petición en vuelo: no es un fallo que reintentar.
            if (signal?.aborted) {
              cancelado = true;
              break envio;
            }
            if (!esReintentable(e) || intento >= REINTENTOS_TANDA) throw e;
            reintentos += 1;
            await espera(intento);
          }
        }
      }
      // Última oportunidad de cancelar: publicar NO es cancelable una vez iniciado.
      if (cancelado || signal?.aborted) {
        resultados.push(await fallar("cancelado", "Carga cancelada."));
        continue;
      }

      fase = "publicar";
      const esperado = esperadoDeMes(consolidado, periodo);
      const publicada = await api.publicar(cargaId, { esperado });
      resultados.push({
        ...base,
        estado: "publicado",
        cargaId,
        filas: publicada.medido.filas,
        reintentos,
        incompleto,
      });
      avisar({ periodo, estado: "publicado" });
    } catch (e) {
      const cuerpo = e instanceof Object && "cuerpo" in e ? ((e as { cuerpo: Record<string, unknown> }).cuerpo ?? {}) : {};
      const mensaje =
        cuerpo.codigo === "no_concilia" && cuerpo.esperado && cuerpo.medido
          ? mensajeNoConcilia(cuerpo.esperado as MedidasCarga, cuerpo.medido as MedidasCarga)
          : mensajeDe(e);

      if (fase !== "publicar" || !cargaId) {
        resultados.push(await fallar("error", mensaje));
        continue;
      }

      // Falló `publicar`. `no_concilia` ya dejó la carga `fallida` y cualquier `4xx` (por
      // ejemplo "ya no está en curso") no deja nada que descartar. Solo un fallo ambiguo
      // (red o 5xx: ¿llegó a publicarse?) exige mirar el estado real antes de decidir.
      if (cuerpo.codigo === "no_concilia" || !esReintentable(e)) {
        resultados.push(await fallar("error", mensaje, false));
        continue;
      }
      let estadoReal: string | null = null;
      let filasReales: number | null = null;
      try {
        const d = await api.detalle(cargaId);
        estadoReal = d.carga.estado;
        filasReales = d.carga.filas;
      } catch {
        // No se pudo confirmar.
      }
      if (estadoReal === "publicada") {
        resultados.push({
          ...base,
          estado: "publicado",
          cargaId,
          filas: filasReales ?? esperadoDeMes(consolidado, periodo).filas,
          reintentos,
          incompleto,
        });
        avisar({ periodo, estado: "publicado" });
      } else if (estadoReal === "en_curso") {
        resultados.push(await fallar("error", mensaje));
      } else if (estadoReal === null) {
        resultados.push(
          await fallar("error", `No se pudo confirmar si ${periodo} quedó publicado (${mensaje}). Revísalo en "Cargas por mes".`, false)
        );
      } else {
        resultados.push(await fallar("error", mensaje, false));
      }
    }
  }

  // La limpieza de las cargas reemplazadas o fallidas va al final y no es crítica.
  if (resultados.some((r) => r.estado !== "pendiente")) {
    try {
      await api.limpiar();
    } catch {
      // Solo quedan filas huérfanas invisibles; la siguiente pasada las recoge.
    }
  }
  return resultados;
}
