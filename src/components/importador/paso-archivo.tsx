"use client";

import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { formatearNumero } from "@/lib/formato";
import type { ArchivoImportacion } from "./tipos";

/** Paso 1: elegir el archivo (CSV/Excel) y, si el libro tiene varias hojas, cuál leer. */
export function PasoArchivo({
  archivo,
  leyendo,
  descripcion,
  hintHoja,
  onElegir,
  onCambiarHoja,
}: {
  archivo: ArchivoImportacion | null;
  leyendo: boolean;
  descripcion: string;
  /** Ayuda del selector de hoja (qué contiene la hoja que hay que elegir). */
  hintHoja: string;
  onElegir: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCambiarHoja: (hoja: string) => void;
}) {
  return (
    <Card titulo="1. Archivo" descripcion={descripcion}>
      <div className="space-y-4">
        <input
          type="file"
          accept=".csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onElegir}
          disabled={leyendo}
          aria-label="Archivo CSV o Excel"
          className="block text-sm text-tinta file:mr-3 file:rounded-md file:border file:border-borde file:bg-superficie file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-tinta hover:file:bg-neutro-suave"
        />
        {leyendo && <p className="text-sm text-tinta-suave">Leyendo el archivo…</p>}
        {archivo && (
          <p className="text-sm text-tinta-suave">
            <strong className="text-tinta">{archivo.nombre}</strong>
            {archivo.hoja && <> · hoja <strong className="text-tinta">{archivo.hoja}</strong></>} ·{" "}
            {formatearNumero(archivo.filas.length)} filas · {archivo.columnas.length} columnas
          </p>
        )}
        {archivo && archivo.hojas.length > 1 && (
          <Field label="Hoja del libro" hint={hintHoja} className="max-w-xs">
            <Select value={archivo.hoja ?? ""} onChange={(e) => onCambiarHoja(e.target.value)} disabled={leyendo}>
              {archivo.hojas.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Card>
  );
}
