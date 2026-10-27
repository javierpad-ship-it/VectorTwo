import type { Mes } from "@/lib/compras/tipos";
import { fraccionAPuntos } from "@/lib/intercompany/reglas";
import { pctDirectoObservado } from "@/lib/intercompany/subflujo";
import type { EntregaCandidata } from "./ingresos";
import { mesDeFecha, sumarMes } from "./filas";
import type { AvisoConciliacion, PctDirectoObservado12mApi, SugerenciaApi } from "./tipos-api";

/**
 * Conciliación de ingresos de los meses cerrados (ficha 08, §0.5, 4.3b y reglas 4b, 4c, 4d y 34). Pura. NUNCA escribe: informa y
 * sugiere; aceptar una sugerencia es otra ruta y siempre la decide una persona.
 *
 *   Ing_m         = S_m − S_{m−1} + V_m           a nivel CADENA (CD + tiendas activas e inactivas): las transferencias se cancelan
 *   ingreso_inferido = max(0, Ing)   salida_inferida = max(0, −Ing)
 *   sin_registrar = max(0, Ing − Rec_m)           sin_respaldo = max(0, Rec_m − Ing)
 *
 * `pctDirectoObservado` es el de M13 (se reexporta, no se copia): fracción 0–1; `armarPctDirectoObservado` de M13 la pasa a puntos.
 */
export { pctDirectoObservado };

export type Umbrales = { u: number; pct: number };

export type EntradaConciliarMes = {
  periodo: Mes;
  venta: number;
  /** Stock de cadena de `m−1`; `null` si `m−1` no está publicado (`sin_mes_anterior`). */
  stock_inicio: number | null;
  stock_fin: number;
  /** `Rec_m`: recepciones registradas con `recibida_periodo = m`. */
  recepciones: number;
  /** `E_m`: entregas programadas con `periodo = m` de líneas confirmadas. */
  entregas: number;
  umbrales: Umbrales;
};

export type MesConciliado = {
  periodo: Mes;
  venta: number;
  stock_inicio: number | null;
  stock_fin: number;
  /** `Ing` sin truncar; `null` sin mes anterior. */
  ingreso_bruto: number | null;
  ingreso_inferido: number | null;
  salida_inferida: number | null;
  recepciones_registradas: number;
  entregas_programadas: number;
  sin_registrar: number;
  sin_respaldo: number;
  avisos: AvisoConciliacion[];
  sugerencias: SugerenciaApi[];
};

/**
 * Regla 4b. `ingreso_sin_registrar` si `sin_registrar ≥ max(umbral_u, umbral_pct % de Ing)`; `recepcion_sin_respaldo` si
 * `sin_respaldo ≥ umbral_u`: el umbral de la ficha («el mismo umbral») no cumple su propio ejemplo (950 recibidas e `Ing = 850` dan
 * 100 u de diferencia, bajo el 20 % de 850), así que aquí el respaldo usa solo el umbral absoluto, como el ejemplo.
 */
export function conciliarMes(e: EntradaConciliarMes): MesConciliado {
  const ing = e.stock_inicio === null ? null : e.stock_fin - e.stock_inicio + e.venta;
  const ingreso = ing === null ? null : Math.max(0, ing);
  const salida = ing === null ? null : Math.max(0, -ing);
  const sinRegistrar = ingreso === null ? 0 : Math.max(0, ingreso - e.recepciones);
  const sinRespaldo = ingreso === null ? 0 : Math.max(0, e.recepciones - ingreso);
  const umbral = Math.max(e.umbrales.u, ((ingreso ?? 0) * e.umbrales.pct) / 100);
  const avisos: AvisoConciliacion[] = [];
  if (ing === null) avisos.push("sin_mes_anterior");
  if (ing !== null && ing < 0) avisos.push("salida_neta");
  if (sinRegistrar > 0 && sinRegistrar >= umbral) avisos.push("ingreso_sin_registrar");
  if (sinRespaldo > 0 && sinRespaldo >= e.umbrales.u) avisos.push("recepcion_sin_respaldo");
  return {
    periodo: e.periodo,
    venta: e.venta,
    stock_inicio: e.stock_inicio,
    stock_fin: e.stock_fin,
    ingreso_bruto: ing,
    ingreso_inferido: ingreso,
    salida_inferida: salida,
    recepciones_registradas: e.recepciones,
    entregas_programadas: e.entregas,
    sin_registrar: sinRegistrar,
    sin_respaldo: sinRespaldo,
    avisos,
    sugerencias: [],
  };
}

/**
 * Concilia los meses de una fila (o de una marca dentro de ella). `lectura(m)` da el stock de cadena y la venta del mes, o `null` si
 * el mes no está publicado (ese mes no se concilia). Devuelve un registro por mes publicado, en orden.
 */
