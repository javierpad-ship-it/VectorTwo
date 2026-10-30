import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { DetalleGeneroMundoApi, ReferenciaApi } from "@/lib/crecimientos/tipos-api";
import {
  anioAplicacionDe,
  formatearPctSigno,
  formatearUds,
  hayNino,
  mesesRealesDelAnioEnCurso,
  rangoMeses,
  referenciaSinCifras,
  referenciasVisibles,
  temporadasNino,
  textoAvisoNino,
  textoCobertura,
  textoCorreccionNino,
  textoMotivoNulo,
  textoTiendaMayor,
  textoVendioDeMas,
  correccionNinoPct,
} from "./vista";

const SIN_DATO = <span className="text-tinta-suave">—</span>;

function celdaPct(v: number | null): ReactNode {
  if (v === null) return SIN_DATO;
  return <span className="tabular-nums">{formatearPctSigno(v)}</span>;
}

function Equivalente({ r }: { r: ReferenciaApi }) {
  const corregido = r.equivalente.corregido ?? null;
  const { bruto } = r.equivalente;
  if (bruto === null && corregido === null) return SIN_DATO;
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <p>
        <span className="text-tinta-suave">sobre corregido </span>
        <strong>{formatearPctSigno(corregido)}</strong>
      </p>
      <p>
        <span className="text-tinta-suave">sobre real </span>
        {formatearPctSigno(bruto)}
      </p>
    </div>
  );
}

type DetalleReferencias = Pick<DetalleGeneroMundoApi, "referencias" | "acumulado" | "bandas_nino" | "series" | "factores_parciales"> &
  Partial<Pick<DetalleGeneroMundoApi, "cierre" | "hay_nino" | "correccion_nino_pct">>;

/**
 * «Cómo crece» (06e §4.1 punto 4): Cierre por curva, Acumulado, Año completo (el más reciente primero) y Aplicado hoy, con su periodo, sus
 * tiendas, el % real, el % corregido y «equivale para 2027 (sobre 2026 corregido)», más las marcas «frágil», «extremo», tienda mayor y
 * cobertura. Las marcas solo informan: ninguna sugiere un %. «Sin Niño + rebote» y «Cierre proyectado» ya no se ofrecen.
 */
export function ReferenciasGM({ detalle }: { detalle: DetalleReferencias }) {
  const anio = anioAplicacionDe(detalle);
  const y = anio - 1;
  const k = mesesRealesDelAnioEnCurso(detalle.series);
  const nino = temporadasNino(detalle.bandas_nino, y);
  const conNino = hayNino({ hay_nino: detalle.hay_nino, cierre: detalle.cierre });
  const referencias = referenciasVisibles(detalle.referencias);
  const sinProyeccion = referencias.some((r) => r.motivo_nulo === "metodo_anterior" || r.motivo_nulo === "sin_referencia" || r.motivo_nulo === "sin_base");
  const correccion = textoCorreccionNino({ hay_nino: detalle.hay_nino, cierre: detalle.cierre, correccion_nino_pct: detalle.correccion_nino_pct });
  const vendioDeMas = conNino ? textoVendioDeMas(y, correccionNinoPct({ cierre: detalle.cierre, correccion_nino_pct: detalle.correccion_nino_pct })) : null;

  return (
    <div className="space-y-3">
      {conNino && nino.length > 0 && <Alert tono="info">{textoAvisoNino(y, nino, detalle.cierre)}</Alert>}
      {conNino && nino.length === 0 && <Alert tono="info">{textoAvisoNino(y, [], detalle.cierre)}</Alert>}
      {!conNino && correccion && <p className="text-xs text-tinta-suave">{correccion}: una versión aprobada sobre {y} real sigue valiendo y se muestra un solo %.</p>}
      {vendioDeMas && <Alert tono="info">{vendioDeMas}</Alert>}
      {detalle.factores_parciales && (
        <Alert tono="info">
          El factor del Niño de {y} es parcial{k ? ` (${rangoMeses(k)})` : ""}: las cifras corregidas de {y} se apoyan solo en esos meses. Cada mes que se publique hay que sincronizar el
          factor en Factores del Niño y volver a confirmarlo antes de cerrar.
        </Alert>
      )}
      {sinProyeccion && (
        <Alert tono="info">
          Sin una proyección de {y} calculada con el método 5 (0.14.0) no hay «Aplicado hoy» ni «Reaprobar». El cierre por curva, el Acumulado y los Años completos sí se pueden usar.
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Referencias de crecimiento (desplazable)" tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Referencias del crecimiento: periodo comparado, tiendas, unidades anteriores y actuales, porcentaje real y corregido, y lo que equivale para {anio} sobre {y} corregido.
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
                % real
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                % corregido
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Equivale para {anio} (sobre {y} corregido)
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Marcas
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde">
            {referencias.map((r) => {
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
                          <span title="Un crecimiento real de más de 50 % (arriba o abajo): revísalo antes de apoyarte en él">
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
            {referencias.length === 0 && (
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
        Cada referencia compara periodos iguales sobre las mismas tiendas. «% real» es lo vendido; «% corregido» quita el efecto del Niño. «Equivale» es el % que escribirías para {anio} sobre{" "}
        {y} corregido. «Frágil» y «extremo» solo marcan; ninguna cifra es una sugerencia.
      </p>
    </div>
  );
}
