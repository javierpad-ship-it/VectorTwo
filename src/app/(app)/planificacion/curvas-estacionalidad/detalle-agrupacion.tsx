"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { formatearUnidades } from "@/lib/reportes/histograma";
import {
  type DetalleAgrupacionApi,
  type ElegirCurvaRespuesta,
  type ModeloCurva,
  type TemporadaAgrupacion,
} from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { BadgeTemporada, OPCIONES_TEMPORADA, esTemporada } from "@/components/estacionalidad/temporada";
import { GraficoCurvas } from "@/components/curvas/grafico-curvas";
import { CandidatasTabla } from "./candidatas-tabla";
import { ComparadorCurvas } from "./comparador-curvas";
import { EfectoNinoDetalle } from "./efecto-nino-detalle";
import { RedComparable } from "./red-comparable";
import { TablaAnioMes } from "./tabla-anio-mes";
import { useRecurso } from "./use-recurso";
import {
  ETIQUETA_AVISO,
  compararCurvas,
  formatearFechaHora,
  modeloConNombre,
  redVistaDeAgrupacion,
  textoConfirmarAprobacion,
  textoObsoleta,
} from "./vista";

const ID_TABLA = "tabla-anio-mes";

/**
 * Detalle de una agrupación en la corrida elegida («tal como lo guardó la
 * corrida»; no lee la venta de nuevo). Aquí y solo aquí se aprueba una curva:
 * después de ver el efecto del Niño, el gráfico de todos los años, el comparador con
 * la vigente, las candidatas con su EAT por pliegue y la tabla año × mes. No hay
 * aprobación en bloque.
 */
