"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import { clasificarPeticion, type TipoPeticion } from "@/lib/reportes/histograma";
import type { PeticionUnidadesMensuales, UnidadesMensuales } from "@/lib/reportes/tipos-unidades";

const URL_UNIDADES = "/api/reportes/agrupacion-gmle/unidades-mensuales";
const ESPERA_MS = 300;

type Resultado = { clave: string; datos: UnidadesMensuales | null; error: string | null };

/**
 * Unidades vendidas por mes para las equivalencias dadas (`null` = todas).
 * Con `[]` o con más ids de los que admite la API no llama. La petición se
 * retrasa `ESPERA_MS` (se descartan los cambios intermedios de filtros) y la
 * anterior se cancela con `AbortController`. `cargando` se deriva de la clave
 * (no hay `setState` síncrono en el efecto: react-hooks/set-state-in-effect).
 */
export function useUnidadesMensuales(ids: readonly string[] | null) {
  // La clave sustituye a la identidad del array: el mismo conjunto de ids no repite la consulta.
  const clave = useMemo(() => (ids === null ? "*" : ids.join(",")), [ids]);
  const tipo: TipoPeticion = clasificarPeticion(ids);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<Resultado>({ clave: "", datos: null, error: null });

  const claveActual = `${intento}|${clave}`;
  const consulta = tipo === "todas" || tipo === "ids";

  useEffect(() => {
    if (!consulta) return;
    const control = new AbortController();
    const cuerpo: PeticionUnidadesMensuales = clave === "*" ? {} : { equivalencia_ids: clave.split(",") };
    const temporizador = setTimeout(() => {
      api
        .post<UnidadesMensuales>(URL_UNIDADES, cuerpo, { signal: control.signal })
        .then((datos) => {
          if (control.signal.aborted) return;
          setResultado({ clave: claveActual, datos, error: null });
        })
        .catch((e: unknown) => {
          if (control.signal.aborted) return;
          setResultado((previo) => ({ clave: claveActual, datos: previo.datos, error: mensajeError(e) }));
        });
    }, ESPERA_MS);
    return () => {
      clearTimeout(temporizador);
      control.abort();
    };
  }, [consulta, clave, claveActual]);

  const reintentar = useCallback(() => setIntento((i) => i + 1), []);

  return {
    tipo,
    /** Último resultado correcto (se conserva, atenuado, mientras llega el nuevo). */
    datos: consulta ? resultado.datos : null,
    cargando: consulta && resultado.clave !== claveActual,
    error: consulta && resultado.clave === claveActual ? resultado.error : null,
    reintentar,
  };
}
