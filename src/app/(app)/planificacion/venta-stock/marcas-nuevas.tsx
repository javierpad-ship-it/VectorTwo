"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/form";
import { descargarCsv } from "@/components/importador/csv";
import { formatearNumero, plural } from "@/lib/formato";
import { filasMarcasNuevas } from "@/lib/ventas/resolver";
import { AGRUPACION_COMODINES, type MarcaNuevaInforme } from "@/lib/ventas/tipos";
import type { AgrupacionMarcaApi } from "@/lib/ventas/tipos-api";
import { formatearSoles } from "./comunes";

/**
 * Marcas del archivo que no existen: se muestran todas antes de crearlas, con
 * filas, venta y stock, el posible error de tipeo y la agrupación en la que
 * quedarán. `marcas-nuevas` solo se llama tras confirmar la carga.
 */
export function MarcasNuevas({
  marcas,
  agrupaciones,
  agrupacionId,
  onAgrupacion,
}: {
  marcas: MarcaNuevaInforme[];
  agrupaciones: AgrupacionMarcaApi[];
  agrupacionId: string;
  onAgrupacion: (id: string) => void;
}) {
  if (marcas.length === 0) {
    return <p className="text-sm text-tinta-suave">Todas las marcas del archivo ya existen en Agrupaciones y marcas.</p>;
  }
  const elegida = agrupaciones.find((a) => a.id === agrupacionId);
  const nombreAgrupacion = elegida?.nombre ?? AGRUPACION_COMODINES;
  const tipeos = marcas.filter((m) => m.posible_tipeo);
  const comodines = marcas.filter((m) => m.comodin);
  const sinAgrupacion = !elegida && marcas.some((m) => !m.comodin);

  const columnas: Columna<MarcaNuevaInforme>[] = [
    {
      clave: "nombre",
      titulo: "Marca",
      render: (m) => (
        <div>
          <span className="font-medium">{m.nombre}</span>
          {m.comodin && (
            <span className="ml-2">
              <Badge tono="marca">Comodín: {AGRUPACION_COMODINES}</Badge>
            </span>
          )}
          {m.posible_tipeo && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tono="alerta">Posible error de tipeo</Badge>
              {m.parecida && <span className="text-tinta-suave">¿Será «{m.parecida}»?</span>}
            </div>
          )}
        </div>
      ),
    },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (m) => formatearNumero(m.filas) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (m) => formatearSoles(m.venta_soles) },
    { clave: "stock_u", titulo: "Stock (u.)", className: "text-right font-mono", render: (m) => formatearNumero(m.stock_unidades) },
    { clave: "stock_v", titulo: "Stock a costo", className: "text-right font-mono", render: (m) => formatearSoles(m.stock_valorizado) },
  ];

  function descargar() {
    const { campos, datos } = filasMarcasNuevas(marcas, nombreAgrupacion);
    descargarCsv(campos, datos, "marcas-nuevas.csv");
  }

  return (
    <div className="space-y-3">
      <Alert tono="info">
        <strong>{plural(marcas.length, "marca nueva", "marcas nuevas")}:</strong> todas quedarán en <strong>{nombreAgrupacion}</strong> hasta que las muevas desde{" "}
        <Link href="/maestros/marcas" className="underline underline-offset-2">
          Agrupaciones y marcas
        </Link>
        {comodines.length > 0 && <> (VARIOS, OTROS y SIN MARCA van siempre a {AGRUPACION_COMODINES})</>}. Si ya tienes la lista con su agrupación, cárgala primero con el importador de marcas
        y vuelve a leer: así nacen en su nivel. No se crea nada hasta que confirmes la carga.
      </Alert>
      {tipeos.length > 0 && (
        <Alert>
          {plural(tipeos.length, "marca aparece con una o dos filas", "marcas aparecen con una o dos filas")} en todo el archivo: puede ser un error de tipeo en QlikView. Sin alias, nadie las
          fusionaría después. Corrige el archivo y vuelve a leer si no son reales.
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Agrupación de las marcas nuevas" hint="Los comodines siempre van a MID VALUE." className="w-64">
          <Select value={agrupacionId} onChange={(e) => onAgrupacion(e.target.value)}>
            <option value="">— elige —</option>
            {agrupaciones.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Button variante="secundario" onClick={descargar}>
          Descargar marcas nuevas (MARCA, AGRUPACION)
        </Button>
      </div>
      {sinAgrupacion && <Alert>Elige la agrupación en la que se crearán las marcas nuevas para poder cargar.</Alert>}
      <DataTable columnas={columnas} filas={marcas} claveFila={(m) => m.nombre} claseFila={(m) => (m.posible_tipeo ? "bg-alerta-suave/40" : undefined)} />
    </div>
  );
}
