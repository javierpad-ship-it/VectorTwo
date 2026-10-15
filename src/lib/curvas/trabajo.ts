import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import { recortarPeriodo, ultimoMesCerrado } from "@/lib/ventas/periodo";
import type { VentaEstacionalidad } from "./agregado";
import { hastaPorDefecto, mesesFaltantes } from "./anios";
import { mesesAtipicos, type PeriodoParaClase } from "./atipicos";
import { armarEntradaAgrupacion, ventaPorTiendaDeTemporadas } from "./entrada";
import { agrupacionesDeTemporada, huellaCalculo, huellaCargas, huellaRed, huellaTemporada } from "./huellas";
import { calcularCorrida, redondearJson, VERSION_MODELO, type EntradaCorrida, type SalidaCorrida } from "./modelo";
import type { AgrupacionTemporadaHuella, EstadoGlobalActual } from "./obsolescencia";
import { prerrequisitosAgrupacion } from "./prerrequisitos";
import { armarComparador, mismosAniosDeAjuste } from "./reglas";
import { curvaDeRecomendada } from "./estado";
import type {
  AgrupacionResultado,
  AgrupacionTrabajoApi,
  CalculoAgrupacionApi,
  ComparadorApi,
  ModeloCurva,
  ParametrosCurvas,
  PrerrequisitosApi,
  RedAnioApi,
  ResumenFoto,
  TemporadaAgrupacion,
  TemporadaResultado,
  TiendaIdentidad,
  VigenteResumenApi,
} from "./tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "./tipos";

/**
 * Orquestación PURA del trabajo por agrupación (docs/modulos/06b-curvas-trabajo-por-agrupacion.md):
 * a partir de lo ya leído arma la entrada, evalúa los prerrequisitos, calcula las
 * huellas y corre el modelo. `POST …/calcular` y `PUT …/[id]` la llaman con lo mismo,
 * así que lo que el planner ve y lo que se aprueba salen del mismo código. Sin base,
 * sin HTTP, sin reloj (`hoy` entra por parámetro).
 */

export type AgrupacionTrabajo = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  temporada: TemporadaAgrupacion;
  temporada_sugerida: TemporadaAgrupacion | null;
  generos: string[];
  equivalencias_activas: number;
  /** md5 de los ids de sus equivalencias activas. */
  huella: string;
  temporadas_mezcladas: boolean;
};

export type AgrupacionDeTemporada = { id: string; nombre: string; temporada: TemporadaAgrupacion; huella: string };

export type InsumosTrabajo = {
  agrupacion: AgrupacionTrabajo;
  /** Las agrupaciones ACTIVAS de su temporada y de toda temporada (de ahí salen `huella_temporada` y el "N agrupaciones"). */
  de_temporada: readonly AgrupacionDeTemporada[];
  tiendas: readonly TiendaMaestro[];
  /** Periodos ACTIVOS. */
  periodos: readonly PeriodoParaClase[];
  venta: VentaEstacionalidad;
  /** Versiones guardadas de la agrupación. */
  versiones: number;
  /** `aaaa-mm-dd` en Lima. */
  hoy: string;
};

export type RechazoTrabajo = { status: 409; mensaje: string; codigo: "hasta_periodo_sin_cargar" };

export type ResultadoTrabajo = {
  /** `aaaa-mm` efectivo; `null` si no hay ningún mes publicado y cerrado. */
  hasta_periodo: string | null;
  hasta_por_defecto: string | null;
  hasta_fue_por_defecto: boolean;
  ultimo_mes_cerrado: string;
  meses_posteriores: string[];
  /** md5 de las cargas ≤ `hasta_periodo`. */
  cargas_huella: string;
  /** `{ "aaaa-mm": carga_id }` de los meses ≤ `hasta_periodo`. */
  cargas: Record<string, string>;
  red_huella: string;
  huella_temporada: string;
  agrupaciones_temporada: AgrupacionTemporadaHuella[];
  huella_calculo: string;
  parametros: ParametrosCurvas;
  prerrequisitos: PrerrequisitosApi;
  /** La entrada armada; `null` sin meses publicados y cerrados. */
  entrada: EntradaCorrida | null;
  /** El modelo corrido; `null` si algún prerrequisito bloquea. */
  salida: SalidaCorrida | null;
};

const identidad = (t: TiendaMaestro): TiendaIdentidad => ({ id: t.id, codigo: t.codigo, nombre: t.nombre });

