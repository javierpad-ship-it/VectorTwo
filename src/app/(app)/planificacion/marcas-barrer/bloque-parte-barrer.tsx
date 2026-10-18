"use client";

import { formatearNumero } from "@/lib/formato";
import type { AnalisisMarcaApi } from "@/lib/marcas-barrer/tipos-api";
import { Card } from "@/components/ui/card";
import { formatearFraccion } from "./vista";

/**
 * Bloque 4 · Qué parte de la marca se compra al barrer. En una marca al barrer es toda su venta; en una mixta, la venta fuera
 * de sus GML específicos (la parte específica entra directo al flujo de su GML y no se reparte). Una mixta sin GML se
 * comporta como al barrer.
 */
export function BloqueParteBarrer({ analisis }: { analisis: AnalisisMarcaApi }) {
  const { marca } = analisis;
  const barrer = analisis.share_barrido;
  const especifica = 1 - barrer;
  const total = analisis.unidades_barrer + analisis.unidades_especificas;
  const resumen =
    marca.modalidad === "mixta" && marca.gml_especificos.length > 0
      ? `${marca.nombre}: ${formatearFraccion(barrer, 0)} al barrer, ${formatearFraccion(especifica, 0)} específica en ${marca.gml_especificos.map((g) => g.ruta).join(" y ")} (no se reparte).`
      : `${marca.nombre}: ${formatearFraccion(barrer, 0)} al barrer${marca.modalidad === "mixta" ? " (mixta sin GML específicos: se comporta como al barrer)" : ""}.`;

  return (
    <Card titulo="4. Qué parte se compra al barrer" descripcion="Lo específico no se reparte: va directo al flujo de su GML.">
      <div className="space-y-3">
        <p className="text-sm text-tinta">{resumen}</p>
        <div
          role="img"
          aria-label={`${formatearFraccion(barrer, 0)} al barrer y ${formatearFraccion(especifica, 0)} específica`}
          className="flex h-5 w-full overflow-hidden rounded-md border border-borde bg-neutro-suave"
        >
          <div className="h-full bg-marca" style={{ width: `${Math.max(0, Math.min(1, barrer)) * 100}%` }} />
          {especifica > 0 && <div className="h-full bg-alerta/70" style={{ width: `${Math.max(0, Math.min(1, especifica)) * 100}%` }} />}
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-tinta-suave">
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-marca" /> Al barrer: {formatearNumero(analisis.unidades_barrer)} u ({formatearFraccion(barrer)})
          </li>
          {marca.modalidad === "mixta" && (
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-alerta/70" /> Específica: {formatearNumero(analisis.unidades_especificas)} u ({formatearFraccion(especifica)})
            </li>
          )}
          <li>Total en la ventana: {formatearNumero(total)} u</li>
        </ul>
        {marca.modalidad === "mixta" && marca.gml_especificos.length > 0 && (
          <div>
            <p className="text-sm font-medium text-tinta">GML específicos (compras directas, no se reparten)</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-tinta-suave">
              {marca.gml_especificos.map((g) => (
                <li key={g.gml_id}>{g.ruta}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
