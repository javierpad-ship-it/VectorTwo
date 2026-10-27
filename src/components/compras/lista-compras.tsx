import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { ETIQUETA_ORIGEN_COMPRA, type CompraApi } from "@/lib/compras/tipos-api";
import { fechaHora, unidades } from "./formato";
import { estadoCompra, ETIQUETA_CORTA_AVISO_LINEA, TEXTO_AVISO_LINEA, textoCosto, textoEntregas, unidadesPorConfirmar } from "./vista-compras";

/**
 * Lista de compras (ficha 08 §4.4): número, fecha, proveedor, origen, líneas, unidades, costo, entregas (primera y última), recibidas,
 * estado, quién la creó, último cambio y avisos. Abrir una compra lleva a su detalle. Dentro de `DataTable`, que desplaza en horizontal
 * en pantallas angostas. El costo es visible para todos los roles.
 */
export function ListaCompras({ compras, enlace, cargando = false }: { compras: readonly CompraApi[]; enlace: (c: CompraApi) => string; cargando?: boolean }) {
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
    { clave: "origen", titulo: "Origen", render: (c) => <span className="whitespace-nowrap text-xs text-tinta-suave">{ETIQUETA_ORIGEN_COMPRA[c.origen]}</span> },
    { clave: "lineas", titulo: "Líneas", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{c.lineas.length}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{unidades(c.totales.unidades)}</span> },
    { clave: "costo", titulo: "Costo", className: "text-right", render: (c) => <span className="whitespace-nowrap font-mono tabular-nums">{textoCosto(c)}</span> },
    { clave: "entregas", titulo: "Entregas", render: (c) => <span className="whitespace-nowrap text-xs">{textoEntregas(c)}</span> },
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
  return <DataTable columnas={columnas} filas={compras as CompraApi[]} claveFila={(c) => c.id} cargando={cargando} vacio="Ninguna compra con estos filtros." />;
}
