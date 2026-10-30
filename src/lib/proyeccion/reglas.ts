import { mensajeFactorDesfasado, mensajeFactorSinConfirmar } from "./desactualizado";
import {
  CALCULO_CADUCA_MIN,
  FORMULA_FACTOR_RELATIVO,
  MAX_TOTAL,
  MIN_MESES_FACTOR,
  UMBRAL_COLA_LARGA,
  type DiagnosticoFactorApi,
  type EstadoProyeccion,
  type ReaprobarCierreApi,
} from "./tipos-api";
import type { PeriodoEfectoApi } from "@/lib/curvas/tipos-api";

/**
 * Reglas de estado de la proyección (ficha 07, reglas 36 a 39). Puras: el handler las llama y no las reimplementa.
 * Nunca leen el reloj: reciben `ahora` (ISO) del handler.
 */

export type RechazoRegla = { status: 404 | 409; codigo: string; mensaje: string };

const CADUCA_MS = CALCULO_CADUCA_MIN * 60 * 1000;

/** Regla 39. Verdadero si `calculando_desde` existe y tiene menos de `CALCULO_CADUCA_MIN` minutos. */
export function calculoEnCurso(calculandoDesde: string | null, ahora: string): boolean {
  if (!calculandoDesde) return false;
  const desde = Date.parse(calculandoDesde);
  const fin = Date.parse(ahora);
  if (Number.isNaN(desde) || Number.isNaN(fin)) return false;
  return fin - desde < CADUCA_MS;
}

/** Milisegundos que dura un cálculo antes de caducar (para que `servicio-base` calcule el instante límite). */
export const CALCULO_CADUCA_MS = CADUCA_MS;

/** Tope de proyecciones `en_trabajo` por año (cada una guarda decenas de miles de registros). */
export const MAX_EN_TRABAJO_POR_ANIO = 20;

/** Cuántas filas sin decidir se listan en el `409 filas_sin_decidir` (el resto se resume en el total). */
export const MAX_FILAS_SIN_DECIDIR_LISTADAS = 50;

export const MENSAJE_CALCULO_EN_CURSO_SISTEMA = "Ya hay otra proyección calculándose. Espera a que termine (unos segundos) y vuelve a intentarlo.";

export const MENSAJE_CERRADA = "La proyección está cerrada: es solo lectura. Cópiala para seguir trabajando.";
export const MENSAJE_ARCHIVADA = "La proyección está archivada: es solo lectura.";
export const MENSAJE_CALCULO_EN_CURSO_PROYECCION = "La proyección se está calculando. Espera a que termine y vuelve a intentarlo.";

/** Una proyección solo se edita `en_trabajo` y sin cálculo en curso. */
export function motivoRechazoEdicion(args: { estado: EstadoProyeccion; calculandoDesde: string | null; ahora: string }): RechazoRegla | null {
  if (args.estado === "cerrada") return { status: 409, codigo: "cerrada", mensaje: MENSAJE_CERRADA };
  if (args.estado === "archivada") return { status: 409, codigo: "archivada", mensaje: MENSAJE_ARCHIVADA };
  if (calculoEnCurso(args.calculandoDesde, args.ahora)) return { status: 409, codigo: "calculo_en_curso", mensaje: MENSAJE_CALCULO_EN_CURSO_PROYECCION };
  return null;
}

/**
 * Regla 36. Rechazos de una decisión sobre una fila y un año: proyección cerrada, cálculo en curso, fila inactiva, año en
 * curso con `decidido < vendido` y `origen = propuesta` sin propuesta.
 */
export function motivoRechazoDecision(args: {
  estado: EstadoProyeccion;
  calculandoDesde: string | null;
  ahora: string;
  filaActiva: boolean;
  anio: number;
  anioEnCurso: number;
  vendido: number;
  propuesto: number | null;
  decidido: number | null;
  origen: "propuesta" | "manual";
}): RechazoRegla | null {
  const estado = motivoRechazoEdicion(args);
  if (estado) return estado;
  if (!args.filaActiva) return { status: 409, codigo: "fila_inactiva", mensaje: "Esta fila ya no existe en la proyección (el nodo cambió o dejó de vender). Recalcula." };
  if (args.decidido === null) return null; // volver a la propuesta
  if (args.origen === "propuesta") {
    return args.propuesto === null ? { status: 409, codigo: "sin_propuesta", mensaje: "No hay propuesta que aceptar: escribe el total." } : null;
  }
  if (args.anio === args.anioEnCurso && args.decidido < args.vendido) {
    return { status: 409, codigo: "menor_que_vendido", mensaje: `El total de ${args.anio} no puede ser menor que lo ya vendido (${args.vendido.toLocaleString("es-PE")}).` };
  }
  return null;
}