/** La `huella_temporada` de una agrupación a partir de las activas de su temporada y de toda temporada. */
export function huellaTemporadaDe(temporada: TemporadaAgrupacion, activas: readonly AgrupacionDeTemporada[]): {
  huella: string;
  trios: AgrupacionTemporadaHuella[];
} {
  const delasTemporadas = agrupacionesDeTemporada(temporada, activas);
  return {
    huella: huellaTemporada(delasTemporadas),
    trios: delasTemporadas.map((a) => ({ id: a.id, temporada: a.temporada, huella: a.huella })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/**
 * Prepara un cálculo: `hasta_periodo` (el pedido o el defecto, nunca el de la vigente),
 * huellas, entrada, prerrequisitos y, si ninguno bloquea, el modelo. `409
 * hasta_periodo_sin_cargar` si el `hasta` pedido no está publicado.
 */
export function prepararTrabajo(
  insumos: InsumosTrabajo,
  parametros: ParametrosCurvas,
  hastaPedido: string | undefined
): { rechazo: RechazoTrabajo; trabajo: null } | { rechazo: null; trabajo: ResultadoTrabajo } {
  const { agrupacion, venta, hoy } = insumos;
  const publicados = venta.meses_publicados;
  const porDefecto = hastaPorDefecto(publicados, hoy);
  const hasta = hastaPedido ?? porDefecto;
  if (hastaPedido !== undefined && !(hastaPedido in venta.cargas)) {
    return {
      rechazo: { status: 409, mensaje: `El mes ${hastaPedido} no está publicado en Venta y stock.`, codigo: "hasta_periodo_sin_cargar" },
      trabajo: null,
    };
  }

  const cargas: Record<string, string> = {};
  if (hasta !== null) for (const m of publicados) if (m <= hasta) cargas[m] = venta.cargas[m];
  const cargasHuella = huellaCargas(cargas);
  const redHuella = huellaRed(insumos.tiendas);
  const { huella: huellaTemp, trios } = huellaTemporadaDe(agrupacion.temporada, insumos.de_temporada);

  const activasPorTemporada: Partial<Record<TemporadaAgrupacion, number>> = {};
  for (const a of insumos.de_temporada) activasPorTemporada[a.temporada] = (activasPorTemporada[a.temporada] ?? 0) + 1;

  const entrada =
    hasta === null
      ? null
      : armarEntradaAgrupacion(
          {
            hasta_periodo: hasta,
            meses_publicados: publicados,
            venta,
            tiendas: insumos.tiendas,
            periodos: insumos.periodos,
            agrupacion: {
              id: agrupacion.id,
              temporada: agrupacion.temporada,
              composicion: { equivalencias: agrupacion.equivalencias_activas, huella: agrupacion.huella },
              temporada_sugerida: agrupacion.temporada_sugerida,
              temporadas_mezcladas: agrupacion.temporadas_mezcladas,
            },
            activas_por_temporada: activasPorTemporada,
          },
          parametros
        );

  const prerrequisitos = prerrequisitosAgrupacion({
    agrupacion: { id: agrupacion.id, nombre: agrupacion.nombre, activo: agrupacion.activo, temporada: agrupacion.temporada, equivalencias_activas: agrupacion.equivalencias_activas },
    versiones: insumos.versiones,
    parametros,
    meses_publicados: publicados,
    hasta_periodo: hasta,
    periodos: insumos.periodos,
    tiendas: insumos.tiendas,
    venta_tienda: ventaPorTiendaDeTemporadas(venta.temporadas),
    entrada,
  });

  const huella = huellaCalculo({
    cargas_huella: cargasHuella,
    red_huella: redHuella,
    composicion_huella: agrupacion.huella,
    temporada: agrupacion.temporada,
    huella_temporada: huellaTemp,
    hasta_periodo: hasta ?? "",
    periodos: insumos.periodos,
    parametros,
  });

  const salida = entrada && prerrequisitos.bloquea.length === 0 ? calcularCorrida(entrada, parametros) : null;
  return {
    rechazo: null,
    trabajo: {
      hasta_periodo: hasta,
      hasta_por_defecto: porDefecto,
      hasta_fue_por_defecto: hasta !== null && hasta === porDefecto,
      ultimo_mes_cerrado: ultimoMesCerrado(hoy),
      meses_posteriores: hasta === null ? [] : publicados.filter((m) => m > hasta),
      cargas_huella: cargasHuella,
      cargas,
      red_huella: redHuella,
      huella_temporada: huellaTemp,
      agrupaciones_temporada: trios,
      huella_calculo: huella,
      parametros,
      prerrequisitos,
      entrada,
      salida,
    },
  };
}

/** Lo que `calcular` devuelve de `datos` (la lectura de meses, sin la venta). */
export function datosDeTrabajo(t: ResultadoTrabajo, venta: Pick<VentaEstacionalidad, "meses_publicados">) {
  const publicados = venta.meses_publicados;
  const hasta = t.hasta_periodo;
  const usados = hasta === null ? [] : publicados.filter((m) => m <= hasta);
  return {
    desde: publicados[0] ?? null,
    hasta: publicados.length > 0 ? publicados[publicados.length - 1] : null,
    meses_publicados: publicados.length,
    faltantes: hasta === null || usados.length === 0 ? [] : mesesFaltantes(usados, hasta),
    hasta_periodo: hasta,
    hasta_fue_por_defecto: t.hasta_fue_por_defecto,
    ultimo_mes_cerrado: t.ultimo_mes_cerrado,
    meses_posteriores: t.meses_posteriores,
    cargas_huella: t.cargas_huella,
  };
}

export function agrupacionTrabajoApi(a: AgrupacionTrabajo): AgrupacionTrabajoApi {
  return {
    id: a.id,
    nombre: a.nombre,
    codigo: a.codigo,
    activo: a.activo,
    temporada: a.temporada,
    temporada_sugerida: a.temporada_sugerida,
    generos: a.generos,
    equivalencias_activas: a.equivalencias_activas,
  };
}

/** El resultado de la agrupación y sus piezas en la salida del modelo (`null` si el modelo no corrió). */
export function piezasDeSalida(salida: SalidaCorrida | null, agrupacionId: string) {
  const resultado = salida?.resultado.agrupaciones.find((a) => a.agrupacion_id === agrupacionId) ?? null;
  if (!salida || !resultado) return null;
  const temporada = salida.resultado.temporadas.find((t) => t.temporada === resultado.temporada) ?? null;
  const control = salida.resultado.temporadas.find((t) => t.temporada === "todo_el_ano") ?? null;
  return { resultado, temporada, control };
}

/** La red de cada año con el código y el nombre de las tiendas, y las tiendas que aparecen. */
export function redConIdentidad(
  redes: EntradaCorrida["redes"],
  resultado: AgrupacionResultado,
  tiendas: readonly TiendaMaestro[]
): { red: RedAnioApi[]; tiendas: TiendaIdentidad[] } {
  const usadas = new Set<string>();
  for (const r of redes) for (const t of r.tiendas) usadas.add(t.tienda_id);
  for (const a of resultado.anios) for (const t of a.por_tienda) usadas.add(t.tienda_id);
  const identidades = tiendas.filter((t) => usadas.has(t.id)).map(identidad);
  const porId = new Map(identidades.map((t) => [t.id, t]));
  return {
    red: redes.map((r) => ({
      ...r,
      tiendas: r.tiendas.map((t) => ({ ...t, codigo: porId.get(t.tienda_id)?.codigo ?? t.tienda_id, nombre: porId.get(t.tienda_id)?.nombre ?? t.tienda_id })),
    })),
    tiendas: identidades,
  };
}

/** `calculo` de la respuesta de `calcular`; `null` si el modelo no corrió. */
export function calculoDeTrabajo(t: ResultadoTrabajo, agrupacionId: string, tiendas: readonly TiendaMaestro[], duracionMs: number): CalculoAgrupacionApi | null {
  const piezas = piezasDeSalida(t.salida, agrupacionId);
  if (!piezas || !t.salida || !t.entrada) return null;
  const { red, tiendas: identidades } = redConIdentidad(t.entrada.redes, piezas.resultado, tiendas);
  return {
    resultado: piezas.resultado,
    temporada_curva: piezas.temporada,
    efecto_temporada: t.salida.efecto_atipico.por_temporada.filter((f) => f.temporada === piezas.resultado.temporada || f.temporada === "todo_el_ano"),
    red,
    tiendas: identidades,
    duracion_ms: duracionMs,
  };
}

/**
 * El comparador de la candidata pedida (por defecto la recomendada) frente a una
 * curva ya aprobada; `null` sin curva con la que comparar o sin candidata con curva.
 * `comparable_con_vigente` dice si el conjunto de años de ajuste es el mismo (regla 56).
 */
export function comparadorContra(
  resultado: AgrupacionResultado,
  temporada: Pick<TemporadaResultado, "curva_T"> | null,
  aprobada: Pick<VigenteResumenApi, "modelo" | "curva" | "eat" | "anios_ajuste"> | null,
  modeloPedido: ModeloCurva | null
): ComparadorApi | null {
  const modelo = modeloPedido ?? resultado.recomendada;
  if (!aprobada || !modelo) return null;
  const candidata = modelo === "T" ? null : resultado.candidatas.find((c) => c.modelo === modelo);
  const curva = modelo === "T" ? curvaDeRecomendada({ ...resultado, recomendada: "T" }, temporada) : (candidata?.curva ?? null);
  if (!curva) return null;
  const aniosAjuste = resultado.anios.filter((a) => a.en_ajuste).map((a) => a.anio);
  return armarComparador(modelo, { curva, eat: candidata?.eat ?? null }, aprobada, mismosAniosDeAjuste(aniosAjuste, aprobada.anios_ajuste));
}

// ─── Estado de hoy para la obsolescencia ───

/** `EstadoGlobalActual` con lo ya leído (la lista lo arma con todo; `calcular` con lo de la agrupación y su temporada). */
export function estadoGlobalActual(p: {
  tiendas: readonly TiendaMaestro[];
  venta: readonly VentaTiendaMes[];
  cargas: Readonly<Record<string, string>>;
  periodos: readonly PeriodoParaClase[];
  agrupaciones: ReadonlyArray<{ id: string; temporada: TemporadaAgrupacion; equivalencias_activas: number; huella: string }>;
  activas: readonly AgrupacionDeTemporada[];
  /** Si `activas` solo cubre una temporada (y toda temporada), cuál. */
  activas_de_temporada?: TemporadaAgrupacion;
  hoy: string;
}): EstadoGlobalActual {
  return {
    tiendas: p.tiendas,
    venta: p.venta,
    cargas: p.cargas,
    periodos: p.periodos,
    agrupaciones: new Map(p.agrupaciones.map((a) => [a.id, { temporada: a.temporada, equivalencias: a.equivalencias_activas, huella: a.huella }])),
    activas: p.activas,
    activas_de_temporada: p.activas_de_temporada,
    hasta_actual: hastaPorDefecto(Object.keys(p.cargas), p.hoy),
  };
}

// ─── Foto de aprobación ───

export type FotoAprobacion = Omit<TablesInsert<"corridas_estacionalidad">, "perfil_id" | "usuario_nombre">;

/**
 * La foto que `PUT` inserta justo antes de la curva (regla de la ficha, "Foto de
 * aprobación"): `parametros`, `resultado` solo con la agrupación, su temporada y el
 * control de toda temporada, `red_comparable`, `efecto_atipico` de su temporada y el
 * control, y un `resumen` que basta para la obsolescencia sin releer `resultado`.
 * `null` si el modelo no corrió.
 */
export function armarFoto(t: ResultadoTrabajo, agrupacion: AgrupacionTrabajo, periodos: readonly PeriodoParaClase[], duracionMs: number): FotoAprobacion | null {
  const piezas = piezasDeSalida(t.salida, agrupacion.id);
  if (!piezas || !t.salida || !t.entrada || t.hasta_periodo === null) return null;
  const hasta = t.hasta_periodo;
  const temporadas = [piezas.temporada, piezas.control].filter((x): x is TemporadaResultado => x !== null);
  const unicas = temporadas.filter((x, i) => temporadas.findIndex((y) => y.temporada === x.temporada) === i);
  const propias = (f: { temporada: string }) => f.temporada === piezas.resultado.temporada || f.temporada === "todo_el_ano";
  const efecto = t.salida.efecto_atipico;
  const usados = Object.keys(t.cargas);
  const resumen: ResumenFoto = {
    cargas: t.cargas,
    cargas_huella: t.cargas_huella,
    red_huella: t.red_huella,
    composicion_huella: agrupacion.huella,
    temporada: agrupacion.temporada,
    agrupaciones_temporada: t.agrupaciones_temporada,
    huella_calculo: t.huella_calculo,
    huella_temporada: t.huella_temporada,
    hasta_periodo: hasta,
    hasta_fue_por_defecto: t.hasta_fue_por_defecto,
    atipicos: [...mesesAtipicos(periodos, { temporada: agrupacion.temporada })].filter((m) => m <= hasta).sort(),
    ruido_normal: piezas.resultado.ruido_normal,
    version_modelo: VERSION_MODELO,
    sin_periodos_confirmado: t.parametros.sin_periodos_confirmado,
    meses_publicados: { desde: usados[0] ?? hasta, hasta, faltantes: mesesFaltantes(usados, hasta) },
    duracion_ms: duracionMs,
  };
  return {
    agrupacion_estacionalidad_id: agrupacion.id,
    hasta_periodo: `${recortarPeriodo(hasta)}-01`,
    parametros: t.parametros as unknown as Json,
    resultado: redondearJson({ agrupaciones: [piezas.resultado], temporadas: unicas }) as unknown as Json,
    red_comparable: redondearJson(t.entrada.redes) as unknown as Json,
    efecto_atipico: redondearJson({
      ...efecto,
      por_temporada: efecto.por_temporada.filter(propias),
      crecimiento_normal: efecto.crecimiento_normal.filter(propias),
    }) as unknown as Json,
    resumen: redondearJson(resumen) as unknown as Json,
  };
}
