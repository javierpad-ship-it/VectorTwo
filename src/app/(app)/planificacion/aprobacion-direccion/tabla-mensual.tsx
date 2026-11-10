import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { MESES, rangoMeses } from "@/components/direccion/formato";
import { filasTablaMensual, ID_TABLA_MENSUAL, TEXTO_SIN_CARGA, type FilaMensual } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const FIJA = "sticky left-0 z-10 bg-superficie";

/**
 * El texto solo para lector de pantalla (`sr-only`, posición absoluta) va SIEMPRE dentro de un `relative`: si no, dentro de una tabla que se desplaza
 * su posición cuenta para el ancho de la página y aparece un desplazamiento horizontal de toda la pantalla.
 */
function Celda({ fila, texto }: { fila: FilaMensual; texto: string }) {
  if (texto === "—") {
    const motivo = fila.proyectado || fila.variacion ? "sin dato" : TEXTO_SIN_CARGA;
    return (
      <span title={motivo} className="relative text-tinta-suave">
        —<span className="sr-only"> ({motivo})</span>
      </span>
    );
  }
  if (!fila.proyectado) return <>{texto}</>;
  return (
    <span className="relative italic" title="proy.">
      <span className="sr-only">proy. </span>
      {texto}
    </span>
  );
}

/**
 * Tabla mensual (ficha 14, §4.8): la alternativa exacta del gráfico. Una fila por serie y por variación; columnas de enero a diciembre, el total y
 * enero a `k'`. Lo real va en redonda; lo proyectado, en cursiva Y con «proy.» en el `title` y para el lector de pantalla. Un mes sin carga sale
 * «—». La primera columna queda fija y la tabla se desplaza dentro de su contenedor.
 */
export function TablaMensual({ tablero }: { tablero: TableroApi }) {
  const filas = filasTablaMensual(tablero);
  const columnas: Columna<FilaMensual>[] = [
    {
      clave: "fila",
      titulo: "Serie",
      className: `${FIJA} min-w-40`,
      render: (f) => (
        <span className={f.proyectado ? "italic" : undefined}>
          {f.etiqueta}
          {f.estimado && (
            <span className="ml-1.5 not-italic">
              <Badge tono="alerta">estimado</Badge>
            </span>
          )}
        </span>
      ),
    },
    ...MESES.map((m, i): Columna<FilaMensual> => ({ clave: m, titulo: m, className: NUM, render: (f) => <Celda fila={f} texto={f.celdas[i]} /> })),
    { clave: "total", titulo: "Total", className: `${NUM} font-semibold`, render: (f) => <Celda fila={f} texto={f.total} /> },
    { clave: "acumulado", titulo: rangoMeses(1, tablero.datos.k_prima), className: NUM, render: (f) => <Celda fila={f} texto={f.acumulado} /> },
  ];
  return (
    <div id={ID_TABLA_MENSUAL} className="space-y-2">
      <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.clave} claseFila={(f) => (f.variacion ? "bg-neutro-suave/40 text-tinta-suave" : undefined)} vacio="Sin serie mensual." />
      <p className="text-xs text-tinta-suave">
        Unidades. Lo proyectado va en <span className="italic">cursiva</span> (proy.); «—» es un mes sin carga publicada o sin dato. Las filas de variación van en %.
      </p>
    </div>
  );
}
