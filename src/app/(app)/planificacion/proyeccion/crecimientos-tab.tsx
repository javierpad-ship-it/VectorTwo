"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { formatearDecimal, plural } from "@/lib/formato";
import type { ConflictoFilasManualesApi, ProyeccionApi, RespuestaCrecimientosApi, RespuestaGuardarCrecimientosApi, CeldaCrecimientoApi } from "@/lib/proyeccion/tipos-api";
import { ChoqueModal } from "./choque-modal";
import { AlertaError, BotonEnlace, Cargando, NUM } from "./comunes";
import {
  borradorDesde,
  campoVacio,
  celdaDe,
  claveCelda,
  diagnostico,
  entradasPromedio,
  promedioParaPantalla,
  firmaBorrador,
  hayCambios,
  insigniasDeConjunto,
  leerConflicto,
  leerPctMatriz,
  motivoIncompleta,
  motivoSinBase,
  nombreFilaChoque,
  textoBaseCelda,
  textoCabeceraCrecimientos,
  textoCeldasIncompletas,
  textoChoquePrevisto,
  resumenChoquePrevisto,
  textoCierresPuente,
  textoCrecimientosSinAplicar,
  textoDesgloseResto,
  textoDescartadas,
  textoDesvioPorFijadas,
  textoGeneroFaltante,
  textoObjetivo,
  textoPisada,
  textoRebote,
  textoRevertidas,
  textoSigueResto,
  tiendasMismasSiguiente,
  cuerpoGuardar,
  type Borrador,
  type CampoBorrador,
  type ExtrasGuardar,
  type FilaPromedio,
  type ResultadoPromedio,
} from "./crecimientos-vista";
import { rutaProyeccion, useAccion, useLectura } from "./use-proyeccion";
import { formatearPct, leerPorcentaje, unidades } from "./vista";

/** Lo que se muestra tras un «Guardar y recalcular» que respondió `200`. `nombres` ayuda a rotular las filas pisadas. */
type ResultadoVisible = { valor: RespuestaGuardarCrecimientosApi; nombres: Record<string, string> };

/**
 * Pestaña Crecimientos (ficha 07c, 0.10.8): la matriz del año siguiente por género × mundo. Filas = mundos reales; columnas = HOMBRE,
 * MUJER y «Resto» (una celda que abarca todas las filas: el crecimiento objetivo para todo lo demás). El % es la variación BRUTA de
 * `Y+1` frente a `Y` de las mismas tiendas, sin corregir por el Niño. Todas las celdas son obligatorias. «Calcular promedio» pondera lo
 * escrito en el navegador; el único botón de guardado es «Guardar y recalcular» (el recálculo va encadenado en el servidor). Si una fila
 * fijada a mano choca con el cambio, el Modal pregunta Pisar / Conservar / Cancelar. La ven y editan admin y planner; en una
 * proyección cerrada o archivada todo se ve y nada se edita.
 */
export function CrecimientosTab({
  proyeccion,
  bloqueada,
  onCambio,
  onRecalcular,
  onCalculando,
}: {
  proyeccion: ProyeccionApi;
  bloqueada: boolean;
  onCambio: () => Promise<void>;
  onRecalcular: () => Promise<void> | void;
  /** Marca la proyección como «calculando» en toda la pantalla mientras corre el guardado con recálculo. */
  onCalculando: (calculando: boolean) => void;
}) {
  const lectura = useLectura<RespuestaCrecimientosApi>(`${rutaProyeccion(proyeccion.id)}/crecimientos`);
  const [resultado, setResultado] = useState<ResultadoVisible | null>(null);
  const datos = lectura.datos;

  // Si la proyección se recalcula desde otro lado (la cabecera), los agregados de esta pestaña se leen de nuevo. El borrador no se pierde.
  const recargarLectura = lectura.recargar;
  const calculadoAt = proyeccion.calculado_at;
  const ultimoCalculo = useRef(calculadoAt);
  useEffect(() => {
    if (ultimoCalculo.current === calculadoAt) return;
    ultimoCalculo.current = calculadoAt;
    void recargarLectura();
  }, [calculadoAt, recargarLectura]);

  async function guardado(valor: RespuestaGuardarCrecimientosApi, nombres: Record<string, string>) {
    setResultado({ valor, nombres });
    await Promise.all([lectura.recargar(), onCambio()]);
  }

  async function recalcular() {
    setResultado(null);
    await onRecalcular();
    await lectura.recargar();
  }

  return (
    <div className="space-y-4">
      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {lectura.cargando && !datos && <Cargando texto="Leyendo los crecimientos…" />}
      {datos && (
        <FormularioCrecimientos
          // Un borrador nuevo cada vez que cambia lo guardado (huella): lo escrito siempre parte de lo que hay en el servidor.
          key={datos.huella}
          datos={datos}
          proyeccion={proyeccion}
          bloqueada={bloqueada}
          resultado={resultado}
          onCerrarResultado={() => setResultado(null)}
          onGuardado={guardado}
          onRecalcular={() => void recalcular()}
          onRecargar={() => void lectura.recargar()}
          onCalculando={onCalculando}
        />
      )}
    </div>
  );
}

