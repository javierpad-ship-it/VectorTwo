import { pendientesPorEntrega } from "@/lib/compras/pendientes";
import {
  ESTADOS_QUE_CUENTAN,
  type CompraRegistro,
  type EntregaRegistro,
  type LineaRegistro,
  type Mes,
  type RecepcionRegistro,
  type RepartoRegistro,
  type TipoLinea,
} from "@/lib/compras/tipos";
import { repartirEntero } from "@/lib/proyeccion/reparto";
import { claveDeFila, mesDeFecha, sumarMes, type ClaveFila } from "./filas";

/**
 * Ingresos del flujo (ficha 08, regla 4 y 4b, §0.5, §0.8 y §0.15). Pura. Los lotes se escalan con las filas de reparto GUARDADAS por
 * entrega y `repartirEntero` de M7: este archivo NO usa `compras/reparto.ts` ni importa nada de `compras/` salvo `pendientes.ts` y los
 * tipos (§0.8).
 *
 * Anti-duplicación: cada unidad entra al flujo una sola vez. Meses `≤ k'`, solo por el inventario publicado (recepciones y entregas con
 * periodo `≤ k'` no suman); meses `> k'`, por las entregas PENDIENTES de líneas confirmadas (menos las recepciones, asignadas FIFO) y
 * por las recepciones con `recibida_periodo > k'` (ya están, pero el stock publicado aún no las trae). Una entrega vencida (periodo
 * `≤ k'`, pendiente > 0) se proyecta en `k'+1` hasta que una persona confirme su ingreso, la cancele o la mueva: nunca deja de contarse
 * sola.
 */

/** Cómo el flujo resuelve la marca de una línea: su unidad (cabeza del conjunto) y la agrupación a la que va la fila. */
export type ResolverMarcas = {
  unidadDeMarca(marcaId: string): string;
  agrupacionDeMarca(marcaId: string): string | null;
};

/** Una entrega pendiente que cae en una fila: la unidad de la que parten las sugerencias de la conciliación (§0.5). */
export type EntregaCandidata = {
  compra_id: string;
  compra_numero: string;
  /** `aaaa-mm-dd`: nada llega antes de comprarse (inicio de búsqueda de las adelantadas). */
  fecha_compra: string;
  linea_id: string;
  entrega_id: string;
  tipo: TipoLinea;
  periodo: Mes;
  /** Pendiente de la entrega en ESTA fila (en un lote, la parte de su reparto). */
  pendiente: number;
  /** Programadas de la entrega en esta fila. */
  unidades: number;
  /** `periodo ≤ k'` y pendiente > 0. */
  vencida: boolean;
  /** `false` en los lotes (`0.13.0`): la sugerencia muestra «Ver compra». */
  boton: boolean;
  /** Para el detalle de la fila. */
  proveedor_nombre: string;
  estado: CompraRegistro["estado"];
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: LineaRegistro["tallas"];
};

type MapaMes = Map<Mes, number>;

export type IngresoFila = ClaveFila & {
  clave: string;
  /** `I_m` de `m > k'` (entregas pendientes + recepciones de `m > k'`), cualquier destino. */
  por_mes: MapaMes;
  /** La parte de `I_m` que viene de líneas de cada unidad de marca (`I^B_m`). */
  por_marca: Map<string, MapaMes>;
  /** Recepciones registradas por mes de recepción, de cualquier mes (`Rec_m`). */
  recepciones_por_mes: MapaMes;
  recepciones_por_marca: Map<string, MapaMes>;
  /** Entregas programadas por mes de su periodo (`E_m`), de cualquier estado de avance. */
  entregas_por_mes: MapaMes;
  candidatas: EntregaCandidata[];
  /** `Σ` de pendientes de entregas vencidas en esta fila. */
  vencidas: number;
};

export type ResultadoIngresos = {
  filas: Map<string, IngresoFila>;
  /** Líneas de lote confirmadas sin reparto guardado (o con alguna entrega sin él): no cuentan y se listan. */
  sin_reparto: string[];
  /** Líneas específicas cuya marca o agrupación no se pudo resolver a una agrupación (no deberían existir). */
  sin_clave: string[];
  /** Unidades pendientes de entregas con periodo posterior a `hasta` (fuera del horizonte), para el invariante. */
  fuera_de_horizonte: number;
};

