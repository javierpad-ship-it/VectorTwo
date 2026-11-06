import {
  diasEntre,
  etiquetaDiaMes,
  etiquetaFecha,
  etiquetaMes,
  esMomentoFuturo,
  rangoConfirmado,
  type AhoraLima,
} from "@/lib/compras/agrupadores/fechas";
import { hitosDeEmbarque } from "@/lib/compras/agrupadores/hitos";
import { HITOS_CONFIRMABLES } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_HITO,
  type CambiarFechasCuerpo,
  type CambioFechaApi,
  type CausaFecha,
  type EmbarqueApi,
  type EventoAgrupadorApi,
  type Hito,
  type HitoApi,
  type HitoConfirmable,
  type IngresoPaqueteCuerpo,
  type PaqueteApi,
} from "@/lib/compras/agrupadores/tipos-api";

/**
 * Lógica pura de las pantallas de fechas del embarque (ficha 08b-1b §4.3 a §4.5): el formulario del diálogo «Fechas del embarque», el
 * cuerpo que se manda a `/fechas`, qué cambios reprograman (y por tanto piden motivo y causa) y los textos de la vista previa, de la línea
 * de tiempo y del historial por hito. Sin React y sin reloj: «ahora» entra como parámetro. La decisión final siempre es del servidor; esto
 * solo ahorra viajes y le dice a la persona qué falta.
 */

// ─── Fechas en pantalla ───

/** Fecha y hora de Lima en este instante (el reloj entra como parámetro para poder probarlo). */
export function ahoraEnLima(reloj: Date = new Date()): AhoraLima {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(reloj);
  const d = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return { fecha: `${d("year")}-${d("month")}-${d("day")}`, hora: `${d("hour")}:${d("minute")}` };
}

/** `2026-11-15` → `15-nov` (o `15-nov-2027` si no es del año de `hoy`): las fechas de las frases de la vista previa y del historial. */
export function fechaCorta(fecha: string | null | undefined, hoy: string): string {
  if (!fecha) return "—";
  const dia = etiquetaDiaMes(fecha);
  return fecha.slice(0, 4) === hoy.slice(0, 4) ? dia : `${dia}-${fecha.slice(0, 4)}`;
}

/** Una fecha con su hora opcional: `2026-11-05 09:22` → `05-nov 09:22`. */
export function fechaHoraCorta(valor: string | null | undefined, hoy: string): string {
  if (!valor) return "—";
  const hora = valor.length > 10 ? valor.slice(11, 16) : "";
  return `${fechaCorta(valor.slice(0, 10), hoy)}${hora ? ` ${hora}` : ""}`;
}

/** `dd/mm/aaaa` con la hora si la tiene: la fecha de un hito en la tabla y en la línea de tiempo. */
export const textoFechaHito = (fecha: string | null, hora: string | null = null): string => (fecha === null ? "—" : `${etiquetaFecha(fecha)}${hora ? ` ${hora.slice(0, 5)}` : ""}`);

/** «+10 d» o «−3 d» para el retraso de un hito contra lo planeado al crear. */
export const textoRetraso = (dias: number): string => (dias > 0 ? `+${dias} d` : `−${Math.abs(dias)} d`);

/** «2 cambios» / «1 cambio». */
export const textoCambios = (n: number): string => `${n} ${n === 1 ? "cambio" : "cambios"}`;

/**
 * Los cinco hitos de un embarque: los de la API; si la respuesta aún no los trae (una pestaña abierta durante el despliegue), se calculan con
 * la misma lógica pura (`hitosDeEmbarque`), sin fechas originales ni reprogramaciones.
 */
export function hitosDelEmbarque(e: EmbarqueParaFechas & Pick<EmbarqueApi, "hitos">, hoy: string): HitoApi[] {
  return (
    e.hitos ??
    hitosDeEmbarque(
      {
        tipo: e.tipo,
        estado: e.estado,
        fecha_salida_estimada: e.fecha_salida_estimada,
        fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
        fecha_llegada_estimada: e.fecha_llegada_estimada,
        fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
        hora_inicio_operativo: e.hora_inicio_operativo ?? null,
        fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
        fecha_llegada_real: e.fecha_llegada_real,
        hito_confirmado: e.hito_confirmado ?? null,
      },
      hoy,
    )
  );
}

