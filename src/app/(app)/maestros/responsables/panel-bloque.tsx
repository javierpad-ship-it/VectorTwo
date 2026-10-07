"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form";
import {
  describirPlan,
  motivoBloqueoBloque,
  nombreVisible,
  planBloque,
  type AmbitoBloque,
} from "@/lib/responsables/pantalla";
import type { AsignarMasivaCuerpo, CeldaResponsable, CompradorAsignable } from "@/lib/responsables/tipos-api";

const QUITAR = "__quitar__";

/**
 * Panel en línea de la asignación en bloque (una fila, una columna o toda la
 * matriz). El texto del plan se calcula en el cliente; el servidor recalcula
 * todo al aplicar (nunca pisa a quien se asignó mientras tanto con la casilla
 * apagada). Se monta con `key` por ámbito para que su estado empiece limpio.
 */
export function PanelBloque({
  ambito,
  titulo,
  deLabel,
  celdas,
  compradores,
  ocupado,
  onCerrar,
  onAplicar,
}: {
  ambito: AmbitoBloque;
  /** "Asignar combinaciones de HOMBRE". */
  titulo: string;
  /** Complemento para los textos: "de HOMBRE", "del mundo URBANO", "de toda la matriz". */
  deLabel: string;
  celdas: readonly CeldaResponsable[];
  /** Compradores activos, ya ordenados. */
  compradores: readonly CompradorAsignable[];
  ocupado: boolean;
  onCerrar: () => void;
  onAplicar: (cuerpo: AsignarMasivaCuerpo, quitar: boolean) => Promise<void>;
}) {
  const [destinoElegido, setDestino] = useState("");
  // Si el comprador elegido deja de estar entre los activos (lo desactivaron o eliminaron desde otro lado),
  // el destino vuelve a "Elige un comprador…" para que el texto y el botón no hablen de otra cosa.
  const destino =
    destinoElegido === "" || destinoElegido === QUITAR || compradores.some((c) => c.id === destinoElegido) ? destinoElegido : "";
  const [reemplazar, setReemplazar] = useState(false);

  const quitar = destino === QUITAR;
  const perfilId = destino === "" || quitar ? null : destino;
  const comprador = compradores.find((c) => c.id === destino) ?? null;
  const nombreComprador = comprador ? nombreVisible(comprador) : null;

  const plan = useMemo(() => planBloque(celdas, ambito, { perfilId, reemplazar }), [celdas, ambito, perfilId, reemplazar]);
  const motivo = motivoBloqueoBloque(plan, { elegido: destino !== "", quitar, reemplazar });

  function aplicar() {
    if (motivo || ocupado) return;
    if (quitar) {
      if (!confirm(`Se quitará el responsable de ${plan.aplicar} combinaciones ${deLabel}. Quedarán como faltantes. ¿Continuar?`)) return;
    } else if (plan.reemplazos > 0) {
      if (!confirm(`Se reemplazará el responsable de ${plan.reemplazos} ${plan.reemplazos === 1 ? "combinación" : "combinaciones"} ${deLabel} por ${nombreComprador}. ¿Continuar?`)) return;
    }
    void onAplicar({ combinaciones: plan.combinaciones, perfil_id: perfilId, solo_faltantes: !quitar && !reemplazar }, quitar);
  }

  return (
    <section aria-label={titulo} className="space-y-3 rounded-xl border border-marca/30 bg-marca-suave/40 p-4">
      <h2 className="text-sm font-semibold text-tinta">{titulo}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsable">
          <Select value={destino} onChange={(e) => setDestino(e.target.value)} disabled={ocupado}>
            <option value="">Elige un comprador…</option>
            <option value={QUITAR}>Quitar responsable</option>
            {compradores.map((c) => (
              <option key={c.id} value={c.id}>
                {nombreVisible(c)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-tinta">
          <Checkbox checked={reemplazar} onChange={setReemplazar} disabled={ocupado} label="Reemplazar también las que ya tienen responsable" />
          Reemplazar también las que ya tienen responsable
        </label>
      </div>

      {destino !== "" && <p className="text-sm text-tinta">{describirPlan(plan, deLabel, nombreComprador)}</p>}
      {motivo && destino !== "" && <p className="text-xs text-tinta-suave">{motivo}</p>}

      <div className="flex flex-wrap gap-2">
        <Button tamano="sm" onClick={aplicar} disabled={ocupado || motivo !== null} title={motivo ?? undefined}>
          {ocupado ? "Aplicando…" : "Aplicar"}
        </Button>
        <Button tamano="sm" variante="fantasma" onClick={onCerrar} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
