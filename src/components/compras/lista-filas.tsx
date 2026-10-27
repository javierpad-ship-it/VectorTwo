import Link from "next/link";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { ParametrosFlujoApi } from "@/lib/flujo/tipos-api";
import { imi, unidades } from "./formato";
import { SelloSenal } from "./senal";
import { ETIQUETA_CORTA_AVISO_FILA, TEXTO_AVISO_FILA, type ClaveOrden, type FilaDeLista, type OrdenLista } from "./vista-flujo";

/**
 * Lista de filas del flujo (ficha 08 §4.3): una fila por unidad de planificación × agrupación de marca, con el estado, el IMI al cierre
 * del último mes publicado, el saldo por comprar de los próximos meses, lo que viene en camino y el stock de la cadena. Abrir una fila
 * lleva a su flujo mes a mes. La tabla está dentro de `DataTable`, que hace el scroll horizontal en pantallas angostas.
 */
export function ListaFilas({
  filas,
  parametros,
  orden,
  onOrdenar,
  enlace,
  cargando = false,
}: {
  filas: readonly FilaDeLista[];
  parametros: Pick<ParametrosFlujoApi, "imi_min" | "imi_max" | "meses_tarjeta">;
  orden: OrdenLista;
  onOrdenar: (clave: ClaveOrden) => void;
  /** URL del detalle de una fila. */
  enlace: (f: FilaDeLista) => string;
  cargando?: boolean;
}) {
  const columnas: Columna<FilaDeLista>[] = [
    {
      clave: "fila",
      titulo: "Fila",
      ordenable: true,
      render: (f) => (
        <div className="min-w-48">
          <Link href={enlace(f)} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
            {f.ruta}
          </Link>
          <p className="text-xs text-tinta-suave">{f.agrupacion}</p>
          {f.fila.avisos.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-alerta">
              {f.fila.avisos.map((a) => (
                <span key={a} title={TEXTO_AVISO_FILA[a]}>
                  ⚠ {ETIQUETA_CORTA_AVISO_FILA[a]}
                </span>
              ))}
            </p>
          )}
        </div>
      ),
    },
    { clave: "estado", titulo: "Estado", ordenable: true, render: (f) => <SelloSenal senal={f.fila.resumen.senal} /> },
    {
      clave: "imi",
      titulo: "IMI",
      ordenable: true,
      className: "text-right",
      render: (f) => {
        const v = f.fila.resumen.imi_k;
        const fuera = v !== null && (v < parametros.imi_min || v > parametros.imi_max);
        return <span className={`font-mono tabular-nums ${fuera ? "font-semibold text-alerta" : ""}`}>{imi(v)}</span>;
      },
    },
    { clave: "saldo", titulo: `Saldo ${parametros.meses_tarjeta} m`, ordenable: true, className: "text-right", render: (f) => <span className="font-mono tabular-nums">{unidades(f.fila.resumen.saldo_n_meses)}</span> },
    { clave: "camino", titulo: "En camino", ordenable: true, className: "text-right", render: (f) => <span className="font-mono tabular-nums">{unidades(f.fila.resumen.en_camino)}</span> },
    {
      clave: "stock",
      titulo: "Stock cadena",
      ordenable: true,
      className: "text-right",
      render: (f) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-mono tabular-nums">{unidades(f.fila.stock_k.total)}</span>
          <span className="text-[11px] text-tinta-suave">CD {unidades(f.fila.stock_k.cd)}</span>
        </span>
      ),
    },
    {
      clave: "confirmar",
      titulo: "Por confirmar",
      className: "text-right",
      render: (f) =>
        f.fila.resumen.por_confirmar > 0 ? (
          <span className="font-mono tabular-nums text-alerta" title={f.fila.resumen.posible_doble_conteo > 0 ? "El inventario ya muestra un ingreso: posible doble conteo" : undefined}>
            {unidades(f.fila.resumen.por_confirmar)}
            {f.fila.resumen.posible_doble_conteo > 0 ? " ⚠" : ""}
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
  ];
  return (
    <DataTable
      columnas={columnas}
      filas={filas as FilaDeLista[]}
      claveFila={(f) => f.clave}
      cargando={cargando}
      vacio="Ninguna fila con estos filtros."
      ordenActual={{ clave: orden.clave, dir: orden.dir }}
      onOrdenar={(c) => onOrdenar(c as ClaveOrden)}
    />
  );
}
