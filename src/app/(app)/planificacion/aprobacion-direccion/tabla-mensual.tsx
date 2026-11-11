import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { MESES, rangoMeses } from "@/components/direccion/formato";
import { filasTablaMensual, ID_TABLA_MENSUAL, notaTablaMensual, TEXTO_SIN_CARGA, type FilaMensual } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const FIJA = "sticky left-0 z-10 bg-superficie";

/**
 * El texto solo para lector de pantalla (`sr-only`, posición absoluta) va SIEMPRE dentro de un `relative`: si no, dentro de una tabla que se desplaza
 * su posición cuenta para el ancho de la página y aparece un desplazamiento horizontal de toda la pantalla.
 */
function Celda({ fila, texto, proyectado }: { fila: FilaMensual; texto: string; proyectado: boolean }) {
  if (texto === "—") {
    const motivo = proyectado || fila.variacion ? "sin dato" : TEXTO_SIN_CARGA;
    return (
      <span title={motivo} className="relative text-tinta-suave">
        —<span className="sr-only"> ({motivo})</span>
      </span>
    );
  }
  if (!proyectado) return <>{texto}</>;
  return (
    <span className="relative italic" title="proy.">
      <span className="sr-only">proy. </span>
      {texto}
    </span>
  );
}

/**
 * Tabla mensual (ficha 14, §4.8): la alternativa exacta del gráfico. Una fila por serie y por variación; columnas de enero a diciembre, el total y
 * enero a `k'`. Lo real va en redonda; lo proyectado, en cursiva Y con «proy.» en el `title` y para el lector de pantalla (mes a mes: en la fila del
 * cierre, de enero a `k` es real). Un mes sin carga sale «—». La primera columna queda fija y la tabla se desplaza dentro de su contenedor. Debajo,
 * la nota del servidor si la trae (por qué «Sin atribuir a tienda» tiene negativos).
 */
export function TablaMensual({ tablero }: { tablero: TableroApi }) {
  const filas = filasTablaMensual(tablero);
  const nota = notaTablaMensual(tablero);
  const columnas: Columna<FilaMensual>[] = [
    {
      clave: "fila",
      titulo: "Serie",
      className: `${FIJA} min-w-40`,
      render: (f) => (
        <span className={f.proyectado ? "relative italic" : "relative"} title={f.composicion ?? undefined}>
          {f.etiqueta}
          {f.composicion && <span className="sr-only"> ({f.composicion})</span>}
          {f.estimado && (
            <span className="ml-1.5 not-italic">
              <Badge tono="alerta">estimado</Badge>
            </span>
          )}
        </span>
      ),
    },
    ...MESES.map((m, i): Columna<FilaMensual> => ({ clave: m, titulo: m, className: NUM, render: (f) => <Celda fila={f} texto={f.celdas[i]} proyectado={f.mesProyectado[i]} /> })),
    { clave: "total", titulo: "Total", className: `${NUM} font-semibold`, render: (f) => <Celda fila={f} texto={f.total} proyectado={f.totalProyectado} /> },
    { clave: "acumulado", titulo: rangoMeses(1, tablero.datos.k_prima), className: NUM, render: (f) => <Celda fila={f} texto={f.acumulado} proyectado={f.proyectado} /> },
  ];
  return (
    <div id={ID_TABLA_MENSUAL} className="space-y-2">
      <DataTable etiqueta="Mes a mes, en unidades" columnas={columnas} filas={filas} claveFila={(f) => f.clave} claseFila={(f) => (f.variacion ? "bg-neutro-suave/40 text-tinta-suave" : undefined)} vacio="Sin serie mensual." />
      <p className="text-xs text-tinta-suave">
        Unidades. Lo proyectado va en <span className="italic">cursiva</span> (proy.); en el cierre, los meses hasta los datos de la proyección son {tablero.kpis.real_ac_exactitud === "estimado" ? "lo vendido estimado por participación de la marca" : "reales"}. «—» es un mes sin carga publicada, sin dato o sin reparto por mes entre las tiendas elegidas. Las filas de
        variación van en %.
      </p>
      {nota && <p className="rounded-md border border-borde bg-neutro-suave px-3 py-2 text-xs leading-relaxed text-tinta">{nota}</p>}
    </div>
  );
}
