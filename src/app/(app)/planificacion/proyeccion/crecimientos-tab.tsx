"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import type { ProyeccionApi, ResumenCrecimientosProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BotonEnlace, Cargando, NUM } from "./comunes";
import {
  esMetodoAnterior,
  filasDeResumen,
  lineasPuente,
  textoAlertaCambiados,
  textoAplicadoPrincipal,
  textoCabeceraCrecimientos,
  textoDesvioPorFijadas,
  textoMetodoAnterior,
  textoObjetivo,
  textoQuienCuando,
  textoVigenteHoy,
  tieneMotivoCambiados,
  type FilaTablaCrecimiento,
} from "./crecimientos-vista";
import { rutaProyeccion, useAccion, useLectura } from "./use-proyeccion";
import { enlaceCrecimientoGeneroMundo, formatearPct, leerPorcentaje, textoFaltanCrecimientos, unidades } from "./vista";

/**
 * Pestaña Crecimientos (ficha 06d, 0.12.1): SOLO LECTURA. El crecimiento bruto del año siguiente es global y versionado: se aprueba en
 * Curvas de estacionalidad → Crecimiento por género × mundo y todas las proyecciones lo leen. Aquí se ve, por género × mundo, por el Resto
 * y en el Total, lo que aplicó el último cálculo (la foto) frente a lo aprobado hoy, con avisos si cambió o si falta aprobar para cerrar y
 * un enlace «Analizar y aprobar» a cada GM. Lo único editable es el objetivo global (`PATCH` de la proyección, que no la desactualiza).
 * En una proyección cerrada o archivada todo se ve igual y el objetivo queda en solo lectura.
 */
export function CrecimientosTab({
  proyeccion,
  bloqueada,
  onCambio,
  onRecalcular,
}: {
  proyeccion: ProyeccionApi;
  bloqueada: boolean;
  onCambio: () => Promise<void>;
  onRecalcular: () => Promise<void> | void;
}) {
  const lectura = useLectura<ResumenCrecimientosProyeccionApi>(`${rutaProyeccion(proyeccion.id)}/crecimientos`);
  const datos = lectura.datos;

  // Si la proyección se recalcula (desde la cabecera o desde aquí), el resumen se lee de nuevo.
  const recargarLectura = lectura.recargar;
  const calculadoAt = proyeccion.calculado_at;
  const ultimoCalculo = useRef(calculadoAt);
  useEffect(() => {
    if (ultimoCalculo.current === calculadoAt) return;
    ultimoCalculo.current = calculadoAt;
    void recargarLectura();
  }, [calculadoAt, recargarLectura]);

  async function recalcular() {
    await onRecalcular();
    await lectura.recargar();
  }

  return (
    <div className="space-y-4">
      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {lectura.cargando && !datos && <Cargando texto="Leyendo los crecimientos…" />}
      {datos && (
        <ResumenCrecimientos
          // El campo del objetivo parte de lo guardado cada vez que cambia.
          key={String(datos.objetivo_pct)}
          datos={datos}
          proyeccion={proyeccion}
          bloqueada={bloqueada}
          onRecalcular={() => void recalcular()}
          onRecargar={() => void lectura.recargar()}
          onObjetivoGuardado={async () => {
            await Promise.all([lectura.recargar(), onCambio()]);
          }}
        />
      )}
    </div>
  );
}

