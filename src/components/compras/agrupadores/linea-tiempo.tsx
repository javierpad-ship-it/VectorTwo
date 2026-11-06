"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { etiquetaMes } from "@/lib/compras/agrupadores/fechas";
import {
  ETIQUETA_CAUSA_FECHA,
  ETIQUETA_HITO,
  MARCADOR_HITO,
  type EmbarqueDetalleApi,
  type EstadoHito,
  type EventoAgrupadorApi,
  type Hito,
  type HitoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { useHistorial } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { fechaHora, unidades } from "../formato";
import { cambiosDeEvento, fechaCorta, hitosDelEmbarque, textoCambios, textoEstadoCorto, textoFechaHito, textoRetraso, type CambioDeEvento } from "./vista-fechas";

type Tono = "marca" | "exito" | "alerta" | "neutro";

/** El tono de la insignia de cada estado: el color acompaña al texto, nunca lo reemplaza. */
const TONO_ESTADO: Record<EstadoHito, Tono> = {
  real: "exito",
  sin_registrar: "neutro",
  vencido: "alerta",
  por_confirmar: "marca",
  previsto: "marca",
  pendiente: "neutro",
  no_aplica: "neutro",
};

/** El marcador del hito (punto o ícono de color, decorativo): siempre va con el nombre y el estado en texto. */
export function MarcadorHito({ hito }: { hito: Hito }) {
  return (
    <span aria-hidden="true" className="inline-block w-5 shrink-0 text-center leading-none">
      {MARCADOR_HITO[hito]}
    </span>
  );
}

/** Estado de un hito en una insignia con texto («Vencido (hace 4 días)», «Ocurrió ✓», «Previsto»…). */
export function EstadoHitoBadge({ hito, hoy }: { hito: Pick<HitoApi, "estado" | "fecha">; hoy: string }) {
  return <Badge tono={TONO_ESTADO[hito.estado]}>{textoEstadoCorto(hito, hoy)}</Badge>;
}

/** Un hito en una fila: marcador, nombre, fecha (con hora si la tiene), estado en texto y, si cambió, retraso y número de cambios. */
export function FilaHito({ h, hoy, notas = [] }: { h: HitoApi; hoy: string; notas?: string[] }) {
  const vence = h.estado === "vencido";
  return (
    <li className={`rounded-md border px-3 py-2 ${vence ? "border-alerta bg-alerta-suave/40" : "border-borde bg-superficie"}`} data-hito={h.hito} data-estado={h.estado}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <MarcadorHito hito={h.hito} />
        <span className="font-medium">{ETIQUETA_HITO[h.hito]}</span>
        <span className="text-sm tabular-nums">{h.estado === "no_aplica" ? "—" : textoFechaHito(h.fecha, h.hora)}</span>
        <EstadoHitoBadge hito={h} hoy={hoy} />
      </div>
      {(notas.length > 0 || h.retraso_dias !== null || h.reprogramaciones > 0 || (h.fecha_original !== null && h.fecha_original !== h.fecha)) && (
        <p className="mt-1 break-words pl-7 text-xs text-tinta-suave">
          {notas.map((n, i) => (
            <span key={n}>
              {i > 0 && " · "}
              {n}
            </span>
          ))}
          {h.retraso_dias !== null && (
            <>
              {notas.length > 0 && " · "}
              <strong className={h.retraso_dias > 0 ? "text-alerta" : "text-tinta"}>{textoRetraso(h.retraso_dias)}</strong> contra lo planeado
              {h.fecha_original !== null && ` (era ${fechaCorta(h.fecha_original, hoy)})`}
            </>
          )}
          {h.reprogramaciones > 0 && (
            <>
              {(notas.length > 0 || h.retraso_dias !== null) && " · "}
              {textoCambios(h.reprogramaciones)}
            </>
          )}
        </p>
      )}
    </li>
  );
}

const notasDe = (h: HitoApi, e: EmbarqueDetalleApi): string[] => {
  const notas: string[] = [];
  if (h.hito === "ingreso_stock") {
    if (h.igual_a_ingreso_cd) notas.push("igual al Ingreso CD");
    else if (h.estado !== "no_aplica") notas.push("fijado");
    notas.push(`manda el mes (${etiquetaMes(e.periodo_llegada)})`);
  }
  if (h.hito === "arribo" && h.estado === "no_aplica") notas.push("embarque local, sin puerto");
  return notas;
};

/** «Órdenes de compra: 06-jul a 20-jul · 5 compras», del rango de `fecha_compra` de las compras del embarque. */
function resumenOrdenes(e: EmbarqueDetalleApi, hoy: string): string | null {
  const compras = new Map<string, string>();
  for (const a of e.asignaciones) compras.set(a.compra.id, a.compra.fecha_compra);
  if (compras.size === 0) return null;
  const fechas = [...compras.values()].sort();
  const rango = fechas[0] === fechas[fechas.length - 1] ? fechaCorta(fechas[0], hoy) : `${fechaCorta(fechas[0], hoy)} a ${fechaCorta(fechas[fechas.length - 1], hoy)}`;
  return `Órdenes de compra: ${rango} · ${plural(compras.size, "compra", "compras")}`;
}

/**
 * Línea de tiempo del embarque (ficha 08b-1b §4.4): los cinco hitos logísticos en vertical (también en escritorio), con la marca de «hoy»,
 * el estado en texto, el retraso contra lo planeado al crear y el número de cambios; debajo del Ingreso al stock, los paquetes con ingreso
 * propio; y el historial por hito, que se lee solo cuando se abre.
 */
export function LineaTiempoEmbarque({ embarque, hoy }: { embarque: EmbarqueDetalleApi; hoy: string }) {
  const hitos = hitosDelEmbarque(embarque, hoy);
  const ordenes = resumenOrdenes(embarque, hoy);
  const conIngresoPropio = embarque.paquetes.filter((p) => p.estado === "abierto" && p.ingreso_propio === true && (p.fecha_ingreso ?? null) !== null);
  // La marca de «hoy» va antes del primer hito con fecha posterior (o al final si todos son de hoy o anteriores).
  const iHoy = hitos.findIndex((h) => h.fecha !== null && h.estado !== "no_aplica" && h.fecha > hoy);
  const posicionHoy = iHoy === -1 ? hitos.length : iHoy;

  if (hitos.length === 0) return <p className="text-sm text-tinta-suave">Este embarque todavía no trae su línea de tiempo.</p>;

  const marcaHoy = (
    <li key="hoy" className="flex items-center gap-2 px-1 text-xs font-medium text-marca-oscura" aria-label={`Hoy es ${textoFechaHito(hoy)}`}>
      <span aria-hidden="true" className="h-px flex-1 bg-marca/40" />
      <span>Hoy · {textoFechaHito(hoy)}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-marca/40" />
    </li>
  );

  return (
    <div className="space-y-3">
      {ordenes && <p className="text-sm text-tinta-suave">{ordenes}</p>}
      <ol className="space-y-2" aria-label="Línea de tiempo del embarque">
        {hitos.flatMap((h, i) => {
          const filas = [<FilaHito key={h.hito} h={h} hoy={hoy} notas={notasDe(h, embarque)} />];
          if (h.hito === "ingreso_stock" && conIngresoPropio.length > 0) {
            filas.push(
              <li key="paquetes" className="ml-6 rounded-md border border-dashed border-borde px-3 py-2 text-sm">
                <p className="text-xs font-medium text-tinta-suave">Paquetes con ingreso propio</p>
                <ul className="mt-1 space-y-1">
                  {conIngresoPropio.map((p) => (
                    <li key={p.id} className="break-words">
                      <strong>{p.nombre}</strong> → {textoFechaHito(p.fecha_ingreso ?? null)}
                      {p.periodo_ingreso && p.periodo_ingreso.slice(0, 7) !== embarque.periodo_llegada.slice(0, 7) && <> ({etiquetaMes(embarque.periodo_llegada)} → {etiquetaMes(p.periodo_ingreso)})</>}
                      {" · "}
                      {unidades(p.totales.unidades)} u de {plural(p.lotes_al_barrer ?? 0, "lote al barrer", "lotes al barrer")}
                      {p.ajustado_desde && <span className="block text-xs text-alerta">Ajustado a la llegada del embarque (antes: {fechaCorta(p.ajustado_desde, hoy)}).</span>}
                    </li>
                  ))}
                </ul>
              </li>,
            );
          }
          return i === posicionHoy ? [marcaHoy, ...filas] : filas;
        })}
        {posicionHoy === hitos.length && marcaHoy}
      </ol>
      {embarque.reprogramaciones_total !== undefined && embarque.reprogramaciones_total > 0 && (
        <p className="text-xs text-tinta-suave">
          Reprogramado ×{embarque.reprogramaciones_total}
          <span className="sr-only"> veces</span>. Las correcciones y la programación del ingreso no cuentan como atraso.
        </p>
      )}
      <HistorialPorHito embarqueId={embarque.id} hitos={hitos} hoy={hoy} />
    </div>
  );
}

// ─── Historial por hito ───

type Entrada = { ev: EventoAgrupadorApi; cambio: CambioDeEvento };

const ORDEN_HISTORIAL: readonly CambioDeEvento["hito"][] = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock", "ingreso_paquete", "hito_confirmado"];
const TITULO_GRUPO = (h: CambioDeEvento["hito"]): string => (h === "ingreso_paquete" ? "Ingreso de paquetes" : h === "hito_confirmado" ? "Marcado como ocurrido" : ETIQUETA_HITO[h]);

/** El texto de un cambio de un hito: «15-nov → 03-dic». */
function textoPar(c: CambioDeEvento, hoy: string): string {
  const hora = (v: string | null) => (v === null ? "—" : c.hito === "inicio_operativo" ? `${fechaCorta(v.slice(0, 10), hoy)}${v.length > 10 ? ` ${v.slice(11, 16)}` : ""}` : fechaCorta(v, hoy));
  if (c.hito === "hito_confirmado") {
    const n: Record<string, string> = { zarpe: "zarpe", arribo: "arribo", ingreso_cd: "Ingreso CD", inicio_operativo: "inicio operativo" };
    const t = (v: string | null) => (v === null ? "ninguno" : (n[v] ?? v));
    return `${t(c.antes)} → ${t(c.despues)}`;
  }
  const despues = c.despues === null && c.hito === "ingreso_paquete" ? "hereda el del embarque" : hora(c.despues);
  return `${hora(c.antes)} → ${despues}${c.hito === "ingreso_stock" && c.sigueAlIngresoCd ? " (sigue al Ingreso CD)" : ""}`;
}

/**
 * Historial por hito (ficha 08b-1b §4.4 y §4.7): para cada hito, la fecha con que se creó y cada cambio con su causa, su motivo, quién y
 * cuándo. Sale de los eventos `cambiar_fecha` del embarque (sus fotos `antes` y `despues`), no de un cálculo aparte.
 */
function HistorialPorHito({ embarqueId, hitos, hoy }: { embarqueId: string; hitos: readonly HitoApi[]; hoy: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section className="space-y-2" aria-label="Historial por hito">
      <Button variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
        {abierto ? "Ocultar los cambios por hito" : "Ver los cambios por hito"}
      </Button>
      {abierto && <CambiosPorHito embarqueId={embarqueId} hitos={hitos} hoy={hoy} />}
    </section>
  );
}

function CambiosPorHito({ embarqueId, hitos, hoy }: { embarqueId: string; hitos: readonly HitoApi[]; hoy: string }) {
  const lectura = useHistorial({ tipo: "embarque", id: embarqueId });
  if (lectura.cargando && !lectura.datos) return <p className="py-2 text-sm text-tinta-suave">Cargando los cambios…</p>;
  if (lectura.error) return <Alert onCerrar={() => lectura.setError(null)}>{lectura.error}</Alert>;
  const entradas: Entrada[] = (lectura.datos?.eventos ?? []).flatMap((ev) => cambiosDeEvento(ev).map((cambio) => ({ ev, cambio })));
  if (entradas.length === 0) return <p className="py-2 text-sm text-tinta-suave">Ninguna fecha cambió desde que se creó el embarque.</p>;
  const originales = new Map(hitos.map((h) => [h.hito as CambioDeEvento["hito"], h.fecha_original]));
  const grupos = ORDEN_HISTORIAL.map((h) => ({ hito: h, items: entradas.filter((e) => e.cambio.hito === h).reverse() })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-3">
      {grupos.map((g) => (
        <section key={g.hito} aria-label={TITULO_GRUPO(g.hito)}>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            {g.hito !== "ingreso_paquete" && g.hito !== "hito_confirmado" && <MarcadorHito hito={g.hito} />}
            {TITULO_GRUPO(g.hito)}
          </h4>
          {originales.get(g.hito) && <p className="pl-7 text-xs text-tinta-suave">Fecha original: {fechaCorta(originales.get(g.hito) ?? null, hoy)}</p>}
          <ul className="mt-1 divide-y divide-borde rounded-md border border-borde bg-superficie">
            {g.items.map(({ ev, cambio }) => (
              <li key={`${ev.id}-${cambio.paquete ?? ""}`} className="break-words px-3 py-1.5 text-sm">
                <span className="font-medium tabular-nums">{cambio.paquete ? `${cambio.paquete}: ` : ""}{textoPar(cambio, hoy)}</span>
                <span className="block text-xs text-tinta-suave">
                  {ev.causa ? `Causa: ${ETIQUETA_CAUSA_FECHA[ev.causa]}` : "Sin causa registrada"}
                  {ev.motivo ? ` · “${ev.motivo}”` : ""} · {ev.usuario_nombre ?? "—"} · {fechaHora(ev.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
