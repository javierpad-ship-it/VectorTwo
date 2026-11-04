"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { plural } from "@/lib/formato";
import { unidades } from "../formato";
import { AvisosBadges, EstadoViajeBadge, ResponsableTexto } from "./insignias";
import { textoCostoMonedas, textoFecha } from "./vista-agrupadores";

/**
 * Lista de viajes (ficha 08b §4.3): viaje (código y nombre), destino, fechas, responsable, estado, compras, unidades, costo, embarques y
 * unidades sin embarque. Acciones por fila: «Usar como viaje activo» (todos los roles) y Cerrar, Reabrir y Cancelar (solo admin y planner:
 * `puedeCerrarOCancelar`; la API responde `403` al comprador). Dentro de `DataTable`, que desplaza en horizontal en pantallas angostas.
 */
export function ListaViajes({
  viajes,
  enlace,
  viajeActivo,
  puedeCerrarOCancelar,
  ocupado,
  onUsarActivo,
  onCerrarViaje,
  onReabrir,
  onCancelar,
  cargando = false,
}: {
  viajes: readonly ViajeApi[];
  enlace: (v: ViajeApi) => string;
  viajeActivo: string;
  puedeCerrarOCancelar: boolean;
  ocupado: boolean;
  onUsarActivo: (v: ViajeApi) => void;
  onCerrarViaje: (v: ViajeApi) => void;
  onReabrir: (v: ViajeApi) => void;
  onCancelar: (v: ViajeApi) => void;
  cargando?: boolean;
}) {
  const columnas: Columna<ViajeApi>[] = [
    {
      clave: "viaje",
      titulo: "Viaje",
      render: (v) => (
        <div className="min-w-40">
          <Link href={enlace(v)} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
            Viaje {v.codigo}
          </Link>
          <p className="text-xs text-tinta">{v.nombre}</p>
          {viajeActivo === v.id && (
            <span className="mt-0.5 inline-block">
              <Badge tono="marca">Viaje activo</Badge>
            </span>
          )}
        </div>
      ),
    },
    { clave: "destino", titulo: "Destino", render: (v) => (v.destino ? <span className="text-xs">{v.destino}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "fechas", titulo: "Fechas", render: (v) => <span className="whitespace-nowrap text-xs">{textoFecha(v.fecha_inicio)}{v.fecha_fin ? ` – ${textoFecha(v.fecha_fin)}` : ""}</span> },
    {
      clave: "responsable",
      titulo: "Responsable",
      render: (v) => <ResponsableTexto responsable={v.responsable ? { ...v.responsable, origen: "propio" } : null} faltante={!v.responsable_valido || v.avisos.includes("sin_responsable")} />,
    },
    { clave: "estado", titulo: "Estado", render: (v) => <EstadoViajeBadge estado={v.estado} /> },
    { clave: "compras", titulo: "Compras", className: "text-right", render: (v) => <span className="font-mono tabular-nums">{unidades(v.totales.compras)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (v) => <span className="font-mono tabular-nums">{unidades(v.totales.unidades)}</span> },
    { clave: "costo", titulo: "Costo", className: "text-right", render: (v) => <span className="whitespace-nowrap font-mono text-xs tabular-nums">{textoCostoMonedas(v.totales.costo)}</span> },
    { clave: "embarques", titulo: "Embarques", className: "text-right", render: (v) => <span className="font-mono tabular-nums">{unidades(v.totales.embarques)}</span> },
    {
      clave: "sin",
      titulo: "Sin embarque",
      className: "text-right",
      render: (v) => <span className={`font-mono tabular-nums ${v.totales.unidades_sin_embarque > 0 ? "font-medium text-alerta" : ""}`}>{unidades(v.totales.unidades_sin_embarque)} u</span>,
    },
    { clave: "avisos", titulo: "Avisos", render: (v) => <AvisosBadges avisos={v.avisos} omitir={["sin_responsable"]} /> },
    {
      clave: "acciones",
      titulo: "",
      render: (v) => (
        <div className="flex flex-wrap justify-end gap-1">
          {v.estado !== "cancelado" && viajeActivo !== v.id && (
            <Button tamano="sm" variante="fantasma" disabled={ocupado} onClick={() => onUsarActivo(v)}>
              Usar como viaje activo
            </Button>
          )}
          {puedeCerrarOCancelar && v.estado === "abierto" && (
            <Button tamano="sm" variante="fantasma" disabled={ocupado} onClick={() => onCerrarViaje(v)}>
              Cerrar
            </Button>
          )}
          {puedeCerrarOCancelar && v.estado === "cerrado" && (
            <Button tamano="sm" variante="fantasma" disabled={ocupado} onClick={() => onReabrir(v)}>
              Reabrir
            </Button>
          )}
          {puedeCerrarOCancelar && v.estado !== "cancelado" && (
            <Button tamano="sm" variante="peligro" disabled={ocupado} onClick={() => onCancelar(v)}>
              Cancelar
            </Button>
          )}
        </div>
      ),
    },
  ];
  return <DataTable columnas={columnas} filas={viajes as ViajeApi[]} claveFila={(v) => v.id} cargando={cargando} vacio="Ningún viaje con estos filtros." claseFila={(v) => (v.estado === "cancelado" ? "opacity-60" : undefined)} />;
}

/** Cuenta corta para el pie de la lista. */
export const textoCuentaViajes = (visibles: number, total: number): string => `${plural(visibles, "viaje", "viajes")}${visibles !== total ? ` de ${total}` : ""}`;
