"use client";

import { useState } from "react";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { ImportarEstacionalidad } from "./importar-estacionalidad";
import { ImportarAgrupaciones } from "./importar-agrupaciones";

export type TipoImportacionEstacionalidad = "equivalencias" | "agrupaciones";

const CHIPS: ChipItem<TipoImportacionEstacionalidad>[] = [
  { id: "equivalencias", label: "Equivalencias" },
  { id: "agrupaciones", label: "Agrupaciones" },
];

const DESCRIPCION: Record<TipoImportacionEstacionalidad, string> = {
  equivalencias: "Asigna equivalencias a agrupaciones (GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION). Crea las agrupaciones que falten.",
  agrupaciones: "Crea agrupaciones nuevas en bloque (NOMBRE, CODIGO, GENEROS, TEMPORADA…). Solo crea: las que ya existen no se tocan.",
};

/** Pestaña Importar: dos importadores con el mismo flujo de cuatro pasos. Cada uno se remonta al cambiar de tipo. */
export function ImportarPanel({ onAplicado }: { onAplicado: (tipo: TipoImportacionEstacionalidad) => void }) {
  const [tipo, setTipo] = useState<TipoImportacionEstacionalidad>("equivalencias");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Chips items={CHIPS} activo={tipo} onCambiar={setTipo} etiqueta="Qué importar" />
        <p className="text-sm text-tinta-suave">{DESCRIPCION[tipo]}</p>
      </div>
      {tipo === "equivalencias" && <ImportarEstacionalidad key="equivalencias" onAplicado={() => onAplicado("equivalencias")} />}
      {tipo === "agrupaciones" && <ImportarAgrupaciones key="agrupaciones" onAplicado={() => onAplicado("agrupaciones")} />}
    </div>
  );
}
