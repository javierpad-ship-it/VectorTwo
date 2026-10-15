"use client";

import Link from "next/link";
import type { AvisoCurva, Prerrequisito, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { enlaceDePrerrequisito, nombreTemporada } from "./trabajo-vista";
import { ETIQUETA_AVISO, ETIQUETA_CLASE } from "./vista";

function Enlace({ p, onIrAPeriodos }: { p: Pick<Prerrequisito, "enlace">; onIrAPeriodos: () => void }) {
  const e = enlaceDePrerrequisito(p);
  if (!e) return null;
  const clase = "font-medium underline underline-offset-2";
  if (e.tipo === "pestana") {
    return (
      <button type="button" onClick={onIrAPeriodos} className={clase}>
        → {e.etiqueta}
      </button>
    );
  }
  return (
    <Link href={e.href} className={clase}>
      → {e.etiqueta}
    </Link>
  );
}

/**
 * Tarjeta «Antes de calcular» de la vista de trabajo. Si algo bloquea (sin periodos para su
 * temporada, tienda con venta sin apertura, sin año completo, sin venta, sin equivalencias) NO hay
 * gráfico: «No se puede calcular todavía», con el motivo, el enlace para arreglarlo y, cuando
 * aplica, la casilla «Confirmo que esta temporada no tiene años atípicos». Si solo avisa, el
 * cálculo sigue y los avisos quedan visibles.
 */
export function AntesDeCalcular({
  datos,
  confirmadoSinPeriodos,
  onConfirmarSinPeriodos,
  onIrAPeriodos,
  deshabilitado,
}: {
  datos: TrabajoAgrupacionApi;
  confirmadoSinPeriodos: boolean;
  onConfirmarSinPeriodos: (confirmado: boolean) => void;
  onIrAPeriodos: () => void;
  deshabilitado: boolean;
}) {
  const { bloquea, avisa } = datos.prerrequisitos;
  const resultado = datos.calculo?.resultado ?? null;
  const puedeConfirmar = bloquea.some((p) => p.codigo === "periodos_temporada_faltantes") || confirmadoSinPeriodos;

  const casilla = puedeConfirmar && (
    <label className="mt-1 flex items-start gap-2 text-sm text-tinta">
      <input
        type="checkbox"
        checked={confirmadoSinPeriodos}
        disabled={deshabilitado}
        onChange={(e) => onConfirmarSinPeriodos(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-borde accent-marca disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span>
        Confirmo que esta temporada no tiene años atípicos <span className="text-tinta-suave">(se guardará con la curva)</span>
      </span>
    </label>
  );

  if (bloquea.length > 0) {
    return (
      <section aria-labelledby="titulo-no-calcular" className="rounded-xl border border-alerta/30 bg-alerta-suave px-5 py-4 text-sm text-alerta">
        <h2 id="titulo-no-calcular" className="text-base font-semibold">
          No se puede calcular todavía
        </h2>
        <ul className="mt-2 space-y-2">
          {bloquea.map((p, i) => (
            <li key={`${p.codigo}-${i}`}>
              <p>
                <span aria-hidden>✖ </span>
                {p.detalle} <Enlace p={p} onIrAPeriodos={onIrAPeriodos} />
              </p>
              {p.codigo === "periodos_temporada_faltantes" && casilla}
            </li>
          ))}
          {/* Confirmada pero bloquea otro prerrequisito: la casilla sigue a la vista para poder quitarla. */}
          {confirmadoSinPeriodos && !bloquea.some((p) => p.codigo === "periodos_temporada_faltantes") && <li>{casilla}</li>}
        </ul>
        {avisa.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-alerta/20 pt-2" aria-label="Avisos">
            {avisa.map((p, i) => (
              <li key={`${p.codigo}-${i}`}>
                <span aria-hidden>⚠ </span>
                {p.detalle} <Enlace p={p} onIrAPeriodos={onIrAPeriodos} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const aniosNino = (resultado?.anios ?? []).filter((a) => a.clase === "atipico_completo" || a.clase === "con_huecos" || a.meses_atipicos > 0);
  const avisosModelo: AvisoCurva[] = resultado?.avisos ?? [];

  return (
    <Card titulo="Antes de calcular" descripcion="Lo que el sistema comprobó antes de leer la venta de esta agrupación.">
      <div className="space-y-3 text-sm">
        <ul className="space-y-1" aria-label="Comprobaciones superadas">
          <li>
            <span aria-hidden className="text-exito">
              ✔{" "}
            </span>
            Temporada {nombreTemporada(datos.agrupacion.temporada).toLowerCase()}
          </li>
          {aniosNino.length > 0 && (
            <li>
              <span aria-hidden className="text-exito">
                ✔{" "}
              </span>
              Años del Niño reconocidos: {aniosNino.map((a) => `${a.anio} (${ETIQUETA_CLASE[a.clase].toLowerCase()})`).join(", ")}
            </li>
          )}
          <li>
            <span aria-hidden className="text-exito">
              ✔{" "}
            </span>
            {datos.datos.meses_publicados} meses publicados{datos.datos.faltantes.length === 0 ? " sin huecos" : ""} · datos hasta {datos.datos.hasta_periodo ?? "—"}
          </li>
        </ul>
        {confirmadoSinPeriodos && <div>{casilla}</div>}
        {(avisa.length > 0 || avisosModelo.length > 0) && (
          <ul className="space-y-1 border-t border-borde pt-2" aria-label="Avisos del cálculo">
            {avisa.map((p, i) => (
              <li key={`p-${p.codigo}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <span aria-hidden className="text-alerta">
                  ⚠
                </span>
                <span>{p.detalle}</span>
                <Enlace p={p} onIrAPeriodos={onIrAPeriodos} />
              </li>
            ))}
            {avisosModelo.map((a, i) => (
              <li key={`m-${a.codigo}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <Badge tono="alerta">{ETIQUETA_AVISO[a.codigo]}</Badge>
                <span className="text-tinta-suave">{a.detalle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
