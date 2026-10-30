import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { DetalleGeneroMundoApi, FactorYApi } from "@/lib/crecimientos/tipos-api";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { DiagnosticoTemporada } from "./diagnostico-verano";
import {
  URL_FACTORES_NINO,
  anioAplicacionDe,
  avisosDeCierre,
  filasDeCierre,
  formatearPctSigno,
  formatearUds,
  ordenarFactores,
  partesFactorInvierno,
  resumenDiagnosticoFactor,
  resumenDiagnosticoGM,
  textoCierreProyeccion,
  textoEstadoFactor,
  textoFactorAgrupacion,
  textoFactorVerano,
  textoTemporada,
} from "./vista";

const SIN_DATO = <span className="text-tinta-suave">—</span>;

type DetalleCierre = Pick<
  DetalleGeneroMundoApi,
  "cierre" | "cierre_por_agrupacion" | "factores_y" | "diagnostico_verano_gm" | "cierre_proyeccion" | "acumulado" | "bandas_nino"
>;

function Cifra({ n }: { n: number | null }) {
  return n === null ? SIN_DATO : <span>{formatearUds(n)}</span>;
}

function BloqueFactor({ f, bandas, k, detalle }: { f: FactorYApi; bandas: DetalleCierre["bandas_nino"]; k: number | null; detalle: DetalleCierre }) {
  const estado = textoEstadoFactor(f);
  const diag = resumenDiagnosticoFactor(f, bandas);
  const esVerano = f.temporada === "verano";
  const diagGM = esVerano ? resumenDiagnosticoGM(detalle.diagnostico_verano_gm, f.anio, bandas) : null;
  return (
    <article className="space-y-3 rounded-lg border border-borde p-3" data-factor={`${f.temporada}-${f.anio}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-tinta">
          Factor del Niño · {f.temporada} {f.anio}
        </h4>
        <Badge tono={estado.tono}>{estado.texto}</Badge>
      </header>
      {esVerano ? (
        <p className={`text-sm ${f.efectivo === null ? "text-alerta" : "text-tinta"}`}>{textoFactorVerano(f, bandas, k)}</p>
      ) : (
        <p className={`text-sm ${f.efectivo === null ? "text-alerta" : "text-tinta"}`}>
          {partesFactorInvierno(f).map((p, i) =>
            p.b ? (
              <strong key={i} className="text-tinta">
                {p.t}
              </strong>
            ) : (
              <span key={i}>{p.t}</span>
            )
          )}
        </p>
      )}
      {f.ratio_calculado === null && f.efectivo !== null && f.meses_periodo_con_dato < 2 && (
        <p className="text-xs text-tinta-suave">
          Con menos de 2 meses del periodo con dato ({f.meses_periodo_con_dato} de {f.meses_periodo}) el sistema no calcula el factor: lo escribió Javier con este diagnóstico a la vista.
        </p>
      )}
      {diag && (
        <details open={esVerano}>
          <summary className="cursor-pointer text-sm font-medium text-tinta">{esVerano ? "Cómo crece el verano atípicamente" : `Cómo crece el ${f.temporada} atípicamente`}</summary>
          <div className="mt-2 space-y-4">
            <DiagnosticoTemporada
              titulo={`${esVerano ? "Verano" : "Invierno"} · toda la red (${f.temporada} ${f.anio})`}
              anioY={f.anio}
              anioRef={f.anio - 1}
              meses={diag.meses}
              resumen={diag.resumen}
            />
            {diagGM && (
              <DiagnosticoTemporada titulo="Solo las agrupaciones de verano de este género × mundo (informativo)" anioY={f.anio} anioRef={f.anio - 1} meses={diagGM.meses} resumen={diagGM.resumen} />
            )}
          </div>
        </details>
      )}
    </article>
  );
}

/**
 * «Cómo se cierra {Y}» (06e §4.1 punto 3): una fila por agrupación con su curva vigente, el avance, lo vendido, el factor, el cierre real y
 * corregido (mismas tiendas del %) y la base del año siguiente real y corregida (tiendas del año siguiente), más el total. Debajo, el factor
 * de cada temporada del año en curso con sus dos números y, en verano, «cómo crece el verano atípicamente». Solo informa: el factor se
 * cambia en Proyección → Factores del Niño.
 */
export function CierreGM({ detalle }: { detalle: DetalleCierre }) {
  const anio = anioAplicacionDe(detalle);
  const y = anio - 1;
  const c = detalle.cierre ?? null;
  const filas = filasDeCierre(detalle);
  const k = c?.k ?? null;
  const mesK = k !== null ? MESES_CORTOS[k - 1].toLowerCase() : "hoy";
  const avisos = avisosDeCierre(c, detalle.cierre_por_agrupacion ?? []);
  const factores = ordenarFactores((detalle.factores_y ?? []).filter((f) => f.anio === y));
  const proyeccion = textoCierreProyeccion(detalle.cierre_proyeccion, anio);

  if (!c) {
    return <p className="text-sm text-tinta-suave">Todavía no hay cierre por curva para este género × mundo.</p>;
  }

  return (
    <div className="space-y-4">
      {avisos.map((a, i) => (
        <Alert key={i} tono="info">
          {a}
        </Alert>
      ))}

      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label={`Cómo se cierra ${y} (desplazable)`} tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Cierre de {y} por agrupación: curva vigente, avance, vendido, factor del Niño, cierre real y corregido de las mismas tiendas y base de {anio} real y corregida de las tiendas de {anio}.
          </caption>
          <thead className="bg-neutro-suave text-left text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Agrupación
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Curva
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Avance a {mesK}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Vendido
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Factor
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Vendido corregido
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Cierre {y} real
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Cierre {y} corregido
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Base {anio} real
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Base {anio} corregida
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde tabular-nums">
            {filas.map((f) =>
              f.tipo === "agrupacion" ? (
                <tr key={f.a.agrupacion_id ?? f.a.nombre} className="align-top hover:bg-fondo/60">
                  <th scope="row" className="min-w-40 px-3 py-2 text-left font-normal">
                    <span className="block font-medium text-tinta">{f.a.nombre}</span>
                    <span className="block text-xs text-tinta-suave">{textoTemporada(f.a.temporada)}</span>
                  </th>
                  <td className="min-w-28 px-3 py-2 text-xs">{f.a.curva ? `v${f.a.curva.version}` : <span className="text-alerta">sin curva · compuesta</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {f.a.avance === null ? SIN_DATO : `${Math.round(f.a.avance * 100)} %`}
                    {f.a.avance_bajo && (
                      <span className="mt-0.5 block">
                        <Badge tono="alerta">avance bajo</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.vendido} />
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{textoFactorAgrupacion(f.a.factor_meses)}</td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.vendido_corregido} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.cierre} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.cierre_corregido} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.base_curva} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.a.base_curva_corregida} />
                  </td>
                </tr>
              ) : (
                <tr key="total" className="bg-neutro-suave/60 align-top font-semibold">
                  <th scope="row" className="px-3 py-2 text-left">
                    Género × mundo
                    <span className="block text-xs font-normal text-tinta-suave">{f.c.tiendas} tiendas del %; {f.c.base_curva ? `${f.c.base_curva.tiendas} de ${anio}` : `tiendas de ${anio}`}</span>
                  </th>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{f.c.avance === null ? SIN_DATO : `${Math.round(f.c.avance * 100)} %`}</td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.vendido} />
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.vendido_corregido} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.cierre} />
                    <span className="block text-xs font-normal text-tinta-suave">{formatearPctSigno(f.c.pct)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.cierre_corregido} />
                    <span className="block text-xs font-normal text-tinta-suave">{formatearPctSigno(f.c.pct_corregido)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.base_curva?.real ?? null} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Cifra n={f.c.base_curva?.corregida ?? null} />
                  </td>
                </tr>
              )
            )}
            {filas.length === 1 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-center text-tinta-suave">
                  Este género × mundo no tiene agrupaciones con venta comparable.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-suave">
        Cierre {y} = vendido de enero a {mesK} (con el Niño normalizado) ÷ avance de la curva vigente; «corregido» es lo que habrían vendido sin el Niño. Cierre y % usan las mismas
        tiendas de {y - 1} y {y}; la base {anio} usa las tiendas que tendrá {anio}{c.base_curva && c.base_curva.tiendas_fuera_cy.length > 0 ? ` (incluye ${c.base_curva.tiendas_fuera_cy.join(", ")}, que no está en el %)` : ""}.
      </p>

      {factores.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-tinta">Factor del Niño de {y} (corrige la base de {anio})</h3>
          {factores.map((f) => (
            <BloqueFactor key={`${f.temporada}-${f.anio}`} f={f} bandas={detalle.bandas_nino} k={k} detalle={detalle} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">{y} no tuvo meses del Niño que toquen a este género × mundo: no hay factor que corregir.</p>
      )}

      {proyeccion && <p className="text-sm text-tinta">{proyeccion}</p>}

      <p className="text-sm">
        <Link href={URL_FACTORES_NINO} className="font-medium text-marca underline underline-offset-2 hover:text-marca-oscura">
          Cambiar el factor en Proyección → Factores del Niño
        </Link>
      </p>
    </div>
  );
}
