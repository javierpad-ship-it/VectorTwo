"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatearDecimal } from "@/lib/formato";
import type { ParametrosCurvas, TrabajoAgrupacionApi, TratamientoAtipicos } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import {
  OPCIONES_TRATAMIENTO,
  alternarAnioExcluido,
  alternarTiendaExcluida,
  mesesParaHasta,
  parametrosDistintos,
  sonParametrosPorDefecto,
} from "./trabajo-vista";
import { formatearPct, formatearPp, redVistaDeAgrupacion, textoAnio, textoMotivoRed } from "./vista";

function Casilla({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className="inline-flex items-start gap-2 text-sm text-tinta">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-borde accent-marca disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Panel «Parámetros de esta agrupación» (primera entrega): años (con su clase y la casilla
 * «Excluir del ajuste»), tratamiento del Niño, tiendas de la red con «Excluir», y «Calcular
 * hasta» (arranca SIEMPRE en el defecto: no se hereda de la vigente). Los umbrales se muestran
 * con su valor y su edición llega en la segunda entrega. Cada cambio recalcula (300 ms, lo
 * resuelve el hook). Excluir un año o una tienda, o fijar un tratamiento distinto de `auto`,
 * exige escribir el motivo en «Nota / motivo» antes de aprobar.
 */
export function ParametrosAgrupacion({
  datos,
  parametros,
  hasta,
  deshabilitado,
  onCambiar,
  onCambiarHasta,
  onRestablecer,
}: {
  datos: TrabajoAgrupacionApi;
  parametros: ParametrosCurvas;
  hasta: string;
  deshabilitado: boolean;
  onCambiar: (siguiente: (p: ParametrosCurvas) => ParametrosCurvas) => void;
  onCambiarHasta: (hasta: string) => void;
  onRestablecer: () => void;
}) {
  const calculo = datos.calculo;
  const resultado = calculo?.resultado ?? null;
  const red = useMemo(
    () => (calculo && resultado ? redVistaDeAgrupacion(calculo.red, calculo.tiendas, resultado, parametros.umbral_tienda_dominante) : null),
    [calculo, resultado, parametros.umbral_tienda_dominante]
  );
  const codigos = useMemo(() => new Map((calculo?.tiendas ?? []).map((t) => [t.id, t.codigo])), [calculo]);
  const distintos = parametrosDistintos(parametros, codigos);
  const porDefecto = sonParametrosPorDefecto(parametros) && hasta === "";
  // Plegado al abrir cuando no hay nada fuera del valor por defecto (se decide una vez: el panel se monta con los datos).
  const [abierto, setAbierto] = useState(() => parametrosDistintos(parametros).length > 0);

  const meses = useMemo(() => mesesParaHasta(datos.datos.desde, datos.datos.hasta, datos.datos.faltantes).reverse(), [datos.datos.desde, datos.datos.hasta, datos.datos.faltantes]);
  const hastaVigente = datos.vigente?.hasta_periodo ?? null;

  // Las tiendas que se pueden excluir: las que aparecen en la red de algún año, sin los centros de distribución.
  const tiendas = (red?.tiendas ?? []).filter((t) => red?.anios.some((a) => !(a.tiendas.get(t.id)?.motivos.includes("centro_distribucion") ?? true)));
  const anios = [...(resultado?.anios ?? [])].sort((a, b) => a.anio - b.anio);

  return (
    <Card
      titulo="Parámetros de esta agrupación"
      descripcion="Qué años y tiendas cuentan para esta agrupación y con qué tratamiento del Niño. Cada cambio vuelve a calcular."
      acciones={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {distintos.length > 0 ? (
            <span title={distintos.join("\n")}>
              <Badge tono="alerta">
                {distintos.length} {distintos.length === 1 ? "parámetro distinto" : "parámetros distintos"} del valor por defecto
              </Badge>
            </span>
          ) : (
            <Badge tono="neutro">Valores por defecto</Badge>
          )}
          <Button variante="secundario" tamano="sm" onClick={onRestablecer} disabled={deshabilitado || porDefecto} title="Vuelve a los valores por defecto y a «Calcular hasta» en el último mes cerrado">
            Restablecer
          </Button>
          <Button variante="fantasma" tamano="sm" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
            {abierto ? "Plegar" : "Desplegar"}
          </Button>
        </div>
      }
    >
      {!abierto ? (
        <p className="text-sm text-tinta-suave">
          {distintos.length > 0 ? `Distintos del valor por defecto: ${distintos.join(" · ")}.` : "Todo en su valor por defecto."} Desplegar para cambiar años, tratamiento del Niño, tiendas o «Calcular hasta».
        </p>
      ) : (
        <div className="space-y-5">
          <fieldset className="space-y-2" disabled={deshabilitado}>
            <legend className="text-sm font-semibold text-tinta">Años</legend>
            {anios.length === 0 ? (
              <p className="text-sm text-tinta-suave">Los años aparecen cuando se pueda calcular.</p>
            ) : (
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {anios.map((a) => {
                  const excluido = parametros.anios_excluidos.includes(a.anio);
                  const soloValida = a.clase === "en_curso";
                  return (
                    <li key={a.anio}>
                      <Casilla checked={excluido} disabled={soloValida} onChange={(v) => onCambiar((p) => alternarAnioExcluido(p, a.anio, v))}>
                        <span className="font-medium">{textoAnio(a)}</span>
                        <span className="block text-xs text-tinta-suave">{soloValida ? "solo valida: el año en curso no entra al ajuste" : excluido ? "Excluido del ajuste a mano" : "Excluir del ajuste"}</span>
                      </Casilla>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          <div className="space-y-1">
            <label className="block max-w-sm">
              <span className="mb-1 block text-sm font-semibold text-tinta">Tratamiento del Niño</span>
              <Select
                value={parametros.tratamiento_atipicos}
                disabled={deshabilitado}
                onChange={(e) => {
                  const v = e.target.value as TratamientoAtipicos;
                  onCambiar((p) => ({ ...p, tratamiento_atipicos: v }));
                }}
              >
                {OPCIONES_TRATAMIENTO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </Select>
            </label>
            <p className="text-xs text-tinta-suave">{OPCIONES_TRATAMIENTO.find((o) => o.valor === parametros.tratamiento_atipicos)?.ayuda}</p>
          </div>

          <fieldset className="space-y-2" disabled={deshabilitado}>
            <legend className="text-sm font-semibold text-tinta">Red: tiendas</legend>
            {!red || tiendas.length === 0 ? (
              <p className="text-sm text-tinta-suave">Las tiendas aparecen cuando se pueda calcular.</p>
            ) : (
              <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                {tiendas.map((t) => {
                  const excluida = parametros.tiendas_excluidas.includes(t.id);
                  return (
                    <li key={t.id}>
                      <Casilla checked={excluida} onChange={(v) => onCambiar((p) => alternarTiendaExcluida(p, t.id, v))}>
                        <span className="font-medium">
                          {t.codigo} · {t.nombre}
                        </span>
                        <span className="block text-xs text-tinta-suave">
                          {excluida ? "Excluida a mano · " : "Excluir · "}
                          {red.anios
                            .map((a) => {
                              const v = a.tiendas.get(t.id);
                              if (!v) return `${a.anio}: —`;
                              if (v.entra) return `${a.anio}: entra, ${formatearPct(v.peso)}${v.distinta ? ` (distinta, ${formatearPp(v.eatVsRed)})` : ""}`;
                              return `${a.anio}: fuera (${(textoMotivoRed(v) ?? "fuera de la red").toLowerCase()})`;
                            })
                            .join(" · ")}
                        </span>
                      </Casilla>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          <div className="space-y-1">
            <label className="block max-w-sm">
              <span className="mb-1 block text-sm font-semibold text-tinta">Calcular hasta</span>
              <Select value={hasta} disabled={deshabilitado} onChange={(e) => onCambiarHasta(e.target.value)}>
                <option value="">Último mes publicado y cerrado (por defecto)</option>
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </label>
            <p className="text-xs text-tinta-suave">
              Se calcula con los datos hasta {datos.datos.hasta_periodo ?? "—"}. Arranca siempre en el último mes cerrado{hastaVigente ? `; la vigente usó ${hastaVigente}` : ""}: no se hereda de la
              aprobación anterior.
            </p>
          </div>

          <p className="text-xs text-tinta-suave">
            <span className="font-medium text-tinta">Umbrales</span> (se leen, no se editan en esta entrega): piso de forma{" "}
            {formatearPp(parametros.umbral_forma)} · margen {formatearDecimal(parametros.margen_ruido, 2)} × ruido · tienda dominante {formatearPct(parametros.umbral_tienda_dominante, 0)} · mínimo {formatearDecimal(parametros.min_unidades_ano, 0)} u. por
            año · máximo {parametros.max_meses_hueco} meses con huecos · liquidación {formatearPct(parametros.umbral_liquidacion, 0)}. Su edición llega en la segunda entrega.
          </p>
          <p className="rounded-md bg-neutro-suave/60 px-3 py-2 text-xs text-tinta-suave">
            Excluir un año o una tienda, o fijar un tratamiento distinto de «automático», pide escribir el motivo en «Nota / motivo» antes de aprobar.
          </p>
        </div>
      )}
    </Card>
  );
}
