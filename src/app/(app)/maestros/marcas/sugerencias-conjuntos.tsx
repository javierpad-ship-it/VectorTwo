"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import type { GrupoSugeridoConjunto, SugerenciasConjuntosRespuesta } from "@/components/marcas/tipos-m2b";

const claveGrupo = (g: GrupoSugeridoConjunto) => g.marcas.map((m) => m.id).join("|");

/** Razones únicas del grupo, con el texto que manda la API ("primera palabra común: ALFA", "similar 0,75"). */
function razonesDe(g: GrupoSugeridoConjunto): string[] {
  return [...new Set(g.razones.map((r) => r.detalle))];
}

/** Cabeza que propone la API (la de nombre más corto), si sigue en el grupo; si no, la de nombre más corto. */
function cabezaPorDefecto(g: GrupoSugeridoConjunto): string {
  if (g.marcas.some((m) => m.id === g.cabeza_id)) return g.cabeza_id;
  return [...g.marcas].sort((a, b) => a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre, "es"))[0]?.id ?? "";
}

/**
 * "Parecen del mismo conjunto": marcas sueltas con nombre parecido (primera
 * palabra común o similitud de nombre). Solo ayuda: se lista bajo demanda y no
 * crea nada hasta que el planner elige las marcas y pulsa el botón de un grupo.
 */
export function SugerenciasConjuntos({
  ocupado,
  onCrear,
}: {
  ocupado: boolean;
  /** Asigna `marcaIds` a la cabeza; devuelve `true` si salió bien (el grupo se retira de la lista). */
  onCrear: (cabezaId: string, marcaIds: string[]) => Promise<boolean>;
}) {
  const [umbral, setUmbral] = useState("0.5");
  const [grupos, setGrupos] = useState<GrupoSugeridoConjunto[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Marcas desmarcadas (por id: cada marca está en un solo grupo) y cabeza elegida por grupo si difiere de la propuesta.
  const [desmarcadas, setDesmarcadas] = useState<Record<string, boolean>>({});
  const [cabezas, setCabezas] = useState<Record<string, string>>({});

  async function buscar() {
    setBuscando(true);
    setError(null);
    try {
      const r = await api.get<SugerenciasConjuntosRespuesta>(`/api/marcas/conjuntos/sugerencias?umbral=${umbral}`);
      setGrupos(r.grupos);
      setDesmarcadas({});
      setCabezas({});
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setBuscando(false);
    }
  }

  async function crear(g: GrupoSugeridoConjunto) {
    const cabeza = cabezas[claveGrupo(g)] ?? cabezaPorDefecto(g);
    const miembros = g.marcas.filter((m) => m.id !== cabeza && !desmarcadas[m.id]).map((m) => m.id);
    if (miembros.length === 0) return;
    const nombreCabeza = g.marcas.find((m) => m.id === cabeza)?.nombre ?? "la cabeza";
    if (!confirm(`¿Crear el conjunto ${nombreCabeza} con ${miembros.length} marca${miembros.length === 1 ? "" : "s"} como miembro${miembros.length === 1 ? "" : "s"}?`)) return;
    const ok = await onCrear(cabeza, miembros);
    if (ok) setGrupos((actual) => (actual ? actual.filter((x) => claveGrupo(x) !== claveGrupo(g)) : actual));
  }

  return (
    <details className="rounded-xl border border-borde bg-superficie shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-tinta">Parecen del mismo conjunto</summary>
      <div className="space-y-4 border-t border-borde px-5 py-4">
        <p className="text-sm text-tinta-suave">
          Marcas activas sin conjunto con la primera palabra en común o un nombre muy parecido. Es una lista para mirar: no se crea nada hasta
          que elijas las marcas de un grupo y pulses su botón.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-tinta">Parecido mínimo</span>
            <Select value={umbral} onChange={(e) => setUmbral(e.target.value)} className="h-8 w-32" disabled={buscando}>
              {["0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"].map((u) => (
                <option key={u} value={u}>
                  {u.replace(".", ",")}
                </option>
              ))}
            </Select>
          </label>
          <Button variante="secundario" tamano="sm" onClick={() => void buscar()} disabled={buscando || ocupado}>
            {buscando ? "Buscando…" : grupos ? "Volver a buscar" : "Buscar marcas parecidas"}
          </Button>
        </div>

        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {grupos && grupos.length === 0 && <EmptyState titulo="Ninguna marca parece de un conjunto" detalle="Baja el parecido mínimo para ver más candidatas." />}

        {grupos?.map((g) => {
          const cabeza = cabezas[claveGrupo(g)] ?? cabezaPorDefecto(g);
          const nombreCabeza = g.marcas.find((m) => m.id === cabeza)?.nombre ?? "";
          const miembros = g.marcas.filter((m) => m.id !== cabeza && !desmarcadas[m.id]);
          const razones = razonesDe(g);
          return (
            <div key={claveGrupo(g)} className="space-y-3 rounded-lg border border-borde bg-fondo p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-tinta">{g.marcas.map((m) => m.nombre).join(" · ")}</p>
                {razones.length > 0 && <p className="text-xs text-tinta-suave">{razones.join("; ")}</p>}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {g.marcas.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={m.id === cabeza || !desmarcadas[m.id]}
                      disabled={m.id === cabeza}
                      onChange={(v) => setDesmarcadas({ ...desmarcadas, [m.id]: !v })}
                      label={`Incluir ${m.nombre}`}
                    />
                    <span className={m.id === cabeza ? "font-medium" : ""}>{m.nombre}</span>
                    <span className="text-xs text-tinta-suave">{m.agrupacion_marca.nombre}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-tinta">Cabeza</span>
                  <Select value={cabeza} onChange={(e) => setCabezas({ ...cabezas, [claveGrupo(g)]: e.target.value })} className="h-8 w-48" aria-label="Cabeza del conjunto">
                    {g.marcas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button tamano="sm" disabled={ocupado || miembros.length === 0} onClick={() => void crear(g)}>
                  Crear conjunto con cabeza {nombreCabeza}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