/**
 * `0.10.7` (07b). Rechazos del total de la tienda cuando una fila suya movió el total (`D' = D + Δ`): en el año en curso no puede quedar
 * menor que lo ya vendido por la tienda y ningún total pasa de `MAX_TOTAL`.
 */
export function motivoRechazoTotalTienda(args: { anio: number; anioEnCurso: number; nuevoTotal: number; vendidoTienda: number }): RechazoRegla | null {
  if (args.anio === args.anioEnCurso && args.nuevoTotal < args.vendidoTienda) {
    return {
      status: 409,
      codigo: "menor_que_vendido",
      mensaje: `El total de la tienda en ${args.anio} no puede quedar menor que lo ya vendido (${args.vendidoTienda.toLocaleString("es-PE")}).`,
    };
  }
  if (args.nuevoTotal > MAX_TOTAL) {
    return { status: 409, codigo: "total_excesivo", mensaje: "El total de la tienda quedaría demasiado grande: revisa la cifra de la fila." };
  }
  return null;
}

/** Regla 38b. Tope de proyecciones `en_trabajo` de un año: con 20 abiertas hay que archivar o eliminar alguna antes de crear otra. */
export function motivoRechazoTopeEnTrabajo(enTrabajoDelAnio: number, anio: number): RechazoRegla | null {
  if (enTrabajoDelAnio < MAX_EN_TRABAJO_POR_ANIO) return null;
  return {
    status: 409,
    codigo: "tope_en_trabajo",
    mensaje: `Ya hay ${MAX_EN_TRABAJO_POR_ANIO} proyecciones en trabajo para ${anio}. Archiva o elimina alguna antes de crear otra.`,
  };
}

/**
 * Regla 37b. Archivar la `cerrada` de un año (siempre es la única: solo hay una por año) deja a M8 sin proyección para ese
 * año: hay que confirmarlo con `confirmar_sin_cerrada: true`.
 */
export function motivoRechazoArchivarCerrada(args: { estado: EstadoProyeccion; anio: number; confirmar: boolean }): RechazoRegla | null {
  if (args.estado !== "cerrada" || args.confirmar) return null;
  return {
    status: 409,
    codigo: "ultima_cerrada",
    mensaje: `Esta es la proyección cerrada de ${args.anio}: si la archivas, Presupuesto (M8) se queda sin proyección para ese año hasta que cierres otra. Confírmalo para archivarla.`,
  };
}

/** `avisos` del registro (`revision_cola_larga` bloquea el cierre aunque la propuesta quede bajo el umbral, p. ej. en `Y+1` con crecimiento negativo). */
export type FilaParaCerrar = { clave: string; propuesto: number | null; decidido: number | null; avisos?: readonly string[] };

export type FilaSinDecidir = {
  clave: string;
  anio: number;
  propuesto: number;
  /** `umbral`: propuesta ≥ umbral de cola larga; `revision_cola_larga`: cola larga con quiebres relevantes y demanda corregida sobre el umbral. */
  motivo: "umbral" | "revision_cola_larga";
};

/**
 * `0.12.1` (06d §3.1): lo que falta aprobar para cerrar. `anio` es el año de aplicación (`Y+1`); `faltan` los GM de HOMBRE o MUJER con filas base sin
 * versión vigente y `resto_provisional` que se exige el Resto y no hay uno aprobado. `0.14.0` (06e R16): `reaprobar` las vigentes `bruta` de GM con Niño material.
 */
export type SinAprobarCierre = { anio: number; faltan: { clave: string; nombre: string }[]; resto_provisional: boolean; reaprobar?: ReaprobarCierreApi[] };

const pct1 = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

