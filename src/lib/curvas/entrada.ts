import { recortarPeriodo } from "@/lib/ventas/periodo";
import { clasificarAnio, aniosDeCorrida, armarSerieAnual, mesesDelAnio, serieDeAgrupacion, sinVenta, sumar } from "./anios";
import { mesesAtipicos, type PeriodoParaClase } from "./atipicos";
import type { FilaVentaTemporada, VentaEstacionalidad } from "./agregado";
import type { EntradaAgrupacion, EntradaCorrida, EntradaTemporada } from "./modelo";
import { redComparable, tiendasQueEntran } from "./red";
import { TEMPORADAS_AGRUPACION, type ParametrosCurvas, type TemporadaAgrupacion } from "./tipos-api";
import type { FilaAgregado, SerieAnual, TiendaMaestro, VentaTiendaMes } from "./tipos";

/**
 * Arma la entrada del modelo a partir de las filas crudas del agregado
 * (docs/modulos/06-curvas-estacionalidad.md, "Calcular", pasos 3 y 4). Pura: la
 * red comparable se decide UNA vez sobre la venta total por tienda (agrupación
 * nula incluida) y, año a año, las series de cada agrupación suman solo las
 * tiendas de esa red, rellenadas con ceros desde los meses publicados.
 */

export type AgrupacionParaCorrida = {
  id: string;
  temporada: TemporadaAgrupacion;
  composicion: { equivalencias: number; huella: string };
  /** `null` cuando las líneas no informan (I5). */
  temporada_sugerida: TemporadaAgrupacion | null;
  temporadas_mezcladas: boolean;
};

export type DatosCorrida = {
  /** `aaaa-mm`: último mes que entra en la corrida. */
  hasta_periodo: string;
  /** Meses publicados en M5 (`aaaa-mm`). */
  meses_publicados: readonly string[];
  /** Filas del agregado: agrupación (o nula) × tienda × mes. */
  filas: readonly FilaAgregado[];
  tiendas: readonly TiendaMaestro[];
  periodos: readonly PeriodoParaClase[];
  /** Solo las agrupaciones ACTIVAS. */
  agrupaciones: readonly AgrupacionParaCorrida[];
};

/** Venta total por tienda y mes (todas las agrupaciones, la nula incluida). */
export function ventaPorTienda(filas: readonly FilaAgregado[]): VentaTiendaMes[] {
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = `${f.tienda_id}|${recortarPeriodo(f.periodo)}`;
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.unidades);
  }
  return [...acumulado].map(([clave, unidades]) => {
    const [tienda_id, periodo] = clave.split("|");
    return { tienda_id, periodo, unidades };
  });
}

/** Unidades de las filas con agrupación nula (hasta `hasta`): lo que M3 todavía no clasificó. */
export function unidadesSinAgrupacion(filas: readonly FilaAgregado[], hasta: string): number {
  return sumar(filas.filter((f) => f.agrupacion_id === null && recortarPeriodo(f.periodo) <= hasta).map((f) => f.unidades));
}

type ContextoEntrada = {
  anios: readonly number[];
  publicados: readonly string[];
  hasta: string;
  redSets: ReadonlyMap<number, ReadonlySet<string>>;
  periodos: readonly PeriodoParaClase[];
};

/** Las series de UNA agrupación sobre la red de cada año, a partir de sus filas por tienda. */
function entradaDeAgrupacion(a: AgrupacionParaCorrida, porTienda: ReadonlyMap<string, FilaAgregado[]>, ctx: ContextoEntrada): EntradaAgrupacion {
  const { anios, publicados, hasta, redSets } = ctx;
  const todas = [...porTienda.values()].flat();
  const negativos = new Set<string>();

  const serie = (
    rows: readonly FilaAgregado[],
    anio: number,
    red: ReadonlySet<string>,
    campo: "unidades" | "venta_soles" | "costo_vendido",
    avisarNegativos = false
  ) => {
    const delAnio = mesesDelAnio(anio).filter((m) => publicados.includes(m));
    const { valores, negativos: neg } = serieDeAgrupacion(rows, delAnio, red, campo);
    if (avisarNegativos) for (const n of neg) negativos.add(n);
    return armarSerieAnual(anio, valores, delAnio, hasta);
  };
  // Solo la serie de unidades de la red de cada año avisa de un mes negativo (el de una tienda suelta se compensa al sumar).
  const series = (campo: "unidades" | "venta_soles" | "costo_vendido"): SerieAnual[] =>
    anios.map((anio) => serie(todas, anio, redSets.get(anio) ?? new Set<string>(), campo, campo === "unidades"));

  const idsTienda = new Set<string>();
  for (const set of redSets.values()) for (const id of set) idsTienda.add(id);
  const por_tienda = [...idsTienda]
    .sort()
    .map((tienda_id) => ({
      tienda_id,
      unidades: anios
        .filter((anio) => redSets.get(anio)?.has(tienda_id))
        .map((anio) => serie(porTienda.get(tienda_id) ?? [], anio, new Set([tienda_id]), "unidades")),
    }));

  return {
    agrupacion_id: a.id,
    temporada: a.temporada,
    composicion: a.composicion,
    unidades: series("unidades"),
    venta: series("venta_soles"),
    costo: series("costo_vendido"),
    por_tienda,
    atipicos: mesesAtipicos(ctx.periodos, { temporada: a.temporada }),
    temporada_sugerida: a.temporada_sugerida,
    temporadas_mezcladas: a.temporadas_mezcladas,
    meses_negativos: [...negativos].sort(),
    sin_venta: sinVenta(todas, publicados, hasta),
  };
}

