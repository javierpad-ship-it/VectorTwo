import { formatearDecimal, formatearNumero, formatearPp } from "@/lib/formato";
import { MODO_DEFECTO, VENTANA_DEFECTO, VENTANAS, type AlcanceApi, type AnalisisMarcaApi, type AvisoBarrer, type FilaRepartoApi, type MarcaBarrerResumenApi, type ModalidadBarrer, type ModalidadEfectiva, type ModoEntrada, type MotivoObsoleto, type ResumenListaBarrerApi, type Ventana, UMBRAL_OBSOLETO_PP } from "@/lib/marcas-barrer/tipos-api";
import type { ArbolRespuesta } from "@/lib/arbol/tipos-api";
import { colorAnio } from "@/lib/reportes/histograma";

/**
 * Presentación pura de /planificacion/marcas-barrer (M12): estado de la vista en la URL, textos de avisos y motivos,
 * formatos y series de los gráficos. Sin React ni I/O; las pruebas viven en `tests/marcas-barrer.vista.test.ts`.
 */

export const ETIQUETA_MODO: Record<ModoEntrada, string> = { por_temporada: "por temporada", anual: "anual" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);

export const esVentana = (n: number): n is Ventana => (VENTANAS as readonly number[]).includes(n);
export const esModo = (v: string | null | undefined): v is ModoEntrada => v === "anual" || v === "por_temporada";

export type AlcanceUrl = { generos: string[]; mundos: string[]; lineas: string[] };

/** Lo que va en la URL: la marca abierta, la ventana, el modo, el Niño y el alcance. */
export type ParametrosVista = { marca: string | null; ventana: Ventana; modo: ModoEntrada; normalizaNino: boolean; alcance: AlcanceUrl };

const lista = (v: string | null): string[] => (v ? [...new Set(v.split(",").filter(esUuid))] : []);

/** Lee y valida los parámetros: un valor inválido cae al de defecto, nunca rompe la pantalla. */
export function leerParametros(get: (clave: string) => string | null): ParametrosVista {
  const marca = get("marca");
  const ventana = Number(get("ventana"));
  const modo = get("modo");
  return {
    marca: esUuid(marca) ? marca : null,
    ventana: esVentana(ventana) ? ventana : VENTANA_DEFECTO,
    modo: esModo(modo) ? modo : MODO_DEFECTO,
    normalizaNino: get("nino") !== "0",
    alcance: { generos: lista(get("genero")), mundos: lista(get("mundo")), lineas: lista(get("lineas")) },
  };
}

export const alcanceVacio = (a: AlcanceUrl) => a.generos.length + a.mundos.length + a.lineas.length === 0;

/** La parte de la URL de la pantalla (`?marca=…&ventana=24&modo=…`): lo que difiere del defecto no se escribe, salvo la marca. */
export function consultaVista(p: ParametrosVista): string {
  const q = new URLSearchParams();
  if (p.marca) q.set("marca", p.marca);
  q.set("ventana", String(p.ventana));
  if (p.marca) {
    q.set("modo", p.modo);
    if (!p.normalizaNino) q.set("nino", "0");
    if (p.alcance.generos.length) q.set("genero", p.alcance.generos.join(","));
    if (p.alcance.mundos.length) q.set("mundo", p.alcance.mundos.join(","));
    if (p.alcance.lineas.length) q.set("lineas", p.alcance.lineas.join(","));
  }
  return q.toString();
}

/** `GET /api/marcas-barrer/[marcaId]?ventana=&modo=&normaliza_nino=1&genero=&mundo=&lineas=` */
export function urlAnalisis(marcaId: string, p: ParametrosVista): string {
  const q = new URLSearchParams();
  q.set("ventana", String(p.ventana));
  q.set("modo", p.modo);
  q.set("normaliza_nino", p.normalizaNino ? "1" : "0");
  if (p.alcance.generos.length) q.set("genero", p.alcance.generos.join(","));
  if (p.alcance.mundos.length) q.set("mundo", p.alcance.mundos.join(","));
  if (p.alcance.lineas.length) q.set("lineas", p.alcance.lineas.join(","));
  return `/api/marcas-barrer/${marcaId}?${q.toString()}`;
}

export const urlLista = (ventana: Ventana) => `/api/marcas-barrer?ventana=${ventana}`;

// ─── Formatos ───

/** Una fracción (0..1) como porcentaje con un decimal: `41.0 %`; `null` → `—`. */
export function formatearFraccion(x: number | null | undefined, decimales = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? "—" : `${formatearDecimal(x * 100, decimales)} %`;
}

