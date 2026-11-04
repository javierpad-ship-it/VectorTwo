"use client";

import { useState } from "react";
import { ErrorApi } from "@/lib/api-client";
import { leerArchivoTabular, type TablaLeida } from "@/lib/arbol/leer-archivo";
import { MAX_FILAS_IMPORTAR_AGRUPADORES } from "@/lib/compras/agrupadores/tipos";
import type { ReporteImportacionAgrupadoresApi } from "@/lib/compras/agrupadores/tipos-api";
import { importarAgrupadores } from "@/lib/compras/agrupadores/use-agrupadores";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { detectarMapeo, firmaImportacion, mapeoCompleto, mapeoVacio } from "@/components/importador/mapeo";
import type { ArchivoImportacion, Mapeo, ModoImportacion } from "@/components/importador/tipos";
import { armarFilasImportacion, CAMPOS_AGRUPADORES, confirmarAplicarAgrupadores, type CampoAgrupador } from "./vista-importar-agrupadores";

/** El texto de un error del importador; `vuelve_a_previsualizar` ya trae su explicación del servidor. */
export function textoErrorImportarAgrupadores(e: unknown): string {
  return mensajeError(e);
}

/**
 * Flujo de cuatro pasos (archivo → mapeo → previsualizar → aplicar) del importador de agrupadores (ficha 08b §3.11). Es hermano de
 * `useImportador` y de `useImportarCompras`: el endpoint recibe además `archivo_nombre` y un número de `fila` por fila (la fila de la hoja:
 * la cabecera es la 1), que el hook compartido no manda; el importador compartido no se modifica. Las filas totalmente vacías no se envían.
 * Aplicar solo se habilita con una previsualización vigente (mismo archivo, hoja y mapeo) y pide un `confirm`. Si alguien creó una de las
 * claves entre previsualizar y aplicar (`409 vuelve_a_previsualizar`), la previsualización se descarta para obligar a repetirla.
 */
export function useImportarAgrupadores({ alAplicar }: { alAplicar?: (r: ReporteImportacionAgrupadoresApi) => void } = {}) {
  const [archivo, setArchivo] = useState<ArchivoImportacion | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [mapeo, setMapeo] = useState<Mapeo<CampoAgrupador>>(() => mapeoVacio(CAMPOS_AGRUPADORES));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<ModoImportacion | null>(null);
  const [previa, setPrevia] = useState<{ firma: string; reporte: ReporteImportacionAgrupadoresApi } | null>(null);
  const [final, setFinal] = useState<ReporteImportacionAgrupadoresApi | null>(null);

  const completo = mapeoCompleto(mapeo, CAMPOS_AGRUPADORES);
  const firmaActual = firmaImportacion(archivo, mapeo);
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
      if (tabla.filas.length > MAX_FILAS_IMPORTAR_AGRUPADORES) {
        setArchivo(null);
        setError(`El archivo tiene ${formatearNumero(tabla.filas.length)} filas; el máximo por importación es ${formatearNumero(MAX_FILAS_IMPORTAR_AGRUPADORES)}.`);
        return;
      }
      setArchivo({ nombre: f.name, tamano: f.size, columnas: tabla.columnas, filas: tabla.filas, hojas: tabla.hojas, hoja: tabla.hoja });
      setMapeo(detectarMapeo(tabla.columnas, CAMPOS_AGRUPADORES));
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
      if (!confirm(confirmarAplicarAgrupadores(archivo.nombre, previaVigente.reporte))) return;
    }
    setEnviando(modo);
    setError(null);
    try {
      const filas = armarFilasImportacion(archivo, mapeo);
      const reporte = await importarAgrupadores({ modo, archivo_nombre: archivo.nombre, filas });
      if (modo === "previsualizar") {
        setPrevia({ firma: firmaActual, reporte });
        setFinal(null);
      } else {
        setFinal(reporte);
        alAplicar?.(reporte);
      }
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === "vuelve_a_previsualizar") setPrevia(null);
      setError(textoErrorImportarAgrupadores(e));
    } finally {
      setEnviando(null);
    }
  }

  return { archivo, leyendo, mapeo, setMapeo, error, setError, enviando, previa, previaVigente, final, mapeoCompleto: completo, elegirArchivo, cambiarHoja, enviar };
}
