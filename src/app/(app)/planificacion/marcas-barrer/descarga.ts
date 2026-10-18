import type { AnalisisMarcaApi, ListaBarrerApi, MarcaBarrerResumenApi } from "@/lib/marcas-barrer/tipos-api";
import { descargarLibro } from "../proyeccion/descarga-libro";
import { hojasLista, hojasMarca, nombreArchivoMarca, NOMBRE_ARCHIVO_LISTA } from "./excel-vista";
import type { FiltrosLista, OpcionFiltro } from "./vista";

/**
 * Excel de la lista (las filas visibles con los filtros) y de una marca. SheetJS se carga bajo demanda con `import()` dentro de
 * `descargarLibro` (patrón de M7 y M11); aquí solo se arman las hojas con los datos que la pantalla ya tiene, sin llamar a
 * ninguna ruta nueva.
 */
export async function descargarLista(
  datos: ListaBarrerApi,
  visibles: readonly MarcaBarrerResumenApi[],
  filtros: FiltrosLista,
  opciones: { agrupaciones: readonly OpcionFiltro[]; generos: readonly OpcionFiltro[]; mundos: readonly OpcionFiltro[]; lineas: readonly OpcionFiltro[] }
): Promise<void> {
  await descargarLibro(hojasLista(datos.datos, visibles, filtros, opciones), NOMBRE_ARCHIVO_LISTA);
}

export async function descargarMarca(analisis: AnalisisMarcaApi): Promise<void> {
  await descargarLibro(hojasMarca(analisis), nombreArchivoMarca(analisis.marca.nombre));
}