export function conciliarFila(e: {
  meses: readonly Mes[];
  /** El mes anterior de cada uno de `meses` (se calcula si falta); evita rehacer las fechas en cada fila. */
  previos?: readonly Mes[];
  lectura: (mes: Mes) => { stock: number; venta: number } | null;
  recepciones: ReadonlyMap<Mes, number> | undefined;
  entregas: ReadonlyMap<Mes, number> | undefined;
  umbrales: Umbrales;
}): MesConciliado[] {
  const salida: MesConciliado[] = [];
  for (let i = 0; i < e.meses.length; i++) {
    const mes = e.meses[i];
    const actual = e.lectura(mes);
    if (!actual) continue;
    const previo = e.lectura(e.previos?.[i] ?? sumarMes(mes, -1));
    salida.push(
      conciliarMes({
        periodo: mes,
        venta: actual.venta,
        stock_inicio: previo ? previo.stock : null,
        stock_fin: actual.stock,
        recepciones: e.recepciones?.get(mes) ?? 0,
        entregas: e.entregas?.get(mes) ?? 0,
        umbrales: e.umbrales,
      })
    );
  }
  return salida;
}

/**
 * `reclasificacion_probable`: en una misma línea y mes, una fila con `Ing > 0` y otra con `Ing < 0` de magnitud parecida (± 20 %: la
 * diferencia no pasa del 20 % de la mayor). Una equivalencia que cambia de nodo o una marca que entra a un conjunto producen ingreso
 * en una fila y salida en otra. Devuelve las claves de las filas marcadas (ambas partes de cada par).
 */
export function reclasificacionProbable(filas: readonly { clave: string; grupo: string; ingreso_bruto: number | null }[]): Set<string> {
  const porGrupo = new Map<string, { clave: string; ing: number }[]>();
  for (const f of filas) {
    if (f.ingreso_bruto === null || f.ingreso_bruto === 0) continue;
    const l = porGrupo.get(f.grupo);
    if (l) l.push({ clave: f.clave, ing: f.ingreso_bruto });
    else porGrupo.set(f.grupo, [{ clave: f.clave, ing: f.ingreso_bruto }]);
  }
  const marcadas = new Set<string>();
  for (const lista of porGrupo.values()) {
    const positivas = lista.filter((x) => x.ing > 0);
    const negativas = lista.filter((x) => x.ing < 0);
    for (const p of positivas) {
      for (const q of negativas) {
        const a = p.ing;
        const b = -q.ing;
        if (Math.abs(a - b) <= 0.2 * Math.max(a, b)) {
          marcadas.add(p.clave);
          marcadas.add(q.clave);
        }
      }
    }
  }
  return marcadas;
}

// ─── Sugerencias (§0.5, regla 34) ───

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type ResultadoSugerencias = {
  /** Sugerencias por mes (el mes X donde confirmar el ingreso). */
  por_mes: Map<Mes, SugerenciaApi[]>;
  /** `Σ` unidades sugeridas (vencidas y adelantadas): ingreso que el inventario ya muestra y que el flujo sigue esperando. */
  posible_doble_conteo: number;
  /** `Σ` unidades sugeridas de entregas vencidas. */
  doble_conteo_vencidas: number;
  /** Entregas vencidas con alguna sugerencia (para `con_respaldo_entregas`). */
  entregas_vencidas_con_sugerencia: Set<string>;
};

/**
 * Regla 4e y 34: qué entregas puede explicar el inventario y en qué mes X, sobre los doce meses a la vez y de forma VORAZ.
 *
 *  - `disponible_m = sin_registrar_m` si el mes tiene el aviso `ingreso_sin_registrar`; si no, 0.
 *  - Candidatas con pendiente > 0: primero las VENCIDAS (`periodo ≤ k'`), por (periodo, número de compra, línea); después las
 *    ADELANTADAS (`periodo > k'`: la mercadería pudo llegar antes de lo programado), en el mismo orden. Cada una busca desde su
 *    periodo (vencidas) o desde el mes de la compra (adelantadas: nada llega antes de comprarse).
 *  - Cada entrega recibe COMO MUCHO UNA sugerencia, en el primer mes `m ≥ inicio` con `disponible > 0`, por
 *    `min(pendiente, disponible)`, y `disponible` baja en lo asignado: la misma entrega nunca se sugiere en dos meses ni dos entregas
 *    se reparten el mismo ingreso dos veces. Lo que quede pendiente se vuelve a evaluar tras aceptar.
 */
