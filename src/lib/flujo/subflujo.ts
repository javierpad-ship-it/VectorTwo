import type { Mes } from "@/lib/compras/tipos";
import { parteDeMarca, reglaIntercompany, type ReglaBase } from "@/lib/intercompany/reglas";
import { subflujoIntercompany, type MesSubflujo } from "@/lib/intercompany/subflujo";
import type { ParticipacionesFlujo } from "./filas";
import { extenderDemanda, fueraDeRango, imi, peorSenal, proyectarFila, senalMes, usaExtension, vpm, type RangoImi } from "./imi";
import { ORDEN_SENAL, type AvisoFila, type ReglaFlujoApi, type Senal } from "./tipos-api";

/**
 * Subflujos intercompany dentro de la fila del flujo (ficha 08, regla 2, 27 y 28, §0.9 y §0.2 #13–14). Pura.
 *
 * Importa `subflujoIntercompany`, `reglaIntercompany` y `parteDeMarca` de M13: NO las copia ni las mueve. La fila se proyecta como la
 * suma de componentes —el resto (`D − Σ D^B`, con el 4–8 general) y un subflujo por marca con regla vigente en `k'+1`—:
 *
 *   S_fila_m = S^resto_m + Σ_B S^B_m = S_fila_{m−1} + I_m + Σ_B R^B_m − D_m
 *   C_fila   = C^resto + Σ_B C^B          X_fila = X^resto + Σ_B X^B
 *   VPM_fila sobre la demanda COMPLETA;   imi_fila = S_fila ÷ VPM_fila
 *   fuera_de_rango_fila ⇔ el resto o algún subflujo sale de SU rango;  señal_fila = la peor de los componentes
 *
 * Sin subflujos, el único componente es la fila entera y todo queda como antes (`R = 0`).
 */

// ─── Reglas de M13 aplicadas a una fila ───

/** `ReglaFlujoApi` con el nombre de campo que usan las funciones de resolución de M13 (`ReglaBase`). */
export type ReglaFlujoBase = ReglaFlujoApi & Pick<ReglaBase, "genero_mundo_linea_id">;

export type IndiceReglas = { porGml: Map<string, ReglaFlujoBase[]> };

/** Indexa las reglas vigentes (de `leerVigentes`) por nodo; todas pasan por las funciones de M13, nunca por la tabla. */
export function indexarReglas(reglas: readonly ReglaFlujoApi[]): IndiceReglas {
  const porGml = new Map<string, ReglaFlujoBase[]>();
  for (const r of reglas) {
    const base: ReglaFlujoBase = { ...r, genero_mundo_linea_id: r.gml_id };
    const l = porGml.get(r.gml_id);
    if (l) l.push(base);
    else porGml.set(r.gml_id, [base]);
  }
  return { porGml };
}

export type ReglaDeFila = { marca_id: string; regla: ReglaFlujoApi };

/**
 * Las reglas que tocan una fila `(g, equivalencia)`: por cada marca con regla en el nodo,
 *  - `vigentes`: la regla vigente en `k'+1` (la de la equivalencia manda sobre la del GML), fija en todo el horizonte;
 *  - `cambian`: si otra regla de la marca pasa a regir antes de `H`, el primer mes del cambio (`regla_cambia_en_horizonte`);
 *  - `futuras`: marcas sin regla en `k'+1` pero con una que entra después (`regla_futura`: sin subflujo).
 */
export function reglasDeFila(
  gmlId: string,
  equivalenciaId: string | null,
  indice: IndiceReglas,
  periodos: readonly Mes[]
): { vigentes: ReglaDeFila[]; cambian: { marca_id: string; desde: Mes }[]; futuras: string[] } {
  const delNodo = indice.porGml.get(gmlId) ?? [];
  const salida = { vigentes: [] as ReglaDeFila[], cambian: [] as { marca_id: string; desde: Mes }[], futuras: [] as string[] };
  if (delNodo.length === 0 || periodos.length === 0) return salida;
  const primero = periodos[0];
  const marcas = [...new Set(delNodo.map((r) => r.marca_id))].sort();
  for (const marcaId of marcas) {
    const regla = reglaIntercompany(delNodo, marcaId, gmlId, equivalenciaId, primero);
    if (regla) {
      salida.vigentes.push({ marca_id: marcaId, regla });
      for (const m of periodos.slice(1)) {
        if (reglaIntercompany(delNodo, marcaId, gmlId, equivalenciaId, m)?.id !== regla.id) {
          salida.cambian.push({ marca_id: marcaId, desde: m });
          break;
        }
      }
    } else {
      for (const m of periodos.slice(1)) {
        if (reglaIntercompany(delNodo, marcaId, gmlId, equivalenciaId, m)) {
          salida.futuras.push(marcaId);
          break;
        }
      }
    }
  }
  return salida;
}

