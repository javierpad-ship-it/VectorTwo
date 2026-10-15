"use client";

import Link from "next/link";
import { formatearNumero } from "@/lib/formato";
import type { BloquesApi, TiendaBloqueApi } from "@/lib/proyeccion/tipos-api";
import { resumenBloquesAnio } from "./vista";

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function ListaTiendas({ tiendas, titulo, vacio = "—" }: { tiendas: readonly TiendaBloqueApi[]; titulo: string; vacio?: string }) {
  if (tiendas.length === 0) {
    return (
      <p className="text-sm text-tinta-suave">
        <span className="font-medium text-tinta">{titulo}</span> · {vacio}
      </p>
    );
  }
  return (
    <details className="rounded-md border border-borde bg-superficie px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none">
        <span className="font-medium">{titulo}</span> ({formatearNumero(tiendas.length)}):{" "}
        <span className="font-mono text-xs text-tinta-suave">{tiendas.length <= 8 ? tiendas.map((t) => t.codigo).join(", ") : `${tiendas[0].codigo} … ${tiendas[tiendas.length - 1].codigo}`}</span>
      </summary>
      <ul className="mt-2 divide-y divide-borde">
        {tiendas.map((t) => (
          <li key={t.tienda_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
            <code className="font-mono text-xs">{t.codigo}</code>
            <span>{t.nombre}</span>
            <span className="text-xs text-tinta-suave">
              abre {fecha(t.fecha_apertura)}
              {t.fecha_cierre ? ` · cierra ${fecha(t.fecha_cierre)}` : ""}
            </span>
            <span className="text-xs text-tinta-suave">{t.motivo}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Composición de los bloques de tiendas por año (ficha 07, paso 5): mismas, nuevas del año anterior, aperturas,
 * cierres y las que quedan fuera, con el motivo de cada una y la lista de tiendas en un desplegable. Cada tienda está
 * en exactamente un bloque por año; los de `Y` y `Y+1` son distintos. Las fechas se corrigen en Tiendas (M4).
 */
export function ComposicionBloques({
  bloques,
  anios,
  abierto = false,
  titulo = "Composición de los bloques de tiendas",
  enlaceTiendas = true,
}: {
  bloques: BloquesApi;
  anios: readonly number[];
  abierto?: boolean;
  titulo?: string;
  enlaceTiendas?: boolean;
}) {
  return (
    <details open={abierto} className="rounded-lg border border-borde bg-fondo/50 px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-medium">{titulo}</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {anios.map((anio) => {
          const r = resumenBloquesAnio(bloques[anio]);
          const fuera = bloques[anio]?.fuera ?? [];
          return (
            <div key={anio} className="space-y-2">
              <h3 className="text-sm font-semibold">{anio}</h3>
              <ListaTiendas tiendas={r.mismas} titulo="Mismas tiendas" />
              <ListaTiendas tiendas={r.anterior} titulo="Nuevas del año anterior" />
              <ListaTiendas tiendas={r.aperturas} titulo="Aperturas del año" />
              <ListaTiendas tiendas={r.cierres} titulo="Cierres" />
              {fuera.length > 0 && <ListaTiendas tiendas={fuera} titulo="Fuera de la proyección" />}
            </div>
          );
        })}
      </div>
      {enlaceTiendas && (
        <p className="mt-3 text-xs text-tinta-suave">
          ¿Una fecha no es la que esperas? Corrígela en{" "}
          <Link href="/maestros/tiendas" className="font-medium text-marca-oscura underline underline-offset-2">
            Tiendas y aperturas
          </Link>{" "}
          y recalcula la proyección.
        </p>
      )}
    </details>
  );
}
