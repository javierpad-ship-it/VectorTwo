// Tipos del endpoint POST /api/reportes/agrupacion-gmle/unidades-mensuales
// (M11 · histograma de unidades vendidas por mes en el Resumen del reporte).
// Sin dependencias de servidor: los puede importar el cliente.

export type MesUnidades = {
  /** Mes en formato "YYYY-MM". */
  periodo: string;
  /** Unidades netas (las devoluciones restan). */
  unidades: number;
  /** Venta en soles, redondeada a 2 decimales. */
  venta_soles: number;
};

export type UnidadesMensuales = {
  /** Orden cronológico ascendente. */
  meses: MesUnidades[];
  total_unidades: number;
  total_venta_soles: number;
  /** Nº de equivalencias pedidas (sin duplicados); null = todas. */
  equivalencias: number | null;
};

export type PeticionUnidadesMensuales = {
  /** Omitido = todas las equivalencias. Vacío = respuesta vacía sin consultar. */
  equivalencia_ids?: string[];
};
