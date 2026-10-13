"use client";

import { useMemo, useState } from "react";
import {
  FILTRO_ARBOL_VACIO,
  filtrarPorArbol,
  lineasVigentes,
  resumenLineas,
  type FiltroArbol,
} from "@/lib/estacionalidad/filtro-arbol";
import type {
  CatalogoPlanoEstacionalidad,
  EquivalenciaPlana,
  EquivalenciasEstacionalidadRespuesta,
  LineaPlana,
} from "@/lib/estacionalidad/tipos-api";
import { Field, Input, Select } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { descargarCsv } from "@/components/importador/csv";
import { descargarExcel } from "@/components/importador/excel";

/** Piezas compartidas por las pestañas Asignación y Faltantes. */

export type Catalogos = Pick<EquivalenciasEstacionalidadRespuesta, "generos" | "mundos" | "lineas">;

export const CATALOGOS_VACIOS: Catalogos = { generos: [], mundos: [], lineas: [] };

// ─── Filtros de árbol (género · mundo · líneas · texto) ───

export { FILTRO_ARBOL_VACIO, filtrarPorArbol, type FiltroArbol } from "@/lib/estacionalidad/filtro-arbol";

function ordenCatalogo(a: CatalogoPlanoEstacionalidad, b: CatalogoPlanoEstacionalidad) {
  return a.orden - b.orden || a.nombre.localeCompare(b.nombre);
}

/**
 * Estado del filtro de árbol y las filas que lo pasan (memoizadas: la lista
 * real tiene 1 956 filas). Las líneas ofrecidas son las que existen en el
 * género-mundo elegido; si la elegida deja de estar, el filtro vuelve a
 * "todas" sin efectos.
 */
