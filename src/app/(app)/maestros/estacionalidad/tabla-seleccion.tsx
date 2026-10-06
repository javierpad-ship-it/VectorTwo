"use client";

import { useMemo, useState } from "react";
import type { AgrupacionEstacionalidadFila, EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";
import {
  agrupacionesDestino,
  agrupacionesParaFiltro,
  agrupacionesSinGenero,
  explicarSinDestinos,
  generosDeSeleccion,
} from "@/lib/estacionalidad/generos";
import { formatearNumero, plural } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { BadgeAgrupacion, useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import { LeyendaAgrupaciones } from "@/components/estacionalidad/leyenda-agrupaciones";
import { estadoEquivalencia, type Catalogos } from "./comunes";
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
  generoId,
  verbo,
  ocupado,
  onAsignar,
  onIrAAgrupaciones,
}: {
  /** Filas visibles (ya filtradas). */
  filas: EquivalenciaPlana[];
  catalogos: Catalogos;
  cargando: boolean;
  vacio: string;
  puedeEditar: boolean;
  /**
   * Catálogo completo. El `Select` de destino y la leyenda solo ofrecen las
   * activas con género que incluyen el género filtrado (`generoId`) y los de
   * las filas seleccionadas, por nombre.
   */
  agrupaciones: AgrupacionEstacionalidadFila[];
  /** Género del filtro de la pantalla (`""` = todos): es quien define qué agrupaciones aplican. */
  generoId: string;
  /** "Asignar a" en Por árbol y Faltantes; "Mover a" en Por agrupación. */
  verbo: "Asignar a" | "Mover a";
  ocupado: boolean;
  /** Devuelve `true` si se aplicó: la selección se limpia. */
  onAsignar: (destino: DestinoAsignacion, filas: EquivalenciaPlana[]) => Promise<boolean>;
  /** Lleva a la pestaña Agrupaciones (para añadir géneros). */
  onIrAAgrupaciones: () => void;
}) {
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());
  const [destinoId, setDestinoId] = useState("");

  // Las que aplican al filtro de género (activas, con género, por nombre): son
  // la leyenda, aunque tengan 0 filas, porque son destinos válidos.
  const activas = useMemo(() => agrupacionesParaFiltro(agrupaciones, generoId), [agrupaciones, generoId]);
  const sinGenero = useMemo(() => agrupacionesSinGenero(agrupaciones), [agrupaciones]);
  const colores = useMapaColores(agrupaciones);
  // Leyenda de colores sobre la tabla: las activas (las del `Select`) con
  // cuántas de las filas visibles tienen cada una, y el chip de faltantes.
  const leyenda = useMemo(() => {
    const conteo = new Map<string, number>();
    let sin = 0;
    for (const f of filas) {
      if (f.faltante || f.agrupacion === null) sin++;
      if (f.agrupacion !== null) conteo.set(f.agrupacion.id, (conteo.get(f.agrupacion.id) ?? 0) + 1);
    }
    return { items: activas.map((a) => ({ id: a.id, nombre: a.nombre, conteo: conteo.get(a.id) ?? 0 })), sin };
  }, [filas, activas]);
  const seleccionadas = useMemo(() => filas.filter((f) => seleccion.has(f.id)), [filas, seleccion]);
  const todasSeleccionadas = filas.length > 0 && seleccionadas.length === filas.length;
  // Destinos = filtro de género ∩ géneros de la selección. El destino elegido
  // se deriva: si deja de aplicar (cambió el filtro o la selección), el
  // `Select` vuelve a "— Elegir —" sin efectos.
  const generosSeleccion = useMemo(() => generosDeSeleccion(filas, seleccion), [filas, seleccion]);
  const destinos = useMemo(() => agrupacionesDestino(agrupaciones, generoId, generosSeleccion), [agrupaciones, generoId, generosSeleccion]);
  const destino = destinos.find((a) => a.id === destinoId) ?? null;
  const sinDestinos = useMemo(() => {
    const nombres = new Map(catalogos.generos.map((g) => [g.id, g.nombre]));
    return explicarSinDestinos(agrupaciones, generoId, generosSeleccion, (id) => nombres.get(id) ?? "género desconocido");
  }, [agrupaciones, generoId, generosSeleccion, catalogos.generos]);

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
    { clave: "agrupacion", titulo: "Agrupación actual", render: (e) => <BadgeAgrupacion agrupacion={e.agrupacion} colores={colores} /> },
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
      {agrupaciones.length > 0 && (
        <LeyendaAgrupaciones items={leyenda.items} colores={colores} sinAgrupacion={leyenda.sin} etiqueta="Colores de las agrupaciones (conteo sobre las filas visibles)" />
      )}
      {generoId === "" && sinGenero.length > 0 && (
        <Alert>
          {plural(sinGenero.length, "agrupación activa no tiene género", "agrupaciones activas no tienen género")} ({sinGenero.map((a) => a.nombre).join(", ")}) y no
          {sinGenero.length === 1 ? " acepta" : " aceptan"} asignaciones hasta que tengan al menos uno.{" "}
          <button type="button" onClick={onIrAAgrupaciones} className="font-medium underline underline-offset-2">
            Asignar géneros
          </button>
        </Alert>
      )}
      {puedeEditar && sinDestinos && (
        <Alert tono="info">
          {sinDestinos.texto}{" "}
          <button type="button" onClick={onIrAAgrupaciones} className="font-medium underline underline-offset-2">
            Ir a Agrupaciones
          </button>
        </Alert>
      )}
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
                  value={destino?.id ?? ""}
                  onChange={(e) => setDestinoId(e.target.value)}
                  disabled={ocupado || destinos.length === 0}
                  className="h-8 w-56"
                  aria-label="Agrupación de destino"
                >
                  <option value="">{destinos.length === 0 ? "— Sin destinos —" : "— Elegir —"}</option>
                  {destinos.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </Select>
                <Button tamano="sm" disabled={ocupado || !destino} title={sinDestinos?.texto} onClick={() => destino && ejecutar({ id: destino.id, nombre: destino.nombre })}>
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
