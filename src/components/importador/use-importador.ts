"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { leerArchivoTabular, type TablaLeida } from "@/lib/arbol/leer-archivo";
import { detectarMapeo, filasMapeadas, firmaImportacion, mapeoCompleto, mapeoVacio } from "./mapeo";
import type { ArchivoImportacion, CampoImportador, Mapeo, ModoImportacion } from "./tipos";

export const MAX_FILAS_IMPORTACION = 10_000;

/**
 * Estado y acciones del flujo de cuatro pasos (archivo → mapeo →
 * previsualizar → aplicar) contra un endpoint que recibe
 * `{ modo, filas }` y devuelve un reporte `R` en los dos modos.
 *
 * Aplicar solo se habilita con una previsualización vigente: la firma del
 * archivo, la hoja y el mapeo no cambiaron desde que se previsualizó.
 */
export function useImportador<C extends string, R extends { modo: ModoImportacion }>({
  campos,
  url,
  confirmarAplicar,
  maxFilas = MAX_FILAS_IMPORTACION,
}: {
  campos: CampoImportador<C>[];
  url: string;
  /** Texto del `confirm` antes de aplicar; recibe el nombre del archivo y el reporte de la previsualización. */
  confirmarAplicar: (nombreArchivo: string, reporte: R) => string;
  maxFilas?: number;
}) {
  const [archivo, setArchivo] = useState<ArchivoImportacion | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [mapeo, setMapeo] = useState<Mapeo<C>>(() => mapeoVacio(campos));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<ModoImportacion | null>(null);
  const [previa, setPrevia] = useState<{ firma: string; reporte: R } | null>(null);
  const [final, setFinal] = useState<R | null>(null);

  const completo = mapeoCompleto(mapeo, campos);
  const firmaActual = firmaImportacion(archivo, mapeo);
  /** La previsualización solo sirve para aplicar si corresponde al archivo, hoja y mapeo actuales. */
  const previaVigente = previa !== null && previa.firma === firmaActual ? previa : null;

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setOriginal(f);
    void cargar(f);
  }

  /** Relee el archivo elegido con otra hoja del libro. */
  function cambiarHoja(hoja: string) {
    if (original) void cargar(original, hoja);
  }

  /** Lee (o relee, al cambiar de hoja) el archivo elegido. */
  async function cargar(f: File, hoja?: string) {
    setError(null);
    setPrevia(null);
    setFinal(null);
    setLeyendo(true);
    try {
      const tabla: TablaLeida = await leerArchivoTabular(f, hoja);
      if (tabla.columnas.length === 0 || tabla.filas.length === 0) {
        setArchivo(null);
        setError(
          tabla.hojas.length > 1
            ? `La hoja "${tabla.hoja}" no tiene cabecera o está vacía. Prueba con otra hoja.`
            : "El archivo no tiene cabecera o está vacío."
        );
        return;
      }
      if (tabla.filas.length > maxFilas) {
        setArchivo(null);
        setError(`El archivo tiene ${formatearNumero(tabla.filas.length)} filas; el máximo por importación es ${formatearNumero(maxFilas)}.`);
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
      const reporte = await api.post<R>(url, { modo, filas: filasMapeadas(archivo, mapeo, campos) });
      if (modo === "previsualizar") {
        setPrevia({ firma: firmaActual, reporte });
        setFinal(null);
      } else {
        setFinal(reporte);
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(null);
    }
  }

  return {
    archivo,
    leyendo,
    mapeo,
    setMapeo,
    error,
    setError,
    enviando,
    /** Última previsualización (vigente o no). */
    previa,
    /** La previsualización si sigue vigente; `null` si no hay o cambió el archivo/mapeo. */
    previaVigente,
    final,
    mapeoCompleto: completo,
    elegirArchivo,
    cambiarHoja,
    enviar,
  };
}