export function sugerenciasDeFila(meses: readonly Pick<MesConciliado, "periodo" | "sin_registrar" | "avisos">[], candidatas: readonly EntregaCandidata[], kPrima: Mes): ResultadoSugerencias {
  const disponible = new Map<Mes, number>();
  const orden: Mes[] = [];
  for (const m of [...meses].sort((a, b) => comparar(a.periodo, b.periodo))) {
    disponible.set(m.periodo, m.avisos.includes("ingreso_sin_registrar") ? m.sin_registrar : 0);
    orden.push(m.periodo);
  }
  const resultado: ResultadoSugerencias = { por_mes: new Map(), posible_doble_conteo: 0, doble_conteo_vencidas: 0, entregas_vencidas_con_sugerencia: new Set() };
  if (orden.length === 0) return resultado;

  const porOrden = (a: EntregaCandidata, b: EntregaCandidata) =>
    comparar(a.periodo, b.periodo) || comparar(a.compra_numero, b.compra_numero) || comparar(a.linea_id, b.linea_id) || comparar(a.entrega_id, b.entrega_id);
  const vencidas = candidatas.filter((c) => c.pendiente > 0 && c.periodo <= kPrima).sort(porOrden);
  const adelantadas = candidatas.filter((c) => c.pendiente > 0 && c.periodo > kPrima).sort(porOrden);

  for (const c of [...vencidas, ...adelantadas]) {
    const inicio = c.periodo <= kPrima ? c.periodo : mesDeFecha(c.fecha_compra);
    const mes = orden.find((m) => m >= inicio && (disponible.get(m) ?? 0) > 0);
    if (mes === undefined) continue;
    const unidades = Math.min(c.pendiente, disponible.get(mes) ?? 0);
    if (unidades <= 0) continue;
    disponible.set(mes, (disponible.get(mes) ?? 0) - unidades);
    const sugerencia: SugerenciaApi = {
      tipo: c.periodo <= kPrima ? "vencida" : "adelantada",
      linea_id: c.linea_id,
      compra_id: c.compra_id,
      compra_numero: c.compra_numero,
      entrega_id: c.entrega_id,
      periodo_entrega: c.periodo,
      unidades,
      boton: c.boton,
    };
    const lista = resultado.por_mes.get(mes);
    if (lista) lista.push(sugerencia);
    else resultado.por_mes.set(mes, [sugerencia]);
    resultado.posible_doble_conteo += unidades;
    if (sugerencia.tipo === "vencida") {
      resultado.doble_conteo_vencidas += unidades;
      resultado.entregas_vencidas_con_sugerencia.add(c.entrega_id);
    }
  }
  return resultado;
}

/** `posible_doble_conteo` de una fila: las unidades de todas las sugerencias de sus meses (§0.5). */
export function posibleDobleConteo(fila: { conciliacion: readonly { sugerencias: readonly Pick<SugerenciaApi, "unidades">[] }[] }): number {
  return fila.conciliacion.reduce((a, m) => a + m.sugerencias.reduce((b, s) => b + s.unidades, 0), 0);
}

export type ResultadoValidacion =
  | { ok: true; sugerencia: SugerenciaApi }
  | { ok: false; motivo: "sugerencia_vencida" | "tipo_no_disponible" };

/**
 * Regla 23: valida el pedido de «Aceptar sugerencia» contra las sugerencias RECALCULADAS de hoy para esa fila y ese mes. Sin
 * sugerencia para esa entrega, o proponiendo menos unidades de las pedidas → `sugerencia_vencida`; una sugerencia de lote (sin
 * botón en `0.13.0`) → `tipo_no_disponible`. La pertenencia (línea de la compra, entrega de la línea) la comprueba antes quien llama.
 */
export function validarAceptacion(sugerenciasDelMes: readonly SugerenciaApi[], pedido: { linea_id: string; entrega_id: string; unidades: number }): ResultadoValidacion {
  const s = sugerenciasDelMes.find((x) => x.linea_id === pedido.linea_id && x.entrega_id === pedido.entrega_id);
  if (!s) return { ok: false, motivo: "sugerencia_vencida" };
  if (!s.boton) return { ok: false, motivo: "tipo_no_disponible" };
  if (pedido.unidades > s.unidades) return { ok: false, motivo: "sugerencia_vencida" };
  return { ok: true, sugerencia: s };
}

// ─── % directo observado (§0.14, supuesto 6) ───

/**
 * Agregado de los meses conciliados: `Σ max(0, Ing^B − Rec^B) ÷ Σ V^B` (solo meses con mes anterior publicado), en PUNTOS 0–100.
 * Se infla si no se registran las compras al CD de la marca. `null` si no hay venta.
 */
export function pctDirectoObservado12m(meses: readonly Pick<MesConciliado, "periodo" | "ingreso_inferido" | "recepciones_registradas" | "venta">[]): PctDirectoObservado12mApi | null {
  const validos = meses.filter((m) => m.ingreso_inferido !== null);
  const venta = validos.reduce((a, m) => a + m.venta, 0);
  if (validos.length === 0 || venta <= 0) return null;
  const sinRegistrar = validos.reduce((a, m) => a + Math.max(0, (m.ingreso_inferido ?? 0) - m.recepciones_registradas), 0);
  return { desde: validos[0].periodo, hasta: validos[validos.length - 1].periodo, valor: fraccionAPuntos(sinRegistrar / venta) };
}
