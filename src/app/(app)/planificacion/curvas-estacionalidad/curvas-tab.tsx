"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { descargarCsv } from "@/components/importador/csv";
import type { AgrupacionCurvasApi, CalcularRespuesta, EstadoCurvasApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form";
import { BadgeAgrupacion, useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import {
  ETIQUETA_TEMPORADA,
  OPCIONES_TEMPORADA,
  esTemporada,
  type TemporadaAgrupacion,
} from "@/components/estacionalidad/temporada";
import { MiniCurva } from "@/components/curvas/mini-curva";
import { CalcularCard } from "./calcular-card";
import { RedPanel } from "./red-panel";
import type { FormularioParametros } from "./parametros-form";
import type { AgrupacionConTemporada } from "./tipos";
import {
  ETIQUETA_AVISO,
  ETIQUETA_ESTABILIDAD,
  ETIQUETA_MOTIVO_RECOMENDACION,
  FILTROS_ESTADO,
  claseColorAnio,
  contarEstados,
  filasCsvVigentes,
  filtrarAgrupaciones,
  formatearDiaMes,
  formatearFactor,
  formatearFechaHora,
  formatearPp,
  generosDe,
  modeloConNombre,
  textoAnio,
  textoObsoleta,
  textoResumen,
  type FiltroEstado,
  type FiltroTemporada,
} from "./vista";

export type { FiltroEstado, FiltroTemporada };

/**
 * Pestaña Curvas (M6, paso 2): el estado de las curvas de cada agrupación (la
 * vigente, la propuesta de la corrida elegida, obsolescencia con su motivo), la
 * tarjeta Calcular, la red comparable y la tabla con filtros. La aprobación NO
 * está aquí: vive solo en el detalle de cada agrupación (una por una).
 */
export function CurvasTab({
  estado,
  cargando,
  agrupacionesM3,
  formulario,
  onFormulario,
  claveCalculo,
  abrirParametros,
  filtroTemporada,
  onFiltroTemporada,
  filtroEstado,
  onFiltroEstado,
  onVer,
  onRecalcular,
  onCalculada,
  onSeleccionarCorrida,
  onCambio,
}: {
  estado: EstadoCurvasApi | null;
  cargando: boolean;
  agrupacionesM3: AgrupacionConTemporada[];
  formulario: FormularioParametros;
  onFormulario: (f: FormularioParametros) => void;
  /** Cambia al pulsar Recalcular: remonta la tarjeta con los parámetros de la corrida. */
  claveCalculo: number;
  abrirParametros: boolean;
  filtroTemporada: FiltroTemporada;
  onFiltroTemporada: (f: FiltroTemporada) => void;
  filtroEstado: FiltroEstado;
  onFiltroEstado: (f: FiltroEstado) => void;
  onVer: (agrupacionId: string) => void;
  onRecalcular: () => void;
  onCalculada: (r: CalcularRespuesta) => Promise<void> | void;
  onSeleccionarCorrida: (id: string) => void;
  /** Tras cada escritura exitosa: recarga el estado y las agrupaciones. */
  onCambio: () => Promise<void> | void;
}) {
  const [genero, setGenero] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const colores = useMapaColores(agrupacionesM3);

  const agrupaciones = useMemo(() => estado?.agrupaciones ?? [], [estado]);
  const estados = useMemo(() => contarEstados(agrupaciones), [agrupaciones]);
  const generos = useMemo(() => generosDe(agrupaciones), [agrupaciones]);
  const filas = useMemo(
    () => filtrarAgrupaciones(agrupaciones, { temporada: filtroTemporada, estado: filtroEstado, genero, busqueda }),
    [agrupaciones, filtroTemporada, filtroEstado, genero, busqueda]
  );
  const obsoletas = useMemo(() => agrupaciones.filter((a) => a.activo && a.obsoleta), [agrupaciones]);
  const referencia = estado?.corrida?.referencia === true;

  async function accion(id: string, fn: () => Promise<unknown>, exito: string) {
    setOcupadoId(id);
    setError(null);
    setAviso(null);
    try {
      await fn();
      await onCambio();
      setAviso(exito);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupadoId(null);
    }
  }

  function cambiarTemporada(a: AgrupacionCurvasApi, temporada: TemporadaAgrupacion) {
    if (temporada === a.temporada) return;
    void accion(
      a.id,
      () => api.patch(`/api/agrupaciones-estacionalidad/${a.id}`, { temporada }),
      `${a.nombre}: temporada ${ETIQUETA_TEMPORADA[temporada].toLowerCase()}. Las curvas afectadas se marcan obsoletas hasta recalcular.`
    );
  }

  function retirar(a: AgrupacionCurvasApi) {
    if (!a.vigente) return;
    if (!confirm(`¿Retirar la curva vigente de ${a.nombre} (v${a.vigente.version}, ${modeloConNombre(a.vigente.modelo)})? La agrupación quedará sin curva hasta que apruebes otra.`)) return;
    void accion(a.id, () => api.delete(`/api/curvas/agrupaciones/${a.id}`), `${a.nombre}: curva retirada.`);
  }

  function marcarReferencia() {
    const c = estado?.corrida;
    if (!c) return;
    if (!confirm(`¿Marcar la corrida del ${formatearFechaHora(c.created_at)} como referencia? Los factores de volumen del Niño (pestaña Años Niño y lo que lee M7) pasarán a salir de ella.`)) return;
    void accion(c.id, () => api.patch(`/api/curvas/corridas/${c.id}`, { referencia: true }), "Corrida marcada como referencia.");
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
          <Select
            aria-label={`Temporada de ${a.nombre}`}
            value={a.temporada}
            disabled={ocupadoId !== null}
            onChange={(e) => {
              const v = e.target.value;
              if (esTemporada(v)) cambiarTemporada(a, v);
            }}
            className="h-8 w-40!"
          >
            {OPCIONES_TEMPORADA.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </Select>
          {a.temporada_sugerida !== null && a.temporada_sugerida !== a.temporada && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-alerta">
              Sugerida: {ETIQUETA_TEMPORADA[a.temporada_sugerida]}
              <Button
                variante="secundario"
                tamano="sm"
                className="h-6! px-2! text-xs"
                disabled={ocupadoId !== null}
                onClick={() => cambiarTemporada(a, a.temporada_sugerida as TemporadaAgrupacion)}
              >
                Aplicar
              </Button>
            </p>
          )}
        </div>
      ),
    },
    {
      clave: "vigente",
      titulo: "Curva vigente",
      render: (a) => {
        const v = a.vigente;
        const motivo = textoObsoleta(a.obsoleta);
        return (
          <div className="min-w-44 space-y-1 text-xs">
            {v ? (
              <p className="text-tinta">
                <strong>v{v.version}</strong> · {modeloConNombre(v.modelo)}
                {v.eat !== null && <> · EAT {formatearPp(v.eat, 1).replace(" pp", "")}</>}
                <span className="block text-tinta-suave" title={`Aprobada el ${formatearFechaHora(v.aprobada_at)}`}>
                  {v.usuario_nombre ?? "—"}, {formatearDiaMes(v.aprobada_at)}
                </span>
              </p>
            ) : a.activo ? (
              <Badge tono="alerta">Sin curva</Badge>
            ) : (
              <span className="text-tinta-suave">—</span>
            )}
            {v?.origen === "prestada" && <Badge tono="marca">Prestada (temporada)</Badge>}
            {motivo && (
              <p title={motivo}>
                <Badge tono="alerta">Obsoleta</Badge>
                <span className="mt-0.5 block max-w-56 text-alerta">{a.obsoleta?.motivos.map((m) => m.detalle).join("; ")}</span>
              </p>
            )}
          </div>
        );
      },
    },
    {
      clave: "propuesta",
      titulo: "Propuesta",
      render: (a) => {
        const p = a.propuesta;
        if (!p || p.recomendada === null)
          return estado?.corrida && !a.con_venta ? <Badge tono="neutro">Sin venta</Badge> : <span className="text-tinta-suave">—</span>;
        return (
          <div className="min-w-44 space-y-1 text-xs">
            <p className="text-tinta">
              <strong>{modeloConNombre(p.recomendada)}</strong>
              {p.eat !== null && <> · EAT {formatearPp(p.eat, 1).replace(" pp", "")}</>}
            </p>
            {p.motivo_recomendacion && <p className="max-w-52 text-tinta-suave">{ETIQUETA_MOTIVO_RECOMENDACION[p.motivo_recomendacion]}</p>}
            {p.difiere_de_vigente && <Badge tono="alerta">Distinta ({formatearPp(p.eat_vs_vigente)})</Badge>}
          </div>
        );
      },
    },
    {
      clave: "anios",
      titulo: "Años",
      render: (a) =>
        a.propuesta && a.propuesta.anios.length > 0 ? (
          <ul className="min-w-40 space-y-0.5 text-xs" aria-label={`Años de ${a.nombre}`}>
            {a.propuesta.anios.map((x) => (
              <li key={x.anio} className={claseColorAnio(x.clase, x.escaso)}>
                {textoAnio(x)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    {
      clave: "nino",
      titulo: "Niño",
      render: (a) => {
        const n = a.propuesta?.nino;
        if (!n || (n.volumen.length === 0 && !n.forma)) return <span className="text-tinta-suave">—</span>;
        return (
          <div className="min-w-40 space-y-1 text-xs">
            {n.volumen.length > 0 && (
              <p title="Ratio de volumen frente al año normal más cercano, sobre tiendas comunes (diagnóstico por agrupación; M7 usa el de la temporada)">
                {n.volumen.map((v, i) => (
                  <span key={v.anio}>
                    {i > 0 && " · "}
                    {v.anio} {formatearFactor(v.ratio_volumen)}
                  </span>
                ))}
              </p>
            )}
            {n.forma && (
              <p className={n.forma.veredicto === "forma_cambia" ? "text-alerta" : "text-tinta-suave"}>
                {n.forma.veredicto === "forma_estable" ? "Estable" : n.forma.veredicto === "forma_cambia" ? "Cambia" : "Sin comparación"}
                {n.forma.diferencia_anio !== null && (
                  <>
                    {" "}
                    ({formatearPp(n.forma.diferencia_anio, 0)}
                    {n.forma.ruido_normal !== null ? `; ruido ${formatearPp(n.forma.ruido_normal, 0).replace(" pp", "")}` : ""})
                  </>
                )}
              </p>
            )}
          </div>
        );
      },
    },
    {
      clave: "estabilidad",
      titulo: "Estabilidad",
      render: (a) =>
        a.propuesta?.nivel_estabilidad ? <span className="text-xs">{ETIQUETA_ESTABILIDAD[a.propuesta.nivel_estabilidad]}</span> : <span className="text-tinta-suave">—</span>,
    },
    {
      clave: "avisos",
      titulo: "Avisos",
      render: (a) => {
        const avisos = a.propuesta?.avisos ?? [];
        if (avisos.length === 0) return <span className="text-tinta-suave">—</span>;
        return (
          <ul className="flex max-w-52 flex-wrap gap-1" aria-label={`Avisos de ${a.nombre}`}>
            {avisos.map((x, i) => (
              <li key={`${x.codigo}-${i}`} title={x.detalle}>
                <Badge tono="alerta">{ETIQUETA_AVISO[x.codigo]}</Badge>
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      clave: "mini",
      titulo: "Curva",
      render: (a) => <MiniCurva vigente={a.vigente?.curva} propuesta={a.propuesta?.curva} />,
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (a) => (
        <div className="flex min-w-32 flex-col items-end gap-1">
          <Button variante="secundario" tamano="sm" disabled={!estado?.corrida || ocupadoId !== null} onClick={() => onVer(a.id)} title={estado?.corrida ? "Abrir el detalle: gráfico, candidatas y aprobación" : "Calcula primero"}>
            Ver
          </Button>
          {a.obsoleta && (
            <Button variante="secundario" tamano="sm" disabled={ocupadoId !== null} onClick={onRecalcular}>
              Recalcular
            </Button>
          )}
          {a.vigente && (
            <Button variante="peligro" tamano="sm" disabled={ocupadoId !== null} onClick={() => retirar(a)}>
              Retirar
            </Button>
          )}
        </div>
      ),
    },
  ];

  const sinCorrida = estado !== null && estado.corrida === null;

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {estado && (
        <p className="text-sm text-tinta" aria-live="polite">
          {textoResumen(estado.resumen)}
        </p>
      )}

      {obsoletas.length > 0 && (
        <Alert>
          <span className="font-medium">{plural(obsoletas.length, "curva obsoleta", "curvas obsoletas")}.</span>{" "}
          {obsoletas.slice(0, 5).map((a, i) => (
            <span key={a.id}>
              {i > 0 && " · "}
              {a.nombre}: {a.obsoleta?.motivos.map((m) => m.detalle).join("; ")}
            </span>
          ))}
          {obsoletas.length > 5 && ` · y ${obsoletas.length - 5} más`}.{" "}
          <button type="button" onClick={onRecalcular} className="font-medium underline underline-offset-2">
            Recalcular
          </button>
        </Alert>
      )}

      {estado && estado.resumen.sin_revisar_toda_temporada > 0 && (
        <Alert tono="info">
          {plural(estado.resumen.sin_revisar_toda_temporada, "agrupación activa sigue", "agrupaciones activas siguen")} en «Toda temporada»: las líneas no informan la
          temporada, así que revísalas una por una.{" "}
          <button
            type="button"
            onClick={() => {
              onFiltroEstado("todas");
              onFiltroTemporada("todo_el_ano");
            }}
            className="font-medium underline underline-offset-2"
          >
            Ver las de Toda temporada
          </button>
        </Alert>
      )}

      {estado && estado.resumen.unidades_sin_agrupacion > 0 && (
        <Alert tono="info">
          {formatearNumero(estado.resumen.unidades_sin_agrupacion)} unidades vendidas no tienen agrupación (agregado refrescado el{" "}
          {estado.corrida?.resumen.agregado.refrescada_at ? formatearFechaHora(estado.corrida.resumen.agregado.refrescada_at) : "—"}).{" "}
          <Link href="/maestros/estacionalidad" className="font-medium underline underline-offset-2">
            Asignarlas en Faltantes de estacionalidad
          </Link>
        </Alert>
      )}

      {estado && estado.datos.faltantes.length > 0 && (
        <Alert>
          Meses sin cargar en M5: {estado.datos.faltantes.join(", ")}. Los años con meses sin cargar quedan fuera del cálculo.
        </Alert>
      )}

      <Card
        titulo="Corrida"
        descripcion="Las propuestas, los años y los avisos de la tabla salen de la corrida elegida. La de referencia es la que lee M7."
        acciones={
          <Button variante="secundario" tamano="sm" onClick={descargar} disabled={!estado || agrupaciones.every((a) => !a.vigente)}>
            Descargar curvas vigentes (CSV)
          </Button>
        }
      >
        {!estado ? (
          <p className="text-sm text-tinta-suave">{cargando ? "Cargando…" : "Sin información."}</p>
        ) : estado.corridas.length === 0 ? (
          <p className="text-sm text-tinta-suave">Todavía no hay corridas: calcula para ver las propuestas.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-full max-w-xl">
              <span className="mb-1 block text-sm font-medium text-tinta">Corrida que se ve</span>
              <Select value={estado.corrida?.id ?? ""} onChange={(e) => onSeleccionarCorrida(e.target.value)}>
                {estado.corridas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatearFechaHora(c.created_at)} · hasta {c.hasta_periodo} · {c.resumen.propias} propias, {c.resumen.prestadas} prestadas
                    {c.referencia ? " · REFERENCIA" : ""}
                    {c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""}
                  </option>
                ))}
              </Select>
            </label>
            {referencia ? (
              <Badge tono="exito">Corrida de referencia</Badge>
            ) : (
              <Button variante="secundario" onClick={marcarReferencia} disabled={ocupadoId !== null}>
                Marcar como referencia
              </Button>
            )}
          </div>
        )}
      </Card>

      <div id="calcular-curvas">
        <CalcularCard
          key={claveCalculo}
          formulario={formulario}
          onFormulario={onFormulario}
          estado={estado}
          abiertoInicial={abrirParametros}
          onCalculada={onCalculada}
        />
      </div>

      <RedPanel corridaId={estado?.corrida?.id ?? null} formulario={formulario} />

      <Card
        titulo="Curvas por agrupación"
        descripcion={
          cargando && !estado
            ? "Cargando agrupaciones…"
            : "La aprobación se hace una por una en el detalle (botón Ver): ahí están el gráfico de todos los años, las candidatas y el comparador con la vigente."
        }
      >
        {sinCorrida && (
          <div className="mb-4">
            <EmptyState titulo="Calcula para ver propuestas" detalle="Sin corridas todavía: abre Parámetros en la tarjeta Calcular o calcula con los valores por defecto." />
          </div>
        )}
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
              La temporada se guarda al elegirla y no recalcula nada: marca la curva afectada como obsoleta hasta que recalcules y vuelvas a aprobar. En la columna
              Niño, el volumen es un diagnóstico por agrupación; M7 recibe el factor de la temporada (pestaña Años Niño). EAT: error absoluto total entre la curva y
              lo ocurrido, en puntos porcentuales.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
