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
  errorPct,
  formatearPctPlano,
  formatearPctSigno,
  hayNino,
  idOpcionBase,
  leerPct,
  motivoNotaObligatoria,
  opcionesDeBase,
  pctATexto,
  periodoTocaNino,
  precargaDeBase,
  proximaVersion,
  resumenAprobacion,
  sobreBaseDe,
  textoAlertaReaprobar,
  textoConfirmarGM,
  textoConfirmarReaprobar,
  textoEquivalenteVivo,
  textoSobreBase,
  tituloGM,
  type OpcionBase,
} from "./vista";

export const ID_NOTA_GM = "nota-crecimiento-gm";

type DetalleParaAprobar = Pick<
  DetalleGeneroMundoApi,
  "clave" | "genero" | "mundo" | "referencias" | "vigente" | "versiones" | "estado" | "motivo_obsoleto" | "huella_datos" | "acumulado" | "bandas_nino" | "base_siguiente"
> &
  Partial<Pick<DetalleGeneroMundoApi, "cierre" | "hay_nino" | "base_corregida" | "reaprobar" | "factores_y" | "correccion_nino_pct">>;

/**
 * «Aprobar {año}» (06e §4.1 punto 5), solo para HOMBRE, MUJER y el Resto: el selector «Base» (por defecto «Cierre por curva · corregido», o
 * «Año completo · corregido» con avance bajo) precarga el % con dos decimales; el campo es «% 2027 sobre 2026 corregido» y, al lado, en
 * vivo, lo que significa sobre 2026 real y en unidades con las tiendas de 2027. La nota es obligatoria cuando el % se aparta más de 0,5
 * puntos de la base (o no hay base, o se elige la variante «real» en un GM con Niño). «Aprobar vN» y «Reaprobar» piden confirmación. Los
 * errores del servidor los muestra quien lo usa (`error`). Quien lo monta lo vuelve a montar (`key`) cuando cambia la versión o los datos.
 * El % puede vivir fuera (`pctTexto`/`onPctTexto`) para mover la vista previa del gráfico.
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
  pctTexto: pctControlado,
  onPctTexto,
}: {
  detalle: DetalleParaAprobar;
  anio: number;
  proyeccionId: string | null;
  /** Proyecciones en trabajo de `anio − 1` (las que quedarán desactualizadas); `null` si aún no se conocen. */
  enTrabajo: { id: string; nombre: string }[] | null;
  ocupado: boolean;
  /** Por qué no se puede aprobar todavía (se muestra y deshabilita el botón): referencia cargando o `anio_siguiente_atipico`. */
  bloqueo?: string | null;
  error: string | null;
  onCerrarError: () => void;
  onAprobar: (cuerpo: AprobarCrecimientoValidado) => void | Promise<void>;
  pctTexto?: string;
  onPctTexto?: (texto: string) => void;
}) {
  const y = anio - 1;
  const opciones = useMemo(() => opcionesDeBase(detalle.referencias), [detalle.referencias]);
  const avanceBajo = detalle.cierre?.avance_bajo ?? false;
  const [baseId, setBaseId] = useState<string>(() => baseInicial(detalle.referencias, avanceBajo));
  const base = opciones.find((o) => o.id === baseId) ?? null;
  const [pctInterno, setPctInterno] = useState<string>(() => pctATexto(precargaDeBase(opciones.find((o) => o.id === baseInicial(detalle.referencias, avanceBajo))?.valor ?? null)));
  const pctTexto = pctControlado ?? pctInterno;
  const [nota, setNota] = useState("");

  function escribirPct(texto: string) {
    setPctInterno(texto);
    onPctTexto?.(texto);
  }

  const pct = leerPct(pctTexto);
  const errorDelPct = errorPct(pctTexto);
  const valorBase = base?.valor ?? null;
  const conNino = hayNino(detalle);
  const motivoNota = motivoNotaObligatoria({
    pct,
    tipoBase: base ? base.tipo : NINGUNA,
    valorBase,
    variante: base?.variante,
    hayNino: conNino,
    periodoTocaNino: base ? periodoTocaNino(base.anioReferencia, detalle.bandas_nino) : false,
  });
  const notaFalta = motivoNota !== null && nota.trim() === "";
  const resumen = resumenAprobacion(detalle, pct);
  const version = proximaVersion(detalle.versiones);
  const vigente = detalle.vigente;
  const titulo = tituloGM(detalle);
  const motivoNoPuede = bloqueo ?? errorDelPct ?? (notaFalta ? "Escribe la nota: es obligatoria con este % y esta base." : null);
  const esBruta = vigente !== null && sobreBaseDe(vigente) === "bruta";
  const reaprobar = detalle.reaprobar ?? null;
  const pidePorReaprobar = esBruta && conNino;

  function elegirBase(id: string) {
    setBaseId(id);
    if (id === NINGUNA) return;
    const precarga = precargaDeBase(opciones.find((o) => o.id === id)?.valor ?? null);
    if (precarga !== null) escribirPct(pctATexto(precarga));
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
    if (!confirm(textoConfirmarGM({ titulo, anio, version, pct, base, vigente, desactualizadas: enTrabajo, resumen, hayNino: conNino }))) return;
    await onAprobar(cuerpo);
  }

  /** Un clic: precarga «Aplicado hoy · corregido» con el equivalente a dos decimales, pide confirmación con el impacto y aprueba. */
  async function reaprobarYa() {
    if (!reaprobar || bloqueo) return;
    const id = idOpcionBase("aplicado_hoy", null, "corregido");
    const existente = opciones.find((o) => o.id === id) ?? null;
    const opcion: OpcionBase = existente ?? { id, tipo: "aplicado_hoy", anio: null, variante: "corregido", etiqueta: "Aplicado hoy · corregido", valor: reaprobar.pct_equivalente, motivo: null, anioReferencia: y };
    setBaseId(existente ? id : NINGUNA);
    escribirPct(pctATexto(reaprobar.pct_equivalente));
    const cuerpo = cuerpoAprobar({
      anio,
      pct: reaprobar.pct_equivalente,
      nota: "",
      base: opcion,
      proyeccionId,
      huella: detalle.huella_datos,
      versionVigente: vigente?.version ?? null,
    });
    if (!confirm(textoConfirmarReaprobar({ titulo, anio, version, r: reaprobar }))) return;
    await onAprobar(cuerpo);
  }

  return (
    <Card titulo={`Aprobar ${anio}`} descripcion={`El crecimiento de ${anio} sobre la venta de ${y} corregida del Niño de las tiendas que tendrá ${anio}, para ${titulo}. Todas las filas de este género × mundo crecen igual.`}>
      <div className="space-y-4">
        <div className="space-y-1 text-sm">
          {vigente ? (
            <p className="flex flex-wrap items-center gap-2 text-tinta">
              <span>
                Vigente: <strong>v{vigente.version}</strong> · {formatearPctPlano(vigente.pct, 2)} {textoSobreBase(vigente, y)}
              </span>
              <span className="text-xs text-tinta-suave" title={`Aprobada el ${formatearFechaHora(vigente.aprobada_at)}`}>
                {vigente.por_nombre ?? "—"} · {formatearFechaHora(vigente.aprobada_at)}
              </span>
              {esBruta && <Badge tono="neutro">bruto · antes de 0.14.0</Badge>}
              {pidePorReaprobar && <Badge tono="alerta">reaprobar</Badge>}
              {detalle.estado === "obsoleto" && <Badge tono="alerta">Obsoleto</Badge>}
            </p>
          ) : (
            <p className="text-tinta-suave">Todavía no hay un crecimiento aprobado: esta será la v1.</p>
          )}
          {detalle.estado === "obsoleto" && detalle.motivo_obsoleto && (
            <p className="text-xs text-alerta">Obsoleto: {TEXTO_OBSOLETO[detalle.motivo_obsoleto]}. Sigue valiendo hasta que apruebes otro; las proyecciones no cambian solas.</p>
          )}
        </div>

        {vigente && pidePorReaprobar && (
          <Alert tono="info">
            <span className="block">{textoAlertaReaprobar(vigente, reaprobar ?? undefined, y, detalle.factores_y ?? [])}</span>
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                tamano="sm"
                variante="secundario"
                onClick={() => void reaprobarYa()}
                className="h-auto! min-h-8 whitespace-normal py-1 text-left"
                disabled={ocupado || !reaprobar || Boolean(bloqueo)}
                title={!reaprobar ? "Sin filas de la proyección no se puede medir el equivalente" : (bloqueo ?? "Aprueba una versión nueva con el equivalente sobre corregido")}
              >
                {reaprobar ? "Reaprobar" : "Recalcula la proyección con 0.14.0 para reaprobar"}
              </Button>
            </span>
          </Alert>
        )}

        <div className="grid items-start gap-3 md:grid-cols-3">
          <Field label="Base" hint="Elegir una base precarga el % con su equivalente sobre corregido (o el % real si eliges la variante «real»).">
            <Select value={baseId} onChange={(e) => elegirBase(e.target.value)} disabled={ocupado}>
              {opciones.map((o) => (
                <option key={o.id} value={o.id} disabled={o.valor === null}>
                  {o.etiqueta}
                  {o.valor !== null ? ` (${formatearPctSigno(o.valor, 2)})` : ` — ${o.motivo ?? "no disponible"}`}
                </option>
              ))}
              <option value={NINGUNA}>Ninguna (escribo el % directamente)</option>
            </Select>
          </Field>
          <Field label={`% ${anio} sobre ${y} corregido`} hint={textoEquivalenteVivo({ anioY: y, anio, pct, resumen, hayNino: conNino })}>
            <Input inputMode="decimal" value={pctTexto} onChange={(e) => escribirPct(e.target.value)} disabled={ocupado} aria-invalid={errorDelPct !== null && pctTexto !== ""} />
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

        {error && <Alert onCerrar={onCerrarError}>{error}</Alert>}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void aprobar()} disabled={ocupado || motivoNoPuede !== null} title={motivoNoPuede ?? `Aprobar la v${version} de ${titulo} para ${anio}`}>
            {ocupado ? "Aprobando…" : `Aprobar v${version}`}
          </Button>
          {motivoNoPuede && <p className="text-xs text-tinta-suave">{motivoNoPuede}</p>}
        </div>
        <p className="text-xs text-tinta-suave">
          Al aprobar, las proyecciones en trabajo de {y} quedan «desactualizadas» y hay que recalcularlas; no se recalcula nada solo ni se cambia lo que ya decidiste. La versión anterior queda
          en el historial.
        </p>
      </div>
    </Card>
  );
}