/** Un porcentaje ya en 0..100 con un decimal. */
export function formatearPorcentaje(x: number | null | undefined, decimales = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? "—" : `${formatearDecimal(x, decimales)} %`;
}

/** Tendencia (A₂ ÷ A₁ − 1) como `+6 %` / `-3 %`; sin dato `—`. */
export function formatearTendencia(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const p = Math.round(x * 100);
  return `${p > 0 ? "+" : p < 0 ? "-" : ""}${Math.abs(p).toLocaleString("es-PE")} %`;
}

export const formatearPpOpcional = (pp: number | null | undefined) => (pp === null || pp === undefined ? "—" : formatearPp(pp, 0));

/** `2026-09` → `set-2026`. */
export function periodoCorto(periodo: string): string {
  const [a, m] = periodo.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  const i = Number(m) - 1;
  return a && i >= 0 && i < 12 ? `${meses[i]}-${a}` : periodo;
}

/** `2026-09-30T…` → `2026-09-30`. */
export const soloFecha = (iso: string) => iso.slice(0, 10);

// ─── Etiquetas ───

export const ETIQUETA_MODALIDAD_BARRER: Record<ModalidadEfectiva, string> = { por_gml: "Por GML", barrido: "Al barrer", mixta: "Mixta" };

export const TEXTO_VEREDICTO_ERROR: Record<"estable" | "dudoso" | "inestable", string> = { estable: "estable", dudoso: "dudoso", inestable: "inestable" };
export const TONO_VEREDICTO_ERROR: Record<"estable" | "dudoso" | "inestable", "exito" | "alerta" | "neutro"> = { estable: "exito", dudoso: "neutro", inestable: "alerta" };

export const TEXTO_VEREDICTO_ESTACIONALIDAD: Record<"similar" | "dudosa" | "distinta", string> = { similar: "similar", dudosa: "dudosa", distinta: "distinta" };

/** `8 pp estable`, o `— (1 año)` cuando no hay backtesting. */
export function textoErrorReparto(e: { pp: number | null; veredicto: "estable" | "dudoso" | "inestable" | null } | null | undefined): string {
  if (!e || e.pp === null) return "Sin backtesting";
  return `${formatearPp(e.pp, 0)}${e.veredicto ? ` ${TEXTO_VEREDICTO_ERROR[e.veredicto]}` : ""}`;
}

export const TEXTO_AVISO: Record<AvisoBarrer, string> = {
  sin_venta_barrer: "La marca no tiene venta al barrer en la ventana: no hay reparto que calcular.",
  temporada_corta: "Una temporada tiene menos de 6 meses en la ventana: el reparto cae a anual.",
  sin_anio_completo: "La marca no tiene un año completo con venta: la estacionalidad propia no se puede calcular.",
  sin_backtesting: "No hay dos años con datos para comprobar qué tan estable es el reparto (sin error del reparto).",
  sin_cerrada: "No hay proyección cerrada con participación de esta marca: no hay reparto según la cerrada.",
  curva_incompleta: "Falta la curva vigente de alguna agrupación donde vende: la estacionalidad del GML es parcial.",
  sin_factor: "Falta el factor del Niño de algún mes atípico (se usó 1): revísalo en Proyección › Factores.",
  red_no_comparable: "La red de tiendas cambió: la tendencia entre años no es del todo comparable.",
  mixta_sin_gml: "Mixta sin GML específicos: se comporta como al barrer hasta que le asignes alguno.",
  nivel_cambiado: "Algún GML cambió de nivel (GML ↔ GMLE) desde la última aprobación.",
  sin_reparto: "La marca no tiene reparto aprobado: sus lotes quedarán con aviso «sin reparto» en el flujo.",
};

export const TEXTO_MOTIVO_OBSOLETO: Record<MotivoObsoleto, string> = {
  config_cambiada: "cambió la configuración (modalidad, GML, conjunto o alcance)",
  cargas_nuevas: `hay cargas nuevas que mueven el reparto más de ${UMBRAL_OBSOLETO_PP} pp`,
  nivel_cambiado: "un GML cambió de nivel",
  ventana_distinta: "la ventana es distinta",
};

/** La lista no calcula la diferencia exacta: con `cargas_nuevas` y `diferencia_pp` en `null` el motivo está por confirmar (el detalle sí la calcula). */
const cargasSinConfirmar = (motivo: MotivoObsoleto, diferenciaPp: number | null | undefined): boolean => motivo === "cargas_nuevas" && diferenciaPp === null;

export const TEXTO_CARGAS_SIN_CONFIRMAR = "hay cargas nuevas: abre la marca para ver cuánto mueven el reparto";

