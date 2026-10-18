import type { ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { descargarLibro } from "../../planificacion/proyeccion/descarga-libro";
import { hojasReglas, NOMBRE_ARCHIVO_REGLAS, type FiltrosTexto } from "./excel-vista";

/**
 * Excel de la lista (las filas visibles con los filtros). SheetJS se carga bajo demanda con `import()` dentro de `descargarLibro`
 * (patrón de M7, M11 y M12); aquí solo se arman las hojas con los datos que la pantalla ya tiene, sin llamar a ninguna ruta nueva.
 */
export async function descargarReglas(visibles: readonly ReglaIntercompanyApi[], filtros: FiltrosTexto): Promise<void> {
  await descargarLibro(hojasReglas(visibles, filtros), NOMBRE_ARCHIVO_REGLAS);
}
