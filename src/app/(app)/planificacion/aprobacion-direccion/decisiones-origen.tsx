import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { vistaDecisiones, type VistaDecisiones } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

type Origen = VistaDecisiones["origenes"][number];

const COLUMNAS: Columna<Origen>[] = [
  { clave: "origen", titulo: "Cómo", render: (o) => o.etiqueta },
  { clave: "registros", titulo: "Filas", className: NUM, render: (o) => o.registros },
  { clave: "unidades", titulo: "Unidades", className: NUM, render: (o) => o.unidades },
  { clave: "parte", titulo: "% de las unidades", className: NUM, render: (o) => o.parte },
];

/**
 * Cómo se decidió (ficha 14, §4.8): por año, unidades y parte de cada origen (en bloque, IA, aceptada tal cual, a mano, escalada por tienda, sin
 * decidir), quién decidió, cuántas filas y entre qué fechas, y el día con más decisiones. Es del recorte, sin el filtro de tienda.
 */
export function DecisionesOrigen({ tablero }: { tablero: TableroApi }) {
  const anios = tablero.decisiones.map(vistaDecisiones);
  return (
    <Card nivel={3} titulo="Cómo se decidió" descripcion="Origen de las cifras vigentes del recorte (no cambia con el filtro de tiendas): quién decidió, cómo y cuándo.">
      {anios.length === 0 ? (
        <p className="text-sm text-tinta-suave">Sin decisiones en este recorte.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {anios.map((a) => (
            <section key={a.anio} className="min-w-0 space-y-2" aria-label={`Decisiones de ${a.anio}`}>
              <h4 className="text-sm font-semibold text-tinta">
                {a.anio} · {a.total} u
              </h4>
              <DataTable etiqueta={`Origen de las cifras de ${a.anio}`} columnas={COLUMNAS} filas={a.origenes} claveFila={(o) => o.clave} vacio="Sin filas." />
              {a.autores.length > 0 && (
                <ul className="space-y-0.5 text-sm text-tinta">
                  {a.autores.map((x) => (
                    <li key={x.nombre}>
                      <span className="font-medium">{x.nombre}</span>: {x.registros}, {x.unidades}, {x.fechas}
                    </li>
                  ))}
                </ul>
              )}
              {a.diaPico && <p className="text-xs text-tinta-suave">{a.diaPico}</p>}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
