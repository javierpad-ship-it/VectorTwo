"use client";

import { useId } from "react";
import { plural } from "@/lib/formato";
import { Field, Input, Select } from "@/components/ui/form";
import { ETIQUETA_ALCANCE } from "@/lib/curvas/tipos-api";
import type { AgrupacionConTemporada, AlcancePeriodo } from "./tipos";
import { contarMeses, mesesSinCargar, resumirMeses, validarRango } from "./meses";

export type ValoresPeriodo = {
  desde: string;
  hasta: string;
  motivo: string;
  descripcion: string;
  alcance: AlcancePeriodo;
};

export const PERIODO_VACIO: ValoresPeriodo = { desde: "", hasta: "", motivo: "", descripcion: "", alcance: "invierno" };

export const MAX_MOTIVO = 120;
export const MAX_DESCRIPCION = 500;

/** Por qué el formulario no se puede enviar todavía (`null` si está listo). */
export function motivoNoEnviable(v: ValoresPeriodo): string | null {
  if (v.motivo.trim() === "") return "Escribe el motivo del periodo.";
  return validarRango(v.desde, v.hasta);
}

/**
 * Campos de un periodo atípico (desde, hasta, motivo, alcance, descripción) con
 * su vista previa («3 meses · afecta a 14 agrupaciones de invierno») y las
 * validaciones en pantalla. Es el mismo para el alta y para la edición en el
 * diálogo; quien lo usa pone el `<form>` y el botón.
 */
export function CamposPeriodo({
  valores,
  onCambiar,
  disabled,
  agrupaciones,
  ultimoCargado,
  idMotivo,
}: {
  valores: ValoresPeriodo;
  onCambiar: (v: ValoresPeriodo) => void;
  disabled: boolean;
  agrupaciones: AgrupacionConTemporada[];
  /** Último mes (`aaaa-mm`) con carga publicada en M5; `null` si no se sabe. */
  ultimoCargado: string | null;
  idMotivo?: string;
}) {
  const idRango = useId();
  const { desde, hasta, alcance } = valores;
  const tocado = desde !== "" || hasta !== "";
  const errorRango = tocado ? validarRango(desde, hasta) : null;
  const meses = contarMeses(desde, hasta);
  const activas = agrupaciones.filter((a) => a.activo);
  const afectadas = alcance === "invierno" ? activas.filter((a) => a.temporada === "invierno").length : activas.length;
  const sinCargar = errorRango === null ? mesesSinCargar(desde, hasta, ultimoCargado) : [];

  return (
    <>
      <Field label="Desde (mes)" hint="Primer mes incluido.">
        <Input
          type="month"
          required
          min="2000-01"
          max="2100-12"
          value={desde}
          disabled={disabled}
          onChange={(e) => onCambiar({ ...valores, desde: e.target.value })}
          aria-describedby={idRango}
          aria-invalid={errorRango !== null}
        />
      </Field>
      <Field label="Hasta (mes)" hint="Último mes incluido.">
        <Input
          type="month"
          required
          min="2000-01"
          max="2100-12"
          value={hasta}
          disabled={disabled}
          onChange={(e) => onCambiar({ ...valores, hasta: e.target.value })}
          aria-describedby={idRango}
          aria-invalid={errorRango !== null}
        />
      </Field>
      <Field label="Motivo" hint={`${valores.motivo.length}/${MAX_MOTIVO}. Etiqueta corta, p. ej. «Niño costero 2023».`} className="md:col-span-2">
        <Input
          id={idMotivo}
          required
          maxLength={MAX_MOTIVO}
          value={valores.motivo}
          disabled={disabled}
          onChange={(e) => onCambiar({ ...valores, motivo: e.target.value })}
        />
      </Field>
      <Field label="Alcance" hint="Invierno ajusta solo a las agrupaciones marcadas como de invierno." className="md:col-span-2">
        <Select value={alcance} disabled={disabled} onChange={(e) => onCambiar({ ...valores, alcance: e.target.value === "todas" ? "todas" : "invierno" })}>
          <option value="invierno">{ETIQUETA_ALCANCE.invierno}</option>
          <option value="todas">{ETIQUETA_ALCANCE.todas}</option>
        </Select>
      </Field>
      <Field label="Descripción" hint={`${valores.descripcion.length}/${MAX_DESCRIPCION}. Opcional.`} className="md:col-span-2">
        <Input
          maxLength={MAX_DESCRIPCION}
          value={valores.descripcion}
          disabled={disabled}
          onChange={(e) => onCambiar({ ...valores, descripcion: e.target.value })}
          placeholder="Qué pasó y de dónde salen los meses"
        />
      </Field>
      <div id={idRango} aria-live="polite" className="space-y-1 text-sm md:col-span-4">
        {errorRango ? (
          <p className="text-alerta">{errorRango}</p>
        ) : meses !== null ? (
          <p className="text-tinta-suave">
            {plural(meses, "mes", "meses")} · afecta a{" "}
            {alcance === "invierno"
              ? plural(afectadas, "agrupación de invierno", "agrupaciones de invierno")
              : plural(afectadas, "agrupación activa", "agrupaciones activas")}
            {alcance === "invierno" && afectadas === 0 && ". Marca la temporada de las agrupaciones en la pestaña Curvas para que alcance a alguna"}.
          </p>
        ) : null}
        {sinCargar.length > 0 && (
          <p className="text-alerta">
            {resumirMeses(sinCargar)} todavía {sinCargar.length === 1 ? "no está cargado" : "no están cargados"} en M5: el periodo aplicará cuando{" "}
            {sinCargar.length === 1 ? "lo esté" : "lo estén"}.
          </p>
        )}
      </div>
    </>
  );
}
