"use client";

import { useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { DetalleMarca } from "./detalle-marca";
import { ListaMarcas } from "./lista-marcas";
import { consultaVista, leerParametros, type ParametrosVista } from "./vista";

/**
 * Pantalla /planificacion/marcas-barrer (M12): la lista de marcas al barrer y mixtas (paso 0) y, al abrir una, su análisis y
 * el reparto versionado (paso 1). La marca abierta, la ventana, el modo, el Niño y el alcance viven en la URL
 * (`?marca=&ventana=&modo=&genero=&mundo=&lineas=`): recargar o compartir el enlace reabre lo mismo. Se maneja con la API de
 * historial del navegador, que Next integra con `useSearchParams` (patrón de las curvas de M6). Solo admin y planner.
 */
export function MarcasBarrerPanel() {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametros((k) => search.get(k));
  const [aviso, setAviso] = useState<string | null>(null);

  /** Cambia la URL sin recargar: `push` al abrir o cerrar una marca; `replace` para los parámetros. */
  const irA = useCallback(
    (siguiente: ParametrosVista, modo: "push" | "replace") => {
      const url = `${pathname}?${consultaVista(siguiente)}`;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );

  const abrir = (marcaId: string) => {
    setAviso(null);
    irA({ ...parametros, marca: marcaId }, "push");
  };
  const volver = (mensaje?: string) => {
    setAviso(mensaje ?? null);
    irA({ ...parametros, marca: null }, "push");
  };
  const cambiar = (c: Partial<ParametrosVista>) => irA({ ...parametros, ...c }, "replace");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marcas al barrer por GML</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Las marcas al barrer se compran por marca, no por GML. Aquí ves cuánto pesa cada una en cada GML, qué tan estable ha sido su mezcla de un año a otro y apruebas
          el reparto con el que se repartirá una compra de la marca entre los GML. El sistema calcula y propone; el reparto lo aprueba una persona y queda versionado con quién y cuándo.
        </p>
      </div>
      {aviso && !parametros.marca && (
        <Alert tono="info" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}
      {parametros.marca ? (
        <DetalleMarca key={parametros.marca} marcaId={parametros.marca} parametros={parametros} onParametros={cambiar} onVolver={volver} />
      ) : (
        <ListaMarcas parametros={parametros} onCambiar={cambiar} onAbrir={abrir} />
      )}
    </div>
  );
}