/** Mensaje de `crecimientos_sin_aprobar` («Faltan 3 crecimientos aprobados para 2027 (…) y el Resto es provisional: apruébalos en …»; con `reaprobar`, qué reaprobar). */
export function mensajeSinAprobar(s: SinAprobarCierre): string {
  const donde = "apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo";
  const n = s.faltan.length;
  const reaprobar = s.reaprobar ?? [];
  let falta: string | null = null;
  if (n === 0) {
    if (s.resto_provisional) falta = `El Resto de ${s.anio} es provisional: apruébalo en Curvas de estacionalidad → Crecimiento por género × mundo antes de cerrar.`;
  } else {
    const lista = s.faltan.map((f) => f.nombre).join(", ");
    const texto = `Faltan ${n} ${n === 1 ? "crecimiento aprobado" : "crecimientos aprobados"} para ${s.anio} (${lista})`;
    falta = s.resto_provisional ? `${texto} y el Resto es provisional: ${donde}.` : `${texto}: ${n === 1 ? "apruébalo" : "apruébalos"} en Curvas de estacionalidad → Crecimiento por género × mundo.`;
  }
  const anioEnCurso = s.anio - 1;
  let re: string | null = null;
  if (reaprobar.length === 1) {
    const r = reaprobar[0];
    re = `${r.nombre} v${r.version} se aprobó sobre ${anioEnCurso} real antes de 0.14.0 y este GM tuvo Niño en ${anioEnCurso} (${pct1(r.correccion_pct)}): reapruébalo.`;
  } else if (reaprobar.length > 1) {
    re = `Se aprobaron sobre ${anioEnCurso} real, antes de 0.14.0, ${reaprobar.length} crecimientos de GM con Niño en ${anioEnCurso} (${reaprobar.map((r) => `${r.nombre} v${r.version} ${pct1(r.correccion_pct)}`).join(", ")}): reapruébalos.`;
  }
  return [falta, re].filter((x): x is string => x !== null).join(" ");
}

/**
 * `0.14.0` (06e D5, D7, R16): lo que impide cerrar por el Niño, calculado fuera (`desactualizado.ts`, `servicio.ts`) con lo que se sabe hoy. Ninguno se puede
 * saltar con `forzar`. Todo es opcional: sin él no se comprueba.
 */
export type BloqueosNino = {
  /** `Y+1` tiene meses atípicos marcados en Curvas (D7: 2027 no es Niño). */
  anioSiguienteAtipico?: { meses: string[] } | null;
  /** Temporadas con meses atípicos en `Y`, sin factor efectivo y con filas base cuyo `φ_Y` las incluye. */
  factorFaltante?: { anio: number; temporada: string }[];
  /** Factores de `Y` ya sincronizados con fórmula, cargas, meses o composición viejos (B2). */
  factorDesfasado?: { anio: number; temporada: string; motivos: string[] }[];
  /** Factores de `Y` parciales sin `ratio_aplicado` escrito sobre el cálculo de hoy (B2). */
  factorSinConfirmar?: { anio: number; temporada: string; efectivo: number | null }[];
  /** Los factores de `Y` (`invierno 2026`) que cambiaron después de calcular (el `factores_cambiados` de otro año sí se fuerza). */
  factoresCambiadosY?: string[];
  /** Alguna equivalencia con Niño cambió de agrupación después de calcular. */
  temporadaCambiada?: boolean;
};

/** Mensaje de `anio_siguiente_atipico` (D7); `accion` dice qué no se puede hacer. */
export function mensajeAnioSiguienteAtipico(anioSiguiente: number, accion: "aprobar" | "cerrar"): string {
  return accion === "aprobar"
    ? `${anioSiguiente} está marcado como año del Niño en Curvas → Periodos atípicos. Por ahora el crecimiento de ${anioSiguiente} no incluye el Niño: si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar.`
    : `${anioSiguiente} está marcado como año del Niño en Curvas → Periodos atípicos y no puedes cerrar: por ahora el crecimiento de ${anioSiguiente} no incluye el Niño. Si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo.`;
}

const nombreFactor = (f: { anio: number; temporada: string }): string => `${f.temporada} ${f.anio}`;

