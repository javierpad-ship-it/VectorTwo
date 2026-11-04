"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { AsignacionApi } from "@/lib/compras/agrupadores/tipos-api";
import { mesCorto, unidades } from "../formato";
import { textoLinea } from "./vista-agrupadores";

/**
 * Las asignaciones de un embarque (o de uno de sus paquetes), dentro de `DataTable`: compra, proveedor, línea, mes, unidades, recibidas
 * (estimadas en esta entrega: salen de las primeras recepciones de la compra) y pendientes. Las históricas (compra recibida o cancelada,
 * línea inactiva o recibida al 100 %) salen atenuadas, no se marcan ni se mueven. `periodoEmbarque` permite rotular las desalineadas.
 */
export function TablaAsignaciones({
  asignaciones,
  periodoEmbarque,
  seleccion,
  onAlternar,
  puedeSeleccionar,
  vacio,
}: {
  asignaciones: readonly AsignacionApi[];
  periodoEmbarque: string;
  seleccion: ReadonlySet<string>;
  onAlternar: (id: string, marcada: boolean) => void;
  puedeSeleccionar: boolean;
  vacio: string;
}) {
  const columnas: Columna<AsignacionApi>[] = [
    ...(puedeSeleccionar
      ? [
          {
            clave: "marca",
            titulo: "",
            render: (a: AsignacionApi) => (
              <Checkbox
                checked={seleccion.has(a.id)}
                disabled={a.historica}
                onChange={(v) => onAlternar(a.id, v)}
                label={`Marcar ${a.compra.numero}, ${textoLinea(a.linea)}, ${mesCorto(a.periodo)}`}
              />
            ),
          } satisfies Columna<AsignacionApi>,
        ]
      : []),
    {
      clave: "compra",
      titulo: "Compra",
      render: (a) => (
        <Link href={`/compras/registro?compra=${a.compra.id}`} className="whitespace-nowrap font-medium text-marca-oscura underline-offset-2 hover:underline">
          {a.compra.numero}
        </Link>
      ),
    },
    { clave: "proveedor", titulo: "Proveedor", render: (a) => <span className="text-xs">{a.compra.proveedor.nombre}</span> },
    { clave: "linea", titulo: "Línea", render: (a) => <span className="whitespace-nowrap text-xs">{textoLinea(a.linea)}</span> },
    { clave: "mes", titulo: "Mes", render: (a) => <span className="whitespace-nowrap text-xs">{mesCorto(a.periodo)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (a) => <span className="font-mono tabular-nums">{unidades(a.unidades)}</span> },
    {
      clave: "recibidas",
      titulo: "Recibidas",
      className: "text-right",
      render: (a) => (
        <span className="font-mono tabular-nums">
          {unidades(a.recibidas)}
          {a.recibidas_estimadas && a.recibidas > 0 && <span className="ml-1 font-sans text-[11px] text-tinta-suave">est.</span>}
        </span>
      ),
    },
    { clave: "pendientes", titulo: "Pendientes", className: "text-right", render: (a) => <span className="font-mono tabular-nums">{a.historica ? "—" : unidades(a.pendiente)}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (a) => (
        <span className="flex flex-wrap gap-1">
          {a.historica && (
            <span title="La compra está recibida o cancelada, o la línea ya llegó completa: no se mueve ni cuenta como pendiente.">
              <Badge tono="neutro">Histórica</Badge>
            </span>
          )}
          {!a.historica && a.periodo !== periodoEmbarque && (
            <span title="La entrega no está en el mes de llegada del embarque.">
              <Badge tono="alerta">Desalineada</Badge>
            </span>
          )}
          {!a.historica && a.compra.estado === "borrador" && <Badge tono="neutro">Borrador</Badge>}
        </span>
      ),
    },
  ];
  return <DataTable columnas={columnas} filas={asignaciones as AsignacionApi[]} claveFila={(a) => a.id} vacio={vacio} claseFila={(a) => (a.historica ? "opacity-60" : undefined)} />;
}