/** El resumen ya leído: avisos, tabla, puente y objetivo. */
export function ResumenCrecimientos({
  datos,
  proyeccion,
  bloqueada,
  onRecalcular,
  onRecargar,
  onObjetivoGuardado,
}: {
  datos: ResumenCrecimientosProyeccionApi;
  proyeccion: ProyeccionApi;
  bloqueada: boolean;
  onRecalcular: () => void;
  onRecargar: () => void;
  onObjetivoGuardado: () => Promise<void>;
}) {
  const enTrabajo = proyeccion.estado === "en_trabajo";
  const s = datos.anio_siguiente;
  const y = proyeccion.anio_en_curso;
  const enlaceGeneral = enlaceCrecimientoGeneroMundo(s, proyeccion.id);

  if (esMetodoAnterior(datos)) {
    return (
      <Alert tono="alerta">
        <span className="block">{textoMetodoAnterior(enTrabajo)}</span>
        {enTrabajo && (
          <span className="mt-1 block">
            <BotonEnlace onClick={onRecalcular} disabled={bloqueada}>
              Recalcular
            </BotonEnlace>
          </span>
        )}
      </Alert>
    );
  }

  const cambiados = textoAlertaCambiados(datos.cambiados, tieneMotivoCambiados(proyeccion));
  const sinAprobar = enTrabajo ? datos.sin_aprobar : null;
  const hayFaltantes = sinAprobar !== null && (sinAprobar.faltan.length > 0 || sinAprobar.resto_provisional) ? sinAprobar : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta-suave">{textoCabeceraCrecimientos(y, s)}</p>

      {cambiados && (
        <Alert tono="alerta">
          <span className="block">{cambiados}</span>
          {enTrabajo && (
            <span className="mt-1 block">
              <BotonEnlace onClick={onRecalcular} disabled={bloqueada}>
                Recalcular
              </BotonEnlace>
            </span>
          )}
        </Alert>
      )}
      {hayFaltantes && (
        <Alert tono="alerta">
          <span className="block">No se puede cerrar: {textoFaltanCrecimientos(hayFaltantes, s, false).replace(/^[A-Z]/, (c) => c.toLowerCase())}.</span>
          <span className="mt-1 block">
            <Link href={enlaceGeneral} className="font-medium underline underline-offset-2">
              Ir a Crecimiento por género × mundo
            </Link>
          </span>
        </Alert>
      )}

      <TablaResumenCrecimientos datos={datos} />

      {datos.total && <PieCrecimientos datos={datos} proyeccion={proyeccion} editable={enTrabajo && !bloqueada && !proyeccion.calculando} onGuardado={onObjetivoGuardado} onRecargar={onRecargar} />}
    </div>
  );
}

// ─── La tabla ───