/**
 * Los bloqueos del cierre por el Niño, EN ESTE ORDEN (§3.3, R16): `anio_siguiente_atipico`, `factor_faltante`, `factor_desfasado`, `factor_sin_confirmar`,
 * `factores_cambiados` de `Y` y `temporada_cambiada`. Ninguno se salta con `forzar`. Pura; `cierre_bloqueado_por` de la API es esta lista y el `409` es el primero.
 */
export function bloqueosNinoDeCierre(b: BloqueosNino | undefined, anioEnCurso: number): { codigo: string; mensaje: string; detalle: Record<string, unknown> }[] {
  const salida: { codigo: string; mensaje: string; detalle: Record<string, unknown> }[] = [];
  if (!b) return salida;
  if (b.anioSiguienteAtipico) {
    salida.push({ codigo: "anio_siguiente_atipico", mensaje: mensajeAnioSiguienteAtipico(anioEnCurso + 1, "cerrar"), detalle: { meses: b.anioSiguienteAtipico.meses } });
  }
  const faltan = b.factorFaltante ?? [];
  if (faltan.length > 0) {
    const lista = faltan.map(nombreFactor);
    salida.push({
      codigo: "factor_faltante",
      mensaje:
        faltan.length === 1
          ? `Falta el factor del Niño de ${lista[0]}: sin él la base de ${anioEnCurso + 1} no se corrige. Escríbelo en Factores del Niño (1,00 si no hubo efecto) y recalcula.`
          : `Faltan los factores del Niño de ${lista.join(" y ")}: sin ellos la base de ${anioEnCurso + 1} no se corrige. Escríbelos en Factores del Niño (1,00 si no hubo efecto) y recalcula.`,
      detalle: { faltan: faltan.map((f) => ({ anio: f.anio, temporada: f.temporada })) },
    });
  }
  const desfasados = b.factorDesfasado ?? [];
  if (desfasados.length > 0) {
    salida.push({
      codigo: "factor_desfasado",
      mensaje: desfasados.map(mensajeFactorDesfasado).join(" "),
      detalle: { desfasados: desfasados.map((f) => ({ anio: f.anio, temporada: f.temporada, motivos: f.motivos })) },
    });
  }
  const sinConfirmar = b.factorSinConfirmar ?? [];
  if (sinConfirmar.length > 0) {
    salida.push({
      codigo: "factor_sin_confirmar",
      mensaje: sinConfirmar.map(mensajeFactorSinConfirmar).join(" "),
      detalle: { sin_confirmar: sinConfirmar.map((f) => ({ anio: f.anio, temporada: f.temporada, efectivo: f.efectivo })) },
    });
  }
  const cambiados = b.factoresCambiadosY ?? [];
  if (cambiados.length > 0) {
    salida.push({
      codigo: "factores_cambiados",
      mensaje: `Cambió el factor del Niño de ${cambiados.join(" y ")}, que corrige la base de ${anioEnCurso + 1}: recalcula (no se puede forzar).`,
      detalle: { factores: cambiados },
    });
  }
  if (b.temporadaCambiada) {
    salida.push({ codigo: "temporada_cambiada", mensaje: "Cambió la agrupación de alguna línea con Niño y con ella su factor: recalcula.", detalle: {} });
  }
  return salida;
}

export type ResultadoCerrar =
  | { ok: true; cola_larga: number }
  | {
      ok: false;
      rechazo: RechazoRegla;
      /** `0.12.1`: solo con el motivo `crecimientos_sin_aprobar` (el `detalle` del `409`); `0.14.0`: con `reaprobar`. */
      crecimientos_sin_aprobar?: { faltan: { clave: string; nombre: string }[]; resto_provisional: boolean; reaprobar?: ReaprobarCierreApi[] };
      /** `0.14.0` (06e): el `detalle` del `409` de los motivos del Niño (`factor_faltante`, `factor_desfasado`…). */
      detalle?: Record<string, unknown>;
      /** Las `MAX_FILAS_SIN_DECIDIR_LISTADAS` de mayor propuesta; el total va en `total_filas_sin_decidir`. */
      filas_sin_decidir?: FilaSinDecidir[];
      total_filas_sin_decidir?: number;
      /** `0.10.1`: cuántas de las sin decidir son para revisión por cola larga. */
      total_filas_para_revision?: number;
      tiendas_sin_decidir?: { tienda_id: string; anio: number }[];
    };

