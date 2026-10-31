"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/form";
import type { EstimacionApi, EvaluacionApi, GrupoGeneroIa, MetricasRepartoApi } from "@/lib/ia/tipos-api";
import { AlertaError, Cargando, NUM } from "@/app/(app)/planificacion/proyeccion/comunes";
import { ResumenEstimacion } from "@/app/(app)/planificacion/proyeccion/generar-ia-modal";
import { estimacionDeError, etiquetaProveedor, fraccionAvance, superaTope, usd } from "@/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import { useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { formatearMomento, unidades } from "@/app/(app)/planificacion/proyeccion/vista";
import {
  ETIQUETA_ESTADO_EVALUACION,
  ETIQUETA_VEREDICTO,
  NOTA_PLIEGUE,
  PLIEGUES_OFRECIDOS,
  TONO_VEREDICTO,
  duracionTexto,
  formEvaluacionInicial,
  mejoraTexto,
  tablasInforme,
  textoIntentoNuevo,
  textoReglaQueFallo,
  validarEvaluacion,
  wapeTexto,
  type FilaInforme,
  type FormEvaluacion,
  type RespuestaConfiguracionApi,
} from "./ia-vista";
import { claveAvance, rutaEvaluaciones, useConducirEvaluacion, type EstadoConduccionEvaluacion } from "./use-evaluacion-ia";

const SIN_EVALUACIONES: EvaluacionApi[] = [];

const GRUPOS: { id: GrupoGeneroIa; etiqueta: string }[] = [
  { id: "HOMBRE", etiqueta: "Hombre" },
  { id: "MUJER", etiqueta: "Mujer" },
  { id: "RESTO", etiqueta: "Resto" },
];

function TablaMetricas({ filas, titulo }: { filas: FilaInforme[]; titulo: string }) {
  const columnas: Columna<FilaInforme>[] = [
    { clave: "pliegue", titulo: "Pliegue", render: (f) => <span className="font-medium">{f.pliegue}</span> },
    { clave: "filas", titulo: "Filas", className: NUM, render: (f) => unidades(f.filas) },
    { clave: "metodo", titulo: "WAPE método", className: NUM, render: (f) => f.wape_metodo },
    { clave: "tendencia", titulo: "WAPE tendencia", className: NUM, render: (f) => f.wape_tendencia },
    { clave: "ia", titulo: "WAPE IA", className: NUM, render: (f) => <span className="font-semibold">{f.wape_ia}</span> },
    { clave: "rival", titulo: "Rival a batir", render: (f) => f.rival },
    { clave: "mejora", titulo: "Mejora sobre el rival", className: NUM, render: (f) => f.mejora },
    { clave: "ic", titulo: "IC 90 % (bootstrap)", className: NUM, render: (f) => f.ic90 },
  ];
  return (
    <section aria-label={titulo} className="space-y-1">
      <h4 className="text-sm font-semibold">{titulo}</h4>
      <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.clave} vacio="Sin datos en este pliegue." />
    </section>
  );
}

function TablaGenero({ por }: { por: Record<GrupoGeneroIa, MetricasRepartoApi> }) {
  const filas = GRUPOS.map((g) => ({ ...g, m: por[g.id] }));
  const columnas: Columna<(typeof filas)[number]>[] = [
    { clave: "g", titulo: "Género", render: (f) => f.etiqueta },
    { clave: "filas", titulo: "Filas", className: NUM, render: (f) => unidades(f.m?.filas) },
    { clave: "metodo", titulo: "WAPE método", className: NUM, render: (f) => wapeTexto(f.m?.wape_metodo) },
    { clave: "tendencia", titulo: "WAPE tendencia", className: NUM, render: (f) => wapeTexto(f.m?.wape_tendencia) },
    { clave: "ia", titulo: "WAPE IA", className: NUM, render: (f) => wapeTexto(f.m?.wape_ia) },
    { clave: "mejora", titulo: "Mejora", className: NUM, render: (f) => mejoraTexto(f.m?.mejora) },
  ];
  return <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.id} />;
}