/** El porqué de un reparto obsoleto. Sin `diferenciaPp` calculada (`null`, la lista) no afirma el umbral de las cargas nuevas. */
export function textoObsoleto(motivos: readonly MotivoObsoleto[], diferenciaPp?: number | null): string {
  return motivos.map((m) => (cargasSinConfirmar(m, diferenciaPp) ? TEXTO_CARGAS_SIN_CONFIRMAR : TEXTO_MOTIVO_OBSOLETO[m])).join("; ");
}

/**
 * El estado de una marca en la lista y en la cabecera del reparto vigente. En la lista las cargas nuevas llegan sin la diferencia
 * calculada: eso no es un obsoleto confirmado, es «Revisar: cargas nuevas» (tono neutro). El filtro «Solo obsoletas» las sigue
 * incluyendo (`estado === "obsoleto"`), porque son candidatas a revisar y esconderlas las dejaría sin ver.
 */
export function textoEstadoReparto(e: { vigente: boolean; obsoleto: readonly MotivoObsoleto[]; diferenciaPp: number | null }): { texto: string; tono: "exito" | "alerta" | "neutro" } {
  if (!e.vigente) return { texto: "Sin reparto", tono: "alerta" };
  if (e.obsoleto.length > 0) {
    const confirmados = e.obsoleto.filter((m) => !cargasSinConfirmar(m, e.diferenciaPp));
    if (confirmados.length === 0) return { texto: "Revisar: cargas nuevas", tono: "neutro" };
    const corto: Record<MotivoObsoleto, string> = { config_cambiada: "config. cambiada", cargas_nuevas: "cargas nuevas", nivel_cambiado: "nivel cambiado", ventana_distinta: "ventana distinta" };
    return { texto: `Obsoleto: ${corto[confirmados[0]]}${e.obsoleto.length > 1 ? ` (+${e.obsoleto.length - 1})` : ""}`, tono: "alerta" };
  }
  return { texto: e.diferenciaPp !== null ? `Al día (difiere ${formatearPp(e.diferenciaPp, 1)})` : "Al día", tono: "exito" };
}

/** Los factores del Niño de la cabecera: `Niño: invierno 2026 ÷ 0.66 · verano 2026 ÷ 1.24`; sin factores `null`. */
export function textoNino(factores: AnalisisMarcaApi["parametros"]["factores"], normaliza: boolean): string | null {
  if (!normaliza) return "Niño: sin normalizar (cifras crudas)";
  const con = factores.filter((f) => f.ratio !== null);
  if (con.length === 0) return null;
  return `Niño: ${con.map((f) => `${f.temporada} ${f.anio} ÷ ${formatearDecimal(f.ratio as number, 2)}`).join(" · ")}`;
}

// ─── Bloque 2: peso de la marca en cada GML ───

export type FilaP1 = { clave: string; ruta: string; nivel: "GML" | "GMLE"; unidades: number; fila: FilaRepartoApi };

/** Los GML que tienen peso para elegir en el bloque 2 (todos los de la marca con venta; los pequeños incluidos). */
export function gmlConPeso(filas: readonly FilaRepartoApi[]): FilaP1[] {
  return filas
    .filter((f) => f.unidades_ventana > 0 || f.p1_ventana !== null)
    .map((f) => ({ clave: f.clave, ruta: f.ruta, nivel: f.nivel, unidades: f.unidades_ventana, fila: f }))
    .sort((a, b) => b.unidades - a.unidades || a.ruta.localeCompare(b.ruta, "es"));
}

/** Años que aparecen en `p1_anual` de las filas, ascendentes (cabeceras de las columnas del bloque 1). */
export function aniosDeFilas(filas: readonly FilaRepartoApi[]): number[] {
  const set = new Set<number>();
  for (const f of filas) for (const a of f.p1_anual) set.add(a.anio);
  return [...set].sort((a, b) => a - b);
}

/** Series de líneas (una por año) del peso mensual de un GML, para `calcularGeometriaCurvas`. */
export function seriesP1Mensual(fila: FilaRepartoApi): { clave: string; etiqueta: string; valores: (number | null)[]; color: string; trazo: "continuo" }[] {
  return fila.p1_mensual
    .filter((a) => a.meses.some((v) => v !== null))
    .map((a) => ({ clave: `p1-${a.anio}`, etiqueta: String(a.anio), valores: [...a.meses], color: colorAnio(a.anio), trazo: "continuo" as const }));
}

export const textoUnidades = (n: number) => `${formatearNumero(n)} u`;

// ─── Lista (paso 0) ───