export type EntradaIngresos = {
  compras: readonly CompraRegistro[];
  lineas: readonly LineaRegistro[];
  entregas: readonly EntregaRegistro[];
  repartos: readonly RepartoRegistro[];
  recepciones: readonly RecepcionRegistro[];
  /** Último mes publicado (`k'`). */
  kPrima: Mes;
  /** Último mes del horizonte; los ingresos posteriores no entran a `por_mes` (se suman a `fuera_de_horizonte`). */
  hasta: Mes;
  resolver: ResolverMarcas;
};

const sumaEn = (mapa: MapaMes, mes: Mes, unidades: number) => {
  if (unidades !== 0) mapa.set(mes, (mapa.get(mes) ?? 0) + unidades);
};

function agrupar<T>(items: readonly T[], clave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = clave(it);
    const l = m.get(k);
    if (l) l.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/**
 * Regla 4b. Recorre las compras que cuentan (`confirmada` y `recibida`, líneas activas) y arma, por fila `(g, a)`: los ingresos de
 * `m > k'`, lo registrado como recepción por mes, lo programado por mes, y las entregas pendientes candidatas a una sugerencia.
 */
export function ingresosPorFila(e: EntradaIngresos): ResultadoIngresos {
  const compras = new Map(e.compras.map((c) => [c.id, c]));
  const entregasDeLinea = agrupar(e.entregas, (x) => x.linea_id);
  const recepcionesDeLinea = agrupar(e.recepciones, (x) => x.linea_id);
  const repartosDeEntrega = agrupar(e.repartos, (x) => x.entrega_id);
  const primerMes = sumarMes(e.kPrima, 1);

  const filas = new Map<string, IngresoFila>();
  const sinReparto = new Set<string>();
  const sinClave = new Set<string>();
  let fuera = 0;

  const filaDe = (c: ClaveFila): IngresoFila => {
    const clave = claveDeFila(c);
    let f = filas.get(clave);
    if (!f) {
      f = {
        clave,
        gml_id: c.gml_id,
        equivalencia_id: c.equivalencia_id,
        agrupacion_marca_id: c.agrupacion_marca_id,
        por_mes: new Map(),
        por_marca: new Map(),
        recepciones_por_mes: new Map(),
        recepciones_por_marca: new Map(),
        entregas_por_mes: new Map(),
        candidatas: [],
        vencidas: 0,
      };
      filas.set(clave, f);
    }
    return f;
  };
  const sumaMarca = (mapa: Map<string, MapaMes>, marcaId: string | null, mes: Mes, unidades: number) => {
    if (marcaId === null || unidades === 0) return;
    let m = mapa.get(marcaId);
    if (!m) {
      m = new Map();
      mapa.set(marcaId, m);
    }
    sumaEn(m, mes, unidades);
  };

  const lineas = [...e.lineas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const linea of lineas) {
    const compra = compras.get(linea.compra_id);
    if (!compra || !ESTADOS_QUE_CUENTAN.includes(compra.estado) || !linea.activo) continue;

    const entregas = entregasDeLinea.get(linea.id) ?? [];
    const pendientes = pendientesPorEntrega(linea, entregas, recepcionesDeLinea.get(linea.id) ?? []);
    const programada = new Map(entregas.map((x) => [x.id, x.unidades]));
    const recepcion = new Map((recepcionesDeLinea.get(linea.id) ?? []).map((x) => [x.id, x]));
    const esLote = linea.tipo !== "especifica";

    /** Parte de `unidades` de una entrega que cae en cada fila: una sola para la específica; en un lote, su reparto guardado escalado. */
    const distribuir = (entregaId: string, unidades: number): { fila: ClaveFila; marca_id: string | null; unidades: number }[] | null => {
      if (!esLote) {
        const marcaUnidad = linea.marca_id === null ? null : e.resolver.unidadDeMarca(linea.marca_id);
        const agrupacion = linea.agrupacion_marca_id ?? (linea.marca_id === null ? null : e.resolver.agrupacionDeMarca(linea.marca_id));
        if (linea.genero_mundo_linea_id === null || agrupacion === null) {
          sinClave.add(linea.id);
          return null;
        }
        return [{ fila: { gml_id: linea.genero_mundo_linea_id, equivalencia_id: linea.equivalencia_id, agrupacion_marca_id: agrupacion }, marca_id: marcaUnidad, unidades }];
      }
      const filasReparto = repartosDeEntrega.get(entregaId);
      if (!filasReparto || filasReparto.length === 0) {
        sinReparto.add(linea.id);
        return null;
      }
      const partes = repartirEntero(unidades, filasReparto.map((r) => r.unidades)) ?? [];
      const salida: { fila: ClaveFila; marca_id: string | null; unidades: number }[] = [];
      filasReparto.forEach((r, i) => {
        const agrupacion = e.resolver.agrupacionDeMarca(r.marca_id);
        if (agrupacion === null) {
          sinClave.add(linea.id);
          return;
        }
        salida.push({
          fila: { gml_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, agrupacion_marca_id: agrupacion },
          marca_id: e.resolver.unidadDeMarca(r.marca_id),
          unidades: partes[i] ?? 0,
        });
      });
      return salida;
    };

    // Entregas: lo programado (E_m), lo pendiente (I_m desde k'+1) y las candidatas a sugerencia.
    for (const ent of pendientes.entregas) {
      const programadas = distribuir(ent.id, programada.get(ent.id) ?? ent.unidades);
      if (programadas) {
        for (const p of programadas) sumaEn(filaDe(p.fila).entregas_por_mes, ent.periodo, p.unidades);
      }
      if (ent.pendiente <= 0) continue;
      const pend = distribuir(ent.id, ent.pendiente);
      if (!pend) continue;
      const vencida = ent.periodo <= e.kPrima;
      const mesIngreso = ent.periodo < primerMes ? primerMes : ent.periodo;
      for (const p of pend) {
        if (p.unidades <= 0) continue;
        const f = filaDe(p.fila);
        if (mesIngreso <= e.hasta) {
          sumaEn(f.por_mes, mesIngreso, p.unidades);
          sumaMarca(f.por_marca, p.marca_id, mesIngreso, p.unidades);
        } else {
          fuera += p.unidades;
        }
        if (vencida) f.vencidas += p.unidades;
        f.candidatas.push({
          compra_id: compra.id,
          compra_numero: compra.numero,
          fecha_compra: compra.fecha_compra,
          linea_id: linea.id,
          entrega_id: ent.id,
          tipo: linea.tipo,
          periodo: ent.periodo,
          pendiente: p.unidades,
          unidades: programadas?.find((q) => claveDeFila(q.fila) === f.clave && q.marca_id === p.marca_id)?.unidades ?? p.unidades,
          vencida,
          boton: linea.tipo === "especifica",
          proveedor_nombre: compra.proveedor_nombre,
          estado: compra.estado,
          marca_id: linea.marca_id,
          agrupacion_marca_id: linea.agrupacion_marca_id,
          tallas: linea.tallas,
        });
      }
    }

    // Recepciones: lo registrado por mes (conciliación) y, si `recibida_periodo > k'`, ingreso en ese mes con el vector de la entrega
    // a la que cada tramo se asigna por FIFO.
    for (const a of pendientes.asignaciones) {
      const r = recepcion.get(a.recepcion_id);
      if (!r) continue;
      const partes = distribuir(a.entrega_id, a.unidades);
      if (!partes) continue;
      for (const p of partes) {
        if (p.unidades <= 0) continue;
        const f = filaDe(p.fila);
        sumaEn(f.recepciones_por_mes, r.recibida_periodo, p.unidades);
        sumaMarca(f.recepciones_por_marca, p.marca_id, r.recibida_periodo, p.unidades);
        if (r.recibida_periodo > e.kPrima) {
          if (r.recibida_periodo <= e.hasta) {
            sumaEn(f.por_mes, r.recibida_periodo, p.unidades);
            sumaMarca(f.por_marca, p.marca_id, r.recibida_periodo, p.unidades);
          } else {
            fuera += p.unidades;
          }
        }
      }
    }
  }

  return { filas, sin_reparto: [...sinReparto].sort(), sin_clave: [...sinClave].sort(), fuera_de_horizonte: fuera };
}

/** Los ingresos de una fila en cada mes de `periodos` (0 donde no hay). */
export const ingresosDeFila = (fila: Pick<IngresoFila, "por_mes"> | undefined, periodos: readonly Mes[]): number[] => periodos.map((m) => fila?.por_mes.get(m) ?? 0);

/** Los ingresos de una unidad de marca en una fila, mes a mes. */
export const ingresosDeMarca = (fila: Pick<IngresoFila, "por_marca"> | undefined, marcaId: string, periodos: readonly Mes[]): number[] =>
  periodos.map((m) => fila?.por_marca.get(marcaId)?.get(m) ?? 0);

/** `aaaa-mm` de una fecha de compra (inicio de búsqueda de una entrega adelantada). */
export const mesDeCompra = (fecha: string): Mes => mesDeFecha(fecha);
