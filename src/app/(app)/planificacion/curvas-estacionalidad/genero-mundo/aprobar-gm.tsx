"use client";

import { useMemo, useState } from "react";
import type { AprobarCrecimientoValidado } from "@/lib/crecimientos/esquemas";
import type { DetalleGeneroMundoApi } from "@/lib/crecimientos/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { formatearFechaHora } from "../vista";
import {
  NINGUNA,
  TEXTO_OBSOLETO,
  baseInicial,
  cuerpoAprobar,
  equivalenteNormalizado,
  errorPct,
  formatearPctPlano,
  formatearPctSigno,
  leerPct,
  motivoNotaObligatoria,
  opcionesDeBase,
  pctATexto,
  precargaDeBase,
  proximaVersion,
  textoConfirmarGM,
  tituloGM,
} from "./vista";

export const ID_NOTA_GM = "nota-crecimiento-gm";

type DetalleParaAprobar = Pick<
  DetalleGeneroMundoApi,
  "clave" | "genero" | "mundo" | "referencias" | "vigente" | "versiones" | "rebote_nino_pct" | "estado" | "motivo_obsoleto" | "huella_datos"
>;

/**
 * «Aprobar {año}» (06d, §4.1 punto 3), solo para HOMBRE, MUJER y el Resto: el selector «Base» precarga el % con el
 * equivalente de la referencia (a 1 decimal), el campo «% bruto» se puede corregir, la nota es obligatoria cuando el % se
 * aparta más de 0,5 puntos de la base (o no hay base) y el botón «Aprobar vN» pide confirmación. Los errores del servidor
 * los muestra quien lo usa (`error`). Quien lo monta lo vuelve a montar (`key`) cuando cambia la versión o los datos.
 */
