import { pendienteDeRevision } from "./cola-larga";
import {
  SOLO_MATRIZ,
  UMBRAL_COLA_LARGA,
  type AnioFilaApi,
  type AvisoFila,
  type CurvaOrigen,
  type EstadoLinea,
  type FiltroMatrizApi,
  type FilaApi,
  type NodoMatrizApi,
  type Participaciones,
  type SoloMatriz,
} from "./tipos-api";

/**
 * Matriz (Parte 2) y estado de línea (ficha 07, paso 5 y reglas 28, 29 y 31). Puro: son sumas exactas de lo guardado
 * en `proyeccion_fila_anios`; nada se redistribuye ni se vuelve a leer venta. En la matriz no se decide nada.
 */

/** Un registro por año de una fila, con la versión de curva con la que se repartió (para el contrato de M8). */
export type AnioPlano = AnioFilaApi & { curva_origen_usada?: CurvaOrigen[] };

/** Una fila guardada, aplanada: lo que leen matriz, mensual y contrato de M8 (sin `historico`). */
export type FilaPlana = Pick<
  FilaApi,
  | "id"
  | "tienda_id"
  | "gml_id"
  | "equivalencia_id"
  | "agrupacion_marca_id"
  | "nivel"
  | "genero"
  | "mundo"
  | "linea"
  | "equivalencia"
  | "agrupacion_marca"
  | "agrupacion_estacionalidad"
  | "avisos"
  | "activo"
> & {
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  anios: AnioPlano[];
  participaciones?: Participaciones | null;
  /** `orden` de la agrupación de marca en el catálogo; sin él se ordena por nombre. */
  agrupacion_marca_orden?: number;
};

/** PREMIUM → ULTRA LOW según el `orden` del catálogo; a igual orden (o sin él), por nombre. */
export function compararAgrupacionMarca(
  a: Pick<FilaPlana, "agrupacion_marca" | "agrupacion_marca_orden">,
  b: Pick<FilaPlana, "agrupacion_marca" | "agrupacion_marca_orden">
): number {
  const oa = a.agrupacion_marca_orden ?? Number.MAX_SAFE_INTEGER;
  const ob = b.agrupacion_marca_orden ?? Number.MAX_SAFE_INTEGER;
  return oa === ob ? a.agrupacion_marca.localeCompare(b.agrupacion_marca, "es") : oa < ob ? -1 : 1;
}

export type FiltroLineas = Omit<FiltroMatrizApi, "por">;

export const FILTRO_VACIO: FiltroMatrizApi = {
  genero_id: null,
  mundo_id: null,
  linea_id: null,
  temporada: null,
  agrupacion_estacionalidad_id: null,
  agrupacion_marca_id: null,
  solo: null,
  por: "arbol",
};

export function esSoloMatriz(valor: unknown): valor is SoloMatriz {
  return typeof valor === "string" && (SOLO_MATRIZ as readonly string[]).includes(valor);
}

const registro = (f: FilaPlana, anio: number) => f.anios.find((a) => a.anio === anio);
const vigenteDe = (a: AnioPlano | undefined) => a?.vigente ?? a?.decidido ?? a?.propuesto ?? 0;

type Cifras = NodoMatrizApi["en_curso"];
type CifrasSig = NodoMatrizApi["siguiente"];
const cero = (): Cifras => ({ venta_a_la_fecha: 0, mismas: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0, decididas: 0, filas: 0 });

function sumarCifras(destino: Cifras | CifrasSig, origen: Cifras | CifrasSig) {
  destino.mismas += origen.mismas;
  destino.nuevas_anterior += origen.nuevas_anterior;
  destino.aperturas += origen.aperturas;
  destino.cierres += origen.cierres;
  destino.total += origen.total;
  destino.decididas += origen.decididas;
  destino.filas += origen.filas;
}

type Linea = {
  gml_id: string;
  ids: NodoMatrizApi["ids"];
  genero: string;
  mundo: string;
  linea: string;
  agrupacion_marca: string | null;
  en_curso: Cifras;
  siguiente: CifrasSig;
  estado: EstadoLinea;
  avisos: AvisoFila[];
  conTiendasNuevas: boolean;
  colaLarga: boolean;
  paraRevision: boolean;
  curvaCambio: boolean;
  propuestaCambio: boolean;
};

/**
 * Regla 29. `sin_proyectar`: ninguna fila base decidida en ninguno de los dos años; `proyectada`: todas las filas con
 * `propuesto ≥ umbral` decididas en los dos años y las tiendas nuevas de la línea decididas; en medio, `parcial`;
 * `curva_cambio` o `propuesta_cambio` si alguna fila lo tiene (prevalecen sobre `proyectada` y `parcial`, no sobre
 * `sin_proyectar`).
 */
