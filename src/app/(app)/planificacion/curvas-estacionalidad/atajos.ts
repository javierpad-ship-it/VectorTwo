import { TEMPORADAS_AGRUPACION, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { esPeriodoValido, recortarPeriodo } from "@/lib/ventas/periodo";

/**
 * Atajos del formulario de periodos atípicos (M6, paso 2) y los cuatro altas
 * que Javier confirmó para El Niño costero. Puras, sin React: las prueba vitest.
 */

export type RangoMeses = { desde: string; hasta: string };

/**
 * Año sobre el que se arman los atajos de rango: el del mes «desde» si ya está
 * escrito; si no, el del último mes cargado en M5; y si tampoco se sabe, el
 * año de hoy (`anioHoy`, inyectado para poder probarla).
 */
export function anioBase(desde: string, ultimoCargado: string | null, anioHoy: number): number {
  if (esPeriodoValido(desde)) return Number(recortarPeriodo(desde).slice(0, 4));
  if (ultimoCargado !== null && esPeriodoValido(ultimoCargado)) return Number(recortarPeriodo(ultimoCargado).slice(0, 4));
  return anioHoy;
}

/** «Año completo»: enero a diciembre del año base. */
export function atajoAnioCompleto(anio: number): RangoMeses {
  return { desde: `${anio}-01`, hasta: `${anio}-12` };
}

/** «Desde setiembre»: setiembre a diciembre del año base (el verano que adelanta El Niño). */
export function atajoDesdeSetiembre(anio: number): RangoMeses {
  return { desde: `${anio}-09`, hasta: `${anio}-12` };
}

/**
 * «En curso»: el año del último mes cargado (el año que todavía se está
 * cargando), enero a diciembre: el periodo ya cubre los meses que faltan por
 * cargar y aplica a medida que se publican.
 */
export function atajoEnCurso(ultimoCargado: string | null, anioHoy: number): RangoMeses {
  const anio = ultimoCargado !== null && esPeriodoValido(ultimoCargado) ? Number(recortarPeriodo(ultimoCargado).slice(0, 4)) : anioHoy;
  return { desde: `${anio}-01`, hasta: `${anio}-12` };
}

// ─── Temporadas ───

/** El atajo «Todas»: las tres casillas marcadas. */
export const TODAS_LAS_TEMPORADAS: readonly TemporadaAgrupacion[] = TEMPORADAS_AGRUPACION;

/** Marca o desmarca una temporada; el conjunto vuelve siempre en el orden del contrato y sin repetidos. */
export function alternarTemporada(actual: readonly TemporadaAgrupacion[], t: TemporadaAgrupacion): TemporadaAgrupacion[] {
  const marcada = actual.includes(t);
  return TEMPORADAS_AGRUPACION.filter((x) => (x === t ? !marcada : actual.includes(x)));
}

/** ¿Están las tres marcadas? (el atajo «Todas» se muestra activo). */
export function sonTodas(temporadas: readonly TemporadaAgrupacion[]): boolean {
  return TEMPORADAS_AGRUPACION.every((t) => temporadas.includes(t));
}

// ─── Los cuatro altas confirmados ───

export type AltaPrellenada = {
  clave: string;
  /** Texto del botón. */
  boton: string;
  desde: string;
  hasta: string;
  motivo: string;
  descripcion: string;
  temporadas: TemporadaAgrupacion[];
};

/**
 * Niño costero 2023 y 2026 (decisión 3 de la ficha): invierno, año completo;
 * verano, setiembre a diciembre. «Marzo a mayo de 2023» fue descartado. Nada se
 * guarda hasta que el planner pulsa Crear.
 */
export const ALTAS_PRELLENADAS: readonly AltaPrellenada[] = [
  {
    clave: "2023-invierno",
    boton: "Niño 2023 · invierno",
    desde: "2023-01",
    hasta: "2023-12",
    motivo: "Niño costero 2023 · invierno",
    descripcion: "El Niño costero 2023 afectó el año completo de las agrupaciones de invierno.",
    temporadas: ["invierno"],
  },
  {
    clave: "2023-verano",
    boton: "Niño 2023 · verano",
    desde: "2023-09",
    hasta: "2023-12",
    motivo: "Niño costero 2023 · verano",
    descripcion: "El verano arrancó antes: setiembre a diciembre de 2023.",
    temporadas: ["verano"],
  },
  {
    clave: "2026-invierno",
    boton: "Niño 2026 · invierno",
    desde: "2026-01",
    hasta: "2026-12",
    motivo: "Niño costero 2026 · invierno",
    descripcion: "Año en curso: los meses sin cargar aplican cuando se publiquen.",
    temporadas: ["invierno"],
  },
  {
    clave: "2026-verano",
    boton: "Niño 2026 · verano",
    desde: "2026-09",
    hasta: "2026-12",
    motivo: "Niño costero 2026 · verano",
    descripcion: "Año en curso: setiembre a diciembre de 2026.",
    temporadas: ["verano"],
  },
];

type PeriodoExistente = { desde: string; hasta: string; temporadas: readonly TemporadaAgrupacion[] };

/** Las altas confirmadas que todavía no existen (mismo rango y mismo conjunto de temporadas; cualquier estado). */
export function altasFaltantes(periodos: readonly PeriodoExistente[]): AltaPrellenada[] {
  return ALTAS_PRELLENADAS.filter(
    (a) =>
      !periodos.some(
        (p) =>
          recortarPeriodo(p.desde) === a.desde &&
          recortarPeriodo(p.hasta) === a.hasta &&
          p.temporadas.length === a.temporadas.length &&
          a.temporadas.every((t) => p.temporadas.includes(t))
      )
  );
}
