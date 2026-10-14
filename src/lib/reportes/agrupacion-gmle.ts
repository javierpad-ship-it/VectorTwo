import { compararNombre, compararOrdenNombre, ordenarEquivalencias } from "@/lib/arbol/armar-arbol";
import { esNivelPlanificacion } from "@/lib/arbol/normalizar";
import { armarRuta } from "@/lib/estacionalidad/aplanar";
import { generoPermitido } from "@/lib/estacionalidad/reglas";
import type { EquivalenciaPlana, ReporteEstacionalidad } from "@/lib/estacionalidad/tipos";
import type {
  AgrupacionDeLineaPartidaGmle,
  AgrupacionGmle,
  AgrupacionNodoGmle,
  AnomaliaGmle,
  ConteoAnomaliasGmle,
  EquivalenciaGmle,
  LineaPartidaGmle,
  NivelGmle,
  NodoGmle,
  ReporteAgrupacionGmle,
  RepartoNodoGmle,
  UnidadGmle,
} from "./tipos-api";
import { ANOMALIAS_GMLE } from "./tipos-api";

/**
 * Reporte de agrupación GMLE (docs/modulos/11-reporte-agrupacion-gmle.md).
 * Función pura: cruza la lista plana de M3 (con inactivos) con el nivel de
 * planificación (02b) de cada nodo. No lee la base, no muta la entrada y el
 * orden de salida es fijo (regla 9).
 */

/**
 * Los nodos tal como llegan de `genero_mundo_linea` (`select("*")`). Con `id` y
 * `nivel_planificacion` basta para clasificar las equivalencias; si además
 * traen género, mundo, línea y `activo`, los nodos que no tienen ninguna
 * equivalencia también salen en `nodos` (con cero unidades).
 */
export type NodoNivelEntrada = {
  id: string;
  nivel_planificacion?: string | null;
  genero_id?: string;
  mundo_id?: string;
  linea_id?: string;
  activo?: boolean;
};

type NodoTrabajo = {
  id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  vigente: boolean;
  nivel: NivelGmle;
  /** Todas las filas del nodo (activas o no), ya en el orden del contrato. */
  filas: EquivalenciaPlana[];
};

/** Equivalencia dentro del universo vigente (regla 1). */
const cuenta = (e: EquivalenciaPlana): boolean => e.activo && e.vigente;

/** Agrupación activa de una fila, o `null` (sin agrupación o agrupación inactiva). */
const agrupacionActivaDe = (e: EquivalenciaPlana): string | null => (e.agrupacion?.activo ? e.agrupacion.id : null);

function ceroAnomalias(): ConteoAnomaliasGmle {
  return {
    sin_agrupacion: 0,
    genero_no_incluido: 0,
    generica_discrepante: 0,
    nodo_gml_mixto: 0,
    linea_partida: 0,
    agrupacion_vacia: 0,
  };
}

/** Anomalías en el orden fijo de `ANOMALIAS_GMLE`. */
function ordenarAnomalias(codigos: Set<AnomaliaGmle>): AnomaliaGmle[] {
  return ANOMALIAS_GMLE.filter((c) => codigos.has(c));
}

/** Regla 4: la agrupación con más equivalencias reales; empate → `null`; sin reales con agrupación, la de la genérica. */
function mayoritariaDelNodo(vigentes: EquivalenciaPlana[]): string | null {
  const votos = new Map<string, number>();
  for (const e of vigentes) {
    if (e.es_generica) continue;
    const id = agrupacionActivaDe(e);
    if (id !== null) votos.set(id, (votos.get(id) ?? 0) + 1);
  }
  if (votos.size > 0) {
    const maximo = Math.max(...votos.values());
    const lideres = [...votos].filter(([, n]) => n === maximo);
    return lideres.length === 1 ? (lideres[0]?.[0] ?? null) : null;
  }
  const deGenericas = new Set<string>();
  for (const e of vigentes) {
    const id = e.es_generica ? agrupacionActivaDe(e) : null;
    if (id !== null) deGenericas.add(id);
  }
  return deGenericas.size === 1 ? ([...deGenericas][0] ?? null) : null;
}

