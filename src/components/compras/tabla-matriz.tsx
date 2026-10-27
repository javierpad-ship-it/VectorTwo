import { encabezadoColumna, type CeldaMatriz, type ColumnaMatriz, type FilaMatriz, type TonoCelda } from "./matriz";

const CLASE_TONO: Record<TonoCelda, string> = {
  normal: "text-tinta",
  alerta: "font-semibold text-alerta",
  marca: "font-semibold text-marca-oscura",
  exito: "text-exito",
  suave: "text-tinta-suave",
};

/**
 * Tabla de meses en columnas y magnitudes en filas (ficha 08 §4.3). La primera columna queda fija al desplazar en horizontal, así en el
 * celular el nombre de la magnitud no se pierde; el scroll es del contenedor, nunca de la página. Los meses cerrados llevan un fondo
 * suave y el último mes publicado (`k'`) cierra el bloque con una línea más gruesa.
 */
export function TablaMatriz({ columnas, filas, titulo }: { columnas: readonly ColumnaMatriz[]; filas: readonly FilaMatriz[]; titulo: string }) {
  const esCerrado = (c: ColumnaMatriz) => c.fase !== "horizonte";
  const claseColumna = (c: ColumnaMatriz) => `${esCerrado(c) ? "bg-neutro-suave/60" : ""} ${c.fase === "k" ? "border-r-2 border-borde" : ""}`;
  const celda = (c: CeldaMatriz) => (
    <span title={c.ayuda} className={CLASE_TONO[c.tono ?? "normal"]}>
      {c.texto}
    </span>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-max min-w-full text-sm">
        <caption className="sr-only">{titulo}</caption>
        <thead className="text-xs text-tinta-suave">
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-44 min-w-44 max-w-52 border-b border-borde bg-neutro-suave px-3 py-2 text-left font-medium uppercase tracking-wide md:w-64 md:min-w-64 md:max-w-72">
              Magnitud
            </th>
            {columnas.map((c) => (
              <th key={c.periodo} scope="col" className={`whitespace-nowrap border-b border-borde px-3 py-2 text-right font-medium ${esCerrado(c) ? "bg-neutro-suave" : "bg-neutro-suave/40"} ${c.fase === "k" ? "border-r-2" : ""}`}>
                {encabezadoColumna(c)}
                {c.fase === "k" && <span className="block text-[10px] font-normal normal-case">último publicado</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">
          {filas.map((f) => (
            <tr key={f.clave} className={f.fuerte ? "bg-superficie" : "bg-superficie/60"}>
              <th
                scope="row"
                title={f.ayuda}
                className={`sticky left-0 z-10 w-44 min-w-44 max-w-52 border-r border-borde bg-superficie px-3 py-1.5 text-left text-xs leading-snug md:w-64 md:min-w-64 md:max-w-72 ${f.fuerte ? "font-semibold text-tinta" : "font-normal text-tinta-suave"}`}
              >
                {f.etiqueta}
              </th>
              {f.celdas.map((c, i) => (
                <td key={columnas[i]?.periodo ?? i} className={`whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums ${claseColumna(columnas[i])}`}>
                  {celda(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
