/**
 * Filtros, orden y agregados en memoria del reporte de agrupación GMLE (M11,
 * docs/modulos/11-reporte-agrupacion-gmle.md, "Pantallas"). Funciones puras,
 * sin React ni acceso a datos: el panel las llama sobre la respuesta de
 * `GET /api/reportes/agrupacion-gmle` y la descarga (`descargas.ts`) usa las
 * mismas filas que la tabla.
 */
import type {
  AgrupacionGmle,
  AgrupacionNodoGmle,
  AnomaliaGmle,
  EquivalenciaGmle,
  LineaPartidaGmle,
  NivelGmle,
  NodoGmle,
  ReporteAgrupacionGmle,
  TemporadaAgrupacion,
} from "./tipos-api";
import { PRIORIDAD_ANOMALIA_GMLE } from "./tipos-api";

// ─── Filtros ───

/** Valor del filtro de agrupación para "las que no tienen". */
export const SIN_AGRUPACION = "__sin_agrupacion__";

export type FiltroAnomalia = "todas" | AnomaliaGmle;

export type FiltrosGmle = {
  /** `""` = todas · `SIN_AGRUPACION` · id de la agrupación. */
  agrupacion: string;
  /** Nombre del género (`""` = todos). */
  genero: string;
  /** Nombre del mundo (`""` = todos). */
  mundo: string;
  nivel: "" | NivelGmle;
  /** Busca en línea, equivalencia y código, sin acentos ni mayúsculas. */
  texto: string;
  anomalia: FiltroAnomalia;
  soloGenericas: boolean;
  soloAnomalias: boolean;
  /** Apagado: solo equivalencias activas en nodos vigentes. */
  incluirInactivos: boolean;
};

export const FILTROS_VACIOS: FiltrosGmle = {
  agrupacion: "",
  genero: "",
  mundo: "",
  nivel: "",
  texto: "",
  anomalia: "todas",
  soloGenericas: false,
  soloAnomalias: false,
  incluirInactivos: false,
};

/** ¿Hay algún filtro distinto del estado inicial? (habilita "Limpiar filtros"). */
export function hayFiltros(f: FiltrosGmle): boolean {
  return (Object.keys(FILTROS_VACIOS) as (keyof FiltrosGmle)[]).some((k) => f[k] !== FILTROS_VACIOS[k]);
}

