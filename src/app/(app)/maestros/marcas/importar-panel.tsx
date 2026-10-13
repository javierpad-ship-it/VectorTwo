"use client";

import { useState } from "react";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { ImportarMarcas } from "./importar-marcas";
import { ImportarConjuntos } from "./importar-conjuntos";
import { ImportarGml } from "./importar-gml";

type Tipo = "marcas" | "conjuntos" | "gml";

const CHIPS: ChipItem<Tipo>[] = [
  { id: "marcas", label: "Marcas" },
  { id: "conjuntos", label: "Conjuntos" },
  { id: "gml", label: "Marcas relevantes por GML" },
];

const DESCRIPCION: Record<Tipo, string> = {
  marcas: "Lista de marcas con su agrupación, tratamiento especial y (opcional) conjunto. Solo crea marcas nuevas.",
  conjuntos: "Hoja MARCA, CONJUNTO: arma conjuntos de marcas. El archivo manda; crea las cabezas que falten.",
  gml: "Hoja MARCA, GENERO, MUNDO, LINEA: marcas relevantes por GML. Carga, no sincroniza: no quita lo que el archivo no traiga.",
};

/** Pestaña Importar: tres importadores con el mismo flujo de cuatro pasos. Cada uno se remonta al cambiar de tipo. */
export function ImportarPanel({ onAplicado }: { onAplicado: (tipo: Tipo) => void }) {
  const [tipo, setTipo] = useState<Tipo>("marcas");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Chips items={CHIPS} activo={tipo} onCambiar={setTipo} etiqueta="Qué importar" />
        <p className="text-sm text-tinta-suave">{DESCRIPCION[tipo]}</p>
      </div>
      {tipo === "marcas" && <ImportarMarcas key="marcas" onAplicado={() => onAplicado("marcas")} />}
      {tipo === "conjuntos" && <ImportarConjuntos key="conjuntos" onAplicado={() => onAplicado("conjuntos")} />}
      {tipo === "gml" && <ImportarGml key="gml" onAplicado={() => onAplicado("gml")} />}
    </div>
  );
}
