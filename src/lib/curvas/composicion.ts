import { recortarPeriodo } from "@/lib/ventas/periodo";
import { MESES_ANIO, clasificarAnio, participacion, sumar } from "./anios";
import { eat as calcularEat } from "./backtesting";
import { curvaA } from "./candidatas";
import { ruidoNormalAgrupacion, type EntradaCorrida } from "./modelo";
import { tiendasQueEntran } from "./red";
import type {
  AgrupacionResultado,
  AvisoGml,
  ClaseAnioCurva,
  ComposicionAgrupacionApi,
  EquivalenciaComposicionApi,
  GmlAnioComposicionApi,
  GmlComposicionApi,
  ParametrosCurvas,
  RedAnio,
} from "./tipos-api";

/**
 * Composición de una agrupación (docs/modulos/06c-curvas-composicion-y-curva-usuario.md, "Composición
 * medida sobre la red comparable" y reglas 61 a 65). Funciones puras: sin base, sin HTTP, sin React.
 *
 * La lectura de la base (`venta_composicion_agrupacion`) trae unidades por GML × mes y por equivalencia
 * × año sobre la MISMA red comparable de cada año que usó el cálculo, así que los pesos y las curvas de
 * los GML suman exactamente la serie de la agrupación. De ahí salen, por GML y año: unidades, peso (con
 * signo), participación mensual, su EAT frente al RESTO de la agrupación, y si "se aparta".
 */

// ─── Lectura de la base ───

export type FilaNodo = { gml_id: string; periodo: string; unidades: number };
export type FilaEquivalenciaAnio = { equivalencia_id: string; gml_id: string; anio: number; unidades: number };
export type FilaOtras = { gml_id: string; agrupacion_id: string; anio: number; unidades: number };

/** `venta_composicion_agrupacion` ya validada: `periodo` como `aaaa-mm`. */
export type LecturaComposicion = {
  nodos: FilaNodo[];
  equivalencias: FilaEquivalenciaAnio[];
  otras: FilaOtras[];
  /** `{ "aaaa-mm": carga_id }` de las cargas publicadas, del mismo estado que la venta. */
  cargas: Record<string, string>;
};

export const MENSAJE_COMPOSICION_INVALIDA = "La composición de la agrupación llegó incompleta. Vuelve a intentarlo.";

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** `jsonb` de la función → filas tipadas; `null` si la forma no es la esperada (el handler responde 500). */
export function leerComposicion(json: unknown): LecturaComposicion | null {
  const raiz = objeto(json);
  if (!raiz || !Array.isArray(raiz.nodos) || !Array.isArray(raiz.equivalencias) || !Array.isArray(raiz.otras)) return null;
  const crudas = objeto(raiz.cargas);
  if (!crudas) return null;

  const nodos: FilaNodo[] = [];
  for (const crudo of raiz.nodos) {
    const f = objeto(crudo);
    const unidades = f ? numero(f.unidades) : null;
    if (!f || typeof f.gml_id !== "string" || typeof f.periodo !== "string" || unidades === null) return null;
    nodos.push({ gml_id: f.gml_id, periodo: recortarPeriodo(f.periodo), unidades });
  }
  const equivalencias: FilaEquivalenciaAnio[] = [];
  for (const crudo of raiz.equivalencias) {
    const f = objeto(crudo);
    const unidades = f ? numero(f.unidades) : null;
    const anio = f ? numero(f.anio) : null;
    if (!f || typeof f.equivalencia_id !== "string" || typeof f.gml_id !== "string" || unidades === null || anio === null) return null;
    equivalencias.push({ equivalencia_id: f.equivalencia_id, gml_id: f.gml_id, anio, unidades });
  }
  const otras: FilaOtras[] = [];
  for (const crudo of raiz.otras) {
    const f = objeto(crudo);
    const unidades = f ? numero(f.unidades) : null;
    const anio = f ? numero(f.anio) : null;
    if (!f || typeof f.gml_id !== "string" || typeof f.agrupacion_id !== "string" || unidades === null || anio === null) return null;
    otras.push({ gml_id: f.gml_id, agrupacion_id: f.agrupacion_id, anio, unidades });
  }
  const cargas: Record<string, string> = {};
  for (const [periodo, id] of Object.entries(crudas)) {
    if (typeof id !== "string") return null;
    cargas[recortarPeriodo(periodo)] = id;
  }
  return { nodos, equivalencias, otras, cargas };
}

