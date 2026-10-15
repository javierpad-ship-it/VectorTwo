import { recortarPeriodo } from "@/lib/ventas/periodo";
import { aniosDeCorrida } from "./anios";
import { mesesAtipicos, type PeriodoParaClase } from "./atipicos";
import { eat } from "./backtesting";
import { redComparable } from "./red";
import type { MotivoObsoletaApi, ParametrosCurvas, RedAnio, ResultadoCorrida, TemporadaAgrupacion } from "./tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "./tipos";

/**
 * Obsolescencia por agrupación, con motivo (docs/modulos/06-curvas-estacionalidad.md,
 * "Curvas vivas" y reglas 24 y 25). Funciones puras: sin base, sin HTTP, sin
 * importar nada de `@supabase/*` ni de React.
 *
 * Nada se invalida solo: una curva vigente sigue vigente hasta que el planner
 * apruebe otra o la retire. `GET /api/curvas` solo MARCA como obsoleta la
 * agrupación cuyo estado actual difiere del que usó la corrida de la curva.
 */

/** Lo que guarda la curva (y su corrida) del momento en que se calculó. */
export type EstadoGuardado = {
  /** `corrida.red_comparable`: la red de cada año de entonces. */
  red_comparable: readonly RedAnio[];
  /** `corrida.resumen.cargas`: `{ "aaaa-mm": carga_id }` de los meses usados. */
  cargas: Readonly<Record<string, string>>;
  /** Número de equivalencias activas de la agrupación al calcular (`composicion.equivalencias`). */
  equivalencias: number;
  /** `composicion.huella` de la agrupación al calcular. */
  huella_composicion: string;
  /** Meses `aaaa-mm` atípicos que aplicaban a la agrupación en la corrida (la unión de `anios[].atipicos`). */
  atipicos: readonly string[];
  /** Temporada de la agrupación en la corrida. */
  temporada: TemporadaAgrupacion;
};

/**
 * Lo que hay hoy. `red_comparable` es la red recalculada por el que llama con
 * la venta por tienda y mes, las tiendas actuales y los parámetros de la corrida
 * de la curva; `atipicos` son los meses atípicos que HOY aplican a la agrupación
 * medidos con la temporada GUARDADA (así un cambio de temporada no se cuenta dos
 * veces) y limitados a `hasta_periodo` de la corrida.
 */
export type EstadoActual = {
  red_comparable: readonly RedAnio[];
  cargas: Readonly<Record<string, string>>;
  equivalencias: number;
  huella_composicion: string;
  atipicos: readonly string[];
  temporada: TemporadaAgrupacion;
  /** Para nombrar tiendas en los motivos. */
  tiendas: ReadonlyMap<string, { codigo: string; nombre: string }>;
};

function lista(valores: readonly (string | number)[]): string {
  if (valores.length <= 1) return valores.join("");
  return `${valores.slice(0, -1).join(", ")} y ${valores[valores.length - 1]}`;
}

