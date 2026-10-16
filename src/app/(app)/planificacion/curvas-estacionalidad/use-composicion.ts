"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { CalcularAgrupacionCuerpo, ComposicionAgrupacionApi } from "@/lib/curvas/tipos-api";

type Estado = {
  datos: ComposicionAgrupacionApi | null;
  /** Mensaje del último fallo y la huella para la que ocurrió. */
  error: { mensaje: string; huella: string } | null;
};

/**
 * Composición de la agrupación (`POST …/composicion`, carga diferida): se pide al abrir la tarjeta y de nuevo cuando
 * cambia `huella_calculo` estando abierta (otro parámetro, otros datos). Cada petición se cancela con
 * `AbortController` si llega otra; una respuesta con OTRA huella que la que se ve en pantalla se descarta (la
 * composición y el gráfico tienen que describir el mismo cálculo). Nunca escribe.
 *
 * Solo toca el estado dentro de promesas (react-hooks/set-state-in-effect).
 */
export function useComposicion({ agrupacionId, abierta, cuerpo, huella }: { agrupacionId: string; abierta: boolean; cuerpo: CalcularAgrupacionCuerpo | null; huella: string | null }) {
  const [estado, setEstado] = useState<Estado>({ datos: null, error: null });
  const [intento, setIntento] = useState(0);
  const url = `/api/curvas/agrupaciones/${agrupacionId}/composicion`;
  const cuerpoJson = cuerpo ? JSON.stringify(cuerpo) : null;

  useEffect(() => {
    if (!abierta || cuerpoJson === null || huella === null) return;
    const c = new AbortController();
    api
      .post<ComposicionAgrupacionApi>(url, JSON.parse(cuerpoJson) as CalcularAgrupacionCuerpo, { signal: c.signal })
      .then((d) => {
        if (c.signal.aborted) return;
        if (d.huella_calculo !== huella) {
          setEstado((e) => ({ ...e, error: { mensaje: "La composición se calculó con otros datos que el gráfico (cambió algo mientras se leía). Vuelve a intentarlo.", huella } }));
          return;
        }
        setEstado({ datos: d, error: null });
      })
      .catch((err: unknown) => {
        if (c.signal.aborted) return;
        setEstado((e) => ({ ...e, error: { mensaje: mensajeError(err), huella } }));
      });
    return () => c.abort();
  }, [abierta, cuerpoJson, huella, url, intento]);

  const reintentar = useCallback(() => setIntento((i) => i + 1), []);
  const datos = estado.datos;
  const actual = datos !== null && datos.huella_calculo === huella;
  const error = estado.error && estado.error.huella === huella ? estado.error.mensaje : null;
  /** Hay una lectura pedida o en camino para la huella actual. */
  const cargando = abierta && cuerpoJson !== null && !actual && error === null;
  return { datos, actual, cargando, error, reintentar, limpiarError: () => setEstado((e) => ({ ...e, error: null })) };
}