export type SoloLista = "sin_reparto" | "obsoletas" | "mixtas" | "inestables";
export const ETIQUETA_SOLO: Record<SoloLista, string> = { sin_reparto: "Sin reparto", obsoletas: "Obsoletas", mixtas: "Mixtas", inestables: "Inestables" };
export const ORDEN_SOLO: SoloLista[] = ["sin_reparto", "obsoletas", "mixtas", "inestables"];

export type FiltrosLista = { modalidad: "todas" | ModalidadBarrer; agrupacion: string; genero: string; mundo: string; linea: string; solo: SoloLista[] };
export const FILTROS_VACIOS: FiltrosLista = { modalidad: "todas", agrupacion: "", genero: "", mundo: "", linea: "", solo: [] };

export function hayFiltros(f: FiltrosLista): boolean {
  return f.modalidad !== "todas" || f.agrupacion !== "" || f.genero !== "" || f.mundo !== "" || f.linea !== "" || f.solo.length > 0;
}

const cumpleSolo = (m: MarcaBarrerResumenApi, s: SoloLista): boolean => {
  switch (s) {
    case "sin_reparto":
      return m.estado === "sin_reparto";
    case "obsoletas":
      return m.estado === "obsoleto";
    case "mixtas":
      return m.modalidad === "mixta";
    case "inestables":
      return m.error_reparto.veredicto === "inestable";
  }
};

/** Filtra la lista: los criterios se combinan (todos deben cumplirse); `solo` también. El orden de la API se conserva. */
export function filtrarLista(marcas: readonly MarcaBarrerResumenApi[], f: FiltrosLista): MarcaBarrerResumenApi[] {
  return marcas.filter(
    (m) =>
      (f.modalidad === "todas" || m.modalidad === f.modalidad) &&
      (f.agrupacion === "" || m.agrupacion_marca.id === f.agrupacion) &&
      (f.genero === "" || m.genero_ids.includes(f.genero)) &&
      (f.mundo === "" || m.mundo_ids.includes(f.mundo)) &&
      (f.linea === "" || m.linea_ids.includes(f.linea)) &&
      f.solo.every((s) => cumpleSolo(m, s))
  );
}

/** El resumen del pie de la lista, calculado sobre las marcas que se ven (los mismos conteos que `resumen` de la API). */
export function resumenLista(marcas: readonly MarcaBarrerResumenApi[]): ResumenListaBarrerApi {
  return {
    marcas: marcas.length,
    sin_reparto: marcas.filter((m) => cumpleSolo(m, "sin_reparto")).length,
    obsoletas: marcas.filter((m) => cumpleSolo(m, "obsoletas")).length,
    mixtas: marcas.filter((m) => cumpleSolo(m, "mixtas")).length,
    inestables: marcas.filter((m) => cumpleSolo(m, "inestables")).length,
    unidades_barrer: marcas.reduce((s, m) => s + m.unidades_barrer, 0),
  };
}

/** `3 marcas · 21 810 unidades al barrer en 24 meses · 1 sin reparto · 1 obsoleta · 1 inestable` (omite lo que vale 0). */
export function textoResumenLista(r: ResumenListaBarrerApi, ventana: number): string {
  const partes = [
    `${formatearNumero(r.marcas)} ${r.marcas === 1 ? "marca" : "marcas"}`,
    `${formatearNumero(r.unidades_barrer)} unidades al barrer en ${ventana} meses`,
  ];
  if (r.sin_reparto > 0) partes.push(`${r.sin_reparto} sin reparto`);
  if (r.obsoletas > 0) partes.push(`${r.obsoletas} ${r.obsoletas === 1 ? "obsoleta" : "obsoletas"}`);
  if (r.inestables > 0) partes.push(`${r.inestables} ${r.inestables === 1 ? "inestable" : "inestables"}`);
  return partes.join(" · ");
}

export type ClaveOrdenLista = "marca" | "unidades" | "error";
export type OrdenLista = { clave: ClaveOrdenLista; dir: "asc" | "desc" };
export const ORDEN_LISTA_DEFECTO: OrdenLista = { clave: "unidades", dir: "desc" };

/** Ordena sin mutar; las marcas sin error del reparto van siempre al final de esa columna. */
export function ordenarLista(marcas: readonly MarcaBarrerResumenApi[], o: OrdenLista): MarcaBarrerResumenApi[] {
  const signo = o.dir === "asc" ? 1 : -1;
  return [...marcas].sort((a, b) => {
    if (o.clave === "marca") return signo * a.nombre.localeCompare(b.nombre, "es");
    if (o.clave === "error") {
      const x = a.error_reparto.pp;
      const y = b.error_reparto.pp;
      if (x === null && y === null) return a.nombre.localeCompare(b.nombre, "es");
      if (x === null) return 1;
      if (y === null) return -1;
      return signo * (x - y) || a.nombre.localeCompare(b.nombre, "es");
    }
    return signo * (a.unidades_ventana - b.unidades_ventana) || a.nombre.localeCompare(b.nombre, "es");
  });
}

