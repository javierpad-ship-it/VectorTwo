"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { formatearNumero } from "@/lib/formato";
import type { AnioFilaApi } from "@/lib/proyeccion/tipos-api";
import type { DecisionFila } from "./celda-decision";
import { textoPropuestaCambio } from "./celda-decision";
import { Avisos, NUM } from "./comunes";
import { ETIQUETA_METODO, formatearAvance, leerEntero, leerPorcentaje, minimoDecision, motivoCifraInvalida, nombreMes, textoFactoresMes, unidades } from "./vista";

/** Reparto guardado y reparto con la curva vigente, uno junto al otro (I8). */
function ComparacionRepartos({ registro }: { registro: AnioFilaApi }) {
  if (!registro.meses || !registro.meses_propuestos) return null;
  const propuestos = registro.meses_propuestos;
  const guardados = registro.meses;
  return (
    <div className="overflow-x-auto rounded-md border border-borde">
      <table className="w-full text-xs">
        <thead className="bg-neutro-suave text-left uppercase tracking-wide text-tinta-suave">
          <tr>
            <th className="px-2 py-1 font-medium">Reparto</th>
            {guardados.map((_, i) => (
              <th key={i} className="px-2 py-1 text-right font-medium">
                {nombreMes(i + 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">
          <tr>
            <td className="px-2 py-1 font-medium">Guardado (curva anterior)</td>
            {guardados.map((m, i) => (
              <td key={i} className={`px-2 py-1 ${NUM}`}>
                {formatearNumero(m)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-2 py-1 font-medium">Con la curva nueva</td>
            {propuestos.map((m, i) => (
              <td key={i} className={`px-2 py-1 ${NUM} ${m !== guardados[i] ? "bg-marca-suave font-semibold" : ""}`}>
                {formatearNumero(m)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * «Tu decisión {año}» de una fila (ficha 07, paso 4): la cifra con su explicación delante (método, propuesta frente a
 * decisión, cierre por avance, crecimiento, base de mismas tiendas), Aceptar, Guardar esta cifra, nota y Volver a la
 * propuesta. En el año en curso el mínimo es lo vendido. Con «la curva cambió» muestra los dos repartos y el botón
 * Aplicar curva nueva. Se monta con `key` = la decisión vigente para reiniciar el borrador cuando el servidor responde.
 */
export function BloqueDecision({
  registro,
  anio,
  anioEnCurso,
  bloqueada,
  ocupado,
  crecimientoDefecto,
  factoresMes,
  onDecidir,
  onAplicarCurva,
}: {
  registro: AnioFilaApi | undefined;
  anio: number;
  anioEnCurso: number;
  bloqueada: boolean;
  ocupado: boolean;
  crecimientoDefecto: number;
  factoresMes: readonly number[] | null | undefined;
  onDecidir: (d: DecisionFila) => Promise<boolean>;
  onAplicarCurva: (registroId: string) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState(registro?.decidido === null || registro?.decidido === undefined ? "" : String(registro.decidido));
  const [nota, setNota] = useState(registro?.nota ?? "");
  const [crec, setCrec] = useState(registro?.crecimiento_pct === null || registro?.crecimiento_pct === undefined ? "" : String(registro.crecimiento_pct));
  const [motivo, setMotivo] = useState<string | null>(null);

  if (!registro) return null;
  const esActual = anio === anioEnCurso;
  const minimo = minimoDecision(anio, anioEnCurso, registro.vendido);
  const decidida = registro.decidido !== null;
  const deshabilitada = bloqueada || ocupado;
  const cambio = textoPropuestaCambio(registro);
  const normal = textoFactoresMes(factoresMes);
  const paraRevision = registro.avisos.includes("revision_cola_larga");
  const hayCurvaNueva = registro.meses_propuestos !== null && registro.meses_propuestos !== undefined;

  async function guardar() {
    if (!registro) return;
    const cuerpo: DecisionFila = { origen: "manual", nota: nota.trim() === "" ? null : nota.trim() };
    if (texto.trim() !== "") {
      const m = motivoCifraInvalida(texto, minimo);
      if (m) {
        setMotivo(m);
        return;
      }
      const l = leerEntero(texto);
      if (l.ok) cuerpo.decidido = l.valor;
    } else if (decidida) {
      cuerpo.decidido = null;
    }
    if (!esActual) {
      if (crec.trim() === "") {
        if (registro.crecimiento_pct !== null) cuerpo.crecimiento_pct = null;
      } else {
        const g = leerPorcentaje(crec);
        if (!g.ok) {
          setMotivo(g.motivo);
          return;
        }
        cuerpo.crecimiento_pct = g.valor;
      }
    }
    if (cuerpo.decidido === undefined && cuerpo.crecimiento_pct === undefined) {
      setMotivo(esActual ? "Escribe el total o acepta la propuesta." : "Escribe el total, el crecimiento o acepta la propuesta.");
      return;
    }
    setMotivo(null);
    await onDecidir(cuerpo);
  }

  return (
    <section className="space-y-3 rounded-lg border border-borde bg-superficie p-4" aria-label={`Tu decisión ${anio}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Tu decisión {anio}</h4>
        <span className="text-xs text-tinta-suave">{ETIQUETA_METODO[registro.metodo]}</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {esActual && (
          <div>
            <dt className="text-xs text-tinta-suave">Vendido a la fecha</dt>
            <dd className={NUM}>{unidades(registro.vendido)}</dd>
          </div>
        )}
        {esActual && (
          <div>
            <dt className="text-xs text-tinta-suave">Avance de la curva</dt>
            <dd className={NUM}>{formatearAvance(registro.avance)}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-tinta-suave">Propuesta</dt>
          <dd className={NUM}>{unidades(registro.propuesto)}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Decidido</dt>
          <dd className={NUM}>{decidida ? unidades(registro.decidido) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Vigente</dt>
          <dd className={`${NUM} font-semibold`}>{unidades(registro.vigente)}</dd>
        </div>
        {registro.referencia_alternativa !== null && (
          <div>
            <dt className="text-xs text-tinta-suave">{paraRevision && esActual ? "Con el avance normal saldrían" : registro.metodo === "plan_anterior" ? "Por avance saldrían" : "Cifra alternativa"}</dt>
            <dd className={NUM}>{unidades(registro.referencia_alternativa)}</dd>
          </div>
        )}
      </dl>

      {paraRevision && esActual && (
        <p className="rounded-md border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-alerta">
          Para revisión: la propuesta es la demanda corregida por disponibilidad ({unidades(registro.propuesto)}); el avance normal ({unidades(registro.referencia_alternativa)}) queda como referencia. Hay que decidir esta fila para poder cerrar.
        </p>
      )}
      {paraRevision && !esActual && (
        <p className="rounded-md border border-alerta/30 bg-alerta-suave px-3 py-2 text-sm text-alerta">
          Para revisión: la propuesta es la base de {anioEnCurso} normalizada por el Niño × (1 + crecimiento), y esa base sale de la demanda corregida de {anioEnCurso}. Decide primero {anioEnCurso}; esta fila también hay que decidirla para poder cerrar.
        </p>
      )}
      {registro.explicacion && <p className="rounded-md bg-fondo px-3 py-2 text-sm leading-relaxed text-tinta">{registro.explicacion}</p>}
      {normal && (
        <p className="text-xs text-tinta-suave">
          Factor del Niño por mes en {anio}: <span className="font-mono">{normal}</span>.
        </p>
      )}
      {cambio && <p className="text-xs text-alerta">{cambio}</p>}
      <Avisos avisos={registro.avisos} />

      {hayCurvaNueva && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-alerta">La curva cambió: el reparto decidido conserva la curva anterior hasta que lo apliques.</p>
          <ComparacionRepartos registro={registro} />
          <Button variante="secundario" tamano="sm" disabled={deshabilitada || !registro.id} onClick={() => {
              if (registro.id) void onAplicarCurva(registro.id);
            }}
          >
            Aplicar curva nueva
          </Button>
        </div>
      )}

      {!bloqueada && (
        <div className="space-y-3 border-t border-borde pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Total ${anio}`} hint={esActual ? `Mínimo: lo vendido (${formatearNumero(minimo)})` : "Unidades del año, mismas tiendas"}>
              <Input
                inputMode="numeric"
                value={texto}
                disabled={ocupado}
                placeholder={registro.propuesto === null ? "—" : formatearNumero(registro.propuesto)}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setMotivo(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void guardar();
                  }
                }}
                className="font-mono tabular-nums"
              />
            </Field>
            {!esActual && (
              <Field label="Crecimiento (%)" hint={`Vacío = el de la proyección (${crecimientoDefecto} %)`}>
                <Input
                  inputMode="decimal"
                  value={crec}
                  disabled={ocupado}
                  onChange={(e) => {
                    setCrec(e.target.value);
                    setMotivo(null);
                  }}
                  className="font-mono tabular-nums"
                />
              </Field>
            )}
            <Field label="Nota" hint="Opcional, hasta 300 caracteres" className={esActual ? "sm:col-span-2" : ""}>
              <Input value={nota} maxLength={300} disabled={ocupado} onChange={(e) => setNota(e.target.value)} />
            </Field>
          </div>
          {motivo && <p className="text-xs text-alerta">{motivo}</p>}
          <div className="flex flex-wrap gap-2">
            <Button tamano="sm" disabled={deshabilitada || registro.propuesto === null} onClick={() => void onDecidir({ origen: "propuesta", nota: nota.trim() === "" ? null : nota.trim() })}>
              Aceptar la propuesta
            </Button>
            <Button variante="secundario" tamano="sm" disabled={deshabilitada} onClick={() => void guardar()}>
              Guardar esta cifra
            </Button>
            {decidida && (
              <Button variante="fantasma" tamano="sm" disabled={deshabilitada} onClick={() => void onDecidir({ decidido: null, origen: "manual" })}>
                Volver a la propuesta
              </Button>
            )}
          </div>
          {registro.decidido_por_nombre && (
            <p className="text-xs text-tinta-suave">
              Decidió {registro.decidido_por_nombre}
              {registro.decidido_at ? ` el ${registro.decidido_at.slice(0, 10)}` : ""}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