export function DetalleAgrupacion({
  corridaId,
  agrupacionId,
  onVolver,
  onCambio,
}: {
  corridaId: string;
  agrupacionId: string;
  onVolver: () => void;
  /** Tras aprobar o cambiar la temporada: recarga el estado general y las agrupaciones. */
  onCambio: () => Promise<void> | void;
}) {
  const { datos, cargando, error: errorCarga, setError: setErrorCarga, recargar } = useRecurso<DetalleAgrupacionApi>(
    `/api/curvas/corridas/${corridaId}/agrupaciones/${agrupacionId}`
  );
  const [elegida, setElegida] = useState<ModeloCurva | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [redAbierta, setRedAbierta] = useState(false);

  const resultado = datos?.resultado ?? null;
  const modelo: ModeloCurva | null = elegida ?? resultado?.recomendada ?? null;
  const candidata = useMemo(() => resultado?.candidatas.find((c) => c.modelo === modelo && c.curva !== null) ?? null, [resultado, modelo]);
  const vigente = datos?.vigente ?? null;

  const propuesta = useMemo(() => (candidata?.curva && modelo ? { etiqueta: modeloConNombre(modelo), curva: candidata.curva } : null), [candidata, modelo]);
  const vigenteGraf = useMemo(
    () => (vigente ? { etiqueta: `v${vigente.version} · ${modeloConNombre(vigente.modelo)}`, curva: vigente.curva } : null),
    [vigente]
  );
  const comparacion = useMemo(
    () => (propuesta && vigente ? compararCurvas(vigente.curva, propuesta.curva, vigente.modelo === modelo) : null),
    [propuesta, vigente, modelo]
  );
  const red = useMemo(
    () => (datos ? redVistaDeAgrupacion(datos.red, datos.tiendas, datos.resultado, datos.corrida.parametros.umbral_tienda_dominante) : null),
    [datos]
  );

  async function aprobar() {
    if (!datos || !resultado || !modelo || !candidata) return;
    const texto = textoConfirmarAprobacion({
      agrupacion: datos.agrupacion.nombre,
      modelo,
      recomendada: resultado.recomendada,
      anios: resultado.anios,
      eat: candidata.eat,
      ruidoNormal: resultado.efecto_atipico.forma?.ruido_normal ?? null,
      versionVigente: vigente?.version ?? null,
      comparacion,
      avisos: resultado.avisos,
      nota,
    });
    if (!confirm(texto)) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const r = await api.put<ElegirCurvaRespuesta>(`/api/curvas/agrupaciones/${agrupacionId}`, {
        corrida_id: corridaId,
        modelo,
        ...(nota.trim() !== "" ? { nota: nota.trim() } : {}),
      });
      setNota("");
      setAviso(`Curva ${modeloConNombre(r.curva.modelo)} aprobada como versión ${r.curva.version} de ${datos.agrupacion.nombre}.`);
      await Promise.all([recargar(), onCambio()]);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarTemporada(t: TemporadaAgrupacion) {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await api.patch(`/api/agrupaciones-estacionalidad/${agrupacionId}`, { temporada: t });
      setAviso("Temporada guardada. Las curvas afectadas se marcan obsoletas hasta que recalcules y vuelvas a aprobar.");
      await Promise.all([recargar(), onCambio()]);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  }

  const volver = (
    <Button variante="secundario" tamano="sm" onClick={onVolver}>
      ← Volver a las curvas
    </Button>
  );

  if (!datos || !resultado) {
    return (
      <div className="space-y-4">
        <div>{volver}</div>
        {errorCarga && <Alert onCerrar={() => setErrorCarga(null)}>No se pudo cargar el detalle: {errorCarga}</Alert>}
        {!errorCarga && <p className="py-10 text-center text-sm text-tinta-suave">{cargando ? "Cargando el detalle…" : "Sin información."}</p>}
      </div>
    );
  }

  const { agrupacion, corrida } = datos;
  const aniosOrdenados = [...resultado.anios].sort((a, b) => a.anio - b.anio);
  const motivoObsoleta = textoObsoleta(datos.obsoleta);
  const sinPropiaNiVigente = resultado.recomendada === null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {volver}
        <p className="text-xs text-tinta-suave">
          Corrida del {formatearFechaHora(corrida.created_at)}
          {corrida.referencia ? " (referencia)" : ""} · datos y parámetros de ese momento
        </p>
      </div>

      {(error || errorCarga) && <Alert onCerrar={() => (error ? setError(null) : setErrorCarga(null))}>{error ?? errorCarga}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}
      {motivoObsoleta && <Alert>{motivoObsoleta}. Recalcula desde la pestaña Curvas y vuelve a aprobar.</Alert>}

      <Card titulo={agrupacion.nombre} descripcion={`Código ${agrupacion.codigo}${agrupacion.activo ? "" : " · inactiva"}`}>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {agrupacion.generos.length > 0 && (
              <ul className="flex flex-wrap gap-1" aria-label="Géneros">
                {agrupacion.generos.map((g) => (
                  <li key={g}>
                    <Badge>{g}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <label className="inline-flex items-center gap-2">
              <span className="text-tinta-suave">Temporada</span>
              <Select
                aria-label={`Temporada de ${agrupacion.nombre}`}
                value={agrupacion.temporada}
                disabled={ocupado}
                onChange={(e) => {
                  if (esTemporada(e.target.value)) void cambiarTemporada(e.target.value);
                }}
                className="h-8 w-40!"
              >
                {OPCIONES_TEMPORADA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </Select>
            </label>
            {agrupacion.temporada_sugerida !== null && agrupacion.temporada_sugerida !== agrupacion.temporada && (
              <span className="inline-flex items-center gap-1.5 text-xs text-alerta">
                Sugerida por sus líneas: <BadgeTemporada temporada={agrupacion.temporada_sugerida} />
              </span>
            )}
            <span className="text-tinta-suave">{formatearNumero(agrupacion.equivalencias_activas)} equivalencias activas</span>
          </div>

          <p className="text-tinta-suave">
            <strong className="text-tinta">Unidades de la red por año:</strong>{" "}
            {aniosOrdenados.map((a, i) => (
              <span key={a.anio}>
                {i > 0 && " · "}
                {a.anio}
                {a.clase === "en_curso" ? " (parcial)" : ""} {formatearUnidades(a.unidades)}
              </span>
            ))}
          </p>
          <p className="text-xs text-tinta-suave">
            Huellas de la corrida: composición {formatearNumero(resultado.composicion.equivalencias)} equivalencias; red {aniosOrdenados.map((a) => a.tiendas_en_red).join(" · ")} tiendas
            (un año por cifra).
          </p>

          {resultado.avisos.length > 0 && (
            <ul className="space-y-1" aria-label="Avisos de la agrupación">
              {resultado.avisos.map((a, i) => (
                <li key={`${a.codigo}-${i}`} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <Badge tono="alerta">{ETIQUETA_AVISO[a.codigo]}</Badge>
                  <span className="text-tinta-suave">{a.detalle}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {sinPropiaNiVigente && (
        <Alert tono="info">
          Esta agrupación no tiene curva posible en esta corrida (sin años utilizables). Revisa los avisos y la tabla de años; si faltan datos, publícalos en M5 y recalcula.
        </Alert>
      )}

      <EfectoNinoDetalle resultado={resultado} />

      <Card titulo="Todos los años superpuestos" descripcion="La participación de cada mes en el total de su año, sobre las mismas tiendas dentro de cada año.">
        <GraficoCurvas resultado={resultado} propuesta={propuesta} vigente={vigenteGraf} temporada={datos.temporada_curva} idTabla={ID_TABLA} />
      </Card>

      {propuesta && (
        <Card titulo="Comparador vigente / propuesta" descripcion="La propuesta es la candidata seleccionada en la tabla de abajo.">
          <ComparadorCurvas propuesta={propuesta} vigente={vigenteGraf} comparacion={comparacion} />
        </Card>
      )}

      <Card
        titulo="Candidatas"
        descripcion="El modelo propone y compara con backtesting (se deja un año fuera y se compara con lo que ocurrió); tú eliges. Aprobar crea una versión nueva."
      >
        <div className="space-y-4">
          <CandidatasTabla resultado={resultado} seleccionada={modelo} onSeleccionar={setElegida} />

          <div className="flex flex-wrap items-end gap-3 border-t border-borde pt-4">
            <div className="min-w-60 flex-1 text-sm">
              <p className="text-tinta">
                {modelo && candidata ? (
                  <>
                    Seleccionada: <strong>{modeloConNombre(modelo)}</strong>
                    {modelo !== resultado.recomendada && resultado.recomendada && <span className="text-tinta-suave"> (no es la recomendada: {resultado.recomendada})</span>}
                    {vigente ? <span className="text-tinta-suave"> · reemplazará a la v{vigente.version}</span> : <span className="text-tinta-suave"> · será la versión 1</span>}
                  </>
                ) : (
                  <span className="text-tinta-suave">No hay candidata disponible para aprobar.</span>
                )}
              </p>
            </div>
            {modelo && modelo !== resultado.recomendada && candidata && (
              <label className="block w-full max-w-sm">
                <span className="mb-1 block text-sm font-medium text-tinta">Nota (opcional)</span>
                <Input value={nota} maxLength={300} disabled={ocupado} onChange={(e) => setNota(e.target.value)} placeholder="Por qué eliges esta y no la recomendada" />
              </label>
            )}
            <Button onClick={() => void aprobar()} disabled={ocupado || !candidata}>
              {ocupado ? "Guardando…" : "Aprobar esta curva"}
            </Button>
          </div>
        </div>
      </Card>

      <Card titulo="Tabla año × mes" descripcion="Las cifras exactas del gráfico: participación y unidades de la red comparable de cada año.">
        <TablaAnioMes
          id={ID_TABLA}
          anios={resultado.anios}
          propuesta={propuesta}
          vigente={vigenteGraf}
          umbralDominante={corrida.parametros.umbral_tienda_dominante}
          nombreArchivo={`curva-${agrupacion.codigo.toLowerCase()}-anio-mes.csv`}
        />
      </Card>

      <Card
        titulo="Red comparable de esta agrupación"
        descripcion="Las tiendas de cada año con su peso sobre la venta de ESTA agrupación y su perfil frente al de la agrupación."
        acciones={
          <Button variante="fantasma" tamano="sm" aria-expanded={redAbierta} onClick={() => setRedAbierta((a) => !a)}>
            {redAbierta ? "Ocultar" : "Mostrar"}
          </Button>
        }
      >
        {!redAbierta ? (
          <p className="text-sm text-tinta-suave">Plegado.</p>
        ) : red ? (
          <RedComparable
            red={red}
            referencia="la agrupación"
            pie="Una tienda marcada «Distinta» se aparta del perfil de la agrupación más que el ruido entre años normales y pesa lo suficiente. Es un diagnóstico y no cambia la curva: si una tienda se aparta de verdad y pesa, el siguiente paso es M6b (curvas por tienda o por grupo de tiendas)."
          />
        ) : null}
      </Card>
    </div>
  );
}