/** Siguiente orden al pulsar un encabezado: misma columna invierte; otra empieza descendente (marca, ascendente). */
export function alternarOrden(actual: OrdenLista, clave: ClaveOrdenLista): OrdenLista {
  if (actual.clave === clave) return { clave, dir: actual.dir === "asc" ? "desc" : "asc" };
  return { clave, dir: clave === "marca" ? "asc" : "desc" };
}

/** `GML con venta (pequeños)`: `14 (6)`, y los específicos de una mixta: `9 (4) +2 específicos`. */
export function textoGmlConVenta(m: Pick<MarcaBarrerResumenApi, "gml_con_venta" | "gml_pequenos" | "gml_especificos">): string {
  const base = `${m.gml_con_venta} (${m.gml_pequenos})`;
  return m.gml_especificos > 0 ? `${base} +${m.gml_especificos} ${m.gml_especificos === 1 ? "específico" : "específicos"}` : base;
}

export type OpcionFiltro = { id: string; nombre: string };

/**
 * Las opciones de los filtros de la lista: solo lo que alguna marca de la lista tiene (agrupación de marca, y género, mundo y
 * línea donde vende al barrer). Los nombres de género, mundo y línea salen del árbol; un id que el árbol no conoce se omite.
 */
export function opcionesFiltro(marcas: readonly MarcaBarrerResumenApi[], arbol: ArbolRespuesta | null): { agrupaciones: OpcionFiltro[]; generos: OpcionFiltro[]; mundos: OpcionFiltro[]; lineas: OpcionFiltro[] } {
  const agrupaciones = new Map<string, string>();
  for (const m of marcas) agrupaciones.set(m.agrupacion_marca.id, m.agrupacion_marca.nombre);
  const usados = (clave: "genero_ids" | "mundo_ids" | "linea_ids") => new Set(marcas.flatMap((m) => m[clave]));
  const generosUsados = usados("genero_ids");
  const mundosUsados = usados("mundo_ids");
  const lineasUsadas = usados("linea_ids");
  const generos = new Map<string, string>();
  const mundos = new Map<string, string>();
  const lineas = new Map<string, string>();
  for (const g of arbol?.generos ?? []) {
    if (generosUsados.has(g.id)) generos.set(g.id, g.nombre);
    for (const mu of g.mundos) {
      if (mundosUsados.has(mu.id)) mundos.set(mu.id, mu.nombre);
      for (const l of mu.lineas) if (lineasUsadas.has(l.linea_id)) lineas.set(l.linea_id, l.nombre);
    }
  }
  const ordenado = (m: Map<string, string>) => [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { agrupaciones: ordenado(agrupaciones), generos: ordenado(generos), mundos: ordenado(mundos), lineas: ordenado(lineas) };
}

/** Cabecera de la columna de un año: `2025`, y el año en curso con su corte: `2026 (a set)`. */
export function tituloAnio(anio: number, hastaPeriodo: string): string {
  const [a, m] = hastaPeriodo.split("-").map(Number);
  if (anio !== a || m >= 12) return String(anio);
  return `${anio} (a ${periodoCorto(`${a}-${String(m).padStart(2, "0")}`).split("-")[0]})`;
}

/** `todo` si no hay alcance; si no, los nombres de género, mundo y líneas (un id que ya no está entre las opciones se cuenta aparte). */
export function textoAlcance(alcance: AlcanceApi, opciones: AnalisisMarcaApi["opciones_alcance"]): string {
  const nombres = (ids: readonly string[], lista: readonly { id: string; nombre: string }[]) => {
    const encontrados = ids.flatMap((id) => lista.filter((o) => o.id === id).map((o) => o.nombre));
    const faltan = ids.length - encontrados.length;
    return faltan > 0 ? [...encontrados, `${faltan} más`] : encontrados;
  };
  const partes = [...nombres(alcance.generos, opciones.generos), ...nombres(alcance.mundos, opciones.mundos), ...nombres(alcance.lineas, opciones.lineas)];
  return partes.length === 0 ? "todo" : partes.join(" · ");
}

export const ETIQUETA_MODO_REPARTO: Record<string, string> = { por_temporada: "por temporada", anual: "anual", por_mes: "por mes" };
export const ETIQUETA_FUENTE: Record<string, string> = { historico: "histórico", cerrada: "según la cerrada" };
