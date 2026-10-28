import { descargarLibro } from "@/app/(app)/planificacion/proyeccion/descarga-libro";
import type { CompraApi } from "@/lib/compras/tipos-api";
import { hojasCompras, hojasFlujo, NOMBRE_ARCHIVO_COMPRAS, NOMBRE_ARCHIVO_FLUJO, type FiltroExcelFlujo, type Hoja } from "@/lib/flujo/excel";
import type { ConciliacionApi, FlujoApi } from "@/lib/flujo/tipos-api";

/**
 * Excel de Flujo mensual y de Compras (ficha 08 §4.3 y §4.4). Solo en el navegador: SheetJS se carga bajo demanda con `import()` dentro de
 * `descargarLibro` (patrón de M7, M11, M12 y M13). Las hojas las arman `hojasFlujo` y `hojasCompras` con los datos que la pantalla ya
 * leyó de la API; aquí solo se descartan las hojas vacías y se descarga.
 */

/** `FLUJO`, `SALDO`, `PARAMETROS` y `FILTROS`, más `CONCILIACION` si hay un mes conciliado. */
export async function descargarFlujo(args: { flujo: FlujoApi; conciliacion: ConciliacionApi | null; filtro: FiltroExcelFlujo }): Promise<void> {
  const h = hojasFlujo(args);
  const hojas: Record<string, Hoja> = { FLUJO: h.FLUJO, SALDO: h.SALDO };
  if (h.CONCILIACION) hojas.CONCILIACION = h.CONCILIACION;
  hojas.PARAMETROS = h.PARAMETROS;
  hojas.FILTROS = h.FILTROS;
  await descargarLibro(hojas, NOMBRE_ARCHIVO_FLUJO);
}

/** `COMPRAS`, `ENTREGAS`, `POR_PROVEEDOR` y `COSTO` de las compras de la lista. */
export async function descargarCompras(compras: readonly CompraApi[]): Promise<void> {
  await descargarLibro({ ...hojasCompras(compras) }, NOMBRE_ARCHIVO_COMPRAS);
}
