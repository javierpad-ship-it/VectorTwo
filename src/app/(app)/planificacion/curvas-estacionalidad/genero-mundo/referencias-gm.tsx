import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { DetalleGeneroMundoApi, ReferenciaApi } from "@/lib/crecimientos/tipos-api";
import {
  anioAplicacionDe,
  formatearPctSigno,
  formatearUds,
  mesesRealesDelAnioEnCurso,
  rangoMeses,
  referenciaSinCifras,
  temporadasNino,
  textoAvisoNino,
  textoCobertura,
  textoMotivoNulo,
  textoTiendaMayor,
} from "./vista";

const SIN_DATO = <span className="text-tinta-suave">—</span>;

function celdaPct(v: number | null): ReactNode {
  if (v === null) return SIN_DATO;
  return <span className="tabular-nums">{formatearPctSigno(v)}</span>;
}

function Equivalente({ r }: { r: ReferenciaApi }) {
  const { bruto, sin_nino_mas_rebote: sin } = r.equivalente;
  if (bruto === null && sin === null) return SIN_DATO;
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <p>
        <span className="text-tinta-suave">bruto </span>
        <strong>{formatearPctSigno(bruto)}</strong>
      </p>
      <p>
        <span className="text-tinta-suave">sin Niño + rebote </span>
        <strong>{formatearPctSigno(sin)}</strong>
      </p>
    </div>
  );
}

/**
 * «Cómo crece» (06d, §4.1 punto 2): las cuatro referencias (Acumulado, Cierre proyectado, Año completo y Aplicado hoy)
 * con su periodo, sus tiendas, el % bruto, el % sin Niño y lo que significan para el año siguiente, más las marcas
 * «frágil», «extremo», tienda mayor y cobertura. Las marcas solo informan: ninguna sugiere un %.
 */
export function ReferenciasGM({ detalle }: { detalle: Pick<DetalleGeneroMundoApi, "referencias" | "acumulado" | "bandas_nino" | "series" | "rebote_nino_pct" | "factores_parciales"> }) {
  const anio = anioAplicacionDe(detalle);
  const y = anio - 1;
  const k = mesesRealesDelAnioEnCurso(detalle.series);
  const nino = temporadasNino(detalle.bandas_nino, y);
  const sinProyeccion = detalle.referencias.some((r) => r.motivo_nulo === "metodo_anterior" || r.motivo_nulo === "sin_referencia" || r.motivo_nulo === "sin_base");

  return (
    <div className="space-y-3">
      {nino.length > 0 && <Alert tono="info">{textoAvisoNino(y, nino, detalle.rebote_nino_pct)}</Alert>}
      {detalle.factores_parciales && (
        <Alert tono="info">
          El factor del Niño de {y} es parcial{k ? ` (${rangoMeses(k)})` : ""}: las cifras «sin Niño» de {y} se apoyan solo en esos meses y pueden cambiar cuando se publiquen los siguientes.
        </Alert>
      )}
      {sinProyeccion && (
        <Alert tono="info">
          Sin una proyección de {y} calculada con el método actual no hay «Cierre proyectado», «Aplicado hoy» ni rebote del Niño. Acumulado y Año completo en bruto sí se pueden usar.
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Referencias de crecimiento (desplazable)" tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Referencias del crecimiento: periodo comparado, tiendas, unidades anteriores y actuales, porcentaje bruto y sin Niño, y su equivalente para {anio}.
          </caption>
          <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Referencia
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Tiendas
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Anterior
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Actual
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                % bruto
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                % sin Niño
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Equivalente para {anio}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Marcas
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {detalle.referencias.map((r) => {
              const mayor = textoTiendaMayor(r);
              const cobertura = textoCobertura(r, k);
              const motivo = textoMotivoNulo(r.motivo_nulo);
              return (
                <tr key={`${r.tipo}-${r.anio}`} className="align-top hover:bg-fondo/60">
                  <th scope="row" className="min-w-48 px-3 py-2 text-left font-normal">
                    <span className="block font-medium text-tinta">{r.etiqueta}</span>
                    <span className="block text-xs text-tinta-suave">{r.periodo}</span>
                  </th>
                  {referenciaSinCifras(r) ? (
                    <td colSpan={6} className="px-3 py-2 text-xs text-tinta-suave">
                      — {motivo ?? "sin cifras"}
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">{r.tiendas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatearUds(r.anterior)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatearUds(r.actual)}</td>
                      <td className="px-3 py-2 text-right">{celdaPct(r.pct_bruto)}</td>
                      <td className="px-3 py-2 text-right">{celdaPct(r.pct_sin_nino)}</td>
                      <td className="px-3 py-2">
                        <Equivalente r={r} />
                      </td>
                    </>
                  )}
                  <td className="min-w-56 px-3 py-2">
                    <div className="space-y-1 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {r.fragil && (
                          <span title="Menos de 3 tiendas o menos de 120 unidades en el periodo anterior: la cifra es poco estable">
                            <Badge tono="alerta">frágil</Badge>
                          </span>
                        )}
                        {r.extremo && (
                          <span title="Un crecimiento bruto de más de 50 % (arriba o abajo): revísalo antes de apoyarte en él">
                            <Badge tono="alerta">extremo</Badge>
                          </span>
                        )}
                      </div>
                      {mayor && <p className="text-tinta-suave">{mayor}</p>}
                      {cobertura && <p className="text-tinta-suave">{cobertura}</p>}
                      {r.motivo_nulo !== null && !referenciaSinCifras(r) && motivo && <p className="text-tinta-suave">Falta: {motivo}</p>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {detalle.referencias.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-tinta-suave">
                  No hay referencias para este género × mundo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">
        Cada referencia compara periodos iguales sobre las mismas tiendas. «Equivalente» es lo que esa cifra significaría como % bruto de {anio}: en «sin Niño + rebote» se
        le suma el rebote esperado del Niño. «Frágil» y «extremo» solo marcan; ninguna cifra es una sugerencia.
      </p>
    </div>
  );
}
