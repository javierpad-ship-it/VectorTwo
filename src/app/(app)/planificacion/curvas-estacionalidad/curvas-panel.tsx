"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useColeccion } from "@/lib/use-coleccion";
import type { EstadoCurvasApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import { AniosNinoTab } from "./anios-nino-tab";
import { CurvasTab } from "./curvas-tab";
import { DetalleAgrupacion } from "./detalle-agrupacion";
import { GeneroMundoTab, type DestinoGM } from "./genero-mundo/genero-mundo-tab";
import { PESTANA_GENERO_MUNDO, leerUrlGM, urlGM } from "./genero-mundo/vista";
import { PeriodosTab } from "./periodos-tab";
import type { AgrupacionConTemporada } from "./tipos";
import { useRecurso } from "./use-recurso";
import { esIdAgrupacion, esModeloCurva, filtrarAgrupaciones, vecinosDe, type FiltroEstado, type FiltroTemporada, type ResultadoComparar } from "./vista";

type PestanaLocal = "curvas" | "anios" | "periodos";
type Pestana = PestanaLocal | typeof PESTANA_GENERO_MUNDO;

/**
 * Pantalla /planificacion/curvas-estacionalidad (M6b). Cuatro pestañas: Agrupaciones (la lista con su estado y,
 * al «Trabajar» una, su vista de trabajo: curva aprobada, años y propuesta, parámetros y aprobación), Años Niño
 * (vista de apoyo a demanda), Periodos atípicos (el mantenimiento de los rangos de meses distorsionados) y
 * Crecimiento por género × mundo (06d: la curva de venta de cada género × mundo y el crecimiento global del año
 * siguiente que se aprueba una sola vez).
 *
 * Crecimiento por género × mundo también vive en la URL (M10): `?pestana=genero-mundo&anio=2027&proyeccion=<id>` abre la
 * lista y `?gm=<género>.<mundo>|resto&anio=…&proyeccion=…` abre el detalle (implica la pestaña). Si vienen `?agrupacion`
 * y `?gm` a la vez manda `?agrupacion` y `gm` se quita de la URL.
 *
 * La agrupación abierta vive en la URL (`?agrupacion=<id>`, y `&modelo=` para la candidata dibujada): recargar o
 * compartir el enlace reabre la misma vista; «← Agrupaciones» quita el parámetro. Se maneja con la API de
 * historial del navegador, que Next integra con `useSearchParams`. Admin y planner tienen las mismas
 * acciones; el comprador no entra (menú y página).
 */
export function CurvasPanel() {
  const parametros = useSearchParams();
  const pathname = usePathname();
  const idUrl = parametros.get("agrupacion");
  const agrupacionId = esIdAgrupacion(idUrl) ? idUrl : null;
  const modeloUrl = parametros.get("modelo");
  const modeloInicial = esModeloCurva(modeloUrl) ? modeloUrl : null;

  const urlDeGM = leerUrlGM(parametros);
  const gmEnUrl = parametros.get("gm") !== null;

  const [pestanaElegida, setPestana] = useState<PestanaLocal>("curvas");
  const [filtroTemporada, setFiltroTemporada] = useState<FiltroTemporada>("todas");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  /** Ids de la lista como se veía al pulsar «Trabajar» (filtros incluidos): el orden de Anterior / Siguiente. `null` tras recargar la página. */
  const [orden, setOrden] = useState<string[] | null>(null);
  const [comparaciones, setComparaciones] = useState<Record<string, ResultadoComparar>>({});
  const pestana: Pestana = agrupacionId ? "curvas" : urlDeGM.pestanaGM ? PESTANA_GENERO_MUNDO : pestanaElegida;

  // `?agrupacion` manda sobre `?gm`: el parámetro sobrante se quita de la URL sin añadir una entrada al historial.
  useEffect(() => {
    if (!agrupacionId || !gmEnUrl) return;
    const q = new URLSearchParams(window.location.search);
    q.delete("gm");
    window.history.replaceState(null, "", q.size > 0 ? `${pathname}?${q.toString()}` : pathname);
  }, [agrupacionId, gmEnUrl, pathname]);

  // Las pestañas Agrupaciones y Periodos leen las mismas agrupaciones (colores de M3 y temporada): una sola carga.
  const agrupaciones = useColeccion<AgrupacionConTemporada>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");
  const estado = useRecurso<EstadoCurvasApi>("/api/curvas");
  const colores = useMapaColores(agrupaciones.datos);
  const recargarAgrupaciones = agrupaciones.recargar;
  const recargarEstado = estado.recargar;

  const recargarTodo = useCallback(async () => {
    await Promise.all([recargarAgrupaciones(), recargarEstado()]);
  }, [recargarAgrupaciones, recargarEstado]);

  /** Cambia la URL sin recargar la página (`pushState` para abrir o cerrar la agrupación; `replaceState` para la candidata). */
  const irA = useCallback(
    (agrupacion: string | null, modo: "push" | "replace" = "push", modelo: string | null = null) => {
      const q = new URLSearchParams();
      if (agrupacion) q.set("agrupacion", agrupacion);
      if (agrupacion && modelo) q.set("modelo", modelo);
      const url = q.size > 0 ? `${pathname}?${q.toString()}` : pathname;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );

  /** Lista o detalle de Crecimiento por género × mundo en la URL (`pushState` al abrir o volver; `replaceState` al cambiar año o proyección). */
  const irAGM = useCallback(
    (destino: DestinoGM, modo: "push" | "replace" = "push") => {
      const url = urlGM(pathname, destino);
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );

  function trabajar(id: string, ordenLista?: string[]) {
    setPestana("curvas");
    setOrden(ordenLista ?? null);
    irA(id);
  }

  /** Anterior / Siguiente: otra agrupación con el mismo orden (la URL cambia; la vista se vuelve a montar). */
  function irAOtra(id: string) {
    irA(id);
  }

  function volverALaLista() {
    irA(null);
    void recargarTodo();
  }

  function cambiarPestana(siguiente: Pestana) {
    if (siguiente === PESTANA_GENERO_MUNDO) {
      // La pestaña nueva se identifica por la URL: una sola entrada de historial, también cuando venía de una agrupación.
      if (!urlDeGM.pestanaGM || agrupacionId || urlDeGM.gm) irAGM({ gm: null, anio: null, proyeccion: null });
      return;
    }
    if (agrupacionId || urlDeGM.pestanaGM) irA(null);
    // Al volver a la lista se relee el estado: lo que se hizo en otra pestaña (periodos) cambia los bloqueos.
    if (siguiente === "curvas" && pestana !== "curvas") void recargarEstado();
    setPestana(siguiente);
  }

  function irAPeriodos() {
    cambiarPestana("periodos");
  }

  function irARevisarTodaTemporada() {
    setFiltroTemporada("todo_el_ano");
    setFiltroEstado("todas");
    cambiarPestana("curvas");
  }

  function comparacion(id: string, r: ResultadoComparar | null) {
    setComparaciones((prev) => {
      const sig = { ...prev };
      if (r) sig[id] = r;
      else delete sig[id];
      return sig;
    });
  }

  // Vecinos: el orden recordado al abrir; si no se recuerda (recarga o enlace directo) o ya no contiene la agrupación, la lista completa por defecto.
  const nombres = useMemo(() => new Map((estado.datos?.agrupaciones ?? []).map((a) => [a.id, a.nombre])), [estado.datos]);
  const ordenCompleto = useMemo(
    () => filtrarAgrupaciones(estado.datos?.agrupaciones ?? [], { temporada: "todas", estado: "todas", genero: "", busqueda: "" }).map((a) => a.id),
    [estado.datos]
  );
  const vecinosRecordados = agrupacionId && orden ? vecinosDe(orden, agrupacionId, nombres) : null;
  const vecinos = agrupacionId ? (vecinosRecordados ?? vecinosDe(ordenCompleto, agrupacionId, nombres)) : null;

  const nombreInicial = agrupacionId ? (estado.datos?.agrupaciones.find((a) => a.id === agrupacionId)?.nombre ?? null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Curvas de estacionalidad</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          La curva mensual de cada agrupación sale de la venta real cargada en M5, sobre las mismas tiendas dentro de cada año. Trabaja las agrupaciones una por una: el modelo
          propone y compara, y tú apruebas una curva por agrupación después de revisar su detalle. Las curvas son un artefacto vivo: se marcan obsoletas cuando cambian la red de
          tiendas, la composición o los datos.
        </p>
      </div>

      <Tabs<Pestana>
        items={[
          { id: "curvas", label: "Agrupaciones" },
          { id: "anios", label: "Años Niño" },
          { id: "periodos", label: "Periodos atípicos" },
          { id: PESTANA_GENERO_MUNDO, label: "Crecimiento por género × mundo" },
        ]}
        activa={pestana}
        onCambiar={cambiarPestana}
      />

      {agrupaciones.error && <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>}
      {estado.error && <Alert onCerrar={() => estado.setError(null)}>No se pudo leer el estado de las curvas: {estado.error}</Alert>}

      {pestana === "curvas" &&
        (agrupacionId ? (
          <DetalleAgrupacion
            key={agrupacionId}
            agrupacionId={agrupacionId}
            nombreInicial={nombreInicial}
            colores={colores}
            modeloInicial={modeloInicial}
            vecinos={vecinos}
            ordenPorDefecto={vecinosRecordados === null}
            onIrA={irAOtra}
            onModelo={(m) => irA(agrupacionId, "replace", m)}
            onVolver={volverALaLista}
            onIrAPeriodos={irAPeriodos}
            onCambio={recargarTodo}
          />
        ) : (
          <CurvasTab
            estado={estado.datos}
            cargando={estado.cargando}
            agrupacionesM3={agrupaciones.datos}
            filtroTemporada={filtroTemporada}
            onFiltroTemporada={setFiltroTemporada}
            filtroEstado={filtroEstado}
            onFiltroEstado={setFiltroEstado}
            comparaciones={comparaciones}
            onComparacion={comparacion}
            onTrabajar={trabajar}
            onIrAPeriodos={irAPeriodos}
            onCambio={recargarTodo}
          />
        ))}
      {pestana === "anios" && <AniosNinoTab onVer={trabajar} />}
      {pestana === "periodos" && <PeriodosTab agrupaciones={agrupaciones.datos} onIrACurvas={irARevisarTodaTemporada} />}
      {pestana === PESTANA_GENERO_MUNDO && <GeneroMundoTab gm={urlDeGM.gm} anioUrl={urlDeGM.anio} proyeccionUrl={urlDeGM.proyeccion} onIr={irAGM} />}
    </div>
  );
}
