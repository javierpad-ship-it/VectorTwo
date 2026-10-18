import { NextResponse } from "next/server";
import type { ContextoCalculo } from "@/lib/proyeccion/contexto";
import { unidadesFlujoEspecial, type EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { listarMeses } from "@/lib/ventas/periodo";
import type { FilaCerrada } from "@/lib/marcas-barrer/cerrada";
import { claveG } from "@/lib/marcas-barrer/tipos";
import { factores, periodos } from "./proyeccion.fixture";
import {
  AGRUPACIONES_PROY,
  OTROS,
  VIGENTES_PROY,
  cerradaB,
  equivalenciasDb,
  estadoB,
  hechosBeta,
  hechosGamma,
  nodosProy,
  ventaDe,
  type HechoSpec,
  type OtrosSpec,
} from "./marcas-barrer.fixture";

/**
 * El mundo falso que lee el servicio de M12 en las pruebas de las rutas: el estado de 02b (`estadoB`), el contexto de M1 a M7, la
 * cerrada de M7 y las dos funciones SQL (que aquí calcula el propio test a partir de `hechos`). Mutable: cada caso cambia lo suyo.
 */

export const esc = {
  estado: (): EstadoVistaGml => estadoB(),
  k: "2026-09",
  hechos: [] as HechoSpec[],
  otros: [] as OtrosSpec[],
  /** `false` = no hay proyección cerrada (`404 sin_cerrada` de M7). */
  hayCerrada: true,
  cerrada: [] as FilaCerrada[],
  llamadasCerrada: [] as number[],
};

export function reiniciarEsc() {
  esc.estado = () => estadoB();
  esc.k = "2026-09";
  esc.hechos = [...hechosBeta(), ...hechosGamma()];
  esc.otros = [...OTROS];
  esc.hayCerrada = true;
  esc.cerrada = cerradaB();
  esc.llamadasCerrada = [];
}
reiniciarEsc();

/** Lo que `cargarContextoCalculo` devuelve de M1 a M7 (solo lo que el servicio lee). */
export function ctxFalso(): ContextoCalculo {
  return {
    nodos: nodosProy(),
    vigentes: VIGENTES_PROY(),
    agrupaciones: AGRUPACIONES_PROY(),
    periodosClase: periodos(),
    factores: factores(),
    hastaDefecto: esc.k === "" ? null : esc.k,
    publicados: esc.k === "" ? [] : listarMeses("2024-10", esc.k),
  } as unknown as ContextoCalculo;
}

export const equivalenciasFalsas = () => equivalenciasDb().map((e) => ({ ...e, activo: true, agrupacion_estacionalidad_id: null }));

/** `GET /api/proyeccion/cerrada?anio=`: las filas del año, o `404 sin_cerrada`. */
export function respuestaCerrada(anio: number) {
  esc.llamadasCerrada.push(anio);
  if (!esc.hayCerrada) return { data: null, respuesta: NextResponse.json({ error: "No hay una proyección cerrada que cubra el año.", codigo: "sin_cerrada" }, { status: 404 }) };
  return { data: { filas: esc.cerrada.filter((f) => f.anio === anio) }, respuesta: null };
}

const enRango = (periodo: string, desde: string, hasta: string) => periodo.slice(0, 7) >= desde.slice(0, 7) && periodo.slice(0, 7) <= hasta.slice(0, 7);

/** Las dos funciones SQL: `venta_marca_gml` y `venta_marca_gml_resumen` sobre `esc.hechos` (sin el CD, que ya no está en los hechos). */
export function rpcFalso(nombre: string, args: Record<string, unknown>): unknown {
  const desde = String(args.p_desde);
  const hasta = String(args.p_hasta);
  const cargas: Record<string, string> = {};
  for (const m of esc.k === "" ? [] : listarMeses("2024-10", esc.k)) if (enRango(m, desde, hasta)) cargas[m] = `carga-${m}`;

  if (nombre === "venta_marca_gml") {
    const ids = new Set(args.p_marca_ids as string[]);
    const v = ventaDe(
      esc.hechos.filter((h) => ids.has(h.unidad) && enRango(h.mes, desde, hasta)),
      esc.otros.filter((o) => enRango(o.mes, desde, hasta))
    );
    return { hechos: v.hechos, totales: v.totales, cargas };
  }
  if (nombre === "venta_marca_gml_resumen") {
    const umbral = Number(args.p_umbral_pequeno ?? 50);
    const unidades = [...new Set(unidadesFlujoEspecial(esc.estado()).unidades.filter((u) => u.modalidad === "barrido").map((u) => u.marca_id))].sort();
    const porG = new Map<string, { unidad_marca_id: string; gml_id: string; equivalencia_id: string | null; unidades: number }>();
    for (const h of esc.hechos) {
      if (!unidades.includes(h.unidad) || !enRango(h.mes, desde, hasta)) continue;
      const k = `${h.unidad}|${claveG(h.nodo, h.eq ?? null)}`;
      const g = porG.get(k) ?? { unidad_marca_id: h.unidad, gml_id: h.nodo, equivalencia_id: h.eq ?? null, unidades: 0 };
      g.unidades += h.u;
      porG.set(k, g);
    }
    return {
      unidades: unidades.map((id) => {
        const gs = [...porG.values()].filter((g) => g.unidad_marca_id === id);
        return {
          unidad_marca_id: id,
          unidades: gs.reduce((a, g) => a + g.unidades, 0),
          gml_con_venta: gs.filter((g) => g.unidades > 0).length,
          gml_pequenos: gs.filter((g) => g.unidades > 0 && g.unidades < umbral).length,
        };
      }),
      por_gml: [...porG.values()],
      cargas,
    };
  }
  throw new Error(`rpc inesperado: ${nombre}`);
}
