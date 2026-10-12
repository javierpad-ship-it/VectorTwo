"use client";

import { useCallback, useState } from "react";
import { formatearNumero } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { CargarTab } from "./cargar-tab";
import { CargasTab } from "./cargas-tab";
import { nombrePeriodo } from "./comunes";
import { ProveedorMapeos } from "./contexto-mapeos";
import { MapeosTab } from "./mapeos-tab";
import { useCargas } from "./use-cargas";
import { useMapeos } from "./use-mapeos";

type Pestana = "cargar" | "cargas" | "mapeos";

/**
 * Pantalla /planificacion/venta-stock (M5 y M5b). Un solo panel con tres pestañas:
 * Cargar (archivo de QlikView → reporte previo → publicación mes a mes),
 * Cargas por mes (cobertura, retiro, verificación, limpieza) y Mapeos
 * (combinaciones históricas que se reasignan a un GML o GMLE vigente). Admin y
 * planner tienen las mismas acciones; el comprador no entra (menú y página).
 */
export function VentaStockPanel() {
  const [pestana, setPestana] = useState<Pestana>("cargar");
  const cargas = useCargas();
  const mapeos = useMapeos();
  const recargarMapeos = mapeos.recargar;

  /** Al entrar a Mapeos se vuelve a leer la lista (pudo cambiar desde el reporte previo). */
  const elegirPestana = useCallback(
    (p: Pestana) => {
      setPestana(p);
      if (p === "mapeos") void recargarMapeos();
    },
    [recargarMapeos]
  );
  const irAMapeos = useCallback(() => elegirPestana("mapeos"), [elegirPestana]);
  const meta = cargas.datos?.meta;

  const cargados = meta?.meses_cargados ?? 0;
  const ultimoMes = meta?.ultimo_cargado ?? null;
  const filas = meta?.filas_total ?? 0;

  return (
    <ProveedorMapeos irAMapeos={irAMapeos}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Carga de venta, costo y stock</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Histórico mensual exportado de QlikView. Cada carga es un mes completo que reemplaza a ese mes; un corte a medias nunca deja un mes
            parcial a la vista.
          </p>
        </div>

        <Tabs<Pestana>
          items={[
            { id: "cargar", label: "Cargar" },
            { id: "cargas", label: "Cargas por mes" },
            { id: "mapeos", label: "Mapeos" },
          ]}
          activa={pestana}
          onCambiar={elegirPestana}
        />

        {pestana !== "mapeos" && (
          <p className="text-sm text-tinta-suave">
            {meta ? (
              <>
                {formatearNumero(cargados)} de {formatearNumero(meta.meses_esperados)} meses cargados
                {ultimoMes ? <> · último mes cargado: {nombrePeriodo(ultimoMes)}</> : null} · {formatearNumero(filas)} filas
              </>
            ) : cargas.cargando ? (
              "Cargando el estado de las cargas…"
            ) : (
              "Sin información de cargas."
            )}
            {cargas.cargando && meta && <span className="ml-2 italic">Actualizando…</span>}
          </p>
        )}

        {pestana === "cargar" && cargas.error && <Alert onCerrar={() => cargas.setError(null)}>No se pudo leer el estado de las cargas: {cargas.error}</Alert>}

        {/* La pestaña Cargar se mantiene montada: cambiar de pestaña no debe perder un archivo leído ni una carga en marcha. */}
        <div hidden={pestana !== "cargar"}>
          <CargarTab onPublicado={() => void cargas.recargar()} />
        </div>
        {pestana === "cargas" && <CargasTab cargas={cargas} onCambio={() => void cargas.recargar()} />}
        {pestana === "mapeos" && <MapeosTab mapeos={mapeos} />}
      </div>
    </ProveedorMapeos>
  );
}
