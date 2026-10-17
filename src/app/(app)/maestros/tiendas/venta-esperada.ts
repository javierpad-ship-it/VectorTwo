// Texto de ayuda de la venta esperada de una tienda nueva (07d, 0.10.8). Lo comparten el formulario de Tiendas (M4), el
// importador y el atajo de la tarjeta de M7, para que las tres pantallas digan lo mismo.

/**
 * `tiendas.venta_esperada_promedio` es la venta MENSUAL promedio esperada, ya en régimen y sin IGV. M7 la multiplica por 12
 * y la reparte con la estacionalidad en los meses en que la tienda esté abierta. El sistema nunca convierte IGV.
 */
export const AYUDA_VENTA_MENSUAL =
  "Soles que la tienda venderá en un mes promedio, ya en régimen y sin IGV. M7 la multiplica por 12 y la reparte con la estacionalidad en los meses en que la tienda esté abierta: si abre en marzo, en ese año solo cuentan de marzo a diciembre.";