export function FormularioCrecimientos({
  datos,
  proyeccion,
  bloqueada,
  resultado,
  onCerrarResultado,
  onGuardado,
  onRecalcular,
  onRecargar,
  onCalculando,
}: {
  datos: RespuestaCrecimientosApi;
  proyeccion: ProyeccionApi;
  bloqueada: boolean;
  resultado: ResultadoVisible | null;
  onCerrarResultado: () => void;
  onGuardado: (valor: RespuestaGuardarCrecimientosApi, nombres: Record<string, string>) => Promise<void>;
  onRecalcular: () => void;
  onRecargar: () => void;
  onCalculando: (calculando: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDesde(datos));
  const [calculado, setCalculado] = useState<{ resultado: ResultadoPromedio; firma: string } | null>(null);
  const [conflicto, setConflicto] = useState<{ datos: ConflictoFilasManualesApi; listaCambio: boolean } | null>(null);
  const accion = useAccion();
  const idMotivo = useId();

  const y = datos.anio_en_curso;
  const s = datos.anio_siguiente;
  // `editable` es lo que dice el servidor (en trabajo y sin cálculo vivo): decide si hay botones de guardado. `bloqueada` y `ocupado`
  // (la pantalla está calculando, también por este mismo guardado) solo los deshabilitan, para que la botonera no cambie de sitio.
  const editable = datos.editable;
  const sinEdicion = !editable || bloqueada;
  const enTrabajo = proyeccion.estado === "en_trabajo";
  const ocupado = accion.ocupado;
  const diag = diagnostico(datos, borrador);
  const motivoGuardar = motivoIncompleta(diag);
  const motivoCalcular = editable ? (motivoGuardar ?? motivoSinBase(datos, enTrabajo)) : motivoSinBase(datos, enTrabajo);
  const cambios = hayCambios(datos, borrador);
  const sinAplicar = textoCrecimientosSinAplicar(datos);
  const choquePrevisto = editable ? textoChoquePrevisto(resumenChoquePrevisto(datos, borrador)) : null;
  const firma = firmaBorrador(borrador);
  const obsoleto = calculado !== null && calculado.firma !== firma;
  const pctResto = (() => {
    const l = leerPctMatriz(borrador.resto.pct);
    return l.estado === "ok" ? l.valor : null;
  })();
  const tiendas = tiendasMismasSiguiente(proyeccion.bloques, s);

  function cambiarCelda(clave: string, parcial: Partial<CampoBorrador>) {
    setBorrador((b) => ({ ...b, celdas: { ...b.celdas, [clave]: { ...(b.celdas[clave] ?? campoVacio), ...parcial } } }));
  }

  function calcular() {
    const e = entradasPromedio(datos, borrador, { vaciasComoResto: !editable });
    if (!e.ok) return;
    const o = borrador.objetivo.trim() === "" ? null : leerPorcentaje(borrador.objetivo);
    setCalculado({ resultado: promedioParaPantalla(e.entradas, e.resto, o && o.ok ? o.valor : null, datos.puente), firma });
  }

  function descartar() {
    if (cambios && !confirm("¿Descartar lo que escribiste en la matriz? Se vuelve a lo guardado.")) return;
    setBorrador(borradorDesde(datos));
    setCalculado(null);
    accion.limpiar();
  }

  /** `PUT` con el recálculo encadenado. Sin `extras` es el primer intento; con ellos, la respuesta de Javier al Modal. */
  async function guardar(extras?: ExtrasGuardar) {
    const c = cuerpoGuardar(datos, borrador, extras);
    if (!c.ok || ocupado || bloqueada) return;
    onCerrarResultado();
    onCalculando(true);
    const r = await accion.ejecutar(() => api.put<RespuestaGuardarCrecimientosApi>(`${rutaProyeccion(proyeccion.id)}/crecimientos`, c.cuerpo));
    onCalculando(false);
    if (r.ok) {
      const nombres: Record<string, string> = {};
      for (const f of [...(conflicto?.datos.pct_propio.filas ?? []), ...(conflicto?.datos.decididas.filas ?? [])]) nombres[f.fila_id] = `${f.genero} · ${f.mundo} · ${nombreFilaChoque(f)}`;
      setConflicto(null);
      await onGuardado(r.valor, nombres);
      return;
    }
    const nuevo = r.error.codigo === "filas_manuales" ? leerConflicto(r.error.detalle) : null;
    if (nuevo) {
      // No se escribió nada: se pregunta (o se vuelve a preguntar con la lista nueva si ya había respondido).
      accion.limpiar();
      setConflicto({ datos: nuevo, listaCambio: extras?.resolucion !== undefined });
      return;
    }
    setConflicto(null);
    // Un grupo nuevo apareció mientras escribías: se dice cuál falta (el servidor manda la lista).
    const incompletas = textoCeldasIncompletas(r.error.detalle);
    if (incompletas) accion.setError({ ...r.error, mensaje: incompletas });
  }

  const ayudaPct = "Variación bruta del año siguiente frente al vigente de las mismas tiendas, sin corregir por el Niño.";

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta-suave">{textoCabeceraCrecimientos(y, s, tiendas)}</p>

      {sinAplicar && (
        <Alert tono="alerta">
          <span className="block">{sinAplicar}</span>
          {enTrabajo && (
            <span className="mt-1 block">
              <BotonEnlace onClick={onRecalcular} disabled={ocupado || bloqueada}>
                Recalcular
              </BotonEnlace>
            </span>
          )}
        </Alert>
      )}
      {datos.generos_faltantes.map((g) => (
        <Alert key={g} tono="alerta">
          {textoGeneroFaltante(g)}
        </Alert>
      ))}
      {!datos.editable && !enTrabajo && (
        <Alert tono="info">La proyección está {proyeccion.estado}: los crecimientos se ven pero no se editan. «Calcular promedio» sigue disponible.</Alert>
      )}
      {!datos.editable && enTrabajo && <Alert tono="info">La proyección se está calculando: los crecimientos no se pueden editar mientras tanto.</Alert>}
      {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={onRecalcular} onRecargar={onRecargar} />}
      {resultado && <ResultadoGuardado resultado={resultado.valor} nombres={resultado.nombres} onCerrar={onCerrarResultado} onRecalcular={onRecalcular} />}

      <div className="max-w-md">
        <Field label="Objetivo global (%)" hint="Opcional. La meta de crecimiento bruto de mismas tiendas que tengas en mente. No se aplica a ninguna fila: solo se compara en «Calcular promedio».">
          <Input
            inputMode="decimal"
            value={borrador.objetivo}
            disabled={sinEdicion || ocupado}
            aria-invalid={diag.objetivoInvalido !== null}
            onChange={(e) => setBorrador((b) => ({ ...b, objetivo: e.target.value }))}
            className={`max-w-40 font-mono tabular-nums ${diag.objetivoInvalido ? "border-alerta!" : ""}`}
          />
        </Field>
        {diag.objetivoInvalido && <p className="mt-1 text-xs text-alerta">{diag.objetivoInvalido}</p>}
      </div>

      <TablaCrecimientos datos={datos} borrador={borrador} pctResto={pctResto} deshabilitada={sinEdicion || ocupado} ayuda={ayudaPct} onCelda={cambiarCelda} onResto={(p) => setBorrador((b) => ({ ...b, resto: { ...b.resto, ...p } }))} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variante="secundario" disabled={ocupado || motivoCalcular !== null} aria-describedby={motivoCalcular ? idMotivo : undefined} onClick={calcular}>
          Calcular promedio
        </Button>
        {editable && (
          <>
            <Button disabled={ocupado || bloqueada || motivoGuardar !== null} aria-describedby={motivoGuardar ? idMotivo : undefined} onClick={() => void guardar()}>
              {ocupado ? "Guardando y recalculando…" : "Guardar y recalcular"}
            </Button>
            <Button variante="fantasma" disabled={ocupado || bloqueada || (!cambios && calculado === null)} onClick={descartar}>
              Descartar cambios
            </Button>
          </>
        )}
      </div>
      {ocupado && (
        <p role="status" className="text-sm text-tinta-suave">
          Guardando y recalculando… (hasta 30 s). No cierres esta pantalla.
        </p>
      )}
      {motivoCalcular && (
        <p id={idMotivo} className="text-sm text-alerta">
          {motivoCalcular}
        </p>
      )}

      {choquePrevisto && (
        <p className="rounded-md border border-borde bg-fondo px-3 py-2 text-sm text-tinta-suave">
          {choquePrevisto}
        </p>
      )}

      {calculado && <PanelPromedio resultado={calculado.resultado} obsoleto={obsoleto} anioEnCurso={y} anioSiguiente={s} />}

      {conflicto && (
        <ChoqueModal
          key={conflicto.datos.huella_choque}
          conflicto={conflicto.datos}
          anioSiguiente={s}
          listaCambio={conflicto.listaCambio}
          ocupado={ocupado}
          onPisar={(incluir) => void guardar({ resolucion: "pisar", incluir_decididas: incluir, huella_choque: conflicto.datos.huella_choque })}
          onConservar={() => void guardar({ resolucion: "conservar", huella_choque: conflicto.datos.huella_choque })}
          onCancelar={() => setConflicto(null)}
        />
      )}
    </div>
  );
}

