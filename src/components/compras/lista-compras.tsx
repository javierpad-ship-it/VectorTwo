import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { ETIQUETA_ORIGEN_COMPRA, type CompraApi } from "@/lib/compras/tipos-api";
import { fechaHora, unidades } from "./formato";
import { hrefEmbarque, hrefViaje, embarquesDeCompra, textoSinEmbarque, textoViajeCompra, unidadesSinEmbarque } from "./vista-agrupadores-compras";
import { estadoCompra, ETIQUETA_CORTA_AVISO_LINEA, TEXTO_AVISO_LINEA, textoCosto, textoEntregas, unidadesPorConfirmar } from "./vista-compras";

/**
 * Lista de compras (ficha 08 §4.4): número, fecha, proveedor, origen, líneas, unidades, costo, entregas (primera y última), recibidas,
 * estado, quién la creó, último cambio y avisos; desde la ficha 08b, también su viaje y los embarques a los que viaja (con lo que queda sin
 * embarque). Abrir una compra lleva a su detalle. Dentro de `DataTable`, que desplaza en horizontal en pantallas angostas. El costo es
 * visible para todos los roles.
 */
export function ListaCompras({
  compras,
  enlace,
  cargando = false,
  vacio = "Ninguna compra con estos filtros.",
}: {
  compras: readonly CompraApi[];
  enlace: (c: CompraApi) => string;
  cargando?: boolean;
  vacio?: string;
}) {
  const columnas: Columna<CompraApi>[] = [
    {
      clave: "numero",
      titulo: "Compra",
      render: (c) => (
        <div>
          <Link href={enlace(c)} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
            {c.numero}
          </Link>
          {c.referencia && <p className="text-xs text-tinta-suave">ref. {c.referencia}</p>}
        </div>
      ),
    },
    { clave: "fecha", titulo: "Fecha", render: (c) => <span className="whitespace-nowrap">{c.fecha_compra}</span> },
    { clave: "proveedor", titulo: "Proveedor", render: (c) => c.proveedor.nombre },
    {
      clave: "viaje",
      titulo: "Viaje",
      render: (c) =>
        c.viaje ? (
          <Link href={hrefViaje(c.viaje.id)} className="text-xs text-marca-oscura underline-offset-2 hover:underline" title={textoViajeCompra(c.viaje)}>
            <span className="whitespace-nowrap font-medium">{c.viaje.codigo}</span>
            <span className="block max-w-40 truncate text-tinta-suave">{c.viaje.nombre}{c.viaje.estado === "cerrado" ? " (cerrado)" : ""}</span>
          </Link>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    { clave: "origen", titulo: "Origen", render: (c) => <span className="whitespace-nowrap text-xs text-tinta-suave">{ETIQUETA_ORIGEN_COMPRA[c.origen]}</span> },
    { clave: "lineas", titulo: "Líneas", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{c.lineas.length}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{unidades(c.totales.unidades)}</span> },
    { clave: "costo", titulo: "Costo", className: "text-right", render: (c) => <span className="whitespace-nowrap font-mono tabular-nums">{textoCosto(c)}</span> },
    { clave: "entregas", titulo: "Entregas", render: (c) => <span className="whitespace-nowrap text-xs">{textoEntregas(c)}</span> },
    {
      clave: "embarques",
      titulo: "Embarques",
      render: (c) => {
        const embarques = embarquesDeCompra(c);
        const sin = unidadesSinEmbarque(c);
        if (embarques.length === 0 && sin === 0) return <span className="text-tinta-suave">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {embarques.map((e) => (
              <Link key={e.id} href={hrefEmbarque(e.id)} title={`${unidades(e.unidades)} u${e.paquetes.length > 0 ? ` · paquetes ${e.paquetes.join(", ")}` : ""}`}>
                <Badge tono="marca">{e.codigo}</Badge>
              </Link>
            ))}
            {sin > 0 && <Badge tono="neutro">{textoSinEmbarque(sin)}</Badge>}
          </span>
        );
      },
    },
    { clave: "recibidas", titulo: "Recibidas", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{unidades(c.totales.recibidas)}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (c) => {
        const e = estadoCompra(c);
        return <Badge tono={e.tono}>{e.texto}</Badge>;
      },
    },
    { clave: "creada", titulo: "Creada por", render: (c) => <span className="text-xs">{c.creada_por.nombre ?? "—"}</span> },
    {
      clave: "cambio",
      titulo: "Último cambio",
      render: (c) => {
        const u = c.modificada_por;
        return u ? (
          <span className="whitespace-nowrap text-xs">
            {u.nombre ?? "—"}
            <span className="block text-tinta-suave">{fechaHora(u.at)}</span>
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        );
      },
    },
    {
      clave: "avisos",
      titulo: "Avisos",
      render: (c) => {
        const porConfirmar = unidadesPorConfirmar(c);
        if (c.avisos.length === 0 && porConfirmar === 0) return <span className="text-tinta-suave">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {porConfirmar > 0 && <Badge tono="alerta">{unidades(porConfirmar)} u por confirmar</Badge>}
            {c.avisos
              .filter((a) => a !== "entrega_vencida")
              .map((a) => (
                <span key={a} title={TEXTO_AVISO_LINEA[a]}>
                  <Badge tono={a === "sin_reparto" || a === "directo_sin_regla" ? "alerta" : "neutro"}>{ETIQUETA_CORTA_AVISO_LINEA[a]}</Badge>
                </span>
              ))}
          </span>
        );
      },
    },
  ];
  return <DataTable columnas={columnas} filas={compras as CompraApi[]} claveFila={(c) => c.id} cargando={cargando} vacio={vacio} />;
}
