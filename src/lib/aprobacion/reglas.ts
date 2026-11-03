import { VERSION_METODO, type EstadoProyeccion, type Motivo } from "@/lib/proyeccion/tipos-api";
import {
  bloqueosNinoDeCierre,
  motivoRechazoCerrar,
  motivoRechazoEdicion,
  type BloqueosNino,
  type RechazoRegla,
  type SinAprobarCierre,
} from "@/lib/proyeccion/reglas";
import { REVISION_DESVIO_PCT, REVISION_OBLIGATORIA_DESDE, type BloqueoLoteApi, type EfectoGMApi, type TipoLote } from "./tipos-api";

/**
 * Reglas de estado de la aprobación en bloque (ficha 07g, D14, D2 y §4.4; R7 y R13). Puras: el servicio las llama y no las reimplementa. NO importan
 * `src/lib/ia/` (los bloqueos no dependen de la IA) ni nada de `node:*`; la pantalla puede importarlas.
 */

// ─── D14 · Bloqueos de todo lote «aprobar» o «reaprobar» ───

export type ArgsBloqueosLote = {
  estado: EstadoProyeccion;
  calculandoDesde: string | null;
  /** ISO del servidor (nunca se lee el reloj aquí). */
  ahora: string;
  anioEnCurso: number;
  /** `resumen.version_metodo` de la proyección; `null` si falta (calculada con un método viejo). */
  versionMetodo: number | null;
  /** Los motivos de `desactualizadaDe(…)`: CUALQUIERA bloquea (D14), también `tiendas_cambiadas` o `recalculo_pendiente`. */
  desactualizada: readonly Motivo[];
  bloqueosNino?: BloqueosNino;
  /** Los crecimientos de `Y+1` siempre (incluye Resto provisional y `reaprobar` de 06e). `null` = nada falta. */
  crecimientosSinAprobar?: SinAprobarCierre | null;
};

/** `motivoRechazoCerrar` da `ya_cerrada`; la ficha (§3.1) lo llama `cerrada`. */
const CODIGO_DE_CIERRE: Readonly<Record<string, string>> = { ya_cerrada: "cerrada", desactualizada: "proyeccion_desactualizada" };

export const MENSAJE_DESACTUALIZADA_LOTE = "La proyección está desactualizada: recalcula antes de aprobar en bloque, para no fijar cifras que ya no se propondrían.";

/**
 * D14. Lo que impide aprobar o reaprobar en bloque, en el orden de `motivoRechazoCerrar` (el `409` es el primero): proyección cerrada, archivada o
 * calculándose; `version_metodo < 5`; los del Niño (todos, no solo el primero); crecimientos de `Y+1` sin aprobar; y desactualizada por CUALQUIER
 * motivo. Se arma llamando a `motivoRechazoCerrar` con `filasBase` y `tiendas` vacíos y `forzar = false`, de modo que el orden y los mensajes son los del cierre.
 * Revertir NO usa esto (`bloqueoDeReversion`).
 */
export function bloqueosDeLote(a: ArgsBloqueosLote): BloqueoLoteApi[] {
  const salida: BloqueoLoteApi[] = [];
  let metodoViejo = a.versionMetodo === null || a.versionMetodo < VERSION_METODO;
  let nino: BloqueosNino | undefined = a.bloqueosNino;
  let sinAprobar: SinAprobarCierre | null | undefined = a.crecimientosSinAprobar;
  let desactualizada = a.desactualizada.length > 0;
  // Cada vuelta quita lo que ya se anotó; son como mucho cinco causas distintas.
  for (let i = 0; i < 8; i++) {
    const r = motivoRechazoCerrar({
      estado: a.estado,
      calculandoDesde: a.calculandoDesde,
      ahora: a.ahora,
      anioEnCurso: a.anioEnCurso,
      filasBase: [],
      tiendas: [],
      desactualizada,
      forzar: false,
      metodoViejo,
      bloqueosNino: nino,
      crecimientosSinAprobar: sinAprobar,
    });
    if (r.ok) break;
    const codigo = r.rechazo.codigo;
    if (codigo === "ya_cerrada" || codigo === "archivada" || codigo === "calculo_en_curso") {
      salida.push({ codigo: CODIGO_DE_CIERRE[codigo] ?? codigo, mensaje: r.rechazo.mensaje });
      break;
    }
    if (codigo === "version_metodo") {
      salida.push({ codigo, mensaje: "La proyección se calculó con una versión anterior del método: recalcúlala antes de aprobar en bloque." });
      metodoViejo = false;
    } else if (codigo === "crecimientos_sin_aprobar") {
      salida.push({ codigo, mensaje: r.rechazo.mensaje, detalle: { crecimientos_sin_aprobar: r.crecimientos_sin_aprobar ?? null } });
      sinAprobar = null;
    } else if (codigo === "desactualizada") {
      salida.push({
        codigo: "proyeccion_desactualizada",
        mensaje: MENSAJE_DESACTUALIZADA_LOTE,
        detalle: { motivos: a.desactualizada.map((m) => ({ codigo: m.codigo, mensaje: m.mensaje })) },
      });
      desactualizada = false;
    } else {
      // Los del Niño: se listan todos (el primero es el `409`) y se apagan juntos.
      for (const b of bloqueosNinoDeCierre(nino, a.anioEnCurso)) salida.push({ codigo: b.codigo, mensaje: b.mensaje, detalle: b.detalle });
      nino = undefined;
    }
  }
  return salida;
}

