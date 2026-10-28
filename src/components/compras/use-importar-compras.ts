"use client";

import { useState } from "react";
import { ErrorApi } from "@/lib/api-client";
import { leerArchivoTabular, type TablaLeida } from "@/lib/arbol/leer-archivo";
import type { ReporteImportacionComprasApi } from "@/lib/compras/tipos-api";
import { importarCompras } from "@/lib/compras/use-compras";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { detectarMapeo, filasMapeadas, firmaImportacion, mapeoCompleto, mapeoVacio } from "@/components/importador/mapeo";
import type { ArchivoImportacion, CampoImportador, Mapeo, ModoImportacion } from "@/components/importador/tipos";

/** Mismo tope que la API (`MAX_FILAS_IMPORTACION` de compras). */
const MAX_FILAS = 10_000;

export type CampoCompra =
  | "proveedor"
  | "fecha_compra"
  | "referencia"
  | "linea_ordinal"
  | "tipo"
  | "genero"
  | "mundo"
  | "linea"
  | "equivalencia"
  | "marca"
  | "agrupacion_marca"
  | "tallas"
  | "unidades"
  | "costo_unitario"
  | "moneda"
  | "llegada"
  | "entregas"
  | "recibidas"
  | "destino"
  | "alcance"
  | "nota";

/**
 * El texto del error de la API. `403`: el rol no escribe compras (la pantalla ya oculta el botón, pero la API manda); `400
 * carga_inicial_requerida`: la casilla es obligatoria en `0.13.0`. Los demás salen con el mensaje de la API tal cual.
 */
export function textoErrorImportar(e: unknown): string {
  if (e instanceof ErrorApi && e.status === 403) return `${e.message} Importar compras es de administración y planeamiento.`;
  return mensajeError(e);
}

/**
 * Flujo de cuatro pasos (archivo → mapeo → previsualizar → aplicar) del importador de compras (ficha 08 §4.7). Es hermano de
 * `useImportador`, que no sirve tal cual porque este endpoint recibe además `carga_inicial` (en `0.13.0` la casilla es obligatoria: sin
 * ella la API responde `400 carga_inicial_requerida`) y devuelve el reporte en los dos modos. Aplicar solo se habilita con una
 * previsualización vigente (el archivo, la hoja y el mapeo no cambiaron desde que se previsualizó). Se aplica con un `confirm`.
 */
export function useImportarCompras({
  campos,
  cargaInicial,
  confirmarAplicar,
  alAplicar,
}: {
  campos: CampoImportador<CampoCompra>[];
  cargaInicial: boolean;
  confirmarAplicar: (nombreArchivo: string, reporte: ReporteImportacionComprasApi) => string;
  /** Se llama cuando la API terminó de aplicar (con o sin compras sin aplicar): la pantalla relee su lista. */
  alAplicar?: () => void;
}) {
  const [archivo, setArchivo] = useState<ArchivoImportacion | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [mapeo, setMapeo] = useState<Mapeo<CampoCompra>>(() => mapeoVacio(campos));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<ModoImportacion | null>(null);
  const [previa, setPrevia] = useState<{ firma: string; reporte: ReporteImportacionComprasApi } | null>(null);
  const [final, setFinal] = useState<ReporteImportacionComprasApi | null>(null);

  const completo = mapeoCompleto(mapeo, campos);
  // La casilla entra en la firma: cambiarla obliga a previsualizar de nuevo.
  const firmaActual = `${firmaImportacion(archivo, mapeo)}|${cargaInicial ? "ci" : "no"}`;
  const previaVigente = previa !== null && previa.firma === firmaActual ? previa : null;

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setOriginal(f);
    void cargar(f);
  }

  function cambiarHoja(hoja: string) {
    if (original) void cargar(original, hoja);
  }

  async function cargar(f: File, hoja?: string) {
    setError(null);
    setPrevia(null);
    setFinal(null);
    setLeyendo(true);
    try {
      const tabla: TablaLeida = await leerArchivoTabular(f, hoja);
      if (tabla.columnas.length === 0 || tabla.filas.length === 0) {
        setArchivo(null);
        setError(tabla.hojas.length > 1 ? `La hoja "${tabla.hoja}" no tiene cabecera o está vacía. Prueba con otra hoja.` : "El archivo no tiene cabecera o está vacío.");
        return;
      }
      if (tabla.filas.length > MAX_FILAS) {
        setArchivo(null);
        setError(`El archivo tiene ${formatearNumero(tabla.filas.length)} filas; el máximo por importación es ${formatearNumero(MAX_FILAS)}.`);
        return;
      }
      setArchivo({ nombre: f.name, tamano: f.size, columnas: tabla.columnas, filas: tabla.filas, hojas: tabla.hojas, hoja: tabla.hoja });
      setMapeo(detectarMapeo(tabla.columnas, campos));
    } catch (err) {
      setArchivo(null);
      setError(`No se pudo leer el archivo: ${mensajeError(err)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function enviar(modo: ModoImportacion) {
    if (!archivo || !completo) return;
    if (modo === "aplicar") {
      if (!previaVigente) return;
      if (!confirm(confirmarAplicar(archivo.nombre, previaVigente.reporte))) return;
    }
    setEnviando(modo);
    setError(null);
    try {
      const reporte = await importarCompras({ modo, carga_inicial: cargaInicial, filas: filasMapeadas(archivo, mapeo, campos) });
      if (modo === "previsualizar") {
        setPrevia({ firma: firmaActual, reporte });
        setFinal(null);
      } else {
        setFinal(reporte);
        alAplicar?.();
      }
    } catch (e) {
      setError(textoErrorImportar(e));
    } finally {
      setEnviando(null);
    }
  }

  return { archivo, leyendo, mapeo, setMapeo, error, setError, enviando, previa, previaVigente, final, mapeoCompleto: completo, elegirArchivo, cambiarHoja, enviar };
}
