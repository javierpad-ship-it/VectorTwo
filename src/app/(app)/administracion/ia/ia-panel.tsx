"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { ConfiguracionTab } from "./configuracion-tab";
import { EvaluacionesTab } from "./evaluaciones-tab";
import { UsoTab } from "./uso-tab";

type Pestana = "configuracion" | "evaluaciones" | "uso";

export const PESTANAS_IA: readonly { id: Pestana; etiqueta: string }[] = [
  { id: "configuracion", etiqueta: "Configuración" },
  { id: "evaluaciones", etiqueta: "Evaluaciones" },
  { id: "uso", etiqueta: "Uso" },
];

/**
 * Administración → Motor de IA (ficha 07e, §4.5; solo admin). Configuración versionada (la vigente gobierna la IA), evaluaciones (backtests
 * que deciden si una capacidad puede encenderse) y uso (costo, corridas). Todo por `/api/ia/*` con `requireAdmin`.
 */
export function IaPanel() {
  const [pestana, setPestana] = useState<Pestana>("configuracion");
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">Motor de IA</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          La IA hace la primera propuesta de cada fila de la meta; nunca decide. Solo se enciende una capacidad cuando una evaluación (backtest) del mismo proveedor, modelo y prompt le ganó al mejor de dos rivales: el método actual y una regla
          de tendencia.
        </p>
      </div>
      <Tabs<Pestana> items={PESTANAS_IA.map((p) => ({ id: p.id, label: p.etiqueta }))} activa={pestana} onCambiar={setPestana} />
      {pestana === "configuracion" && <ConfiguracionTab />}
      {pestana === "evaluaciones" && <EvaluacionesTab />}
      {pestana === "uso" && <UsoTab />}
    </div>
  );
}
