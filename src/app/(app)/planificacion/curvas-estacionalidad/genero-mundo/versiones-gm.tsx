"use client";

import { useState } from "react";
import type { VersionCrecimientoApi } from "@/lib/crecimientos/tipos-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { formatearFechaHora } from "../vista";
import { ESTADO_VERSION_GM, formatearPctPlano, lineasDeFoto, textoBaseVersion } from "./vista";

/** La versión con su foto (`referencia`), si el servidor la manda junto a la versión. */
export type VersionConFoto = VersionCrecimientoApi & { referencia?: unknown };

/**
 * Historial de aprobaciones del género × mundo (06d, §4.1 punto 4): vN, %, base y su valor, nota, quién y cuándo.
 * «Ver foto» abre lo que vio el planner al aprobar. Nunca se borra una versión.
 */
export function VersionesGM({ versiones, anio }: { versiones: readonly VersionConFoto[]; anio: number }) {
  const [foto, setFoto] = useState<VersionConFoto | null>(null);
  const ordenadas = [...versiones].sort((a, b) => b.version - a.version);

  return (
    <Card titulo={`Versiones (${ordenadas.length})`} descripcion={`Cada aprobación de ${anio} guarda una foto de las cifras que viste. Nunca se borra una versión.`}>
      {ordenadas.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay versiones aprobadas.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-borde">
          <table className="w-full text-sm">
            <caption className="sr-only">Versiones aprobadas del crecimiento: versión, porcentaje, base, nota, quién y cuándo.</caption>
            <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Versión
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  % bruto
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Base
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Nota
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Quién y cuándo
                </th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {ordenadas.map((v) => (
                <tr key={v.id} className="align-top hover:bg-fondo/60">
                  <td className="whitespace-nowrap px-3 py-2">
                    <strong>v{v.version}</strong>{" "}
                    <Badge tono={ESTADO_VERSION_GM[v.estado].tono}>{ESTADO_VERSION_GM[v.estado].texto}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatearPctPlano(v.pct)}</td>
                  <td className="min-w-48 px-3 py-2 text-xs text-tinta">{textoBaseVersion(v.base)}</td>
                  <td className="max-w-64 px-3 py-2 text-xs text-tinta">{v.nota ? `«${v.nota}»` : <span className="text-tinta-suave">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-tinta-suave">
                    {v.por_nombre ?? "—"} · {formatearFechaHora(v.aprobada_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variante="secundario" tamano="sm" onClick={() => setFoto(v)}>
                      Ver foto
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {foto && <FotoVersionGM version={foto} onCerrar={() => setFoto(null)} />}
    </Card>
  );
}

/** «Ver foto»: lo que decía la versión al aprobarla (solo lectura). */
export function FotoVersionGM({ version, onCerrar }: { version: VersionConFoto; onCerrar: () => void }) {
  const lineas = lineasDeFoto(version.referencia);
  return (
    <Modal titulo={`Foto de la v${version.version}`} descripcion={`Aprobada por ${version.por_nombre ?? "—"} el ${formatearFechaHora(version.aprobada_at)}. Es historia: no cambia.`} onCerrar={onCerrar} ancho="max-w-2xl" pie={<Button variante="secundario" onClick={onCerrar}>Cerrar</Button>}>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-tinta-suave">Crecimiento bruto</dt>
        <dd className="font-medium text-tinta">{formatearPctPlano(version.pct)}</dd>
        <dt className="text-tinta-suave">Base</dt>
        <dd className="text-tinta">{textoBaseVersion(version.base)}</dd>
        <dt className="text-tinta-suave">Nota</dt>
        <dd className="text-tinta">{version.nota ? `«${version.nota}»` : "—"}</dd>
        <dt className="text-tinta-suave">Proyección de referencia</dt>
        <dd className="text-tinta">{version.proyeccion_referencia?.nombre ?? "ninguna"}</dd>
      </dl>
      {lineas.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-tinta">Cifras que se vieron al aprobar</h3>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
            {lineas.map((l) => (
              <div key={l.clave} className="contents">
                <dt className="text-tinta-suave">{l.clave}</dt>
                <dd className="text-tinta tabular-nums">{l.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="mt-4 text-xs text-tinta-suave">Esta versión no trae el detalle de las cifras que se vieron: solo el % y la base de arriba.</p>
      )}
    </Modal>
  );
}
