import type { TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { curvaUnidad, type EquivalenciaCurva, type UnidadCurva } from "@/lib/marcas/gml/curva";
import type { ComponenteUnidad } from "./nino";
import type { AvisoFila, CurvaOrigen } from "./tipos-api";

/**
 * Curva de la fila (ficha 07, regla 25). Puro. Envuelve `curvaUnidad` de 02b: GMLE → la
 * curva vigente de su agrupación; GML → mezcla ponderada de las curvas de sus equivalencias
 * con pesos = unidades por equivalencia en `W12` sobre `M(Y)`. Todas las filas de una unidad
 * comparten curva.
 */

export type CurvaVigenteProy = {
  agrupacion_id: string;
  curva_id: string;
  version: number;
  curva: readonly number[];
  /** `eat_por_pliegue` del backtesting de M6, si la vigente lo trae (para la prueba con el año anterior). */
  eat_por_pliegue?: { anio: number; eat: number; error_max?: number }[];
};

export type AgrupacionProy = { id: string; nombre: string; temporada: TemporadaAgrupacion };

export type ResultadoCurvaFila = {
  curva: number[] | null;
  curva_origen: CurvaOrigen[];
  /** Agrupaciones con peso y curva (para `φ` por mes). */
  componentes: ComponenteUnidad[];
  avisos: AvisoFila[];
  /** La agrupación de mayor peso (empate: nombre); solo etiqueta para los filtros. */
  dominante: AgrupacionProy | null;
  /** Temporadas distintas con peso mayor que cero. */
  temporadas: TemporadaAgrupacion[];
};

/** Agrupación dominante: la de mayor peso; empate por nombre. */
export function agrupacionDominante(
  pesos: ReadonlyArray<{ agrupacion: AgrupacionProy; peso: number }>
): AgrupacionProy | null {
  let mejor: { agrupacion: AgrupacionProy; peso: number } | null = null;
  for (const p of pesos) {
    if (!(p.peso > 0)) continue;
    if (
      mejor === null ||
      p.peso > mejor.peso + 1e-12 ||
      (Math.abs(p.peso - mejor.peso) <= 1e-12 && p.agrupacion.nombre.localeCompare(mejor.agrupacion.nombre, "es") < 0)
    ) {
      mejor = p;
    }
  }
  return mejor ? mejor.agrupacion : null;
}

export function curvaFila(
  unidad: UnidadCurva,
  equivalencias: readonly EquivalenciaCurva[],
  vigentes: ReadonlyMap<string, CurvaVigenteProy>,
  agrupaciones: ReadonlyMap<string, AgrupacionProy>,
  pesos: ReadonlyMap<string, number>
): ResultadoCurvaFila {
  const curvas = new Map<string, readonly number[]>([...vigentes].map(([id, v]) => [id, v.curva]));

  // GML sin ventas en la ventana: los pesos valen 0 y la unidad quedaría sin curva; se reparten parejos entre
  // las equivalencias que sí tienen curva vigente (mejor una curva razonable que ninguna).
  let pesosEfectivos = pesos;
  if (unidad.nivel === "GML") {
    const algunoConPeso = equivalencias.some((e) => (pesos.get(e.id) ?? 0) > 0);
    if (!algunoConPeso) {
      pesosEfectivos = new Map(
        equivalencias.filter((e) => e.agrupacion_estacionalidad_id && vigentes.has(e.agrupacion_estacionalidad_id)).map((e) => [e.id, 1])
      );
    }
  }

  const resultado = curvaUnidad(unidad, equivalencias, curvas, pesosEfectivos);
  const avisos: AvisoFila[] = resultado.avisos.map(() => "curva_incompleta" as const);

  // Peso por agrupación sobre las equivalencias que sí entran en la mezcla.
  const porAgrupacion = new Map<string, number>();
  const candidatas = unidad.nivel === "GMLE" ? equivalencias.filter((e) => e.id === unidad.equivalencia_id) : equivalencias;
  for (const e of candidatas) {
    const a = e.agrupacion_estacionalidad_id;
    if (!a || !vigentes.has(a)) continue;
    const peso = unidad.nivel === "GMLE" ? 1 : (pesosEfectivos.get(e.id) ?? 0);
    if (!(peso > 0)) continue;
    porAgrupacion.set(a, (porAgrupacion.get(a) ?? 0) + peso);
  }
  const total = [...porAgrupacion.values()].reduce((a, b) => a + b, 0);

  const curva_origen: CurvaOrigen[] = [];
  const componentes: ComponenteUnidad[] = [];
  const conPeso: { agrupacion: AgrupacionProy; peso: number }[] = [];
  const idsOrdenados = [...porAgrupacion.keys()].sort((a, b) => {
    const na = agrupaciones.get(a)?.nombre ?? a;
    const nb = agrupaciones.get(b)?.nombre ?? b;
    return na.localeCompare(nb, "es") || a.localeCompare(b);
  });
  for (const id of idsOrdenados) {
    const v = vigentes.get(id);
    const ag = agrupaciones.get(id);
    if (!v || !ag || total <= 0) continue;
    const peso = (porAgrupacion.get(id) ?? 0) / total;
    curva_origen.push({ agrupacion_id: id, curva_id: v.curva_id, version: v.version, peso });
    componentes.push({ agrupacion_id: id, temporada: ag.temporada, peso, curva: v.curva });
    conPeso.push({ agrupacion: ag, peso });
  }

  const temporadas = [...new Set(componentes.map((c) => c.temporada))];
  if (temporadas.length > 1) avisos.push("temporadas_mezcladas");

  return {
    curva: resultado.curva,
    curva_origen: resultado.curva === null ? [] : curva_origen,
    componentes: resultado.curva === null ? [] : componentes,
    avisos,
    dominante: agrupacionDominante(conPeso),
    temporadas,
  };
}

/** ¿Cambió la versión de alguna agrupación entre lo usado y lo vigente? (ignora el peso). */
export function curvaCambio(usada: readonly CurvaOrigen[], vigente: readonly CurvaOrigen[]): boolean {
  if (usada.length === 0) return false;
  const clave = (c: CurvaOrigen) => `${c.agrupacion_id}:${c.curva_id}:${c.version}`;
  const a = usada.map(clave).sort().join("|");
  const b = vigente.map(clave).sort().join("|");
  return a !== b;
}

/** "HO INVIERNO v2 → v3" para el aviso de la curva que cambió. */
export function detalleCambioCurva(
  usada: readonly CurvaOrigen[],
  vigente: readonly CurvaOrigen[],
  nombres: ReadonlyMap<string, string>
): string[] {
  const salida: string[] = [];
  for (const v of vigente) {
    const u = usada.find((x) => x.agrupacion_id === v.agrupacion_id);
    if (u && (u.curva_id !== v.curva_id || u.version !== v.version)) {
      salida.push(`${nombres.get(v.agrupacion_id) ?? v.agrupacion_id} v${u.version} → v${v.version}`);
    }
  }
  return salida;
}
