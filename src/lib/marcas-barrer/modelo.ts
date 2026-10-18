import type { ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { clasificarHechos } from "./clasificar";
import { repartoSegunCerrada, type FilaCerrada, type ResultadoCerrada } from "./cerrada";
import { errorReparto } from "./error";
import { eat, estacionalidadGml, estacionalidadPropia, aniosCompletos, veredicto as veredictoEstacionalidad } from "./estacionalidad";
import {
  huellaAnalisis,
  huellaCargasBarrer,
  huellaConfig,
  llaveDiferencia,
  miembrosDeUnidad,
  type EntradaHuellaConfig,
} from "./huellas";
import { enAlcance, mesesDeVentana, repartoVectores, type ResultadoVectores } from "./reparto";
import { agruparPequenas, claveResto } from "./resto";
import { tendencia } from "./tendencia";
import {
  TEMPORADAS_DEFECTO,
  UMBRAL_GML_PEQUENO,
  type AlcanceApi,
  type AnalisisMarcaApi,
  type AvisoBarrer,
  type FilaRepartoApi,
  type FilaRestoApi,
  type FuenteReparto,
  type ModoEntrada,
  type OpcionAlcanceApi,
  type P2Api,
  type TemporadasConfig,
  type Ventana,
} from "./tipos-api";
import type { ClaveG, DatosMarca, LlaveVector, Mes, SerieG, UnidadG, VentaMarcaGml } from "./tipos";

/**
 * `analizarMarca` (ficha 12, regla 15): el análisis completo de una marca al barrer (o mixta) a partir de hechos YA agregados por
 * la función SQL, la configuración de 02b, las unidades `g` (curva y factor del Niño), la cerrada de M7 (opcional) y `k`. Puro,
 * determinista: misma entrada → misma salida; no muta la entrada ni lee el reloj. Se calcula A DEMANDA y no se guarda.
 */

export type EntradaAnalisis = {
  marca: DatosMarca;
  /** `k`: último mes cerrado de la ventana (`aaaa-mm`). */
  hasta: Mes;
  ventana: Ventana;
  modo: ModoEntrada;
  alcance: AlcanceApi;
  normaliza_nino: boolean;
  temporadas?: TemporadasConfig;
  config: ConfigFlujo;
  venta: VentaMarcaGml;
  /** La `g` con sus nombres, curva y factor del Niño; `null` si el nodo no se conoce (sus hechos no entran). */
  unidades: (clave: ClaveG) => UnidadG | null;
  /** Factores del Niño vigentes (`aplicado ?? calculado`), para mostrarlos en la cabecera; se filtran a los años de la ventana. */
  factores: readonly { anio: number; temporada: string; ratio: number | null }[];
  /** Las filas de la cerrada de los años que cubren los doce meses siguientes a `k`; `null` si no hay cerrada. */
  cerrada: readonly FilaCerrada[] | null;
};

/** Lo que `crearFilaVersion` y la evaluación del vigente necesitan de cada `g`. */
export type FilaInterna = {
  clave: ClaveG;
  gml_id: string;
  equivalencia_id: string | null;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  ruta: string;
  nivel: "GML" | "GMLE";
  unidades_ventana: number;
  /** `Σ ũ` en la ventana (el peso con que un resto se reparte entre sus miembros). */
  peso: number;
  pequena: boolean;
  grupo_resto: string | null;
  en_alcance: boolean;
  es_especifico: boolean;
};

export type InternoAnalisis = {
  meses: Mes[];
  /** Las `g` candidatas al reparto (en alcance y no específicas). */
  claves: ClaveG[];
  historico: ResultadoVectores;
  cerrada: ResultadoCerrada | null;
  filas: Map<ClaveG, FilaInterna>;
  huella_cargas: string;
  /** `huella_config` (`cfg.niv.ven`) con los niveles de las `g` del reparto; `fuente` es la que se vaya a guardar. */
  huellaConfig: (fuente: FuenteReparto) => string;
  entradaHuella: (fuente: FuenteReparto) => EntradaHuellaConfig;
  eat_pp: number | null;
};

export type ResultadoAnalisis = { api: AnalisisMarcaApi; interno: InternoAnalisis };

const MESES = 12;
const anioDe = (m: Mes) => Number(m.slice(0, 4));
const mesDe = (m: Mes) => Number(m.slice(5, 7));
const suma = (xs: Iterable<number>) => {
  let s = 0;
  for (const x of xs) s += x;
  return s;
};
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Llave de vector → temporada de la API (`anual` → `null`). */
const temporadaApi = (l: LlaveVector) => (l === "anual" ? null : l);

/** Vectores `(llave, clave) → participación` aplanados, para la huella y para comparar. */
export function aplanarVectores(v: Map<LlaveVector, Map<ClaveG, number> | null> | null | undefined): Map<string, number> {
  const r = new Map<string, number>();
  if (!v) return r;
  for (const [llave, vec] of v) if (vec) for (const [c, p] of vec) r.set(llaveDiferencia(llave, c), p);
  return r;
}

export function analizarMarca(e: EntradaAnalisis): ResultadoAnalisis {
  const temporadas = e.temporadas ?? TEMPORADAS_DEFECTO;
  const alcance = e.alcance;
  const meses = mesesDeVentana(e.hasta, e.ventana);
  const enVentana = new Set(meses);
  const avisos = new Set<AvisoBarrer>();

  // ── 1 y 2. Clasificación (u, e, U) sobre los meses de la ventana ──
  const hechos = e.venta.hechos.filter((h) => enVentana.has(recortarPeriodo(h.periodo)));
  const totales = e.venta.totales.filter((t) => enVentana.has(recortarPeriodo(t.periodo)));
  const { series } = clasificarHechos(hechos, totales, e.config, e.marca.id);
  const cargasVentana = Object.fromEntries(Object.entries(e.venta.cargas).filter(([m]) => enVentana.has(m)));
  const huellaCargas = huellaCargasBarrer(cargasVentana);

  const especificos = new Set(e.marca.modalidad === "mixta" ? e.marca.gml_especificos.map((g) => g.gml_id) : []);
  const esEspecifico = (gmlId: string) => especificos.has(gmlId);

  // Solo las `g` que el catálogo conoce.
  const conocidas = new Map<ClaveG, { s: SerieG; g: UnidadG }>();
  for (const s of series.values()) {
    const g = e.unidades(s.clave);
    if (g) conocidas.set(s.clave, { s, g });
  }

  // ── ũ = u ÷ φ ──
  const normalizada = new Map<ClaveG, Map<Mes, number>>();
  const avisosFactor = { sinFactor: false };
  for (const [clave, { s, g }] of conocidas) {
    const n = new Map<Mes, number>();
    for (const [mes, u] of s.u) {
      let phi = 1;
      if (e.normaliza_nino) {
        const f = g.phi(anioDe(mes))[mesDe(mes) - 1];
        if (typeof f === "number" && f > 0) phi = f;
        if (u !== 0 && g.sinFactor(anioDe(mes))) avisosFactor.sinFactor = true;
      }
      n.set(mes, u / phi);
    }
    normalizada.set(clave, n);
  }
  if (avisosFactor.sinFactor) avisos.add("sin_factor");

  // ── 3 y 4. Alcance y reparto del histórico ──
  const candidatas: ClaveG[] = [...conocidas.values()]
    .filter(({ g }) => enAlcance(g, alcance) && !esEspecifico(g.gml_id))
    .map(({ g }) => g.clave)
    .sort(cmp);
  const historico = repartoVectores(normalizada, candidatas, meses, e.modo, temporadas);
  for (const a of historico.avisos) avisos.add(a);

  // ── 7. Según la cerrada ──
  const incluir = (clave: ClaveG) => {
    const g = e.unidades(clave);
    return g !== null && enAlcance(g, alcance) && !esEspecifico(g.gml_id);
  };
  let cerrada: ResultadoCerrada | null = null;
  if (e.cerrada === null) {
    avisos.add("sin_cerrada");
  } else {
    cerrada = repartoSegunCerrada({
      filas: e.cerrada,
      marcaId: e.marca.id,
      agrupacionMarcaId: e.marca.agrupacion_marca_id,
      hasta: e.hasta,
      modo: historico.modo_efectivo,
      temporadas,
      incluir,
    });
    for (const a of cerrada.avisos) avisos.add(a);
    if (cerrada.vectores === null) cerrada = null;
  }
  const cerradaVec = cerrada?.vectores ?? null;

  // ── Filas por `g` ──
  const clavesFila = new Set<ClaveG>(conocidas.keys());
  if (cerrada) for (const c of cerrada.claves) if (e.unidades(c)) clavesFila.add(c);

  const internas = new Map<ClaveG, FilaInterna>();
  for (const clave of clavesFila) {
    const g = e.unidades(clave) as UnidadG;
    const s = conocidas.get(clave)?.s;
    const unidades_ventana = Math.round(suma(s?.u.values() ?? []));
    const dentro = enAlcance(g, alcance);
    const especifico = esEspecifico(g.gml_id);
    const incluida = dentro && !especifico;
    const pequena = incluida && unidades_ventana < UMBRAL_GML_PEQUENO;
    internas.set(clave, {
      clave,
      gml_id: g.gml_id,
      equivalencia_id: g.equivalencia_id,
      genero_id: g.genero_id,
      mundo_id: g.mundo_id,
      linea_id: g.linea_id,
      ruta: g.ruta,
      nivel: g.nivel,
      unidades_ventana,
      peso: Math.max(0, suma(normalizada.get(clave)?.values() ?? [])),
      pequena,
      grupo_resto: pequena ? claveResto(g.genero_id, g.mundo_id) : null,
      en_alcance: dentro,
      es_especifico: especifico,
    });
  }

  // ── Años y tendencias ──
  const completos = aniosCompletos(meses);
  const aniosVentana = [...new Set(meses.map(anioDe))].sort((a, b) => a - b);
  const mesesPorAnio = (a: number) => meses.filter((m) => anioDe(m) === a);

  const llaves: LlaveVector[] = historico.modo_efectivo === "anual" ? ["anual"] : ["verano", "invierno"];
  const p2De = (clave: ClaveG): P2Api[] =>
    llaves.map((llave) => {
      const vec = cerradaVec?.get(llave);
      return {
        temporada: temporadaApi(llave),
        historico: historico.vectores.get(llave)?.get(clave) ?? 0,
        cerrada: cerradaVec === null ? null : vec ? (vec.get(clave) ?? 0) : null,
        vigente: null,
        ajustado_vigente: null,
      };
    });

  const filas: FilaRepartoApi[] = [...internas.values()].map((f) => {
    const s = conocidas.get(f.clave)?.s;
    const normal = normalizada.get(f.clave) ?? new Map<Mes, number>();
    const p1m = (mes: Mes): number | null => {
      if (!s) return null;
      const U = s.U.get(mes) ?? 0;
      return U > 0 ? ((s.u.get(mes) ?? 0) + (s.e.get(mes) ?? 0)) / U : null;
    };
    const propio = (ms: readonly Mes[]) => suma(ms.map((m) => (s?.u.get(m) ?? 0) + (s?.e.get(m) ?? 0)));
    const totalPropio = propio(meses);
    const totalU_g = s ? suma(meses.map((m) => s.U.get(m) ?? 0)) : 0;
    return {
      clave: f.clave,
      gml_id: f.gml_id,
      equivalencia_id: f.equivalencia_id,
      genero_id: f.genero_id,
      mundo_id: f.mundo_id,
      linea_id: f.linea_id,
      ruta: f.ruta,
      nivel: f.nivel,
      unidades_ventana: f.unidades_ventana,
      pequena: f.pequena,
      grupo_resto: f.grupo_resto,
      en_alcance: f.en_alcance,
      p1_ventana: totalU_g > 0 ? totalPropio / totalU_g : null,
      p1_anual: aniosVentana.map((a) => {
        const ms = mesesPorAnio(a);
        const U = s ? suma(ms.map((m) => s.U.get(m) ?? 0)) : 0;
        return { anio: a, valor: U > 0 ? propio(ms) / U : null, completo: ms.length === MESES };
      }),
      p1_mensual: aniosVentana.map((a) => ({
        anio: a,
        meses: Array.from({ length: MESES }, (_, i) => {
          const mes = `${String(a).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
          return enVentana.has(mes) ? p1m(mes) : null;
        }),
      })),
      unidades_anual: aniosVentana.map((a) => {
        const ms = mesesPorAnio(a);
        return { anio: a, unidades: Math.round(suma(ms.map((m) => s?.u.get(m) ?? 0))), completo: ms.length === MESES };
      }),
      tendencia: tendencia(normal, completos),
      // Una `g` dentro del alcance lleva su `p2` (en un GML específico de una mixta vale 0); fuera del alcance no hay reparto.
      p2: f.en_alcance ? p2De(f.clave) : [],
      es_especifico: f.es_especifico,
    };
  });
  filas.sort((a, b) => b.unidades_ventana - a.unidades_ventana || cmp(a.ruta, b.ruta) || cmp(a.clave, b.clave));

  // ── 5. Resto ──
  const pequenas = [...internas.values()].filter((f) => f.pequena);
  const { restos } = agruparPequenas(pequenas, UMBRAL_GML_PEQUENO);
  const filaApi = new Map(filas.map((f) => [f.clave, f]));
  const restosApi: FilaRestoApi[] = restos.map((r) => {
    const miembros = r.miembros.map((m) => filaApi.get(m.clave) as FilaRepartoApi);
    const primero = e.unidades(r.miembros[0].clave) as UnidadG;
    const p2 = llaves.map((llave, i) => {
      const celdas = miembros.map((f) => f.p2[i]);
      const algunaCerrada = celdas.some((c) => c.cerrada !== null);
      return {
        temporada: temporadaApi(llave),
        historico: suma(celdas.map((c) => c.historico)),
        cerrada: algunaCerrada ? suma(celdas.map((c) => c.cerrada ?? 0)) : null,
        vigente: null,
        ajustado_vigente: null,
      };
    });
    return {
      grupo_resto: r.grupo_resto,
      etiqueta: `Resto de ${primero.genero} · ${primero.mundo}`,
      miembros: r.miembros.map((m) => m.clave),
      unidades_ventana: suma(r.miembros.map((m) => m.unidades_ventana)),
      p2,
    };
  });
  restosApi.sort((a, b) => cmp(a.etiqueta, b.etiqueta) || cmp(a.grupo_resto, b.grupo_resto));

  // ── 6. Error del reparto ──
  const err = errorReparto({ series: normalizada, claves: candidatas, meses, modo: e.modo, temporadas });
  for (const a of err.avisos) avisos.add(a);

  // ── 8. Estacionalidad y tendencia total ──
  const serieTotal = new Map<Mes, number>();
  for (const [clave, n] of normalizada) {
    if (!conocidas.has(clave)) continue;
    for (const [m, v] of n) serieTotal.set(m, (serieTotal.get(m) ?? 0) + v);
  }
  const propia = estacionalidadPropia(serieTotal, completos);
  if (completos.length === 0) avisos.add("sin_anio_completo");
  const anualVec = historico.vectores.get("anual") ?? (historico.modo_efectivo === "anual" ? null : mezclaAnual(normalizada, candidatas, meses));
  const gmlCurva = anualVec ? estacionalidadGml(anualVec, (c) => e.unidades(c)?.curva ?? null) : { curva: null, avisos: [] as AvisoBarrer[] };
  for (const a of gmlCurva.avisos) avisos.add(a);
  const eatPp = propia && gmlCurva.curva ? eat(propia, gmlCurva.curva) : null;

  // ── 9. Parte al barrer ──
  const uBarrer = suma([...conocidas.values()].map(({ s }) => suma(s.u.values())));
  const uEspecifica = suma([...conocidas.values()].map(({ s }) => suma(s.e.values())));
  let share = 1;
  if (e.marca.modalidad === "mixta") {
    if (e.marca.gml_especificos.length === 0) avisos.add("mixta_sin_gml");
    share = uBarrer + uEspecifica > 0 ? uBarrer / (uBarrer + uEspecifica) : 1;
  }

  // ── Opciones de alcance ──
  const opciones = {
    generos: new Map<string, OpcionAlcanceApi>(),
    mundos: new Map<string, OpcionAlcanceApi>(),
    lineas: new Map<string, OpcionAlcanceApi>(),
  };
  for (const f of internas.values()) {
    if (f.es_especifico || f.unidades_ventana <= 0) continue;
    const g = e.unidades(f.clave) as UnidadG;
    opciones.generos.set(g.genero_id, { id: g.genero_id, nombre: g.genero });
    opciones.mundos.set(g.mundo_id, { id: g.mundo_id, nombre: g.mundo });
    opciones.lineas.set(g.linea_id, { id: g.linea_id, nombre: g.linea });
  }
  const ordenar = (m: Map<string, OpcionAlcanceApi>) => [...m.values()].sort((a, b) => cmp(a.nombre, b.nombre) || cmp(a.id, b.id));

  // ── Huellas ──
  const nivelDe = (gmlId: string): "GML" | "GMLE" => (e.config.nivelDeNodo.get(gmlId) === "GMLE" ? "GMLE" : "GML");
  const nivelesDelReparto = new Map<string, "GML" | "GMLE">();
  for (const c of candidatas) {
    const f = internas.get(c);
    if (f && (historico.vectores.get("anual")?.has(c) || historico.vectores.get("verano")?.has(c) || historico.vectores.get("invierno")?.has(c))) {
      nivelesDelReparto.set(f.gml_id, nivelDe(f.gml_id));
    }
  }
  const entradaHuella = (fuente: FuenteReparto): EntradaHuellaConfig => ({
    modalidad: e.marca.modalidad,
    agrupacion_marca_id: e.marca.agrupacion_marca_id,
    gml_especificos: e.marca.gml_especificos.map((g) => g.gml_id),
    miembros: miembrosDeUnidad(e.config, e.marca.id),
    temporadas,
    modo: e.modo,
    alcance,
    fuente,
    normaliza_nino: e.normaliza_nino,
    niveles: nivelesDelReparto,
    ventana_meses: e.ventana,
  });
  const huellaConfigDe = (fuente: FuenteReparto) => huellaConfig(entradaHuella(fuente));
  const huella = huellaAnalisis(
    { huella_cargas: huellaCargas, huella_config: huellaConfigDe("historico") },
    aplanarVectores(historico.vectores),
    cerradaVec ? aplanarVectores(cerradaVec) : null
  );

  const anioVentana = new Set(aniosVentana);
  const api: AnalisisMarcaApi = {
    marca: {
      id: e.marca.id,
      nombre: e.marca.nombre,
      modalidad: e.marca.modalidad,
      agrupacion_marca: e.marca.agrupacion_marca,
      miembros: [...e.marca.miembros],
      gml_especificos: e.marca.gml_especificos.map((g) => ({ ...g })),
    },
    parametros: {
      ventana_meses: e.ventana,
      modo: e.modo,
      modo_efectivo: historico.modo_efectivo,
      fuente_disponible: cerradaVec ? ["historico", "cerrada"] : ["historico"],
      alcance: { generos: [...alcance.generos], mundos: [...alcance.mundos], lineas: [...alcance.lineas] },
      normaliza_nino: e.normaliza_nino,
      hasta_periodo: e.hasta,
      desde_periodo: meses[0],
      factores: e.factores
        .filter((f) => anioVentana.has(f.anio))
        .map((f) => ({ anio: f.anio, temporada: f.temporada, ratio: f.ratio }))
        .sort((a, b) => a.anio - b.anio || cmp(a.temporada, b.temporada)),
      temporadas,
      meses_por_temporada: [
        { temporada: "verano", meses: historico.meses_por_temporada.verano },
        { temporada: "invierno", meses: historico.meses_por_temporada.invierno },
      ],
    },
    filas,
    restos: restosApi,
    opciones_alcance: { generos: ordenar(opciones.generos), mundos: ordenar(opciones.mundos), lineas: ordenar(opciones.lineas) },
    fuera_de_alcance: [...internas.values()]
      .filter((f) => !f.en_alcance && !f.es_especifico && f.unidades_ventana > 0)
      .map((f) => ({ ruta: f.ruta, unidades: f.unidades_ventana }))
      .sort((a, b) => b.unidades - a.unidades || cmp(a.ruta, b.ruta)),
    share_barrido: share,
    unidades_barrer: Math.round(uBarrer),
    unidades_especificas: Math.round(uEspecifica),
    error_reparto: {
      pp: err.pp,
      veredicto: err.veredicto,
      anios: err.anios.map((a) => ({ anio: a.anio, pp: a.pp })),
    },
    estacionalidad: {
      propia,
      gml: gmlCurva.curva,
      eat_pp: eatPp,
      veredicto: veredictoEstacionalidad(eatPp),
      anios_completos: completos,
    },
    tendencia_total: tendencia(serieTotal, completos),
    vigente: null,
    obsoleto: [],
    avisos: [...avisos].sort(),
    huella,
  };

  return {
    api,
    interno: {
      meses,
      claves: candidatas,
      historico,
      cerrada,
      filas: internas,
      huella_cargas: huellaCargas,
      huellaConfig: huellaConfigDe,
      entradaHuella,
      eat_pp: eatPp,
    },
  };
}

/** Vector anual de respaldo (cuando el modo es por temporada) para comparar la estacionalidad con la del GML. */
function mezclaAnual(series: ReadonlyMap<ClaveG, ReadonlyMap<Mes, number>>, claves: readonly ClaveG[], meses: readonly Mes[]): Map<ClaveG, number> | null {
  const sumas = new Map<ClaveG, number>();
  let total = 0;
  for (const c of claves) {
    let x = 0;
    for (const m of meses) x += series.get(c)?.get(m) ?? 0;
    if (x > 0) {
      sumas.set(c, x);
      total += x;
    }
  }
  if (!(total > 0)) return null;
  return new Map([...sumas].map(([c, x]) => [c, x / total]));
}
