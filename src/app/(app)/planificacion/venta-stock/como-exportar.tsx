/** Instrucciones de exportación de QlikView y orden de carga (ficha M5, "Cómo exportar de QlikView" y "Orden de carga"). */
export function ComoExportar() {
  return (
    <details className="rounded-lg border border-borde bg-fondo px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-marca-oscura">Cómo exportar de QlikView</summary>
      <div className="mt-3 space-y-4 text-tinta">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Un objeto tipo <strong>tabla simple</strong> con las 14 columnas (<code className="font-mono text-xs">AÑO, MES, TIENDA, GENERO_LK, MUNDO_LK, LINEA_SAP_LK, EQUIVALENCIAS_LK, MARCA, TALLA_e, Stk Fin Act, Unv vta, Vta S/, Costo Vta, Stk Val Act</code>),{" "}
            <strong>sin fila de totales</strong> y con todas las marcas (sin agrupar).
          </li>
          <li>
            Exportar como <strong>CSV con cabecera</strong> (delimitado por comas). Si el diálogo deja elegir la codificación, UTF-8 (con BOM sirve).
          </li>
          <li>
            Números <strong>sin separador de miles</strong> y con <strong>punto decimal</strong>. Hoy salen como soles enteros y es aceptable (error máximo por fila de S/ 0,50);
            opcionalmente, fija dos decimales en el formato numérico del objeto.
          </li>
          <li>
            <strong>Un archivo por año o semestre</strong> (un año son unas 400 mil filas y 33 MB). Por mes solo para probar; evita archivos de varios años.
          </li>
          <li>
            <strong>Meses cerrados</strong>: de enero de 2023 al último mes cerrado. Un mes abierto se puede subir, pero pide confirmación porque su venta está incompleta.
          </li>
          <li>Apunta los <strong>totales de QlikView</strong> de cada mes (unidades, venta, costo, stock en unidades y stock valorizado): el reporte previo los pide, opcionalmente, para conciliar.</li>
        </ol>
        <div>
          <p className="font-medium">Antes de cargar la venta, en este orden</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-tinta-suave">
            <li>Marcas con su agrupación y tratamiento especial (Agrupaciones y marcas → Importar).</li>
            <li>Tiendas (con el centro de distribución) y, desactivadas, las que no deben cargarse (la central y las oficinas).</li>
            <li>Combinaciones nuevas del árbol (descárgalas del reporte previo en formato árbol).</li>
            <li>Un mes de prueba y, después, el resto del histórico, un archivo por año.</li>
          </ol>
        </div>
      </div>
    </details>
  );
}