// ─── La matriz ───

const TH = "px-3 py-2 text-left font-medium";

/**
 * La matriz: una fila por mundo, una columna por género (HOMBRE, MUJER) y el Resto como una celda que abarca todas las filas. Cada celda
 * lleva el campo `%` (obligatorio), una nota, su base y sus insignias. Una celda sin filas se ve como «—».
 */
export function TablaCrecimientos({
  datos,
  borrador,
  pctResto,
  deshabilitada,
  ayuda,
  onCelda,
  onResto,
}: {
  datos: RespuestaCrecimientosApi;
  borrador: Borrador;
  pctResto: number | null;
  deshabilitada: boolean;
  ayuda?: string;
  onCelda: (clave: string, parcial: Partial<CampoBorrador>) => void;
  onResto: (parcial: Partial<CampoBorrador>) => void;
}) {
  const { generos, mundos } = datos;
  const resto = (
    <CeldaResto datos={datos} campo={borrador.resto} deshabilitada={deshabilitada} ayuda={ayuda} onCambio={onResto} />
  );

  if (mundos.length === 0 || generos.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState titulo="Ningún mundo tiene filas de Hombre ni de Mujer en el año siguiente" detalle="Todo sigue el Resto. Si esperabas ver mundos, recalcula la proyección." />
        <div className="max-w-md rounded-lg border border-borde bg-superficie p-3">{resto}</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">
          Crecimiento bruto {datos.anio_siguiente} frente a {datos.anio_en_curso} por mundo y género, más el Resto
        </caption>
        <thead className="bg-neutro-suave text-xs uppercase tracking-wide text-tinta-suave">
          <tr>
            <th scope="col" className={TH}>
              Mundo
            </th>
            {generos.map((g) => (
              <th key={g.id} scope="col" className={TH}>
                {g.nombre}
              </th>
            ))}
            <th scope="col" className={`${TH} border-l border-borde`}>
              Resto
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">
          {mundos.map((m, i) => (
            <tr key={m.id}>
              <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                {m.nombre}
              </th>
              {generos.map((g) => (
                <td key={g.id} className="px-3 py-2 align-top">
                  <CeldaMatriz
                    celda={celdaDe(datos, g.id, m.id)}
                    nombre={`${g.nombre} · ${m.nombre}`}
                    campo={borrador.celdas[claveCelda(g.id, m.id)] ?? campoVacio}
                    pctResto={pctResto}
                    anioSiguiente={datos.anio_siguiente}
                    deshabilitada={deshabilitada}
                    ayuda={ayuda}
                    onCambio={(p) => onCelda(claveCelda(g.id, m.id), p)}
                  />
                </td>
              ))}
              {i === 0 && (
                <td rowSpan={mundos.length} className="min-w-52 border-l border-borde bg-fondo/40 px-3 py-2 align-top">
                  {resto}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Insignias({ items }: { items: ReturnType<typeof insigniasDeConjunto> }) {
  if (items.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i.clave} title={i.titulo}>
          <Badge tono={i.tono}>{i.texto}</Badge>
        </span>
      ))}
    </span>
  );
}

/** Campo `%` con su sufijo, su nota (botón `n`) y los textos de apoyo. Lo comparten las celdas y el Resto. */
function CampoPct({
  nombre,
  campo,
  deshabilitada,
  vacioResaltado,
  ayuda,
  idApoyo,
  onCambio,
}: {
  nombre: string;
  campo: CampoBorrador;
  deshabilitada: boolean;
  /** Resalta el borde de alerta: la celda sigue vacía. */
  vacioResaltado: boolean;
  ayuda?: string;
  idApoyo: string;
  onCambio: (p: Partial<CampoBorrador>) => void;
}) {
  const [notaAbierta, setNotaAbierta] = useState(campo.nota !== "");
  const lectura = leerPctMatriz(campo.pct);
  const invalido = lectura.estado === "invalido";
  const idNota = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Input
          inputMode="decimal"
          value={campo.pct}
          disabled={deshabilitada}
          aria-label={`Crecimiento bruto de ${nombre} (%)`}
          aria-invalid={invalido || vacioResaltado}
          aria-describedby={idApoyo}
          required
          title={invalido ? lectura.motivo : ayuda}
          onChange={(e) => onCambio({ pct: e.target.value })}
          className={`h-9 w-24! text-right font-mono tabular-nums ${invalido || vacioResaltado ? "border-alerta! bg-alerta-suave/40!" : ""}`}
        />
        <span className="text-xs text-tinta-suave">%</span>
        <button
          type="button"
          onClick={() => setNotaAbierta((v) => !v)}
          aria-expanded={notaAbierta}
          aria-controls={idNota}
          aria-label={`Nota de ${nombre}`}
          title={campo.nota ? `Nota: ${campo.nota}` : "Agregar una nota"}
          className={`h-6 min-w-6 rounded border px-1 text-xs font-medium ${campo.nota ? "border-marca bg-marca-suave text-marca-oscura" : "border-borde text-tinta-suave hover:bg-neutro-suave"}`}
        >
          n
        </button>
      </div>
      {invalido && <p className="text-xs text-alerta">{lectura.motivo}</p>}
      {notaAbierta && (
        <div id={idNota}>
          {deshabilitada && campo.nota !== "" ? (
            <p className="text-xs text-tinta-suave">Nota: {campo.nota}</p>
          ) : (
            <Input value={campo.nota} maxLength={300} disabled={deshabilitada} placeholder="Nota (opcional, hasta 300)" aria-label={`Texto de la nota de ${nombre}`} onChange={(e) => onCambio({ nota: e.target.value })} className="h-8 text-xs" />
          )}
        </div>
      )}
    </div>
  );
}

function CeldaMatriz({
  celda,
  nombre,
  campo,
  pctResto,
  anioSiguiente,
  deshabilitada,
  ayuda,
  onCambio,
}: {
  celda: CeldaCrecimientoApi | undefined;
  nombre: string;
  campo: CampoBorrador;
  pctResto: number | null;
  anioSiguiente: number;
  deshabilitada: boolean;
  ayuda?: string;
  onCambio: (p: Partial<CampoBorrador>) => void;
}) {
  const idApoyo = useId();
  if (!celda || celda.sin_filas) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-tinta-suave" title={`${nombre}: ese género no tiene filas en ese mundo, así que no se edita y no es obligatoria.`}>
        <span aria-hidden>—</span>
        <Badge tono="neutro">sin filas</Badge>
        {celda && celda.pct !== null && <span className="text-xs">(guardada: {formatearDecimal(celda.pct, 1)} %)</span>}
      </span>
    );
  }
  const lectura = leerPctMatriz(campo.pct);
  const pct = lectura.estado === "ok" ? lectura.valor : null;
  const rebote = textoRebote(celda.agregado);
  return (
    <div className="space-y-1.5">
      <CampoPct nombre={nombre} campo={campo} deshabilitada={deshabilitada} vacioResaltado={lectura.estado === "vacio"} ayuda={ayuda} idApoyo={idApoyo} onCambio={onCambio} />
      <div id={idApoyo} className="space-y-1">
        {lectura.estado === "vacio" && <p className="text-xs text-alerta">{textoSigueResto(pctResto)}</p>}
        <p className="text-xs text-tinta-suave">{textoBaseCelda(celda.agregado, anioSiguiente)}</p>
        {rebote && (
          <p className="text-xs text-tinta-suave" title={rebote.titulo}>
            {rebote.texto}
          </p>
        )}
        <Insignias items={insigniasDeConjunto(celda.agregado, pct)} />
      </div>
    </div>
  );
}