/**
 * Regla 37. Bloquea si queda sin decidir, en cualquiera de los dos años, una fila base con `propuesto ≥ umbral` o con
 * `revision_cola_larga` (`0.10.1`) o una tienda nueva con venta esperada; una proyección desactualizada se cierra solo con `forzar`. La cola larga se cierra con
 * la propuesta y queda `cola_larga` en `avisos`.
 */
export function motivoRechazoCerrar(args: {
  estado: EstadoProyeccion;
  calculandoDesde: string | null;
  ahora: string;
  anioEnCurso: number;
  filasBase: readonly { clave: string; anios: Record<number, FilaParaCerrar | undefined> }[];
  tiendas: readonly { tienda_id: string; anio: number; venta_esperada: number | null; decidido: number | null }[];
  desactualizada: boolean;
  forzar: boolean;
  umbralColaLarga?: number;
  /**
   * `true` si la proyección se calculó con un método anterior (`resumen.version_metodo` falta o es menor que `VERSION_METODO`): sus
   * cifras no son las del método vigente y NO se cierra, ni siquiera con `forzar` (que solo salta datos nuevos).
   */
  metodoViejo?: boolean;
  /**
   * `0.10.8` (07c): la matriz de crecimientos guardada no es la que aplicó el último cálculo, o un nodo cambió de mundo
   * (`crecimientos_cambiados`). Como `metodoViejo`, NO se puede saltar con `forzar`.
   */
  crecimientosCambiados?: boolean;
  /**
   * `0.12.1` (06d §3.1): GM de HOMBRE o MUJER con filas base sin crecimiento aprobado, o el Resto provisional cuando se exige. `null`/ausente = nada
   * falta. BLOQUEA SIN EXCEPCIÓN (decisión de Javier): `forzar` no lo salta. Va después de `version_metodo` y `crecimientos_cambiados`.
   */
  crecimientosSinAprobar?: SinAprobarCierre | null;
  /**
   * `0.14.0` (06e D5, D7, R16): lo que impide cerrar por el Niño (2027 marcado, factor de `Y` faltante, desfasado o sin confirmar, factor de `Y` o
   * temporada cambiados). Va después de `crecimientos_cambiados` y antes de `crecimientos_sin_aprobar`; NO se puede saltar con `forzar`.
   */
  bloqueosNino?: BloqueosNino;
}): ResultadoCerrar {
  if (args.estado === "cerrada") return { ok: false, rechazo: { status: 409, codigo: "ya_cerrada", mensaje: "La proyección ya está cerrada." } };
  if (args.estado === "archivada") return { ok: false, rechazo: { status: 409, codigo: "archivada", mensaje: MENSAJE_ARCHIVADA } };
  if (calculoEnCurso(args.calculandoDesde, args.ahora)) {
    return { ok: false, rechazo: { status: 409, codigo: "calculo_en_curso", mensaje: MENSAJE_CALCULO_EN_CURSO_PROYECCION } };
  }
  if (args.metodoViejo) {
    return {
      ok: false,
      rechazo: {
        status: 409,
        codigo: "version_metodo",
        mensaje: "La proyección se calculó con una versión anterior del método: recalcúlala antes de cerrar (esto no se puede forzar).",
      },
    };
  }
  if (args.crecimientosCambiados) {
    return {
      ok: false,
      rechazo: {
        status: 409,
        codigo: "crecimientos_cambiados",
        mensaje: "Cambiaron los crecimientos por género · mundo o el mundo de un nodo: recalcula antes de cerrar (no se puede forzar).",
      },
    };
  }
  const nino = bloqueosNinoDeCierre(args.bloqueosNino, args.anioEnCurso)[0];
  if (nino) return { ok: false, rechazo: { status: 409, codigo: nino.codigo, mensaje: nino.mensaje }, detalle: nino.detalle };
  const sin = args.crecimientosSinAprobar;
  if (sin && (sin.faltan.length > 0 || sin.resto_provisional || (sin.reaprobar?.length ?? 0) > 0)) {
    return {
      ok: false,
      rechazo: { status: 409, codigo: "crecimientos_sin_aprobar", mensaje: mensajeSinAprobar(sin) },
      crecimientos_sin_aprobar: { faltan: sin.faltan, resto_provisional: sin.resto_provisional, ...(sin.reaprobar !== undefined ? { reaprobar: sin.reaprobar } : {}) },
    };
  }
  const umbral = args.umbralColaLarga ?? UMBRAL_COLA_LARGA;

  const sinDecidir: FilaSinDecidir[] = [];
  let colaLarga = 0;
  for (const f of args.filasBase) {
    for (const anio of [args.anioEnCurso, args.anioEnCurso + 1]) {
      const r = f.anios[anio];
      if (!r || r.decidido !== null) continue;
      const revision = r.avisos?.includes("revision_cola_larga") === true;
      if (r.propuesto !== null && revision) sinDecidir.push({ clave: f.clave, anio, propuesto: r.propuesto, motivo: "revision_cola_larga" });
      else if (r.propuesto !== null && r.propuesto >= umbral) sinDecidir.push({ clave: f.clave, anio, propuesto: r.propuesto, motivo: "umbral" });
      else colaLarga += 1;
    }
  }
  if (sinDecidir.length > 0) {
    const orden = (a: FilaSinDecidir, b: FilaSinDecidir) => b.propuesto - a.propuesto || a.clave.localeCompare(b.clave) || a.anio - b.anio;
    // Las de mayor propuesta de cada motivo (las de revisión tienen propuesta baja y no deben quedar fuera de la lista).
    const porUmbral = sinDecidir.filter((f) => f.motivo === "umbral").sort(orden);
    const porRevision = sinDecidir.filter((f) => f.motivo === "revision_cola_larga").sort(orden);
    const n = sinDecidir.length;
    const detalle =
      porRevision.length === 0
        ? `propuesta de ${umbral} unidades o más`
        : porUmbral.length === 0
          ? "cola larga con quiebres de stock, para revisión"
          : `${porUmbral.length} con propuesta de ${umbral} unidades o más y ${porRevision.length} de cola larga con quiebres de stock, para revisión`;
    return {
      ok: false,
      rechazo: { status: 409, codigo: "filas_sin_decidir", mensaje: `Faltan ${n} ${n === 1 ? "fila" : "filas"} por decidir (${detalle}).` },
      filas_sin_decidir: [...porUmbral.slice(0, MAX_FILAS_SIN_DECIDIR_LISTADAS), ...porRevision.slice(0, MAX_FILAS_SIN_DECIDIR_LISTADAS)],
      total_filas_sin_decidir: n,
      total_filas_para_revision: porRevision.length,
    };
  }
  const tiendasSin = args.tiendas.filter((t) => t.venta_esperada !== null && t.decidido === null).map((t) => ({ tienda_id: t.tienda_id, anio: t.anio }));
  if (tiendasSin.length > 0) {
    return {
      ok: false,
      rechazo: { status: 409, codigo: "tiendas_sin_decidir", mensaje: `Faltan ${tiendasSin.length} ${tiendasSin.length === 1 ? "tienda nueva" : "tiendas nuevas"} por decidir.` },
      tiendas_sin_decidir: tiendasSin,
    };
  }
  if (args.desactualizada && !args.forzar) {
    return { ok: false, rechazo: { status: 409, codigo: "desactualizada", mensaje: "La proyección está desactualizada: recalcula, o ciérrala igual con «Cerrar de todos modos»." } };
  }
  return { ok: true, cola_larga: colaLarga };
}