export function estadoLinea(filas: readonly FilaPlana[], anioEnCurso: number, umbralColaLarga: number = UMBRAL_COLA_LARGA): EstadoLinea {
  const activas = filas.filter((f) => f.activo);
  const base = activas.filter((f) => f.tienda_id === null);
  const anios = [anioEnCurso, anioEnCurso + 1];
  const alguna = base.some((f) => anios.some((a) => registro(f, a)?.decidido != null));
  if (!alguna) return "sin_proyectar";

  const requeridasDecididas = base.every((f) =>
    anios.every((a) => {
      const r = registro(f, a);
      if (!r || r.propuesto === null) return true;
      // `0.10.1`: una fila `revision_cola_larga` se decide aunque su propuesta quede bajo el umbral.
      if (r.propuesto < umbralColaLarga && !r.avisos.includes("revision_cola_larga")) return true;
      return r.decidido !== null;
    })
  );
  // Tiendas nuevas: decidida si ninguna de sus filas con propuesta quedó sin decidir.
  const tiendasDecididas = activas
    .filter((f) => f.tienda_id !== null)
    .every((f) => anios.every((a) => {
      const r = registro(f, a);
      if (!r || r.bloque !== "nuevas") return true;
      return r.decidido !== null || (r.propuesto ?? 0) <= 0;
    }));

  let estado: EstadoLinea = requeridasDecididas && tiendasDecididas ? "proyectada" : "parcial";
  const avisos = new Set(activas.flatMap((f) => [...f.avisos, ...f.anios.flatMap((a) => a.avisos)]));
  if (avisos.has("curva_cambio")) estado = "curva_cambio";
  else if (avisos.has("propuesta_cambio")) estado = "propuesta_cambio";
  return estado;
}

/** Aplica los filtros que miran la fila (género, mundo, línea, temporada, agrupación) y recorta a la agrupación de marca. */
export function filtrarFilas(filas: readonly FilaPlana[], filtro: Partial<FiltroMatrizApi>): FilaPlana[] {
  return filas.filter((f) => {
    if (!f.activo) return false;
    if (filtro.genero_id && f.genero_id !== filtro.genero_id) return false;
    if (filtro.mundo_id && f.mundo_id !== filtro.mundo_id) return false;
    if (filtro.linea_id && f.linea_id !== filtro.linea_id) return false;
    if (filtro.temporada && f.agrupacion_estacionalidad?.temporada !== filtro.temporada) return false;
    if (filtro.agrupacion_estacionalidad_id && f.agrupacion_estacionalidad?.id !== filtro.agrupacion_estacionalidad_id) return false;
    if (filtro.agrupacion_marca_id && f.agrupacion_marca_id !== filtro.agrupacion_marca_id) return false;
    return true;
  });
}

function cifrasDeAnio(filas: readonly FilaPlana[], anio: number, conVenta: boolean): Cifras {
  const c = cero();
  for (const f of filas) {
    const r = registro(f, anio);
    if (!r) continue;
    if (conVenta) c.venta_a_la_fecha += r.vendido;
    const v = vigenteDe(r);
    if (r.bloque === "mismas") c.mismas += v;
    else if (r.bloque === "cierres") c.cierres += v;
    else if (r.subbloque === "nuevas_anterior") c.nuevas_anterior += v;
    else c.aperturas += v;
    c.total += v;
    if (f.tienda_id === null) {
      c.filas += 1;
      if (r.decidido !== null) c.decididas += 1;
    }
  }
  return c;
}

function resumirLinea(filas: readonly FilaPlana[], anio: number, umbral: number): Linea {
  const primera = filas[0];
  const en = cifrasDeAnio(filas, anio, true);
  const sg = cifrasDeAnio(filas, anio + 1, false);
  const avisos = [...new Set(filas.flatMap((f) => [...f.avisos, ...f.anios.flatMap((a) => a.avisos)]))];
  return {
    gml_id: primera.gml_id,
    ids: { genero_id: primera.genero_id, mundo_id: primera.mundo_id, linea_id: primera.linea_id },
    genero: primera.genero,
    mundo: primera.mundo,
    linea: primera.linea,
    agrupacion_marca: null,
    en_curso: en,
    siguiente: { mismas: sg.mismas, nuevas_anterior: sg.nuevas_anterior, aperturas: sg.aperturas, cierres: sg.cierres, total: sg.total, decididas: sg.decididas, filas: sg.filas },
    estado: estadoLinea(filas, anio, umbral),
    avisos,
    conTiendasNuevas: filas.some((f) => f.anios.some((a) => a.bloque === "nuevas" && vigenteDe(a) > 0)),
    colaLarga: filas.some((f) => f.tienda_id === null && (registro(f, anio)?.propuesto ?? Infinity) < umbral),
    paraRevision: filas.some((f) => filaParaRevision(f, anio)),
    curvaCambio: avisos.includes("curva_cambio"),
    propuestaCambio: avisos.includes("propuesta_cambio"),
  };
}

