"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import { api } from "@/lib/api-client";
import { useArbol } from "@/lib/arbol/use-arbol";
import { useGmlEspecial } from "@/components/marcas/use-gml-especial";
import { useColeccion } from "@/lib/use-coleccion";
import { useResponsables } from "@/lib/responsables/use-responsables";
import { claveCelda, indexarCeldas, textoResponsable } from "@/lib/responsables/pantalla";
import type { EditarNodoCuerpo, GeneroArbol, MundoArbol, NivelBloqueCuerpo, NivelBloqueRespuesta, NivelPlanificacion, NodoFila } from "@/lib/arbol/tipos-api";
import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Chips } from "@/components/ui/chips";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { BuscadorLineas } from "./buscador-lineas";
import { ColumnaLineas } from "./columna-lineas";
import { ColumnaEquivalencias } from "./columna-equivalencias";
import { ImportarCsv } from "./importar-csv";
import { ImportarNivel } from "./importar-nivel";
import { Columna, FilaColumna, formatearNumero, mensajeError } from "./comunes";

type Pestana = "arbol" | "importar";
type TipoImportacion = "arbol" | "nivel";
type FiltroNivel = "todos" | "gmle";

/** El endpoint de bloque admite hasta 600 ids por llamada. */
const MAX_IDS_BLOQUE = 600;
type Seleccion = { generoId: string | null; mundoId: string | null; nodoId: string | null };

const SIN_SELECCION: Seleccion = { generoId: null, mundoId: null, nodoId: null };

