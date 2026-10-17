"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import type { CurvaVigenteApi } from "@/lib/curvas/tipos-api";
import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import type { IndiceLineaApi, NodoMatrizApi, ProyeccionApi, RespuestaLineasApi, RespuestaProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { AntesDeProyectar } from "./antes-de-proyectar";
import { CabeceraProyeccion } from "./cabecera-proyeccion";
import { ArchivarModal } from "./archivar-modal";
import { CerrarModal } from "./cerrar-modal";
import { CrecimientosTab } from "./crecimientos-tab";
import { AlertaError, Cargando } from "./comunes";
import { FactoresTab } from "./factores-tab";
import { FormularioProyeccion } from "./formulario-proyeccion";
import { LineaTab } from "./linea-tab";
import { MatrizTab } from "./matriz-tab";
import { MensualTab } from "./mensual-tab";
import { TiendasTab } from "./tiendas-tab";
import { rutaProyeccion, useAccion, useLectura, useSondeo } from "./use-proyeccion";
import { aplicarCambiosUrl, CLAVES_FILTRO, esPestana, leerFiltro, PESTANAS, puedeEditar, type FiltroVista, type Pestana } from "./vista";

const SIN_INDICE: IndiceLineaApi[] = [];
const ID = /^[0-9A-Za-z-]{1,64}$/;
const idONulo = (v: string | null) => (v !== null && ID.test(v) ? v : null);

type Dialogo = { tipo: "nueva"; copiarDe?: string } | { tipo: "parametros" } | { tipo: "cerrar" } | { tipo: "archivar" } | null;

/** La proyección que se abre sola: la que está en trabajo (la más reciente) o, si no hay, la cerrada más reciente. */
function proyeccionPorDefecto(lista: readonly ProyeccionApi[]): ProyeccionApi | null {
  const masReciente = (xs: readonly ProyeccionApi[]) => [...xs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  return masReciente(lista.filter((p) => p.estado === "en_trabajo")) ?? masReciente(lista.filter((p) => p.estado === "cerrada")) ?? masReciente(lista) ?? null;
}

/**
 * Pantalla /planificacion/proyeccion (M7). Proyección anual de unidades del año en curso y del siguiente, por GML ×
 * agrupación de marca. Seis pestañas en el orden de trabajo: Factores del Niño · Tiendas nuevas y cierres · Crecimientos
 * (matriz género × mundo, 07c) · Por línea (Parte 1) · Matriz (Parte 2) · Mensual (Parte 3, solo lectura). Todo el estado de la vista vive en la URL
 * (`?proyeccion=&pestana=&genero=&mundo=&linea=&temporada=&agrupacion_estacionalidad=&agrupacion_marca=&solo=&fila=&tienda=`):
 * recargar o compartir el enlace reabre la misma vista y cambiar de pestaña conserva el recorte. Admin y planner tienen las
 * mismas acciones; el comprador no entra (menú y página). Nada se aprueba en bloque.
 */
export function ProyeccionPanel() {
  const params = useSearchParams();
  const pathname = usePathname();
  const idUrl = idONulo(params.get("proyeccion"));
  const pestanaUrl = params.get("pestana");
  const pestana: Pestana = esPestana(pestanaUrl) ? pestanaUrl : "linea";
  const filtro = useMemo(() => leerFiltro(params), [params]);
  const filaId = idONulo(params.get("fila"));
  const tiendaId = idONulo(params.get("tienda"));

  const estado = useLectura<RespuestaProyeccionApi>("/api/proyeccion");
  const lista = useMemo(() => estado.datos?.proyecciones ?? [], [estado.datos]);
  const idElegido = idUrl && lista.some((p) => p.id === idUrl) ? idUrl : (proyeccionPorDefecto(lista)?.id ?? null);
  const actual = useLectura<ProyeccionApi>(idElegido ? rutaProyeccion(idElegido) : null);
  const lineas = useLectura<RespuestaLineasApi>(idElegido ? `${rutaProyeccion(idElegido)}/lineas` : null);
  const estacionalidad = useColeccion<AgrupacionEstacionalidadFila>("/api/agrupaciones-estacionalidad");
  const marcas = useColeccion<AgrupacionMarcaFila>("/api/agrupaciones-marca");
  // 06c: cuántas curvas vigentes de M6 son del usuario (no se marcan obsoletas: la línea informativa de «Antes de proyectar»).
  const curvasVigentes = useColeccion<CurvaVigenteApi>("/api/curvas/vigentes");
  const curvasUsuario = useMemo(() => curvasVigentes.datos.filter((c) => c.origen_curva === "usuario").length, [curvasVigentes.datos]);

  const accion = useAccion();
  const [calculandoLocal, setCalculandoLocal] = useState(false);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const proyeccion = actual.datos;
  // La pestaña de la URL se respeta desde el primer render (sin parpadeo de otra pestaña); solo si ya se supo que no hay
  // ninguna proyección se cae a Factores del Niño, la única que no la necesita.
  const sinProyeccion = estado.datos !== null && idElegido === null;
  const pestanaVisible: Pestana = sinProyeccion ? "factores" : pestana;
  const indice = lineas.datos?.indice_lineas ?? SIN_INDICE;
  const editable = puedeEditar(proyeccion, calculandoLocal);
  const optsEstacionalidad = useMemo(() => estacionalidad.datos.filter((a) => a.activo).map((a) => ({ id: a.id, nombre: a.nombre })), [estacionalidad.datos]);
  const optsMarca = useMemo(() => marcas.datos.filter((a) => a.activo).map((a) => ({ id: a.id, nombre: a.nombre })), [marcas.datos]);
  const nombresAgrupacion = useMemo(() => new Map(estacionalidad.datos.map((a) => [a.id, a.nombre] as const)), [estacionalidad.datos]);

  // Si otra sesión está calculando, se vuelve a leer cada pocos segundos hasta que termine.
  const recargarProyeccion = actual.recargar;
  useSondeo(Boolean(proyeccion?.calculando) && !calculandoLocal, recargarProyeccion);

  const recargarTodo = useCallback(async () => {
    await Promise.all([estado.recargar(), actual.recargar(), lineas.recargar()]);
  }, [estado, actual, lineas]);

  /** Cambia la URL sin recargar la página (`pushState` para ir a otro lugar; `replaceState` para filtros). */
  const cambiarUrl = useCallback(
    (cambios: Record<string, string | null>, modo: "push" | "replace" = "push") => {
      const q = aplicarCambiosUrl(window.location.search, cambios);
      const url = q ? `${pathname}?${q}` : pathname;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );

  function elegirProyeccion(id: string) {
    cambiarUrl({ proyeccion: id, fila: null, tienda: null });
  }

  function cambiarPestana(p: Pestana) {
    cambiarUrl({ pestana: p, fila: null, tienda: null });
  }

  const cambiarFiltro = useCallback(
    (cambios: Partial<FiltroVista>) => {
      const url: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(cambios)) url[k] = v ?? null;
      // Cambiar de línea cierra el detalle de la fila abierta.
      if ("genero" in cambios || "mundo" in cambios || "linea" in cambios) url.fila = null;
      cambiarUrl(url, "replace");
    },
    [cambiarUrl]
  );

  function limpiarFiltro() {
    cambiarUrl(Object.fromEntries([...CLAVES_FILTRO.map((k) => [k, null] as const), ["fila", null] as const]), "replace");
  }

  function irALinea(ids: NodoMatrizApi["ids"]) {
    cambiarUrl({ pestana: "linea", genero: ids.genero_id ?? null, mundo: ids.mundo_id ?? null, linea: ids.linea_id ?? null, fila: null, tienda: null });
  }

  function irATiendas() {
    cambiarUrl({ pestana: "tiendas", fila: null });
  }

  function irATienda(id: string) {
    cambiarUrl({ pestana: "tiendas", fila: null, tienda: id });
  }

  async function recalcular() {
    if (!proyeccion || calculandoLocal) return;
    setAviso(null);
    setCalculandoLocal(true);
    const r = await accion.ejecutar(() => api.post<ProyeccionApi>(`${rutaProyeccion(proyeccion.id)}/calcular`, {}));
    setCalculandoLocal(false);
    if (r.ok) setAviso("Proyección recalculada. Tus decisiones se conservaron; las que cambiaron de propuesta o de curva quedaron marcadas.");
    await recargarTodo();
  }

  async function archivar() {
    if (!proyeccion) return;
    // La cerrada es la única de su año: archivarla deja a M8 sin entrada, así que pide un diálogo propio y claro.
    if (proyeccion.estado === "cerrada") {
      setDialogo({ tipo: "archivar" });
      return;
    }
    if (!confirm(`¿Archivar «${proyeccion.nombre}»? Quedará en solo lectura y dejará de ser una proyección de trabajo.`)) return;
    setAviso(null);
    const r = await accion.ejecutar(() => api.post<ProyeccionApi>(`${rutaProyeccion(proyeccion.id)}/archivar`, {}));
    if (r.ok) setAviso(`«${proyeccion.nombre}» quedó archivada.`);
    await recargarTodo();
  }

  async function eliminar() {
    if (!proyeccion) return;
    if (!confirm(`¿Eliminar «${proyeccion.nombre}»? Solo se puede si no tiene decisiones; si las tiene, hay que archivarla. Esta acción no se puede deshacer.`)) return;
    setAviso(null);
    const r = await accion.ejecutar(() => api.delete(rutaProyeccion(proyeccion.id)));
    if (r.ok) {
      setAviso(`«${proyeccion.nombre}» se eliminó.`);
      cambiarUrl({ proyeccion: null, fila: null, tienda: null });
    }
    await recargarTodo();
  }

  async function guardada(p: ProyeccionApi, mensaje: string) {
    setAviso(mensaje);
    await estado.recargar();
    cambiarUrl({ proyeccion: p.id, fila: null, tienda: null });
    await Promise.all([actual.recargar(), lineas.recargar()]);
  }

  const perfiles = useMemo(() => {
    const conPerfil = lista.find((p) => (p.resumen?.perfiles_apertura.length ?? 0) > 0);
    return conPerfil?.resumen?.perfiles_apertura ?? [];
  }, [lista]);

  const bloqueos = estado.datos?.prerrequisitos.bloquea.length ?? 0;
  const ordenadas = useMemo(
    () => [...lista].sort((a, b) => b.anio_en_curso - a.anio_en_curso || Number(b.estado === "en_trabajo") - Number(a.estado === "en_trabajo") || b.updated_at.localeCompare(a.updated_at)),
    [lista]
  );
  const etiquetaEstado = (e: ProyeccionApi["estado"]) => (e === "en_trabajo" ? "en trabajo" : e);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Proyección de unidades</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Las unidades del año en curso y del año siguiente completos, por género · mundo · línea · agrupación de marca. El sistema propone con la curva vigente de M6; tú decides cada cifra, una por una. Las tiendas nuevas van
            antes que las líneas porque alimentan la base del año siguiente.
          </p>
        </div>
        <Button disabled={!estado.datos || bloqueos > 0} title={bloqueos > 0 ? "Hay bloqueos en «Antes de proyectar»" : undefined} onClick={() => setDialogo({ tipo: "nueva" })}>
          Nueva proyección
        </Button>
      </div>

      {estado.error && <AlertaError error={estado.error} onCerrar={() => estado.setError(null)} onRecargar={() => void estado.recargar()} />}
      {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={() => void recalcular()} onRecargar={() => void recargarTodo()} />}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}
      {estado.cargando && !estado.datos && <Cargando />}

      {estado.datos && (
        <AntesDeProyectar datos={estado.datos.datos} prerrequisitos={estado.datos.prerrequisitos} abierta={ordenadas.length === 0 ? true : undefined} curvasUsuario={curvasUsuario} />
      )}

      {estado.datos && ordenadas.length > 0 && (
        <div className="max-w-xl">
          <Field label="Proyección">
            <Select value={idElegido ?? ""} onChange={(e) => elegirProyeccion(e.target.value)}>
              {ordenadas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} · {p.anio_en_curso}–{p.anio_siguiente} · {etiquetaEstado(p.estado)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {estado.datos && ordenadas.length === 0 && (
        <EmptyState titulo="Todavía no hay ninguna proyección" detalle="Crea la primera con la venta publicada hasta el último mes cerrado. Antes revisa «Antes de proyectar»: si algo bloquea, se corrige en Carga de venta y stock, Curvas de estacionalidad o Tiendas.">
          <Button disabled={bloqueos > 0} onClick={() => setDialogo({ tipo: "nueva" })}>
            Nueva proyección
          </Button>
        </EmptyState>
      )}

      {actual.error && <AlertaError error={actual.error} onCerrar={() => actual.setError(null)} onRecargar={() => void actual.recargar()} />}
      {proyeccion && (
        <CabeceraProyeccion
          proyeccion={proyeccion}
          calculandoLocal={calculandoLocal}
          ocupado={accion.ocupado}
          onRecalcular={() => void recalcular()}
          onParametros={() => setDialogo({ tipo: "parametros" })}
          onCerrar={() => setDialogo({ tipo: "cerrar" })}
          onArchivar={() => void archivar()}
          onEliminar={() => void eliminar()}
          onCopiar={() => setDialogo({ tipo: "nueva", copiarDe: proyeccion.id })}
        />
      )}

      <Tabs<Pestana>
        items={PESTANAS.map((p) => ({ id: p.id, label: p.etiqueta, disabled: p.id !== "factores" && sinProyeccion }))}
        activa={pestanaVisible}
        onCambiar={cambiarPestana}
      />

      {lineas.error && proyeccion && pestana !== "factores" && <AlertaError error={`No se pudo leer el índice de líneas: ${lineas.error}`} onCerrar={() => lineas.setError(null)} onRecargar={() => void lineas.recargar()} />}
      {estacionalidad.error && <Alert onCerrar={() => estacionalidad.setError(null)}>No se pudieron cargar las agrupaciones de estacionalidad: {estacionalidad.error}</Alert>}
      {marcas.error && <Alert onCerrar={() => marcas.setError(null)}>No se pudieron cargar las agrupaciones de marca: {marcas.error}</Alert>}

      {pestanaVisible === "factores" && <FactoresTab puedeEditar onCambio={recargarTodo} />}

      {proyeccion && pestana === "tiendas" && <TiendasTab proyeccion={proyeccion} tiendaId={tiendaId} bloqueada={!editable} onCambio={recargarTodo} onRecalcular={() => void recalcular()} />}

      {proyeccion && pestana === "crecimientos" && (
        <CrecimientosTab proyeccion={proyeccion} bloqueada={!editable} onCambio={recargarTodo} onRecalcular={recalcular} onCalculando={setCalculandoLocal} />
      )}

      {proyeccion && pestana === "linea" && (
        <LineaTab
          proyeccion={proyeccion}
          filtro={filtro}
          indice={indice}
          filaId={filaId}
          bloqueada={!editable}
          nombresAgrupacion={nombresAgrupacion}
          onFiltro={cambiarFiltro}
          onFila={(id) => cambiarUrl({ fila: id })}
          onIrATiendas={irATiendas}
          onIrATienda={irATienda}
          onCambio={recargarTodo}
          onRecalcular={() => void recalcular()}
        />
      )}

      {proyeccion && pestana === "matriz" && (
        <MatrizTab
          proyeccion={proyeccion}
          filtro={filtro}
          indice={indice}
          agrupacionesEstacionalidad={optsEstacionalidad}
          agrupacionesMarca={optsMarca}
          onFiltro={cambiarFiltro}
          onLimpiar={limpiarFiltro}
          onIrALinea={irALinea}
          onIrATiendas={irATiendas}
        />
      )}

      {proyeccion && pestana === "mensual" && (
        <MensualTab proyeccion={proyeccion} filtro={filtro} indice={indice} agrupacionesEstacionalidad={optsEstacionalidad} agrupacionesMarca={optsMarca} onFiltro={cambiarFiltro} onLimpiar={limpiarFiltro} />
      )}

      {!proyeccion && pestanaVisible !== "factores" && !sinProyeccion && !actual.error && <Cargando texto={estado.datos ? "Leyendo la proyección…" : "Cargando…"} />}

      {dialogo?.tipo === "nueva" && estado.datos && (
        <FormularioProyeccion
          estado={estado.datos}
          bloques={estado.datos.bloques_hoy}
          perfiles={perfiles}
          copiarDeInicial={dialogo.copiarDe}
          onCerrar={() => setDialogo(null)}
          onGuardada={(p) => guardada(p, `«${p.nombre}» creada y calculada.`)}
        />
      )}
      {dialogo?.tipo === "parametros" && estado.datos && proyeccion && (
        <FormularioProyeccion
          estado={estado.datos}
          proyeccion={proyeccion}
          bloques={proyeccion.bloques}
          perfiles={perfiles}
          onCerrar={() => setDialogo(null)}
          onIrACrecimientos={() => cambiarPestana("crecimientos")}
          onGuardada={async (p) => {
            setAviso("Parámetros guardados. Recalcula para que las cifras los usen.");
            await Promise.all([estado.recargar(), actual.recargar()]);
            return void p;
          }}
        />
      )}
      {dialogo?.tipo === "archivar" && proyeccion && (
        <ArchivarModal
          proyeccion={proyeccion}
          onCerrar={() => setDialogo(null)}
          onArchivada={async (p) => {
            setAviso(`«${p.nombre}» quedó archivada. El año ${p.anio_en_curso} no tiene proyección cerrada.`);
            await recargarTodo();
          }}
        />
      )}
      {dialogo?.tipo === "cerrar" && proyeccion && (
        <CerrarModal
          proyeccion={proyeccion}
          onCerrar={() => setDialogo(null)}
          onCerrada={async (p) => {
            setAviso(`«${p.nombre}» quedó cerrada. Es solo lectura: M8 la leerá como único insumo de volumen.`);
            await recargarTodo();
          }}
          onRecalcular={() => {
            setDialogo(null);
            void recalcular();
          }}
        />
      )}
    </div>
  );
}
