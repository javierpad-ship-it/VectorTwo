import Link from "next/link";
import type { TarjetaHuecoApi } from "@/lib/flujo/tipos-api";
import { CLASE_TEXTO_TONO, imi, nombreMes, TONO_SENAL, unidades } from "./formato";
import { MedidorImi, SelloSenal } from "./senal";
import { enlaceFila, fraseTarjeta, rotuloSaldo, textoEnCamino } from "./vista-huecos";

/**
 * Tarjeta de hueco (ficha 08 §4.2), a la manera de la tarjeta de necesidad de la referencia: género · mundo, línea, agrupación, sello
 * de estado, medidor de IMI con las marcas del rango, línea perforada y tres cifras (saldo por comprar de los próximos N meses, stock de
 * la cadena con el CD como detalle y lo que viene en camino). Toda la tarjeta abre el flujo de la fila; en `0.13.0` no hay «Comprar»
 * (llega con `0.13.1`): todos ven «Ver flujo».
 */
export function TarjetaHueco({
  tarjeta: t,
  imiMin,
  imiMax,
  periodos,
  meses,
  kPrima,
}: {
  tarjeta: TarjetaHuecoApi;
  imiMin: number;
  imiMax: number;
  /** `[k', k'+1 … H]` de la cabecera. */
  periodos: readonly string[];
  /** Los próximos N meses del saldo. */
  meses: number;
  kPrima: string;
}) {
  const { resumen } = t;
  const camino = textoEnCamino(t);
  const hayFalta = resumen.senal === "falta" || resumen.senal === "quiebre";
  const tonoFrase = TONO_SENAL[resumen.senal];
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-md border border-borde bg-superficie p-4 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-marca/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-tinta-suave">
            {t.genero} · {t.mundo}
          </p>
          <h3 className="mt-1 text-base font-bold uppercase leading-tight text-tinta">
            <Link
              href={enlaceFila(t)}
              className="after:absolute after:inset-0 after:z-10 after:content-[''] focus-visible:outline-none"
              aria-label={`Ver el flujo de ${t.genero} ${t.mundo} ${t.linea}${t.equivalencia ? ` ${t.equivalencia}` : ""}, ${t.agrupacion_marca}`}
            >
              {t.linea}
              {t.equivalencia ? ` › ${t.equivalencia}` : ""}
            </Link>
          </h3>
          <p className="text-sm font-semibold uppercase tracking-wide text-tinta-suave">{t.agrupacion_marca}</p>
        </div>
        <span className="relative z-20">
          <SelloSenal senal={resumen.senal} />
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-xs text-tinta-suave">IMI a {nombreMes(kPrima)}</span>
        <b className="shrink-0 font-mono text-sm tabular-nums text-tinta">{imi(resumen.imi_k)} m</b>
        <MedidorImi valor={resumen.imi_k} min={imiMin} max={imiMax} etiqueta={`IMI de ${t.linea} ${t.agrupacion_marca} al cierre de ${kPrima}`} />
        <span className="shrink-0 text-[11px] text-tinta-suave">
          ({imiMin} · {imiMax})
        </span>
      </div>

      {t.subflujos_resumen.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-tinta-suave">
          {t.subflujos_resumen.map((s) => (
            <li key={s.marca} title={`Subflujo intercompany de ${s.marca}, con su propio rango`}>
              <span className={`font-semibold ${CLASE_TEXTO_TONO[TONO_SENAL[s.senal]]}`}>{s.marca}</span> {imi(s.imi_k)} m · rango {s.rango[0]}–{s.rango[1]}
            </li>
          ))}
        </ul>
      )}

      {resumen.por_confirmar > 0 && (
        <p className="mt-2 rounded-md bg-alerta-suave px-2 py-1 text-xs font-medium text-alerta">
          {resumen.posible_doble_conteo > 0 ? `⚠ ${unidades(resumen.por_confirmar)} u por confirmar · posible doble conteo` : `${unidades(resumen.por_confirmar)} u por confirmar`}
        </p>
      )}

      <div aria-hidden className="-mx-4 my-3 border-t border-dashed border-borde" />

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">{rotuloSaldo(periodos, meses)}</dt>
          <dd className={`font-mono font-bold tabular-nums ${hayFalta ? "text-alerta" : "text-tinta"}`}>{unidades(resumen.saldo_n_meses)} u</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">Stock cadena</dt>
          <dd className="font-mono font-bold tabular-nums text-tinta">
            {unidades(t.stock_k.total)} u<span className="block text-[11px] font-normal text-tinta-suave">CD {unidades(t.stock_k.cd)}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">En camino</dt>
          <dd className="font-mono font-bold tabular-nums text-tinta">
            {camino.cifra}
            {camino.detalle && <span className="block text-[11px] font-normal text-tinta-suave">({camino.detalle})</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
        <p className={`min-w-0 flex-1 text-xs font-medium ${CLASE_TEXTO_TONO[tonoFrase]}`}>{fraseTarjeta(t, meses)}</p>
        <span aria-hidden className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta">
          Ver flujo
        </span>
      </div>
      {t.responsable && <p className="mt-2 text-[11px] text-tinta-suave">Responsable: {t.responsable.nombre}</p>}
    </article>
  );
}
