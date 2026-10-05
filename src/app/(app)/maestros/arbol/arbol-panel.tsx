"use client";

import { useState } from "react";
import Link from "next/link";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { GeneroArbol, MundoArbol } from "@/lib/arbol/tipos-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { BuscadorLineas } from "./buscador-lineas";
import { ColumnaLineas } from "./columna-lineas";
import { ColumnaEquivalencias } from "./columna-equivalencias";
import { ImportarCsv } from "./importar-csv";
import { Columna, FilaColumna, formatearNumero } from "./comunes";

type Pestana = "arbol" | "importar";
type Seleccion = { generoId: string | null; mundoId: string | null; nodoId: string | null };

const SIN_SELECCION: Seleccion = { generoId: null, mundoId: null, nodoId: null };

export function ArbolPanel({ rol }: { rol: Rol }) {
  const puedeEditar = puedeEditarMaestros(rol);
  const [pestana, setPestana] = useState<Pestana>("arbol");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const { arbol, cargando, error, setError, recargar } = useArbol(mostrarInactivos);
  const [sel, setSel] = useState<Seleccion>(SIN_SELECCION);
  const [busqueda, setBusqueda] = useState("");

  // La selección se guarda por ids y se resuelve contra el árbol en cada
  // render: así sobrevive a las recargas y no hace falta sincronizarla con efectos.
  const generos = arbol?.generos ?? [];
  const generoSel: GeneroArbol | null = generos.find((g) => g.id === sel.generoId) ?? generos[0] ?? null;
  const mundoSel: MundoArbol | null = generoSel?.mundos.find((m) => m.id === sel.mundoId) ?? null;
  const nodoSel = mundoSel?.lineas.find((l) => l.nodo_id === sel.nodoId) ?? null;

  const nodosVigentesPorGenero = (g: GeneroArbol) =>
    g.mundos.reduce((acc, m) => acc + m.lineas.filter((l) => l.vigente).length, 0);

  async function recargarSilencioso() {
    await recargar();
  }

  const r = arbol?.resumen;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Árbol de producto</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Género → Mundo → Línea → Equivalencia. {puedeEditar ? "Géneros y mundos se gestionan en Catálogos; líneas y equivalencias, desde acá." : "Vista de solo lectura."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeEditar && (
            <Link
              href="/maestros/arbol/catalogos"
              className="inline-flex h-10 items-center rounded-md border border-borde bg-superficie px-4 text-sm font-medium text-tinta hover:bg-neutro-suave"
            >
              Catálogos
            </Link>
          )}
          {puedeEditar && pestana === "arbol" && <Button onClick={() => setPestana("importar")}>Importar archivo</Button>}
        </div>
      </div>

      {puedeEditar && (
        <Tabs<Pestana>
          items={[
            { id: "arbol", label: "Árbol" },
            { id: "importar", label: "Importar archivo" },
          ]}
          activa={pestana}
          onCambiar={setPestana}
        />
      )}

      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}

      {pestana === "importar" && puedeEditar ? (
        <ImportarCsv
          onAplicado={() => {
            setPestana("arbol");
            void recargar();
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-xl flex-1">
              <BuscadorLineas
                arbol={arbol}
                valor={busqueda}
                onCambiar={setBusqueda}
                onElegir={(s) => {
                  setSel(s);
                  setBusqueda("");
                }}
              />
            </div>
            <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />
          </div>

          {r && (
            <p className="text-sm text-tinta-suave">
              {formatearNumero(r.generos)} géneros · {formatearNumero(r.mundos)} mundos · {formatearNumero(r.lineas)} líneas ·{" "}
              {formatearNumero(r.nodos)} nodos · {formatearNumero(r.equivalencias)} equivalencias
              {cargando && <span className="ml-2 italic">Actualizando…</span>}
            </p>
          )}

          {cargando && !arbol && <p className="text-sm text-tinta-suave">Cargando el árbol…</p>}

          {arbol && generos.length === 0 && (
            <EmptyState titulo="El árbol está vacío" detalle="No hay géneros activos. Un administrador puede crearlos en Catálogos." />
          )}

          {arbol && generos.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-2">
                <Columna titulo="Géneros" subtitulo={`${generos.length} · nodos vigentes`}>
                  <ul className="space-y-0.5">
                    {generos.map((g) => (
                      <li key={g.id}>
                        <FilaColumna
                          seleccionada={g.id === generoSel?.id}
                          atenuada={!g.activo}
                          onClick={() => setSel({ generoId: g.id, mundoId: null, nodoId: null })}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{g.nombre}</span>
                            {!g.activo && <Badge tono="alerta">Inactivo</Badge>}
                          </span>
                          <span className="shrink-0 text-xs text-tinta-suave">{nodosVigentesPorGenero(g)}</span>
                        </FilaColumna>
                      </li>
                    ))}
                  </ul>
                </Columna>
              </div>

              <div className="lg:col-span-2">
                {generoSel ? (
                  <Columna titulo="Mundos" subtitulo={generoSel.nombre}>
                    <ul className="space-y-0.5">
                      {generoSel.mundos.map((m) => {
                        const n = m.lineas.length;
                        return (
                          <li key={m.id}>
                            <FilaColumna
                              seleccionada={m.id === mundoSel?.id}
                              atenuada={!m.activo || n === 0}
                              onClick={() => setSel({ generoId: generoSel.id, mundoId: m.id, nodoId: null })}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{m.nombre}</span>
                                {!m.activo && <Badge tono="alerta">Inactivo</Badge>}
                              </span>
                              <span className="shrink-0 text-xs text-tinta-suave">
                                {n} línea{n === 1 ? "" : "s"}
                              </span>
                            </FilaColumna>
                          </li>
                        );
                      })}
                    </ul>
                  </Columna>
                ) : (
                  <Columna titulo="Mundos">
                    <EmptyState titulo="Elige un género" />
                  </Columna>
                )}
              </div>

              <div className="lg:col-span-4">
                {generoSel && mundoSel ? (
                  <ColumnaLineas
                    key={mundoSel.id}
                    genero={generoSel}
                    mundo={mundoSel}
                    nodoSelId={nodoSel?.nodo_id ?? null}
                    onSeleccionar={(nodoId) => setSel({ ...sel, generoId: generoSel.id, mundoId: mundoSel.id, nodoId })}
                    puedeEditar={puedeEditar}
                    onCambio={recargarSilencioso}
                    onError={setError}
                    onMovido={(mundoId, nodoId) => setSel({ generoId: generoSel.id, mundoId, nodoId })}
                  />
                ) : (
                  <Columna titulo="Líneas">
                    <EmptyState titulo="Elige un mundo" detalle="Las líneas se listan por género y mundo." />
                  </Columna>
                )}
              </div>

              <div className="lg:col-span-4">
                {generoSel && mundoSel && nodoSel ? (
                  <ColumnaEquivalencias
                    key={nodoSel.nodo_id}
                    genero={generoSel}
                    mundo={mundoSel}
                    nodo={nodoSel}
                    puedeEditar={puedeEditar}
                    onCambio={recargarSilencioso}
                    onError={setError}
                  />
                ) : (
                  <Columna titulo="Equivalencias">
                    <EmptyState titulo="Elige una línea" detalle="Cada nodo género-mundo-línea tiene sus propias equivalencias." />
                  </Columna>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
