import type { CampoImportador } from "@/components/importador/tipos";
import type { CampoVenta } from "./tipos";

/**
 * Los 14 campos del archivo de QlikView y sus nombres de columna (ficha,
 * "Estructura del archivo"). `alias` lleva los CÓDIGOS (`aCodigo`: sin
 * acentos ni caja, solo letras, dígitos y `_`), no los nombres con espacios:
 * `AÑO` → `ANO`, `Vta S/` → `VTA_S`. El BOM no estorba: `transformHeader`
 * hace `trim()` y `aCodigo` descarta lo que no sea letra o dígito.
 *
 * Se usa con `detectarMapeo` y `mapeoCompleto` de
 * `src/components/importador/mapeo.ts`.
 */
export const CAMPOS_ARCHIVO_VENTA: CampoImportador<CampoVenta>[] = [
  {
    campo: "anio",
    etiqueta: "Año",
    alias: ["ANO", "ANIO", "YEAR"],
    opcional: true,
    hint: "Sin año, la columna del mes debe traerlo (por ejemplo 2026-09).",
  },
  { campo: "mes", etiqueta: "Mes", alias: ["MES", "PERIODO", "FECHA"] },
  { campo: "tienda", etiqueta: "Tienda", alias: ["TIENDA", "LOCAL", "COD_TDA", "CODIGO_TIENDA"] },
  { campo: "genero", etiqueta: "Género", alias: ["GENERO_LK", "GENERO"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO_LK", "MUNDO", "GRUPO_PRODUCTO"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA_SAP_LK", "LINEA"] },
  { campo: "equivalencia", etiqueta: "Equivalencia", alias: ["EQUIVALENCIAS_LK", "EQUIVALENCIA"] },
  { campo: "marca", etiqueta: "Marca", alias: ["MARCA"] },
  { campo: "talla", etiqueta: "Talla", alias: ["TALLA_E", "TALLA", "AGRUPACION_TALLA"] },
  { campo: "unidades", etiqueta: "Unidades vendidas", alias: ["UNV_VTA", "UNIDADES"] },
  { campo: "venta_soles", etiqueta: "Venta (S/)", alias: ["VTA_S", "VENTA_SOLES", "VENTA"] },
  { campo: "costo_vendido", etiqueta: "Costo vendido (S/)", alias: ["COSTO_VTA", "COSTO_VENDIDO", "COSTO"] },
  { campo: "stock_unidades", etiqueta: "Stock fin de mes (unidades)", alias: ["STK_FIN_ACT", "STOCK_UNIDADES", "STOCK"] },
  { campo: "stock_valorizado", etiqueta: "Stock valorizado (S/)", alias: ["STK_VAL_ACT", "STOCK_VALORIZADO"] },
];

/** Los 14 encabezados exactos de QlikView, para pruebas y ayudas. */
export const ENCABEZADOS_QLIKVIEW = [
  "AÑO",
  "MES",
  "TIENDA",
  "GENERO_LK",
  "MUNDO_LK",
  "LINEA_SAP_LK",
  "EQUIVALENCIAS_LK",
  "MARCA",
  "TALLA_e",
  "Stk Fin Act",
  "Unv vta",
  "Vta S/",
  "Costo Vta",
  "Stk Val Act",
] as const;
