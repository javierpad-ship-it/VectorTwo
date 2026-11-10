import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { vistaDiferencia, type FilaDiferencia } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

/**
 * Frente a lo aprobado (ficha 14, §4.6): la diferencia con la última proyección aprobada, por género × mundo, más el total y el cierre del año en
 * curso. Sale de la foto guardada de esa aprobación. Con la misma proyección y la misma huella no se muestra (el estado ya dice «Aprobada»).
 */
export function FrenteAprobada({ tablero }: { tablero: TableroApi }) {
  const v = vistaDiferencia(tablero.decidir.diferencia, tablero.proyeccion);
  if (v.tipo === "oculta") return null;
  if (v.tipo !== "tabla") {
    return (
      <Card titulo="Frente a lo aprobado">
        <p className="text-sm text-tinta">{v.texto}</p>
      </Card>
    );
  }
  const columnas: Columna<FilaDiferencia>[] = [
    { clave: "gm", titulo: "Género × mundo", className: "min-w-36", render: (f) => f.nombre },
    { clave: "aprobado", titulo: `${v.anioSiguiente} aprobado`, className: NUM, render: (f) => f.aprobado },
    { clave: "actual", titulo: `${v.anioSiguiente} actual`, className: NUM, render: (f) => f.actual },
    { clave: "diferencia", titulo: "Diferencia u", className: NUM, render: (f) => f.diferencia },
    { clave: "pct", titulo: "%", className: NUM, render: (f) => f.pct },
  ];
  return (
    <Card titulo="Frente a lo aprobado" descripcion={v.encabezado}>
      <DataTable columnas={columnas} filas={v.filas} claveFila={(f) => f.clave} claseFila={(f) => (f.resaltada ? "bg-neutro-suave/60 font-semibold" : undefined)} />
      <p className="mt-2 text-xs text-tinta-suave">
        Ordenado por diferencia. La fila «{v.anioEnCurso} cierre» compara el cierre del año en curso (sus columnas son de {v.anioEnCurso}, no de {v.anioSiguiente}).
      </p>
    </Card>
  );
}
