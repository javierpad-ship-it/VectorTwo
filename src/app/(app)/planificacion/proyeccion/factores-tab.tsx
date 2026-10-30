"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import type { FactorApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, Cargando } from "./comunes";
import {
  anioEnCursoDeFactores,
  ETIQUETA_TEMPORADA_FACTOR as TEMPORADA,
  factor2,
  filasDiagnostico,
  insigniasFactor,
  leerAplicado,
  pideConfirmar,
  textoCalculado,
  textoDesfase,
  textoDiferencia,
  textoEfectivo,
  textoIntroFactores,
  textoMesesPeriodo,
  textoResumenDiagnostico,
  type DiagnosticoVista,
  type FactorVista,
} from "./factores-vista";
import { useAccion, useLectura } from "./use-proyeccion";
import { formatearMomento } from "./vista";

/**
 * «Cómo crece el verano atípicamente» (06e §4.2): la tabla de los doce meses (el año de referencia, el año atípico, ratio, red y ratio ÷ red; los
 * del periodo resaltados) y las líneas de resumen. Es solo lectura: el sistema muestra el dato y Javier escribe el factor; el diagnóstico no trae ningún botón que copie un valor.
 * Va dentro de un `<details>`, plegado, para no alargar la pantalla.
 */
function DiagnosticoFactor({ f }: { f: FactorVista }) {
  const d = f.diagnostico as DiagnosticoVista | null | undefined;
  if (!d) {
    return f.calculado_at === null ? null : <p className="text-xs text-tinta-suave">Sin diagnóstico mes a mes: pulsa «Sincronizar» para calcularlo con la fórmula nueva.</p>;
  }
  const filas = filasDiagnostico(d);
  const ref = d.anio_ref ? String(d.anio_ref) : "Referencia";
  const resumen = textoResumenDiagnostico(f, d);
  return (
    <details className="rounded-md border border-borde bg-fondo px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-medium">Cómo crece el {f.temporada} atípicamente</summary>
      <div className="mt-2 space-y-2">
        <div className="overflow-x-auto rounded-md border border-borde bg-superficie">
          <table className="w-full text-xs">
            <thead className="bg-neutro-suave text-left uppercase tracking-wide text-tinta-suave">
              <tr>
                <th className="px-2 py-1 font-medium">Mes</th>
                <th className="px-2 py-1 text-right font-medium">{ref}</th>
                <th className="px-2 py-1 text-right font-medium">{f.anio}</th>
                <th className="px-2 py-1 text-right font-medium">Ratio</th>
                <th className="px-2 py-1 text-right font-medium">Red</th>
                <th className="px-2 py-1 text-right font-medium">Ratio ÷ red</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {filas.map((x) => (
                <tr key={x.m} className={x.enPeriodo ? "bg-marca-suave font-medium" : undefined} title={x.enPeriodo ? "Mes del periodo del Niño" : undefined}>
                  <td className="px-2 py-1">{x.mes}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{x.uRef}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{x.u}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{x.ratio}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{x.control}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{x.relativo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-tinta-suave">Fondo marcado = mes del periodo del Niño con dato en los dos años.</p>
        {resumen.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
      </div>
    </details>
  );
}

/**
 * Un factor (año atípico × temporada): sus dos números (volumen y control), el calculado relativo, lo que escribió Javier y el efectivo. El
 * factor aplicado y la nota se editan y se guardan por fila. Confirmar un factor parcial es ESCRIBIR su valor (el mismo que el calculado lo
 * confirma); el calculado no se copia con un botón. Se monta con `key` = lo guardado, para reiniciar el borrador cuando el servidor responde.
 */
function TarjetaFactor({ f, soloLectura, ocupado, onGuardar }: { f: FactorVista; soloLectura: boolean; ocupado: boolean; onGuardar: (f: FactorApi, aplicado: number | null, nota: string | null) => Promise<boolean> }) {
  const [aplicado, setAplicado] = useState(f.ratio_aplicado === null ? "" : String(f.ratio_aplicado));
  const [nota, setNota] = useState(f.nota ?? "");
  const [motivo, setMotivo] = useState<string | null>(null);
  const confirma = pideConfirmar(f);
  const lectura = leerAplicado(aplicado, false);
  const escribio = lectura.ok && lectura.valor !== null;
  const sucio = aplicado.trim() !== (f.ratio_aplicado === null ? "" : String(f.ratio_aplicado)) || nota.trim() !== (f.nota ?? "");
  const etiquetaBoton = confirma && escribio ? "Confirmar" : "Guardar";
  const puedeGuardar = !soloLectura && !ocupado && (sucio || (confirma && escribio));
  const calculado = textoCalculado(f);
  const meses = textoMesesPeriodo(f);
  const diferencia = textoDiferencia(f);
  const insignias = insigniasFactor(f);
  const nombre = `${TEMPORADA[f.temporada]} ${f.anio}`;

  async function guardar() {
    const l = leerAplicado(aplicado, false);
    if (!l.ok) {
      setMotivo(l.motivo);
      return;
    }
    setMotivo(null);
    await onGuardar(f, l.valor, nota.trim() === "" ? null : nota.trim());
  }

  return (
    <article className={`space-y-3 rounded-lg border border-borde p-4 ${f.objetivo ? "bg-marca-suave/40" : "bg-superficie"}`} aria-label={`Factor del Niño, ${nombre}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{nombre}</h3>
        {insignias.map((i) => (
          <span key={i.clave} title={i.titulo}>
            <Badge tono={i.tono}>{i.texto}</Badge>
          </span>
        ))}
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        <div title="Ratio de la temporada en los meses del periodo frente al año normal de referencia">
          <dt className="text-xs text-tinta-suave">Volumen</dt>
          <dd className="font-mono tabular-nums">{factor2(f.ratio_volumen)}</dd>
        </div>
        <div title="Ratio de la red de todo el año en los mismos meses y tiendas">
          <dt className="text-xs text-tinta-suave">Control (red)</dt>
          <dd className="font-mono tabular-nums">{factor2(f.ratio_control)}</dd>
        </div>
        <div title="Relativo: volumen ÷ control">
          <dt className="text-xs text-tinta-suave">Calculado (relativo)</dt>
          <dd className="font-mono font-semibold tabular-nums">{calculado.valor}</dd>
          {calculado.nota && <dd className="text-xs text-tinta-suave">{calculado.nota}</dd>}
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Efectivo (el que se usa)</dt>
          <dd className="font-mono font-semibold tabular-nums">{textoEfectivo(f)}</dd>
        </div>
      </dl>

      <p className="text-xs text-tinta-suave">
        {[meses, f.tiendas_comunes === null ? "sin calcular" : `${f.tiendas_comunes} tiendas`, f.tiendas_comunes === null ? null : `calculado ${formatearMomento(f.calculado_at)}`].filter(Boolean).join(" · ")}
      </p>

      {f.estado === "desfasado" && <Alert tono="alerta">{textoDesfase(f.motivos_desfase)}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Aplicado (lo escribes tú)" className="w-36" hint={confirma ? "Parcial y sin confirmar: escribe el valor." : undefined}>
          <Input
            inputMode="decimal"
            value={aplicado}
            disabled={soloLectura || ocupado}
            placeholder={factor2(f.ratio_calculado)}
            aria-label={`Factor aplicado, ${nombre}`}
            aria-invalid={motivo !== null}
            onChange={(e) => {
              setAplicado(e.target.value);
              setMotivo(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (puedeGuardar) void guardar();
              }
            }}
            className={`text-right font-mono tabular-nums ${motivo ? "border-alerta!" : ""}`}
          />
        </Field>
        <Field label="Nota" className="min-w-48 flex-1">
          <Input value={nota} maxLength={200} disabled={soloLectura || ocupado} aria-label={`Nota, ${nombre}`} onChange={(e) => setNota(e.target.value)} />
        </Field>
        {!soloLectura && (
          <Button variante={confirma && escribio ? "primario" : "secundario"} disabled={!puedeGuardar} onClick={() => void guardar()}>
            {etiquetaBoton}
          </Button>
        )}
      </div>
      {motivo && <p className="text-xs text-alerta">{motivo}</p>}
      {diferencia && <p className="text-sm text-tinta-suave">{diferencia}</p>}

      <DiagnosticoFactor f={f} />
    </article>
  );
}

/** La lista de factores (presentación pura): una tarjeta por año atípico y temporada, con su calculado, lo aplicado, su estado y su diagnóstico. */
export function ListaFactores({ filas, soloLectura, ocupado, onGuardar }: { filas: readonly FactorVista[]; soloLectura: boolean; ocupado: boolean; onGuardar: (f: FactorApi, aplicado: number | null, nota: string | null) => Promise<boolean> }) {
  if (filas.length === 0) {
    return <p className="rounded-lg border border-borde px-3 py-6 text-center text-sm text-tinta-suave">Todavía no hay años atípicos. Carga los periodos del Niño en Curvas de estacionalidad y sincroniza.</p>;
  }
  return (
    <div className="space-y-3">
      {filas.map((f) => (
        <TarjetaFactor key={`${f.anio}-${f.temporada}-${f.ratio_aplicado}-${f.nota}-${f.ratio_calculado}-${f.estado}-${f.calculado_at}`} f={f} soloLectura={soloLectura} ocupado={ocupado} onGuardar={onGuardar} />
      ))}
    </div>
  );
}

/**
 * Pestaña Factores del Niño (fichas 07 y 06e). Año atípico × temporada: el factor relativo que calculó el sistema (la temporada frente a la red
 * en los mismos meses), sus dos números, el diagnóstico mes a mes y el factor aplicado, que se escribe aquí. «Sincronizar con M6» vuelve a
 * calcular con la fórmula relativa todos los años atípicos y NO toca lo que escribiste. Un factor parcial del año en curso se vuelve a
 * confirmar escribiendo su valor cada vez que se publica un mes: sin eso la proyección no se cierra. Editar un factor marca desactualizadas las
 * proyecciones en trabajo: hay que recalcular.
 */
export function FactoresTab({ puedeEditar, onCambio }: { puedeEditar: boolean; onCambio: () => Promise<void> }) {
  const lectura = useLectura<FactorApi[]>("/api/proyeccion/factores");
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const filas = lectura.datos ?? [];

  async function guardar(f: FactorApi, aplicado: number | null, nota: string | null): Promise<boolean> {
    setAviso(null);
    const confirmaba = pideConfirmar(f) && aplicado !== null;
    const r = await accion.ejecutar(() => api.put<FactorApi[]>("/api/proyeccion/factores", { factores: [{ anio: f.anio, temporada: f.temporada, ratio_aplicado: aplicado, nota }] }));
    if (!r.ok) return false;
    const nombre = `${TEMPORADA[f.temporada].toLowerCase()} ${f.anio}`;
    setAviso(
      `${confirmaba ? `Factor de ${nombre} confirmado.` : `Factor de ${nombre} guardado.`} Las proyecciones en trabajo quedan desactualizadas: recalcúlalas para que lo usen.`
    );
    await Promise.all([lectura.recargar(), onCambio()]);
    return true;
  }

  async function sincronizar() {
    if (
      !confirm(
        "Sincronizar vuelve a calcular el factor relativo de cada año atípico y temporada con la venta cargada. Lo que tú escribiste no cambia, pero tendrás que volver a confirmar los factores parciales y las proyecciones en trabajo quedarán desactualizadas. ¿Sincronizar?"
      )
    )
      return;
    setAviso(null);
    const r = await accion.ejecutar(() => api.post<FactorApi[]>("/api/proyeccion/factores/sincronizar", {}));
    if (!r.ok) return;
    setAviso("Factores sincronizados con M6. Revisa los valores y confirma los parciales escribiéndolos.");
    await Promise.all([lectura.recargar(), onCambio()]);
  }

  return (
    <Card
      titulo="Factores del Niño"
      descripcion={textoIntroFactores(anioEnCursoDeFactores(filas))}
      acciones={
        puedeEditar ? (
          <Button variante="secundario" tamano="sm" disabled={accion.ocupado} onClick={() => void sincronizar()}>
            {accion.ocupado ? "Trabajando…" : "Sincronizar con M6"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecargar={() => void lectura.recargar()} />}
        {aviso && (
          <Alert tono="exito" onCerrar={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}
        {lectura.cargando && !lectura.datos && <Cargando />}
        {lectura.datos && <ListaFactores filas={filas} soloLectura={!puedeEditar} ocupado={accion.ocupado} onGuardar={guardar} />}
        <p className="text-xs text-tinta-suave">
          Volumen = la temporada en los meses del Niño frente a un año normal; control = la red de todo el año en los mismos meses y tiendas; calculado = volumen ÷ control. «Parcial» = el periodo todavía no está
          completo: cada mes que se publica hay que sincronizar y volver a escribir el valor para confirmarlo. «Año objetivo» = el año siguiente de la proyección: si Curvas lo marca atípico, no se puede aprobar su
          crecimiento ni cerrar. Toda temporada nunca se ajusta.
        </p>
      </div>
    </Card>
  );
}