// ─── D12 / R13 · Revertir ───

/**
 * D14 (B1): revertir solo exige que la proyección esté en trabajo y sin cálculo en curso. NO se bloquea por desactualizada ni por crecimientos:
 * volver a la propuesta nunca fija cifras viejas.
 */
export function bloqueoDeReversion(a: { estado: EstadoProyeccion; calculandoDesde: string | null; ahora: string }): RechazoRegla | null {
  return motivoRechazoEdicion(a);
}

/** D12 (LP005): se revierte un lote `aprobar` o `reaprobar` de ESTA proyección; una reversión no se revierte. */
export function motivoRechazoRevertir(a: { tipo: TipoLote; proyeccionIdDelLote: string | null; proyeccionId: string }): RechazoRegla | null {
  if (a.tipo === "revertir") return { status: 409, codigo: "no_revertible", mensaje: "Una reversión no se puede revertir: si hace falta, vuelve a aprobar las filas." };
  if (a.proyeccionIdDelLote !== a.proyeccionId) return { status: 409, codigo: "no_revertible", mensaje: "Ese lote no es de esta proyección." };
  return null;
}

// ─── R7 · Un año por lote; la IA solo en Y+1 ───

/**
 * D6 y R7. `anio` debe ser `Y` o `Y+1` y la fuente `ia` solo existe en `Y+1` (la IA de `0.15.0` distribuye únicamente 2027). Devuelve el `409`
 * `anio_no_admitido` del cuerpo entero.
 */
export function motivoRechazoAnioYFuentes(a: { anio: number; anioEnCurso: number; fuentes: readonly ("ia" | "metodo")[] }): RechazoRegla | null {
  const Y = a.anioEnCurso;
  if (a.anio !== Y && a.anio !== Y + 1) {
    return { status: 409, codigo: "anio_no_admitido", mensaje: `Solo se aprueba en bloque ${Y} o ${Y + 1}.` };
  }
  if (a.anio === Y && a.fuentes.includes("ia")) {
    return { status: 409, codigo: "anio_no_admitido", mensaje: `La IA solo propone cifras para ${Y + 1}: ${Y} se aprueba con el método.` };
  }
  return null;
}

// ─── §4.4 · Cuándo la confirmación exige «Revisé el resumen por GM» ───

/** `desvio ÷ meta` en %; `null` sin desvío o sin meta positiva. */
export function desvioPct(desvioU: number | null, meta: number | null): number | null {
  if (desvioU === null || meta === null || !(meta > 0)) return null;
  return (desvioU / meta) * 100;
}

/**
 * Más de `REVISION_OBLIGATORIA_DESDE` filas pedidas o algún GM que queda a más de ±`REVISION_DESVIO_PCT` % de su meta. Una función de lo que se pidió y del efecto
 * (no de lo que se escribe), así la simulación y la aplicación dan lo mismo (R22).
 */
export function revisionRequerida(a: { filasPedidas: number; efecto: readonly Pick<EfectoGMApi, "desvio_despues_u" | "meta_despues">[] }): boolean {
  if (a.filasPedidas > REVISION_OBLIGATORIA_DESDE) return true;
  return a.efecto.some((e) => {
    const p = desvioPct(e.desvio_despues_u, e.meta_despues);
    return p !== null && Math.abs(p) > REVISION_DESVIO_PCT;
  });
}
