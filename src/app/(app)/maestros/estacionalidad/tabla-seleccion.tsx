"use client";

import { useMemo, useState } from "react";
import type { CatalogoPlanoEstacionalidad, EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { BadgeAgrupacion } from "@/components/estacionalidad/badge-agrupacion";
import { estadoEquivalencia, ordenarAgrupaciones, type Catalogos } from "./comunes";
import type { DestinoAsignacion } from "./use-asignar";

/**
 * Tabla de equivalencias de la lista plana con `checkbox` por fila y en la
 * cabecera ("seleccionar las N filtradas") y barra de acción cuando hay
 * selección. La misma para Asignación (ambas vistas) y Faltantes.
 *
 * La selección se guarda por id y se interseca con las filas visibles en
 * cada render: cambiar un filtro no la pierde, pero las acciones solo tocan
 * lo que el usuario ve.
 */
export function TablaSeleccion({
  filas,
  catalogos,
  cargando,
  vacio,
  puedeEditar,
  agrupaciones,
  verbo,
  ocupado,
  onAsignar,
}: {
  /** Filas visibles (ya filtradas). */
  filas: EquivalenciaPlana[];
  catalogos: Catalogos;
  cargando: boolean;
  vacio: string;
  puedeEditar: boolean;
  /** Catálogo completo; en el `Select` de destino solo salen las activas, por `orden, nombre`. */
  agrupaciones: CatalogoPlanoEstacionalidad[];
  /** "Asignar a" en Por árbol y Faltantes; "Mover a" en Por agrupación. */
  verbo: "Asignar a" | "Mover a";
  ocupado: boolean;
  /** Devuelve `true` si se aplicó: la selección se limpia. */
  onAsignar: (destino: DestinoAsignacion, filas: EquivalenciaPlana[]) => Promise<boolean>;
}) {
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());
  const [destinoId, setDestinoId] = useState("");

  const activas = useMemo(() => ordenarAgrupaciones(agrupaciones.filter((a) => a.activo)), [agrupaciones]);
  const seleccionadas = useMemo(() => filas.filter((f) => seleccion.has(f.id)), [filas, seleccion]);
  const todasSeleccionadas = filas.length > 0 && seleccionadas.length === filas.length;
  const destino = activas.find((a) => a.id === destinoId) ?? null;

  function alternar(id: string, v: boolean) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function alternarTodas(v: boolean) {
    setSeleccion(v ? new Set(filas.map((f) => f.id)) : new Set());
  }

  async function ejecutar(d: DestinoAsignacion) {
    const ok = await onAsignar(d, seleccionadas);
    if (ok) setSeleccion(new Set());
  }

  const columnas: Columna<EquivalenciaPlana>[] = [];
  if (puedeEditar) {
    columnas.push({
      clave: "sel",
      titulo: "",
      className: "w-8",
      render: (e) => <Checkbox checked={seleccion.has(e.id)} disabled={ocupado} onChange={(v) => alternar(e.id, v)} label={`Seleccionar ${e.nombre} de ${e.ruta}`} />,
    });
  }
  columnas.push(
    {
      clave: "ruta",
      titulo: "Ruta",
      render: (e) => <span className={`text-xs ${e.vigente ? "text-tinta-suave" : "text-tinta-suave/70"}`}>{e.ruta}</span>,
    },
    {
      clave: "nombre",
      titulo: "Equivalencia",
      render: (e) => (
        <span className={`font-medium ${e.activo && e.vigente ? "" : "opacity-60"}`}>
          {e.nombre}
          {e.es_generica && (
            <span className="ml-2">
              <Badge tono="marca">Genérica</Badge>
            </span>
          )}
        </span>
      ),
    },
    { clave: "codigo", titulo: "Código", render: (e) => <code className="font-mono text-xs text-tinta-suave">{e.codigo}</code> },
    { clave: "agrupacion", titulo: "Agrupación actual", render: (e) => <BadgeAgrupacion agrupacion={e.agrupacion} /> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (e) => {
        const estado = estadoEquivalencia(e, catalogos);
        return <Badge tono={estado.tono}>{estado.texto}</Badge>;
      },
    }
  );

  return (
    <div className="space-y-3">
      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-borde bg-fondo px-3 py-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <Checkbox
              checked={todasSeleccionadas}
              indeterminado={seleccionadas.length > 0 && !todasSeleccionadas}
              disabled={ocupado || filas.length === 0}
              onChange={alternarTodas}
              label={`Seleccionar las ${filas.length} filtradas`}
            />
            <span className="text-tinta-suave">
              {todasSeleccionadas ? "Todas las filtradas" : `Seleccionar las ${formatearNumero(filas.length)} filtradas`}
            </span>
          </label>

          {seleccionadas.length > 0 && (
            <>
              <span className="font-medium text-tinta">{plural(seleccionadas.length, "seleccionada", "seleccionadas")}</span>
              <span className="text-tinta-suave">·</span>
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="text-tinta-suave">{verbo}</span>
                <Select
                  value={destinoId}
                  onChange={(e) => setDestinoId(e.target.value)}
                  disabled={ocupado || activas.length === 0}
                  className="h-8 w-56"
                  aria-label="Agrupación de destino"
                >
                  <option value="">{activas.length === 0 ? "No hay agrupaciones activas" : "Elige una agrupación…"}</option>
                  {activas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </Select>
                <Button tamano="sm" disabled={ocupado || !destino} onClick={() => destino && ejecutar({ id: destino.id, nombre: destino.nombre })}>
                  {ocupado ? "Guardando…" : verbo === "Mover a" ? "Mover" : "Asignar"}
                </Button>
              </span>
              <span className="text-tinta-suave">·</span>
              <Button variante="peligro" tamano="sm" disabled={ocupado || seleccionadas.every((f) => f.agrupacion === null)} onClick={() => ejecutar(null)}>
                Quitar agrupación
              </Button>
              <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => setSeleccion(new Set())}>
                Limpiar selección
              </Button>
            </>
          )}
        </div>
      )}

      <DataTable columnas={columnas} filas={filas} claveFila={(e) => e.id} cargando={cargando && filas.length === 0} vacio={vacio} />
    </div>
  );
}
