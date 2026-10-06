import { compararNombre, compararOrdenNombre } from "@/lib/arbol/armar-arbol";
import type { CatalogoPlanoEstacionalidad, EquivalenciaPlana, LineaPlana } from "./tipos-api";

/**
 * Agregación de la pestaña Mapa de /maestros/estacionalidad: una tarjeta por
 * agrupación y la cobertura por género, a partir de la lista plana que el
 * panel ya tiene en memoria. Pura, sin React; se prueba en
 * `tests/estacionalidad.mapa.test.ts`.
 *
 * Cuenta solo las equivalencias **activas y vigentes** (igual que el resumen
 * del panel). Una equivalencia cuya agrupación está inactiva aparece en la
 * tarjeta de esa agrupación (está asignada) y, además, entre las faltantes
 * (regla 7); en la barra de cobertura va solo en el tramo de faltantes para
 * no contarla dos veces.
 */

export type AgrupacionMapaEntrada = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  orden: number;
  activo: boolean;
  /** Géneros de la agrupación (si el catálogo los trae); la tarjeta los pinta o marca "Sin género". */
  generos?: readonly { id: string; codigo?: string; nombre: string }[];
};

export type ConteoGenero = { id: string; nombre: string; conteo: number };

export type LineaMapa = {
  id: string;
  nombre: string;
  conteo: number;
  equivalencias: EquivalenciaMapa[];
};

export type EquivalenciaMapa = {
  id: string;
  nombre: string;
  codigo: string;
  es_generica: boolean;
  /** "GÉNERO / MUNDO" (la ruta sin la línea, que ya encabeza el grupo). */
  rutaCorta: string;
  /** Solo en la tarjeta "Sin agrupación": por qué falta. */
  motivo_faltante: EquivalenciaPlana["motivo_faltante"];
};

export type TarjetaMapa = {
  agrupacion: AgrupacionMapaEntrada;
  /** Equivalencias activas y vigentes asignadas. */
  total: number;
  /** Solo géneros con conteo > 0, en el orden del catálogo. */
  porGenero: ConteoGenero[];
  /** Líneas por nombre, cada una con sus equivalencias en el orden de la lista plana. */
  lineas: LineaMapa[];
};

export type SegmentoCobertura = { agrupacionId: string; nombre: string; conteo: number };

export type CoberturaGenero = {
  id: string;
  nombre: string;
  /** Equivalencias activas y vigentes del género. */
  total: number;
  /** Un segmento por agrupación activa con equivalencias del género, en el orden del catálogo. */
  segmentos: SegmentoCobertura[];
  /** Tramo final: sin agrupación o con agrupación inactiva. */
  faltantes: number;
};

export type ResumenMapa = {
  /** Equivalencias activas y vigentes. */
  total: number;
  /** Faltantes (regla 7), con el mismo desglose que una tarjeta. */
  sinAgrupacion: Pick<TarjetaMapa, "total" | "porGenero" | "lineas">;
  /** Una por agrupación del catálogo (activas e inactivas), por `orden, nombre`. */
  tarjetas: TarjetaMapa[];
  /** Un renglón por género con equivalencias, por `orden, nombre`. */
  cobertura: CoberturaGenero[];
};

type Acumulador = {
  total: number;
  porGenero: Map<string, number>;
  porLinea: Map<string, EquivalenciaMapa[]>;
};

function acumulador(): Acumulador {
  return { total: 0, porGenero: new Map(), porLinea: new Map() };
}

function sumar(ac: Acumulador, e: EquivalenciaPlana) {
  ac.total++;
  ac.porGenero.set(e.genero_id, (ac.porGenero.get(e.genero_id) ?? 0) + 1);
  const lista = ac.porLinea.get(e.linea_id) ?? [];
  lista.push({
    id: e.id,
    nombre: e.nombre,
    codigo: e.codigo,
    es_generica: e.es_generica,
    rutaCorta: rutaCorta(e.ruta),
    motivo_faltante: e.motivo_faltante,
  });
  ac.porLinea.set(e.linea_id, lista);
}

/** "HOMBRE / URBANO / PANTALON" → "HOMBRE / URBANO". */
export function rutaCorta(ruta: string): string {
  const partes = ruta.split(" / ");
  return partes.length > 2 ? partes.slice(0, -1).join(" / ") : ruta;
}

export function resumirMapa(
  equivalencias: readonly EquivalenciaPlana[],
  agrupaciones: readonly AgrupacionMapaEntrada[],
  generos: readonly CatalogoPlanoEstacionalidad[],
  lineas: readonly LineaPlana[]
): ResumenMapa {
  const agrupacionesOrdenadas = [...agrupaciones].sort(compararOrdenNombre);
  const generosOrdenados = [...generos].sort(compararOrdenNombre);
  const nombreLinea = new Map(lineas.map((l) => [l.id, l.nombre]));

  const porAgrupacion = new Map<string, Acumulador>(agrupacionesOrdenadas.map((a) => [a.id, acumulador()]));
  const faltantes = acumulador();
  // Cobertura: género → agrupación activa → conteo; y género → faltantes.
  const cobertura = new Map<string, { total: number; porAgrupacion: Map<string, number>; faltantes: number }>();
  let total = 0;

  for (const e of equivalencias) {
    if (!e.activo || !e.vigente) continue;
    total++;
    const c = cobertura.get(e.genero_id) ?? { total: 0, porAgrupacion: new Map(), faltantes: 0 };
    c.total++;
    cobertura.set(e.genero_id, c);

    const agrupacionId = e.agrupacion?.id ?? null;
    const ac = agrupacionId === null ? undefined : porAgrupacion.get(agrupacionId);
    if (ac) sumar(ac, e);

    // Regla 7 (y regla 9: una agrupación fuera del catálogo cuenta como ninguna).
    if (e.faltante || agrupacionId === null || !ac) {
      sumar(faltantes, e);
      c.faltantes++;
    } else {
      c.porAgrupacion.set(agrupacionId, (c.porAgrupacion.get(agrupacionId) ?? 0) + 1);
    }
  }

  const desglosar = (ac: Acumulador): Pick<TarjetaMapa, "total" | "porGenero" | "lineas"> => ({
    total: ac.total,
    porGenero: generosOrdenados
      .filter((g) => (ac.porGenero.get(g.id) ?? 0) > 0)
      .map((g) => ({ id: g.id, nombre: g.nombre, conteo: ac.porGenero.get(g.id)! })),
    lineas: [...ac.porLinea.entries()]
      .map(([id, eqs]) => ({ id, nombre: nombreLinea.get(id) ?? eqs[0]?.rutaCorta ?? id, conteo: eqs.length, equivalencias: eqs }))
      .sort((a, b) => compararNombre(a.nombre, b.nombre)),
  });

  return {
    total,
    sinAgrupacion: desglosar(faltantes),
    tarjetas: agrupacionesOrdenadas.map((a) => ({ agrupacion: a, ...desglosar(porAgrupacion.get(a.id)!) })),
    cobertura: generosOrdenados
      .filter((g) => cobertura.has(g.id))
      .map((g) => {
        const c = cobertura.get(g.id)!;
        return {
          id: g.id,
          nombre: g.nombre,
          total: c.total,
          segmentos: agrupacionesOrdenadas
            .filter((a) => (c.porAgrupacion.get(a.id) ?? 0) > 0)
            .map((a) => ({ agrupacionId: a.id, nombre: a.nombre, conteo: c.porAgrupacion.get(a.id)! })),
          faltantes: c.faltantes,
        };
      }),
  };
}
