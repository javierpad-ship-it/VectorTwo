"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { EstimacionApi, ServicioIaApi } from "@/lib/ia/tipos-api";
import { AlertaError, BotonEnlace } from "./comunes";
import {
  ETIQUETA_ESTADO_CORRIDA_GM,
  ETIQUETA_SELECCION_PENDIENTES,
  ETIQUETA_SELECCION_TODOS,
  cuerpoIniciarCorrida,
  estimacionDeError,
  fraccionAvance,
  leerSeleccion,
  lineasEstimacion,
  nombreGm,
  ordenarGms,
  superaTope,
  textoTopes,
  usd,
  valorSeleccion,
  type EstadoIaProyeccionApi,
  type SeleccionGms,
} from "./propuesta-ia-vista";
import { useGeneracionIa, type EstadoGeneracion } from "./use-propuesta-ia";

/** La barra de un GM: ancho proporcional a sus pasos hechos. */
function Barra({ fraccion, etiqueta }: { fraccion: number; etiqueta: string }) {
  const pct = Math.round(fraccion * 100);
  return (
    <div role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full rounded-full bg-neutro-suave">
      <div className="h-2 rounded-full bg-marca transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Estimación previa, topes y lo que queda (§4.1). */
export function ResumenEstimacion({ estimacion, servicio }: { estimacion: EstimacionApi; servicio: ServicioIaApi }) {
  const pasa = superaTope(estimacion);
  return (
    <div className="space-y-2 rounded-lg border border-borde p-3 text-sm">
      <ul className="space-y-0.5">
        {lineasEstimacion(estimacion).map((l) => (
          <li key={l} className={l.startsWith("Costo") ? "font-semibold" : undefined}>
            {l}
          </li>
        ))}
      </ul>
      <ul className="space-y-0.5 text-xs text-tinta-suave">
        {textoTopes(servicio).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {pasa && <Alert tono="alerta">La estimación ({usd(estimacion.costo_usd)}) pasa del tope por corrida ({usd(estimacion.tope_usd)}): elige menos GM o pídele al administrador que suba el tope.</Alert>}
    </div>
  );
}

/** Progreso GM a GM de una corrida (barra por pasos, costo acumulado, espera del proveedor, fallidos con «Reintentar este GM»). */
export function ProgresoGeneracion({ estado, nombres, onReintentar }: { estado: EstadoGeneracion; nombres: ReadonlyMap<string, string>; onReintentar?: (gmClave: string) => void }) {
  const total = estado.plan.length;
  const terminados = estado.plan.filter((p) => {
    const e = estado.porGm[p.gm_clave]?.estado;
    return e === "hecho" || e === "reusado" || e === "fallido" || e === "sin_filas_libres" || e === "bloqueado_privacidad";
  }).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {terminados} de {total} GM
        </span>
        <span className="font-mono tabular-nums">{usd(estado.corrida?.costo_usd ?? 0)} acumulado</span>
      </div>
      <Barra fraccion={total === 0 ? 0 : terminados / total} etiqueta="Avance de la corrida" />
      {estado.esperando && <Alert tono="info">Esperando al proveedor… se reintenta solo.</Alert>}
      {estado.deteniendo && estado.fase === "corriendo" && <Alert tono="info">Deteniendo: termina el paso en curso y cancela la corrida. Lo ya generado se conserva.</Alert>}
      <ul className="divide-y divide-borde rounded-lg border border-borde text-sm">
        {estado.plan.map((p) => {
          const a = estado.porGm[p.gm_clave];
          const fallido = a?.estado === "fallido";
          return (
            <li key={p.gm_clave} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{nombres.get(p.gm_clave) ?? p.gm_clave}</span>
                <span className="flex items-center gap-2">
                  {p.reusa && <Badge tono="neutro">se reusa</Badge>}
                  <Badge tono={fallido ? "alerta" : a?.estado === "hecho" || a?.estado === "reusado" ? "exito" : "neutro"}>{ETIQUETA_ESTADO_CORRIDA_GM[a?.estado ?? "pendiente"]}</Badge>
                  {fallido && estado.fase === "terminada" && onReintentar && <BotonEnlace onClick={() => onReintentar(p.gm_clave)}>Reintentar este GM</BotonEnlace>}
                </span>
              </div>
              <Barra fraccion={fraccionAvance(a)} etiqueta={`Avance de ${nombres.get(p.gm_clave) ?? p.gm_clave}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * «Generar propuesta IA»: selector de GM, estimación, topes, «Regenerar aunque los datos no hayan cambiado» y Confirmar (con el costo).
 * Después conduce la corrida (progreso, Detener) y al terminar dice cómo quedó. El costo que se confirma es el de la estimación que el
 * planner vio: si el servidor la recalcula distinta (`409 costo_no_confirmado`), muestra la nueva y pide confirmar de nuevo.
 */
export function GenerarIaModal({
  proyeccionId,
  estado,
  seleccionInicial = "pendientes",
  onCerrar,
  onTermino,
}: {
  proyeccionId: string;
  estado: EstadoIaProyeccionApi;
  seleccionInicial?: SeleccionGms;
  onCerrar: () => void;
  onTermino: () => void;
}) {
  const gen = useGeneracionIa(proyeccionId, onTermino);
  const [seleccion, setSeleccion] = useState<SeleccionGms>(seleccionInicial);
  const [regenerar, setRegenerar] = useState(false);
  const [estimacionServidor, setEstimacionServidor] = useState<EstimacionApi | null>(null);
  const gms = useMemo(() => ordenarGms(estado.gms), [estado.gms]);
  const nombres = useMemo(() => new Map(gms.map((g) => [g.gm_clave, nombreGm(g)] as const)), [gms]);

  // La del servidor manda; sin ella, solo la de «pendientes» (sin regenerar) viene en el estado.
  const estimacion = estimacionServidor ?? (seleccion === "pendientes" && !regenerar ? estado.estimacion_pendientes : null);
  const corriendo = gen.estado.fase === "corriendo";
  const terminada = gen.estado.fase === "terminada";
  const sinNada = estimacion !== null && estimacion.gms === 0;
  const puedeConfirmar = !gen.iniciando && !corriendo && estimacion !== null && !sinNada && !superaTope(estimacion);

  function elegir(valor: string) {
    setSeleccion(leerSeleccion(valor));
    setEstimacionServidor(null);
    gen.limpiarErrorInicio();
  }

  function alternarRegenerar(v: boolean) {
    setRegenerar(v);
    setEstimacionServidor(null);
    gen.limpiarErrorInicio();
  }

  async function pedir(costo: number) {
    const r = await gen.iniciar(cuerpoIniciarCorrida(seleccion, regenerar, costo));
    if (r.ok) return;
    if (r.error.codigo === "costo_no_confirmado") {
      const e = estimacionDeError(r.error.detalle);
      if (e) {
        setEstimacionServidor(e);
        gen.limpiarErrorInicio();
      }
    }
  }

  function reintentarGm(clave: string) {
    gen.reiniciar();
    setSeleccion([clave]);
    setRegenerar(false);
    setEstimacionServidor(null);
  }

  function detener() {
    if (!confirm("¿Detener la generación? Termina el paso en curso y cancela la corrida; los GM ya generados se conservan.")) return;
    gen.detener();
  }

  const pie = corriendo ? (
    <Button variante="peligro" disabled={gen.estado.deteniendo} onClick={detener}>
      {gen.estado.deteniendo ? "Deteniendo…" : "Detener"}
    </Button>
  ) : terminada ? (
    <Button onClick={onCerrar}>Cerrar</Button>
  ) : (
    <>
      <Button variante="secundario" disabled={gen.iniciando} onClick={onCerrar}>
        Cancelar
      </Button>
      {estimacion === null ? (
        <Button disabled={gen.iniciando} onClick={() => void pedir(0)}>
          {gen.iniciando ? "Calculando…" : "Calcular estimación"}
        </Button>
      ) : (
        <Button disabled={!puedeConfirmar} onClick={() => void pedir(estimacion.costo_usd)}>
          {gen.iniciando ? "Iniciando…" : `Confirmar (${usd(estimacion.costo_usd)})`}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      titulo="Generar propuesta IA"
      descripcion={`${estado.servicio.modelo ?? ""} · prompt ${estado.servicio.version_prompt ?? ""}`.trim()}
      onCerrar={onCerrar}
      cerrable={!corriendo && !gen.iniciando}
      ancho="max-w-2xl"
      pie={pie}
    >
      <div className="space-y-4">
        {gen.errorInicio && <AlertaError error={gen.errorInicio} onCerrar={gen.limpiarErrorInicio} />}

        {gen.estado.fase === "inactiva" && (
          <>
            <Field label="Qué GM generar">
              <Select value={valorSeleccion(seleccion)} disabled={gen.iniciando} onChange={(e) => elegir(e.target.value)}>
                <option value="pendientes">{ETIQUETA_SELECCION_PENDIENTES}</option>
                <option value="todos">{ETIQUETA_SELECCION_TODOS}</option>
                {gms.map((g) => (
                  <option key={g.gm_clave} value={`gm:${g.gm_clave}`}>
                    {nombreGm(g)}
                    {g.es_resto ? " (Resto)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={regenerar} disabled={gen.iniciando} onChange={alternarRegenerar} label="Regenerar aunque los datos no hayan cambiado" />
              Regenerar aunque los datos no hayan cambiado
            </label>
            {estimacion ? (
              <ResumenEstimacion estimacion={estimacion} servicio={estado.servicio} />
            ) : (
              <p className="text-sm text-tinta-suave">Calcula la estimación antes de confirmar: no se llama al proveedor hasta que confirmes el costo.</p>
            )}
            {sinNada && <Alert tono="info">No hay GM que generar con esta selección: todos están al día. Marca «Regenerar» para forzarlo.</Alert>}
            <p className="text-xs text-tinta-suave">Cada GM es una corrida de varios pasos; puedes detenerla en cualquier momento. La IA solo propone: nada se decide en bloque.</p>
          </>
        )}

        {gen.estado.fase !== "inactiva" && <ProgresoGeneracion estado={gen.estado} nombres={nombres} onReintentar={reintentarGm} />}

        {terminada && gen.estado.error && <Alert tono="alerta">{gen.estado.error.mensaje}</Alert>}
        {terminada && !gen.estado.error && gen.estado.resumen && <Alert tono="exito">{gen.estado.resumen}</Alert>}
        {terminada && gen.estado.error && gen.estado.resumen && <p className="text-sm text-tinta-suave">{gen.estado.resumen}</p>}
      </div>
    </Modal>
  );
}