function Insignias({ items }: { items: FilaTablaCrecimiento["insignias"] }) {
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

/** La tabla por GM, Resto y Total: aplicado (de la foto) · vigente hoy · base · resultante · rebote · fijadas · enlace. */
export function TablaResumenCrecimientos({ datos }: { datos: ResumenCrecimientosProyeccionApi }) {
  const s = datos.anio_siguiente;
  const filas = filasDeResumen(datos);
  const columnas: Columna<FilaTablaCrecimiento>[] = [
    {
      clave: "nombre",
      titulo: "Género · mundo",
      render: (f) => (
        <div className={f.tipo === "total" ? "font-semibold" : "font-medium"}>
          {f.nombre}
          {f.desglose && <p className="text-xs font-normal text-tinta-suave">{f.desglose}</p>}
        </div>
      ),
    },
    {
      clave: "aplicado",
      titulo: "% aplicado",
      render: (f) => {
        if (!f.aplicado) return <span className={`${NUM} block font-semibold`}>{formatearPct(f.ponderado)}</span>;
        const quien = textoQuienCuando(f.aplicado.por_nombre, f.aplicado.at);
        return (
          <div>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono tabular-nums">{textoAplicadoPrincipal(f.aplicado)}</span>
              {f.aplicado.provisional && (
                <span title="Resto provisional: se usa mientras no haya un Resto aprobado para este año">
                  <Badge tono="alerta">provisional</Badge>
                </span>
              )}
            </span>
            {quien && <p className="text-xs text-tinta-suave">{quien}</p>}
          </div>
        );
      },
    },
    {
      clave: "vigente",
      titulo: "Vigente hoy",
      render: (f) =>
        f.tipo === "total" ? (
          <span className="text-tinta-suave">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`font-mono tabular-nums ${f.vigenteHoy ? "" : "text-tinta-suave"}`}>{textoVigenteHoy(f.vigenteHoy)}</span>
            {f.cambio && (
              <span title="Lo aprobado hoy difiere de lo que aplicó el último cálculo: recalcula">
                <Badge tono="alerta">cambió</Badge>
              </span>
            )}
          </span>
        ),
    },
    { clave: "base", titulo: `Base ${datos.anio_siguiente - 1} (u)`, className: NUM, render: (f) => unidades(f.base) },
    { clave: "siguiente", titulo: `${s} resultante (u)`, className: NUM, render: (f) => unidades(f.siguiente) },
    { clave: "resultante", titulo: "% resultante", className: NUM, render: (f) => formatearPct(f.resultantePct) },
    {
      clave: "rebote",
      titulo: "Rebote del Niño",
      className: "whitespace-nowrap",
      render: (f) =>
        f.rebote ? (
          <span className="text-xs text-tinta-suave" title={f.rebote.titulo}>
            {f.rebote.texto.replace("rebote del Niño ", "")}
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    { clave: "fijadas", titulo: "Filas fijadas", render: (f) => <Insignias items={f.insignias} /> },
    {
      clave: "enlace",
      titulo: "",
      className: "whitespace-nowrap",
      render: (f) =>
        f.enlace ? (
          <Link href={f.enlace} className="font-medium text-marca-oscura underline underline-offset-2 hover:text-marca" aria-label={`Analizar y aprobar ${f.nombre}`}>
            Analizar y aprobar
          </Link>
        ) : null,
    },
  ];
  return (
    <section aria-label={`Crecimiento bruto ${s} por género y mundo, Resto y Total`}>
      <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.clave} claseFila={(f) => (f.tipo === "total" ? "bg-neutro-suave/60" : f.cambio ? "bg-alerta-suave/30" : undefined)} vacio="Ningún género · mundo con filas base en el año siguiente." />
    </section>
  );
}

// ─── Pie: puente y objetivo ───

function PieCrecimientos({
  datos,
  proyeccion,
  editable,
  onGuardado,
  onRecargar,
}: {
  datos: ResumenCrecimientosProyeccionApi;
  proyeccion: ProyeccionApi;
  editable: boolean;
  onGuardado: () => Promise<void>;
  onRecargar: () => void;
}) {
  const total = datos.total;
  const accion = useAccion();
  const idMotivo = useId();
  const [texto, setTexto] = useState(datos.objetivo_pct === null ? "" : String(datos.objetivo_pct));
  if (!total) return null;
  const s = datos.anio_siguiente;
  const y = proyeccion.anio_en_curso;
  const lectura = texto.trim() === "" ? null : leerPorcentaje(texto);
  const motivo = lectura && !lectura.ok ? lectura.motivo : null;
  const nuevo = lectura && lectura.ok ? lectura.valor : null;
  const sinCambio = nuevo === datos.objetivo_pct;
  const ocupado = accion.ocupado;

  async function guardar() {
    if (motivo !== null || sinCambio || ocupado || !editable) return;
    // El objetivo se edita con el PATCH de la proyección y no la desactualiza ni marca recálculo pendiente (06d §3.2).
    const r = await accion.ejecutar(() => api.patch<ProyeccionApi>(rutaProyeccion(proyeccion.id), { parametros: { crecimiento_objetivo_pct: nuevo } }));
    if (r.ok) await onGuardado();
  }

  return (
    <Card titulo={`Puente al Total ${s} de la Matriz y objetivo global`} descripcion="Sobre lo que aplicó el último cálculo. Es una referencia: puede diferir de la Matriz en ±0.5 u por fila por el redondeo.">
      <div className="space-y-4">
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecargar={onRecargar} />}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-tinta-suave">Ponderado de lo aplicado</dt>
            <dd className={`${NUM} text-lg font-semibold`}>{formatearPct(total.ponderado_escrito_pct)}</dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Resultado con las filas fijadas ({s} de las mismas tiendas)</dt>
            <dd className={`${NUM} text-lg font-semibold`}>
              {formatearPct(total.resultante_pct)} · {unidades(total.siguiente_total)} u
            </dd>
          </div>
        </dl>
        <p className="text-sm text-tinta-suave">{textoDesvioPorFijadas(total)}</p>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Puente al Total {s} de la Matriz</h3>
          <ul className="divide-y divide-borde rounded-lg border border-borde text-sm">
            {lineasPuente(total, y, s).map((l) => (
              <li key={l.clave} className={`flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5 ${l.negrita ? "bg-neutro-suave/60 font-semibold" : ""}`}>
                <span>{l.texto}</span>
                <span className={`${NUM} whitespace-nowrap`}>{l.valor}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Objetivo global (%)"
              hint={editable ? "Opcional. La meta de crecimiento bruto de mismas tiendas que tengas en mente. No se aplica a ninguna fila ni desactualiza la proyección." : "El objetivo es de solo lectura en una proyección cerrada, archivada o calculándose."}
              className="max-w-xs"
            >
              <Input
                inputMode="decimal"
                value={texto}
                disabled={!editable || ocupado}
                aria-invalid={motivo !== null}
                aria-describedby={motivo ? idMotivo : undefined}
                onChange={(e) => setTexto(e.target.value)}
                className={`max-w-40 font-mono tabular-nums ${motivo ? "border-alerta!" : ""}`}
              />
            </Field>
            {editable && (
              <Button variante="secundario" disabled={ocupado || motivo !== null || sinCambio} onClick={() => void guardar()}>
                {ocupado ? "Guardando…" : "Guardar objetivo"}
              </Button>
            )}
          </div>
          {motivo && (
            <p id={idMotivo} className="text-xs text-alerta">
              {motivo}
            </p>
          )}
          {total.objetivo ? <p className="text-sm">{textoObjetivo(total.objetivo)}</p> : <p className="text-sm text-tinta-suave">Sin objetivo: no hay comparación.</p>}
        </div>
      </div>
    </Card>
  );
}