/**
 * `p_red` de la función: `{ "2024": [tienda_id, …] }` con las tiendas que ENTRAN en la red comparable de cada
 * año (`tiendasQueEntran`), ordenadas; un año sin red (`sin_red`) lleva `[]`. Lo arma SIEMPRE el servidor
 * desde `entrada.redes`: nunca viene del cliente.
 */
export function armarRedPorAnio(redes: readonly RedAnio[]): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const r of [...redes].sort((a, b) => a.anio - b.anio)) salida[String(r.anio)] = [...tiendasQueEntran(r)].sort();
  return salida;
}

// ─── Maestro (nombres y vigencia) ───

export type MaestroComposicion = {
  gml: { id: string; genero: string; mundo: string; linea: string; nivel: "GML" | "GMLE"; vigente: boolean }[];
  /** TODAS las equivalencias de la agrupación (activas o no). */
  equivalencias: { id: string; gml_id: string; nombre: string; codigo: string; es_generica: boolean; activo: boolean }[];
  agrupaciones: { id: string; nombre: string }[];
};

/** Lo que el cálculo sabe de la agrupación (o lo que se puede saber sin él). */
export type ContextoComposicion = {
  huella_calculo: string;
  /** `aaaa-mm`. */
  hasta_periodo: string;
  con_calculo: boolean;
  ruido_normal: number | null;
  umbral_forma: number;
  min_unidades: number;
  /** Un elemento por año de la corrida (clase y ajuste solo con cálculo). */
  anios: { anio: number; clase: ClaseAnioCurva; en_ajuste: boolean; unidades: number }[];
};

/**
 * Los años y parámetros de la composición a partir de un trabajo ya preparado. Con `resultado` (el modelo
 * corrió) salen de él; sin él (algún prerrequisito bloquea el cálculo, por ejemplo faltan los periodos del
 * Niño) se clasifican con `clasificarAnio` y ningún año está `en_ajuste`.
 */
export function contextoComposicion(p: {
  entrada: EntradaCorrida;
  resultado: AgrupacionResultado | null;
  agrupacion_id: string;
  parametros: Pick<ParametrosCurvas, "umbral_forma" | "min_unidades_ano" | "max_meses_hueco">;
  huella_calculo: string;
}): ContextoComposicion {
  const entrada = p.entrada.agrupaciones.find((a) => a.agrupacion_id === p.agrupacion_id) ?? null;
  const anios: ContextoComposicion["anios"] = p.resultado
    ? p.resultado.anios.map((a) => ({ anio: a.anio, clase: a.clase, en_ajuste: a.en_ajuste, unidades: a.unidades }))
    : (entrada?.unidades ?? []).map((s) => ({
        anio: s.anio,
        clase: clasificarAnio(s.anio, p.entrada.meses_publicados, entrada?.atipicos ?? [], p.parametros.max_meses_hueco, p.entrada.hasta_periodo).clase,
        en_ajuste: false,
        unidades: sumar(s.meses),
      }));
  return {
    huella_calculo: p.huella_calculo,
    hasta_periodo: p.entrada.hasta_periodo,
    con_calculo: p.resultado !== null,
    ruido_normal: p.resultado?.ruido_normal ?? null,
    umbral_forma: p.parametros.umbral_forma,
    min_unidades: p.parametros.min_unidades_ano,
    anios,
  };
}

// ─── Principales ───

export const PCT_PRINCIPALES = 0.85;
export const MAX_PRINCIPALES = 12;

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Los GML principales: ordenados por unidades (mayor primero; empate por nombre), los primeros hasta cubrir
 * `pct` de las unidades positivas o hasta `max`, lo que ocurra antes. Con `max` GML o menos, todos. Devuelve
 * los ids en ese orden.
 */
export function principales(
  gml: readonly { id: string; nombre: string; unidades: number }[],
  pct: number = PCT_PRINCIPALES,
  max: number = MAX_PRINCIPALES
): string[] {
  const orden = [...gml].sort((a, b) => b.unidades - a.unidades || collator.compare(a.nombre, b.nombre) || (a.id < b.id ? -1 : 1));
  if (orden.length <= max) return orden.map((g) => g.id);
  const total = sumar(orden.map((g) => Math.max(0, g.unidades)));
  const elegidos: string[] = [];
  let acumulado = 0;
  for (const g of orden) {
    if (elegidos.length >= max) break;
    if (total > 0 && acumulado / total >= pct) break;
    elegidos.push(g.id);
    acumulado += Math.max(0, g.unidades);
  }
  return elegidos;
}

