"use client";

import { useMemo, useState } from "react";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import type { AnalisisMarcaApi } from "@/lib/marcas-barrer/tipos-api";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/form";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import { GraficoLineas } from "./grafico-lineas";
import { formatearFraccion, gmlConPeso, seriesP1Mensual, tituloAnio } from "./vista";

type Vista = "tabla" | "grafico";
type FilaAnio = { anio: number; meses: (number | null)[]; anual: number | null; completo: boolean };

/**
 * Bloque 2 · Peso de la marca en cada GML por mes y año (`p1` = unidades de la marca ÷ unidades totales del GML). Dice cuánto
 * de «mi flujo» de ese GML es la marca. Tabla año × mes (la alternativa accesible, con las cifras exactas) o gráfico de una
 * línea por año. Informativo: no entra en el reparto.
 */
export function BloquePeso({ analisis }: { analisis: AnalisisMarcaApi }) {
  const opciones = useMemo(() => gmlConPeso(analisis.filas), [analisis.filas]);
  const [elegido, setElegido] = useState<string>("");
  const [vista, setVista] = useState<Vista>("tabla");
  const seleccion = opciones.find((o) => o.clave === elegido) ?? opciones[0] ?? null;
  const fila = seleccion?.fila ?? null;

  const filasAnio: FilaAnio[] = useMemo(() => {
    if (!fila) return [];
    return fila.p1_mensual.map((m) => {
      const a = fila.p1_anual.find((x) => x.anio === m.anio);
      return { anio: m.anio, meses: m.meses, anual: a?.valor ?? null, completo: a?.completo ?? true };
    });
  }, [fila]);

  const columnas: Columna<FilaAnio>[] = [
    { clave: "anio", titulo: "Año", className: "whitespace-nowrap font-medium", render: (r) => tituloAnio(r.anio, analisis.parametros.hasta_periodo) },
    ...MESES_CORTOS.map(
      (mes, i): Columna<FilaAnio> => ({ clave: `m${i}`, titulo: mes, className: "text-right tabular-nums", render: (r) => formatearFraccion(r.meses[i]) })
    ),
    { clave: "anual", titulo: "Año", className: "text-right font-medium tabular-nums", render: (r) => (r.completo ? formatearFraccion(r.anual) : `${formatearFraccion(r.anual)} *`) },
  ];

  const series: SerieGrafico[] = useMemo(() => (fila ? seriesP1Mensual(fila).map((s) => ({ ...s, grosor: 2 })) : []), [fila]);

  const tablaAnios = (
    <div>
      <DataTable columnas={columnas} filas={filasAnio} claveFila={(r) => String(r.anio)} vacio="Sin meses con venta." />
      {filasAnio.some((r) => !r.completo) && <p className="mt-1 text-xs text-tinta-suave">* año incompleto: solo los meses cargados.</p>}
    </div>
  );

  return (
    <Card
      titulo={`2. Peso de ${analisis.marca.nombre} en cada GML por mes y año (p1)`}
      descripcion="Unidades de la marca sobre las unidades totales del GML. Informativo: no cambia el reparto."
      acciones={
        <Chips<Vista>
          etiqueta="Forma de ver el peso mensual"
          items={[
            { id: "tabla", label: "Tabla" },
            { id: "grafico", label: "Gráfico" },
          ]}
          activo={vista}
          onCambiar={setVista}
        />
      }
    >
      {opciones.length === 0 || !fila ? (
        <EmptyState titulo="Sin peso que mostrar" detalle="La marca no tiene venta en la ventana elegida." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="GML" className="w-full max-w-md">
              <Select value={seleccion?.clave ?? ""} onChange={(e) => setElegido(e.target.value)}>
                {opciones.map((o) => (
                  <option key={o.clave} value={o.clave}>
                    {o.ruta} · {o.unidades.toLocaleString("es-PE")} u
                  </option>
                ))}
              </Select>
            </Field>
            <p className="pb-2 text-sm text-tinta-suave">En la ventana: {formatearFraccion(fila.p1_ventana)} del GML.</p>
          </div>
          {vista === "tabla" || series.length === 0 ? (
            tablaAnios
          ) : (
            <>
              <GraficoLineas series={series} resumen={`Peso mensual de ${analisis.marca.nombre} en ${fila.ruta}, una línea por año.`} />
              <details className="text-sm">
                <summary className="cursor-pointer text-tinta-suave hover:text-tinta">Ver las cifras exactas</summary>
                <div className="mt-2">{tablaAnios}</div>
              </details>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
