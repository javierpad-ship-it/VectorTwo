/**
 * Por qué una importación de tiendas no crea nada. Antes la pantalla decía
 * siempre "todas las tiendas válidas del archivo ya existen", también cuando
 * todas las filas tenían errores y la tabla seguía vacía.
 */
export type CausaSinCreaciones = "solo_errores" | "ya_existen" | "sin_filas";

type ReporteMinimo = {
  crear: { tiendas: number; centros_distribucion: number };
  existentes: { tiendas: number };
  existentes_inactivos: { tiendas: number };
  omitidas: { motivo: string }[];
};

/** `null` si la importación sí crea (o creó) tiendas. */
export function causaSinCreaciones(r: ReporteMinimo): CausaSinCreaciones | null {
  if (r.crear.tiendas + r.crear.centros_distribucion > 0) return null;
  if (r.existentes.tiendas + r.existentes_inactivos.tiendas > 0) return "ya_existen";
  // Las repetidas dentro del archivo son informativas; solo cuentan los errores.
  const errores = r.omitidas.filter((o) => o.motivo !== "duplicada_en_archivo").length;
  return errores > 0 ? "solo_errores" : "sin_filas";
}
