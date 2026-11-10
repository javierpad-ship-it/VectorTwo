"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/form";
import type { Desglose, FilaDesgloseApi, OpcionesTableroApi, TableroApi } from "@/lib/direccion/tipos-api";
import { plural } from "@/lib/formato";
import { ampliarLimite, filasPorAnadir, hayMasFilas, limitarFilas, PAGINA_FILAS } from "@/lib/reportes/paginacion";
import { ayudaFilaDesglose, cambioPorFilaDesglose, columnasDesglose, ETIQUETA_DESGLOSE, ORDEN_DESGLOSE, ordenarDesglose, type FiltrosVista } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const FIJA = "sticky left-0 z-10 bg-superficie";

type Fila = { fila: FilaDesgloseApi; total: boolean };

/**
 * Desglose del recorte (ficha 14, §4.8): una fila por elemento de la dimensión elegida, con los años, enero a `k'`, las variaciones y la participación,
 * y el total al pie. Las filas que no son un elemento («Sin participación por marca», «Sin atribuir», «Fuera de la proyección») van al final, sin
 * enlace y con su ayuda corta. Orden por lo proyectado del año siguiente; se pintan 200 filas y «Mostrar más» añade otras tantas.
 * Elegir una fila la aplica como filtro (D11): la serie mensual de ese elemento se ve en el gráfico, sin pedir series por elemento.
 */
export function TablaDesglose({
  tablero,
  opciones,
  actualizando,
  onDimension,
  onFiltrar,
}: {
  tablero: TableroApi;
  opciones: OpcionesTableroApi | null;
  actualizando: boolean;
  onDimension: (d: Desglose) => void;
  onFiltrar: (cambio: Partial<FiltrosVista>) => void;
}) {
  const d = tablero.desglose;
  const [paginado, setPaginado] = useState<{ clave: string; limite: number }>({ clave: "", limite: PAGINA_FILAS });
  // El límite vuelve a la primera página cuando cambia el desglose o la proyección.
  const clave = `${tablero.proyeccion.id}|${d.dimension}|${d.filas.length}`;
  const limite = paginado.clave === clave ? paginado.limite : PAGINA_FILAS;

  const ordenadas = useMemo(() => ordenarDesglose(d.filas, tablero.proyeccion.anio_siguiente), [d.filas, tablero.proyeccion.anio_siguiente]);
  const visibles: Fila[] = [...limitarFilas(ordenadas, limite).map((fila) => ({ fila, total: false })), ...(ordenadas.length > 0 ? [{ fila: d.total, total: true }] : [])];
  const cols = useMemo(() => columnasDesglose(d.total, tablero), [d.total, tablero]);

  const columnas: Columna<Fila>[] = [
    {
      clave: "nombre",
      titulo: ETIQUETA_DESGLOSE[d.dimension],
      className: `${FIJA} min-w-44`,
      render: ({ fila, total }) => {
        if (total) return <span>Total del recorte</span>;
        const cambio = cambioPorFilaDesglose(d.dimension, fila, opciones);
        const ayuda = ayudaFilaDesglose(fila.id);
        if (ayuda) {
          return (
            <span className="block" title={ayuda}>
              <span className="flex flex-wrap items-center gap-1.5 text-tinta-suave">
                <span>{fila.nombre}</span>
                {fila.exactitud === "estimado" && <Badge tono="alerta">estimado</Badge>}
              </span>
              <span className="block text-xs font-normal text-tinta-suave">{ayuda}</span>
            </span>
          );
        }
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {cambio ? (
              <button
                type="button"
                onClick={() => onFiltrar(cambio)}
                title={`Filtrar por ${fila.nombre}: su serie mensual se ve en el gráfico`}
                className="min-h-9 text-left font-medium text-marca-oscura underline underline-offset-2 hover:text-marca"
              >
                {fila.nombre}
              </button>
            ) : (
              <span>{fila.nombre}</span>
            )}
            {fila.exactitud === "estimado" && <Badge tono="alerta">estimado</Badge>}
          </span>
        );
      },
    },
    ...cols.map((c): Columna<Fila> => ({ clave: c.clave, titulo: c.titulo, className: `${NUM}${c.proyectado ? " italic" : ""}`, render: ({ fila }) => c.valor(fila) })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Desglosar por" className="w-full max-w-xs">
          <Select aria-label="Desglosar por" value={d.dimension} onChange={(e) => onDimension(e.target.value as Desglose)}>
            {ORDEN_DESGLOSE.map((x) => (
              <option key={x} value={x}>
                {ETIQUETA_DESGLOSE[x]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {plural(ordenadas.length, "elemento", "elementos")}
          {hayMasFilas(limite, ordenadas.length) ? ` · se muestran ${limite}` : ""}
          {actualizando ? " · actualizando…" : ""}
        </p>
      </div>
      <DataTable etiqueta={`Desglose por ${ETIQUETA_DESGLOSE[d.dimension].toLowerCase()}`} columnas={columnas} filas={visibles} claveFila={(f) => (f.total ? "~total" : f.fila.id)} claseFila={(f) => (f.total ? "bg-neutro-suave/60 font-semibold" : undefined)} vacio="Sin elementos en este desglose." />
      {hayMasFilas(limite, ordenadas.length) && (
        <div className="flex justify-center">
          <Button variante="secundario" onClick={() => setPaginado({ clave, limite: ampliarLimite(limite, ordenadas.length) })}>
            Mostrar {filasPorAnadir(limite, ordenadas.length)} más
          </Button>
        </div>
      )}
      <p className="text-xs text-tinta-suave">
        Toca un elemento para filtrar por él y ver su serie mensual en el gráfico. Lo proyectado va en cursiva. {d.dimension === "marca" && "Por marca, lo proyectado es estimado con su participación de los últimos 12 meses en cada fila. "}
        {d.dimension === "tienda" && "Por tienda, lo de las mismas tiendas es estimado (atribución); lo de tiendas nuevas, aperturas y cierres es exacto."}
      </p>
    </div>
  );
}