function motivosDeRed(guardada: readonly RedAnio[], actual: EstadoActual): MotivoObsoletaApi[] {
  const antes = new Map(guardada.map((r) => [r.anio, r]));
  const entran = new Map<string, number[]>();
  const salen = new Map<string, { anios: number[]; desactivada: boolean }>();

  for (const ahora of actual.red_comparable) {
    const previa = antes.get(ahora.anio);
    if (!previa) continue;
    const dentroAntes = new Set(previa.tiendas.filter((t) => t.entra).map((t) => t.tienda_id));
    const dentroAhora = new Set(ahora.tiendas.filter((t) => t.entra).map((t) => t.tienda_id));
    for (const id of dentroAhora) if (!dentroAntes.has(id)) entran.set(id, [...(entran.get(id) ?? []), ahora.anio]);
    for (const id of dentroAntes) {
      if (dentroAhora.has(id)) continue;
      const fila = ahora.tiendas.find((t) => t.tienda_id === id);
      const previo = salen.get(id) ?? { anios: [], desactivada: false };
      previo.anios.push(ahora.anio);
      previo.desactivada ||= !!fila?.motivos.includes("tienda_desactivada");
      salen.set(id, previo);
    }
  }

  const nombre = (id: string) => actual.tiendas.get(id)?.codigo ?? id;
  const motivos: MotivoObsoletaApi[] = [];
  for (const [id, anios] of [...entran].sort(([a], [b]) => (a < b ? -1 : 1))) {
    motivos.push({ codigo: "tienda_entra_red", detalle: `la tienda ${nombre(id)} entra en la red de ${lista(anios.sort())}` });
  }
  for (const [id, s] of [...salen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const por = s.desactivada ? " (se desactivó)" : "";
    motivos.push({ codigo: "tienda_sale_red", detalle: `la tienda ${nombre(id)} sale de la red de ${lista(s.anios.sort())}${por}` });
  }
  return motivos;
}

/**
 * Regla 24. Motivos por los que una curva está obsoleta; `[]` si nada cambió:
 *   - `tienda_entra_red` / `tienda_sale_red`: la red comparable recalculada difiere
 *     de la guardada en algún año (nombra la tienda y el año; una tienda
 *     desactivada sale con "se desactivó");
 *   - `composicion_cambiada`: la huella de equivalencias difiere (con cuántas más o menos);
 *   - `carga_nueva`: un mes publicado que la corrida no usó, o un mes republicado con otro `carga_id`;
 *   - `periodo_cambiado`: los meses atípicos que aplican hoy difieren de los de la corrida;
 *   - `temporada_cambiada`: la temporada difiere de la guardada.
 */
export function motivosObsoleta(guardado: EstadoGuardado, actual: EstadoActual): MotivoObsoletaApi[] {
  const motivos = motivosDeRed(guardado.red_comparable, actual);

  if (guardado.huella_composicion !== actual.huella_composicion) {
    const delta = actual.equivalencias - guardado.equivalencias;
    const detalle =
      delta === 0
        ? `cambió su composición (mismo número de equivalencias: ${actual.equivalencias})`
        : `cambió su composición: ${delta > 0 ? "+" : "−"}${Math.abs(delta)} equivalencias (ahora ${actual.equivalencias}, antes ${guardado.equivalencias})`;
    motivos.push({ codigo: "composicion_cambiada", detalle });
  }

  const nuevos = Object.keys(actual.cargas).filter((m) => !(m in guardado.cargas)).sort();
  const republicados = Object.keys(actual.cargas)
    .filter((m) => m in guardado.cargas && guardado.cargas[m] !== actual.cargas[m])
    .sort();
  if (nuevos.length > 0 || republicados.length > 0) {
    const partes: string[] = [];
    if (nuevos.length > 0) partes.push(`${nuevos.length === 1 ? "mes publicado" : "meses publicados"} después: ${lista(nuevos)}`);
    if (republicados.length > 0) partes.push(`${republicados.length === 1 ? "mes republicado" : "meses republicados"}: ${lista(republicados)}`);
    motivos.push({ codigo: "carga_nueva", detalle: partes.join("; ") });
  }

  const antes = new Set(guardado.atipicos);
  const ahora = new Set(actual.atipicos);
  const entran = [...ahora].filter((m) => !antes.has(m)).sort();
  const salen = [...antes].filter((m) => !ahora.has(m)).sort();
  if (entran.length > 0 || salen.length > 0) {
    const partes: string[] = [];
    if (entran.length > 0) partes.push(`entran como atípicos: ${lista(entran)}`);
    if (salen.length > 0) partes.push(`dejan de serlo: ${lista(salen)}`);
    motivos.push({ codigo: "periodo_cambiado", detalle: `cambió un periodo atípico (${partes.join("; ")})` });
  }

  if (guardado.temporada !== actual.temporada) {
    motivos.push({ codigo: "temporada_cambiada", detalle: `la temporada pasó de ${guardado.temporada} a ${actual.temporada}` });
  }
  return motivos;
}

// ─── Regla 25: comparar propuesta y vigente ───

/** EAT entre dos curvas (puntos); dos curvas iguales dan 0. */
export function eatEntreCurvas(a: readonly number[], b: readonly number[]): number {
  return eat(a, b);
}

export const UMBRAL_DIFERENCIA_CURVA = 0.005;
export const UMBRAL_DIFERENCIA_EAT = 0.5;

/**
 * Regla 25. La propuesta difiere de la vigente si el modelo es distinto, o algún
 * mes cambia más de 0,005 (medio punto), o la EAT cambia en más de 0,5 puntos.
 */
export function difiereDeVigente(
  propuesta: { modelo: string; curva: readonly number[]; eat: number | null },
  vigente: { modelo: string; curva: readonly number[]; eat: number | null }
): boolean {
  if (propuesta.modelo !== vigente.modelo) return true;
  for (let m = 0; m < 12; m++) {
    if (Math.abs((propuesta.curva[m] ?? 0) - (vigente.curva[m] ?? 0)) > UMBRAL_DIFERENCIA_CURVA) return true;
  }
  if (propuesta.eat !== null && vigente.eat !== null && Math.abs(propuesta.eat - vigente.eat) > UMBRAL_DIFERENCIA_EAT) return true;
  return false;
}

// ─── Evaluación de varias curvas contra el estado actual ───

/** Lo que `GET /api/curvas` sabe de una curva vigente. */
export type CurvaParaObsolescencia = {
  agrupacion_id: string;
  corrida_id: string;
  /** `anios_utilizados.composicion`. */
  composicion: { equivalencias: number; huella: string } | null;
};

/** La corrida de la que salió una curva. */
export type CorridaParaObsolescencia = {
  id: string;
  /** `aaaa-mm`. */
  hasta_periodo: string;
  parametros: ParametrosCurvas;
  red_comparable: readonly RedAnio[];
  /** `resumen.cargas`. */
  cargas: Readonly<Record<string, string>>;
  resultado: Pick<ResultadoCorrida, "agrupaciones">;
};

export type EstadoGlobalActual = {
  tiendas: readonly TiendaMaestro[];
  /** Venta total por tienda y mes. */
  venta: readonly VentaTiendaMes[];
  /** `{ "aaaa-mm": carga_id }` de TODOS los meses publicados hoy. */
  cargas: Readonly<Record<string, string>>;
  /** Periodos atípicos ACTIVOS. */
  periodos: readonly PeriodoParaClase[];
  /** Estado actual de cada agrupación. */
  agrupaciones: ReadonlyMap<string, { temporada: TemporadaAgrupacion; equivalencias: number; huella: string }>;
  /** Último mes que entraría hoy en una corrida (`hastaPorDefecto`); `null` si no hay. */
  hasta_actual: string | null;
};

/**
 * Motivos de obsolescencia de cada curva (`Map` por agrupación; vacío = al día).
 * Recalcula la red comparable UNA vez por corrida, con los parámetros de esa
 * corrida y el maestro de tiendas y la venta de hoy, y la compara con la que
 * guardó. Una curva cuya corrida no se encuentra no se puede evaluar: sin motivos.
 */
export function evaluarObsolescencia(
  curvas: readonly CurvaParaObsolescencia[],
  corridas: ReadonlyMap<string, CorridaParaObsolescencia>,
  actual: EstadoGlobalActual
): Map<string, MotivoObsoletaApi[]> {
  const publicados = Object.keys(actual.cargas).map(recortarPeriodo).sort();
  const redes = new Map<string, RedAnio[]>();
  const tiendasPorId = new Map(actual.tiendas.map((t) => [t.id, { codigo: t.codigo, nombre: t.nombre }]));
  const salida = new Map<string, MotivoObsoletaApi[]>();

  for (const curva of curvas) {
    const corrida = corridas.get(curva.corrida_id);
    const hoy = actual.agrupaciones.get(curva.agrupacion_id);
    if (!corrida || !hoy) continue;
    const guardada = corrida.resultado.agrupaciones.find((a) => a.agrupacion_id === curva.agrupacion_id);

    let red = redes.get(corrida.id);
    if (!red) {
      const hasta = actual.hasta_actual && actual.hasta_actual > corrida.hasta_periodo ? actual.hasta_actual : corrida.hasta_periodo;
      const meses = publicados.filter((m) => m <= hasta);
      red = redComparable(actual.tiendas, actual.venta, aniosDeCorrida(meses, hasta), hasta, corrida.parametros, { mesesPublicados: meses });
      redes.set(corrida.id, red);
    }

    const temporadaGuardada = guardada?.temporada ?? hoy.temporada;
    const atipicosGuardados = [...new Set((guardada?.anios ?? []).flatMap((a) => a.atipicos))].sort();
    const atipicosHoy = [...mesesAtipicos(actual.periodos, { temporada: temporadaGuardada })]
      .filter((m) => m <= recortarPeriodo(corrida.hasta_periodo))
      .sort();

    salida.set(
      curva.agrupacion_id,
      motivosObsoleta(
        {
          red_comparable: corrida.red_comparable,
          cargas: corrida.cargas,
          equivalencias: curva.composicion?.equivalencias ?? guardada?.composicion.equivalencias ?? hoy.equivalencias,
          huella_composicion: curva.composicion?.huella ?? guardada?.composicion.huella ?? hoy.huella,
          atipicos: atipicosGuardados,
          temporada: temporadaGuardada,
        },
        {
          red_comparable: red,
          cargas: actual.cargas,
          equivalencias: hoy.equivalencias,
          huella_composicion: hoy.huella,
          atipicos: atipicosHoy,
          temporada: hoy.temporada,
          tiendas: tiendasPorId,
        }
      )
    );
  }
  return salida;
}
