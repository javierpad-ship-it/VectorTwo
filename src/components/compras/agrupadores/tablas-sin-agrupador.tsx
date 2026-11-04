"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { CompraDeViajeApi, CompraSinViajeApi, EntregaSinEmbarqueApi } from "@/lib/compras/agrupadores/tipos-api";
import { ETIQUETA_ESTADO_COMPRA, ETIQUETA_ORIGEN_COMPRA } from "@/lib/compras/tipos-api";
import { mesCorto, unidades } from "../formato";
import { textoCostoMonedas, textoLinea } from "./vista-agrupadores";

const enlaceCompra = (id: string, numero: string) => (
  <Link href={`/compras/registro?compra=${id}`} className="whitespace-nowrap font-medium text-marca-oscura underline-offset-2 hover:underline">
    {numero}
  </Link>
);

/** «Entregas sin embarque»: una fila por entrega con unidades sin asignar a ningún embarque, con casilla para «Asignar a embarque…». */
export function TablaEntregasSinEmbarque({
  entregas,
  seleccion,
  onAlternar,
  cargando = false,
  vacio = "No hay entregas sin embarque.",
}: {
  entregas: readonly EntregaSinEmbarqueApi[];
  seleccion: ReadonlySet<string>;
  onAlternar: (entregaId: string, marcada: boolean) => void;
  cargando?: boolean;
  vacio?: string;
}) {
  const columnas: Columna<EntregaSinEmbarqueApi>[] = [
    {
      clave: "marca",
      titulo: "",
      render: (e) => <Checkbox checked={seleccion.has(e.entrega_id)} onChange={(v) => onAlternar(e.entrega_id, v)} label={`Marcar ${e.compra.numero}, ${textoLinea(e.linea)}, ${mesCorto(e.periodo)}`} />,
    },
    { clave: "compra", titulo: "Compra", render: (e) => enlaceCompra(e.compra.id, e.compra.numero) },
    { clave: "proveedor", titulo: "Proveedor", render: (e) => <span className="text-xs">{e.compra.proveedor.nombre}</span> },
    { clave: "linea", titulo: "Línea", render: (e) => <span className="whitespace-nowrap text-xs">{textoLinea(e.linea)}</span> },
    { clave: "mes", titulo: "Mes", render: (e) => <span className="whitespace-nowrap text-xs">{mesCorto(e.periodo)}</span> },
    { clave: "estado", titulo: "Compra en", render: (e) => <Badge tono={e.compra.estado === "borrador" ? "neutro" : "marca"}>{ETIQUETA_ESTADO_COMPRA[e.compra.estado]}</Badge> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.unidades)}</span> },
    { clave: "sin", titulo: "Sin asignar", className: "text-right", render: (e) => <span className="font-mono font-medium tabular-nums">{unidades(e.sin_asignar)}</span> },
  ];
  return <DataTable columnas={columnas} filas={entregas as EntregaSinEmbarqueApi[]} claveFila={(e) => e.entrega_id} cargando={cargando} vacio={vacio} />;
}

type CompraFila = CompraDeViajeApi & { origen?: string };

/** Compras de un viaje, o compras sin viaje, con casilla para quitar del viaje o para «Asignar a viaje…». `origen` solo viene en las sin viaje. */
export function TablaCompras({
  compras,
  seleccion,
  onAlternar,
  cargando = false,
  vacio = "No hay compras.",
  conOrigen = false,
}: {
  compras: readonly (CompraDeViajeApi | CompraSinViajeApi)[];
  seleccion: ReadonlySet<string>;
  onAlternar: (compraId: string, marcada: boolean) => void;
  cargando?: boolean;
  vacio?: string;
  conOrigen?: boolean;
}) {
  const columnas: Columna<CompraFila>[] = [
    { clave: "marca", titulo: "", render: (c) => <Checkbox checked={seleccion.has(c.id)} onChange={(v) => onAlternar(c.id, v)} label={`Marcar la compra ${c.numero}`} /> },
    { clave: "compra", titulo: "Compra", render: (c) => enlaceCompra(c.id, c.numero) },
    { clave: "proveedor", titulo: "Proveedor", render: (c) => <span className="text-xs">{c.proveedor.nombre}</span> },
    { clave: "fecha", titulo: "Fecha", render: (c) => <span className="whitespace-nowrap text-xs">{c.fecha_compra}</span> },
    ...(conOrigen
      ? [
          {
            clave: "origen",
            titulo: "Origen",
            render: (c: CompraFila) => <span className="whitespace-nowrap text-xs text-tinta-suave">{ETIQUETA_ORIGEN_COMPRA[c.origen as keyof typeof ETIQUETA_ORIGEN_COMPRA] ?? c.origen ?? "—"}</span>,
          } satisfies Columna<CompraFila>,
        ]
      : []),
    { clave: "estado", titulo: "Estado", render: (c) => <Badge tono={c.estado === "borrador" ? "neutro" : c.estado === "confirmada" ? "marca" : "exito"}>{ETIQUETA_ESTADO_COMPRA[c.estado]}</Badge> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{unidades(c.unidades)}</span> },
    { clave: "costo", titulo: "Costo", className: "text-right", render: (c) => <span className="whitespace-nowrap font-mono text-xs tabular-nums">{textoCostoMonedas(c.costo)}</span> },
    { clave: "sin", titulo: "Sin embarque", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{unidades(c.unidades_sin_embarque)}</span> },
  ];
  return <DataTable columnas={columnas} filas={compras as CompraFila[]} claveFila={(c) => c.id} cargando={cargando} vacio={vacio} />;
}
