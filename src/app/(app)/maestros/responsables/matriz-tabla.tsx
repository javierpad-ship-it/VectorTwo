"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import {
  claveCelda,
  conteoEje,
  etiquetaResponsableNoValido,
  nombreVisible,
  textoLineas,
  textoResponsable,
  type AmbitoBloque,
} from "@/lib/responsables/pantalla";
import type { CeldaResponsable, CompradorAsignable, GeneroResponsables, MundoResponsables } from "@/lib/responsables/tipos-api";

type Props = {
  generos: readonly GeneroResponsables[];
  mundos: readonly MundoResponsables[];
  celdas: readonly CeldaResponsable[];
  indice: ReadonlyMap<string, CeldaResponsable>;
  /** Claves de las celdas que pasan el filtro activo. */
  visibles: ReadonlySet<string>;
  /** Compradores activos, ya ordenados. */
  compradores: readonly CompradorAsignable[];
  /** Admin y planner: selectores por celda y asignación en bloque. */
  puedeAsignar: boolean;
  /** Celdas con un guardado en curso. */
  guardando: ReadonlySet<string>;
  bloqueado: boolean;
  onAsignar: (celda: CeldaResponsable, perfilId: string | null) => void;
  onBloque: (ambito: AmbitoBloque) => void;
};

/** Matriz géneros (filas) × mundos (columnas). Las filas y columnas sin celdas visibles se atenúan, no desaparecen. */
export function MatrizTabla({ generos, mundos, celdas, indice, visibles, compradores, puedeAsignar, guardando, bloqueado, onAsignar, onBloque }: Props) {
  const generoConVisibles = new Set<string>();
  const mundoConVisibles = new Set<string>();
  for (const c of celdas) {
    if (!visibles.has(claveCelda(c.genero_id, c.mundo_id))) continue;
    generoConVisibles.add(c.genero_id);
    mundoConVisibles.add(c.mundo_id);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead className="bg-neutro-suave text-left text-xs text-tinta-suave">
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-40 bg-neutro-suave px-3 py-2 align-top font-medium">
              {puedeAsignar ? (
                <Button variante="secundario" tamano="sm" onClick={() => onBloque("todas")} disabled={bloqueado}>
                  Asignar todas…
                </Button>
              ) : (
                <span className="uppercase tracking-wide">Género / Mundo</span>
              )}
            </th>
            {mundos.map((m) => {
              const { con, total } = conteoEje(celdas, { mundo_id: m.id });
              return (
                <th
                  key={m.id}
                  scope="col"
                  className={`min-w-44 px-3 py-2 align-top font-medium ${!m.activo || !mundoConVisibles.has(m.id) ? "opacity-50" : ""}`}
                >
                  <div className="text-sm font-semibold normal-case text-tinta">{m.nombre}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {m.activo ? <span className="font-mono">{con}/{total}</span> : <Badge tono="alerta">Inactivo</Badge>}
                    {puedeAsignar && m.activo && (
                      <button
                        type="button"
                        onClick={() => onBloque({ mundo_id: m.id })}
                        disabled={bloqueado}
                        className="font-medium text-marca-oscura underline-offset-2 hover:underline disabled:opacity-50"
                        aria-label={`Asignar la columna ${m.nombre}`}
                      >
                        Asignar…
                      </button>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">
          {generos.map((g) => {
            const { con, total } = conteoEje(celdas, { genero_id: g.id });
            return (
              <tr key={g.id}>
                <th
                  scope="row"
                  className={`sticky left-0 z-10 bg-superficie px-3 py-2 text-left align-top font-medium ${!g.activo || !generoConVisibles.has(g.id) ? "opacity-50" : ""}`}
                >
                  <div className="text-sm font-semibold text-tinta">{g.nombre}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-tinta-suave">
                    {g.activo ? <span className="font-mono">{con}/{total}</span> : <Badge tono="alerta">Inactivo</Badge>}
                    {puedeAsignar && g.activo && (
                      <button
                        type="button"
                        onClick={() => onBloque({ genero_id: g.id })}
                        disabled={bloqueado}
                        className="font-medium text-marca-oscura underline-offset-2 hover:underline disabled:opacity-50"
                        aria-label={`Asignar la fila ${g.nombre}`}
                      >
                        Asignar…
                      </button>
                    )}
                  </div>
                </th>
                {mundos.map((m) => {
                  const celda = indice.get(claveCelda(g.id, m.id));
                  return (
                    <Celda
                      key={m.id}
                      celda={celda ?? null}
                      etiqueta={`${g.nombre} / ${m.nombre}`}
                      visible={celda ? visibles.has(claveCelda(g.id, m.id)) : false}
                      compradores={compradores}
                      editable={puedeAsignar}
                      guardando={guardando.has(claveCelda(g.id, m.id))}
                      bloqueado={bloqueado}
                      onAsignar={onAsignar}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Celda({
  celda,
  etiqueta,
  visible,
  compradores,
  editable,
  guardando,
  bloqueado,
  onAsignar,
}: {
  celda: CeldaResponsable | null;
  etiqueta: string;
  visible: boolean;
  compradores: readonly CompradorAsignable[];
  editable: boolean;
  guardando: boolean;
  bloqueado: boolean;
  onAsignar: (celda: CeldaResponsable, perfilId: string | null) => void;
}) {
  if (!celda) return <td className="px-3 py-2 align-top text-tinta-suave">—</td>;

  // Género o mundo inactivo: atenuada, sin selector, "Inactivo" (conserva el responsable que tuviera).
  if (!celda.vigente) {
    return (
      <td className="bg-neutro-suave/50 px-3 py-2 align-top opacity-60">
        <Badge tono="neutro">Inactivo</Badge>
        {celda.responsable && <div className="mt-1 truncate text-xs text-tinta-suave">{nombreVisible(celda.responsable)}</div>}
      </td>
    );
  }

  const estado = textoResponsable(celda);
  const noValido = etiquetaResponsableNoValido(celda);
  const actualEnLista = celda.responsable ? compradores.some((c) => c.id === celda.responsable?.id) : false;

  return (
    <td className={`px-3 py-2 align-top transition-opacity ${celda.faltante ? "bg-alerta-suave" : ""} ${visible ? "" : "opacity-40"}`}>
      {editable ? (
        <Select
          value={celda.responsable?.id ?? ""}
          disabled={guardando || bloqueado}
          aria-label={`Responsable de ${etiqueta}`}
          onChange={(e) => onAsignar(celda, e.target.value === "" ? null : e.target.value)}
          className="h-8! text-xs"
        >
          <option value="">— Sin responsable —</option>
          {noValido && celda.responsable && (
            <option value={celda.responsable.id} disabled>
              {noValido}
            </option>
          )}
          {celda.responsable && !noValido && !actualEnLista && (
            <option value={celda.responsable.id}>{nombreVisible(celda.responsable)}</option>
          )}
          {compradores.map((c) => (
            <option key={c.id} value={c.id}>
              {nombreVisible(c)}
            </option>
          ))}
        </Select>
      ) : (
        !celda.faltante && celda.responsable && <div className="truncate font-medium text-tinta">{nombreVisible(celda.responsable)}</div>
      )}

      {celda.faltante && estado && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tono="alerta">Faltante</Badge>
          <span className="text-xs font-medium text-alerta">{estado.texto}</span>
        </div>
      )}
      <div className={`mt-1 text-xs ${celda.lineas === 0 ? "italic text-tinta-suave/80" : "text-tinta-suave"}`}>
        {guardando ? "Guardando…" : textoLineas(celda.lineas)}
      </div>
    </td>
  );
}
