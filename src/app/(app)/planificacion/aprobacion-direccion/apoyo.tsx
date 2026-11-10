import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { datosCobertura, filasSoles, NOTA_COBERTURA, notasSoles, ROTULO_APOYO } from "./vista-tablero";

function Dato({ etiqueta, valor, estimado }: { etiqueta: string; valor: string; estimado: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-borde py-1.5 last:border-b-0">
      <dt className="text-sm text-tinta-suave">{etiqueta}</dt>
      <dd className="flex items-center gap-1.5 font-mono text-sm tabular-nums text-tinta">
        {valor}
        {estimado && (
          <span className="font-sans">
            <Badge tono="alerta">estimado</Badge>
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Datos de apoyo: soles y cobertura (ficha 14, §4.8, D2). No forman parte de lo que se aprueba y no salen del tablero. Cada cifra estimada lleva la
 * palabra «estimado» a su lado (no solo en el título): los soles de lo proyectado y la cobertura cuando la proyección de las tiendas está atribuida.
 */
export function Apoyo({ tablero }: { tablero: TableroApi }) {
  return (
    <Card titulo="Datos de apoyo: soles y cobertura" descripcion={ROTULO_APOYO}>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0" aria-label="Soles">
          <h3 className="mb-1 text-sm font-semibold text-tinta">Soles (netos de IGV)</h3>
          <dl>
            {filasSoles(tablero).map((f) => (
              <Dato key={f.etiqueta} etiqueta={f.etiqueta} valor={f.valor} estimado={f.estimado} />
            ))}
          </dl>
          <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-tinta-suave">
            {notasSoles(tablero.apoyo.soles).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
        <section className="min-w-0" aria-label="Cobertura">
          <h3 className="mb-1 text-sm font-semibold text-tinta">Stock y meses de cobertura</h3>
          <dl>
            {datosCobertura(tablero.apoyo.cobertura).map((d) => (
              <Dato key={d.etiqueta} etiqueta={d.etiqueta} valor={d.valor} estimado={d.estimado} />
            ))}
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">{NOTA_COBERTURA}</p>
        </section>
      </div>
    </Card>
  );
}
