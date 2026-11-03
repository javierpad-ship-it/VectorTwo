"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { formatearNumero, plural } from "@/lib/formato";
import type { AprobacionApi, FilaAprobacionApi, FiltroLote } from "@/lib/aprobacion/tipos-api";
import type { EstadoPropuestaGM } from "@/lib/ia/tipos-api";
import type { IndiceLineaApi, ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BotonEnlace, Cargando } from "./comunes";
import { ConfirmarLoteModal, nombresDe, type Nombres } from "./confirmar-lote-modal";
import { SelectoresLinea } from "./filtros-vista";
import { HistorialLotes, RevertirModal } from "./historial-lotes";
import { TablaAprobacion } from "./tabla-aprobacion";
import { useAprobacion, useLotes, type DestinoReversion } from "./use-aprobacion";
import {
  ESTADOS_IA_FILTRABLES,
  ETIQUETA_ACCION_BLOQUEO,
  TEXTO_ORDEN_ANIOS,
  accionDeBloqueo,
  agruparPorGm,
  etiquetaAnio,
  filtrarFilas,
  filtroLoteDe,
  hayFiltroAprobacion,
  itemDeFila,
  motivoNoSeleccionable,
  parametrosAUrl,
  resumenSeleccion,
  textoBarraSeleccion,
  textoDesvio,
  textoIaCabecera,
  textoPendientesCierre,
  textoReaprobables,
  type GrupoGm,
  type ParametrosAprobacion,
} from "./aprobacion-vista";
import { ESTADO_GM } from "./propuesta-ia-vista";
import type { FiltroVista } from "./vista";

type OpcionMarca = { id: string; nombre: string };

// ─── Cabecera (§4.2) ───

