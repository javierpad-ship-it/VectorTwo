import { CALCULO_CADUCA_MIN, MAX_TOTAL, UMBRAL_COLA_LARGA, type EstadoProyeccion } from "./tipos-api";

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
 * versión vigente y `resto_provisional` que se exige el Resto y no hay uno aprobado.
 */
export type SinAprobarCierre = { anio: number; faltan: { clave: string; nombre: string }[]; resto_provisional: boolean };

/** Mensaje de `crecimientos_sin_aprobar` («Faltan 3 crecimientos aprobados para 2027 (…) y el Resto es provisional: apruébalos en …»). */
export function mensajeSinAprobar(s: SinAprobarCierre): string {
  const donde = "apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo";
  const n = s.faltan.length;
  if (n === 0) return `El Resto de ${s.anio} es provisional: apruébalo en Curvas de estacionalidad → Crecimiento por género × mundo antes de cerrar.`;
  const lista = s.faltan.map((f) => f.nombre).join(", ");
  const falta = `Faltan ${n} ${n === 1 ? "crecimiento aprobado" : "crecimientos aprobados"} para ${s.anio} (${lista})`;
  return s.resto_provisional ? `${falta} y el Resto es provisional: ${donde}.` : `${falta}: ${n === 1 ? "apruébalo" : "apruébalos"} en Curvas de estacionalidad → Crecimiento por género × mundo.`;
}

export type ResultadoCerrar =
  | { ok: true; cola_larga: number }
  | {
      ok: false;
      rechazo: RechazoRegla;
      /** `0.12.1`: solo con el motivo `crecimientos_sin_aprobar` (el `detalle` del `409`). */
      crecimientos_sin_aprobar?: { faltan: { clave: string; nombre: string }[]; resto_provisional: boolean };
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
  const sin = args.crecimientosSinAprobar;
  if (sin && (sin.faltan.length > 0 || sin.resto_provisional)) {
    return {
      ok: false,
      rechazo: { status: 409, codigo: "crecimientos_sin_aprobar", mensaje: mensajeSinAprobar(sin) },
      crecimientos_sin_aprobar: { faltan: sin.faltan, resto_provisional: sin.resto_provisional },
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
