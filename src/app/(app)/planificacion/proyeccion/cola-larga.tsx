"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { ColaLargaApi } from "@/lib/proyeccion/tipos-api";
import { ADVERTENCIA_SURTIDO_PARCIAL, datosColaLarga, ETIQUETA_VEREDICTO } from "./vista";

/**
 * Validación de disponibilidad de una fila de cola larga (0.10.1): cuánto de lo que se debió vender estuvo con stock, y la
 * venta corregida `A_f` por disponibilidad y estacionalidad. Con veredicto «para revisión» la PROPUESTA del sistema es la demanda
 * corregida y el avance normal va al lado como referencia (decisión de Javier). La disponibilidad es un proxy mensual: una
 * tienda sin stock puede ser un quiebre o una línea que no se surte en esa tienda.
 */
export function ColaLargaDetalle({ cola }: { cola: ColaLargaApi }) {
  const revision = cola.veredicto === "revision";
  return (
    <section className="space-y-3 rounded-lg border border-borde bg-superficie p-4" aria-label="Validación de disponibilidad de la cola larga">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Cola larga · disponibilidad</h3>
        <Badge tono={revision ? "alerta" : cola.veredicto === "cierra_con_quiebres" ? "marca" : "neutro"}>{ETIQUETA_VEREDICTO[cola.veredicto]}</Badge>
      </header>
      {cola.veredicto === "sin_dato" ? (
        <p className="text-sm text-tinta-suave">No hay stock cargado de esta fila en los últimos doce meses: no se pudo medir la disponibilidad, así que se trata como cola larga normal.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
          {datosColaLarga(cola).map((d) => (
            <div key={d.rotulo}>
              <dt className="text-xs text-tinta-suave">{d.rotulo}</dt>
              <dd className="font-mono tabular-nums">{d.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {revision && (
        <p className="text-sm">
          La propuesta de esta fila es la <span className="font-medium">demanda corregida</span> (la venta anual corregida por disponibilidad y estacionalidad). En «Tu decisión», al lado de la propuesta, va la cifra que saldría con el avance normal, solo como referencia.
        </p>
      )}
      {(revision || cola.veredicto === "cierra_con_quiebres") && <Alert tono="info">{ADVERTENCIA_SURTIDO_PARCIAL}</Alert>}
      <p className="text-xs text-tinta-suave">Disponibilidad = tienda-meses con stock al cierre del mes ÷ tienda-meses totales (proxy mensual: M5 no trae días con stock).</p>
    </section>
  );
}