export function CabeceraAprobacion({
  datos,
  anio,
  anioEnCurso,
  bloqueada,
  onAnio,
  onReaprobar,
  onVolverAAprobar,
  onRecalcular,
  onIrAFactores,
  onIrACrecimientos,
  onIrATiendas,
}: {
  datos: AprobacionApi;
  anio: number;
  anioEnCurso: number;
  /** La proyección no está en trabajo (cerrada o archivada) o se está calculando. */
  bloqueada: boolean;
  onAnio: (a: number) => void;
  onReaprobar: (a: number) => void;
  onVolverAAprobar: () => void;
  onRecalcular: () => void;
  onIrAFactores: () => void;
  onIrACrecimientos: () => void;
  onIrATiendas: () => void;
}) {
  const reaprobar = datos.modo === "reaprobar";
  const ia = textoIaCabecera(datos.ia, datos.gms.length);
  const totalReaprobables = datos.reaprobables.y + datos.reaprobables.y1;
  const cuenta = (a: number) => (reaprobar ? (a === anioEnCurso ? datos.reaprobables.y : datos.reaprobables.y1) : a === anioEnCurso ? datos.pendientes_cierre.filas_y : datos.pendientes_cierre.filas_y1);
  const acciones: Record<string, () => void> = { recalcular: onRecalcular, factores: onIrAFactores, crecimientos: onIrACrecimientos };

  return (
    <div className="space-y-3">
      <p className="text-sm text-tinta">
        {textoPendientesCierre(datos.pendientes_cierre, anioEnCurso)}
        {datos.pendientes_cierre.tiendas > 0 && (
          <>
            {" "}
            · <BotonEnlace onClick={onIrATiendas}>Tiendas nuevas y cierres</BotonEnlace>
          </>
        )}
      </p>

      {bloqueada && <Alert tono="info">La proyección no está en trabajo (o se está calculando): ves la lista y el historial en solo lectura.</Alert>}

      {datos.bloqueos.length > 0 && (
        <ul className="space-y-1.5" aria-label="Bloqueos">
          {datos.bloqueos.map((b) => {
            const a = accionDeBloqueo(b);
            return (
              <li key={b.codigo}>
                <Alert tono="alerta">
                  <span className="block">{b.mensaje}</span>
                  {a && (
                    <span className="mt-1 block">
                      <BotonEnlace onClick={acciones[a]}>{ETIQUETA_ACCION_BLOQUEO[a]}</BotonEnlace>
                    </span>
                  )}
                </Alert>
              </li>
            );
          })}
          <li>
            <p className="text-xs text-tinta-suave">Mientras haya un bloqueo no hay casillas: resuélvelo y vuelve a esta pestaña.</p>
          </li>
        </ul>
      )}

      {!reaprobar && totalReaprobables > 0 && (
        <Alert tono="info">
          <span className="block font-medium">{textoReaprobables(totalReaprobables)}</span>
          <span className="mt-1 flex flex-wrap gap-2">
            {datos.reaprobables.y > 0 && (
              <Button variante="secundario" tamano="sm" onClick={() => onReaprobar(anioEnCurso)}>
                Reaprobar {anioEnCurso} ({formatearNumero(datos.reaprobables.y)})
              </Button>
            )}
            {datos.reaprobables.y1 > 0 && (
              <Button variante="secundario" tamano="sm" onClick={() => onReaprobar(anioEnCurso + 1)}>
                Reaprobar {anioEnCurso + 1} ({formatearNumero(datos.reaprobables.y1)})
              </Button>
            )}
          </span>
        </Alert>
      )}

      {reaprobar && (
        <Alert tono="info">
          <span className="block font-medium">Reaprobar: actualiza lo aprobado en bloque cuya propuesta cambió tras el recálculo.</span>
          <span className="block">No toca nada decidido a mano. Primero {anioEnCurso} (método) y después {anioEnCurso + 1} (IA).</span>
          <span className="mt-1 block">
            <BotonEnlace onClick={onVolverAAprobar}>Volver a aprobar</BotonEnlace>
          </span>
        </Alert>
      )}

      <Alert tono={ia.tono}>{ia.texto}</Alert>

      <Tabs<"y" | "y1">
        items={[anioEnCurso, anioEnCurso + 1].map((a) => ({ id: a === anioEnCurso ? "y" : "y1", label: `${etiquetaAnio(a, anioEnCurso)} (${formatearNumero(cuenta(a))})` }))}
        activa={anio === anioEnCurso ? "y" : "y1"}
        onCambiar={(id) => onAnio(id === "y" ? anioEnCurso : anioEnCurso + 1)}
      />
      <p className="text-xs text-tinta-suave">{TEXTO_ORDEN_ANIOS}</p>
    </div>
  );
}

// ─── Filtros (§4.3) ───

