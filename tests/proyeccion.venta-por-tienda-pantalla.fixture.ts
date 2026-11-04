import type { VentaPorTiendaApi } from "../src/lib/proyeccion/tipos-api";
import { armarVentaPorTienda, vigentesDeTiendasNuevas, type EntradaVentaPorTienda, type FilaTiendaNueva, type SerieVentaTienda } from "../src/lib/proyeccion/venta-por-tienda";
import {
  bloquesFixture,
  entradaMujerUrbano,
  FILAS_BASE,
  FILAS_TIENDA,
  filasBaseDe,
  GM_MU,
  maestroVenta,
  NODO,
  seriesPorNodo,
  ventaTiendaFalsa,
  Y,
  K,
} from "./proyeccion.venta-por-tienda.fixture";

/**
 * Datos de la pantalla «Ver por tienda» (ficha 07f). Parten del caso sintético de §8 del backend (`proyeccion.venta-por-tienda.fixture.ts`) y pasan por la MISMA
 * función que arma la respuesta de la API (`armarVentaPorTienda`), así que la pantalla se prueba contra el contrato real y no contra una copia a mano. Cifras
 * sintéticas: ningún dato real de Lukers.
 */

export { GM_MU, Y, K };

/** MUJER · URBANO de §8: T01, T02 y T03 mismas; T10 entra; T04 sale; T11 abrió en 2026; T09 cerró en 2024; sin CD. `Σ B = 15 600`, `Σ B' = 16 400`. */
export const ventaMujerUrbano = (): VentaPorTiendaApi => armarVentaPorTienda(entradaMujerUrbano());

/** Lo mismo con la carga de marzo de 2024 sin publicar (el periodo 2024 trae `meses_faltantes` y sus variaciones salen «incompleto»). */
export function ventaConMesFaltante(): VentaPorTiendaApi {
  const falta = "2024-03";
  const nodos = [NODO.mu1, NODO.mu2];
  const v = ventaTiendaFalsa({ p_gml_ids: nodos, p_desde: "2023-01-01", p_hasta: "2026-09-01" }, { sinCargas: [falta] });
  return armarVentaPorTienda(entradaMujerUrbano({ series: v.series.filter((s) => s.p !== falta), cargas: v.cargas }));
}

/** Sin venta publicada de ninguna tienda: todo `R` de la base queda en «Sin atribuir a tienda». */
export const ventaSinAtribuir = (): VentaPorTiendaApi => armarVentaPorTienda(entradaMujerUrbano({ series: [] }));

/** Proyección de método 3: `base.total = null` y `motivo_nulo = metodo_anterior`; las columnas reales se muestran igual. */
export const ventaMetodoAnterior = (): VentaPorTiendaApi => armarVentaPorTienda(entradaMujerUrbano({ versionMetodo: 3 }));

/** Un GM sin filas base de `Y+1`: `motivo_nulo = sin_filas`. */
export const ventaSinFilas = (): VentaPorTiendaApi => armarVentaPorTienda(entradaMujerUrbano({ filasBase: [] }));

/** Una tienda creada después de calcular, con venta: estado `sin_bloque` y su aviso. */
export function ventaConSinBloque(): VentaPorTiendaApi {
  const extra: SerieVentaTienda[] = Array.from({ length: 9 }, (_, i) => ({ t: "00000001-0000-4000-8000-000000000012", p: `2026-${String(i + 1).padStart(2, "0")}`, u: 10, s: 500 }));
  return armarVentaPorTienda(entradaMujerUrbano({ series: [...entradaMujerUrbano().series, ...extra] }));
}

/** El Resto (NIÑO · URBANO): solo T01 vendió; la base son las filas de `nu`. */
export function ventaResto(): VentaPorTiendaApi {
  const nodos = [NODO.nu];
  const conB = new Set(FILAS_BASE.filter((f) => nodos.includes(f.nodo) && f.b !== null).map((f) => f.clave));
  const nuevas: FilaTiendaNueva[] = FILAS_TIENDA.filter((f) => nodos.includes(f.nodo)).map((f) => ({ tienda_id: f.tienda, clave: `${f.tienda}|${f.nodo}||${f.am}`, vigente: f.decidido ?? f.propuesto ?? 0 }));
  const v = ventaTiendaFalsa({ p_gml_ids: nodos, p_desde: "2023-01-01", p_hasta: "2026-09-01" }, { porNodo: seriesPorNodo() });
  const entrada: EntradaVentaPorTienda = {
    conjunto: { clave: "resto", nombre: "Resto", es_resto: true },
    anio: Y,
    hastaPeriodo: "2026-09",
    k: K,
    versionMetodo: 5,
    series: v.series,
    cargas: v.cargas,
    bloquesY: bloquesFixture()[Y],
    bloquesSig: bloquesFixture()[Y + 1],
    maestro: maestroVenta(),
    filasBase: filasBaseDe(nodos),
    vigentes: vigentesDeTiendasNuevas(nuevas, conB),
    fueraBase: null,
  };
  return armarVentaPorTienda(entrada);
}