function CeldaResto({
  datos,
  campo,
  deshabilitada,
  ayuda,
  onCambio,
}: {
  datos: RespuestaCrecimientosApi;
  campo: CampoBorrador;
  deshabilitada: boolean;
  ayuda?: string;
  onCambio: (p: Partial<CampoBorrador>) => void;
}) {
  const idApoyo = useId();
  const lectura = leerPctMatriz(campo.pct);
  const pct = lectura.estado === "ok" ? lectura.valor : null;
  const desglose = textoDesgloseResto(datos.resto.por_genero);
  const rebote = textoRebote(datos.resto.agregado);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-tinta-suave">Todo lo demás: los otros géneros y los grupos de Hombre o Mujer sin celda</p>
      <CampoPct nombre="Resto" campo={campo} deshabilitada={deshabilitada} vacioResaltado={lectura.estado === "vacio"} ayuda={ayuda} idApoyo={idApoyo} onCambio={onCambio} />
      <div id={idApoyo} className="space-y-1">
        <p className="text-xs text-tinta-suave">{textoBaseCelda(datos.resto.agregado, datos.anio_siguiente)}</p>
        {desglose && <p className="text-xs text-tinta-suave">{desglose}</p>}
        {rebote && (
          <p className="text-xs text-tinta-suave" title={rebote.titulo}>
            {rebote.texto}
          </p>
        )}
        <Insignias items={insigniasDeConjunto(datos.resto.agregado, pct)} />
      </div>
    </div>
  );
}

