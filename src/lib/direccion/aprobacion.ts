import {
  GM_CLAVE_TOTAL,
  VERSION_HUELLA,
  type AlertaApi,
  type AprobacionApi,
  type AprobacionBreveApi,
  type CrecimientoGMApi,
  type DiferenciaAprobadaApi,
  type EstadoAprobacion,
  type FilaAprobacionSql,
  type FiltrosVistosApi,
  type PuenteApi,
  type ResumenAprobacionApi,
  type TableroProyeccionSql,
} from "./tipos-api";
import { lineaPuente } from "./puente";
import { variacionPct } from "./textos";

/**
 * Aprobación de dirección (ficha 14, §5.1 y R13 a R15). Puro. El estado se DERIVA al leer (nada se actualiza): manda siempre la aprobación más
 * reciente de la proyección; si su huella no es la actual, el estado es `invalidada` y una anterior con la huella actual no revive. «Con
 * observaciones» cuenta como aprobación vigente.
 */

/** Por qué una aprobación no vale para las cifras de hoy; `null` si vale. Un cambio de versión de la fórmula de la huella manda sobre «cambió una cifra». */
export function invalidadaPor(fila: Pick<FilaAprobacionSql, "huella" | "resumen">, huellaActual: string | null): AprobacionApi["invalidada_por"] {
  if (Number(fila.resumen?.huella_version) !== VERSION_HUELLA) return "version_huella";
  return fila.huella === huellaActual ? null : "cifras";
}

export function aAprobacionApi(fila: FilaAprobacionSql, huellaActual: string | null): AprobacionApi {
  const por = invalidadaPor(fila, huellaActual);
  return {
    id: fila.id,
    proyeccion_id: fila.proyeccion_id,
    estado_proyeccion: fila.estado_proyeccion,
    resultado: fila.resultado,
    motivo: fila.motivo,
    comentario: fila.comentario,
    usuario_nombre: fila.usuario_nombre,
    rol: "admin",
    created_at: fila.created_at,
    huella: fila.huella,
    invalidada: por !== null,
    invalidada_por: por,
    resumen: fila.resumen,
  };
}

