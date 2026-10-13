"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { formatearNumero, plural } from "@/lib/formato";
import { ETIQUETA_DESTINO_GML, type EnviadaGmlInforme } from "@/lib/ventas/tipos";
import type { MedidasCarga } from "@/lib/ventas/tipos-api";
import { formatearEntero, formatearPorcentaje, formatearSoles } from "./comunes";
import type { Asignacion } from "./detalle-mes";
import { origenesDeEnviada, unirOrigenes } from "./origenes-mapeo";

const LIMITE_FILAS = 100;

/** Lista del reporte guardado (`reporte.enviadas_a_gml_detalle`): vacía si el reporte es anterior a 0.8.3 o el campo no es una lista. */
export function leerEnviadasGuardadas(reporte: Record<string, unknown>): { resumen: MedidasCarga | null; detalle: EnviadaGmlInforme[] } {
  const detalle = Array.isArray(reporte.enviadas_a_gml_detalle) ? (reporte.enviadas_a_gml_detalle as EnviadaGmlInforme[]) : [];
  const r = reporte.enviadas_a_gml;
  const resumen = r !== null && typeof r === "object" && typeof (r as { filas?: unknown }).filas === "number" ? (r as MedidasCarga) : null;
  return { resumen, detalle };
}

/**
 * Bloque informativo "Equivalencias enviadas a la GML sin equivalencia" (0.8.3): datos antiguos
 * cuya equivalencia ya no existe y que se cargan en la equivalencia de nivel GML de su línea.
 * No son errores ni bloquean el mes. Con `asignacion` (reporte previo) cada valor tiene su botón
 * Asignar, como en los errores: el mapeo que se cree gana al envío. En el reporte guardado de una
 * carga no hay `asignacion` y la tabla es de solo lectura.
 */
export function EnviadasGml({
  periodo,
  resumen,
  detalle,
  filasArchivo,
  asignacion,
}: {
  periodo: string;
  resumen: MedidasCarga | null;
  detalle: EnviadaGmlInforme[];
  /** Filas del archivo en ese mes, para el porcentaje (opcional). */
  filasArchivo?: number;
  asignacion?: Asignacion;
}) {
  const [limite, setLimite] = useState(LIMITE_FILAS);
  if (detalle.length === 0) return null;
  const filas = resumen?.filas ?? detalle.reduce((s, d) => s + d.filas, 0);
  const visibles = detalle.slice(0, limite);
  const origenesDe = (d: EnviadaGmlInforme) => (asignacion ? origenesDeEnviada(asignacion.indice, periodo, d) : []);

  const columnas: Columna<EnviadaGmlInforme>[] = [
    {
      clave: "valor",
      titulo: "Origen (género / mundo / línea / equivalencia)",
      render: (d) => <span className="break-words">{d.valor === "" ? "(vacío)" : d.valor}</span>,
    },
    {
      clave: "destino",
      titulo: "Se cargó en",
      render: (d) => (
        <div>
          <span className="whitespace-nowrap">→ {ETIQUETA_DESTINO_GML[d.destino_tipo]}</span>
          <div className="break-words text-xs text-tinta-suave">{d.destino}</div>
        </div>
      ),
    },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (d) => formatearNumero(d.filas) },
    { clave: "unidades", titulo: "Unidades", className: "text-right font-mono", render: (d) => formatearEntero(d.unidades) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (d) => formatearSoles(d.venta_soles) },
    { clave: "costo", titulo: "Costo", className: "text-right font-mono", render: (d) => formatearSoles(d.costo_vendido) },
    { clave: "stock_u", titulo: "Stock (u.)", className: "text-right font-mono", render: (d) => formatearEntero(d.stock_unidades) },
    { clave: "stock", titulo: "Stock a costo", className: "text-right font-mono", render: (d) => formatearSoles(d.stock_valorizado) },
    ...(asignacion
      ? [
          {
            clave: "asignar",
            titulo: "",
            render: (d: EnviadaGmlInforme) => {
              const origenes = origenesDe(d);
              if (origenes.length === 0) return null;
              return (
                <Button
                  variante="secundario"
                  tamano="sm"
                  disabled={!asignacion.disponible}
                  onClick={() => asignacion.onAsignar(unirOrigenes([origenes]))}
                  aria-label={`Asignar ${d.valor} a otro GML o GMLE`}
                >
                  Asignar
                </Button>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">
        Equivalencias enviadas a la GML sin equivalencia ({plural(filas, "fila", "filas")}
        {filasArchivo ? `, ${formatearPorcentaje((filas / filasArchivo) * 100)} del archivo` : ""})
      </h4>
      <Alert tono="info">
        Datos antiguos cuya equivalencia ya no existe; se cargan en la equivalencia de nivel GML. Si quieres otro destino, asígnalo y recarga el mes. No son errores: no bloquean el mes.
      </Alert>
      <DataTable columnas={columnas} filas={visibles} claveFila={(d) => `${d.motivo}|${d.valor}`} vacio="Ninguna." />
      {detalle.length > limite && (
        <Button variante="secundario" tamano="sm" onClick={() => setLimite((l) => l + LIMITE_FILAS)}>
          Mostrar más ({formatearNumero(detalle.length - limite)} restantes)
        </Button>
      )}
      {asignacion && !asignacion.disponible && (
        <p className="text-xs text-tinta-suave">
          Para asignar hay que tener la lectura del archivo en esta pantalla y nada en marcha: vuelve a leer el archivo.
        </p>
      )}
    </div>
  );
}
