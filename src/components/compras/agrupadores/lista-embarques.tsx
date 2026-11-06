"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { proximoHitoEmbarque } from "@/lib/compras/agrupadores/hitos";
import { ETIQUETA_HITO, type EmbarqueApi, type Hito, type HitoApi } from "@/lib/compras/agrupadores/tipos-api";
import { plural } from "@/lib/formato";
import { fechaLima, mesCorto, unidades } from "../formato";
import { AvisosBadges, EstadoEmbarqueBadge, RecepcionBadge, ResponsableTexto, TipoEmbarqueBadge } from "./insignias";
import { EstadoHitoBadge } from "./linea-tiempo";
import { textoCostoMonedas, textoFecha } from "./vista-agrupadores";
import { hitosDelEmbarque, textoFechaHito, textoProximoHito, textoReprogramado } from "./vista-fechas";

const faltante = (e: EmbarqueApi) => e.avisos.includes("sin_responsable");

/** El hito de un embarque (el de la API o, si la respuesta aún no lo trae, el calculado). */
function hitoDe(e: EmbarqueApi, hito: Exclude<Hito, "orden_compra">, hoy: string): HitoApi | null {
  return hitosDelEmbarque(e, hoy).find((h) => h.hito === hito) ?? null;
}

/** Fecha de un hito con su estado en texto debajo (nunca solo color); el arribo de un local, «No aplica». */
function CeldaHito({ e, hito, hoy }: { e: EmbarqueApi; hito: Exclude<Hito, "orden_compra">; hoy: string }) {
  const h = hitoDe(e, hito, hoy);
  if (h === null) return <span className="text-tinta-suave">—</span>;
  return (
    <span className="whitespace-nowrap text-xs">
      {h.estado === "no_aplica" ? <span className="text-tinta-suave">—</span> : textoFechaHito(h.fecha, h.hora)}
      <span className="mt-0.5 block">
        <EstadoHitoBadge hito={h} hoy={hoy} />
      </span>
    </span>
  );
}

function CeldaIngresoStock({ e, hoy }: { e: EmbarqueApi; hoy: string }) {
  const h = hitoDe(e, "ingreso_stock", hoy);
  return (
    <span className="whitespace-nowrap text-xs">
      {e.fecha_llegada_real ? textoFecha(e.fecha_llegada_real) : textoFecha(h?.fecha ?? e.fecha_llegada_estimada)} <span className="text-tinta-suave">({mesCorto(e.periodo_llegada)})</span>
      <span className="block text-tinta-suave">{e.fecha_llegada_real ? "recibido" : (e.fecha_ingreso_estimada ?? null) !== null ? "fijado" : "igual al Ingreso CD"}</span>
      {h && (
        <span className="mt-0.5 block">
          <EstadoHitoBadge hito={h} hoy={hoy} />
        </span>
      )}
    </span>
  );
}

/** El próximo hito de la API o, si la respuesta aún no lo trae, el calculado con los hitos. */
const proximoDe = (e: EmbarqueApi, hoy: string) => (e.proximo_hito !== undefined ? e.proximo_hito : proximoHitoEmbarque(hitosDelEmbarque(e, hoy)));

function CeldaProximo({ e, hoy }: { e: EmbarqueApi; hoy: string }) {
  const p = proximoDe(e, hoy);
  if (!p) return <span className="text-xs text-tinta-suave">Sin pendientes</span>;
  return <span className="block min-w-40 text-xs">{textoProximoHito(p, hoy)}</span>;
}

function CeldaReprogramado({ e }: { e: EmbarqueApi }) {
  const t = textoReprogramado(e.reprogramaciones_total);
  return t ? <Badge tono="alerta">{t}</Badge> : <span className="text-xs text-tinta-suave">—</span>;
}

function Unidades({ e }: { e: EmbarqueApi }) {
  return (
    <span className="whitespace-nowrap font-mono text-xs tabular-nums">
      {unidades(e.totales.unidades)} u
      <span className="block text-tinta-suave">
        {unidades(e.totales.recibidas)} recib. (est.) · {unidades(e.totales.pendientes)} pend.
      </span>
    </span>
  );
}