// ─── Estados de un hito, en texto ───

/**
 * El estado en una o dos palabras para la línea de tiempo y la lista (siempre texto; el color nunca es la única señal). El «Vencido» lleva
 * los días: «Vencido (hace 4 días)».
 */
export function textoEstadoCorto(h: Pick<HitoApi, "estado" | "fecha">, hoy: string): string {
  switch (h.estado) {
    case "real":
      return "Ocurrió ✓";
    case "sin_registrar":
      return "Ocurrió · sin fecha";
    case "vencido": {
      const d = h.fecha === null ? 1 : Math.max(1, diasEntre(h.fecha, hoy));
      return `Vencido (hace ${d} ${d === 1 ? "día" : "días"})`;
    }
    case "por_confirmar":
      return "Llegó, falta confirmar el ingreso";
    case "previsto":
      return "Previsto";
    case "pendiente":
      return "Pendiente";
    case "no_aplica":
      return "No aplica";
  }
}

/** La lista y las tarjetas: «Arribo · 18-nov · Previsto» o «Ingreso CD · 08-nov · Vencido (hace 4 días)». */
export function textoProximoHito(h: { hito: Hito; fecha: string | null; hora: string | null; estado: HitoApi["estado"] } | null | undefined, hoy: string): string {
  if (!h) return "Sin pendientes";
  const fecha = h.fecha === null ? "sin fecha" : fechaHoraCorta(h.hora ? `${h.fecha} ${h.hora}` : h.fecha, hoy);
  return `${ETIQUETA_HITO[h.hito]} · ${fecha} · ${textoEstadoCorto(h, hoy)}`;
}

/** Texto de «Reprogramado ×N» de la lista; `null` si nunca se reprogramó. */
export const textoReprogramado = (n: number | undefined): string | null => (n && n > 0 ? `Reprogramado ×${n}` : null);

// ─── El formulario del diálogo «Fechas del embarque» ───

export type FormFechas = {
  zarpe: string;
  arribo: string;
  ingresoCd: string;
  inicioFecha: string;
  inicioHora: string;
  /** `true` = el ingreso al stock se fija con `ingresoStock`; `false` = sigue al Ingreso CD (igualar). */
  ingresoFijo: boolean;
  ingresoStock: string;
  confirmado: HitoConfirmable | null;
  motivo: string;
  /** `null` = sin tocar (puede proponerse `programacion`). */
  causa: CausaFecha | null;
};

type EmbarqueParaFechas = Pick<
  EmbarqueApi,
  "tipo" | "fecha_salida_estimada" | "fecha_llegada_estimada" | "fecha_llegada_real" | "revision" | "estado"
> & {
  fecha_puerto_estimada?: string | null;
  fecha_inicio_operativo_estimada?: string | null;
  hora_inicio_operativo?: string | null;
  fecha_ingreso_estimada?: string | null;
  hito_confirmado?: HitoConfirmable | null;
};

const hhmm = (h: string | null | undefined): string => (h ? h.slice(0, 5) : "");

export function formInicialFechas(e: EmbarqueParaFechas): FormFechas {
  return {
    zarpe: e.fecha_salida_estimada ?? "",
    arribo: e.fecha_puerto_estimada ?? "",
    ingresoCd: e.fecha_llegada_estimada,
    inicioFecha: e.fecha_inicio_operativo_estimada ?? "",
    inicioHora: hhmm(e.hora_inicio_operativo),
    ingresoFijo: (e.fecha_ingreso_estimada ?? null) !== null,
    ingresoStock: e.fecha_ingreso_estimada ?? "",
    confirmado: e.hito_confirmado ?? null,
    motivo: "",
    causa: null,
  };
}

/** Los hitos que se marcan «ya ocurrió», en orden. */
export const HITOS_MARCABLES: readonly HitoConfirmable[] = HITOS_CONFIRMABLES;

/** Marcar un hito marca también los anteriores (el último que ocurrió manda); desmarcarlo deja como último al anterior. */
export function marcarHito(hito: HitoConfirmable, marcado: boolean, ocultos: readonly HitoConfirmable[] = []): HitoConfirmable | null {
  const visibles = HITOS_MARCABLES.filter((h) => !ocultos.includes(h));
  if (marcado) return hito;
  const i = visibles.indexOf(hito);
  return i <= 0 ? null : visibles[i - 1];
}

