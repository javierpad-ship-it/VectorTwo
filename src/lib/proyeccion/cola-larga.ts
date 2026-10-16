import type { ResultadoCierre } from "./cierre";
import { repartirResto } from "./reparto";
import type { AvisoFila, ColaLargaApi, VeredictoColaLarga } from "./tipos-api";

/**
 * Cola larga con validación de disponibilidad (ficha 07, «Cambios 0.10.1», punto 2; reglas 46 y 47). Puro.
 *
 * Una fila base con `propuesto < umbral_cola_larga` se cerraba sola con la propuesta. Desde `0.10.1` se comprueba antes que la
 * venta baja no sea falta de stock. El stock de M5 es MENSUAL (no hay días con stock ni inventario bloqueado), así que la
 * disponibilidad es un PROXY: tienda-meses con stock al cierre del mes ÷ tienda-meses totales.
 *
 *   dispon_f = Σ_m tcs_m ÷ (12 × n_t)                      tcs_m = tiendas de `M(Y)` con stock > 0 al cierre de `m`
 *   ritmo_f  = Σ_m ũ_m ÷ Σ_m tcs_m                         ũ_m = unidades vendidas en ESAS tiendas, ÷ φ_{año(m),m}
 *   A_f      = Σ_m ũ_m ÷ Σ_m (c_m × tcs_m ÷ n_t)           demanda anualizada ajustada por disponibilidad y estacionalidad
 *
 * DECISIÓN DE JAVIER (ronda 4, después de la ficha; sustituye a «propuesta por avance, `A_f` al lado» y a la decisión 33 en este
 * punto): en una fila de cola larga PARA REVISIÓN (quiebres relevantes y `A_f ≥ umbral de cola larga`) la PROPUESTA del sistema es la
 * demanda corregida `A_f` y el avance normal (`V ÷ C_k`, también cuando había poco avance) va como REFERENCIA
 * (`referencia_alternativa`). El planner sigue decidiendo: la fila bloquea el cierre hasta que acepta, escribe `A_f` u otra cifra.
 * En los demás veredictos la propuesta no cambia (la de avance).
 */

/** Una fila de `disponibilidad` de `venta_proyeccion`: una fila (GML-AM) en un mes. */
export type FilaDisponibilidad = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  /** `aaaa-mm-01` (o `aaaa-mm`). */
  periodo: string;
  /** Tiendas de tipo Tienda con `1` en la posición `Y` de su clave (`|M(Y)|`). */
  tiendas_total: number;
  /** De ellas, las que cerraron el mes con stock > 0 de la fila. */
  tiendas_con_stock: number;
  /** Unidades vendidas en esas tiendas en el mes. */
  unidades_con_stock: number;
  /** Stock del CD al cierre del mes (la única lectura del CD en M7). */
  stock_cd: number;
};

export type MesDisponibilidad = Pick<FilaDisponibilidad, "periodo" | "tiendas_con_stock" | "unidades_con_stock" | "stock_cd">;

export type UmbralesColaLarga = {
  /** `umbral_cola_larga` (100 por defecto, editable). */
  cola_larga: number;
  /** `umbral_disponibilidad` (0,75 por defecto, editable). */
  disponibilidad: number;
};

export type EntradaDisponibilidad = {
  /** Las filas de la fila base y sus meses de `W12` (los de fuera de `ventana` se ignoran). */
  disponibilidad: readonly MesDisponibilidad[];
  /** Los doce periodos `aaaa-mm` de `W12`. */
  ventana: readonly string[];
  /** `c_m` de la unidad; `null` sin curva (no hay `A_f`). */
  curva: readonly number[] | null;
  /** `φ_{Z,·}` de la unidad para el año `Z`: doce valores (1 donde no hay Niño). */
  factoresMes: (anio: number) => readonly number[];
  /** `n_t = |M(Y)|`. */
  nTiendas: number;
  umbrales: UmbralesColaLarga;
};

export type ResultadoDisponibilidad = {
  /** `dispon_f` de 0 a 1; `null` si no se pudo medir (`sin_dato`). */
  dispon: number | null;
  /** `ritmo_f`: unidades por tienda-mes con stock; `null` sin dato. */
  ritmo: number | null;
  /** `A_f`; `null` sin dato o sin curva. */
  demanda_corregida: number | null;
  tienda_meses_con_stock: number;
  tienda_meses: number;
  meses_cd_con_stock: number;
  meses_tiendas_sin_stock: number;
  veredicto: VeredictoColaLarga;
};