function FiltrosAprobacion({
  filtro,
  indice,
  agrupacionesMarca,
  parametros,
  conIa,
  onFiltro,
  onParametros,
  onLimpiar,
}: {
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  agrupacionesMarca: readonly OpcionMarca[];
  parametros: ParametrosAprobacion;
  /** Año siguiente con IA: confianza, estado y brecha solo tienen sentido allí. */
  conIa: boolean;
  onFiltro: (c: Partial<FiltroVista>) => void;
  onParametros: (c: Partial<ParametrosAprobacion>) => void;
  onLimpiar: () => void;
}) {
  const activos = [...(parametros.incluirFuertes ? [] : ["sin_fuertes"]), ...(parametros.incluirRevision ? ["revision"] : [])];
  return (
    <div className="space-y-3 rounded-lg border border-borde bg-superficie p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectoresLinea filtro={filtro} indice={indice} onCambiar={onFiltro} compacto />
        <Field label="Agrupación de marca">
          <Select className="h-9" value={filtro.agrupacion_marca} onChange={(e) => onFiltro({ agrupacion_marca: e.target.value })}>
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
        <ChipsMultiples
          etiqueta="Qué filas incluir"
          valor={activos}
          items={[
            { id: "sin_fuertes", label: "Solo sin avisos fuertes", title: "Deja fuera las filas con brecha extrema o con absorción alta; se pueden incluir a propósito quitando este filtro" },
            { id: "revision", label: "Para revisión", title: "Cola larga con quiebres de stock: incluidas por defecto" },
          ]}
          onCambiar={(ids) => onParametros({ incluirFuertes: !ids.includes("sin_fuertes"), incluirRevision: ids.includes("revision") })}
        />
        {parametros.gm !== "" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-marca bg-marca-suave px-2.5 py-1 text-xs font-medium text-marca-oscura">
            GM: {parametros.gm}
            <button type="button" aria-label="Quitar el filtro de GM" onClick={() => onParametros({ gm: "" })} className="font-bold">
              ×
            </button>
          </span>
        )}
        {hayFiltroAprobacion(parametros, filtro) && (
          <Button variante="fantasma" tamano="sm" onClick={onLimpiar}>
            Quitar filtros
          </Button>
        )}
      </div>
      {conIa && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <span className="mb-1 block text-sm font-medium text-tinta">Confianza de la IA</span>
            <ChipsMultiples
              etiqueta="Confianza"
              valor={parametros.confianza}
              items={[
                { id: "alta", label: "Alta" },
                { id: "media", label: "Media" },
              ]}
              onCambiar={(ids) => onParametros({ confianza: ids.filter((i): i is "alta" | "media" => i === "alta" || i === "media") })}
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-tinta">Estado de la IA del GM</span>
            <ChipsMultiples
              etiqueta="Estado de la IA"
              valor={parametros.estadoIa}
              items={ESTADOS_IA_FILTRABLES.filter((e) => e === "al_dia" || e === "meta_movida" || e === "desactualizada" || e === "sin_propuesta").map((e) => ({ id: e, label: ESTADO_GM[e].texto }))}
              onCambiar={(ids) => onParametros({ estadoIa: ids as EstadoPropuestaGM[] })}
            />
          </div>
          <Field label="|Brecha| hasta (%)" className="w-32">
            <Input
              className="h-9"
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={parametros.brechaMaxPct ?? ""}
              onChange={(e) => onParametros({ brechaMaxPct: e.target.value === "" || !Number.isFinite(Number(e.target.value)) ? null : Math.max(0, Number(e.target.value)) })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── La lista con su selección ───

/**
 * La tabla con la selección y la barra de acciones. El estado de la selección y de los GM abiertos vive aquí, así que la pestaña la monta con `key = año + modo`:
 * cambiar de año o de modo empieza de cero. Lo que se marca vale solo si sigue visible y aprobable: el lote es lo que se ve.
 */
export function ListaAprobacion({
  datos,
  filtro,
  parametros,
  editable,
  onRevisar,
}: {
  datos: AprobacionApi;
  filtro: Pick<FiltroVista, "genero" | "mundo" | "linea" | "agrupacion_marca">;
  parametros: ParametrosAprobacion;
  editable: boolean;
  onRevisar: (filas: FilaAprobacionApi[]) => void;
}) {
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [abiertos, setAbiertos] = useState<ReadonlyMap<string, boolean>>(new Map());
  const reaprobar = datos.modo === "reaprobar";

  const visibles = useMemo(() => filtrarFilas(datos.filas, datos.gms, filtro, parametros), [datos.filas, datos.gms, filtro, parametros]);
  const grupos = useMemo(() => agruparPorGm(visibles, datos.gms), [visibles, datos.gms]);
  const aprobablesVisibles = useMemo(() => visibles.filter((f) => itemDeFila(f, datos.modo) !== null), [visibles, datos.modo]);
  const seleccionEfectiva = useMemo(() => aprobablesVisibles.filter((f) => marcadas.has(f.fila_id)), [aprobablesVisibles, marcadas]);
  const efectivaIds = useMemo(() => new Set(seleccionEfectiva.map((f) => f.fila_id)), [seleccionEfectiva]);
  const resumen = useMemo(() => resumenSeleccion(seleccionEfectiva, datos.gms), [seleccionEfectiva, datos.gms]);
  const excluidas = visibles.length - aprobablesVisibles.length;

  // Pocos GM → abiertos; muchos → cerrados (con 36 GM y ~680 filas, la página sería interminable).
  const abiertoPorDefecto = grupos.length <= 4 || parametros.gm !== "";
  const abierto = (clave: string) => abiertos.get(clave) ?? abiertoPorDefecto;

  function alternarFila(f: FilaAprobacionApi, v: boolean) {
    setMarcadas((prev) => {
      const s = new Set(prev);
      if (v) s.add(f.fila_id);
      else s.delete(f.fila_id);
      return s;
    });
  }

  function alternarGrupo(g: GrupoGm, v: boolean) {
    const ids = g.filas.filter((f) => motivoNoSeleccionable(f, datos.modo) === null).map((f) => f.fila_id);
    setMarcadas((prev) => {
      const s = new Set(prev);
      for (const id of ids) {
        if (v) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  }

  if (datos.filas.length === 0) {
    return (
      <EmptyState
        titulo={reaprobar ? `Nada que reaprobar en ${datos.anio}` : `No quedan filas que bloqueen el cierre en ${datos.anio}`}
        detalle={reaprobar ? "Ninguna fila aprobada en bloque cambió de propuesta." : "Las que ya están decididas no aparecen. Las tiendas nuevas y los cierres se deciden en su pestaña."}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta-suave">
          {plural(visibles.length, "fila visible", "filas visibles")} en {plural(grupos.length, "GM", "GM")}
          {excluidas > 0 && ` · ${plural(excluidas, "no se puede aprobar en bloque", "no se pueden aprobar en bloque")} (motivo en la tabla)`}
        </p>
        <span className="flex flex-wrap gap-2">
          <Button
            variante="secundario"
            tamano="sm"
            disabled={!editable || aprobablesVisibles.length === 0}
            onClick={() => setMarcadas((prev) => new Set([...prev, ...aprobablesVisibles.map((f) => f.fila_id)]))}
          >
            Seleccionar las {formatearNumero(aprobablesVisibles.length)} visibles
          </Button>
          <Button variante="fantasma" tamano="sm" disabled={seleccionEfectiva.length === 0} onClick={() => setMarcadas(new Set())}>
            Limpiar selección
          </Button>
          <Button variante="fantasma" tamano="sm" onClick={() => setAbiertos(new Map(grupos.map((g) => [g.gm_clave, true] as const)))}>
            Abrir todos los GM
          </Button>
          <Button variante="fantasma" tamano="sm" onClick={() => setAbiertos(new Map(grupos.map((g) => [g.gm_clave, false] as const)))}>
            Cerrar todos
          </Button>
        </span>
      </div>

      {grupos.length === 0 ? (
        <EmptyState titulo="Ninguna fila coincide con los filtros" detalle="Quita algún filtro: «Solo sin avisos fuertes» deja fuera las filas con brecha extrema o absorción alta." />
      ) : (
        <TablaAprobacion
          grupos={grupos}
          anio={datos.anio}
          anioEnCurso={datos.anio_en_curso}
          modo={datos.modo}
          editable={editable}
          seleccion={efectivaIds}
          abierto={abierto}
          onAlternarFila={alternarFila}
          onAlternarGrupo={alternarGrupo}
          onAlternarAbierto={(clave) => setAbiertos((prev) => new Map(prev).set(clave, !abierto(clave)))}
        />
      )}

      <div className="sticky bottom-0 z-10 space-y-2 rounded-lg border border-borde bg-superficie p-3 shadow-md" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-tinta">{seleccionEfectiva.length === 0 ? "Marca las filas que quieres aprobar." : textoBarraSeleccion(resumen)}</p>
          <Button disabled={!editable || seleccionEfectiva.length === 0} onClick={() => onRevisar(seleccionEfectiva)}>
            {reaprobar ? "Revisar y reaprobar" : "Revisar y aprobar"}
          </Button>
        </div>
        {resumen.porGm.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-tinta-suave">Ver por GM</summary>
            <ul className="mt-1 max-h-40 divide-y divide-borde overflow-y-auto">
              {resumen.porGm.map((g) => (
                <li key={g.gm_clave} className="flex flex-wrap justify-between gap-x-3 py-1">
                  <span>{g.nombre}</span>
                  <span className="text-tinta-suave">
                    {plural(g.filas, "fila", "filas")} · {formatearNumero(g.unidades)} u · desvío de hoy {textoDesvio(g.desvio_u, g.desvio_pct)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-tinta-suave">El desvío que quedaría después se calcula al simular, en el paso siguiente.</p>
          </details>
        )}
      </div>
    </div>
  );
}

// ─── La pestaña ───

type Dialogo =
  | { tipo: "confirmar"; filas: FilaAprobacionApi[]; filtro: FiltroLote; anio: number; nombres: Nombres; clave: string }
  | { tipo: "revertir"; destino: DestinoReversion; nombres: Nombres }
  | null;

/**
 * Pestaña «Aprobación» (07g, §4): aprueba en bloque, con la fuente a la vista, las filas que bloquean el cierre (2026 con el método, 2027 con la IA), reaprueba tras un
 * recálculo y revierte desde el historial. Todo va por `/api/proyeccion/proyecciones/[id]/aprobacion/**`; el servidor decide elegibilidad, exclusiones y bloqueos, y el
 * navegador solo filtra, selecciona, simula y confirma. Admin y planner (el comprador no entra a la pantalla).
 */
export function AprobacionTab({
  proyeccion,
  filtro,
  indice,
  agrupacionesMarca,
  parametros,
  bloqueada,
  onFiltro,
  onParametros,
  onLimpiar,
  onCambio,
  onRecalcular,
  onIrAFactores,
  onIrACrecimientos,
  onIrATiendas,
}: {
  proyeccion: ProyeccionApi;
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  agrupacionesMarca: readonly OpcionMarca[];
  parametros: ParametrosAprobacion;
  bloqueada: boolean;
  onFiltro: (cambios: Partial<FiltroVista>) => void;
  /** Cambios de los parámetros propios de la pestaña (van a la URL con `parametrosAUrl`). */
  onParametros: (cambios: Record<string, string | null>) => void;
  onLimpiar: () => void;
  onCambio: () => Promise<void>;
  onRecalcular: () => void;
  onIrAFactores: () => void;
  onIrACrecimientos: () => void;
  onIrATiendas: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const anio = parametros.anio === y + 1 ? y + 1 : y;
  const lectura = useAprobacion(proyeccion.id, anio, parametros.modo);
  const lotes = useLotes(proyeccion.id);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const datos = lectura.datos;

  const editable = !bloqueada && datos !== null && datos.editable && datos.bloqueos.length === 0;
  const nombresActuales = useMemo(() => (datos ? nombresDe(datos.gms, datos.filas) : { gm: new Map<string, string>(), fila: new Map<string, string>() }), [datos]);
  const puedeRevertir = !bloqueada && proyeccion.estado === "en_trabajo";

  async function recargarTodo() {
    await Promise.all([lectura.recargar(), lotes.recargar(), onCambio()]);
  }

  function cambiarParametros(c: Partial<ParametrosAprobacion>) {
    onParametros(parametrosAUrl(c));
  }

  function revisar(filas: FilaAprobacionApi[]) {
    if (!datos) return;
    setDialogo({ tipo: "confirmar", filas, filtro: filtroLoteDe(filtro, parametros), anio: datos.anio, nombres: nombresDe(datos.gms, datos.filas), clave: crypto.randomUUID() });
  }

  async function cerrarConfirmar(huboCambios: boolean) {
    setDialogo(null);
    if (huboCambios) await recargarTodo();
  }

  return (
    <div className="space-y-6">
      <Card
        titulo="Aprobación en bloque"
        descripcion="Aprueba de una vez las filas que bloquean el cierre: 2026 con la propuesta del método y 2027 con la IA. Siempre ves la fuente de cada cifra, simulas antes de confirmar y puedes deshacer. Lo decidido a mano nunca se toca."
      >
        {lectura.error && (
          <div className="mb-3">
            <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />
          </div>
        )}
        {lectura.cargando && !datos && <Cargando texto="Leyendo las filas que bloquean el cierre…" />}
        {datos && (
          <div className="space-y-4">
            <CabeceraAprobacion
              datos={datos}
              anio={datos.anio}
              anioEnCurso={y}
              bloqueada={bloqueada}
              onAnio={(a) => cambiarParametros({ anio: a })}
              onReaprobar={(a) => cambiarParametros({ modo: "reaprobar", anio: a })}
              onVolverAAprobar={() => cambiarParametros({ modo: "aprobar" })}
              onRecalcular={onRecalcular}
              onIrAFactores={onIrAFactores}
              onIrACrecimientos={onIrACrecimientos}
              onIrATiendas={onIrATiendas}
            />
            <FiltrosAprobacion
              filtro={filtro}
              indice={indice}
              agrupacionesMarca={agrupacionesMarca}
              parametros={parametros}
              conIa={datos.anio === y + 1}
              onFiltro={onFiltro}
              onParametros={cambiarParametros}
              onLimpiar={onLimpiar}
            />
            <ListaAprobacion key={`${datos.anio}-${datos.modo}-${datos.calculado_at}`} datos={datos} filtro={filtro} parametros={parametros} editable={editable} onRevisar={revisar} />
          </div>
        )}
      </Card>

      <HistorialLotes
        proyeccionId={proyeccion.id}
        lotes={lotes.datos?.lotes ?? null}
        cargando={lotes.cargando}
        error={lotes.error}
        editable={puedeRevertir}
        nombres={nombresActuales}
        onRecargar={() => void lotes.recargar()}
        onCambio={recargarTodo}
        onIrACrecimientos={onIrACrecimientos}
      />

      {dialogo?.tipo === "confirmar" && datos && (
        <ConfirmarLoteModal
          key={dialogo.clave}
          proyeccionId={proyeccion.id}
          anio={dialogo.anio}
          anioEnCurso={y}
          modo={datos.modo}
          seleccion={dialogo.filas}
          gms={datos.gms}
          nombres={dialogo.nombres}
          filtro={dialogo.filtro}
          onCerrar={(hubo) => void cerrarConfirmar(hubo)}
          onDeshacer={(confirmacionId, nLotes) => {
            const nombres = dialogo.nombres;
            void recargarTodo();
            setDialogo({ tipo: "revertir", nombres, destino: { tipo: "confirmacion", confirmacionId, nLotes, etiqueta: "esta aprobación" } });
          }}
          onIrACrecimientos={() => {
            void cerrarConfirmar(true).then(onIrACrecimientos);
          }}
          onIrAFactores={() => {
            void cerrarConfirmar(false).then(onIrAFactores);
          }}
          onRecalcular={() => {
            void cerrarConfirmar(false).then(onRecalcular);
          }}
        />
      )}
      {dialogo?.tipo === "revertir" && (
        <RevertirModal
          proyeccionId={proyeccion.id}
          destino={dialogo.destino}
          nombres={dialogo.nombres}
          onCerrar={async (hecho) => {
            setDialogo(null);
            if (hecho) await recargarTodo();
          }}
          onIrACrecimientos={onIrACrecimientos}
        />
      )}
    </div>
  );
}
