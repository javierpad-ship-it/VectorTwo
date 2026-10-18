"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { EliminarReglaApi, ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { CeldaAplicable, CeldaImi, CeldaPctDirecto } from "./comunes";
import { useAccion } from "./use-intercompany";
import { agruparPorClave, periodoCorto, reglaAnterior, rigeEn, soloFecha, textoConfirmarEliminar, textoErrorAccion } from "./vista";

/**
 * Pestaña Historial (ficha 13, sección 4): por clave, la secuencia de reglas con el "hasta" derivado. Una regla se edita (rango,
 * porcentaje, nota) o se elimina (se borra la fila y la anterior vuelve a regir: el `confirm` lo dice). Editar la fecha no se
 * permite: se elimina y se crea. La regla que rige en el mes elegido va marcada.
 */
export function PestanaHistorial({
  reglas,
  todas,
  mes,
  cargando,
  onEditar,
  onNuevaVigencia,
  onEliminada,
}: {
  /** Las reglas que dejan los filtros. */
  reglas: readonly ReglaIntercompanyApi[];
  /** Todas las reglas (sin filtrar): para saber cuál es la anterior de la que se elimina. */
  todas: readonly ReglaIntercompanyApi[];
  mes: string;
  cargando: boolean;
  onEditar: (regla: ReglaIntercompanyApi) => void;
  onNuevaVigencia: (base: ReglaIntercompanyApi) => void;
  onEliminada: (regla: ReglaIntercompanyApi) => void | Promise<void>;
}) {
  const accion = useAccion();
  const [eliminando, setEliminando] = useState<string | null>(null);
  const grupos = useMemo(() => agruparPorClave(reglas), [reglas]);

  async function eliminar(r: ReglaIntercompanyApi) {
    if (!confirm(textoConfirmarEliminar(r, reglaAnterior(r, todas)))) return;
    setEliminando(r.id);
    const res = await accion.ejecutar(() => api.delete<EliminarReglaApi>(`/api/intercompany/reglas/${r.id}`));
    setEliminando(null);
    if (res.ok) await onEliminada(r);
  }

  const columnas = (ultima: ReglaIntercompanyApi): Columna<ReglaIntercompanyApi>[] => [
    {
      clave: "desde",
      titulo: "Vigente desde",
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
          {periodoCorto(r.vigente_desde)}
          {rigeEn(r, mes) && <Badge tono="marca">Rige en {periodoCorto(mes)}</Badge>}
        </span>
      ),
    },
    { clave: "hasta", titulo: "Hasta", render: (r) => <span className="whitespace-nowrap">{r.hasta_derivado ? periodoCorto(r.hasta_derivado) : "abierta"}</span> },
    { clave: "min", titulo: "IMI mín", className: "text-right", render: (r) => <CeldaImi valor={r.imi_min} defecto={r.es_rango_defecto} /> },
    { clave: "max", titulo: "IMI máx", className: "text-right", render: (r) => <CeldaImi valor={r.imi_max} /> },
    { clave: "pct", titulo: "% directo", className: "text-right", render: (r) => <CeldaPctDirecto regla={r} /> },
    { clave: "aplicable", titulo: "Aplicable", render: (r) => <CeldaAplicable regla={r} /> },
    {
      clave: "quien",
      titulo: "Quién y cuándo",
      render: (r) => (
        <span className="text-xs text-tinta-suave">
          {r.usuario_nombre ?? "—"}
          <br />
          {soloFecha(r.updated_at)}
        </span>
      ),
    },
    { clave: "nota", titulo: "Nota", render: (r) => <span className="text-tinta-suave">{r.nota ?? "—"}</span> },
    {
      clave: "acciones",
      titulo: "Acciones",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <Button variante="secundario" tamano="sm" onClick={() => onEditar(r)} disabled={eliminando !== null}>
            Editar
          </Button>
          <Button variante="peligro" tamano="sm" onClick={() => void eliminar(r)} disabled={eliminando !== null}>
            {eliminando === r.id ? "Eliminando…" : "Eliminar"}
          </Button>
          {r.id === ultima.id && (
            <Button variante="fantasma" tamano="sm" onClick={() => onNuevaVigencia(r)} disabled={eliminando !== null}>
              Nueva vigencia
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}
      {cargando ? (
        <p className="py-6 text-center text-sm text-tinta-suave">Cargando…</p>
      ) : grupos.length === 0 ? (
        <EmptyState titulo="No hay reglas con estos filtros" detalle="Quita filtros o crea una regla nueva." />
      ) : (
        grupos.map((g) => (
          <Card key={g.clave} titulo={`${g.marca} · ${g.ruta}`} descripcion={`${g.reglas.length === 1 ? "1 regla" : `${g.reglas.length} reglas`}, de la más antigua a la más reciente.`}>
            <DataTable columnas={columnas(g.reglas[g.reglas.length - 1])} filas={g.reglas} claveFila={(r) => r.id} claseFila={(r) => (rigeEn(r, mes) ? "bg-marca-suave/40" : undefined)} />
          </Card>
        ))
      )}
    </div>
  );
}
