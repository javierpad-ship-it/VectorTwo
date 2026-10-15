"use client";

import { useId } from "react";
import { plural } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ETIQUETA_TEMPORADA, TEMPORADAS_AGRUPACION, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import type { AgrupacionConTemporada } from "./tipos";
import {
  TODAS_LAS_TEMPORADAS,
  alternarTemporada,
  anioBase,
  atajoAnioCompleto,
  atajoDesdeSetiembre,
  atajoEnCurso,
  sonTodas,
} from "./atajos";
import { contarMeses, mesesSinCargar, resumirMeses, validarRango } from "./meses";

export type ValoresPeriodo = {
  desde: string;
  hasta: string;
  motivo: string;
  descripcion: string;
  /** Conjunto de temporadas a las que aplica (al menos una). */
  temporadas: TemporadaAgrupacion[];
};

export const PERIODO_VACIO: ValoresPeriodo = { desde: "", hasta: "", motivo: "", descripcion: "", temporadas: ["invierno"] };

/** Etiqueta de cada casilla (la de `todo_el_ano` es más larga que la del badge: dice a quién alcanza). */
const ETIQUETA_CASILLA: Record<TemporadaAgrupacion, string> = {
  invierno: "Invierno",
  verano: "Verano",
  todo_el_ano: "Agrupaciones de toda temporada",
};

export const MAX_MOTIVO = 120;
export const MAX_DESCRIPCION = 500;

/** Por qué el formulario no se puede enviar todavía (`null` si está listo). */
export function motivoNoEnviable(v: ValoresPeriodo): string | null {
  if (v.motivo.trim() === "") return "Escribe el motivo del periodo.";
  if (v.temporadas.length === 0) return "Marca al menos una temporada.";
  return validarRango(v.desde, v.hasta);
}

/**
 * Campos de un periodo atípico (desde, hasta, atajos de rango, motivo,
 * temporadas, descripción) con su vista previa («3 meses · afecta a 4
 * agrupaciones») y las validaciones en pantalla. Es el mismo para el alta y para la edición en el
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
  const { desde, hasta, temporadas } = valores;
  const tocado = desde !== "" || hasta !== "";
  const errorRango = tocado ? validarRango(desde, hasta) : null;
  const meses = contarMeses(desde, hasta);
  const activas = agrupaciones.filter((a) => a.activo);
  const afectadas = activas.filter((a) => temporadas.includes(a.temporada)).length;
  const anioHoy = new Date().getFullYear();
  const base = anioBase(desde, ultimoCargado, anioHoy);
  const sinCargar = errorRango === null ? mesesSinCargar(desde, hasta, ultimoCargado) : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 md:col-span-4" role="group" aria-label="Atajos de rango">
        <span className="text-sm font-medium text-tinta">Atajos de rango</span>
        <Button variante="secundario" tamano="sm" disabled={disabled} onClick={() => onCambiar({ ...valores, ...atajoAnioCompleto(base) })} title={`Enero a diciembre de ${base}`}>
          Año completo
        </Button>
        <Button variante="secundario" tamano="sm" disabled={disabled} onClick={() => onCambiar({ ...valores, ...atajoDesdeSetiembre(base) })} title={`Setiembre a diciembre de ${base}`}>
          Desde setiembre
        </Button>
        <Button variante="secundario" tamano="sm" disabled={disabled} onClick={() => onCambiar({ ...valores, ...atajoEnCurso(ultimoCargado, anioHoy) })} title="El año que se está cargando, enero a diciembre">
          En curso
        </Button>
        <span className="text-xs text-tinta-suave">Año {base}: se toma del mes «desde» si ya lo escribiste.</span>
      </div>
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
      <fieldset className="md:col-span-2" disabled={disabled}>
        <legend className="mb-1 block text-sm font-medium text-tinta">Temporadas afectadas</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {TEMPORADAS_AGRUPACION.map((t) => (
            <label key={t} className="inline-flex cursor-pointer items-center gap-2 text-sm text-tinta">
              <input
                type="checkbox"
                checked={temporadas.includes(t)}
                onChange={() => onCambiar({ ...valores, temporadas: alternarTemporada(temporadas, t) })}
                className="h-4 w-4 rounded border-borde accent-marca"
              />
              {ETIQUETA_CASILLA[t]}
            </label>
          ))}
          <Button
            variante="fantasma"
            tamano="sm"
            className="h-7! px-2!"
            aria-pressed={sonTodas(temporadas)}
            onClick={() => onCambiar({ ...valores, temporadas: [...TODAS_LAS_TEMPORADAS] })}
            title="Marca las tres temporadas"
          >
            Todas
          </Button>
        </div>
        <span className="mt-1 block text-xs text-tinta-suave">
          Un periodo afecta a las agrupaciones cuya temporada esté marcada. Hay que dejar al menos una.
        </span>
      </fieldset>
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
            {plural(meses, "mes", "meses")} ·{" "}
            {temporadas.length === 0 ? (
              "marca al menos una temporada"
            ) : (
              <>
                afecta a {plural(afectadas, "agrupación activa", "agrupaciones activas")} (
                {temporadas.map((t) => ETIQUETA_TEMPORADA[t].toLowerCase()).join(" + ")})
                {afectadas === 0 && ". Marca la temporada de las agrupaciones en la pestaña Curvas para que alcance a alguna"}
              </>
            )}
            .
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