// ─── Resultado de «Guardar y recalcular» ───

/** Las alertas tras un guardado `200`: éxito con la lista de pisadas, recálculo fallido con Recalcular, y filas editadas mientras se guardaba. */
export function ResultadoGuardado({
  resultado,
  nombres,
  onCerrar,
  onRecalcular,
}: {
  resultado: RespuestaGuardarCrecimientosApi;
  nombres: Record<string, string>;
  onCerrar: () => void;
  onRecalcular: () => void;
}) {
  const { pisadas, conservadas, revertidas, recalculo, celdas_descartadas } = resultado;
  const aviso = textoRevertidas(revertidas.length);
  const descartadas = textoDescartadas(celdas_descartadas);
  return (
    <div className="space-y-2">
      {recalculo.ok ? (
        <Alert tono="exito" onCerrar={onCerrar}>
          <span className="block font-medium">Guardado y recalculado.</span>
          {conservadas > 0 && <span className="mt-0.5 block">{plural(conservadas, "fila fijada a mano conservó", "filas fijadas a mano conservaron")} su % o su total.</span>}
          {pisadas.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">{plural(pisadas.length, "fila pisada", "filas pisadas")}: lo que tenían antes</summary>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
                {pisadas.map((p) => (
                  <li key={p.fila_id}>{textoPisada(p, nombres[p.fila_id] ?? `Fila ${p.fila_id.slice(0, 8)}`)}</li>
                ))}
              </ul>
            </details>
          )}
        </Alert>
      ) : (
        <Alert tono="alerta" onCerrar={onCerrar}>
          <span className="block">Se guardó la matriz pero no se pudo recalcular: {recalculo.mensaje}</span>
          <span className="mt-0.5 block text-xs">Mientras tanto, las filas pisadas quedan sin decisión y con su reparto viejo, y no se puede cerrar la proyección.</span>
          <span className="mt-1 block">
            <BotonEnlace onClick={onRecalcular}>Recalcular</BotonEnlace>
          </span>
        </Alert>
      )}
      {aviso && <Alert tono="alerta">{aviso}</Alert>}
      {descartadas && <Alert tono="alerta">{descartadas}</Alert>}
    </div>
  );
}

