"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError, plural } from "@/lib/formato";
import { descargarCsv } from "@/components/importador/csv";
import type { AgrupacionCurvasApi, EstadoCurvasApi, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { BadgeAgrupacion, useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { MiniCurva } from "@/components/curvas/mini-curva";
import { RedPanel } from "./red-panel";
import { CUERPO_APERTURA, enlaceDePrerrequisito } from "./trabajo-vista";
import type { AgrupacionConTemporada } from "./tipos";
import {
  ETIQUETA_AVISO_VIGENTE,
  FILTROS_ESTADO,
  contarEstados,
  filasCsvVigentes,
  filtrarAgrupaciones,
  formatearDiaMes,
  formatearFechaHora,
  generosDe,
  modeloConNombre,
  resumirComparacion,
  sistemaHoy,
  textoBloqueo,
  textoComparacionFila,
  textoEatConRuido,
  textoObsoleta,
  textoResumen,
  type FiltroEstado,
  type FiltroTemporada,
  type ResultadoComparar,
} from "./vista";

export type { FiltroEstado, FiltroTemporada, ResultadoComparar };

/**
 * Pestaña Agrupaciones (M6b): la lista de agrupaciones con su estado (sin curva · al día · al día pero distinta
 * de la recomendada · obsoleta con su motivo · inactiva con curva), los prerrequisitos globales arriba y el
 * resumen con bloqueadas y calculables. La unidad de trabajo es UNA agrupación: «Trabajar» la abre. «Comparar con
 * el sistema» (por fila) calcula la propuesta de hoy sin aprobar ni guardar nada; el resultado vive en memoria de
 * la pantalla. No hay tarjeta Calcular, selector de corridas, referencia ni selección múltiple.
 */
export function CurvasTab({
  estado,
  cargando,
  agrupacionesM3,
  filtroTemporada,
  onFiltroTemporada,
  filtroEstado,
  onFiltroEstado,
  comparaciones,
  onComparacion,
  onTrabajar,
  onIrAPeriodos,
  onCambio,
}: {
  estado: EstadoCurvasApi | null;
  cargando: boolean;
  agrupacionesM3: AgrupacionConTemporada[];
  filtroTemporada: FiltroTemporada;
  onFiltroTemporada: (f: FiltroTemporada) => void;
  filtroEstado: FiltroEstado;
  onFiltroEstado: (f: FiltroEstado) => void;
  /** Lo que dejó «Comparar con el sistema» por agrupación (vive en el panel: sobrevive a abrir una agrupación y volver). */
  comparaciones: Readonly<Record<string, ResultadoComparar>>;
  onComparacion: (agrupacionId: string, r: ResultadoComparar | null) => void;
  onTrabajar: (agrupacionId: string) => void;
  onIrAPeriodos: () => void;
  /** Tras retirar una curva: recarga el estado y las agrupaciones. */
  onCambio: () => Promise<void> | void;
}) {
  const [genero, setGenero] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [calculando, setCalculando] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const controles = useRef(new Map<string, AbortController>());
  const colores = useMapaColores(agrupacionesM3);

  useEffect(() => {
    const mapa = controles.current;
    return () => {
      for (const c of mapa.values()) c.abort();
    };
  }, []);

  const agrupaciones = useMemo(() => estado?.agrupaciones ?? [], [estado]);
  const estados = useMemo(() => contarEstados(agrupaciones), [agrupaciones]);
  const generos = useMemo(() => generosDe(agrupaciones), [agrupaciones]);
  const filas = useMemo(
    () => filtrarAgrupaciones(agrupaciones, { temporada: filtroTemporada, estado: filtroEstado, genero, busqueda }),
    [agrupaciones, filtroTemporada, filtroEstado, genero, busqueda]
  );

  const marcar = (id: string, activo: boolean) =>
    setCalculando((prev) => {
      const sig = new Set(prev);
      if (activo) sig.add(id);
      else sig.delete(id);
      return sig;
    });

  /** «Comparar con el sistema»: calcula a demanda con los parámetros de la última aprobación; no guarda nada. */
  async function comparar(a: AgrupacionCurvasApi) {
    const c = new AbortController();
    controles.current.set(a.id, c);
    marcar(a.id, true);
    setError(null);
    try {
      const t = await api.post<TrabajoAgrupacionApi>(`/api/curvas/agrupaciones/${a.id}/calcular`, CUERPO_APERTURA, { signal: c.signal });
      if (!c.signal.aborted) onComparacion(a.id, resumirComparacion(t));
    } catch (e) {
      if (!c.signal.aborted) setError(`${a.nombre}: ${mensajeError(e)}`);
    } finally {
      if (controles.current.get(a.id) === c) controles.current.delete(a.id);
      marcar(a.id, false);
    }
  }

  function cancelar(id: string) {
    controles.current.get(id)?.abort();
    controles.current.delete(id);
    marcar(id, false);
  }

  async function retirar(a: AgrupacionCurvasApi) {
    if (!a.vigente) return;
    if (!confirm(`¿Retirar la curva vigente de ${a.nombre} (v${a.vigente.version}, ${modeloConNombre(a.vigente.modelo)})? La agrupación quedará sin curva hasta que apruebes otra.`)) return;
    setOcupadoId(a.id);
    setError(null);
    setAviso(null);
    try {
      await api.delete(`/api/curvas/agrupaciones/${a.id}`);
      onComparacion(a.id, null);
      await onCambio();
      setAviso(`${a.nombre}: curva retirada.`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupadoId(null);
    }
  }

  function descargar() {
    const { campos, datos } = filasCsvVigentes(agrupaciones);
    descargarCsv(campos, datos, "curvas-vigentes.csv");
  }

  const itemsTemporada: ChipItem<FiltroTemporada>[] = estado
    ? [
        { id: "todas", label: "Todas", conteo: estado.resumen.agrupaciones_activas },
        { id: "invierno", label: "Invierno", conteo: estado.resumen.por_temporada.invierno },
        { id: "verano", label: "Verano", conteo: estado.resumen.por_temporada.verano },
        { id: "todo_el_ano", label: "Toda temporada", conteo: estado.resumen.por_temporada.todo_el_ano },
      ]
    : [{ id: "todas", label: "Todas" }];
  const itemsEstado: ChipItem<FiltroEstado>[] = FILTROS_ESTADO.map((f) => ({ id: f.id, label: f.label, conteo: estado ? estados[f.id] : undefined }));

  const columnas: Columna<AgrupacionCurvasApi>[] = [
    {
      clave: "agrupacion",
      titulo: "Agrupación",
      render: (a) => (
        <div className="min-w-48 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeAgrupacion agrupacion={a} colores={colores} />
            {!a.activo && <Badge tono="neutro">Inactiva</Badge>}
          </div>
          {a.generos.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label={`Géneros de ${a.nombre}`}>
              {a.generos.map((g) => (
                <li key={g}>
                  <Badge>{g}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-tinta-suave">{plural(a.equivalencias_activas, "equivalencia activa", "equivalencias activas")}</p>
        </div>
      ),
    },
    {
      clave: "temporada",
      titulo: "Temporada",
      render: (a) => (
        <div className="space-y-1">
          <BadgeTemporada temporada={a.temporada} />
          {a.temporada_sugerida !== null && a.temporada_sugerida !== a.temporada && (
            <p className="max-w-40 text-xs text-alerta">
              Las líneas sugieren <BadgeTemporada temporada={a.temporada_sugerida} />. Se cambia al trabajarla o en M3.
            </p>
          )}
        </div>
      ),
    },
    {
      clave: "vigente",
      titulo: "Curva aprobada",
      render: (a) => {
        const v = a.vigente;
        if (!v) return a.activo ? <span className="text-xs text-tinta-suave">Sin curva</span> : <span className="text-tinta-suave">—</span>;
        return (
          <div className="min-w-44 space-y-1 text-xs">
            <p className="text-tinta">
              <strong>v{v.version}</strong> · {modeloConNombre(v.modelo)}
              {v.eat !== null && <> · {textoEatConRuido(v.eat, v.ruido_normal)}</>}
            </p>
            <p className="text-tinta-suave" title={`Aprobada el ${formatearFechaHora(v.aprobada_at)}`}>
              {v.usuario_nombre ?? "—"} · {formatearDiaMes(v.aprobada_at)}
              {v.hasta_periodo ? ` · datos hasta ${v.hasta_periodo}` : ""}
            </p>
            {v.origen === "prestada" && <Badge tono="marca">Prestada (temporada)</Badge>}
            {v.nota && (
              <p className="max-w-56 truncate text-tinta-suave" title={v.nota}>
                nota: «{v.nota}»
              </p>
            )}
          </div>
        );
      },
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (a) => {
        const motivo = textoObsoleta(a.obsoleta);
        return (
          <div className="min-w-48 space-y-1 text-xs">
            {a.estado === "sin_curva" && <Badge tono="alerta">Sin curva</Badge>}
            {a.estado === "al_dia" && <Badge tono="exito">Al día</Badge>}
            {a.estado === "al_dia_distinta" && (
              <span title={a.vigente?.nota ? `Nota: ${a.vigente.nota}` : undefined}>
                <Badge tono="exito">Al día</Badge>
                <span className="mt-0.5 block text-tinta-suave">
                  distinta de la recomendada ({a.vigente?.recomendada_entonces ?? "?"}): se aprobó {a.vigente?.modelo}
                </span>
              </span>
            )}
            {a.estado === "obsoleta" && (
              <span title={motivo ?? undefined}>
                <Badge tono="alerta">Obsoleta</Badge>
                <span className="mt-0.5 block max-w-56 text-alerta">{a.obsoleta?.motivos.map((m) => m.detalle).join("; ")}</span>
              </span>
            )}
            {a.estado === "inactiva_con_curva" && <Badge tono="neutro">Inactiva con curva</Badge>}
            {a.bloqueada_por.length > 0 && (
              <p className="max-w-56 text-alerta" title="Falta algo imprescindible para calcularla">
                <span aria-hidden>⊘ </span>
                {textoBloqueo(a.bloqueada_por[0], a.temporada)}
              </p>
            )}
            {a.avisos_vigente.length > 0 && (
              <ul className="flex flex-wrap gap-1" aria-label={`Avisos de la curva de ${a.nombre}`}>
                {a.avisos_vigente.map((x) => (
                  <li key={x.codigo} title={x.detalle}>
                    <Badge tono="neutro">
                      <span aria-hidden>ⓘ</span> {ETIQUETA_AVISO_VIGENTE[x.codigo]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      },
    },
    {
      clave: "sistema",
      titulo: "Sistema hoy",
      render: (a) => {
        const r = comparaciones[a.id];
        if (calculando.has(a.id))
          return (
            <div className="space-y-1 text-xs" aria-live="polite">
              <p className="text-tinta-suave">Calculando…</p>
              <Button variante="fantasma" tamano="sm" onClick={() => cancelar(a.id)}>
                Cancelar
              </Button>
            </div>
          );
        if (r)
          return (
            <div className="min-w-40 max-w-56 space-y-1 text-xs">
              <p className={r.tipo === "comparada" && r.difiere ? "text-alerta" : "text-tinta"}>{textoComparacionFila(r)}</p>
              <Button variante="fantasma" tamano="sm" disabled={ocupadoId !== null} onClick={() => void comparar(a)}>
                Volver a comparar
              </Button>
            </div>
          );
        const s = sistemaHoy(a);
        if (s.tipo === "igual" || s.tipo === "distinta")
          return (
            <span className={`text-xs ${s.tipo === "distinta" ? "text-alerta" : "text-tinta"}`} title={s.tipo === "igual" ? "El modelo es determinista: con los mismos datos propondría lo mismo que al aprobar" : "Se aprobó otra candidata que la recomendada"}>
              {s.texto}
            </span>
          );
        if (s.tipo === "comparar")
          return (
            <Button variante="secundario" tamano="sm" disabled={ocupadoId !== null} onClick={() => void comparar(a)} title="Calcula la propuesta de hoy sin aprobar ni guardar nada">
              Comparar con el sistema
            </Button>
          );
        return <span className="text-tinta-suave">—</span>;
      },
    },
    {
      clave: "mini",
      titulo: "Curva",
      render: (a) => {
        const r = comparaciones[a.id];
        const propuesta = r && (r.tipo === "comparada" || r.tipo === "sin_vigente") ? r.curva : null;
        return <MiniCurva vigente={a.vigente?.curva} propuesta={propuesta} />;
      },
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (a) => (
        <div className="flex min-w-28 flex-col items-end gap-1">
          <Button tamano="sm" disabled={ocupadoId !== null} onClick={() => onTrabajar(a.id)} title="Abrir esta agrupación: curvas, parámetros y aprobación">
            Trabajar
          </Button>
          {a.vigente && (
            <Button variante="peligro" tamano="sm" disabled={ocupadoId !== null} onClick={() => void retirar(a)}>
              Retirar
            </Button>
          )}
        </div>
      ),
    },
  ];

  const globales = estado?.prerrequisitos_globales ?? [];
  const inactivasConCurva = estado?.resumen.inactivas_con_curva ?? 0;

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {estado && (
        <Card titulo="Resumen" acciones={
          <Button variante="secundario" tamano="sm" onClick={descargar} disabled={agrupaciones.every((a) => !a.vigente)}>
            Descargar curvas vigentes (CSV)
          </Button>
        }>
          <p className="text-sm text-tinta" aria-live="polite">
            {textoResumen(estado.resumen)}
          </p>
        </Card>
      )}

      {globales.length > 0 && (
        <Alert>
          <span className="block font-medium">Antes de calcular (global)</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {globales.map((p, i) => {
              const e = enlaceDePrerrequisito(p);
              return (
                <li key={`${p.codigo}-${i}`}>
                  {p.detalle}{" "}
                  {e?.tipo === "pestana" && (
                    <button type="button" onClick={onIrAPeriodos} className="font-medium underline underline-offset-2">
                      → {e.etiqueta}
                    </button>
                  )}
                  {e?.tipo === "ruta" && (
                    <Link href={e.href} className="font-medium underline underline-offset-2">
                      → {e.etiqueta}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Alert>
      )}

      {estado && estado.resumen.equivalencias_sin_agrupacion > 0 && (
        <Alert tono="info">
          {plural(estado.resumen.equivalencias_sin_agrupacion, "equivalencia activa no tiene", "equivalencias activas no tienen")} agrupación de estacionalidad: su venta no entra en ninguna curva.{" "}
          <Link href="/maestros/estacionalidad" className="font-medium underline underline-offset-2">
            → Faltantes de estacionalidad (M3)
          </Link>
        </Alert>
      )}

      <Card
        titulo="Agrupaciones"
        descripcion={
          cargando && !estado
            ? "Cargando agrupaciones…"
            : "Trabaja las agrupaciones una por una: «Trabajar» abre el gráfico con la curva aprobada, la de cada año y la propuesta del sistema, y ahí se aprueba."
        }
      >
        {estado && estado.agrupaciones.length === 0 ? (
          <EmptyState titulo="Todavía no hay agrupaciones" detalle="Créalas en Maestros → Agrupaciones de estacionalidad." />
        ) : (
          <div className="space-y-4">
            <div className="grid items-end gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-tinta">Buscar</span>
                <Input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value.toUpperCase())} placeholder="Nombre de la agrupación" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-tinta">Género</span>
                <Select value={genero} onChange={(e) => setGenero(e.target.value)}>
                  <option value="">Todos</option>
                  {generos.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Chips<FiltroTemporada> items={itemsTemporada} activo={filtroTemporada} onCambiar={onFiltroTemporada} etiqueta="Filtrar por temporada" />
              <Chips<FiltroEstado> items={itemsEstado} activo={filtroEstado} onCambiar={onFiltroEstado} etiqueta="Filtrar por estado" />
            </div>
            <DataTable
              columnas={columnas}
              filas={filas}
              claveFila={(a) => a.id}
              cargando={cargando && !estado}
              vacio="Ninguna agrupación coincide con los filtros."
              claseFila={(a) => (a.activo ? undefined : "bg-neutro-suave/60 text-tinta-suave")}
            />
            <p className="text-xs text-tinta-suave">
              «Sistema hoy»: con la curva al día el modelo (determinista) propondría lo mismo que al aprobar; si está obsoleta o sin curva, «Comparar con el sistema» calcula la
              propuesta de hoy con los parámetros de la última aprobación y muestra la diferencia, sin aprobar ni guardar nada. EAT: error absoluto total entre la curva y lo ocurrido,
              en puntos porcentuales.
              {inactivasConCurva > 0 && ` Las ${inactivasConCurva} inactivas con curva van al final, atenuadas (quita los filtros para verlas).`}
            </p>
          </div>
        )}
      </Card>

      <RedPanel />
    </div>
  );
}
