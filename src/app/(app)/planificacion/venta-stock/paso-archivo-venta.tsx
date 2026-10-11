"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { PasoMapeo } from "@/components/importador/paso-mapeo";
import { formatearNumero } from "@/lib/formato";
import { CAMPOS_ARCHIVO_VENTA } from "@/lib/ventas/columnas";
import { ETIQUETA_SEPARADOR, SEPARADORES, type Codificacion, type Separador } from "@/lib/ventas/leer-por-bloques";
import { FILAS_EXCEL_MAX } from "@/lib/ventas/tipos";
import { ComoExportar } from "./como-exportar";
import { formatearTamano } from "./comunes";
import type { useCargaVentas } from "./use-carga-ventas";

type Props = { c: ReturnType<typeof useCargaVentas> };

const ETIQUETA_CODIFICACION: Record<Codificacion, string> = { "utf-8": "UTF-8", "windows-1252": "Windows-1252 (Excel en español antiguo)" };

/** Pasos 1 y 2: archivo (con codificación, separador y hoja) y mapeo de las 14 columnas. */
export function PasoArchivoVenta({ c }: Props) {
  const { archivo, cabecera } = c;
  const ocupado = c.leyendoCabecera || c.leyendo || c.cargando;
  const esExcel = cabecera !== null && cabecera.hojas.length > 0;

  return (
    <>
      <Card
        titulo="1. Archivo"
        descripcion="Un archivo por año o semestre; por mes para probar. CSV de QlikView (o Excel .xls / .xlsx). Se lee en tu navegador: solo se envían los valores distintos y los meses ya interpretados, nunca el archivo."
      >
        <div className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={c.elegirArchivo}
            disabled={ocupado}
            aria-label="Archivo CSV o Excel de QlikView"
            className="block text-sm text-tinta file:mr-3 file:rounded-md file:border file:border-borde file:bg-superficie file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-tinta hover:file:bg-neutro-suave"
          />
          {c.leyendoCabecera && <p className="text-sm text-tinta-suave">Leyendo la cabecera del archivo…</p>}
          {archivo && !c.leyendoCabecera && cabecera && (
            <p className="text-sm text-tinta-suave">
              <strong className="text-tinta">{archivo.name}</strong> · {formatearTamano(archivo.size)} · {cabecera.columnas.length} columnas
              {esExcel && cabecera.filasHoja !== null && <> · {formatearNumero(Math.max(0, cabecera.filasHoja - 1))} filas en la hoja</>}
            </p>
          )}

          {cabecera && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!esExcel && (
                <>
                  <Field
                    label="Codificación"
                    hint={c.deteccion ? `Detectada: ${c.deteccion.etiqueta}. Cámbiala si ves la Ñ o las tildes rotas.` : "Cámbiala si ves la Ñ o las tildes rotas."}
                  >
                    <Select value={c.codificacion ?? "utf-8"} onChange={(e) => c.cambiarCodificacion(e.target.value as Codificacion)} disabled={ocupado}>
                      {(Object.keys(ETIQUETA_CODIFICACION) as Codificacion[]).map((k) => (
                        <option key={k} value={k}>
                          {ETIQUETA_CODIFICACION[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Separador" hint="Detectado por el contenido; el de QlikView es la coma.">
                    <Select value={c.separador ?? ","} onChange={(e) => c.cambiarSeparador(e.target.value as Separador)} disabled={ocupado}>
                      {SEPARADORES.map((s) => (
                        <option key={s} value={s}>
                          {ETIQUETA_SEPARADOR[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              {esExcel && cabecera.hojas.length > 1 && (
                <Field label="Hoja del libro" hint="Elige la hoja con los datos de venta.">
                  <Select value={c.hoja ?? ""} onChange={(e) => c.cambiarHoja(e.target.value)} disabled={ocupado}>
                    {cabecera.hojas.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          )}

          {c.excelDemasiadoGrande && cabecera?.filasHoja != null && (
            <Alert>
              Esa hoja tiene {formatearNumero(cabecera.filasHoja)} filas y un Excel admite hasta {formatearNumero(FILAS_EXCEL_MAX)}: exporta de QlikView a CSV.
            </Alert>
          )}
          <ComoExportar />
        </div>
      </Card>

      {cabecera && (
        <PasoMapeo
          campos={CAMPOS_ARCHIVO_VENTA}
          columnas={cabecera.columnas}
          mapeo={c.mapeo}
          onCambiar={c.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Son obligatorias las 14 columnas de QlikView, salvo el año: sin él, la columna del mes debe traerlo (por ejemplo 2026-09). Si tienes columnas con otros nombres, elígelas a mano."
        >
          <Button onClick={() => void c.leerYPrevisualizar()} disabled={!c.mapeoCompleto || ocupado || c.excelDemasiadoGrande}>
            {c.leyendo ? "Leyendo…" : "Leer y previsualizar"}
          </Button>
          {!c.mapeoCompleto && <span className="text-xs text-tinta-suave">Falta mapear alguna columna obligatoria.</span>}
          {c.prev && c.prevVigente === null && !c.leyendo && (
            <span className="text-xs text-tinta-suave">Cambiaste el archivo o el mapeo: vuelve a leer antes de cargar.</span>
          )}
        </PasoMapeo>
      )}
    </>
  );
}