export type SubflujoEntrada = {
  marca_id: string;
  regla: ReglaFlujoApi;
  /** `part_B` (fracción 0–1). */
  part: number;
  /** `S^B_{k'}`: CD + tiendas activas de la marca en la fila. */
  stock_k: number;
  /** `I^B_m` del horizonte. */
  ingresos: readonly number[];
};

/**
 * Regla 2b: los subflujos de una fila. `part_B = parteDeMarca(fila, B)` (de `por_marca` si la cerrada lo trae; si no, de
 * `por_clave_flujo`); `part_B > 0` → subflujo; `part_B = 0` en toda la nodo → `intercompany_no_aplicable`; sin participaciones →
 * `sin_participaciones` (sin subflujo); regla futura o que cambia dentro del horizonte → sus avisos.
 */
export function subflujosDeFila(e: {
  gml_id: string;
  equivalencia_id: string | null;
  participaciones: ParticipacionesFlujo | null;
  /** Filas sin proyección no llevan subflujo (no tienen demanda). */
  proyectada: boolean;
  indice: IndiceReglas;
  periodos: readonly Mes[];
  /** `aplicable()` de M13 a nivel del nodo (la regla es aplicable si alguna fila del nodo tiene `part_B > 0`). */
  aplicableEnNodo: (marcaId: string) => boolean;
  stockDeMarca: (marcaId: string) => number;
  ingresosDeMarca: (marcaId: string) => readonly number[];
}): { subflujos: SubflujoEntrada[]; avisos: AvisoFila[] } {
  const { vigentes, cambian, futuras } = reglasDeFila(e.gml_id, e.equivalencia_id, e.indice, e.periodos);
  const avisos = new Set<AvisoFila>();
  const subflujos: SubflujoEntrada[] = [];
  if (!e.proyectada || (vigentes.length === 0 && futuras.length === 0)) return { subflujos, avisos: [] };

  if (e.participaciones === null) {
    avisos.add("sin_participaciones");
    return { subflujos, avisos: [...avisos] };
  }
  const participacion = { por_clave_flujo: e.participaciones.por_clave_flujo, por_marca: e.participaciones.por_marca };

  for (const { marca_id, regla } of vigentes) {
    const part = parteDeMarca(participacion, marca_id);
    if (part > 0) {
      subflujos.push({ marca_id, regla, part, stock_k: e.stockDeMarca(marca_id), ingresos: e.ingresosDeMarca(marca_id) });
      if (cambian.some((c) => c.marca_id === marca_id)) avisos.add("regla_cambia_en_horizonte");
    } else if (!e.aplicableEnNodo(marca_id)) {
      avisos.add("intercompany_no_aplicable");
    }
  }
  for (const marca_id of futuras) {
    if (parteDeMarca(participacion, marca_id) > 0) avisos.add("regla_futura");
    else if (!e.aplicableEnNodo(marca_id)) avisos.add("intercompany_no_aplicable");
  }
  return { subflujos, avisos: [...avisos] };
}

// ─── Proyección de la fila ───

/** Un mes proyectado de la fila o de uno de sus componentes (índice 0 = `k'+1`). Unidades y IMI en flotante. */
export type MesProyectado = {
  periodo: Mes;
  demanda: number;
  /** `I_m` (en un componente, su parte). */
  ingresos: number;
  /** Reposición directa esperada `R^B_m` (0 sin subflujo). */
  reposicion: number;
  stock: number;
  /** Venta promedio mensual de los doce meses siguientes (0 si no hay demanda). */
  vpm: number;
  /** Nunca negativo; `null` sin VPM. */
  imi: number | null;
  objetivo: number;
  tope: number;
  saldo: number;
  exceso: number;
  senal: Senal;
  fuera_de_rango: boolean;
  extendido: boolean;
};

export type ComponenteProyectado = {
  stock_k: number;
  vpm_k: number;
  imi_k: number | null;
  fuera_de_rango_k: boolean;
  rango: RangoImi;
  meses: MesProyectado[];
};

