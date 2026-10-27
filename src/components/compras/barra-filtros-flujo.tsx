"use client";

import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Select } from "@/components/ui/form";
import { SOLO_CONCILIACION, SOLO_FLUJO } from "@/lib/flujo/tipos-api";
import {
  ETIQUETA_SOLO_CONCILIACION,
  ETIQUETA_SOLO_FLUJO,
  hayFiltros,
  PARAMETROS_FLUJO_VACIOS,
  type OpcionId,
  type ParametrosFlujo,
} from "./vista-flujo";

/**
 * Filtros de las dos pestañas de Flujo mensual (ficha 08 §4.3): género, mundo, línea y agrupación de marca (ids, porque viajan al
 * servidor y los totales siguen al filtro), «Mis líneas» o «Todas» y el chip «Solo» de cada pestaña. Controlado desde fuera: el panel
 * guarda todo en la URL.
 */
export function BarraFiltrosFlujo({
  parametros,
  generos,
  mundos,
  lineas,
  agrupaciones,
  onCambiar,
}: {
  parametros: ParametrosFlujo;
  generos: readonly OpcionId[];
  mundos: readonly OpcionId[];
  lineas: readonly OpcionId[];
  agrupaciones: readonly OpcionId[];
  onCambiar: (cambios: Partial<ParametrosFlujo>) => void;
}) {
  const enFlujo = parametros.pestana === "flujo";
  const solo = enFlujo ? parametros.solo : parametros.soloConciliacion;
  const soloItems: ChipItem<string>[] = [
    { id: "todos", label: "Todos" },
    ...(enFlujo ? SOLO_FLUJO.map((s) => ({ id: s as string, label: ETIQUETA_SOLO_FLUJO[s] })) : SOLO_CONCILIACION.map((s) => ({ id: s as string, label: ETIQUETA_SOLO_CONCILIACION[s] }))),
  ];
  const alcance: ChipItem<string>[] = [
    { id: "todas", label: "Todas" },
    { id: "mias", label: "Mis líneas" },
  ];
  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 gap-3 ${enFlujo ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        <Field label="Género">
          <Select value={parametros.genero ?? ""} onChange={(e) => onCambiar({ genero: e.target.value || null, mundo: null, linea: null })}>
            <option value="">Todos</option>
            {generos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mundo">
          <Select value={parametros.mundo ?? ""} onChange={(e) => onCambiar({ mundo: e.target.value || null, linea: null })}>
            <option value="">Todos</option>
            {mundos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Línea">
          <Select value={parametros.linea ?? ""} onChange={(e) => onCambiar({ linea: e.target.value || null })}>
            <option value="">Todas</option>
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </Select>
        </Field>
        {enFlujo && (
          <Field label="Agrupación de marca">
            <Select value={parametros.agrupacion ?? ""} onChange={(e) => onCambiar({ agrupacion: e.target.value || null })}>
              <option value="">Todas</option>
              {agrupaciones.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Chips etiqueta="Alcance" items={alcance} activo={parametros.mio ? "mias" : "todas"} onCambiar={(id) => onCambiar({ mio: id === "mias" })} />
        <Chips
          etiqueta="Mostrar solo"
          items={soloItems}
          activo={solo ?? "todos"}
          onCambiar={(id) => onCambiar(enFlujo ? { solo: id === "todos" ? null : (id as ParametrosFlujo["solo"]) } : { soloConciliacion: id === "todos" ? null : (id as ParametrosFlujo["soloConciliacion"]) })}
        />
        {hayFiltros(parametros) && (
          <Button
            variante="fantasma"
            tamano="sm"
            onClick={() => onCambiar({ genero: null, mundo: null, linea: null, agrupacion: null, solo: null, soloConciliacion: null, mio: PARAMETROS_FLUJO_VACIOS.mio })}
          >
            Quitar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