export function armarEntradaCorrida(datos: DatosCorrida, parametros: ParametrosCurvas): EntradaCorrida {
  const hasta = recortarPeriodo(datos.hasta_periodo);
  const publicados = [...new Set(datos.meses_publicados.map(recortarPeriodo))].filter((m) => m <= hasta).sort();
  const anios = aniosDeCorrida(publicados, hasta);
  const filas = datos.filas.filter((f) => recortarPeriodo(f.periodo) <= hasta);

  // Años normales de la red entera (para el ruido del diagnóstico de tiendas): los normales de `todo_el_ano`.
  const atipicosRed = mesesAtipicos(datos.periodos, { temporada: "todo_el_ano" });
  const aniosNormales = anios.filter(
    (a) => clasificarAnio(a, publicados, atipicosRed, parametros.max_meses_hueco, hasta).clase === "normal"
  );
  const redes = redComparable(datos.tiendas, ventaPorTienda(filas), anios, hasta, parametros, {
    aniosNormales,
    mesesPublicados: publicados,
  });
  const redSets = new Map(redes.map((r) => [r.anio, tiendasQueEntran(r)]));

  // Filas por agrupación y, dentro, por tienda.
  const porAgrupacion = new Map<string, Map<string, FilaAgregado[]>>();
  for (const f of filas) {
    if (f.agrupacion_id === null) continue;
    const porTienda = porAgrupacion.get(f.agrupacion_id) ?? new Map<string, FilaAgregado[]>();
    const lista = porTienda.get(f.tienda_id) ?? [];
    lista.push(f);
    porTienda.set(f.tienda_id, lista);
    porAgrupacion.set(f.agrupacion_id, porTienda);
  }

  const ctx: ContextoEntrada = { anios, publicados, hasta, redSets, periodos: datos.periodos };
  const agrupaciones: EntradaAgrupacion[] = datos.agrupaciones.map((a) =>
    entradaDeAgrupacion(a, porAgrupacion.get(a.id) ?? new Map<string, FilaAgregado[]>(), ctx)
  );

  return { hasta_periodo: hasta, meses_publicados: publicados, agrupaciones, redes, tiendas: [...datos.tiendas] };
}

// ─── 06b: una agrupación y las series por temporada ───

export type DatosAgrupacion = {
  /** `aaaa-mm`: último mes que entra en el cálculo. */
  hasta_periodo: string;
  /** Meses publicados en M5 (`aaaa-mm`). */
  meses_publicados: readonly string[];
  /** Lo que devuelve `venta_estacionalidad_agrupacion` (la `agrupacion` puede ser `null`: Años Niño). */
  venta: Pick<VentaEstacionalidad, "agrupacion" | "temporadas">;
  tiendas: readonly TiendaMaestro[];
  /** Periodos ACTIVOS. */
  periodos: readonly PeriodoParaClase[];
  /** La agrupación a calcular; `null` calcula solo las series por temporada (Años Niño, `/anios?con_volumen=1`). */
  agrupacion: AgrupacionParaCorrida | null;
  /** Agrupaciones ACTIVAS por temporada (el "N agrupaciones" de cada temporada). */
  activas_por_temporada: Readonly<Partial<Record<TemporadaAgrupacion, number>>>;
};