export function ArbolPanel({ rol }: { rol: Rol }) {
  const puedeEditar = puedeEditarMaestros(rol);
  const [pestana, setPestana] = useState<Pestana>("arbol");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const { arbol, cargando, error, setError, recargar } = useArbol(mostrarInactivos);
  const [sel, setSel] = useState<Seleccion>(SIN_SELECCION);
  const [busqueda, setBusqueda] = useState("");
  // 02b: tipo de archivo que se importa y filtro "Abiertos a GMLE".
  const [tipoImportacion, setTipoImportacion] = useState<TipoImportacion>("arbol");
  const [filtroNivel, setFiltroNivel] = useState<FiltroNivel>("todos");
  const [ocupadoNivel, setOcupadoNivel] = useState(false);
  const [avisoNivel, setAvisoNivel] = useState<{ exito: string; sinAgrupacion: number } | null>(null);
  // M3: el catálogo de agrupaciones de estacionalidad se carga una vez (con
  // inactivas, para marcar la de una equivalencia que apunte a una apagada) y
  // alimenta el `Select` de la columna Equivalencias. Si falla, la columna
  // muestra solo el badge y un aviso.
  const agrupaciones = useColeccion<AgrupacionEstacionalidadFila>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");

  // M1b: responsable de cada género-mundo (solo lectura; la edición vive en la
  // matriz). Segunda llamada, con inactivos para cubrir lo que el árbol muestre
  // con «Mostrar inactivos». Si falla, el árbol sigue sin responsable.
  const responsables = useResponsables(true);
  const celdasResponsables = useMemo(() => indexarCeldas(responsables.datos?.celdas ?? []), [responsables.datos]);

  // 02b: marcas relevantes por nodo ("· 2 marcas relevantes"). Es configuración de planificación (`requirePlanner`):
  // el comprador no la pide. Si falla, el árbol sigue sin el dato (no es crítico).
  const gmlEspecial = useGmlEspecial(false, puedeEditar);
  const relevantesPorNodo = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of gmlEspecial.datos?.por_nodo ?? []) {
      if (n.relevantes_vigentes > 0) m.set(n.genero_mundo_linea_id, n.relevantes_vigentes);
    }
    return m;
  }, [gmlEspecial.datos]);

  // La selección se guarda por ids y se resuelve contra el árbol en cada
  // render: así sobrevive a las recargas y no hace falta sincronizarla con efectos.
  const generos = arbol?.generos ?? [];
  const generoSel: GeneroArbol | null = generos.find((g) => g.id === sel.generoId) ?? generos[0] ?? null;
  const mundoSel: MundoArbol | null = generoSel?.mundos.find((m) => m.id === sel.mundoId) ?? null;
  const nodoSel = mundoSel?.lineas.find((l) => l.nodo_id === sel.nodoId) ?? null;

  const soloGmle = filtroNivel === "gmle";
  /** Con el filtro "Abiertos a GMLE" los conteos de géneros y mundos pasan a contar solo los nodos abiertos. */
  const cuentaNodo = (l: { vigente: boolean; nivel_planificacion: NivelPlanificacion }) => l.vigente && (!soloGmle || l.nivel_planificacion === "GMLE");
  const nodosVigentesPorGenero = (g: GeneroArbol) => g.mundos.reduce((acc, m) => acc + m.lineas.filter(cuentaNodo).length, 0);

  async function recargarSilencioso() {
    await recargar();
  }

  /**
   * 02b: cambia el nivel de planificación de uno o varios nodos. Uno solo va por el PATCH del nodo; varios, por el
   * bloque (tandas de 600). Nada se borra: es una propiedad del nodo. Al abrir a GMLE avisa de las equivalencias sin
   * agrupación de estacionalidad (aviso, no bloqueo).
   */
  async function cambiarNivel(nodoIds: string[], nivel: NivelPlanificacion) {
    if (nodoIds.length === 0) return;
    setOcupadoNivel(true);
    setError(null);
    setAvisoNivel(null);
    try {
      let cambiados = 0;
      let sinCambio = 0;
      if (nodoIds.length === 1) {
        const cuerpo: EditarNodoCuerpo = { nivel_planificacion: nivel };
        await api.patch<NodoFila>(`/api/arbol/nodos/${nodoIds[0]}`, cuerpo);
        cambiados = 1;
      } else {
        for (let i = 0; i < nodoIds.length; i += MAX_IDS_BLOQUE) {
          const cuerpo: NivelBloqueCuerpo = { nivel, nodo_ids: nodoIds.slice(i, i + MAX_IDS_BLOQUE) };
          const res = await api.post<NivelBloqueRespuesta>("/api/arbol/nodos/nivel", cuerpo);
          cambiados += res.cambiados;
          sinCambio += res.sin_cambio;
        }
      }
      const ids = new Set(nodoIds);
      let sinAgrupacion = 0;
      if (nivel === "GMLE") {
        for (const g of generos) {
          for (const m of g.mundos) {
            for (const l of m.lineas) {
              if (!ids.has(l.nodo_id)) continue;
              sinAgrupacion += l.equivalencias.filter((e) => e.activo && (e.agrupacion_estacionalidad === null || !e.agrupacion_estacionalidad.activo)).length;
            }
          }
        }
      }
      const destino = nivel === "GMLE" ? "abiertos a GMLE" : "vueltos a GML";
      setAvisoNivel({
        exito:
          nodoIds.length === 1
            ? `Nodo ${nivel === "GMLE" ? "abierto a GMLE" : "vuelto a GML"}.`
            : `${cambiados} nodo${cambiados === 1 ? "" : "s"} ${destino}${sinCambio > 0 ? `; ${sinCambio} ya estaban así` : ""}.`,
        sinAgrupacion,
      });
      await Promise.all([recargar(), gmlEspecial.recargar()]);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupadoNivel(false);
    }
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
        <div className="space-y-4">
          <Chips<TipoImportacion>
            items={[
              { id: "arbol", label: "Árbol" },
              { id: "nivel", label: "Niveles de planificación" },
            ]}
            activo={tipoImportacion}
            onCambiar={setTipoImportacion}
            etiqueta="Qué importar"
          />
          {tipoImportacion === "arbol" ? (
            <ImportarCsv
              key="arbol"
              onAplicado={() => {
                setPestana("arbol");
                void recargar();
              }}
            />
          ) : (
            <ImportarNivel
              key="nivel"
              arbol={arbol}
              onAplicado={() => {
                setPestana("arbol");
                void recargar();
              }}
            />
          )}
        </div>
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
                puedeEditar={puedeEditar}
                ocupadoNivel={ocupadoNivel}
                onCambiarNivelLinea={cambiarNivel}
              />
            </div>
            <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />
          </div>

          {r && (
            <p className="text-sm text-tinta-suave">
              {formatearNumero(r.generos)} géneros · {formatearNumero(r.mundos)} mundos · {formatearNumero(r.lineas)} líneas ·{" "}
              {formatearNumero(r.nodos)} nodos · {formatearNumero(r.nodos_gmle)} abiertos a GMLE ({formatearNumero(r.equivalencias_en_gmle)} equivalencias) ·{" "}
              {formatearNumero(r.equivalencias)} equivalencias ·{" "}
              {puedeEditar ? (
                <Link
                  href="/maestros/estacionalidad?pestana=faltantes"
                  className={`underline-offset-2 hover:underline ${r.equivalencias_sin_agrupacion > 0 ? "text-alerta" : "text-exito"}`}
                  title="Ver las faltantes en Agrupaciones de estacionalidad"
                >
                  {formatearNumero(r.equivalencias_sin_agrupacion)} sin agrupación
                </Link>
              ) : (
                <span>{formatearNumero(r.equivalencias_sin_agrupacion)} sin agrupación</span>
              )}
              {cargando && <span className="ml-2 italic">Actualizando…</span>}
            </p>
          )}

          {r && (
            <Chips<FiltroNivel>
              items={[
                { id: "todos", label: "Todos los nodos", conteo: r.nodos },
                { id: "gmle", label: "Abiertos a GMLE", conteo: r.nodos_gmle },
              ]}
              activo={filtroNivel}
              onCambiar={setFiltroNivel}
              etiqueta="Filtrar por nivel de planificación"
            />
          )}

          {avisoNivel && (
            <div className="space-y-2">
              <Alert tono="exito" onCerrar={() => setAvisoNivel(null)}>
                {avisoNivel.exito}
              </Alert>
              {avisoNivel.sinAgrupacion > 0 && (
                <Alert tono="info">
                  {avisoNivel.sinAgrupacion} equivalencia{avisoNivel.sinAgrupacion === 1 ? "" : "s"} sin agrupación de estacionalidad: M7 no podrá proyectarla
                  {avisoNivel.sinAgrupacion === 1 ? "" : "s"}.{" "}
                  <Link href="/maestros/estacionalidad?pestana=faltantes" className="font-medium underline underline-offset-2">
                    Ver las faltantes
                  </Link>
                </Alert>
              )}
            </div>
          )}

          {gmlEspecial.error && (
            <Alert tono="info" onCerrar={() => gmlEspecial.setError(null)}>
              No se pudieron cargar las marcas relevantes por nodo: {gmlEspecial.error}. El árbol funciona igual, sin ese dato.{" "}
              <button type="button" onClick={() => void gmlEspecial.recargar()} className="font-medium underline underline-offset-2">
                Reintentar
              </button>
            </Alert>
          )}

          {cargando && !arbol && <p className="text-sm text-tinta-suave">Cargando el árbol…</p>}

          {agrupaciones.error && (
            <Alert onCerrar={() => agrupaciones.setError(null)}>
              No se pudieron cargar las agrupaciones de estacionalidad: {agrupaciones.error}. La columna Equivalencias muestra la agrupación pero no
              permite cambiarla.{" "}
              <button type="button" onClick={() => void agrupaciones.recargar()} className="font-medium underline underline-offset-2">
                Reintentar
              </button>
            </Alert>
          )}

          {responsables.error && (
            <Alert tono="info" onCerrar={() => responsables.setError(null)}>
              No se pudo cargar el responsable de cada combinación: {responsables.error}. El árbol funciona igual, sin mostrar responsables.{" "}
              <button type="button" onClick={() => void responsables.recargar()} className="font-medium underline underline-offset-2">
                Reintentar
              </button>
            </Alert>
          )}

          {arbol && generos.length === 0 && (
            <EmptyState titulo="El árbol está vacío" detalle="No hay géneros activos. Un administrador puede crearlos en Catálogos." />
          )}

          {arbol && generos.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-2">
                <Columna titulo="Géneros" subtitulo={`${generos.length} · ${soloGmle ? "nodos abiertos a GMLE" : "nodos vigentes"}`}>
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
                        const n = soloGmle ? m.lineas.filter(cuentaNodo).length : m.lineas.length;
                        const quien = textoResponsable(celdasResponsables.get(claveCelda(generoSel.id, m.id)));
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
                                {quien && (
                                  <span className={`block break-words text-xs leading-tight ${quien.tono === "alerta" ? "text-alerta" : "text-tinta-suave"}`}>{quien.texto}</span>
                                )}
                              </span>
                              <span className="shrink-0 text-xs text-tinta-suave">
                                {n} {soloGmle ? (n === 1 ? "abierta" : "abiertas") : `línea${n === 1 ? "" : "s"}`}
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
                    celdaResponsable={celdasResponsables.get(claveCelda(generoSel.id, mundoSel.id)) ?? null}
                    onCambio={recargarSilencioso}
                    onError={setError}
                    onMovido={(mundoId, nodoId) => setSel({ generoId: generoSel.id, mundoId, nodoId })}
                    onCambiarNivel={cambiarNivel}
                    ocupadoNivel={ocupadoNivel}
                    soloGmle={soloGmle}
                    relevantesPorNodo={puedeEditar ? relevantesPorNodo : null}
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
                    agrupaciones={agrupaciones.datos}
                    agrupacionesDisponibles={agrupaciones.error === null}
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