const periodoDe = (periodo: string) => ({ anio: Number(periodo.slice(0, 4)), mes: Number(periodo.slice(5, 7)) });
const aMes = (periodo: string) => periodo.slice(0, 7);

/**
 * Regla 46. `disponibilidadFila` mide la disponibilidad de una fila base sobre `W12` y `M(Y)` y da el veredicto (regla 47):
 *   - sin una sola tienda-mes con stock (o sin tiendas) → `sin_dato` (cola larga normal, aviso `sin_stock_historico`);
 *   - `dispon ≥ umbral_disponibilidad` → `cierra` (cola larga normal);
 *   - `dispon <` umbral y `A_f <` umbral de cola larga → `cierra_con_quiebres` (se cierra sola, informativo);
 *   - `dispon <` umbral y `A_f ≥` umbral de cola larga → `revision` (bloquea el cierre hasta decidirla);
 *   - sin curva no hay `A_f`: `cierra` con la disponibilidad medida.
 */
export function disponibilidadFila(e: EntradaDisponibilidad): ResultadoDisponibilidad {
  const meses = e.ventana.length;
  const n = Math.max(0, Math.floor(e.nTiendas));
  const porMes = new Map<string, { tcs: number; unidades: number; cd: number }>();
  for (const d of e.disponibilidad) {
    const m = aMes(d.periodo);
    const previo = porMes.get(m) ?? { tcs: 0, unidades: 0, cd: 0 };
    previo.tcs += Math.max(0, d.tiendas_con_stock);
    previo.unidades += d.unidades_con_stock;
    previo.cd += d.stock_cd;
    porMes.set(m, previo);
  }

  let tcsTotal = 0;
  let unidadesNorm = 0;
  let denominador = 0;
  let mesesCd = 0;
  let mesesSinStock = 0;
  for (const periodo of e.ventana) {
    const dato = porMes.get(aMes(periodo)) ?? { tcs: 0, unidades: 0, cd: 0 };
    // Nunca más tiendas con stock que tiendas de `M(Y)` (la lectura ya lo garantiza; esto cubre un dato inconsistente).
    const tcs = Math.min(dato.tcs, n);
    const { anio, mes } = periodoDe(periodo);
    const phi = e.factoresMes(anio)[mes - 1];
    unidadesNorm += dato.unidades / (phi !== undefined && phi > 0 ? phi : 1);
    tcsTotal += tcs;
    if (tcs === 0) mesesSinStock += 1;
    if (dato.cd > 0) mesesCd += 1;
    if (e.curva) denominador += ((e.curva[mes - 1] ?? 0) * tcs) / (n > 0 ? n : 1);
  }

  const tiendaMeses = meses * n;
  const base = {
    tienda_meses_con_stock: tcsTotal,
    tienda_meses: tiendaMeses,
    meses_cd_con_stock: mesesCd,
    meses_tiendas_sin_stock: mesesSinStock,
  };
  if (n === 0 || tcsTotal === 0) return { ...base, dispon: null, ritmo: null, demanda_corregida: null, veredicto: "sin_dato" };

  const dispon = tcsTotal / tiendaMeses;
  const ritmo = unidadesNorm / tcsTotal;
  const demanda = e.curva && denominador > 0 ? unidadesNorm / denominador : null;
  let veredicto: VeredictoColaLarga;
  if (dispon >= e.umbrales.disponibilidad || demanda === null) veredicto = "cierra";
  else veredicto = demanda >= e.umbrales.cola_larga ? "revision" : "cierra_con_quiebres";
  return { ...base, dispon, ritmo, demanda_corregida: demanda, veredicto };
}

const redondear = (x: number | null, decimales: number): number | null => (x === null ? null : Math.round(x * 10 ** decimales) / 10 ** decimales);