/** De la más reciente a la más antigua (empate de instante: por `id`, para que el orden sea estable). */
export function ordenarAprobaciones<T extends { created_at: string; id: string }>(filas: readonly T[]): T[] {
  return [...filas].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export type EstadoDeProyeccion = {
  estado: EstadoAprobacion;
  /** La más reciente, solo si el estado es `aprobada` o `con_observaciones`. */
  vigente: AprobacionApi | null;
  /** La más reciente, sea cual sea su resultado y aunque esté invalidada. */
  ultima: AprobacionApi | null;
  /** De la más reciente a la más antigua. */
  historial: AprobacionApi[];
};

/**
 * Estado de dirección de UNA proyección a partir de SUS aprobaciones (las de otra proyección nunca le dan estado, aunque tengan la misma huella) y
 * de su huella de hoy.
 */
export function estadoDeProyeccion(filas: readonly FilaAprobacionSql[], huellaActual: string | null): EstadoDeProyeccion {
  const historial = ordenarAprobaciones(filas).map((f) => aAprobacionApi(f, huellaActual));
  const ultima = historial[0] ?? null;
  if (!ultima) return { estado: "sin_aprobacion", vigente: null, ultima: null, historial };
  if (ultima.invalidada) return { estado: "invalidada", vigente: null, ultima, historial };
  return { estado: ultima.resultado, vigente: ultima.resultado === "rechazada" ? null : ultima, ultima, historial };
}

/** Estado con solo la huella y el resultado de la más reciente (para listar muchas proyecciones sin leer sus `resumen`). */
export function estadoBreve(ultima: { huella: string; resultado: FilaAprobacionSql["resultado"] } | null, huellaActual: string | null): EstadoAprobacion {
  if (!ultima) return "sin_aprobacion";
  return ultima.huella === huellaActual ? ultima.resultado : "invalidada";
}

export const aBreve = (a: AprobacionApi | null): AprobacionBreveApi | null =>
  a ? { resultado: a.resultado, motivo: a.motivo, usuario_nombre: a.usuario_nombre, created_at: a.created_at } : null;

// ─── Foto de lo aprobado (`resumen`) ───

type PorBloque = ResumenAprobacionApi["totales"][number]["por_bloque"];

function totalDeAnio(anio: TableroProyeccionSql["anios"][number]): { total: number; por_bloque: PorBloque } {
  const por: PorBloque = { mismas: anio.base.vigente, nuevas_anterior: 0, aperturas: 0, cierres: 0 };
  for (const t of anio.tiendas) {
    if (t.bloque === "cierres") por.cierres += t.vigente;
    else if (t.subbloque === "nuevas_anterior") por.nuevas_anterior += t.vigente;
    else por.aperturas += t.vigente;
  }
  return { total: por.mismas + por.nuevas_anterior + por.aperturas + por.cierres, por_bloque: por };
}

export type EntradaResumen = {
  /** `tablero_proyeccion(id, {})`: SIN filtros (la aprobación es siempre de la proyección entera, R15). */
  doc: TableroProyeccionSql;
  hastaPeriodo: string;
  versionMetodo: number | null;
  /** `puente.por_gm` de toda la proyección (con el Total al final). */
  puentes: readonly (PuenteApi & { gm_clave: string; nombre: string })[];
  crecimientos: readonly CrecimientoGMApi[];
  /** Las alertas de alcance `proyeccion`. */
  alertas: readonly AlertaApi[];
  filtrosVistos?: FiltrosVistosApi;
};

/**
 * La foto que se guarda con la aprobación: huella, totales por año y bloque, puente total, por GM (cierre del año en curso, año siguiente, crecimiento
 * declarado e implícito en la base del declarado) y conteo de alertas por código. No depende de los filtros salvo `filtros_vistos`, que es informativo.
 */
export function armarResumen(e: EntradaResumen): ResumenAprobacionApi {
  const total = e.puentes.find((p) => p.gm_clave === GM_CLAVE_TOTAL);
  const conteo = new Map<string, { codigo: string; nivel: string; cantidad: number }>();
  for (const a of e.alertas) {
    const clave = `${a.codigo}|${a.nivel}`;
    const x = conteo.get(clave) ?? { codigo: a.codigo, nivel: a.nivel, cantidad: 0 };
    x.cantidad += 1;
    conteo.set(clave, x);
  }
  const implicitoDe = (c: CrecimientoGMApi | undefined): number | null =>
    !c ? null : c.sobre_base === "bruta" ? c.implicito_sobre_real_pct : (c.implicito_sobre_corregida_pct ?? c.implicito_sobre_real_pct);
  return {
    huella: e.doc.huella,
    huella_version: VERSION_HUELLA,
    hasta_periodo: e.hastaPeriodo,
    version_metodo: e.versionMetodo,
    totales: e.doc.anios.map((a) => ({ anio: a.anio, ...totalDeAnio(a) })),
    // Sin los textos de ayuda: la foto guarda cifras, no rótulos largos.
    puente: total
      ? { lineas: total.lineas.map((l) => ({ clave: l.clave, etiqueta: l.etiqueta, u: l.u, acumulado: l.acumulado, subtotal: l.subtotal })), pct: total.pct }
      : { lineas: [], pct: { base_sobre_real: null, nino: null, crecimiento: null, manual: null, otras: null, total_vs_cierre: null } },
    por_gm: e.puentes
      .filter((p) => p.gm_clave !== GM_CLAVE_TOTAL)
      .map((p) => {
        const c = e.crecimientos.find((x) => x.gm_clave === p.gm_clave);
        return {
          gm_clave: p.gm_clave,
          nombre: p.nombre,
          en_curso: lineaPuente(p, "cierre_en_curso"),
          siguiente: lineaPuente(p, "total_siguiente"),
          declarado_pct: c?.declarado_pct ?? null,
          implicito_pct: implicitoDe(c),
        };
      }),
    alertas: [...conteo.values()],
    ...(e.filtrosVistos !== undefined ? { filtros_vistos: e.filtrosVistos } : {}),
  };
}

// ─── Frente a lo aprobado (§4.6) ───

export type ActualParaDiferencia = {
  proyeccion_id: string;
  huella: string;
  anio_en_curso: number;
  /** Cierre del año en curso y total del año siguiente de la proyección mostrada. */
  en_curso: number;
  siguiente: number;
  /** Año siguiente por GM (los de la matriz y el Resto; sin el Total). */
  por_gm: readonly { gm_clave: string; nombre: string; siguiente: number }[];
};

const diferencia = (aprobado: number, actual: number) => ({ aprobado, actual, u: actual - aprobado, pct: variacionPct(actual, aprobado) });

/**
 * Diferencia de la proyección mostrada con la FOTO de la última aprobación (su `resumen`), alineada por año calendario: si la aprobada es de otro
 * año en curso, cada cifra se toma del año que corresponde (lo que no tiene, cuenta 0). Un GM presente en un solo lado cuenta 0 en el otro.
 */
export function diferenciaConAprobada(aprobada: FilaAprobacionSql, proyeccionNombre: string, actual: ActualParaDiferencia): DiferenciaAprobadaApi | null {
  if (aprobada.resultado === "rechazada") return null;
  const r = aprobada.resumen;
  const anioAprobada = r.totales?.[0]?.anio ?? aprobada.anio_en_curso;
  const totalDe = (anio: number): number => {
    const t = r.totales?.find((x) => x.anio === anio);
    if (t) return t.total;
    return 0;
  };
  const gmDe = (g: ResumenAprobacionApi["por_gm"][number], anio: number): number => (anio === anioAprobada ? g.en_curso : anio === anioAprobada + 1 ? g.siguiente : 0);
  const Y = actual.anio_en_curso;

  const claves = new Map<string, { nombre: string; aprobado: number; actual: number }>();
  for (const g of r.por_gm ?? []) claves.set(g.gm_clave, { nombre: g.nombre, aprobado: gmDe(g, Y + 1), actual: 0 });
  for (const g of actual.por_gm) {
    const x = claves.get(g.gm_clave) ?? { nombre: g.nombre, aprobado: 0, actual: 0 };
    x.actual = g.siguiente;
    x.nombre = g.nombre;
    claves.set(g.gm_clave, x);
  }
  const porGm = [...claves.entries()]
    .map(([gm_clave, x]) => ({ gm_clave, nombre: x.nombre, ...diferencia(x.aprobado, x.actual) }))
    .sort((a, b) => Math.abs(b.u) - Math.abs(a.u) || a.nombre.localeCompare(b.nombre, "es") || a.gm_clave.localeCompare(b.gm_clave));

  return {
    aprobacion_id: aprobada.id,
    proyeccion_id: aprobada.proyeccion_id,
    proyeccion_nombre: proyeccionNombre,
    misma_proyeccion: aprobada.proyeccion_id === actual.proyeccion_id,
    fecha: aprobada.created_at,
    usuario_nombre: aprobada.usuario_nombre,
    resultado: aprobada.resultado,
    identica: aprobada.huella === actual.huella,
    en_curso: diferencia(totalDe(Y), actual.en_curso),
    siguiente: diferencia(totalDe(Y + 1), actual.siguiente),
    por_gm: porGm,
  };
}