export const estaMarcado = (actual: HitoConfirmable | null, hito: HitoConfirmable): boolean => actual !== null && rangoConfirmado(hito) <= rangoConfirmado(actual);

export type ResultadoFormFechas = {
  cuerpo: CambiarFechasCuerpo | null;
  /** Qué falta o qué está mal (para el texto bajo el formulario); `undefined` si el cuerpo es válido. */
  pista?: string;
  /** El envío reprograma algo: pide motivo y causa. */
  reprograma: boolean;
  /** Hay algún cambio de fechas o de «ya ocurrió». */
  hayCambios: boolean;
  /** La causa que se manda o se propone (`programacion` si solo cambia el ingreso al stock). */
  causaEfectiva: CausaFecha | null;
  /** Textos de orden entre hitos que la pantalla puede avisar antes de enviar (no bloquean). */
  noFutura: string[];
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Del formulario al cuerpo de `POST /fechas`: solo viajan las claves que cambian (clave ausente = no cambia). Decide con la misma regla de
 * §2.10 paso 3 si el cambio reprograma (cambiar o vaciar Zarpe, Arribo o Inicio operativo que ya tenían valor; cambiar el Ingreso CD;
 * cambiar la fecha efectiva del ingreso al stock; bajar «ya ocurrió») y, en ese caso, pide motivo y causa.
 */
export function cuerpoDeFechas(e: EmbarqueParaFechas, f: FormFechas, ahora: AhoraLima): ResultadoFormFechas {
  const esLocal = e.tipo === "local";
  const cuerpo: CambiarFechasCuerpo = { revision: e.revision };
  const noFutura: string[] = [];
  let reprograma = false;
  let hayCambios = false;
  let soloIngreso = true;
  let falta: string | undefined;

  const sinNada = (extra?: string) => ({ cuerpo: null, pista: extra, reprograma, hayCambios, causaEfectiva: null, noFutura });

  // Zarpe
  const zarpeAntes = e.fecha_salida_estimada ?? "";
  if (f.zarpe !== zarpeAntes) {
    if (f.zarpe !== "" && !FECHA.test(f.zarpe)) return sinNada("Revisa la fecha del zarpe.");
    cuerpo.fecha_zarpe = f.zarpe === "" ? null : f.zarpe;
    hayCambios = true;
    if (zarpeAntes !== "") {
      reprograma = true;
      soloIngreso = false;
    }
  }
  // Arribo (un local no lo lleva)
  if (!esLocal) {
    const arriboAntes = e.fecha_puerto_estimada ?? "";
    if (f.arribo !== arriboAntes) {
      if (f.arribo !== "" && !FECHA.test(f.arribo)) return sinNada("Revisa la fecha del arribo.");
      cuerpo.fecha_arribo = f.arribo === "" ? null : f.arribo;
      hayCambios = true;
      if (arriboAntes !== "") {
        reprograma = true;
        soloIngreso = false;
      }
    }
  }
  // Ingreso CD (obligatorio)
  if (!FECHA.test(f.ingresoCd)) return sinNada("El Ingreso CD es obligatorio: pon su fecha.");
  const cdCambia = f.ingresoCd !== e.fecha_llegada_estimada;
  if (cdCambia) {
    cuerpo.fecha_ingreso_cd = f.ingresoCd;
    hayCambios = true;
    reprograma = true;
    soloIngreso = false;
  }
  // Inicio operativo (fecha y hora opcional)
  const inicioFechaAntes = e.fecha_inicio_operativo_estimada ?? "";
  const inicioHoraAntes = hhmm(e.hora_inicio_operativo);
  if (f.inicioHora !== "" && f.inicioFecha === "") return sinNada("Pon la fecha del inicio operativo antes que la hora.");
  if (f.inicioHora !== "" && !HORA.test(f.inicioHora)) return sinNada("La hora del inicio operativo va como hh:mm (de 00:00 a 23:59).");
  if (f.inicioFecha !== "" && !FECHA.test(f.inicioFecha)) return sinNada("Revisa la fecha del inicio operativo.");
  if (f.inicioFecha !== inicioFechaAntes || f.inicioHora !== inicioHoraAntes) {
    cuerpo.inicio_operativo = f.inicioFecha === "" ? null : { fecha: f.inicioFecha, hora: f.inicioHora === "" ? null : f.inicioHora };
    hayCambios = true;
    if (inicioFechaAntes !== "" && (f.inicioFecha !== inicioFechaAntes || (inicioHoraAntes !== "" && f.inicioHora !== inicioHoraAntes))) {
      reprograma = true;
      soloIngreso = false;
    }
  }
  // Ingreso al stock: fijar con fecha o igualar al Ingreso CD (nulo)
  const fijadoAntes = e.fecha_ingreso_estimada ?? null;
  if (f.ingresoFijo && !FECHA.test(f.ingresoStock)) return sinNada("Elige la fecha del Ingreso al stock o usa «Igualar al Ingreso CD».");
  const fijadoDespues = f.ingresoFijo ? f.ingresoStock : null;
  if (fijadoDespues !== fijadoAntes) {
    cuerpo.fecha_ingreso_stock = fijadoDespues;
    hayCambios = true;
  }
  const efectivoAntes = fijadoAntes ?? e.fecha_llegada_estimada;
  const efectivoDespues = fijadoDespues ?? f.ingresoCd;
  if (fijadoDespues !== fijadoAntes && efectivoAntes !== efectivoDespues) reprograma = true;
  if (cdCambia && fijadoDespues === null && efectivoAntes !== efectivoDespues) reprograma = true;
  // «Ya ocurrió»
  const confirmadoAntes = e.hito_confirmado ?? null;
  if (f.confirmado !== confirmadoAntes) {
    cuerpo.hito_confirmado = f.confirmado;
    hayCambios = true;
    if (rangoConfirmado(f.confirmado) < rangoConfirmado(confirmadoAntes)) {
      reprograma = true;
      soloIngreso = false;
    }
  }
  // Un hito marcado como ocurrido no puede tener fecha futura (el servidor también lo comprueba).
  if (f.confirmado !== null) {
    const r = rangoConfirmado(f.confirmado);
    const fechas: [string, string, boolean][] = [
      ["el zarpe", f.zarpe, r >= 1],
      ["el arribo", f.arribo, r >= 2 && !esLocal],
      ["el Ingreso CD", f.ingresoCd, r >= 3],
    ];
    for (const [nombre, fecha, aplica] of fechas) if (aplica && fecha !== "" && fecha > ahora.fecha) noFutura.push(`No puedes marcar como ocurrido ${nombre} con una fecha futura (${etiquetaFecha(fecha)}).`);
    if (r >= 4 && f.inicioFecha !== "" && esMomentoFuturo(f.inicioFecha, f.inicioHora || null, ahora)) noFutura.push("No puedes marcar como ocurrido el inicio operativo con una fecha futura.");
  }
  if (f.confirmado === "zarpe" && f.zarpe === "") falta = "Pon la fecha del zarpe para marcarlo como ocurrido.";
  if (f.confirmado === "arribo" && f.arribo === "") falta = "Pon la fecha del arribo para marcarlo como ocurrido.";
  if (f.confirmado === "inicio_operativo" && f.inicioFecha === "") falta = "Pon la fecha del inicio operativo para marcarlo como ocurrido.";

  if (!hayCambios) return { cuerpo: null, pista: "Cambia alguna fecha o marca un hito como ocurrido.", reprograma: false, hayCambios: false, causaEfectiva: null, noFutura };
  if (falta) return { cuerpo: null, pista: falta, reprograma, hayCambios, causaEfectiva: null, noFutura };
  if (noFutura.length > 0) return { cuerpo: null, pista: noFutura[0], reprograma, hayCambios, causaEfectiva: null, noFutura };

  const motivo = f.motivo.trim();
  const causaEfectiva: CausaFecha | null = f.causa ?? (reprograma && soloIngreso ? "programacion" : null);
  if (reprograma) {
    if (motivo === "") return { cuerpo: null, pista: "Escribe el motivo: reprogramar lo pide.", reprograma, hayCambios, causaEfectiva, noFutura };
    if (causaEfectiva === null) return { cuerpo: null, pista: "Elige la causa de la reprogramación.", reprograma, hayCambios, causaEfectiva, noFutura };
  }
  if (motivo !== "") cuerpo.motivo = motivo;
  if (causaEfectiva !== null && (reprograma || f.causa !== null)) cuerpo.causa = causaEfectiva;
  return { cuerpo, reprograma, hayCambios, causaEfectiva, noFutura };
}

/** La hora de Lima propuesta al marcar «ya empezó» (el botón «Ahora»). */
export const horaAhora = (ahora: AhoraLima): string => ahora.hora.slice(0, 5);

// ─── Ingreso de un paquete (§4.5) ───

export type ResultadoFormIngreso = { cuerpo: IngresoPaqueteCuerpo | null; pista?: string; reprograma: boolean };

/**
 * Cuerpo de `POST /paquetes/[id]/ingreso`. `fecha = ""` suelta el ingreso (hereda el del embarque). Cambiar el ingreso de un paquete
 * siempre reprograma (pide motivo y causa); la causa se propone `programacion`.
 */
export function cuerpoDeIngresoPaquete(p: Pick<PaqueteApi, "fecha_ingreso">, revisionEmbarque: number, fecha: string, motivo: string, causa: CausaFecha | null): ResultadoFormIngreso {
  const antes = p.fecha_ingreso ?? "";
  if (fecha !== "" && !FECHA.test(fecha)) return { cuerpo: null, pista: "Revisa la fecha del ingreso.", reprograma: false };
  if (fecha === antes) return { cuerpo: null, pista: antes === "" ? "Elige una fecha de ingreso propio." : "Elige una fecha distinta de la actual, o suelta el ingreso.", reprograma: false };
  if (motivo.trim() === "") return { cuerpo: null, pista: "Escribe el motivo del cambio.", reprograma: true };
  const causaFinal = causa ?? "programacion";
  return { cuerpo: { revision_embarque: revisionEmbarque, fecha_ingreso_stock: fecha === "" ? null : fecha, motivo: motivo.trim(), causa: causaFinal }, reprograma: true };
}

// ─── Vista previa: textos ───

const NOMBRE_CAMBIO: Record<CambioFechaApi["hito"], string> = {
  orden_compra: "Orden de compra",
  zarpe: "Zarpe",
  arribo: "Arribo",
  ingreso_cd: "Ingreso CD",
  inicio_operativo: "Inicio operativo",
  ingreso_stock: "Ingreso al stock",
  ingreso_paquete: "Ingreso del paquete",
  hito_confirmado: "Ya ocurrió",
};

const NOMBRE_HITO_CONFIRMADO: Record<string, string> = { zarpe: "el zarpe", arribo: "el arribo", ingreso_cd: "el Ingreso CD", inicio_operativo: "el inicio operativo" };

/** «Ingreso CD: 15-nov → 03-dic (+18 d)». */
export function textoCambioFecha(c: CambioFechaApi, hoy: string): string {
  if (c.hito === "hito_confirmado") {
    const nombre = (v: string | null) => (v === null ? "ninguno" : (NOMBRE_HITO_CONFIRMADO[v] ?? v));
    return `Ya ocurrió: último hito ${nombre(c.antes)} → ${nombre(c.despues)}`;
  }
  const dias = c.dias === null || c.dias === 0 ? "" : ` (${textoRetraso(c.dias)})`;
  const quien = c.hito === "ingreso_paquete" ? `Ingreso del paquete ${c.paquete?.codigo ?? ""}`.trim() : NOMBRE_CAMBIO[c.hito];
  const despues = c.despues === null ? (c.hito === "ingreso_paquete" ? "hereda el del embarque" : "—") : fechaHoraCorta(c.despues, hoy);
  return `${quien}: ${fechaHoraCorta(c.antes, hoy)} → ${despues}${dias}`;
}

/** «12 líneas de 5 compras pasan de nov-26 a dic-26» no se arma aquí: el servidor da `meses` y el plan da compras y líneas. */
export function textoMeses(meses: readonly { de: string; a: string; unidades: number }[]): string[] {
  return meses.map((m) => `${etiquetaMes(m.de)} → ${etiquetaMes(m.a)}: ${m.unidades.toLocaleString("es-PE")} u`);
}

// ─── Historial por hito (eventos) ───

export type CambioDeEvento = {
  hito: Hito | "ingreso_paquete" | "hito_confirmado";
  paquete?: string;
  antes: string | null;
  despues: string | null;
  /** Solo el ingreso al stock: quedó sin fijar (sigue al Ingreso CD). */
  sigueAlIngresoCd?: boolean;
};

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Fecha y hora del inicio operativo de una foto de evento: `2026-11-05 09:22` o solo la fecha. */
function inicioDeFoto(f: Record<string, unknown>): string | null {
  const fecha = texto(f.fecha_inicio_operativo_estimada);
  if (fecha === null) return null;
  const hora = texto(f.hora_inicio_operativo);
  return hora ? `${fecha} ${hora.slice(0, 5)}` : fecha;
}

/**
 * Qué cambió en cada hito según un evento `cambiar_fecha`, leyendo las fotos `antes` y `despues` del embarque (`agrupador_foto_embarque`).
 * Un evento de otra acción, o sin fotos, no da cambios (la pantalla muestra su `resumen`).
 */
export function cambiosDeEvento(ev: Pick<EventoAgrupadorApi, "accion" | "antes" | "despues">): CambioDeEvento[] {
  if (ev.accion !== "cambiar_fecha") return [];
  const a = objeto(ev.antes);
  const d = objeto(ev.despues);
  if (a === null || d === null) return [];
  const salida: CambioDeEvento[] = [];
  const par = (hito: CambioDeEvento["hito"], antes: string | null, despues: string | null, extra: Partial<CambioDeEvento> = {}) => {
    if (antes !== despues) salida.push({ hito, antes, despues, ...extra });
  };
  par("zarpe", texto(a.fecha_salida_estimada), texto(d.fecha_salida_estimada));
  par("arribo", texto(a.fecha_puerto_estimada), texto(d.fecha_puerto_estimada));
  par("ingreso_cd", texto(a.fecha_llegada_estimada), texto(d.fecha_llegada_estimada));
  par("inicio_operativo", inicioDeFoto(a), inicioDeFoto(d));
  const efectivo = (f: Record<string, unknown>) => texto(f.fecha_ingreso_estimada) ?? texto(f.fecha_llegada_estimada);
  par("ingreso_stock", efectivo(a), efectivo(d), { sigueAlIngresoCd: texto(d.fecha_ingreso_estimada) === null });
  par("hito_confirmado", texto(a.hito_confirmado), texto(d.hito_confirmado));
  const paquetesAntes = new Map((Array.isArray(a.paquetes) ? a.paquetes : []).map(objeto).filter((p): p is Record<string, unknown> => p !== null).map((p) => [String(p.id), p]));
  for (const p of (Array.isArray(d.paquetes) ? d.paquetes : []).map(objeto)) {
    if (p === null) continue;
    const previo = paquetesAntes.get(String(p.id));
    if (!previo) continue;
    par("ingreso_paquete", texto(previo.fecha_ingreso_estimada), texto(p.fecha_ingreso_estimada), { paquete: texto(p.codigo) ?? "" });
  }
  return salida;
}

/** Cambios de un evento en una línea: «Ingreso CD 15-nov → 03-dic · Ingreso al stock 15-nov → 03-dic (sigue al Ingreso CD)». */
export function textoCambiosDeEvento(cambios: readonly CambioDeEvento[], hoy: string): string {
  return cambios
    .map((c) => {
      if (c.hito === "hito_confirmado") {
        const nombre = (v: string | null) => (v === null ? "ninguno" : (NOMBRE_HITO_CONFIRMADO[v] ?? v));
        return `Ya ocurrió: ${nombre(c.antes)} → ${nombre(c.despues)}`;
      }
      const quien = c.hito === "ingreso_paquete" ? `Ingreso del paquete ${c.paquete ?? ""}`.trim() : ETIQUETA_HITO[c.hito];
      const despues = c.despues === null ? (c.hito === "ingreso_paquete" ? "hereda el del embarque" : "—") : fechaHoraCorta(c.despues, hoy);
      return `${quien} ${fechaHoraCorta(c.antes, hoy)} → ${despues}${c.hito === "ingreso_stock" && c.sigueAlIngresoCd ? " (sigue al Ingreso CD)" : ""}`;
    })
    .join(" · ");
}
