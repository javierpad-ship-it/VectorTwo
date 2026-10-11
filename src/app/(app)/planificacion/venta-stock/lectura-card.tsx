"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatearNumero } from "@/lib/formato";
import { formatearTamano } from "./comunes";
import { BarraProgreso } from "./progreso";
import type { useCargaVentas } from "./use-carga-ventas";

const TEXTO_FASE = {
  leyendo: "Leyendo",
  resolviendo: "Consultando tiendas, marcas y árbol",
  armando: "Armando el reporte",
} as const;

/** Paso 3: lectura por bloques con barra de avance y Cancelar. */
export function LecturaCard({ c }: { c: ReturnType<typeof useCargaVentas> }) {
  const { lectura } = c;
  if (!lectura.activa) return null;
  const p = lectura.progreso;
  const fase = lectura.fase ?? "leyendo";
  const pct = p ? Math.round(p.fraccion * 100) : 0;
  const detalle = p ? `${pct} % · ${formatearTamano(p.bytesLeidos)} de ${formatearTamano(p.bytesTotales)} · ${formatearNumero(p.filas)} filas` : "";
  const texto = fase === "leyendo" ? `${TEXTO_FASE.leyendo}… ${detalle}` : `${TEXTO_FASE[fase]}…`;

  return (
    <Card
      titulo="3. Lectura y previsualización"
      acciones={
        fase === "leyendo" ? (
          <Button variante="secundario" tamano="sm" onClick={c.cancelarLectura}>
            Cancelar
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-2" aria-live="polite">
        <p className="text-sm text-tinta">{texto}</p>
        <BarraProgreso fraccion={fase === "leyendo" ? (p?.fraccion ?? 0) : 1} etiqueta="Avance de la lectura del archivo" />
        <p className="text-xs text-tinta-suave">Las filas no se guardan: se interpretan al leerlas y se acumulan en memoria. Un año tarda de 10 a 20 segundos.</p>
      </div>
    </Card>
  );
}