/** Fila base con algún año `revision_cola_larga` sin decidir (`0.10.1`). */
function filaParaRevision(f: FilaPlana, anioEnCurso: number): boolean {
  return f.activo && f.tienda_id === null && [anioEnCurso, anioEnCurso + 1].some((a) => { const r = registro(f, a); return r !== undefined && pendienteDeRevision(r); });
}

function pasaSolo(l: Linea, solo: SoloMatriz | null): boolean {
  switch (solo) {
    case null:
      return true;
    case "con_tiendas_nuevas":
      return l.conTiendasNuevas;
    case "sin_proyectar":
      return l.estado === "sin_proyectar";
    case "parciales":
      return l.estado === "parcial";
    case "curva_cambio":
      return l.curvaCambio;
    case "propuesta_cambio":
      return l.propuestaCambio;
    case "cola_larga":
      return l.colaLarga;
    case "para_revision":
      return l.paraRevision;
  }
}

function agruparPor<T>(items: readonly T[], clave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = clave(i);
    const l = m.get(k) ?? [];
    l.push(i);
    m.set(k, l);
  }
  return m;
}

function estadoDeHijos(hijos: readonly EstadoLinea[]): EstadoLinea {
  if (hijos.length === 0 || hijos.every((e) => e === "sin_proyectar")) return "sin_proyectar";
  if (hijos.includes("curva_cambio")) return "curva_cambio";
  if (hijos.includes("propuesta_cambio")) return "propuesta_cambio";
  if (hijos.every((e) => e === "proyectada")) return "proyectada";
  return "parcial";
}

function nodoDe(nivel: NodoMatrizApi["nivel"], nombre: string, ids: NodoMatrizApi["ids"], hijos: readonly Linea[]): NodoMatrizApi {
  const en = cero();
  const sg = cero();
  for (const h of hijos) {
    en.venta_a_la_fecha += h.en_curso.venta_a_la_fecha;
    sumarCifras(en, h.en_curso);
    sumarCifras(sg, h.siguiente);
  }
  return {
    nivel,
    ids,
    nombre,
    en_curso: en,
    siguiente: { mismas: sg.mismas, nuevas_anterior: sg.nuevas_anterior, aperturas: sg.aperturas, cierres: sg.cierres, total: sg.total, decididas: sg.decididas, filas: sg.filas },
    variacion_pct: en.total > 0 ? (sg.total / en.total - 1) * 100 : null,
    estado: estadoDeHijos(hijos.map((h) => h.estado)),
    avisos: [...new Set(hijos.flatMap((h) => h.avisos))].sort(),
  };
}

export type ResultadoMatriz = {
  nodos: NodoMatrizApi[];
  resumen: { lineas: number; lineas_total: number; porcentaje_total: number | null; filas_para_revision: number };
};

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * Regla 28. Sumas exactas por línea, mundo, género y compañía: `total_Z = mismas + nuevas_anterior + aperturas +
 * cierres`; `venta_a_la_fecha = Σ vendido` de todos los registros del año en curso. Con filtro, las sumas se
 * recalculan sobre lo filtrado y `porcentaje_total` dice qué parte del total del año en curso sin filtro representa.
 * `por = agrupacion_marca`: una fila por género × agrupación de marca.
 */