function mesDeComponente(periodos: readonly Mes[], m: MesSubflujo, rango: RangoImi, n: number, extender: boolean, sinDemanda: boolean): MesProyectado {
  const imiMes = imi(m.stock, m.vpm);
  return {
    periodo: periodos[m.indice],
    demanda: m.demanda,
    ingresos: m.ingresos,
    reposicion: m.reposicion_directa,
    stock: m.stock,
    vpm: m.vpm,
    imi: imiMes,
    objetivo: m.objetivo,
    tope: m.tope,
    saldo: m.compra,
    exceso: m.exceso,
    senal: senalMes({ stock: m.stock, compra: m.compra, exceso: m.exceso }, { sinDemanda }),
    fuera_de_rango: fueraDeRango(imiMes, rango),
    extendido: usaExtension(m.indice, n, extender),
  };
}

/**
 * Un componente de la fila con `subflujoIntercompany`: `parte` de la demanda completa, `pct_directo` de la regla (0 en el resto), el
 * stock y los ingresos que le tocan. La demanda llega ya EXTENDIDA doce meses más allá de `H` y se calculan solo `n` meses.
 */
function proyectarComponente(e: {
  periodos: readonly Mes[];
  demandaExtendida: readonly number[];
  n: number;
  extender: boolean;
  parte: number;
  pct_directo: number;
  stock_k: number;
  ingresos: readonly number[];
  rango: RangoImi;
}): ComponenteProyectado {
  const meses =
    e.pct_directo === 0 && e.parte === 1
      ? proyectarFila({ demanda: e.demandaExtendida, n: e.n, stock_inicial: e.stock_k, ingresos: e.ingresos, rango: e.rango })
      : subflujoIntercompany({
          demanda: e.demandaExtendida,
          parte: e.parte,
          stock_inicial: e.stock_k,
          ingresos: e.ingresos,
          regla: { imi_min: e.rango.imi_min, imi_max: e.rango.imi_max, pct_directo: e.pct_directo },
          meses: e.n,
        });
  const propia = e.demandaExtendida.map((d) => d * e.parte);
  const sinDemanda = propia.slice(0, e.n).every((d) => d === 0);
  const vpmK = vpm(propia, -1);
  const imiK = imi(e.stock_k, vpmK);
  return {
    stock_k: e.stock_k,
    vpm_k: vpmK,
    imi_k: imiK,
    fuera_de_rango_k: fueraDeRango(imiK, e.rango),
    rango: e.rango,
    meses: meses.map((m) => mesDeComponente(e.periodos, m, e.rango, e.n, e.extender, sinDemanda)),
  };
}

export type SubflujoProyectado = SubflujoEntrada & {
  componente: ComponenteProyectado;
  /** La peor señal de los primeros `n` meses de la tarjeta. */
  senal_resumen: Senal;
  /** `Σ C^B` de los primeros `n` meses de la tarjeta. */
  saldo_n_meses: number;
};

export type EntradaFilaProyeccion = {
  /** `k'+1 … H`. */
  periodos: readonly Mes[];
  /** Demanda COMPLETA de la fila en esos meses. */
  demanda: readonly number[];
  /** `flujo_parametros.extender_horizonte`. */
  extender: boolean;
  /** `S_{k'}` de la fila: CD + tiendas activas, sin negativos. */
  stock_k: number;
  /** `I_m` de la fila en esos meses. */
  ingresos: readonly number[];
  rango: RangoImi;
  subflujos: readonly SubflujoEntrada[];
  /** §0.10: se proyecta sin demanda, con IMI nulo, señal `sin_curva`, sin saldo ni exceso. */
  sin_curva: boolean;
  /** Meses de la tarjeta (para `senal_resumen` y `saldo_n_meses` de cada subflujo). */
  meses_tarjeta: number;
};

export type ProyeccionFila = {
  periodos: readonly Mes[];
  stock_k: number;
  vpm_k: number;
  imi_k: number | null;
  fuera_de_rango_k: boolean;
  /** La fila (suma de componentes, con la reposición directa). */
  meses: MesProyectado[];
  /** Resto de la fila; nulo sin subflujos. */
  resto: ComponenteProyectado | null;
  subflujos: SubflujoProyectado[];
  sin_demanda: boolean;
};