/** Minúsculas, sin acentos ni espacios sobrantes: la clave de búsqueda del texto. */
export function normalizarBusqueda(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Filas del Detalle ───

/** Fila del Detalle: la equivalencia de la API más lo que hereda de su nodo. */
export type FilaDetalleGmle = EquivalenciaGmle & {
  /**
   * `null` (se muestra `—`) en los nodos `GMLE` y en los nodos sin nada que
   * agrupar: no vigentes o con todas sus equivalencias inactivas. Es solo
   * presentación: la API manda `sin` en esos nodos, pero no tienen unidades.
   */
  agrupacion_nodo: AgrupacionNodoGmle | null;
  /** Nombre de la agrupación mayoritaria del nodo; vacío si no hay. */
  mayoritaria: string;
};

/** Agrupación del nodo tal como se muestra: `null` si el nodo no está vigente o no tiene unidades (ninguna equivalencia vigente). */
export function agrupacionNodoVisible(nodo: Pick<NodoGmle, "agrupacion_nodo" | "vigente" | "unidades"> | undefined): AgrupacionNodoGmle | null {
  if (!nodo || !nodo.vigente || nodo.unidades === 0) return null;
  return nodo.agrupacion_nodo;
}

/** Cruza cada equivalencia con su nodo (agrupación del nodo y mayoritaria). Conserva el orden del contrato. */
export function enriquecerEquivalencias(reporte: Pick<ReporteAgrupacionGmle, "equivalencias" | "nodos" | "agrupaciones">): FilaDetalleGmle[] {
  const nodos = new Map(reporte.nodos.map((n) => [n.id, n]));
  const nombres = new Map(reporte.agrupaciones.map((a) => [a.id, a.nombre]));
  return reporte.equivalencias.map((e) => {
    const nodo = nodos.get(e.nodo_id);
    return {
      ...e,
      agrupacion_nodo: agrupacionNodoVisible(nodo),
      mayoritaria: nodo?.mayoritaria_id ? (nombres.get(nodo.mayoritaria_id) ?? "") : "",
    };
  });
}

// ─── Filtrado ───

function coincideAgrupacion(agrupacionId: string | null, filtro: string): boolean {
  if (filtro === "") return true;
  if (filtro === SIN_AGRUPACION) return agrupacionId === null;
  return agrupacionId === filtro;
}

/**
 * Filtros "estructurales": género, mundo, nivel, texto y genéricas. Son los
 * que respetan también el Resumen (así "Resumen con filtro HOMBRE" responde
 * qué tiene cada agrupación de HOMBRE).
 */
function coincideEstructura(f: EquivalenciaGmle, filtros: FiltrosGmle, texto: string): boolean {
  if (filtros.genero && f.genero !== filtros.genero) return false;
  if (filtros.mundo && f.mundo !== filtros.mundo) return false;
  if (filtros.nivel && f.nivel !== filtros.nivel) return false;
  if (filtros.soloGenericas && !f.es_generica) return false;
  if (texto) {
    const pajar = normalizarBusqueda(`${f.linea} ${f.equivalencia} ${f.codigo}`);
    if (!pajar.includes(texto)) return false;
  }
  return true;
}

/** Conjunción de todos los filtros. Con `FILTROS_VACIOS` devuelve las vigentes y activas, en el orden recibido. */
export function filtrarReporte<T extends EquivalenciaGmle>(filas: readonly T[], filtros: FiltrosGmle): T[] {
  const texto = normalizarBusqueda(filtros.texto);
  return filas.filter((f) => {
    if (!filtros.incluirInactivos && !(f.activo && f.vigente)) return false;
    if (!coincideEstructura(f, filtros, texto)) return false;
    if (!coincideAgrupacion(f.agrupacion_id, filtros.agrupacion)) return false;
    if (filtros.anomalia !== "todas" && !f.anomalias.includes(filtros.anomalia)) return false;
    if (filtros.soloAnomalias && f.anomalias.length === 0) return false;
    return true;
  });
}

/** Solo lo vigente que pasa género, mundo, nivel, texto y genéricas: la base del Resumen. */
export function filtrarEstructura<T extends EquivalenciaGmle>(filas: readonly T[], filtros: FiltrosGmle): T[] {
  const texto = normalizarBusqueda(filtros.texto);
  return filas.filter((f) => f.activo && f.vigente && coincideEstructura(f, filtros, texto));
}

/** ¿Lleva alguna anomalía de prioridad alta? (resalta la fila en el Detalle). */
export function tieneAnomaliaAlta(f: { anomalias: readonly AnomaliaGmle[] }): boolean {
  return f.anomalias.some((a) => PRIORIDAD_ANOMALIA_GMLE[a] === "alta");
}

/** Códigos de las anomalías que viven en una equivalencia (las otras tres son de nodo, línea o agrupación). */
export const ANOMALIAS_DE_EQUIVALENCIA: readonly AnomaliaGmle[] = ["sin_agrupacion", "genero_no_incluido", "generica_discrepante"];

/**
 * Bloque "Equivalencias" de Anomalías: filas filtradas que llevan alguna de
 * las tres anomalías propias de la equivalencia (o la elegida con `codigo`).
 */
export function filtrarAnomaliasDeEquivalencia<T extends EquivalenciaGmle>(
  filas: readonly T[],
  filtros: FiltrosGmle,
  codigo: "todas" | AnomaliaGmle = "todas"
): T[] {
  const codigos = codigo === "todas" ? ANOMALIAS_DE_EQUIVALENCIA : [codigo];
  return filtrarReporte(filas, filtros).filter((f) => f.anomalias.some((a) => codigos.includes(a)));
}

/** Nodos con al menos una fila entre las ya filtradas (el filtro de nodos sigue al de equivalencias). */
export function filtrarNodosPorFilas<N extends { id: string }>(nodos: readonly N[], filas: readonly { nodo_id: string }[]): N[] {
  const ids = new Set(filas.map((f) => f.nodo_id));
  return nodos.filter((n) => ids.has(n.id));
}

/** Líneas partidas (género · línea) que tienen al menos una fila entre las ya filtradas. */
export function filtrarLineasPartidas(lineas: readonly LineaPartidaGmle[], filas: readonly { genero: string; linea: string }[]): LineaPartidaGmle[] {
  const claves = new Set(filas.map((f) => `${f.genero}\u0000${f.linea}`));
  return lineas.filter((l) => claves.has(`${l.genero}\u0000${l.linea}`));
}

/**
 * Agrupaciones activas vacías que pasan agrupación, género, texto (nombre) y
 * el chip de anomalía. Una agrupación vacía no tiene mundo, nivel ni
 * genéricas, así que esos filtros no la excluyen.
 */
export function filtrarAgrupacionesVacias(agrupaciones: readonly AgrupacionGmle[], filtros: FiltrosGmle): AgrupacionGmle[] {
  if (filtros.anomalia !== "todas" && filtros.anomalia !== "agrupacion_vacia") return [];
  if (filtros.agrupacion === SIN_AGRUPACION) return [];
  const texto = normalizarBusqueda(filtros.texto);
  return agrupaciones.filter((a) => {
    if (!a.anomalias.includes("agrupacion_vacia")) return false;
    if (filtros.agrupacion && a.id !== filtros.agrupacion) return false;
    if (filtros.genero && !a.generos.some((g) => g.nombre === filtros.genero)) return false;
    if (texto && !normalizarBusqueda(`${a.nombre} ${a.codigo}`).includes(texto)) return false;
    return true;
  });
}

// ─── Resumen por agrupación ───

/** Una fila del Resumen: una agrupación o, al final, "Sin agrupación" (`id: null`). */
export type FilaResumenGmle = {
  clave: string;
  id: string | null;
  nombre: string;
  temporada: TemporadaAgrupacion | null;
  activo: boolean;
  /** Nombres de los géneros; vacío = "sin género" (y en la fila "Sin agrupación"). */
  generos: string[];
  nodos_gml: number;
  nodos_gml_mixtos: number;
  unidades_gmle: number;
  equivalencias: number;
  genericas: number;
  lineas: number;
  anomalias: AnomaliaGmle[];
};

/**
 * Qué filas del Resumen quedan con la barra de filtros. Los conteos ya salen
 * de `filtrarEstructura`; acá solo se eligen las agrupaciones que se muestran:
 * la elegida en el `Select`, las vacías o la fila "Sin agrupación" según el
 * chip, las que tienen nodos mixtos y, para los avisos que viven en las
 * equivalencias (`generica_discrepante`, `genero_no_incluido`,
 * `linea_partida`), las agrupaciones con alguna fila que lleve ese código.
 * Con "Solo anomalías" quedan las que piden revisión: vacía, con nodos mixtos,
 * "Sin agrupación" con equivalencias o con alguna fila con anomalía.
 *
 * `filasEstructura` son las filas que ya pasaron `filtrarEstructura` (las
 * mismas con las que se armó el Resumen).
 */
export function filtrarFilasResumen(
  filas: readonly FilaResumenGmle[],
  filtros: FiltrosGmle,
  filasEstructura: readonly Pick<EquivalenciaGmle, "agrupacion_id" | "anomalias">[]
): FilaResumenGmle[] {
  const codigo = filtros.anomalia;
  const codigoDeFila = codigo !== "todas" && CODIGOS_POR_FILA_EN_RESUMEN.includes(codigo) ? codigo : null;
  const conCodigo = new Set<string>();
  const conAnomalia = new Set<string>();
  for (const f of filasEstructura) {
    const clave = f.agrupacion_id ?? SIN_AGRUPACION;
    if (f.anomalias.length > 0) conAnomalia.add(clave);
    if (codigoDeFila && f.anomalias.includes(codigoDeFila)) conCodigo.add(clave);
  }
  return filas.filter((f) => {
    if (filtros.agrupacion && f.clave !== filtros.agrupacion) return false;
    if (codigo === "agrupacion_vacia" && !f.anomalias.includes("agrupacion_vacia")) return false;
    if (codigo === "sin_agrupacion" && f.id !== null) return false;
    if (codigo === "nodo_gml_mixto" && f.nodos_gml_mixtos === 0) return false;
    if (codigoDeFila && !conCodigo.has(f.clave)) return false;
    if (
      filtros.soloAnomalias &&
      !(f.anomalias.length > 0 || f.nodos_gml_mixtos > 0 || (f.id === null && f.equivalencias > 0) || conAnomalia.has(f.clave))
    )
      return false;
    return true;
  });
}

/** Anomalías que el Resumen resuelve mirando las filas de cada agrupación (las otras tres tienen su propio criterio). */
const CODIGOS_POR_FILA_EN_RESUMEN: readonly AnomaliaGmle[] = ["generica_discrepante", "genero_no_incluido", "linea_partida"];

type Acumulado = { equivalencias: number; genericas: number; gmle: number; lineas: Set<string>; nodos: Set<string> };

/**
 * Conteos por agrupación sobre las filas ya reducidas por `filtrarEstructura`.
 * Con los filtros vacíos coinciden con los de la API (`agrupaciones[]` y
 * `resumen`). Devuelve las agrupaciones por nombre (el orden del contrato) y,
 * al final, la fila "Sin agrupación".
 */
export function armarResumenAgrupaciones(
  reporte: Pick<ReporteAgrupacionGmle, "agrupaciones" | "nodos">,
  filasEstructura: readonly EquivalenciaGmle[]
): FilaResumenGmle[] {
  const nodos = new Map(reporte.nodos.map((n) => [n.id, n]));
  const acumulados = new Map<string | null, Acumulado>();
  for (const f of filasEstructura) {
    let a = acumulados.get(f.agrupacion_id);
    if (!a) {
      a = { equivalencias: 0, genericas: 0, gmle: 0, lineas: new Set(), nodos: new Set() };
      acumulados.set(f.agrupacion_id, a);
    }
    a.equivalencias++;
    if (f.es_generica) a.genericas++;
    if (f.nivel === "GMLE") a.gmle++;
    a.lineas.add(f.linea);
    a.nodos.add(f.nodo_id);
  }

  function fila(id: string | null, base: Pick<FilaResumenGmle, "nombre" | "temporada" | "activo" | "generos" | "anomalias">): FilaResumenGmle {
    const a = acumulados.get(id);
    let nodosGml = 0;
    let mixtos = 0;
    for (const nodoId of a?.nodos ?? []) {
      const n = nodos.get(nodoId);
      if (!n || n.nivel !== "GML") continue;
      if (id === null) {
        if (n.agrupacion_nodo === "sin") nodosGml++;
      } else if (n.agrupacion_nodo === "unica" && n.agrupacion_id === id) nodosGml++;
      if (n.agrupacion_nodo === "mixta" && n.reparto.some((r) => r.agrupacion_id === id)) mixtos++;
    }
    return {
      clave: id ?? SIN_AGRUPACION,
      id,
      ...base,
      nodos_gml: nodosGml,
      nodos_gml_mixtos: mixtos,
      unidades_gmle: a?.gmle ?? 0,
      equivalencias: a?.equivalencias ?? 0,
      genericas: a?.genericas ?? 0,
      lineas: a?.lineas.size ?? 0,
    };
  }

  return [
    ...reporte.agrupaciones.map((g) =>
      fila(g.id, { nombre: g.nombre, temporada: g.temporada, activo: g.activo, generos: g.generos.map((x) => x.nombre), anomalias: g.anomalias })
    ),
    fila(null, { nombre: "Sin agrupación", temporada: null, activo: true, generos: [], anomalias: [] }),
  ];
}

// ─── Anomalías: filas de los bloques 1 y 2 ───

/** Fila del bloque "Nodos GML mixtos": el nodo con su reparto legible y la mayoritaria. */
export type FilaNodoMixtoGmle = {
  nodo: NodoGmle;
  /** `"5 PANT. INVIERNO · 2 PANT. VERANO · 1 sin"`. */
  reparto: string;
  /** Nombre de la agrupación mayoritaria; vacío si no hay (empate). */
  mayoritaria: string;
  /** Equivalencias vigentes del nodo (suma del reparto). */
  equivalencias: number;
};

/** Texto del reparto de un nodo: cuántas equivalencias en cada agrupación, "sin" para las que no tienen. */
export function textoReparto(nodo: Pick<NodoGmle, "reparto">, nombres: ReadonlyMap<string, string>): string {
  return nodo.reparto.map((r) => `${r.equivalencias} ${r.agrupacion_id === null ? "sin" : (nombres.get(r.agrupacion_id) ?? "?")}`).join(" · ");
}

/** Arma las filas del bloque 2 a partir de los nodos mixtos ya filtrados. */
export function armarNodosMixtos(nodos: readonly NodoGmle[], agrupaciones: readonly Pick<AgrupacionGmle, "id" | "nombre">[]): FilaNodoMixtoGmle[] {
  const nombres = new Map(agrupaciones.map((a) => [a.id, a.nombre]));
  return nodos
    .filter((n) => n.anomalias.includes("nodo_gml_mixto"))
    .map((nodo) => ({
      nodo,
      reparto: textoReparto(nodo, nombres),
      mayoritaria: nodo.mayoritaria_id ? (nombres.get(nodo.mayoritaria_id) ?? "") : "",
      equivalencias: nodo.reparto.reduce((s, r) => s + r.equivalencias, 0),
    }));
}

/** Texto de una línea partida: `"PANTALONES INVIERNO (9: URBANO, CASUAL) · PANTALONES VERANO (4: FORMAL)"`. */
export function textoLineaPartida(linea: LineaPartidaGmle): string {
  return linea.agrupaciones.map((a) => `${a.nombre} (${a.equivalencias}: ${a.mundos.join(", ")})`).join(" · ");
}

// ─── Orden ───

export type OrdenGmle = { clave: string; dir: "asc" | "desc" };

/** Pulsar una columna: ascendente → descendente → orden original (`null`). */
export function siguienteOrden(actual: OrdenGmle | null, clave: string): OrdenGmle | null {
  if (!actual || actual.clave !== clave) return { clave, dir: "asc" };
  return actual.dir === "asc" ? { clave, dir: "desc" } : null;
}

/** Texto (sin acentos ni mayúsculas, números por su valor) o número: lo que se compara en una columna. */
function comparar(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
}

/**
 * Ordena por el valor de una columna; estable (los empates conservan el orden
 * del contrato) y sin mutar la entrada. Sin orden devuelve la lista igual.
 */
export function ordenarFilas<T>(filas: readonly T[], valor: ((fila: T) => string | number) | undefined, orden: OrdenGmle | null): T[] {
  if (!orden || !valor) return [...filas];
  const signo = orden.dir === "asc" ? 1 : -1;
  return filas
    .map((fila, i) => ({ fila, i, v: valor(fila) }))
    .sort((x, y) => signo * comparar(x.v, y.v) || x.i - y.i)
    .map((x) => x.fila);
}

/** Como `ordenarFilas`, pero la fila final "Sin agrupación" se queda siempre al pie. */
export function ordenarResumen(
  filas: readonly FilaResumenGmle[],
  valor: ((fila: FilaResumenGmle) => string | number) | undefined,
  orden: OrdenGmle | null
): FilaResumenGmle[] {
  const sin = filas.filter((f) => f.id === null);
  const reales = filas.filter((f) => f.id !== null);
  return [...ordenarFilas(reales, valor, orden), ...sin];
}
