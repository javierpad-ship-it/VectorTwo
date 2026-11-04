import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { EmbarqueApi } from "@/lib/compras/agrupadores/tipos-api";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { AvisosBadges, EstadoEmbarqueBadge, RecepcionBadge, ResponsableTexto, TipoEmbarqueBadge } from "./insignias";
import { textoCostoMonedas, textoFecha } from "./vista-agrupadores";

const faltante = (e: EmbarqueApi) => e.avisos.includes("sin_responsable");
const atrasado = (e: EmbarqueApi) => e.avisos.includes("atrasado");

function Fechas({ e }: { e: EmbarqueApi }) {
  return (
    <span className="whitespace-nowrap text-xs">
      <span className="text-tinta-suave">Sale </span>
      {textoFecha(e.fecha_salida_estimada)}
      <span className="block">
        <span className="text-tinta-suave">Llega </span>
        {textoFecha(e.fecha_llegada_real ?? e.fecha_llegada_estimada)}
        {e.fecha_llegada_real === null && <span className="text-tinta-suave"> (est.)</span>}
      </span>
      {atrasado(e) && (
        <span className="mt-0.5 block">
          <Badge tono="alerta">Atrasado</Badge>
        </span>
      )}
    </span>
  );
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
export function ListaEmbarques({ embarques, enlace, cargando = false }: { embarques: readonly EmbarqueApi[]; enlace: (e: EmbarqueApi) => string; cargando?: boolean }) {
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
    { clave: "puerto", titulo: "Puerto", render: (e) => (e.puerto_embarque ? <span className="text-xs">{e.puerto_embarque}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "responsable", titulo: "Responsable", render: (e) => <ResponsableTexto responsable={e.responsable_efectivo} faltante={faltante(e)} /> },
    { clave: "fechas", titulo: "Fechas", render: (e) => <Fechas e={e} /> },
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
    { clave: "avisos", titulo: "Avisos", render: (e) => <AvisosBadges avisos={e.avisos} omitir={["atrasado", "sin_responsable"]} /> },
  ];

  return (
    <>
      <div className="hidden md:block">
        <DataTable columnas={columnas} filas={embarques as EmbarqueApi[]} claveFila={(e) => e.id} cargando={cargando} vacio="Ningún embarque con estos filtros." />
      </div>
      <div className="space-y-3 md:hidden" aria-label="Embarques">
        {cargando && <p className="py-6 text-center text-sm text-tinta-suave">Cargando…</p>}
        {!cargando && embarques.length === 0 && <EmptyState titulo="Ningún embarque con estos filtros." />}
        {!cargando && embarques.map((e) => <TarjetaEmbarque key={e.id} embarque={e} href={enlace(e)} />)}
      </div>
    </>
  );
}

/** La misma fila de la lista, apilada para el celular. */
export function TarjetaEmbarque({ embarque: e, href }: { embarque: EmbarqueApi; href: string }) {
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
        <div>
          <dt className="text-tinta-suave">Llega</dt>
          <dd>
            {textoFecha(e.fecha_llegada_real ?? e.fecha_llegada_estimada)} <span className="text-tinta-suave">({mesCorto(e.periodo_llegada)})</span>
            {atrasado(e) && (
              <span className="ml-1">
                <Badge tono="alerta">Atrasado</Badge>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Sale</dt>
          <dd>{textoFecha(e.fecha_salida_estimada)}</dd>
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
      {e.avisos.filter((a) => a !== "atrasado" && a !== "sin_responsable").length > 0 && (
        <div className="mt-2">
          <AvisosBadges avisos={e.avisos} omitir={["atrasado", "sin_responsable"]} />
        </div>
      )}
    </article>
  );
}
