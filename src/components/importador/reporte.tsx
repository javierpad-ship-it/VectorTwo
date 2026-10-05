"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { formatearNumero } from "@/lib/formato";
import { nombreBase } from "@/lib/arbol/leer-archivo";
import type { ColumnaOmitida, FilaOmitidaBase } from "./tipos";

/** Repetida dentro del archivo: se procesa una sola vez, no es un error del dato. Mismo id en todos los importadores. */
export const MOTIVO_DUPLICADA = "duplicada_en_archivo";

/** Separa las omitidas en errores (hay que mirarlas) y repetidas en el archivo (informativas). */
export function separarOmitidas<O extends FilaOmitidaBase>(omitidas: O[]) {
  return {
    errores: omitidas.filter((o) => o.motivo !== MOTIVO_DUPLICADA),
    duplicadas: omitidas.filter((o) => o.motivo === MOTIVO_DUPLICADA),
  };
}

export function detalleOmitida(o: FilaOmitidaBase): string {
  if (o.detalle) return o.detalle;
  if (o.fila_original !== undefined) return `Repite la fila ${o.fila_original}`;
  return "";
}

/** Genera el CSV de omitidas en el navegador y lo descarga; con BOM para que Excel respete los acentos. */
export function descargarOmitidasCsv<O extends FilaOmitidaBase>(
  omitidas: O[],
  columnasFila: ColumnaOmitida<O>[],
  etiquetas: Record<string, string>,
  nombreArchivo: string
) {
  const csv = Papa.unparse({
    fields: ["fila", ...columnasFila.map((c) => c.clave), "motivo", "detalle"],
    data: omitidas.map((o) => [o.fila, ...columnasFila.map((c) => c.valor(o)), etiquetas[o.motivo] ?? o.motivo, detalleOmitida(o)]),
  });
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}

export function Celda({ valor }: { valor: string }) {
  return valor ? <>{valor}</> : <span className="text-tinta-suave">—</span>;
}

/** Columna "Fila" más las de la fila original, listas para `DataTable`. */
function columnasDeFila<O extends FilaOmitidaBase>(columnasFila: ColumnaOmitida<O>[]): Columna<O>[] {
  return [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    ...columnasFila.map((c): Columna<O> => ({ clave: c.clave, titulo: c.titulo, render: (f) => <Celda valor={c.valor(f)} /> })),
  ];
}