export function AprobarGM({
  detalle,
  anio,
  proyeccionId,
  enTrabajo,
  ocupado,
  bloqueo,
  error,
  onCerrarError,
  onAprobar,
}: {
  detalle: DetalleParaAprobar;
  anio: number;
  proyeccionId: string | null;
  /** Proyecciones en trabajo de `anio − 1` (las que quedarán desactualizadas); `null` si aún no se conocen. */
  enTrabajo: { id: string; nombre: string }[] | null;
  ocupado: boolean;
  /** Por qué no se puede aprobar todavía (se muestra y deshabilita el botón). */
  bloqueo?: string | null;
  error: string | null;
  onCerrarError: () => void;
  onAprobar: (cuerpo: AprobarCrecimientoValidado) => void | Promise<void>;
}) {
  const opciones = useMemo(() => opcionesDeBase(detalle.referencias), [detalle.referencias]);
  const [baseId, setBaseId] = useState<string>(() => baseInicial(detalle.referencias));
  const base = opciones.find((o) => o.id === baseId) ?? null;
  const [pctTexto, setPctTexto] = useState<string>(() => pctATexto(precargaDeBase(opciones.find((o) => o.id === baseInicial(detalle.referencias))?.valor ?? null)));
  const [nota, setNota] = useState("");

  const pct = leerPct(pctTexto);
  const errorDelPct = errorPct(pctTexto);
  const valorBase = base?.valor ?? null;
  const motivoNota = motivoNotaObligatoria({ pct, tipoBase: base ? base.tipo : NINGUNA, valorBase });
  const notaFalta = motivoNota !== null && nota.trim() === "";
  const normalizado = equivalenteNormalizado(pct, detalle.rebote_nino_pct);
  const version = proximaVersion(detalle.versiones);
  const vigente = detalle.vigente;
  const titulo = tituloGM(detalle);
  const motivoNoPuede = bloqueo ?? errorDelPct ?? (notaFalta ? "Escribe la nota: es obligatoria con este % y esta base." : null);

  function elegirBase(id: string) {
    setBaseId(id);
    if (id === NINGUNA) return;
    const precarga = precargaDeBase(opciones.find((o) => o.id === id)?.valor ?? null);
    if (precarga !== null) setPctTexto(pctATexto(precarga));
  }

  async function aprobar() {
    if (motivoNoPuede || pct === null) return;
    const cuerpo = cuerpoAprobar({
      anio,
      pct,
      nota,
      base,
      proyeccionId,
      huella: detalle.huella_datos,
      versionVigente: vigente?.version ?? null,
    });
    if (!confirm(textoConfirmarGM({ titulo, anio, version, pct, base, vigente, desactualizadas: enTrabajo }))) return;
    await onAprobar(cuerpo);
  }

  return (
    <Card titulo={`Aprobar ${anio}`} descripcion={`El crecimiento bruto de ${anio} frente a ${anio - 1} de las mismas tiendas, para ${titulo}. Todas las filas de este género × mundo crecen igual.`}>
      <div className="space-y-4">
        <div className="space-y-1 text-sm">
          {vigente ? (
            <p className="flex flex-wrap items-center gap-2 text-tinta">
              <span>
                Vigente: <strong>v{vigente.version}</strong> · {formatearPctPlano(vigente.pct)}
              </span>
              <span className="text-xs text-tinta-suave" title={`Aprobada el ${formatearFechaHora(vigente.aprobada_at)}`}>
                {vigente.por_nombre ?? "—"} · {formatearFechaHora(vigente.aprobada_at)}
              </span>
              {detalle.estado === "obsoleto" && <Badge tono="alerta">Obsoleto</Badge>}
            </p>
          ) : (
            <p className="text-tinta-suave">Todavía no hay un crecimiento aprobado: esta será la v1.</p>
          )}
          {detalle.estado === "obsoleto" && detalle.motivo_obsoleto && (
            <p className="text-xs text-alerta">Obsoleto: {TEXTO_OBSOLETO[detalle.motivo_obsoleto]}. Sigue valiendo hasta que apruebes otro; las proyecciones no cambian solas.</p>
          )}
        </div>

        <div className="grid items-start gap-3 md:grid-cols-3">
          <Field label="Base" hint="Elegir una base precarga el % con su equivalente para el año siguiente.">
            <Select value={baseId} onChange={(e) => elegirBase(e.target.value)} disabled={ocupado}>
              {opciones.map((o) => (
                <option key={o.id} value={o.id} disabled={o.valor === null}>
                  {o.etiqueta}
                  {o.valor !== null ? ` (${formatearPctSigno(o.valor)})` : ` — ${o.motivo ?? "no disponible"}`}
                </option>
              ))}
              <option value={NINGUNA}>Ninguna (escribo el % directamente)</option>
            </Select>
          </Field>
          <Field
            label={`% bruto ${anio}`}
            hint={normalizado === null ? "Sin rebote del Niño no hay equivalente sobre la base normalizada." : `Equivale a ${formatearPctSigno(normalizado)} sobre la base normalizada por el Niño.`}
          >
            <Input inputMode="decimal" value={pctTexto} onChange={(e) => setPctTexto(e.target.value)} disabled={ocupado} aria-invalid={errorDelPct !== null && pctTexto !== ""} />
          </Field>
          <div>
            <label htmlFor={ID_NOTA_GM} className="mb-1 block text-sm font-medium text-tinta">
              Nota {motivoNota ? <span className="text-alerta">(obligatoria)</span> : <span className="font-normal text-tinta-suave">(opcional)</span>}
            </label>
            <Input id={ID_NOTA_GM} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} disabled={ocupado} placeholder="Por qué este %" aria-describedby={`${ID_NOTA_GM}-ayuda`} />
            <span id={`${ID_NOTA_GM}-ayuda`} className={`mt-1 block text-xs ${motivoNota ? "text-alerta" : "text-tinta-suave"}`}>
              {motivoNota ?? "Con el % igual a la base (±0,5 puntos) no hace falta nota."} {nota.length}/300
            </span>
          </div>
        </div>

        {error && (
          <Alert onCerrar={onCerrarError}>
            {error}
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void aprobar()} disabled={ocupado || motivoNoPuede !== null} title={motivoNoPuede ?? `Aprobar la v${version} de ${titulo} para ${anio}`}>
            {ocupado ? "Aprobando…" : `Aprobar v${version}`}
          </Button>
          {motivoNoPuede && <p className="text-xs text-tinta-suave">{motivoNoPuede}</p>}
        </div>
        <p className="text-xs text-tinta-suave">
          Al aprobar, las proyecciones en trabajo de {anio - 1} quedan «desactualizadas» y hay que recalcularlas; no se recalcula nada solo ni se cambia lo que ya decidiste. La versión
          anterior queda en el historial.
        </p>
      </div>
    </Card>
  );
}