/** El detalle que se guarda en `historico.cola_larga` y viaja en `AnioFilaApi.cola_larga` (cifras redondeadas para mostrarse). */
export function aColaLargaApi(r: ResultadoDisponibilidad): ColaLargaApi {
  return {
    demanda_corregida: redondear(r.demanda_corregida, 1),
    disponibilidad: redondear(r.dispon, 4),
    tienda_meses_con_stock: r.tienda_meses_con_stock,
    tienda_meses: r.tienda_meses,
    meses_cd_con_stock: r.meses_cd_con_stock,
    veredicto: r.veredicto,
    ritmo: redondear(r.ritmo, 3),
    meses_tiendas_sin_stock: r.meses_tiendas_sin_stock,
  };
}

/**
 * Decisión de Javier: la propuesta de una fila `revision` es `A_f` (nunca menos de lo vendido) y la propuesta que habría dado el
 * método normal pasa a `referencia_alternativa`. Con otro veredicto, o sin `A_f`, devuelve el cierre tal cual. El reparto mensual se
 * rehace con la nueva cifra (real hasta `k`, resto con la curva).
 */
export function proponerPorDemandaCorregida(args: {
  cierre: ResultadoCierre;
  resultado: Pick<ResultadoDisponibilidad, "veredicto" | "demanda_corregida">;
  serie: readonly number[];
  k: number;
  curva: readonly number[] | null;
  factoresMes: readonly number[];
}): ResultadoCierre {
  const { cierre, resultado } = args;
  if (resultado.veredicto !== "revision" || resultado.demanda_corregida === null || cierre.propuesto === null || args.curva === null) return cierre;
  const propuesto = Math.max(cierre.vendido, Math.round(resultado.demanda_corregida));
  // La referencia es SIEMPRE la cifra por avance (`V ÷ C_k`). Con poco avance el método normal había propuesto el plan anterior y
  // `referencia_alternativa` ya traía el avance; sin poco avance, el avance es la propia propuesta del cierre.
  const porAvance = cierre.metodo === "plan_anterior" && cierre.referencia_alternativa !== null ? cierre.referencia_alternativa : cierre.propuesto;
  const real = Array.from({ length: 12 }, (_, i) => (i < args.k ? Math.max(0, args.serie[i] ?? 0) : 0));
  const { meses, origen_meses } = repartirResto(propuesto, real, args.k, args.curva, args.factoresMes);
  return {
    ...cierre,
    propuesto,
    metodo: "avance",
    referencia_alternativa: porAvance,
    meses,
    origen_meses,
    // Se conservan `plan_anterior` y `avance_bajo` (informativos): dicen que el avance es poco fiable; la explicación aclara que la propuesta es `A_f`.
    avisos: cierre.avisos,
  };
}

/**
 * Regla 47. Los avisos de cola larga de un registro según su propuesta y el veredicto de la fila:
 *   - `propuesto` nulo → ninguno;
 *   - `revision` → `revision_cola_larga` siempre (la propuesta es `A_f ≥ umbral`; bloquea el cierre hasta decidirla; la fila de `Y+1`
 *     hereda la marca porque su base sale de la cifra de `Y`);
 *   - `propuesto ≥ umbral` → ninguno (la fila se decide, no es cola larga);
 *   - sin veredicto (no se midió) o `cierra` → `cola_larga`;
 *   - `cierra_con_quiebres` → `cola_larga` + `cola_larga_con_quiebres`;
 *   - `sin_dato` → `cola_larga` + `sin_stock_historico`.
 * La fila de `Y+1` hereda el veredicto de `Y`; si su propuesta no queda bajo el umbral, no hay aviso (salvo `revision`).
 */
export function avisosColaLarga(veredicto: VeredictoColaLarga | null | undefined, propuesto: number | null, umbral: number): AvisoFila[] {
  if (propuesto === null) return [];
  if (veredicto === "revision") return ["revision_cola_larga"];
  if (propuesto >= umbral) return [];
  switch (veredicto) {
    case "cierra_con_quiebres":
      return ["cola_larga", "cola_larga_con_quiebres"];
    case "sin_dato":
      return ["cola_larga", "sin_stock_historico"];
    default:
      return ["cola_larga"];
  }
}

/** ¿El registro está para revisión por cola larga y sin decidir? (Con la propuesta `A_f ≥ umbral` ya bloquea; esto además lo etiqueta.) */
export const pendienteDeRevision = (r: { avisos: readonly string[]; decidido: number | null }): boolean =>
  r.decidido === null && r.avisos.includes("revision_cola_larga");