/** El informe de una evaluación: veredicto con la regla que falló, tablas de reparto y natural, por género, GM ganados, estabilidad, cobertura, costo y duración. */
export function InformeEvaluacion({ evaluacion: e }: { evaluacion: EvaluacionApi }) {
  const r = e.resultados;
  const v = e.veredicto?.distribucion_y1 ?? null;
  const tablas = r ? tablasInforme(r) : null;
  return (
    <Card
      titulo={`Informe · intento n.º ${e.intento}`}
      descripcion={`${etiquetaProveedor(e.proveedor)} · ${e.modelo} · prompt ${e.version_prompt} · ${formatearMomento(e.iniciada_at)}${e.usuario_nombre ? ` · ${e.usuario_nombre}` : ""}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tono={e.estado === "completa" ? "exito" : e.estado === "en_curso" ? "marca" : "alerta"}>{ETIQUETA_ESTADO_EVALUACION[e.estado]}</Badge>
          {v && <Badge tono={TONO_VEREDICTO[v]}>distribución de la meta: {ETIQUETA_VEREDICTO[v]}</Badge>}
          <span className="text-tinta-suave">
            costo {usd(e.costo_usd)} de {usd(e.tope_usd)} · duración {duracionTexto(e.iniciada_at, e.terminada_at)}
          </span>
        </div>
        {e.veredicto && (
          <p className="text-sm">
            <span className="font-medium">Regla que falló:</span> {textoReglaQueFallo(e.veredicto.regla_que_fallo)}.
          </p>
        )}
        {!r && <p className="text-sm text-tinta-suave">{e.estado === "en_curso" ? "La evaluación sigue en curso: el informe aparece al terminar." : "Esta evaluación no llegó a producir resultados."}</p>}
        {tablas && (
          <>
            <TablaMetricas titulo="Reparto de la meta" filas={tablas.reparto} />
            <TablaMetricas titulo="Natural (sin la meta)" filas={tablas.natural} />
            {r?.d25 && (
              <section aria-label="Reparto por género en D25" className="space-y-1">
                <h4 className="text-sm font-semibold">Reparto por género (D25)</h4>
                <TablaGenero por={r.d25.por_genero} />
                <p className="text-sm">
                  GM ganados: <span className="font-mono tabular-nums">{r.d25.gms_ganados}</span> de <span className="font-mono tabular-nums">{r.d25.gms_evaluados}</span> evaluados.
                </p>
              </section>
            )}
            <p className="text-sm">
              Estabilidad entre D25 y E25: <span className="font-mono tabular-nums">{wapeTexto(r?.estabilidad)}</span> (máximo 5 %) · cobertura de respuestas válidas: <span className="font-mono tabular-nums">{wapeTexto(r?.cobertura)}</span> (mínimo 98 %).
            </p>
            <p className="text-xs text-tinta-suave">WAPE = error absoluto ponderado: menor es mejor. Las curvas y los factores son los de hoy, que ya conocen los años de prueba: esa fuga la comparten el método y la IA.</p>
          </>
        )}
      </div>
    </Card>
  );
}

/** Todas las evaluaciones, también las canceladas y fallidas. */
export function ListaEvaluaciones({ evaluaciones, elegida, onVer }: { evaluaciones: readonly EvaluacionApi[]; elegida: string | null; onVer: (id: string) => void }) {
  const filas = useMemo(() => [...evaluaciones].sort((a, b) => b.iniciada_at.localeCompare(a.iniciada_at)), [evaluaciones]);
  const columnas: Columna<EvaluacionApi>[] = [
    { clave: "intento", titulo: "Intento", className: NUM, render: (e) => `n.º ${e.intento}` },
    { clave: "fecha", titulo: "Fecha", render: (e) => formatearMomento(e.iniciada_at) },
    { clave: "terna", titulo: "Proveedor · modelo · prompt", render: (e) => `${etiquetaProveedor(e.proveedor)} · ${e.modelo} · ${e.version_prompt}` },
    { clave: "estado", titulo: "Estado", render: (e) => <Badge tono={e.estado === "completa" ? "exito" : e.estado === "en_curso" ? "marca" : "alerta"}>{ETIQUETA_ESTADO_EVALUACION[e.estado]}</Badge> },
    {
      clave: "veredicto",
      titulo: "Veredicto",
      render: (e) => (e.veredicto ? <Badge tono={TONO_VEREDICTO[e.veredicto.distribucion_y1]}>{ETIQUETA_VEREDICTO[e.veredicto.distribucion_y1]}</Badge> : <span className="text-tinta-suave">—</span>),
    },
    { clave: "costo", titulo: "Costo", className: NUM, render: (e) => usd(e.costo_usd) },
    { clave: "quien", titulo: "Quién", render: (e) => e.usuario_nombre ?? "—" },
    {
      clave: "ver",
      titulo: "",
      render: (e) => (
        <Button variante={elegida === e.id ? "primario" : "secundario"} tamano="sm" aria-label={`Ver informe del intento ${e.intento}`} onClick={() => onVer(e.id)}>
          Ver informe
        </Button>
      ),
    },
  ];
  return (
    <Card titulo="Evaluaciones" descripcion="Todos los intentos quedan registrados, también los cancelados y fallidos.">
      <DataTable columnas={columnas} filas={filas} claveFila={(e) => e.id} vacio="Todavía no se ha evaluado ningún modelo." />
    </Card>
  );
}

/** Progreso de una evaluación: pliegue que se prepara, GM hechos, costo acumulado y espera del proveedor. */
export function ProgresoEvaluacion({ estado }: { estado: EstadoConduccionEvaluacion }) {
  const total = estado.plan.length;
  const hechos = estado.plan.filter((p) => {
    const a = estado.porGm[claveAvance(p.pliegue, p.gm_clave)];
    return a !== undefined && a.estado !== "pendiente" && a.estado !== "en_proceso";
  }).length;
  const pasos = estado.plan.length === 0 ? 0 : hechos / total;
  const actual = estado.plan.find((p) => {
    const a = estado.porGm[claveAvance(p.pliegue, p.gm_clave)];
    return !a || a.estado === "pendiente" || a.estado === "en_proceso";
  });
  const a = actual ? estado.porGm[claveAvance(actual.pliegue, actual.gm_clave)] : undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {estado.preparando ? `Preparando ${estado.preparando}… (arma la entrada en el servidor, puede tardar medio minuto)` : actual ? `Pliegue ${actual.pliegue} · GM ${hechos + 1} de ${total}` : `${hechos} de ${total} GM`}
        </span>
        <span className="font-mono tabular-nums">{usd(estado.costoUsd)} acumulado</span>
      </div>
      <div role="progressbar" aria-label="Avance de la evaluación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pasos * 100)} className="h-2 w-full rounded-full bg-neutro-suave">
        <div className="h-2 rounded-full bg-marca transition-all" style={{ width: `${Math.round(pasos * 100)}%` }} />
      </div>
      {a && fraccionAvance(a) > 0 && <p className="text-xs text-tinta-suave">Paso {a.pasos_hechos} de {a.pasos_total} del GM en curso.</p>}
      {estado.esperando && <Alert tono="info">Esperando al proveedor… se reintenta solo.</Alert>}
      {estado.deteniendo && estado.fase === "corriendo" && <Alert tono="info">Deteniendo: termina el paso en curso y cancela la evaluación.</Alert>}
    </div>
  );
}

function NuevaEvaluacion({ config, evaluaciones, onTermino }: { config: RespuestaConfiguracionApi; evaluaciones: readonly EvaluacionApi[]; onTermino: () => void }) {
  const { servicio, prompts, vigente } = config;
  const [form, setForm] = useState<FormEvaluacion>(() => formEvaluacionInicial(vigente, servicio.modelos_permitidos, prompts));
  const [errores, setErrores] = useState<string[]>([]);
  const [estimacion, setEstimacion] = useState<EstimacionApi | null>(null);
  const cond = useConducirEvaluacion(onTermino);
  const corriendo = cond.estado.fase === "corriendo";
  const terminada = cond.estado.fase === "terminada";
  const sinModelos = servicio.modelos_permitidos.length === 0;
  const apagadoPorServicio = servicio.proveedor === null || sinModelos;

  function poner<K extends keyof FormEvaluacion>(k: K, v: FormEvaluacion[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setEstimacion(null);
    setErrores([]);
    cond.limpiarErrorInicio();
  }

  function alternarPliegue(p: (typeof PLIEGUES_OFRECIDOS)[number], v: boolean) {
    poner("pliegues", v ? [...new Set([...form.pliegues, p])] : form.pliegues.filter((x) => x !== p));
  }

  async function pedir(costo: number) {
    const r = validarEvaluacion(form, { modelosPermitidos: servicio.modelos_permitidos, prompts });
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores([]);
    const res = await cond.iniciar({ ...r.cuerpo, costo_confirmado_usd: costo });
    if (res.ok) return;
    if (res.error.codigo === "costo_no_confirmado") {
      const e = estimacionDeError(res.error.detalle);
      if (e) {
        setEstimacion(e);
        cond.limpiarErrorInicio();
      }
    }
  }

  function detener() {
    if (!confirm("¿Detener la evaluación? Termina el paso en curso y se cancela; el intento queda registrado como cancelado.")) return;
    cond.detener();
  }

  const puedeConfirmar = estimacion !== null && !superaTope(estimacion) && !cond.iniciando && !corriendo;
  const intento = textoIntentoNuevo(evaluaciones, form.version_prompt);

  return (
    <Card titulo="Nueva evaluación" descripcion={`${intento}.`}>
      <div className="space-y-4">
        {apagadoPorServicio && <Alert tono="alerta">El servidor no tiene proveedor o modelos permitidos configurados: no se puede evaluar.</Alert>}
        {cond.errorInicio && <AlertaError error={cond.errorInicio} onCerrar={cond.limpiarErrorInicio} />}
        {errores.length > 0 && (
          <Alert tono="alerta">
            <ul className="list-disc space-y-0.5 pl-4">
              {errores.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}

        {cond.estado.fase === "inactiva" && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Proveedor" hint="Es el del servidor; no se elige aquí.">
                <Input value={servicio.proveedor ? etiquetaProveedor(servicio.proveedor) : "sin proveedor"} readOnly disabled />
              </Field>
              <Field label="Modelo">
                <Select value={form.modelo} disabled={apagadoPorServicio || cond.iniciando} onChange={(e) => poner("modelo", e.target.value)}>
                  {servicio.modelos_permitidos.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Versión de prompt">
                <Select value={form.version_prompt} disabled={cond.iniciando} onChange={(e) => poner("version_prompt", e.target.value)}>
                  {prompts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <fieldset className="space-y-1.5 rounded-lg border border-borde p-3">
              <legend className="px-1 text-sm font-medium">Pliegues</legend>
              {PLIEGUES_OFRECIDOS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.pliegues.includes(p)} disabled={cond.iniciando} onChange={(v) => alternarPliegue(p, v)} label={`Pliegue ${p}`} />
                  <span className="font-mono">{p}</span>
                  <span className="text-xs text-tinta-suave">{NOTA_PLIEGUE[p]}</span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="Precio de entrada (US$/M)">
                <Input inputMode="decimal" value={form.precio_entrada} disabled={cond.iniciando} onChange={(e) => poner("precio_entrada", e.target.value)} />
              </Field>
              <Field label="Entrada en caché (US$/M)">
                <Input inputMode="decimal" value={form.precio_entrada_cache} disabled={cond.iniciando} onChange={(e) => poner("precio_entrada_cache", e.target.value)} />
              </Field>
              <Field label="Salida (US$/M)">
                <Input inputMode="decimal" value={form.precio_salida} disabled={cond.iniciando} onChange={(e) => poner("precio_salida", e.target.value)} />
              </Field>
              <Field label="Tope de la evaluación (US$)">
                <Input inputMode="decimal" value={form.tope_usd} disabled={cond.iniciando} onChange={(e) => poner("tope_usd", e.target.value)} />
              </Field>
            </div>
            {estimacion ? <ResumenEstimacion estimacion={estimacion} servicio={servicio} /> : <p className="text-sm text-tinta-suave">Calcula la estimación antes de confirmar: no se llama al proveedor hasta que confirmes el costo.</p>}
            <div className="flex justify-end">
              {estimacion === null ? (
                <Button disabled={apagadoPorServicio || cond.iniciando} onClick={() => void pedir(0)}>
                  {cond.iniciando ? "Calculando…" : "Calcular estimación"}
                </Button>
              ) : (
                <Button disabled={!puedeConfirmar} onClick={() => void pedir(estimacion.costo_usd)}>
                  {cond.iniciando ? "Iniciando…" : `Confirmar (${usd(estimacion.costo_usd)})`}
                </Button>
              )}
            </div>
          </>
        )}

        {cond.estado.fase !== "inactiva" && <ProgresoEvaluacion estado={cond.estado} />}
        {corriendo && (
          <div className="flex justify-end">
            <Button variante="peligro" disabled={cond.estado.deteniendo} onClick={detener}>
              {cond.estado.deteniendo ? "Deteniendo…" : "Detener"}
            </Button>
          </div>
        )}
        {terminada && cond.estado.error && <Alert tono="alerta">{cond.estado.error.mensaje}</Alert>}
        {terminada && !cond.estado.error && cond.estado.evaluacion && (
          <Alert tono="exito">
            Evaluación {ETIQUETA_ESTADO_EVALUACION[cond.estado.evaluacion.estado]}
            {cond.estado.evaluacion.veredicto ? ` · veredicto: ${ETIQUETA_VEREDICTO[cond.estado.evaluacion.veredicto.distribucion_y1]}` : ""}. El informe está abajo.
          </Alert>
        )}
        {terminada && (
          <div className="flex justify-end">
            <Button variante="secundario" onClick={() => cond.reiniciar()}>
              Nueva evaluación
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Pestaña Evaluaciones: nueva evaluación, historial completo e informe de la elegida. */
export function EvaluacionesTab() {
  const lista = useLectura<EvaluacionApi[]>(rutaEvaluaciones);
  const config = useLectura<RespuestaConfiguracionApi>("/api/ia/configuracion");
  const [elegida, setElegida] = useState<string | null>(null);
  const evaluaciones = lista.datos ?? SIN_EVALUACIONES;
  // Sin elección, el informe es el de la evaluación más reciente.
  const reciente = useMemo(() => [...evaluaciones].sort((a, b) => b.iniciada_at.localeCompare(a.iniciada_at))[0]?.id ?? null, [evaluaciones]);
  const idInforme = elegida ?? reciente;
  const informe = useLectura<EvaluacionApi>(idInforme ? `${rutaEvaluaciones}/${idInforme}` : null);

  async function alTerminar() {
    await Promise.all([lista.recargar(), informe.recargar()]);
  }

  return (
    <div className="space-y-4">
      {lista.error && <AlertaError error={lista.error} onCerrar={() => lista.setError(null)} onRecargar={() => void lista.recargar()} />}
      {config.error && <AlertaError error={config.error} onCerrar={() => config.setError(null)} onRecargar={() => void config.recargar()} />}
      {config.cargando && !config.datos && <Cargando texto="Leyendo la configuración…" />}
      {config.datos && <NuevaEvaluacion config={config.datos} evaluaciones={evaluaciones} onTermino={() => void alTerminar()} />}
      {lista.cargando && !lista.datos && <Cargando texto="Leyendo las evaluaciones…" />}
      {lista.datos && <ListaEvaluaciones evaluaciones={lista.datos} elegida={idInforme} onVer={setElegida} />}
      {informe.error && <AlertaError error={informe.error} onCerrar={() => informe.setError(null)} onRecargar={() => void informe.recargar()} />}
      {informe.datos && <InformeEvaluacion evaluacion={informe.datos} />}
      <p className="text-xs text-tinta-suave">Máximo 3 evaluaciones por mes, además del tope de costo de cada una.</p>
    </div>
  );
}
