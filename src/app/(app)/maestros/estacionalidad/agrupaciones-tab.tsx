"use client";

import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";
import { compararPorNombre } from "@/lib/estacionalidad/generos";
import { useColeccion } from "@/lib/use-coleccion";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import {
  CatalogoPlano,
  type DescripcionCatalogo,
  type GenerosCatalogo,
  type HijosCatalogo,
  type SelectorCatalogo,
} from "@/components/catalogo/catalogo-plano";
import { OPCIONES_TEMPORADA } from "@/components/estacionalidad/temporada";

/** Fila de `/api/generos` (solo lo que usa el selector). */
type GeneroCatalogo = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };

/** La fila ya trae la temporada de M6 (`temporada`) y la que sugieren las líneas de sus equivalencias activas. */
type FilaAgrupacion = AgrupacionEstacionalidadFila;

const TEMPORADA: SelectorCatalogo<FilaAgrupacion> = {
  clave: "temporada",
  etiqueta: "Temporada",
  opciones: OPCIONES_TEMPORADA,
  porDefecto: "todo_el_ano",
  obtener: (a) => a.temporada,
  sugerida: (a) => (a.temporada_sugerida_distinta ?? a.temporada_sugerida !== a.temporada ? a.temporada_sugerida : null),
  etiquetaSugerida: "Sugerida por sus líneas",
  hint: "Las agrupaciones de invierno son las que afecta El Niño (M6). Toda temporada no se ajusta por periodos atípicos de invierno.",
  tonos: { invierno: "marca", verano: "alerta", todo_el_ano: "neutro" },
};

const DESCRIPCION: DescripcionCatalogo<FilaAgrupacion> = {
  obtener: (a) => a.descripcion,
  max: 500,
  hint: "Para qué sirve la curva (p. ej. «Líneas de invierno con pico en mayo-junio»); opcional.",
};

/**
 * Pestaña Agrupaciones: el catálogo plano (orden · código · nombre · géneros ·
 * descripción · temporada · equivalencias · estado) con alta y edición en un diálogo. Cada
 * agrupación pertenece a uno o más géneros (obligatorio); la que no tiene
 * ninguno sale resaltada con "Sin género". La temporada (Invierno / Verano / Toda
 * temporada) la fija el planner; si difiere de la que sugieren las líneas, la
 * fila lo avisa con un botón para aplicarla. Se presenta por nombre. El conteo
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
  const generos: GenerosCatalogo<FilaAgrupacion> = {
    obtener: (a) => a.generos,
    catalogo: generosApi.datos,
    cargando: generosApi.cargando,
  };

  const hijos: HijosCatalogo<FilaAgrupacion> = {
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
      <CatalogoPlano<FilaAgrupacion>
        recurso="agrupaciones-estacionalidad"
        singular="agrupación"
        plural="agrupaciones"
        genero="f"
        puedeEditar={puedeEditar}
        hijos={hijos}
        vigentes={(a) => a.equivalencias_activas}
        descripcion={DESCRIPCION}
        generos={generos}
        selector={TEMPORADA}
        ordenar={compararPorNombre}
        notaPie="Una equivalencia solo puede asignarse a una agrupación que incluya su género; sin género, la agrupación no acepta asignaciones, y no se puede quitar un género con equivalencias de ese género. Desactivar conserva las asignaciones (sus equivalencias pasan a faltantes hasta que la reactives); eliminar solo es posible sin equivalencias."
        avisoSoloLectura="Las agrupaciones de estacionalidad las mantiene planificación. Acá puedes consultarlas."
        onCambio={onCambio}
      />
    </div>
  );
}
