"use client";

import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import { compararPorNombre } from "@/lib/estacionalidad/generos";
import { useColeccion } from "@/lib/use-coleccion";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { CatalogoPlano, type DescripcionCatalogo, type GenerosCatalogo, type HijosCatalogo } from "@/components/catalogo/catalogo-plano";

/** Fila de `/api/generos` (solo lo que usa el selector). */
type GeneroCatalogo = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };

const DESCRIPCION: DescripcionCatalogo<AgrupacionEstacionalidadFila> = {
  obtener: (a) => a.descripcion,
  max: 500,
  hint: "Para qué sirve la curva (p. ej. «Líneas de invierno con pico en mayo-junio»); opcional.",
};

/**
 * Pestaña Agrupaciones: el catálogo plano (orden · código · nombre · géneros ·
 * descripción · equivalencias · estado) con alta y edición en línea. Cada
 * agrupación pertenece a uno o más géneros (obligatorio); la que no tiene
 * ninguno sale resaltada con "Sin género". Se presenta por nombre. El conteo
 * de equivalencias enlaza a la vista Por agrupación de Asignación.
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
  // Géneros activos e inactivos: el alta ofrece los activos; la edición también
  // muestra los inactivos que la agrupación ya tiene.
  const generosApi = useColeccion<GeneroCatalogo>("/api/generos?incluir_inactivos=1");
  const generos: GenerosCatalogo<AgrupacionEstacionalidadFila> = {
    obtener: (a) => a.generos,
    catalogo: generosApi.datos,
    cargando: generosApi.cargando,
  };

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
    <div className="space-y-6">
      {generosApi.error && (
        <Alert onCerrar={() => generosApi.setError(null)}>No se pudieron cargar los géneros: {generosApi.error}</Alert>
      )}
      <CatalogoPlano<AgrupacionEstacionalidadFila>
        recurso="agrupaciones-estacionalidad"
        singular="agrupación"
        plural="agrupaciones"
        genero="f"
        puedeEditar={puedeEditar}
        hijos={hijos}
        vigentes={(a) => a.equivalencias_activas}
        descripcion={DESCRIPCION}
        generos={generos}
        ordenar={compararPorNombre}
        notaPie="Una equivalencia solo puede asignarse a una agrupación que incluya su género; sin género, la agrupación no acepta asignaciones, y no se puede quitar un género con equivalencias de ese género. Desactivar conserva las asignaciones (sus equivalencias pasan a faltantes hasta que la reactives); eliminar solo es posible sin equivalencias."
        avisoSoloLectura="Las agrupaciones de estacionalidad las mantiene planificación. Acá puedes consultarlas."
        onCambio={onCambio}
      />
    </div>
  );
}
