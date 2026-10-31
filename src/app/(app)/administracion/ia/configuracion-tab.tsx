"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import type { CapacidadIa, ConfiguracionIaApi, EvaluacionApi } from "@/lib/ia/tipos-api";
import { AlertaError, BotonEnlace, Cargando } from "@/app/(app)/planificacion/proyeccion/comunes";
import { etiquetaProveedor, fechaCorta, textoServicioApagado, usd } from "@/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { formatearMomento } from "@/app/(app)/planificacion/proyeccion/vista";
import { formatearDecimal } from "@/lib/formato";
import {
  ETIQUETA_CAPACIDAD,
  TEXTOS_PROMPT,
  capacidadHabilitable,
  evaluacionesElegibles,
  formDesdeVigente,
  textoClavePresente,
  validarConfiguracion,
  type FormConfiguracion,
  type RespuestaConfiguracionApi,
} from "./ia-vista";

/** Estado del servicio tal como lo ve el servidor: proveedor, modelos permitidos y si hay clave (nunca su valor). */
export function EstadoServicio({ datos }: { datos: RespuestaConfiguracionApi }) {
  const s = datos.servicio;
  const apagada = textoServicioApagado(s);
  return (
    <Card titulo="Estado del servicio" descripcion="Sale del entorno del servidor (Railway); aquí solo se lee.">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-tinta-suave">Proveedor del entorno</dt>
          <dd className="font-medium">{s.proveedor ? etiquetaProveedor(s.proveedor) : "sin proveedor"}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Clave presente en el servidor</dt>
          <dd className="font-medium">{textoClavePresente(s)}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Modelos permitidos</dt>
          <dd className="font-mono text-xs">{s.modelos_permitidos.length > 0 ? s.modelos_permitidos.join(", ") : "ninguno (falta la variable del servidor)"}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Gasto del mes · hoy</dt>
          <dd className="font-mono text-xs tabular-nums">
            {usd(s.gasto_mes_usd)}
            {s.tope_usd_mes !== null ? ` de ${formatearDecimal(s.tope_usd_mes, 0)}` : ""} · {usd(s.gasto_dia_usuario_usd)}
            {s.tope_usd_dia_usuario !== null ? ` de ${formatearDecimal(s.tope_usd_dia_usuario, 0)}` : ""}
          </dd>
        </div>
      </dl>
      <div className="mt-3">{apagada ? <Alert tono="alerta">IA apagada: {apagada}</Alert> : <Alert tono="exito">La IA está disponible.</Alert>}</div>
    </Card>
  );
}

/** Versión vigente y anteriores. */
export function VersionesConfiguracion({ vigente, versiones }: { vigente: ConfiguracionIaApi | null; versiones: readonly ConfiguracionIaApi[] }) {
  const columnas: Columna<ConfiguracionIaApi>[] = [
    { clave: "v", titulo: "Versión", render: (c) => <span className="font-mono">v{c.version}</span> },
    { clave: "estado", titulo: "Estado", render: (c) => <Badge tono={c.estado === "vigente" ? "exito" : "neutro"}>{c.estado}</Badge> },
    { clave: "modelo", titulo: "Proveedor · modelo · prompt", render: (c) => `${etiquetaProveedor(c.proveedor)} · ${c.modelo} · ${c.version_prompt}` },
    { clave: "cap", titulo: "Capacidades", render: (c) => (c.capacidades.length > 0 ? c.capacidades.join(", ") : <span className="text-tinta-suave">ninguna (apagada)</span>) },
    { clave: "topes", titulo: "Topes (corrida · mes · usuario y día)", render: (c) => <span className="font-mono text-xs">{`${formatearDecimal(c.tope_usd_corrida, 0)} · ${formatearDecimal(c.tope_usd_mes, 0)} · ${formatearDecimal(c.tope_usd_dia_usuario, 0)}`}</span> },
    { clave: "quien", titulo: "Aprobada", render: (c) => `${formatearMomento(c.aprobada_at)}${c.usuario_nombre ? ` · ${c.usuario_nombre}` : ""}` },
    { clave: "nota", titulo: "Nota", render: (c) => (c.nota ? <span className="whitespace-pre-line text-xs">{c.nota}</span> : <span className="text-tinta-suave">—</span>) },
  ];
  return (
    <Card titulo="Configuración vigente" descripcion={vigente ? `Versión ${vigente.version}. Cada guardado crea una versión nueva; las anteriores quedan como historial.` : "Todavía no hay configuración: la IA está apagada hasta guardar una."}>
      <DataTable columnas={columnas} filas={[...versiones]} claveFila={(c) => c.id} vacio="Sin versiones guardadas." />
    </Card>
  );
}

