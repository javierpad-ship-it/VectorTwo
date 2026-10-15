"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { formatearNumero } from "@/lib/formato";
import type { AnioFilaApi } from "@/lib/proyeccion/tipos-api";
import { leerEntero, leerPorcentaje, minimoDecision, motivoCifraInvalida } from "./vista";

/** Lo que se envía a `PUT …/filas/[filaId]/anios/[anio]` (la `decisionSchema` de la ficha). */
export type DecisionFila = {
  decidido?: number | null;
  origen: "propuesta" | "manual";
  nota?: string | null;
  crecimiento_pct?: number | null;
};

/** ¿La propuesta se movió desde que decidiste? Texto para el aviso, o `null`. */
export function textoPropuestaCambio(r: AnioFilaApi | undefined): string | null {
  if (!r || r.decidido === null || r.propuesta_al_decidir === null || r.propuesta_al_decidir === r.propuesto) return null;
  return `Decidiste ${formatearNumero(r.decidido)} con la propuesta en ${formatearNumero(r.propuesta_al_decidir)}; hoy la propuesta es ${r.propuesto === null ? "—" : formatearNumero(r.propuesto)}.`;
}

/**
 * Celda «decidido» editable en línea (ficha 07, paso 3): escribir y Enter guarda la cifra; ✓ acepta la propuesta tal
 * cual; ↺ vuelve a la propuesta; `n` marca que hay nota (se edita en el detalle). En el año en curso el mínimo es lo
 * vendido. Se monta con `key` = la decisión vigente, así el borrador se reinicia cuando el servidor responde.
 */
export function CeldaDecision({
  registro,
  anio,
  anioEnCurso,
  bloqueada,
  ocupado,
  onDecidir,
  etiqueta,
}: {
  registro: AnioFilaApi | undefined;
  anio: number;
  anioEnCurso: number;
  bloqueada: boolean;
  ocupado: boolean;
  onDecidir: (d: DecisionFila) => Promise<boolean>;
  etiqueta: string;
}) {
  const [texto, setTexto] = useState(registro?.decidido === null || registro?.decidido === undefined ? "" : String(registro.decidido));
  const [motivo, setMotivo] = useState<string | null>(null);

  if (!registro) return <span className="text-tinta-suave">—</span>;
  const minimo = minimoDecision(anio, anioEnCurso, registro.vendido);
  const decidida = registro.decidido !== null;
  const cambio = textoPropuestaCambio(registro);
  const deshabilitada = bloqueada || ocupado;

  async function enviar() {
    if (!registro) return;
    if (texto.trim() === "") {
      setMotivo(null);
      if (decidida) await onDecidir({ decidido: null, origen: "manual" });
      return;
    }
    const m = motivoCifraInvalida(texto, minimo);
    if (m) {
      setMotivo(m);
      return;
    }
    const l = leerEntero(texto);
    if (!l.ok) return;
    if (decidida && registro.decidido === l.valor) {
      setMotivo(null);
      return;
    }
    setMotivo(null);
    await onDecidir({ decidido: l.valor, origen: "manual" });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          inputMode="numeric"
          value={texto}
          disabled={deshabilitada}
          placeholder={registro.propuesto === null ? "—" : formatearNumero(registro.propuesto)}
          aria-label={etiqueta}
          aria-invalid={motivo !== null}
          title={motivo ?? undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setMotivo(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void enviar();
            }
          }}
          className={`h-8 w-24! text-right font-mono tabular-nums ${motivo ? "border-alerta!" : ""}`}
        />
        {!decidida ? (
          <Button
            variante="secundario"
            tamano="sm"
            className="px-2"
            disabled={deshabilitada || registro.propuesto === null}
            title={registro.propuesto === null ? "No hay propuesta que aceptar" : "Aceptar la propuesta tal cual"}
            aria-label={`Aceptar la propuesta: ${etiqueta}`}
            onClick={() => void onDecidir({ origen: "propuesta" })}
          >
            ✓
          </Button>
        ) : (
          <>
            <span className="text-exito" title={`Decidido (${registro.origen === "manual" ? "cifra escrita" : "propuesta aceptada"})`} aria-label="Decidido">
              ✓
            </span>
            <Button variante="fantasma" tamano="sm" className="px-2" disabled={deshabilitada} title="Volver a la propuesta" aria-label={`Volver a la propuesta: ${etiqueta}`} onClick={() => void onDecidir({ decidido: null, origen: "manual" })}>
              ↺
            </Button>
          </>
        )}
        {registro.nota && (
          <span className="rounded bg-neutro-suave px-1 font-mono text-xs text-tinta-suave" title={registro.nota}>
            n
          </span>
        )}
        {cambio && (
          <span className="text-alerta" title={cambio} aria-label={cambio}>
            ▲
          </span>
        )}
      </div>
      {motivo && <span className="max-w-48 text-right text-xs text-alerta">{motivo}</span>}
    </div>
  );
}

/**
 * Crecimiento por fila (solo alimenta la propuesta del año siguiente): vacío = el de la proyección. Enter guarda el
 * porcentaje; vaciarlo y Enter vuelve al de la proyección.
 */
export function CeldaCrecimiento({
  registro,
  porDefecto,
  bloqueada,
  ocupado,
  onDecidir,
  etiqueta,
}: {
  registro: AnioFilaApi | undefined;
  porDefecto: number;
  bloqueada: boolean;
  ocupado: boolean;
  onDecidir: (d: DecisionFila) => Promise<boolean>;
  etiqueta: string;
}) {
  const [texto, setTexto] = useState(registro?.crecimiento_pct === null || registro?.crecimiento_pct === undefined ? "" : String(registro.crecimiento_pct));
  const [motivo, setMotivo] = useState<string | null>(null);
  if (!registro) return <span className="text-tinta-suave">—</span>;

  async function enviar() {
    if (!registro) return;
    if (texto.trim() === "") {
      setMotivo(null);
      if (registro.crecimiento_pct !== null) await onDecidir({ origen: "manual", crecimiento_pct: null });
      return;
    }
    const l = leerPorcentaje(texto);
    if (!l.ok) {
      setMotivo(l.motivo);
      return;
    }
    if (registro.crecimiento_pct === l.valor) return;
    setMotivo(null);
    await onDecidir({ origen: "manual", crecimiento_pct: l.valor });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          value={texto}
          disabled={bloqueada || ocupado}
          placeholder={String(porDefecto)}
          aria-label={etiqueta}
          aria-invalid={motivo !== null}
          title={motivo ?? "Vacío = el crecimiento de la proyección"}
          onChange={(e) => {
            setTexto(e.target.value);
            setMotivo(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void enviar();
            }
          }}
          className={`h-8 w-16! text-right font-mono tabular-nums ${motivo ? "border-alerta!" : ""}`}
        />
        <span className="text-xs text-tinta-suave">%</span>
      </div>
      {motivo && <span className="max-w-40 text-right text-xs text-alerta">{motivo}</span>}
    </div>
  );
}