/** Regla 38. Solo se elimina una proyección `en_trabajo` sin ninguna decisión; si no, se archiva. */
export function puedeEliminar(args: { estado: EstadoProyeccion; hayDecisiones: boolean }): RechazoRegla | null {
  if (args.estado !== "en_trabajo") return { status: 409, codigo: "no_eliminable", mensaje: "Solo se elimina una proyección en trabajo: archívala." };
  if (args.hayDecisiones) return { status: 409, codigo: "con_decisiones", mensaje: "La proyección tiene decisiones: no se elimina, archívala." };
  return null;
}

/** Regla 42. Aplicar la curva nueva sobre una cerrada es `409`: una cerrada nunca se vuelve a repartir. */
export function motivoRechazoAplicarCurva(args: { estado: EstadoProyeccion; calculandoDesde: string | null; ahora: string }): RechazoRegla | null {
  return motivoRechazoEdicion(args);
}

/** Primer día del mes (`aaaa-mm-01`) de `aaaa-mm`. */
export const periodoADate = (periodo: string): string => `${periodo.slice(0, 7)}-01`;

/** `hasta_periodo` solo puede retroceder dentro del año en curso, nunca superar el último mes cerrado. */
export function motivoRechazoHasta(hasta: string, anioEnCurso: number, ultimoCerrado: string | null): string | null {
  const p = hasta.slice(0, 7);
  if (Number(p.slice(0, 4)) !== anioEnCurso) return `«Datos hasta» debe ser un mes de ${anioEnCurso}.`;
  if (ultimoCerrado !== null && p > ultimoCerrado) return `«Datos hasta» no puede pasar del último mes cerrado (${ultimoCerrado}).`;
  return null;
}