/** Omitidas con error: filtro por motivo, aviso de corrección y descarga de todas las omitidas en CSV. */
export function TablaErrores<O extends FilaOmitidaBase>({
  errores,
  todas,
  aplicado,
  nombreArchivo,
  columnasFila,
  etiquetas,
  motivosCorregibles,
}: {
  errores: O[];
  /** Todas las omitidas (errores y repetidas), para la descarga. */
  todas: O[];
  aplicado: boolean;
  nombreArchivo: string;
  columnasFila: ColumnaOmitida<O>[];
  /** Motivo → etiqueta legible; su orden de claves es el orden de los chips. */
  etiquetas: Record<string, string>;
  /** Motivos que se arreglan en el archivo: con alguno presente se muestra el aviso "NO se cargarán". */
  motivosCorregibles: ReadonlySet<string>;
}) {
  const [filtro, setFiltro] = useState<string>("todas");

  const porMotivo = new Map<string, number>();
  for (const o of errores) porMotivo.set(o.motivo, (porMotivo.get(o.motivo) ?? 0) + 1);
  const chips: ChipItem<string>[] = [
    { id: "todas", label: "Todas", conteo: errores.length },
    ...Object.keys(etiquetas)
      .filter((m) => porMotivo.has(m))
      .map((m): ChipItem<string> => ({ id: m, label: etiquetas[m], conteo: porMotivo.get(m) })),
  ];
  // Si el motivo filtrado dejó de existir (otro reporte), se vuelve a "todas" sin efectos.
  const filtroVigente = filtro !== "todas" && !porMotivo.has(filtro) ? "todas" : filtro;
  const visibles = filtroVigente === "todas" ? errores : errores.filter((o) => o.motivo === filtroVigente);

  const hayCorregibles = errores.some((o) => motivosCorregibles.has(o.motivo));

  const columnas: Columna<O>[] = [
    ...columnasDeFila(columnasFila),
    {
      clave: "motivo",
      titulo: "Motivo",
      render: (f) => <Badge tono="alerta">{etiquetas[f.motivo] ?? f.motivo}</Badge>,
    },
    { clave: "detalle", titulo: "Detalle", render: (f) => <Celda valor={detalleOmitida(f)} /> },
  ];

  const nombreCsv = `omitidas-${nombreBase(nombreArchivo)}.csv`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Filas con errores ({formatearNumero(errores.length)})</h3>
        <Button variante="secundario" tamano="sm" onClick={() => descargarOmitidasCsv(todas, columnasFila, etiquetas, nombreCsv)}>
          Descargar omitidas (CSV)
        </Button>
      </div>

      {hayCorregibles && (
        <Alert>
          {aplicado ? (
            <>
              <strong>Estas filas NO se cargaron.</strong> Corrige el archivo y vuelve a importarlo: lo que ya entró se reconocerá
              como existente.
            </>
          ) : (
            <>
              <strong>Estas filas NO se cargarán.</strong> Corrige el archivo y vuelve a previsualizar, o aplica para cargar solo
              las válidas.
            </>
          )}
        </Alert>
      )}

      <Chips items={chips} activo={filtroVigente} onCambiar={setFiltro} etiqueta="Filtrar por motivo" />

      <DataTable
        columnas={columnas}
        filas={visibles}
        claveFila={(f) => `${f.fila}-${f.motivo}`}
        vacio="Ninguna fila con ese motivo."
      />
    </div>
  );
}

/** Repetidas dentro del archivo: informativas, no hay nada que corregir. */
export function TablaDuplicadas<O extends FilaOmitidaBase>({
  duplicadas,
  columnasFila,
  descripcion,
}: {
  duplicadas: O[];
  columnasFila: ColumnaOmitida<O>[];
  /** Qué significa "repetida" en este importador (qué combinación se compara). */
  descripcion: string;
}) {
  const columnas: Columna<O>[] = [
    ...columnasDeFila(columnasFila),
    {
      clave: "fila_original",
      titulo: "Repite la fila",
      render: (f) => (f.fila_original !== undefined ? <span className="font-mono text-xs">{f.fila_original}</span> : <Celda valor="" />),
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Repetidas en el archivo ({formatearNumero(duplicadas.length)})</h3>
      <p className="text-xs text-tinta-suave">{descripcion}</p>
      <DataTable columnas={columnas} filas={duplicadas} claveFila={(f) => `${f.fila}-${f.motivo}`} />
    </div>
  );
}

/** Tarjeta de conteos del reporte (Se crearán · Ya existían · Omitidas…). */
export function Tarjeta({
  titulo,
  tono,
  filas,
}: {
  titulo: string;
  tono: "exito" | "neutro" | "alerta";
  filas: [string, number][];
}) {
  const borde = { exito: "border-exito/30", neutro: "border-borde", alerta: "border-alerta/30" }[tono];
  return (
    <div className={`rounded-lg border ${borde} bg-fondo p-3`}>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</div>
      <dl className="space-y-1">
        {filas.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-tinta-suave">{k}</dt>
            <dd className="font-mono font-medium text-tinta">{formatearNumero(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Lista corta de lo que se creará o se creó (primeros N que manda la API). */
export function Muestra({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-tinta-suave">Ninguna.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((i) => (
            <li key={i} className="rounded-md border border-borde px-2 py-0.5 font-mono text-xs text-tinta">
              {i}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cabecera estándar del reporte: "N filas recibidas · M procesadas · K omitidas". */
export function descripcionTotales(t: { recibidas: number; procesadas: number; omitidas: number }): string {
  return `${formatearNumero(t.recibidas)} filas recibidas · ${formatearNumero(t.procesadas)} procesadas · ${formatearNumero(t.omitidas)} omitidas`;
}
