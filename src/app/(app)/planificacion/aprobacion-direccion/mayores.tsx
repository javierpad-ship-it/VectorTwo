import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { FILAS_MAYORES, type TableroApi } from "@/lib/direccion/tipos-api";
import { filasMayores, type FilaMayor } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

/** Las filas mayores (GML × agrupación de marca) del recorte en el año siguiente, con su participación y su crecimiento sobre su base (ficha 14, §4.8). */
export function Mayores({ tablero }: { tablero: TableroApi }) {
  const y1 = tablero.proyeccion.anio_siguiente;
  const columnas: Columna<FilaMayor>[] = [
    { clave: "fila", titulo: "Fila (línea × agrupación de marca)", className: "min-w-56", render: (f) => f.fila },
    { clave: "vigente", titulo: `${y1}`, className: NUM, render: (f) => f.vigente },
    { clave: "participacion", titulo: `Part. ${y1}`, className: NUM, render: (f) => f.participacion },
    { clave: "crecimiento", titulo: "Crecimiento sobre su base", className: NUM, render: (f) => f.crecimiento },
  ];
  return (
    <Card titulo={`Las ${FILAS_MAYORES} filas mayores`} descripcion={`Del recorte, por lo proyectado para ${y1} en las mismas tiendas.`}>
      <DataTable columnas={columnas} filas={filasMayores(tablero.mayores)} claveFila={(f) => f.fila} vacio="Sin filas en este recorte." />
    </Card>
  );
}
