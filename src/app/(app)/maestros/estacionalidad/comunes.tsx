"use client";

import { useMemo, useState } from "react";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import type {
  CatalogoPlanoEstacionalidad,
  EquivalenciaPlana,
  EquivalenciasEstacionalidadRespuesta,
  LineaPlana,
} from "@/lib/estacionalidad/tipos-api";
import { Field, Input, Select } from "@/components/ui/form";
import { descargarCsv } from "@/components/importador/csv";

/** Piezas compartidas por las pestañas Asignación y Faltantes. */

export type Catalogos = Pick<EquivalenciasEstacionalidadRespuesta, "generos" | "mundos" | "lineas">;

export const CATALOGOS_VACIOS: Catalogos = { generos: [], mundos: [], lineas: [] };

// ─── Filtros de árbol (género · mundo · línea · texto) ───

export type FiltroArbol = { generoId: string; mundoId: string; lineaId: string; texto: string };

export const FILTRO_ARBOL_VACIO: FiltroArbol = { generoId: "", mundoId: "", lineaId: "", texto: "" };

/** Filtro en memoria; el texto busca en nombre y código de la equivalencia y en la ruta. */
export function filtrarPorArbol(filas: EquivalenciaPlana[], f: FiltroArbol): EquivalenciaPlana[] {
  const consulta = normalizarNombre(f.texto);
  const consultaCodigo = aCodigo(consulta);
  return filas.filter(
    (e) =>
      (f.generoId === "" || e.genero_id === f.generoId) &&
      (f.mundoId === "" || e.mundo_id === f.mundoId) &&
      (f.lineaId === "" || e.linea_id === f.lineaId) &&
      (consulta === "" ||
        e.nombre.includes(consulta) ||
        e.ruta.includes(consulta) ||
        (consultaCodigo !== "" && e.codigo.includes(consultaCodigo)))
  );
}

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

  const lineaId = lineasDisponibles.some((l) => l.id === filtro.lineaId) ? filtro.lineaId : "";
  const filas = useMemo(() => filtrarPorArbol(base, { generoId, mundoId, lineaId, texto }), [base, generoId, mundoId, lineaId, texto]);

  return { filtro: { generoId, mundoId, lineaId, texto }, setFiltro, lineasDisponibles, filas };
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
      <Field label="Línea">
        <Select value={filtro.lineaId} onChange={(e) => onCambiar({ ...filtro, lineaId: e.target.value })} className="h-9">
          <option value="">Todas</option>
          {lineasDisponibles.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
              {l.activo ? "" : " (inactiva)"}
            </option>
          ))}
        </Select>
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

// ─── CSV de faltantes (formato del importador) ───

/**
 * `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION` con la última vacía: la
 * genérica sale como celda vacía y la que se llama como la línea, con su
 * nombre literal. Es exactamente lo que acepta la pestaña Importar.
 */
export function descargarFaltantesCsv(filas: EquivalenciaPlana[], catalogos: Catalogos, nombreArchivo = "faltantes-estacionalidad.csv") {
  const generos = new Map(catalogos.generos.map((g) => [g.id, g.nombre]));
  const mundos = new Map(catalogos.mundos.map((m) => [m.id, m.nombre]));
  const lineas = new Map(catalogos.lineas.map((l) => [l.id, l.nombre]));
  const data = filas.map((e) => {
    const [g, m, l] = e.ruta.split(" / ");
    return [generos.get(e.genero_id) ?? g ?? "", mundos.get(e.mundo_id) ?? m ?? "", lineas.get(e.linea_id) ?? l ?? "", e.es_generica ? "" : e.nombre, ""];
  });
  descargarCsv(["GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "AGRUPACION"], data, nombreArchivo);
}

/** Agrupaciones activas por `orden, nombre`, para los `Select` de destino. */
export function ordenarAgrupaciones<A extends CatalogoPlanoEstacionalidad>(agrupaciones: A[]): A[] {
  return [...agrupaciones].sort(ordenCatalogo);
}