/**
 * Regla 5, 27 y 28: proyecta la fila con una sola aritmética (la de M13). Sin subflujos, el único componente es la fila; con
 * subflujos, `S`, `C`, `X`, `objetivo` y `tope` son la suma de componentes y el VPM y el IMI van sobre la demanda completa.
 */
export function proyectarFilaConSubflujos(e: EntradaFilaProyeccion): ProyeccionFila {
  const n = e.periodos.length;
  const demanda = e.sin_curva ? e.demanda.map(() => 0) : e.demanda;
  const ext = extenderDemanda(demanda, e.extender);
  const sinDemanda = demanda.every((d) => d === 0);
  const subflujosEntrada = e.sin_curva ? [] : e.subflujos;
  const sumaPart = subflujosEntrada.reduce((a, s) => a + s.part, 0);

  const subflujos: SubflujoProyectado[] = subflujosEntrada.map((s) => {
    const componente = proyectarComponente({
      periodos: e.periodos,
      demandaExtendida: ext,
      n,
      extender: e.extender,
      parte: s.part,
      pct_directo: s.regla.pct_directo,
      stock_k: s.stock_k,
      ingresos: s.ingresos,
      rango: { imi_min: s.regla.imi_min, imi_max: s.regla.imi_max },
    });
    const tarjeta = componente.meses.slice(0, e.meses_tarjeta);
    return {
      ...s,
      componente,
      senal_resumen: peorSenal(tarjeta.map((m) => m.senal)),
      saldo_n_meses: tarjeta.reduce((a, m) => a + m.saldo, 0),
    };
  });

  const stockResto = e.stock_k - subflujos.reduce((a, s) => a + s.stock_k, 0);
  const ingresosResto = e.ingresos.map((x, i) => x - subflujos.reduce((a, s) => a + (s.ingresos[i] ?? 0), 0));
  const resto = proyectarComponente({
    periodos: e.periodos,
    demandaExtendida: ext,
    n,
    extender: e.extender,
    parte: subflujos.length === 0 ? 1 : Math.max(0, 1 - sumaPart),
    pct_directo: 0,
    stock_k: subflujos.length === 0 ? e.stock_k : stockResto,
    ingresos: subflujos.length === 0 ? e.ingresos : ingresosResto,
    rango: e.rango,
  });

  const componentes = [resto, ...subflujos.map((s) => s.componente)];
  const vpmK = vpm(ext, -1);
  const meses: MesProyectado[] = e.periodos.map((periodo, i) => {
    let stock = 0;
    let saldo = 0;
    let exceso = 0;
    let reposicion = 0;
    let objetivo = 0;
    let tope = 0;
    let fuera = false;
    let peor: Senal = "sin_curva";
    for (const c of componentes) {
      const m = c.meses[i];
      stock += m.stock;
      saldo += m.saldo;
      exceso += m.exceso;
      reposicion += m.reposicion;
      objetivo += m.objetivo;
      tope += m.tope;
      fuera = fuera || m.fuera_de_rango;
      if (ORDEN_SENAL[m.senal] < ORDEN_SENAL[peor]) peor = m.senal;
    }
    const vpmMes = vpm(ext, i);
    return {
      periodo,
      demanda: demanda[i] ?? 0,
      ingresos: e.ingresos[i] ?? 0,
      reposicion,
      stock,
      vpm: e.sin_curva ? 0 : vpmMes,
      imi: e.sin_curva ? null : imi(stock, vpmMes),
      objetivo: e.sin_curva ? 0 : objetivo,
      tope: e.sin_curva ? 0 : tope,
      saldo: e.sin_curva ? 0 : saldo,
      exceso: e.sin_curva ? 0 : exceso,
      senal: e.sin_curva ? "sin_curva" : peor,
      fuera_de_rango: e.sin_curva ? false : fuera,
      extendido: usaExtension(i, n, e.extender),
    };
  });

  const imiK = imi(e.stock_k, vpmK);
  return {
    periodos: e.periodos,
    stock_k: e.stock_k,
    vpm_k: e.sin_curva ? 0 : vpmK,
    imi_k: e.sin_curva ? null : imiK,
    fuera_de_rango_k: e.sin_curva ? false : componentes.some((c) => c.fuera_de_rango_k),
    meses,
    resto: subflujos.length === 0 ? null : resto,
    subflujos,
    sin_demanda: sinDemanda,
  };
}