export function armarReporteAgrupacionGmle(
  reporteM3: ReporteEstacionalidad,
  nodos: readonly NodoNivelEntrada[]
): ReporteAgrupacionGmle {
  // ─── Catálogos, en el orden fijo del contrato ───
  const generos = [...reporteM3.generos].sort(compararOrdenNombre);
  const mundos = [...reporteM3.mundos].sort(compararOrdenNombre);
  const lineas = [...reporteM3.lineas].sort((a, b) => compararNombre(a.nombre, b.nombre) || a.id.localeCompare(b.id));
  const posGenero = new Map(generos.map((g, i) => [g.id, i]));
  const posMundo = new Map(mundos.map((m, i) => [m.id, i]));
  const posLinea = new Map(lineas.map((l, i) => [l.id, i]));
  const generoPorId = new Map(generos.map((g) => [g.id, g]));
  const mundoPorId = new Map(mundos.map((m) => [m.id, m]));
  const lineaPorId = new Map(lineas.map((l) => [l.id, l]));
  const agrupaciones = [...reporteM3.agrupaciones].sort(
    (a, b) => compararNombre(a.nombre, b.nombre) || a.id.localeCompare(b.id)
  );
  const agrupacionPorId = new Map(agrupaciones.map((a) => [a.id, a]));
  const nombreAgrupacion = (id: string | null): string => (id === null ? "" : (agrupacionPorId.get(id)?.nombre ?? ""));

  const nivelPorNodo = new Map<string, NivelGmle>(
    nodos.map((n) => [n.id, esNivelPlanificacion(n.nivel_planificacion) ? n.nivel_planificacion : "GML"])
  );

  // ─── Nodos: los de las filas y, si se pueden armar, los que no tienen ninguna ───
  const filasPorNodo = new Map<string, EquivalenciaPlana[]>();
  for (const e of [...reporteM3.equivalencias].sort((a, b) => a.id.localeCompare(b.id))) {
    const lista = filasPorNodo.get(e.nodo_id) ?? [];
    lista.push(e);
    filasPorNodo.set(e.nodo_id, lista);
  }

  const trabajo: NodoTrabajo[] = [];
  for (const [id, filas] of filasPorNodo) {
    const primera = filas[0];
    if (!primera) continue;
    trabajo.push({
      id,
      genero_id: primera.genero_id,
      mundo_id: primera.mundo_id,
      linea_id: primera.linea_id,
      vigente: primera.vigente,
      nivel: nivelPorNodo.get(id) ?? "GML",
      filas: ordenarEquivalencias(filas),
    });
  }
  for (const n of nodos) {
    if (filasPorNodo.has(n.id)) continue;
    if (n.genero_id === undefined || n.mundo_id === undefined || n.linea_id === undefined || n.activo === undefined) continue;
    const g = generoPorId.get(n.genero_id);
    const m = mundoPorId.get(n.mundo_id);
    const l = lineaPorId.get(n.linea_id);
    if (!g || !m || !l) continue;
    trabajo.push({
      id: n.id,
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      vigente: n.activo && g.activo && m.activo && l.activo,
      nivel: nivelPorNodo.get(n.id) ?? "GML",
      filas: [],
    });
  }
  const rango = (mapa: Map<string, number>, id: string) => mapa.get(id) ?? Number.MAX_SAFE_INTEGER;
  trabajo.sort(
    (a, b) =>
      rango(posGenero, a.genero_id) - rango(posGenero, b.genero_id) ||
      rango(posMundo, a.mundo_id) - rango(posMundo, b.mundo_id) ||
      rango(posLinea, a.linea_id) - rango(posLinea, b.linea_id) ||
      a.id.localeCompare(b.id)
  );

  // ─── Línea partida: género · línea con todos sus mundos (regla 7) ───
  type AcumuladoLinea = { genero_id: string; linea_id: string; porAgrupacion: Map<string, { equivalencias: number; mundos: Set<string> }> };
  const acumuladoLineas = new Map<string, AcumuladoLinea>();
  for (const nodo of trabajo) {
    for (const e of nodo.filas) {
      const agrupacionId = cuenta(e) ? agrupacionActivaDe(e) : null;
      if (agrupacionId === null) continue;
      const clave = `${nodo.genero_id}|${nodo.linea_id}`;
      const linea = acumuladoLineas.get(clave) ?? { genero_id: nodo.genero_id, linea_id: nodo.linea_id, porAgrupacion: new Map() };
      const entrada = linea.porAgrupacion.get(agrupacionId) ?? { equivalencias: 0, mundos: new Set<string>() };
      entrada.equivalencias += 1;
      entrada.mundos.add(nodo.mundo_id);
      linea.porAgrupacion.set(agrupacionId, entrada);
      acumuladoLineas.set(clave, linea);
    }
  }
  const lineasPartidas: LineaPartidaGmle[] = [...acumuladoLineas.values()]
    .filter((l) => l.porAgrupacion.size >= 2)
    .sort(
      (a, b) =>
        rango(posGenero, a.genero_id) - rango(posGenero, b.genero_id) ||
        rango(posLinea, a.linea_id) - rango(posLinea, b.linea_id)
    )
    .map((l) => ({
      genero_id: l.genero_id,
      linea_id: l.linea_id,
      genero: generoPorId.get(l.genero_id)?.nombre ?? "",
      linea: lineaPorId.get(l.linea_id)?.nombre ?? "",
      agrupaciones: [...l.porAgrupacion]
        .map(([id, v]): AgrupacionDeLineaPartidaGmle => ({
          id,
          nombre: nombreAgrupacion(id),
          equivalencias: v.equivalencias,
          mundos: [...v.mundos]
            .sort((a, b) => rango(posMundo, a) - rango(posMundo, b))
            .map((m) => mundoPorId.get(m)?.nombre ?? ""),
        }))
        .sort((a, b) => compararNombre(a.nombre, b.nombre) || a.id.localeCompare(b.id)),
    }));
  const lineaPartida = new Set(lineasPartidas.map((l) => `${l.genero_id}|${l.linea_id}`));

  // ─── Nodos y equivalencias ───
  const nodosSalida: NodoGmle[] = [];
  const equivalenciasSalida: EquivalenciaGmle[] = [];
  const conteo = ceroAnomalias();

  const porAgrupacion = new Map<
    string,
    { nodos_gml: number; nodos_gml_mixtos: number; unidades_gmle: number; equivalencias: number; genericas: number; lineas: Set<string> }
  >(
    agrupaciones.map((a) => [
      a.id,
      { nodos_gml: 0, nodos_gml_mixtos: 0, unidades_gmle: 0, equivalencias: 0, genericas: 0, lineas: new Set<string>() },
    ])
  );

  let nodosVigentes = 0;
  let nodosGml = 0;
  let nodosGmle = 0;
  let nodosMixtos = 0;
  let unidades = 0;
  let equivalenciasVigentes = 0;
  let genericasVigentes = 0;

  for (const nodo of trabajo) {
    const vigentes = nodo.filas.filter(cuenta);

    // Reparto: la agrupación activa de cada equivalencia vigente; el resto cuenta en `null`.
    const conteoReparto = new Map<string | null, number>();
    for (const e of vigentes) {
      const id = agrupacionActivaDe(e);
      conteoReparto.set(id, (conteoReparto.get(id) ?? 0) + 1);
    }
    const reparto: RepartoNodoGmle[] = [...conteoReparto]
      .map(([agrupacion_id, equivalencias]) => ({ agrupacion_id, equivalencias }))
      .sort((a, b) => {
        if ((a.agrupacion_id === null) !== (b.agrupacion_id === null)) return a.agrupacion_id === null ? 1 : -1;
        return (
          b.equivalencias - a.equivalencias ||
          compararNombre(nombreAgrupacion(a.agrupacion_id), nombreAgrupacion(b.agrupacion_id)) ||
          (a.agrupacion_id ?? "").localeCompare(b.agrupacion_id ?? "")
        );
      });
    const activasDelReparto = reparto.filter((r) => r.agrupacion_id !== null);

    // Regla 3: solo en GML.
    let agrupacionNodo: AgrupacionNodoGmle | null = null;
    if (nodo.nivel === "GML") {
      agrupacionNodo = activasDelReparto.length === 0 ? "sin" : activasDelReparto.length === 1 ? "unica" : "mixta";
    }
    const agrupacionId = agrupacionNodo === "unica" ? (activasDelReparto[0]?.agrupacion_id ?? null) : null;
    const mixto = nodo.vigente && agrupacionNodo === "mixta"; // regla 7: un GMLE nunca lo es

    // Regla 2: unidades.
    const unidadesNodo = nodo.nivel === "GMLE" ? vigentes.length : vigentes.length > 0 ? 1 : 0;
    const mayoritariaId = mayoritariaDelNodo(vigentes);

    const anomaliasNodo = new Set<AnomaliaGmle>();
    if (mixto) anomaliasNodo.add("nodo_gml_mixto");

    nodosSalida.push({
      id: nodo.id,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      linea_id: nodo.linea_id,
      ruta: armarRuta(
        generoPorId.get(nodo.genero_id)?.nombre ?? "",
        mundoPorId.get(nodo.mundo_id)?.nombre ?? "",
        lineaPorId.get(nodo.linea_id)?.nombre ?? ""
      ),
      nivel: nodo.nivel,
      vigente: nodo.vigente,
      unidades: unidadesNodo,
      agrupacion_nodo: agrupacionNodo,
      agrupacion_id: agrupacionId,
      mayoritaria_id: mayoritariaId,
      reparto,
      anomalias: ordenarAnomalias(anomaliasNodo),
    });

    if (nodo.vigente) {
      nodosVigentes += 1;
      if (nodo.nivel === "GML") nodosGml += 1;
      else nodosGmle += 1;
      if (mixto) {
        nodosMixtos += 1;
        conteo.nodo_gml_mixto += 1;
        for (const r of activasDelReparto) {
          const acumulado = r.agrupacion_id === null ? undefined : porAgrupacion.get(r.agrupacion_id);
          if (acumulado) acumulado.nodos_gml_mixtos += 1;
        }
      }
      if (agrupacionId !== null) {
        const acumulado = porAgrupacion.get(agrupacionId);
        if (acumulado) acumulado.nodos_gml += 1;
      }
      unidades += unidadesNodo;
    }

    // Filas del nodo.
    const unidad: UnidadGmle = nodo.vigente ? (nodo.nivel === "GML" ? "nodo" : "equivalencia") : "ninguna";
    const generoNombre = generoPorId.get(nodo.genero_id)?.nombre ?? "";
    const mundoNombre = mundoPorId.get(nodo.mundo_id)?.nombre ?? "";
    const lineaNombre = lineaPorId.get(nodo.linea_id)?.nombre ?? "";
    const enLineaPartida = lineaPartida.has(`${nodo.genero_id}|${nodo.linea_id}`);

    for (const e of nodo.filas) {
      const dentro = cuenta(e);
      const agrupacion = e.agrupacion ? agrupacionPorId.get(e.agrupacion.id) : undefined;
      const anomalias = new Set<AnomaliaGmle>();

      if (dentro) {
        if (e.motivo_faltante !== null) anomalias.add("sin_agrupacion");
        if (agrupacion && !generoPermitido(agrupacion, nodo.genero_id)) anomalias.add("genero_no_incluido");
        const activaId = agrupacionActivaDe(e);
        if (e.es_generica && activaId !== null && mayoritariaId !== null && activaId !== mayoritariaId) {
          anomalias.add("generica_discrepante");
        }
        if (mixto) anomalias.add("nodo_gml_mixto");
        if (enLineaPartida) anomalias.add("linea_partida");

        equivalenciasVigentes += 1;
        if (e.es_generica) genericasVigentes += 1;
        for (const c of anomalias) {
          if (c === "nodo_gml_mixto") continue; // se cuenta por nodo
          if (c === "linea_partida") continue; // se cuenta por línea
          conteo[c] += 1;
        }
        const acumulado = e.agrupacion ? porAgrupacion.get(e.agrupacion.id) : undefined;
        if (acumulado) {
          acumulado.equivalencias += 1;
          if (e.es_generica) acumulado.genericas += 1;
          acumulado.lineas.add(nodo.linea_id);
          if (nodo.nivel === "GMLE") acumulado.unidades_gmle += 1;
        }
      }

      equivalenciasSalida.push({
        id: e.id,
        nodo_id: nodo.id,
        agrupacion_id: agrupacion?.id ?? null,
        agrupacion: agrupacion?.nombre ?? "",
        temporada: agrupacion?.temporada ?? null,
        genero: generoNombre,
        mundo: mundoNombre,
        linea: lineaNombre,
        nivel: nodo.nivel,
        unidad: dentro ? unidad : "ninguna",
        equivalencia: e.nombre,
        codigo: e.codigo,
        es_generica: e.es_generica,
        activo: e.activo,
        vigente: e.vigente,
        agrupacion_activa: agrupacion?.activo ?? false,
        anomalias: ordenarAnomalias(anomalias),
      });
    }
  }
  conteo.linea_partida = lineasPartidas.length;

  // ─── Agrupaciones ───
  const nombreGenero = new Map(generos.map((g) => [g.id, g.nombre]));
  const agrupacionesSalida: AgrupacionGmle[] = agrupaciones.map((a) => {
    const v = porAgrupacion.get(a.id);
    const equivalencias = v?.equivalencias ?? 0;
    const vacia = a.activo && equivalencias === 0;
    if (vacia) conteo.agrupacion_vacia += 1;
    return {
      id: a.id,
      codigo: a.codigo,
      nombre: a.nombre,
      temporada: a.temporada,
      activo: a.activo,
      generos: a.genero_ids
        .filter((id) => nombreGenero.has(id))
        .map((id) => ({ id, nombre: nombreGenero.get(id) ?? "" }))
        .sort((x, y) => rango(posGenero, x.id) - rango(posGenero, y.id)),
      nodos_gml: v?.nodos_gml ?? 0,
      nodos_gml_mixtos: v?.nodos_gml_mixtos ?? 0,
      unidades_gmle: v?.unidades_gmle ?? 0,
      equivalencias,
      genericas: v?.genericas ?? 0,
      lineas: v?.lineas.size ?? 0,
      anomalias: vacia ? ["agrupacion_vacia"] : [],
    };
  });

  // Las filas de `equivalencias` salen en el orden de los nodos ya ordenados.
  return {
    resumen: {
      agrupaciones: agrupaciones.length,
      agrupaciones_activas: agrupaciones.filter((a) => a.activo).length,
      nodos: nodosVigentes,
      nodos_gml: nodosGml,
      nodos_gmle: nodosGmle,
      nodos_gml_mixtos: nodosMixtos,
      unidades,
      equivalencias: equivalenciasVigentes,
      genericas: genericasVigentes,
      anomalias: conteo,
    },
    agrupaciones: agrupacionesSalida,
    nodos: nodosSalida,
    equivalencias: equivalenciasSalida,
    lineas_partidas: lineasPartidas,
    catalogos: {
      generos: generos.map(({ id, nombre, orden, activo }) => ({ id, nombre, orden, activo })),
      mundos: mundos.map(({ id, nombre, orden, activo }) => ({ id, nombre, orden, activo })),
    },
  };
}