// ─── Calcular promedio ───

/**
 * El panel de «Calcular promedio»: una tabla por celda (base, % escrito, resultado de `Y+1` y % resultante), el Resto y el total, el
 * ponderado de lo escrito frente al resultado con las filas fijadas, la comparación con el objetivo global y el puente al Total de la
 * Matriz. Es una estimación (±0,5 u por fila por el redondeo). Si se editó una celda después de calcular, se marca como vencido.
 */
export function PanelPromedio({ resultado, obsoleto, anioEnCurso, anioSiguiente }: { resultado: ResultadoPromedio; obsoleto: boolean; anioEnCurso: number; anioSiguiente: number }) {
  const y = anioEnCurso;
  const s = anioSiguiente;
  const p = resultado.puente;
  const columnas: Columna<FilaPromedio>[] = [
    { clave: "nombre", titulo: "Celda", render: (f) => <span className={f.tipo === "total" ? "font-semibold" : ""}>{f.nombre}</span> },
    { clave: "base", titulo: `Base ${y} (u)`, className: NUM, render: (f) => unidades(f.base) },
    { clave: "escrito", titulo: "% escrito", className: NUM, render: (f) => formatearPct(f.escrito) },
    { clave: "siguiente", titulo: `${s} resultante (u)`, className: NUM, render: (f) => unidades(f.siguiente) },
    { clave: "resultante", titulo: "% resultante", className: NUM, render: (f) => formatearPct(f.resultante) },
  ];
  const lineasPuente: { clave: string; texto: string; valor: string; negrita?: boolean }[] = [
    { clave: "base", texto: `Base ${y} de las mismas tiendas de ${s}`, valor: `${unidades(resultado.base)} u` },
    { clave: "mismas", texto: `× crecimiento resultante ${formatearPct(resultado.resultante)} = ${s} de las mismas tiendas`, valor: `${unidades(p.mismas)} u` },
    { clave: "nuevas", texto: `+ nuevas del año anterior (${s})`, valor: `${unidades(p.nuevas_anterior)} u` },
    { clave: "aperturas", texto: `+ aperturas de ${s}`, valor: `${unidades(p.aperturas)} u` },
    { clave: "cierres", texto: `+ cierres de ${s} (su venta parcial suma: su ${y} ya salió de la base)`, valor: textoCierresPuente(p) },
    { clave: "total", texto: `= Total ${s}`, valor: `${unidades(p.total)} u`, negrita: true },
    { clave: "comparado", texto: `Total ${y} de la Matriz ${unidades(p.total_en_curso)} u → Var. de la Matriz`, valor: formatearPct(p.variacion_pct) },
  ];
  return (
    <section aria-label="Resultado de Calcular promedio" className={obsoleto ? "opacity-70" : ""}>
      <Card titulo="Promedio ponderado de lo que escribiste" descripcion="Cada celda pesa por su base. Es una estimación: puede diferir del recálculo en ±0.5 u por fila por el redondeo.">
        <div className="space-y-4">
          {obsoleto && <Alert tono="alerta">Cambiaste celdas: vuelve a calcular. Lo de abajo es de antes del cambio.</Alert>}
          {resultado.base <= 0 && <Alert tono="alerta">Sin base: recalcula la proyección.</Alert>}

          <DataTable columnas={columnas} filas={resultado.filas} claveFila={(f) => f.clave} claseFila={(f) => (f.tipo === "total" ? "bg-neutro-suave/60 font-medium" : undefined)} />

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-tinta-suave">Ponderado de lo escrito</dt>
              <dd className={`${NUM} text-lg font-semibold`}>{formatearPct(resultado.ponderado_escrito)}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-suave">Resultado con las filas fijadas ({s} de las mismas tiendas)</dt>
              <dd className={`${NUM} text-lg font-semibold`}>
                {formatearPct(resultado.resultante)} · {unidades(resultado.siguiente)} u
              </dd>
            </div>
          </dl>
          <p className="text-sm text-tinta-suave">{textoDesvioPorFijadas(resultado)}</p>
          {resultado.objetivo && <p className="text-sm">{textoObjetivo(resultado.objetivo)}</p>}

          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Puente al Total {s} de la Matriz</h3>
            <ul className="divide-y divide-borde rounded-lg border border-borde text-sm">
              {lineasPuente.map((l) => (
                <li key={l.clave} className={`flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5 ${l.negrita ? "bg-neutro-suave/60 font-semibold" : ""}`}>
                  <span>{l.texto}</span>
                  <span className={`${NUM} whitespace-nowrap`}>{l.valor}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}
