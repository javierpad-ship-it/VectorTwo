"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { TEMPORADAS, aCodigo, normalizarNombre, type Temporada } from "@/lib/arbol/normalizar";
import type { GeneroArbol, LineaArbol, LineaFila, MundoArbol, NodoFila } from "@/lib/arbol/tipos-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { BadgeTemporada, Columna, FilaColumna, VistaPreviaNombre, estadoNodo, mensajeError } from "./comunes";

type Props = {
  genero: GeneroArbol;
  mundo: MundoArbol;
  nodoSelId: string | null;
  onSeleccionar: (nodoId: string | null) => void;
  puedeEditar: boolean;
  /** Recarga el árbol tras una escritura. */
  onCambio: () => Promise<void>;
  onError: (mensaje: string | null) => void;
  /** Tras mover un nodo a otro mundo, para que la selección lo siga. */
  onMovido: (mundoId: string, nodoId: string) => void;
};

export function ColumnaLineas({
  genero,
  mundo,
  nodoSelId,
  onSeleccionar,
  puedeEditar,
  onCambio,
  onError,
  onMovido,
}: Props) {
  const [filtro, setFiltro] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const consulta = normalizarNombre(filtro);
  const lineas = consulta ? mundo.lineas.filter((l) => l.nombre.includes(consulta)) : mundo.lineas;
  // Mover a otro mundo del mismo género: disponible para quien puede editar
  // (admin y planner), en cualquier nodo. El 409 del backend (la línea ya
  // existe en el destino) llega por `onError` como cualquier otro fallo.
  const mundosDestino = genero.mundos.filter((m) => m.id !== mundo.id && m.activo);
  const puedeMover = puedeEditar && mundosDestino.length > 0;

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    onError(null);
    try {
      await accion();
      await onCambio();
    } catch (e) {
      onError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  }

  function alternarActivo(l: LineaArbol) {
    if (l.activo_nodo && !confirm(`¿Desactivar ${l.nombre} en ${genero.nombre} / ${mundo.nombre}? Sus equivalencias dejarán de verse en el árbol.`)) return;
    void ejecutar(() => api.patch<NodoFila>(`/api/arbol/nodos/${l.nodo_id}`, { activo: !l.activo_nodo }));
  }

  function eliminar(l: LineaArbol) {
    if (!confirm(`¿Eliminar definitivamente ${l.nombre} de ${genero.nombre} / ${mundo.nombre}? La línea sigue en el catálogo.`)) return;
    void ejecutar(async () => {
      await api.delete(`/api/arbol/nodos/${l.nodo_id}`);
      if (nodoSelId === l.nodo_id) onSeleccionar(null);
    });
  }

  function mover(l: LineaArbol, mundoDestinoId: string) {
    const destino = genero.mundos.find((m) => m.id === mundoDestinoId);
    if (!destino) return;
    if (!confirm(`¿Mover ${l.nombre} de ${mundo.nombre} a ${destino.nombre} en ${genero.nombre}? Se lleva sus equivalencias.`)) return;
    void ejecutar(async () => {
      await api.patch<NodoFila>(`/api/arbol/nodos/${l.nodo_id}`, { mundo_id: mundoDestinoId });
      onMovido(mundoDestinoId, l.nodo_id);
    });
  }

  return (
    <Columna
      titulo="Líneas"
      subtitulo={`${genero.nombre} / ${mundo.nombre} · ${mundo.lineas.length} línea${mundo.lineas.length === 1 ? "" : "s"}`}
      acciones={
        puedeEditar && (
          <Button variante="secundario" tamano="sm" onClick={() => setAgregando((v) => !v)}>
            {agregando ? "Cerrar" : "Agregar línea"}
          </Button>
        )
      }
    >
      {agregando && puedeEditar && (
        <FormAgregarLinea
          genero={genero}
          mundo={mundo}
          onError={onError}
          onCreado={async (nodoId) => {
            setAgregando(false);
            await onCambio();
            onSeleccionar(nodoId);
          }}
        />
      )}

      {mundo.lineas.length > 3 && (
        <Input
          type="search"
          placeholder="Filtrar líneas…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="mb-2 h-8"
          aria-label="Filtrar líneas"
        />
      )}

      {mundo.lineas.length === 0 && !agregando && (
        <EmptyState
          titulo="Sin líneas en este mundo"
          detalle={puedeEditar ? "Usa “Agregar línea” para colgar una línea del catálogo acá." : undefined}
        />
      )}

      {mundo.lineas.length > 0 && lineas.length === 0 && (
        <p className="px-2 py-3 text-sm text-tinta-suave">Ninguna línea coincide con el filtro.</p>
      )}

      <ul className="space-y-0.5">
        {lineas.map((l) => {
          const estado = estadoNodo(l, genero, mundo);
          const seleccionada = l.nodo_id === nodoSelId;
          // M3: equivalencias activas sin agrupación activa (regla 7), para ver desde el árbol qué nodos faltan.
          const sinAgrupacion = l.equivalencias.filter(
            (e) => e.activo && (e.agrupacion_estacionalidad === null || !e.agrupacion_estacionalidad.activo)
          ).length;
          return (
            <li key={l.nodo_id}>
              <FilaColumna seleccionada={seleccionada} atenuada={!l.vigente} onClick={() => onSeleccionar(l.nodo_id)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.nombre}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1">
                    <BadgeTemporada temporada={l.temporada} />
                    {estado && <Badge tono={estado.tono}>{estado.texto}</Badge>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-tinta-suave">
                  <span className="block">{l.equivalencias.length} eq.</span>
                  {sinAgrupacion > 0 && <span className="block text-alerta">{sinAgrupacion} sin agrupación</span>}
                </span>
              </FilaColumna>

              {seleccionada && puedeEditar && (
                <div className="mt-1 mb-2 flex flex-wrap items-center gap-1 rounded-md bg-fondo px-2 py-1.5">
                  <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(l)}>
                    {l.activo_nodo ? "Desactivar" : "Reactivar"}
                  </Button>
                  <Button
                    variante="peligro"
                    tamano="sm"
                    disabled={ocupado || l.equivalencias.length > 0}
                    title={l.equivalencias.length > 0 ? "Tiene equivalencias: desactívalo en vez de eliminarlo." : undefined}
                    onClick={() => eliminar(l)}
                  >
                    Eliminar
                  </Button>
                  {puedeMover && (
                    <Select
                      className="h-8 w-auto"
                      value=""
                      disabled={ocupado}
                      aria-label={`Mover ${l.nombre} a otro mundo`}
                      onChange={(e) => e.target.value && mover(l, e.target.value)}
                    >
                      <option value="">Mover a…</option>
                      {mundosDestino.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Columna>
  );
}

/**
 * Alta de un nodo: elige una línea del catálogo que aún no esté en este
 * género-mundo, o crea una línea nueva y la cuelga de una vez.
 */
function FormAgregarLinea({
  genero,
  mundo,
  onCreado,
  onError,
}: {
  genero: GeneroArbol;
  mundo: MundoArbol;
  onCreado: (nodoId: string) => Promise<void>;
  onError: (mensaje: string | null) => void;
}) {
  const { datos: catalogo, cargando, error: errorCatalogo, recargar: recargarCatalogo } = useColeccion<LineaFila>("/api/lineas");
  const [modo, setModo] = useState<"existente" | "nueva">("existente");
  const [lineaId, setLineaId] = useState("");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [temporada, setTemporada] = useState<Temporada>("Todo el año");
  const [guardando, setGuardando] = useState(false);

  const yaEnNodo = new Set(mundo.lineas.map((l) => l.linea_id));
  const disponibles = catalogo.filter((l) => l.activo && !yaEnNodo.has(l.id));
  const nombreNormalizado = normalizarNombre(nombre);
  const codigoPropuesto = codigoTocado ? aCodigo(codigo) : aCodigo(nombreNormalizado);

  const listo = modo === "existente" ? lineaId !== "" : nombreNormalizado.length > 0 && codigoPropuesto.length > 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!listo) return;
    setGuardando(true);
    onError(null);
    try {
      let idLinea = lineaId;
      if (modo === "nueva") {
        const creada = await api.post<LineaFila>("/api/lineas", { nombre: nombreNormalizado, codigo: codigoPropuesto, temporada });
        idLinea = creada.id;
      }
      const nodo = await api.post<NodoFila>("/api/arbol/nodos", {
        genero_id: genero.id,
        mundo_id: mundo.id,
        linea_id: idLinea,
      });
      setLineaId("");
      setNombre("");
      setCodigo("");
      setCodigoTocado(false);
      await onCreado(nodo.id);
    } catch (err) {
      onError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mb-3 space-y-3 rounded-lg border border-borde bg-fondo p-3">
      <div className="flex gap-3 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="modo-linea" checked={modo === "existente"} onChange={() => setModo("existente")} />
          Del catálogo
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="modo-linea" checked={modo === "nueva"} onChange={() => setModo("nueva")} />
          Crear línea nueva
        </label>
      </div>

      {modo === "existente" ? (
        errorCatalogo ? (
          <Alert>
            No se pudo cargar el catálogo de líneas: {errorCatalogo}{" "}
            <button type="button" onClick={() => void recargarCatalogo()} className="font-medium underline underline-offset-2">
              Reintentar
            </button>
          </Alert>
        ) : (
          <Field label="Línea" hint={cargando ? "Cargando catálogo…" : `${disponibles.length} disponibles para ${genero.nombre} / ${mundo.nombre}.`}>
            <Select value={lineaId} onChange={(e) => setLineaId(e.target.value)} disabled={cargando}>
              <option value="">Elige una línea…</option>
              {disponibles.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre} · {l.temporada}
                </option>
              ))}
            </Select>
          </Field>
        )
      ) : (
        <div className="space-y-3">
          <Field label="Nombre">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código" hint="Propuesto a partir del nombre; puedes cambiarlo.">
              <Input
                value={codigoTocado ? codigo : codigoPropuesto}
                onChange={(e) => {
                  setCodigoTocado(true);
                  setCodigo(e.target.value);
                }}
                className="font-mono"
              />
            </Field>
            <Field label="Temporada">
              <Select value={temporada} onChange={(e) => setTemporada(e.target.value as Temporada)}>
                {TEMPORADAS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
        </div>
      )}

      <Button type="submit" tamano="sm" disabled={!listo || guardando}>
        {guardando ? "Agregando…" : `Agregar a ${genero.nombre} / ${mundo.nombre}`}
      </Button>
    </form>
  );
}