/** El formulario de una versión nueva. Controlado; el botón se deshabilita mientras envía; al guardar, el padre recarga y lo reinicia. */
export function FormularioConfiguracion({
  datos,
  evaluaciones,
  onGuardada,
}: {
  datos: RespuestaConfiguracionApi;
  evaluaciones: readonly EvaluacionApi[];
  onGuardada: () => Promise<void>;
}) {
  const { vigente, servicio, prompts } = datos;
  const [form, setForm] = useState<FormConfiguracion>(() => formDesdeVigente(vigente, servicio.modelos_permitidos, prompts));
  const [errores, setErrores] = useState<string[]>([]);
  const [verPrompt, setVerPrompt] = useState(false);
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);

  const terna = { proveedor: servicio.proveedor, modelo: form.modelo, version_prompt: form.version_prompt };
  const elegibles = evaluacionesElegibles(evaluaciones, terna);
  const habilitable = capacidadHabilitable(elegibles, form.evaluacion_id);
  const sinModelos = servicio.modelos_permitidos.length === 0;
  const sinProveedor = servicio.proveedor === null;

  function poner<K extends keyof FormConfiguracion>(k: K, v: FormConfiguracion[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrores([]);
    setAviso(null);
  }

  /** Cambiar el modelo o el prompt invalida la evaluación elegida (era de otra terna) y apaga las capacidades. */
  function cambiarTerna(cambios: Partial<Pick<FormConfiguracion, "modelo" | "version_prompt">>) {
    setForm((f) => ({ ...f, ...cambios, evaluacion_id: "", capacidades: [] }));
    setErrores([]);
    setAviso(null);
  }

  function elegirEvaluacion(id: string) {
    setForm((f) => ({ ...f, evaluacion_id: id, capacidades: id === "" ? [] : f.capacidades }));
    setErrores([]);
  }

  function alternarCapacidad(c: CapacidadIa, v: boolean) {
    setForm((f) => ({ ...f, capacidades: v ? [...new Set([...f.capacidades, c])] : f.capacidades.filter((x) => x !== c) }));
    setErrores([]);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (accion.ocupado) return;
    const r = validarConfiguracion(form, { modelosPermitidos: servicio.modelos_permitidos, prompts, versionVigente: vigente?.version ?? null });
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores([]);
    const res = await accion.ejecutar(() => api.post<ConfiguracionIaApi>("/api/ia/configuracion", r.cuerpo));
    if (res.ok) {
      setAviso(`Versión ${res.valor.version} guardada${res.valor.capacidades.length === 0 ? ": la IA queda apagada (sin capacidades)." : "."}`);
      setForm((f) => ({ ...f, nota: "" }));
      await onGuardada();
    }
  }

  return (
    <Card titulo="Nueva versión" descripcion="Guarda una versión nueva; la vigente pasa a reemplazada.">
      <form onSubmit={(e) => void guardar(e)} className="space-y-5">
        {accion.error && (
          <Alert tono="alerta" onCerrar={accion.limpiar}>
            <span className="block">{accion.error.mensaje}</span>
            {accion.error.codigo === "vigente_cambiada" && (
              <span className="mt-1 block">
                <BotonEnlace onClick={() => void onGuardada()}>Actualizar pantalla</BotonEnlace>
              </span>
            )}
          </Alert>
        )}
        {aviso && (
          <Alert tono="exito" onCerrar={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}
        {errores.length > 0 && (
          <Alert tono="alerta">
            <ul className="list-disc space-y-0.5 pl-4">
              {errores.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
        {sinProveedor && <Alert tono="alerta">El servidor no tiene proveedor de IA: no se puede guardar una configuración nueva.</Alert>}

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Proveedor" hint="Es el del servidor (IA_PROVEEDOR); no se elige aquí.">
            <Input value={servicio.proveedor ? etiquetaProveedor(servicio.proveedor) : "sin proveedor"} readOnly disabled />
          </Field>
          <Field label="Modelo" hint={sinModelos ? "El servidor no tiene modelos permitidos (IA_MODELO)." : "Solo los que permite el servidor; el primero es el que se propone."}>
            <Select value={form.modelo} disabled={sinModelos || accion.ocupado} onChange={(e) => cambiarTerna({ modelo: e.target.value })}>
              {form.modelo !== "" && !servicio.modelos_permitidos.includes(form.modelo) && <option value={form.modelo}>{form.modelo} (ya no permitido)</option>}
              {servicio.modelos_permitidos.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Versión de prompt">
            <Select value={form.version_prompt} disabled={accion.ocupado} onChange={(e) => cambiarTerna({ version_prompt: e.target.value })}>
              {prompts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <BotonEnlace onClick={() => setVerPrompt((v) => !v)}>{verPrompt ? "Ocultar texto del prompt" : "Ver texto del prompt"}</BotonEnlace>
          {verPrompt && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-borde bg-neutro-suave/50 p-3 text-xs">{TEXTOS_PROMPT[form.version_prompt] ?? "Esta versión no tiene texto publicado en la pantalla."}</pre>
          )}
        </div>

        <fieldset className="space-y-3 rounded-lg border border-borde p-3">
          <legend className="px-1 text-sm font-medium">Qué se enciende</legend>
          <Field label="Evaluación que lo respalda" hint="Solo se ofrecen evaluaciones completas y ganadoras del mismo proveedor, modelo y prompt que arriba.">
            <Select value={form.evaluacion_id} disabled={accion.ocupado} onChange={(e) => elegirEvaluacion(e.target.value)}>
              <option value="">Sin evaluación (la IA queda apagada)</option>
              {elegibles.map((e) => (
                <option key={e.id} value={e.id}>
                  Intento {e.intento} · {fechaCorta(e.iniciada_at)} · {e.modelo} · {e.version_prompt}
                </option>
              ))}
            </Select>
          </Field>
          {elegibles.length === 0 && <p className="text-xs text-tinta-suave">No hay una evaluación ganadora para este modelo y prompt. Evalúalo en la pestaña Evaluaciones.</p>}
          {(["distribucion_y1"] as CapacidadIa[]).map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.capacidades.includes(c)} disabled={!habilitable || accion.ocupado} onChange={(v) => alternarCapacidad(c, v)} label={ETIQUETA_CAPACIDAD[c]} />
              <span className={habilitable ? "" : "text-tinta-suave"}>{ETIQUETA_CAPACIDAD[c]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-borde p-3">
          <legend className="px-1 text-sm font-medium">Topes y llamadas</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Tope por corrida (US$)">
              <Input inputMode="decimal" value={form.tope_usd_corrida} disabled={accion.ocupado} onChange={(e) => poner("tope_usd_corrida", e.target.value)} />
            </Field>
            <Field label="Tope del mes (US$)" hint="Tope blando de la app; el duro es el límite de gasto del proyecto en el proveedor.">
              <Input inputMode="decimal" value={form.tope_usd_mes} disabled={accion.ocupado} onChange={(e) => poner("tope_usd_mes", e.target.value)} />
            </Field>
            <Field label="Tope por usuario y día (US$)">
              <Input inputMode="decimal" value={form.tope_usd_dia_usuario} disabled={accion.ocupado} onChange={(e) => poner("tope_usd_dia_usuario", e.target.value)} />
            </Field>
            <Field label="Filas por llamada" hint="Entre 10 y 150. Por encima, el GM se procesa por lotes (modo jerárquico).">
              <Input inputMode="numeric" value={form.max_filas_llamada} disabled={accion.ocupado} onChange={(e) => poner("max_filas_llamada", e.target.value)} />
            </Field>
            <Field label="Razonamiento (tokens)" hint="0 = sin razonamiento. El adaptador lo traduce a lo que admita el modelo.">
              <Input inputMode="numeric" value={form.presupuesto_razonamiento} disabled={accion.ocupado} onChange={(e) => poner("presupuesto_razonamiento", e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Switch checked={form.incluir_cola_larga} disabled={accion.ocupado} onChange={(v) => poner("incluir_cola_larga", v)} label="Incluir la cola larga en el reparto" />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-borde p-3">
          <legend className="px-1 text-sm font-medium">Precios por millón de tokens (US$)</legend>
          <p className="text-xs text-tinta-suave">Cópialos de la página de precios vigente del proveedor; ningún precio está en el código. Si cambias de modelo, revísalos.</p>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Entrada">
              <Input inputMode="decimal" value={form.precio_entrada} disabled={accion.ocupado} onChange={(e) => poner("precio_entrada", e.target.value)} />
            </Field>
            <Field label="Entrada en caché" hint="Si el proveedor no tiene caché, igual a la entrada.">
              <Input inputMode="decimal" value={form.precio_entrada_cache} disabled={accion.ocupado} onChange={(e) => poner("precio_entrada_cache", e.target.value)} />
            </Field>
            <Field label="Salida">
              <Input inputMode="decimal" value={form.precio_salida} disabled={accion.ocupado} onChange={(e) => poner("precio_salida", e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <Field label="Términos que nunca salen" hint="Uno por línea (hasta 50, de 2 a 60 caracteres). Marcas y tiendas ya se reemplazan solas; añade el nombre de la empresa u otros.">
          <Textarea value={form.terminos_extra} rows={4} disabled={accion.ocupado} onChange={(e) => poner("terminos_extra", e.target.value)} />
        </Field>
        <Field label="Nota (opcional)">
          <Input value={form.nota} maxLength={300} disabled={accion.ocupado} onChange={(e) => poner("nota", e.target.value)} />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" disabled={accion.ocupado || sinProveedor || sinModelos}>
            {accion.ocupado ? "Guardando…" : "Guardar versión"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Pestaña Configuración: estado del servicio, versiones y formulario. */
export function ConfiguracionTab() {
  const config = useLectura<RespuestaConfiguracionApi>("/api/ia/configuracion");
  const evals = useLectura<EvaluacionApi[]>("/api/ia/evaluaciones");
  const datos = config.datos;

  async function recargar() {
    await Promise.all([config.recargar(), evals.recargar()]);
  }

  return (
    <div className="space-y-4">
      {config.error && <AlertaError error={config.error} onCerrar={() => config.setError(null)} onRecargar={() => void config.recargar()} />}
      {evals.error && <Alert onCerrar={() => evals.setError(null)}>No se pudieron leer las evaluaciones: {evals.error}</Alert>}
      {config.cargando && !datos && <Cargando texto="Leyendo la configuración…" />}
      {datos && (
        <>
          <EstadoServicio datos={datos} />
          <VersionesConfiguracion vigente={datos.vigente} versiones={datos.versiones} />
          {/* El formulario parte de la vigente cada vez que cambia (la `key` lo reinicia tras guardar o recargar). */}
          <FormularioConfiguracion key={datos.vigente?.id ?? "sin-vigente"} datos={datos} evaluaciones={evals.datos ?? []} onGuardada={recargar} />
        </>
      )}
    </div>
  );
}