export function useFiltroArbol(base: EquivalenciaPlana[], lineas: LineaPlana[]) {
  const [filtro, setFiltro] = useState<FiltroArbol>(FILTRO_ARBOL_VACIO);
  const { generoId, mundoId, texto } = filtro;

  const lineasDisponibles = useMemo(() => {
    const ids = new Set<string>();
    for (const e of base) {
      if ((generoId === "" || e.genero_id === generoId) && (mundoId === "" || e.mundo_id === mundoId)) ids.add(e.linea_id);
    }
    return lineas.filter((l) => ids.has(l.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [base, lineas, generoId, mundoId]);

  // Las líneas marcadas que dejan de existir en el género-mundo elegido se descartan sin efectos.
  const lineaIds = useMemo(() => lineasVigentes(filtro.lineaIds, lineasDisponibles), [filtro.lineaIds, lineasDisponibles]);
  const filas = useMemo(() => filtrarPorArbol(base, { generoId, mundoId, lineaIds, texto }), [base, generoId, mundoId, lineaIds, texto]);

  return { filtro: { generoId, mundoId, lineaIds, texto }, setFiltro, lineasDisponibles, filas };
}

export function FiltrosArbol({
  catalogos,
  lineasDisponibles,
  filtro,
  onCambiar,
}: {
  catalogos: Catalogos;
  lineasDisponibles: LineaPlana[];
  filtro: FiltroArbol;
  onCambiar: (f: FiltroArbol) => void;
}) {
  const generos = [...catalogos.generos].sort(ordenCatalogo);
  const mundos = [...catalogos.mundos].sort(ordenCatalogo);
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Género">
        <Select value={filtro.generoId} onChange={(e) => onCambiar({ ...filtro, generoId: e.target.value })} className="h-9">
          <option value="">Todos</option>
          {generos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
              {g.activo ? "" : " (inactivo)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Mundo">
        <Select value={filtro.mundoId} onChange={(e) => onCambiar({ ...filtro, mundoId: e.target.value })} className="h-9">
          <option value="">Todos</option>
          {mundos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
              {m.activo ? "" : " (inactivo)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Líneas" hint={filtro.lineaIds.length > 1 ? `${filtro.lineaIds.length} marcadas` : undefined}>
        <SelectorLineas
          lineas={lineasDisponibles}
          valor={filtro.lineaIds}
          onCambiar={(lineaIds) => onCambiar({ ...filtro, lineaIds })}
        />
      </Field>
      <Field label="Buscar">
        <Input
          type="search"
          value={filtro.texto}
          onChange={(e) => onCambiar({ ...filtro, texto: e.target.value })}
          placeholder="Equivalencia, código o ruta…"
          className="h-9"
        />
      </Field>
    </div>
  );
}

/**
 * Selector de varias líneas a la vez (p. ej. ABRIGOS y CASACAS) para asignar
 * más rápido. Menú con casillas, búsqueda y atajos "Todas" / "Limpiar".
 */
function SelectorLineas({
  lineas,
  valor,
  onCambiar,
}: {
  lineas: LineaPlana[];
  valor: string[];
  onCambiar: (ids: string[]) => void;
}) {
  const [texto, setTexto] = useState("");
  const consulta = texto.trim().toLowerCase();
  const visibles = consulta === "" ? lineas : lineas.filter((l) => l.nombre.toLowerCase().includes(consulta));
  const elegidas = lineasVigentes(valor, lineas);
  const alternar = (id: string) => onCambiar(elegidas.includes(id) ? elegidas.filter((v) => v !== id) : [...elegidas, id]);
  return (
    <details className="group relative">
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-borde bg-superficie px-3 text-sm text-tinta [&::-webkit-details-marker]:hidden">
        <span className="truncate">{resumenLineas(elegidas, lineas)}</span>
        <span aria-hidden className="text-xs text-tinta-suave group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute z-20 mt-1 w-full min-w-64 rounded-md border border-borde bg-superficie p-2 shadow-lg">
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar línea…"
          className="mb-2 h-8"
          aria-label="Buscar línea"
        />
        <div className="mb-1 flex gap-3 text-xs">
          <button type="button" className="text-marca hover:underline" onClick={() => onCambiar(visibles.map((l) => l.id))}>
            Marcar {consulta === "" ? "todas" : "las visibles"}
          </button>
          <button type="button" className="text-tinta-suave hover:underline" onClick={() => onCambiar([])}>
            Limpiar
          </button>
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {visibles.length === 0 && <li className="px-1 py-2 text-xs text-tinta-suave">Ninguna línea coincide.</li>}
          {visibles.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-neutro-suave">
                <Checkbox checked={elegidas.includes(l.id)} onChange={() => alternar(l.id)} label={`Línea ${l.nombre}`} />
                <span className="truncate">
                  {l.nombre}
                  {l.activo ? "" : " (inactiva)"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

// ─── Estado visible de una equivalencia de la lista plana ───

export function estadoEquivalencia(
  e: EquivalenciaPlana,
  catalogos: Catalogos
): { texto: string; tono: "exito" | "alerta" | "neutro" } {
  if (!e.activo) return { texto: "Inactiva", tono: "alerta" };
  if (!e.vigente) {
    const generoInactivo = catalogos.generos.some((g) => g.id === e.genero_id && !g.activo);
    const mundoInactivo = catalogos.mundos.some((m) => m.id === e.mundo_id && !m.activo);
    const lineaInactiva = catalogos.lineas.some((l) => l.id === e.linea_id && !l.activo);
    const padre = generoInactivo ? "género" : mundoInactivo ? "mundo" : lineaInactiva ? "línea" : "nodo";
    return { texto: `Oculta por ${padre} inactivo`, tono: "neutro" };
  }
  return { texto: "Activa", tono: "exito" };
}

// ─── Descarga de faltantes (CSV y Excel, mismas columnas y filas) ───

/** Columnas de la descarga de faltantes: las cinco del importador más la TEMPORADA opcional (vacía). */
export const ENCABEZADOS_FALTANTES = ["GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "AGRUPACION", "TEMPORADA"];

/**
 * Filas de la descarga: la genérica sale con EQUIVALENCIA vacía y la que se
 * llama como la línea, con su nombre literal; AGRUPACION y TEMPORADA salen
 * vacías para completarlas. Es exactamente lo que acepta la pestaña Importar.
 */
export function filasFaltantes(filas: EquivalenciaPlana[], catalogos: Catalogos): string[][] {
  const generos = new Map(catalogos.generos.map((g) => [g.id, g.nombre]));
  const mundos = new Map(catalogos.mundos.map((m) => [m.id, m.nombre]));
  const lineas = new Map(catalogos.lineas.map((l) => [l.id, l.nombre]));
  return filas.map((e) => {
    const [g, m, l] = e.ruta.split(" / ");
    return [
      generos.get(e.genero_id) ?? g ?? "",
      mundos.get(e.mundo_id) ?? m ?? "",
      lineas.get(e.linea_id) ?? l ?? "",
      e.es_generica ? "" : e.nombre,
      "",
      "",
    ];
  });
}

export function descargarFaltantesCsv(filas: EquivalenciaPlana[], catalogos: Catalogos, nombreArchivo = "faltantes-estacionalidad.csv") {
  descargarCsv(ENCABEZADOS_FALTANTES, filasFaltantes(filas, catalogos), nombreArchivo);
}

/** Mismo contenido que el CSV, en un .xlsx de una hoja llamada ASIGNAR (SheetJS se carga solo al pulsar). */
export function descargarFaltantesExcel(filas: EquivalenciaPlana[], catalogos: Catalogos, nombreArchivo = "faltantes-estacionalidad.xlsx"): Promise<void> {
  return descargarExcel(ENCABEZADOS_FALTANTES, filasFaltantes(filas, catalogos), "ASIGNAR", nombreArchivo);
}
