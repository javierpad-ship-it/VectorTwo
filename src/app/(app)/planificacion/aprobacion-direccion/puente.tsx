import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { AYUDA_DIFERENCIA, filasPuente, puenteTotal, tablaPuenteGm, type FilaPuente, type TablaPuenteGm } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const FIJA = "sticky left-0 z-10 bg-superficie";

/**
 * De un año al siguiente (ficha 14, §4.4): la tabla de pasos del TOTAL de la proyección (unidades, acumulado y % sobre el paso anterior) y la misma
 * en columnas por género × mundo. Cada paso lleva su texto de ayuda (`title` y lector de pantalla). Las dos tablas se desplazan dentro de su
 * contenedor; la página no. Los GM con base corregida del Niño lo dicen en su celda.
 */
export function Puente({ tablero }: { tablero: TableroApi }) {
  const total = puenteTotal(tablero);
  const p = tablero.proyeccion;
  if (!total) return null;
  const hayCierres = tablero.datos.tiendas.some((t) => t.situacion === "cierres");
  const filas = filasPuente(total, { hayCierres });
  const porGm = tablaPuenteGm(tablero.puente.por_gm, tablero.crecimientos, p);

  const columnas: Columna<FilaPuente>[] = [
    {
      clave: "paso",
      titulo: "Paso",
      className: "min-w-56",
      render: (f) => (
        // `relative`: el texto para lector de pantalla (posición absoluta) no debe contar para el ancho de la página dentro de una tabla que se desplaza.
        <span title={f.ayuda} className="relative">
          {f.etiqueta}
          <span className="sr-only"> ({f.ayuda})</span>
          {f.diferencia && (
            <span className="relative ml-2" title={AYUDA_DIFERENCIA}>
              <span className="sr-only"> {AYUDA_DIFERENCIA} </span>
              <Badge tono="alerta">diferencia</Badge>
            </span>
          )}
        </span>
      ),
    },
    { clave: "unidades", titulo: "Unidades", className: NUM, render: (f) => f.unidades },
    { clave: "acumulado", titulo: "Acumulado", className: NUM, render: (f) => f.acumulado },
    { clave: "pct", titulo: "% sobre el paso anterior", className: NUM, render: (f) => f.pct },
  ];

  return (
    <Card nivel={3} titulo={`De ${p.anio_en_curso} a ${p.anio_siguiente}: de dónde sale el aumento`} descripcion="Total de la proyección y por género × mundo. La suma de los pasos es el total exacto.">
      <div className="space-y-5">
        <DataTable etiqueta="Puente del año en curso al siguiente, total de la proyección" columnas={columnas} filas={filas} claveFila={(f) => f.clave} claseFila={(f) => (f.subtotal ? "bg-neutro-suave/60 font-semibold" : undefined)} />
        <PuentePorGm tabla={porGm} />
      </div>
    </Card>
  );
}

type FilaGm = TablaPuenteGm["filas"][number];

export function PuentePorGm({ tabla }: { tabla: TablaPuenteGm }) {
  if (tabla.filas.length === 0) return null;
  const columnas: Columna<FilaGm>[] = [
    { clave: "gm", titulo: "Género × mundo", className: `${FIJA} min-w-36 whitespace-nowrap`, render: (f) => f.nombre },
    ...tabla.columnas.map(
      (c, i): Columna<FilaGm> => ({
        clave: c.clave,
        titulo: c.titulo,
        encabezado: <span title={c.ayuda}>{c.titulo}</span>,
        className: `${NUM}${c.subtotal ? " font-semibold" : ""}`,
        render: (f) => (
          <>
            {f.celdas[i]}
            {c.clave === "nino" && f.nino && (
              <span className="ml-1.5 font-sans">
                <Badge tono="marca">Niño</Badge>
              </span>
            )}
          </>
        ),
      })
    ),
  ];
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-tinta">Por género × mundo</h4>
      <DataTable etiqueta="Puente por género × mundo" columnas={columnas} filas={tabla.filas} claveFila={(f) => f.gm_clave} claseFila={(f) => (f.total ? "bg-neutro-suave/60 font-semibold" : undefined)} />
      <p className="text-xs text-tinta-suave">Los subtotales (cierre, base, mismas tiendas y total) son acumulados; los demás, lo que suma o resta cada paso. «Niño»: el género × mundo tiene base corregida del Niño.</p>
    </div>
  );
}