// ─── Armado ───

const CLASES_COMPLETAS: readonly ClaseAnioCurva[] = ["normal", "con_huecos", "atipico_completo"];

type MesesPorAnio = Map<number, number[]>;

const ceros = () => Array.from({ length: MESES_ANIO }, () => 0);
const truncar = (v: readonly number[]) => v.map((x) => Math.max(0, x));

function ordenarEquivalencias<T extends { nombre: string; es_generica: boolean }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => (a.es_generica === b.es_generica ? collator.compare(a.nombre, b.nombre) : a.es_generica ? 1 : -1));
}

/**
 * Regla 62 a 64. GML × año: unidades, peso con signo (sobre la suma de los GML del año), participación
 * (los meses negativos se truncan a 0 y con total ≤ 0 es `null`), EAT frente al RESTO de la agrupación
 * (la serie de los demás GML mes a mes, truncada a 0 y renormalizada), `distinta` (`eat_vs_resto >
 * max(umbral_forma, ruido_normal, ruido propio)`, solo en años válidos y con cálculo) y `se_aparta`
 * (`distinta` en TODOS sus años válidos y al menos uno; `false` sin años válidos; `null` sin cálculo). Más
 * la curva del GML (`curvaA` de sus años válidos), su ruido propio, los principales (85 % o 12) y la
 * venta del GML en otras agrupaciones (último año de ajuste).
 */
