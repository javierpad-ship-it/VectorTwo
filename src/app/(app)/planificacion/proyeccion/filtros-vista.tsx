"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Select } from "@/components/ui/form";
import { SOLO_MATRIZ, type IndiceLineaApi, type SoloMatriz } from "@/lib/proyeccion/tipos-api";
import { ETIQUETA_SOLO, ETIQUETA_TEMPORADA_FILTRO, hayFiltro, opcionesLineas, type FiltroVista } from "./vista";

export type OpcionCatalogo = { id: string; nombre: string };

/**
 * Género · Mundo · Línea en cascada (opcionales). Las opciones salen del índice de líneas de la proyección; elegir una
 * línea completa género y mundo, y cambiar el género o el mundo limpia lo que ya no corresponde. Lo usan la Parte 1
 * (solo estos tres), la Matriz y la vista Mensual.
 */
export function SelectoresLinea({
  filtro,
  indice,
  onCambiar,
  compacto = false,
}: {
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  onCambiar: (cambios: Partial<FiltroVista>) => void;
  compacto?: boolean;
}) {
  const opciones = useMemo(() => opcionesLineas(indice, filtro), [indice, filtro]);
  const claveLinea = filtro.genero && filtro.mundo && filtro.linea ? `${filtro.genero}|${filtro.mundo}|${filtro.linea}` : "";
  const alto = compacto ? "h-9" : "";
  return (
    <>
      <Field label="Género">
        <Select className={alto} value={filtro.genero} onChange={(e) => onCambiar({ genero: e.target.value, mundo: "", linea: "" })}>
          <option value="">Todos</option>
          {opciones.generos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Mundo">
        <Select className={alto} value={filtro.mundo} onChange={(e) => onCambiar({ mundo: e.target.value, linea: "" })}>
          <option value="">Todos</option>
          {opciones.mundos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Línea">
        <Select
          className={alto}
          value={claveLinea}
          onChange={(e) => {
            const l = opciones.lineas.find((x) => x.clave === e.target.value);
            onCambiar(l ? { genero: l.genero_id, mundo: l.mundo_id, linea: l.linea_id } : { linea: "" });
          }}
        >
          <option value="">Todas</option>
          {opciones.lineas.map((l) => (
            <option key={l.clave} value={l.clave}>
              {filtro.genero && filtro.mundo ? l.nombre : l.completo}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * Barra de filtros de la Matriz y de la vista Mensual (los mismos; van en la URL y cambiar de pestaña los conserva):
 * género, mundo, línea, temporada, agrupación de estacionalidad (la dominante de la unidad), agrupación de marca (recorta
 * las cifras a esa agrupación) y los chips «Solo».
 */
export function FiltrosVista({
  filtro,
  indice,
  agrupacionesEstacionalidad,
  agrupacionesMarca,
  onCambiar,
  onLimpiar,
}: {
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  agrupacionesEstacionalidad: readonly OpcionCatalogo[];
  agrupacionesMarca: readonly OpcionCatalogo[];
  onCambiar: (cambios: Partial<FiltroVista>) => void;
  onLimpiar: () => void;
}) {
  const itemsSolo: ChipItem<SoloMatriz | "todas">[] = [{ id: "todas", label: "Todas" }, ...SOLO_MATRIZ.map((s) => ({ id: s, label: ETIQUETA_SOLO[s] }))];
  return (
    <div className="space-y-3 rounded-lg border border-borde bg-superficie p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SelectoresLinea filtro={filtro} indice={indice} onCambiar={onCambiar} compacto />
        <Field label="Temporada">
          <Select className="h-9" value={filtro.temporada} onChange={(e) => onCambiar({ temporada: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(ETIQUETA_TEMPORADA_FILTRO).map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agrupación de estacionalidad">
          <Select className="h-9" value={filtro.agrupacion_estacionalidad} onChange={(e) => onCambiar({ agrupacion_estacionalidad: e.target.value })}>
            <option value="">Todas</option>
            {agrupacionesEstacionalidad.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agrupación de marca">
          <Select className="h-9" value={filtro.agrupacion_marca} onChange={(e) => onCambiar({ agrupacion_marca: e.target.value })}>
            <option value="">Todas</option>
            {agrupacionesMarca.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-medium text-tinta">Solo</span>
        <Chips<SoloMatriz | "todas"> items={itemsSolo} activo={filtro.solo === "" ? "todas" : (filtro.solo as SoloMatriz)} onCambiar={(id) => onCambiar({ solo: id === "todas" ? "" : id })} etiqueta="Mostrar solo" />
        {hayFiltro(filtro) && (
          <Button variante="fantasma" tamano="sm" onClick={onLimpiar}>
            Quitar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
