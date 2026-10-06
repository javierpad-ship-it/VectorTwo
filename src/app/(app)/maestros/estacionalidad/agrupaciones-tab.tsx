"use client";

import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import { plural } from "@/lib/formato";
import { CatalogoPlano, type DescripcionCatalogo, type HijosCatalogo } from "@/components/catalogo/catalogo-plano";

const DESCRIPCION: DescripcionCatalogo<AgrupacionEstacionalidadFila> = {
  obtener: (a) => a.descripcion,
  max: 500,
  hint: "Para qué sirve la curva (p. ej. «Líneas de invierno con pico en mayo-junio»); opcional.",
};

/**
 * Pestaña Agrupaciones: el catálogo plano (orden · código · nombre ·
 * descripción · equivalencias · estado) con alta y edición en línea. El
 * conteo de equivalencias enlaza a la vista Por agrupación de Asignación.
 */
export function AgrupacionesTab({
  puedeEditar,
  onCambio,
  onVerEquivalencias,
}: {
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
  onVerEquivalencias: (agrupacionId: string) => void;
}) {
  const hijos: HijosCatalogo<AgrupacionEstacionalidadFila> = {
    clave: "equivalencias",
    titulo: "Equivalencias",
    avisoDesactivar: (n) =>
      `${n === 1 ? "Su" : "Sus"} ${plural(n, "equivalencia quedará como faltante", "equivalencias quedarán como faltantes")} hasta que la reactives o las reasignes.`,
    bloqueoEliminar: "Tiene equivalencias: desactívala en vez de eliminarla.",
    render: (a, n) =>
      n > 0 ? (
        <button
          type="button"
          onClick={() => onVerEquivalencias(a.id)}
          className="text-sm text-marca-oscura underline-offset-2 hover:underline"
          title="Ver sus equivalencias en Asignación"
        >
          {plural(n, "equivalencia", "equivalencias")}
        </button>
      ) : (
        <span className="text-tinta-suave">{plural(n, "equivalencia", "equivalencias")}</span>
      ),
  };

  return (
    <CatalogoPlano<AgrupacionEstacionalidadFila>
      recurso="agrupaciones-estacionalidad"
      singular="agrupación"
      plural="agrupaciones"
      genero="f"
      puedeEditar={puedeEditar}
      hijos={hijos}
      vigentes={(a) => a.equivalencias_activas}
      descripcion={DESCRIPCION}
      notaPie="Desactivar conserva las asignaciones (sus equivalencias pasan a faltantes hasta que la reactives); eliminar solo es posible sin equivalencias."
      avisoSoloLectura="Las agrupaciones de estacionalidad las mantiene planificación. Acá puedes consultarlas."
      onCambio={onCambio}
    />
  );
}