export function armarComposicion(lectura: LecturaComposicion, maestro: MaestroComposicion, ctx: ContextoComposicion): Omit<ComposicionAgrupacionApi, "duracion_ms"> {
  const anios = [...ctx.anios].sort((a, b) => a.anio - b.anio);
  const aniosNum = anios.map((a) => a.anio);

  // GML relevantes: los de las equivalencias de la agrupación y los que aparecen en la lectura.
  const idsGml = new Set<string>();
  for (const e of maestro.equivalencias) idsGml.add(e.gml_id);
  for (const n of lectura.nodos) idsGml.add(n.gml_id);
  for (const e of lectura.equivalencias) idsGml.add(e.gml_id);
  const infoGml = new Map(maestro.gml.map((g) => [g.id, g]));

  // Unidades por GML, año y mes (los nodos solo traen las tiendas de la red del año y los meses ≤ hasta).
  const mesesDeGml = new Map<string, MesesPorAnio>();
  for (const id of idsGml) mesesDeGml.set(id, new Map(aniosNum.map((a) => [a, ceros()])));
  for (const n of lectura.nodos) {
    const anio = Number(n.periodo.slice(0, 4));
    const mes = Number(n.periodo.slice(5, 7)) - 1;
    const meses = mesesDeGml.get(n.gml_id)?.get(anio);
    if (meses && mes >= 0 && mes < MESES_ANIO) meses[mes] += n.unidades;
  }
  const mesesTotal = new Map<number, number[]>(aniosNum.map((a) => [a, ceros()]));
  for (const porAnio of mesesDeGml.values()) {
    for (const [anio, meses] of porAnio) {
      const total = mesesTotal.get(anio) as number[];
      for (let m = 0; m < MESES_ANIO; m++) total[m] += meses[m];
    }
  }
  const unidadesTotal = new Map<number, number>(aniosNum.map((a) => [a, sumar(mesesTotal.get(a) as number[])]));

  // Unidades por equivalencia y año.
  const unidadesEq = new Map<string, Map<number, number>>();
  for (const e of lectura.equivalencias) {
    const m = unidadesEq.get(e.equivalencia_id) ?? new Map<number, number>();
    m.set(e.anio, (m.get(e.anio) ?? 0) + e.unidades);
    unidadesEq.set(e.equivalencia_id, m);
  }
  const pesoDe = (unidades: number, anio: number) => {
    const total = unidadesTotal.get(anio) ?? 0;
    return total > 0 ? unidades / total : 0;
  };

  // Año de referencia: el último de ajuste; sin ajuste, el último completo con venta; si no, el último con venta.
  const conVenta = anios.filter((a) => (unidadesTotal.get(a.anio) ?? 0) > 0);
  const anioRef =
    [...anios].reverse().find((a) => a.en_ajuste)?.anio ??
    [...conVenta].reverse().find((a) => CLASES_COMPLETAS.includes(a.clase))?.anio ??
    conVenta[conVenta.length - 1]?.anio ??
    anios[anios.length - 1]?.anio ??
    null;

  // Venta en otras agrupaciones (último año de referencia), por GML y agrupación.
  const nombreAgrupacion = new Map(maestro.agrupaciones.map((a) => [a.id, a.nombre]));
  const fueraPorGml = new Map<string, Map<string, number>>();
  for (const o of lectura.otras) {
    if (anioRef === null || o.anio !== anioRef) continue;
    const m = fueraPorGml.get(o.gml_id) ?? new Map<string, number>();
    m.set(o.agrupacion_id, (m.get(o.agrupacion_id) ?? 0) + o.unidades);
    fueraPorGml.set(o.gml_id, m);
  }

  const umbralBase = Math.max(ctx.umbral_forma, ctx.ruido_normal ?? 0);
  const salida: GmlComposicionApi[] = [];
  for (const id of idsGml) {
    const info = infoGml.get(id);
    const meses = mesesDeGml.get(id) as MesesPorAnio;

    const porAnio: GmlAnioComposicionApi[] = anios.map((a) => {
      const m = meses.get(a.anio) as number[];
      const unidades = sumar(m);
      const valido = a.en_ajuste && unidades >= ctx.min_unidades;
      const p = unidades > 0 ? participacion(truncar(m)) : null;
      let restoP: number[] | null = null;
      if (p) {
        const total = mesesTotal.get(a.anio) as number[];
        restoP = participacion(truncar(total.map((t, k) => t - m[k])));
      }
      return {
        anio: a.anio,
        clase: a.clase,
        en_ajuste: a.en_ajuste,
        valido,
        unidades,
        peso: pesoDe(unidades, a.anio),
        participacion: p,
        eat_vs_resto: ctx.con_calculo && p && restoP ? calcularEat(p, restoP) : null,
        distinta: null,
      };
    });

    // Curva, ruido propio y umbral.
    const validos = porAnio.filter((x) => x.valido && x.participacion);
    const curva = validos.length > 0 ? curvaA(validos.map((x) => ({ anio: x.anio, participacion: x.participacion as number[], unidades_total: x.unidades, tiendas: [] }))) : null;
    const normales = validos.filter((x) => x.clase === "normal");
    const ruidoPropio = ruidoNormalAgrupacion(normales.map((x) => ({ anio: x.anio, participacion: x.participacion as number[] }))).ruido_normal;
    const umbral = ctx.con_calculo ? Math.max(umbralBase, ruidoPropio ?? 0) : null;
    if (umbral !== null) {
      for (const x of porAnio) x.distinta = x.valido && x.eat_vs_resto !== null ? x.eat_vs_resto > umbral : null;
    }
    const seAparta = !ctx.con_calculo ? null : (() => {
      const evaluados = porAnio.filter((x) => x.valido && x.eat_vs_resto !== null);
      return evaluados.length > 0 && evaluados.every((x) => x.distinta === true);
    })();

    // Equivalencias del GML en la agrupación.
    const equivalencias: EquivalenciaComposicionApi[] = ordenarEquivalencias(
      maestro.equivalencias
        .filter((e) => e.gml_id === id)
        .map((e) => ({
          id: e.id,
          nombre: e.nombre,
          codigo: e.codigo,
          es_generica: e.es_generica,
          activo: e.activo,
          por_anio: anios.map((a) => {
            const unidades = unidadesEq.get(e.id)?.get(a.anio) ?? 0;
            return { anio: a.anio, unidades, peso: pesoDe(unidades, a.anio) };
          }),
        }))
        // Las inactivas solo aparecen si tienen venta.
        .filter((e) => e.activo || e.por_anio.some((x) => x.unidades !== 0))
    );

    // Otras agrupaciones (último año de referencia).
    const dentro = anioRef === null ? 0 : (porAnio.find((x) => x.anio === anioRef)?.unidades ?? 0);
    const otras = [...(fueraPorGml.get(id) ?? new Map<string, number>())]
      .filter(([, unidades]) => unidades > 0)
      .map(([agrupacion_id, unidades]) => ({
        agrupacion_id,
        nombre: nombreAgrupacion.get(agrupacion_id) ?? agrupacion_id,
        unidades,
        pct_de_su_venta: unidades / (Math.max(0, dentro) + unidades),
      }))
      .sort((a, b) => b.unidades - a.unidades || collator.compare(a.nombre, b.nombre) || (a.agrupacion_id < b.agrupacion_id ? -1 : 1));

    // Avisos.
    const avisos: AvisoGml[] = [];
    if (seAparta === true) avisos.push("se_aparta");
    if (!ctx.con_calculo) avisos.push("sin_calculo");
    const hayVenta = porAnio.some((x) => x.unidades !== 0) || equivalencias.some((e) => e.por_anio.some((x) => x.unidades !== 0));
    if (!hayVenta) avisos.push("sin_venta");
    if (porAnio.some((x) => x.unidades < 0) || [...meses.values()].some((m) => m.some((u) => u < 0))) avisos.push("unidades_negativas");
    if (porAnio.some((x) => x.unidades > 0) && validos.length === 0 && ctx.con_calculo) avisos.push("pocas_unidades");
    if (info && !info.vigente) avisos.push("nodo_no_vigente");
    if (otras.length > 0) avisos.push("en_otras_agrupaciones");

    salida.push({
      gml_id: id,
      genero: info?.genero ?? "—",
      mundo: info?.mundo ?? "—",
      linea: info?.linea ?? id,
      nivel: info?.nivel ?? "GML",
      vigente: info?.vigente ?? true,
      principal: false,
      equivalencias,
      por_anio: porAnio,
      curva,
      anios_curva: validos.map((x) => x.anio),
      ruido_propio: ruidoPropio,
      umbral,
      se_aparta: seAparta,
      otras_agrupaciones: otras,
      avisos,
    });
  }

  // Principales por unidades del año de referencia.
  const unidadesRef = (g: GmlComposicionApi) => (anioRef === null ? 0 : (g.por_anio.find((x) => x.anio === anioRef)?.unidades ?? 0));
  const nombreGml = (g: GmlComposicionApi) => `${g.genero} · ${g.mundo} · ${g.linea}`;
  const idsPrincipales = new Set(principales(salida.map((g) => ({ id: g.gml_id, nombre: nombreGml(g), unidades: unidadesRef(g) }))));
  for (const g of salida) g.principal = idsPrincipales.has(g.gml_id);
  salida.sort((a, b) => collator.compare(a.genero, b.genero) || collator.compare(a.mundo, b.mundo) || collator.compare(a.linea, b.linea) || (a.gml_id < b.gml_id ? -1 : 1));

  const totalRef = anioRef === null ? 0 : (unidadesTotal.get(anioRef) ?? 0);
  const unidadesPrincipales = sumar(salida.filter((g) => g.principal).map((g) => Math.max(0, unidadesRef(g))));
  const activas = maestro.equivalencias.filter((e) => e.activo);
  const sumaEq = (id: string) => sumar([...(unidadesEq.get(id)?.values() ?? [])].map((u) => Math.abs(u)));
  return {
    huella_calculo: ctx.huella_calculo,
    hasta_periodo: ctx.hasta_periodo,
    con_calculo: ctx.con_calculo,
    ruido_normal: ctx.ruido_normal,
    umbral_forma: ctx.umbral_forma,
    min_unidades: ctx.min_unidades,
    anios: anios.map((a) => ({ anio: a.anio, clase: a.clase, en_ajuste: a.en_ajuste, unidades: a.unidades })),
    gml: salida,
    principales: salida.filter((g) => g.principal).length,
    otros: salida.filter((g) => !g.principal).length,
    pct_principales: totalRef > 0 ? unidadesPrincipales / totalRef : 0,
    equivalencias_activas: activas.length,
    equivalencias_inactivas_con_venta: maestro.equivalencias.filter((e) => !e.activo && sumaEq(e.id) > 0).length,
    equivalencias_sin_venta: activas.filter((e) => sumaEq(e.id) === 0).map((e) => e.id).sort(),
  };
}