/**
 * Lista de embarques (ficha 08b §4.1): embarque (código y nombre), tipo, viaje, puerto, responsable (ⓘ heredado, ⚠ faltante), sale y llega con
 * el badge Atrasado, estado, unidades (asignadas, recibidas «est.», pendientes), compras, paquetes y proveedores, costo y avisos. En pantallas
 * anchas es una `DataTable` (con scroll horizontal) y en el celular, tarjetas. Abrir un embarque lleva a su detalle.
 */
export function ListaEmbarques({ embarques, enlace, cargando = false, hoy: hoyDado }: { embarques: readonly EmbarqueApi[]; enlace: (e: EmbarqueApi) => string; cargando?: boolean; /** Hoy en Lima (`aaaa-mm-dd`); solo lo fija una prueba. */ hoy?: string }) {
  const [hoyPropio] = useState(() => fechaLima());
  const hoy = hoyDado ?? hoyPropio;
  const columnas: Columna<EmbarqueApi>[] = [
    {
      clave: "embarque",
      titulo: "Embarque",
      render: (e) => (
        <div className="min-w-40">
          <Link href={enlace(e)} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
            Embarque {e.codigo}
          </Link>
          <p className="text-xs text-tinta">{e.nombre}</p>
        </div>
      ),
    },
    { clave: "tipo", titulo: "Tipo", render: (e) => <TipoEmbarqueBadge tipo={e.tipo} /> },
    {
      clave: "viaje",
      titulo: "Viaje",
      render: (e) => (e.viaje ? <span className="whitespace-nowrap text-xs">{e.viaje.codigo}{e.viaje.estado === "cerrado" ? " (cerrado)" : ""}</span> : <span className="text-tinta-suave">—</span>),
    },
    { clave: "origen", titulo: "Origen", render: (e) => (e.origen ? <span className="text-xs">{e.origen}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "puerto", titulo: "Puerto", render: (e) => (e.puerto_embarque ? <span className="text-xs">{e.puerto_embarque}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "responsable", titulo: "Responsable", render: (e) => <ResponsableTexto responsable={e.responsable_efectivo} faltante={faltante(e)} /> },
    { clave: "zarpe", titulo: "Zarpe", render: (e) => <CeldaHito e={e} hito="zarpe" hoy={hoy} /> },
    { clave: "arribo", titulo: "Arribo", render: (e) => <CeldaHito e={e} hito="arribo" hoy={hoy} /> },
    { clave: "ingreso_cd", titulo: "Ingreso CD", render: (e) => <CeldaHito e={e} hito="ingreso_cd" hoy={hoy} /> },
    { clave: "inicio_operativo", titulo: "Inicio operativo", render: (e) => <CeldaHito e={e} hito="inicio_operativo" hoy={hoy} /> },
    { clave: "ingreso_stock", titulo: "Ingreso al stock", render: (e) => <CeldaIngresoStock e={e} hoy={hoy} /> },
    { clave: "proximo_hito", titulo: "Próximo hito", render: (e) => <CeldaProximo e={e} hoy={hoy} /> },
    { clave: "reprogramado", titulo: "Reprogramado ×N", render: (e) => <CeldaReprogramado e={e} /> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (e) => (
        <span className="flex flex-col items-start gap-1">
          <EstadoEmbarqueBadge estado={e.estado} />
          <RecepcionBadge recepcion={e.recepcion} />
        </span>
      ),
    },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (e) => <Unidades e={e} /> },
    {
      clave: "contenido",
      titulo: "Contenido",
      render: (e) => (
        <span className="whitespace-nowrap text-xs" title={e.proveedores.map((p) => p.nombre).join(", ")}>
          {plural(e.totales.compras, "compra", "compras")} · {plural(e.totales.paquetes, "paquete", "paquetes")}
          <span className="block text-tinta-suave">{plural(e.proveedores.length, "proveedor", "proveedores")}</span>
        </span>
      ),
    },
    { clave: "costo", titulo: "Costo", className: "text-right", render: (e) => <span className="whitespace-nowrap font-mono text-xs tabular-nums">{textoCostoMonedas(e.totales.costo)}</span> },
    { clave: "avisos", titulo: "Avisos", render: (e) => <AvisosBadges avisos={e.avisos} omitir={["sin_responsable"]} /> },
  ];

  return (
    <>
      <div className="hidden md:block">
        <DataTable columnas={columnas} filas={embarques as EmbarqueApi[]} claveFila={(e) => e.id} cargando={cargando} vacio="Ningún embarque con estos filtros." />
      </div>
      <div className="space-y-3 md:hidden" aria-label="Embarques">
        {cargando && <p className="py-6 text-center text-sm text-tinta-suave">Cargando…</p>}
        {!cargando && embarques.length === 0 && <EmptyState titulo="Ningún embarque con estos filtros." />}
        {!cargando && embarques.map((e) => <TarjetaEmbarque key={e.id} embarque={e} href={enlace(e)} hoy={hoy} />)}
      </div>
    </>
  );
}

/** La misma fila de la lista, apilada para el celular. */
export function TarjetaEmbarque({ embarque: e, href, hoy: hoyDado }: { embarque: EmbarqueApi; href: string; hoy?: string }) {
  const [hoyPropio] = useState(() => fechaLima());
  const hoy = hoyDado ?? hoyPropio;
  const reprogramado = textoReprogramado(e.reprogramaciones_total);
  return (
    <article className="rounded-lg border border-borde bg-superficie p-3 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={href} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
            Embarque {e.codigo}
          </Link>
          <p className="truncate text-sm">{e.nombre}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <EstadoEmbarqueBadge estado={e.estado} />
          <RecepcionBadge recepcion={e.recepcion} />
        </div>
      </header>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <dt className="text-tinta-suave">Tipo</dt>
          <dd>
            <TipoEmbarqueBadge tipo={e.tipo} />
          </dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Viaje</dt>
          <dd>{e.viaje ? `${e.viaje.codigo}${e.viaje.estado === "cerrado" ? " (cerrado)" : ""}` : "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-tinta-suave">Próximo hito</dt>
          <dd>{proximoDe(e, hoy) ? textoProximoHito(proximoDe(e, hoy), hoy) : "Sin pendientes"}</dd>
        </div>
        {(["zarpe", "arribo", "ingreso_cd", "inicio_operativo"] as const).map((h) => (
          <div key={h}>
            <dt className="text-tinta-suave">{ETIQUETA_HITO[h]}</dt>
            <dd>
              <CeldaHito e={e} hito={h} hoy={hoy} />
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-tinta-suave">Ingreso al stock</dt>
          <dd>
            <CeldaIngresoStock e={e} hoy={hoy} />
          </dd>
        </div>
        {reprogramado && (
          <div>
            <dt className="text-tinta-suave">Cambios de fecha</dt>
            <dd>
              <Badge tono="alerta">{reprogramado}</Badge>
            </dd>
          </div>
        )}
        <div>
          <dt className="text-tinta-suave">Origen</dt>
          <dd>{e.origen ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Responsable</dt>
          <dd>
            <ResponsableTexto responsable={e.responsable_efectivo} faltante={faltante(e)} />
          </dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Puerto</dt>
          <dd>{e.puerto_embarque ?? "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-tinta-suave">Unidades</dt>
          <dd className="font-mono tabular-nums">
            {unidades(e.totales.unidades)} u · {unidades(e.totales.recibidas)} recibidas (est.) · {unidades(e.totales.pendientes)} pendientes
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-tinta-suave">Contenido</dt>
          <dd>
            {plural(e.totales.compras, "compra", "compras")} · {plural(e.totales.paquetes, "paquete", "paquetes")} · {plural(e.proveedores.length, "proveedor", "proveedores")}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-tinta-suave">Costo</dt>
          <dd className="font-mono tabular-nums">{textoCostoMonedas(e.totales.costo)}</dd>
        </div>
      </dl>
      {e.avisos.filter((a) => a !== "sin_responsable").length > 0 && (
        <div className="mt-2">
          <AvisosBadges avisos={e.avisos} omitir={["sin_responsable"]} />
        </div>
      )}
    </article>
  );
}