/** Venta total por tienda y mes: la suma de `temporadas` (la `sin_agrupacion` incluida). */
export function ventaPorTiendaDeTemporadas(temporadas: readonly FilaVentaTemporada[]): VentaTiendaMes[] {
  const acumulado = new Map<string, number>();
  for (const f of temporadas) {
    const clave = `${f.tienda_id}|${recortarPeriodo(f.periodo)}`;
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.unidades);
  }
  return [...acumulado].map(([clave, unidades]) => {
    const [tienda_id, periodo] = clave.split("|");
    return { tienda_id, periodo, unidades };
  });
}

/**
 * Arma la entrada del modelo para UNA agrupación (06b, regla 35) a partir de la
 * venta de `venta_estacionalidad_agrupacion`. Pura y barata (no calcula el modelo):
 * la decide primero `prerrequisitosAgrupacion`. La red comparable se decide sobre la
 * venta total por tienda (suma de `temporadas`) con `tiendas_excluidas` aplicadas, y
 * `series_temporada` lleva una entrada por temporada PRESENTE (con venta o con
 * agrupaciones activas), con la suma de la temporada entera sobre la red de cada año
 * y sus meses atípicos: de ahí salen `T` y el control del Niño.
 */
export function armarEntradaAgrupacion(datos: DatosAgrupacion, parametros: ParametrosCurvas): EntradaCorrida {
  const hasta = recortarPeriodo(datos.hasta_periodo);
  const publicados = [...new Set(datos.meses_publicados.map(recortarPeriodo))].filter((m) => m <= hasta).sort();
  const anios = aniosDeCorrida(publicados, hasta);
  const temporadas = datos.venta.temporadas.filter((f) => recortarPeriodo(f.periodo) <= hasta);

  const atipicosRed = mesesAtipicos(datos.periodos, { temporada: "todo_el_ano" });
  const aniosNormales = anios.filter(
    (a) => clasificarAnio(a, publicados, atipicosRed, parametros.max_meses_hueco, hasta).clase === "normal"
  );
  const redes = redComparable(datos.tiendas, ventaPorTiendaDeTemporadas(temporadas), anios, hasta, parametros, {
    aniosNormales,
    mesesPublicados: publicados,
  });
  const redSets = new Map(redes.map((r) => [r.anio, tiendasQueEntran(r)]));
  const ctx: ContextoEntrada = { anios, publicados, hasta, redSets, periodos: datos.periodos };

  const agrupaciones: EntradaAgrupacion[] = [];
  if (datos.agrupacion) {
    const porTienda = new Map<string, FilaAgregado[]>();
    for (const f of datos.venta.agrupacion ?? []) {
      if (recortarPeriodo(f.periodo) > hasta) continue;
      const lista = porTienda.get(f.tienda_id) ?? [];
      lista.push({ agrupacion_id: datos.agrupacion.id, ...f });
      porTienda.set(f.tienda_id, lista);
    }
    agrupaciones.push(entradaDeAgrupacion(datos.agrupacion, porTienda, ctx));
  }

  const idsTienda = new Set<string>();
  for (const set of redSets.values()) for (const id of set) idsTienda.add(id);
  const series_temporada: EntradaTemporada[] = [];
  for (const temporada of TEMPORADAS_AGRUPACION) {
    const filas = temporadas.filter((f) => f.temporada === temporada);
    const activas = datos.activas_por_temporada[temporada] ?? 0;
    if (filas.length === 0 && activas === 0) continue;
    const porTienda = new Map<string, FilaVentaTemporada[]>();
    for (const f of filas) {
      const lista = porTienda.get(f.tienda_id) ?? [];
      lista.push(f);
      porTienda.set(f.tienda_id, lista);
    }
    const serie = (rows: readonly FilaVentaTemporada[], anio: number, red: ReadonlySet<string>) => {
      const delAnio = mesesDelAnio(anio).filter((m) => publicados.includes(m));
      return armarSerieAnual(anio, serieDeAgrupacion(rows, delAnio, red, "unidades").valores, delAnio, hasta);
    };
    series_temporada.push({
      temporada,
      agrupaciones: activas,
      unidades: anios.map((anio) => serie(filas, anio, redSets.get(anio) ?? new Set<string>())),
      por_tienda: [...idsTienda].sort().map((tienda_id) => ({
        tienda_id,
        unidades: anios
          .filter((anio) => redSets.get(anio)?.has(tienda_id))
          .map((anio) => serie(porTienda.get(tienda_id) ?? [], anio, new Set([tienda_id]))),
      })),
      atipicos: mesesAtipicos(datos.periodos, { temporada }),
    });
  }

  return { hasta_periodo: hasta, meses_publicados: publicados, agrupaciones, redes, tiendas: [...datos.tiendas], series_temporada };
}
