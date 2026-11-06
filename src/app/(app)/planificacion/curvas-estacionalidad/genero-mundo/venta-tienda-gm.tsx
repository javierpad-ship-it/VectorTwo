"use client";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ContenidoVentaPorTienda, useVentaPorTienda } from "../../proyeccion/venta-por-tienda";

/**
 * «Venta por tienda y año» dentro del detalle de un género × mundo (o del Resto): las mismas cifras de la pestaña Crecimientos de Proyección (ficha 07f), pero
 * aquí, donde se decide el crecimiento. SOLO LECTURA: lee `GET /api/proyeccion/proyecciones/[id]/crecimientos/por-tienda?gm=<clave>` (`requirePlanner`) con la
 * proyección de referencia que ya usa la lista. Sin proyección de referencia no hay de dónde leer el reparto por tienda y lo dice con la salida.
 */
export function VentaTiendaGM({ proyeccionId, clave, anio }: { proyeccionId: string | null; clave: string; anio: number }) {
  return (
    <Card
      titulo="Venta por tienda y año"
      descripcion={`Qué vendió cada tienda año por año en este género × mundo, y qué tiendas hay detrás de la base de ${anio}. Para decidir el crecimiento tienda por tienda; no cambia nada.`}
    >
      {proyeccionId === null ? (
        <Alert tono="info">
          Falta una proyección de referencia de {anio - 1} para leer la venta por tienda. Elige o calcula una en Proyección y vuelve a abrir este género × mundo.
        </Alert>
      ) : (
        <LecturaPorTienda proyeccionId={proyeccionId} clave={clave} />
      )}
    </Card>
  );
}

function LecturaPorTienda({ proyeccionId, clave }: { proyeccionId: string; clave: string }) {
  const lectura = useVentaPorTienda(proyeccionId, clave);
  if (lectura.error) {
    return (
      <Alert tono="alerta" onCerrar={() => lectura.setError(null)}>
        <span className="block">{lectura.error}</span>
        <button type="button" className="mt-1 text-sm font-medium underline" onClick={() => void lectura.recargar()}>
          Reintentar
        </button>
      </Alert>
    );
  }
  if (!lectura.datos) return <p className="text-sm text-tinta-suave">Leyendo la venta por tienda…</p>;
  return <ContenidoVentaPorTienda datos={lectura.datos} proyeccion={{ desactualizada: [] }} />;
}