/**
 * I7. Las tandas de `venta_proyeccion` deben leer el mismo estado de los datos: si el `cargas` de alguna tanda difiere
 * del de la primera (se publicó un mes a mitad del cálculo), `calcular` aborta con `409 datos_cambiaron`.
 */
export function cargasIguales(tandas: readonly Readonly<Record<string, string>>[]): boolean {
  if (tandas.length <= 1) return true;
  const referencia = JSON.stringify(Object.entries(tandas[0]).sort(([a], [b]) => a.localeCompare(b)));
  return tandas.every((t) => JSON.stringify(Object.entries(t).sort(([a], [b]) => a.localeCompare(b))) === referencia);
}

// ─── Factor del Niño relativo a partir del bloque `periodo` de M6 (06e §5.2) ───

const redondear4 = (x: number): number => Math.round((x + Number.EPSILON * Math.sign(x)) * 1e4) / 1e4;

/** `numeric(6,4)` con `check > 0`: un ratio nulo, cero, negativo o que no cabe (≥ 100) se guarda como `null` (solo es un dato para mostrar). */
export function ratioGuardable(x: number | null | undefined): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const r = redondear4(x);
  return r > 0 && r < 100 ? r : null;
}

/** Lo que `sincronizarFactores` escribe de un factor del Niño a partir del bloque `periodo` de `efectoAtipicoCorrida` (`ρ_P`, `κ_P`, `ρ_P ÷ κ_P`, el diagnóstico mes a mes). */
export type FactorDePeriodo = {
  /** `round4(ρ_P ÷ κ_P)` con al menos `MIN_MESES_FACTOR` meses del periodo con dato; si no, `null` (lo escribe el planner). */
  ratio_calculado: number | null;
  ratio_volumen: number | null;
  ratio_control: number | null;
  /** `|P|`: meses del periodo publicados en el año y en la referencia (lo que se guarda en `meses_comparados`). */
  meses_comparados: number;
  meses_periodo_con_dato: number;
  diagnostico: DiagnosticoFactorApi | null;
};

export function factorDePeriodo(periodo: PeriodoEfectoApi | null | undefined): FactorDePeriodo {
  if (!periodo) return { ratio_calculado: null, ratio_volumen: null, ratio_control: null, meses_comparados: 0, meses_periodo_con_dato: 0, diagnostico: null };
  const suficiente = periodo.relativo !== null && periodo.meses_periodo_con_dato >= MIN_MESES_FACTOR;
  return {
    ratio_calculado: suficiente ? ratioGuardable(periodo.relativo) : null,
    ratio_volumen: ratioGuardable(periodo.ratio_volumen),
    ratio_control: ratioGuardable(periodo.ratio_control),
    meses_comparados: periodo.meses.filter((m) => m.en_periodo).length,
    meses_periodo_con_dato: periodo.meses_periodo_con_dato,
    diagnostico: {
      meses: periodo.meses.map((m) => ({ ...m })),
      ratio_fuera: periodo.ratio_fuera,
      meses_periodo: periodo.meses_periodo,
      meses_periodo_con_dato: periodo.meses_periodo_con_dato,
    },
  };
}

export { FORMULA_FACTOR_RELATIVO };