export function armarMatriz(
  filas: readonly FilaPlana[],
  opciones: { anio: number; filtro?: Partial<FiltroMatrizApi>; umbralColaLarga?: number }
): ResultadoMatriz {
  const umbral = opciones.umbralColaLarga ?? UMBRAL_COLA_LARGA;
  const filtro = { ...FILTRO_VACIO, ...opciones.filtro };
  const anio = opciones.anio;

  const todas = filas.filter((f) => f.activo);
  const lineasTotal = agruparPor(todas, (f) => f.gml_id);
  const totalSinFiltro = [...lineasTotal.values()].reduce((s, l) => s + cifrasDeAnio(l, anio, false).total, 0);

  const filtradas = filtrarFilas(filas, filtro);
  const porLinea = agruparPor(filtradas, (f) => f.gml_id);
  const lineas = [...porLinea.values()].map((l) => resumirLinea(l, anio, umbral)).filter((l) => pasaSolo(l, filtro.solo));

  const nodos: NodoMatrizApi[] = [];
  if (filtro.por === "agrupacion_marca") {
    // Una fila por género × agrupación de marca (las cifras salen de las filas, no de las líneas).
    const visibles = new Set(lineas.map((l) => l.gml_id));
    const filasVisibles = filtradas.filter((f) => visibles.has(f.gml_id));
    const porGenero = agruparPor(filasVisibles, (f) => f.genero_id);
    const hijosGenero: Linea[] = [];
    const bloquesGenero: NodoMatrizApi[] = [];
    for (const [, delGenero] of [...porGenero].sort((a, b) => comparar(a[1][0].genero, b[1][0].genero))) {
      const porAm = agruparPor(delGenero, (f) => f.agrupacion_marca_id);
      const hijos: Linea[] = [];
      const nodosAm: NodoMatrizApi[] = [];
      for (const [, delAm] of [...porAm].sort((a, b) => compararAgrupacionMarca(a[1][0], b[1][0]))) {
        const l = resumirLinea(delAm, anio, umbral);
        l.agrupacion_marca = delAm[0].agrupacion_marca;
        l.ids = { genero_id: delAm[0].genero_id, agrupacion_marca_id: delAm[0].agrupacion_marca_id };
        hijos.push(l);
        nodosAm.push(nodoDe("agrupacion_marca", delAm[0].agrupacion_marca, l.ids, [l]));
      }
      hijosGenero.push(...hijos);
      bloquesGenero.push(nodoDe("genero", delGenero[0].genero, { genero_id: delGenero[0].genero_id }, hijos), ...nodosAm);
    }
    nodos.push(nodoDe("compania", "Compañía", {}, hijosGenero), ...bloquesGenero);
  } else {
    nodos.push(nodoDe("compania", "Compañía", {}, lineas));
    const porGenero = agruparPor(lineas, (l) => l.ids.genero_id as string);
    for (const [, delGenero] of [...porGenero].sort((a, b) => comparar(a[1][0].genero, b[1][0].genero))) {
      nodos.push(nodoDe("genero", delGenero[0].genero, { genero_id: delGenero[0].ids.genero_id }, delGenero));
      const porMundo = agruparPor(delGenero, (l) => l.ids.mundo_id as string);
      for (const [, delMundo] of [...porMundo].sort((a, b) => comparar(a[1][0].mundo, b[1][0].mundo))) {
        nodos.push(nodoDe("mundo", delMundo[0].mundo, { genero_id: delMundo[0].ids.genero_id, mundo_id: delMundo[0].ids.mundo_id }, delMundo));
        for (const l of [...delMundo].sort((a, b) => comparar(a.linea, b.linea))) nodos.push(nodoDe("linea", l.linea, l.ids, [l]));
      }
    }
  }

  const compania = nodos[0];
  const lineasVisibles = new Set(lineas.map((l) => l.gml_id));
  return {
    nodos,
    resumen: {
      lineas: lineas.length,
      lineas_total: lineasTotal.size,
      filas_para_revision: filtradas.filter((f) => lineasVisibles.has(f.gml_id) && filaParaRevision(f, anio)).length,
      porcentaje_total: totalSinFiltro > 0 ? (compania.en_curso.total / totalSinFiltro) * 100 : null,
    },
  };
}

/** Estado de cada línea (para el índice lateral de la Parte 1). */
export function indiceDeLineas(
  filas: readonly FilaPlana[],
  anio: number,
  umbralColaLarga: number = UMBRAL_COLA_LARGA
): { gml_id: string; genero_id: string; mundo_id: string; linea_id: string; genero: string; mundo: string; linea: string; estado: EstadoLinea }[] {
  const porLinea = agruparPor(filas.filter((f) => f.activo), (f) => f.gml_id);
  return [...porLinea.values()]
    .map((l) => ({
      gml_id: l[0].gml_id,
      genero_id: l[0].genero_id,
      mundo_id: l[0].mundo_id,
      linea_id: l[0].linea_id,
      genero: l[0].genero,
      mundo: l[0].mundo,
      linea: l[0].linea,
      estado: estadoLinea(l, anio, umbralColaLarga),
    }))
    .sort((a, b) => comparar(a.genero, b.genero) || comparar(a.mundo, b.mundo) || comparar(a.linea, b.linea));
}

/** Las filas que sobreviven a todos los filtros de la matriz (incluido `solo`), para que mensual use el mismo recorte. */
export function filasVisibles(
  filas: readonly FilaPlana[],
  opciones: { anio: number; filtro?: Partial<FiltroMatrizApi>; umbralColaLarga?: number }
): FilaPlana[] {
  const umbral = opciones.umbralColaLarga ?? UMBRAL_COLA_LARGA;
  const filtro = { ...FILTRO_VACIO, ...opciones.filtro };
  const filtradas = filtrarFilas(filas, filtro);
  if (!filtro.solo) return filtradas;
  const porLinea = agruparPor(filtradas, (f) => f.gml_id);
  const pasan = new Set([...porLinea].filter(([, l]) => pasaSolo(resumirLinea(l, opciones.anio, umbral), filtro.solo)).map(([id]) => id));
  return filtradas.filter((f) => pasan.has(f.gml_id));
}
