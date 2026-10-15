"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { formatearDecimal } from "@/lib/formato";
import type { FactorApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, Cargando } from "./comunes";
import { useAccion, useLectura } from "./use-proyeccion";
import { formatearMomento, leerFactor } from "./vista";

const TEMPORADA: Record<FactorApi["temporada"], string> = { invierno: "Invierno", verano: "Verano" };
const factor = (n: number | null) => (n === null ? "—" : formatearDecimal(n, 2));

/** Una fila de la tabla: el factor aplicado y la nota se editan y se guardan por fila. Se monta con `key` = lo guardado. */
function FilaFactor({ f, soloLectura, ocupado, onGuardar }: { f: FactorApi; soloLectura: boolean; ocupado: boolean; onGuardar: (f: FactorApi, aplicado: number | null, nota: string | null) => Promise<boolean> }) {
  const [aplicado, setAplicado] = useState(f.ratio_aplicado === null ? "" : String(f.ratio_aplicado));
  const [nota, setNota] = useState(f.nota ?? "");
  const [motivo, setMotivo] = useState<string | null>(null);
  const lectura = leerFactor(aplicado);
  const sucio = aplicado.trim() !== (f.ratio_aplicado === null ? "" : String(f.ratio_aplicado)) || nota.trim() !== (f.nota ?? "");

  async function guardar() {
    if (!lectura.ok) {
      setMotivo(lectura.motivo);
      return;
    }
    setMotivo(null);
    await onGuardar(f, lectura.valor, nota.trim() === "" ? null : nota.trim());
  }

  return (
    <tr className={f.objetivo ? "bg-marca-suave/40" : undefined}>
      <td className="px-3 py-2 font-medium">
        {f.anio}
        {f.objetivo && (
          <span className="ml-2">
            <Badge tono="marca">Año objetivo</Badge>
          </span>
        )}
      </td>
      <td className="px-3 py-2">{TEMPORADA[f.temporada]}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {factor(f.ratio_calculado)}
        {f.parcial && (
          <span className="ml-2 font-sans">
            <Badge tono="alerta">Parcial</Badge>
          </span>
        )}
        <span className="block font-sans text-xs text-tinta-suave">
          {f.tiendas_comunes === null ? "sin calcular" : `${f.tiendas_comunes} tiendas · ${f.meses_comparados ?? 0} meses · ${formatearMomento(f.calculado_at)}`}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-end gap-0.5">
          <Input
            inputMode="decimal"
            value={aplicado}
            disabled={soloLectura || ocupado}
            placeholder={factor(f.ratio_calculado)}
            aria-label={`Factor aplicado, ${TEMPORADA[f.temporada]} ${f.anio}`}
            aria-invalid={motivo !== null}
            onChange={(e) => {
              setAplicado(e.target.value);
              setMotivo(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void guardar();
              }
            }}
            className={`h-8 w-24! text-right font-mono tabular-nums ${motivo ? "border-alerta!" : ""}`}
          />
          {motivo && <span className="max-w-40 text-right text-xs text-alerta">{motivo}</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{factor(f.ratio_efectivo)}</td>
      <td className="px-3 py-2">{f.origen === "manual" ? <Badge tono="marca">Manual</Badge> : f.origen === "calculado" ? <Badge tono="neutro">Calculado</Badge> : <Badge tono="alerta">Sin factor</Badge>}</td>
      <td className="px-3 py-2">
        <Input value={nota} maxLength={200} disabled={soloLectura || ocupado} aria-label={`Nota, ${TEMPORADA[f.temporada]} ${f.anio}`} onChange={(e) => setNota(e.target.value)} className="h-8" />
      </td>
      <td className="px-3 py-2 text-right">
        {!soloLectura && (
          <Button variante="secundario" tamano="sm" disabled={ocupado || !sucio} onClick={() => void guardar()}>
            Guardar
          </Button>
        )}
      </td>
    </tr>
  );
}

/** La tabla de factores (presentación pura): año atípico × temporada con el ratio calculado, el aplicado y la nota. */
export function TablaFactores({ filas, soloLectura, ocupado, onGuardar }: { filas: readonly FactorApi[]; soloLectura: boolean; ocupado: boolean; onGuardar: (f: FactorApi, aplicado: number | null, nota: string | null) => Promise<boolean> }) {
  return (
          <div className="overflow-x-auto rounded-lg border border-borde">
            <table className="w-full text-sm">
              <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
                <tr>
                  <th className="px-3 py-2 font-medium">Año</th>
                  <th className="px-3 py-2 font-medium">Temporada</th>
                  <th className="px-3 py-2 text-right font-medium">Calculado por M6</th>
                  <th className="px-3 py-2 text-right font-medium">Aplicado</th>
                  <th className="px-3 py-2 text-right font-medium">Efectivo</th>
                  <th className="px-3 py-2 font-medium">Origen</th>
                  <th className="px-3 py-2 font-medium">Nota</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-tinta-suave">
                      Todavía no hay años atípicos. Carga los periodos del Niño en Curvas de estacionalidad y sincroniza.
                    </td>
                  </tr>
                )}
                {filas.map((f) => (
                  <FilaFactor key={`${f.anio}-${f.temporada}-${f.ratio_aplicado}-${f.nota}-${f.ratio_calculado}`} f={f} soloLectura={soloLectura} ocupado={ocupado} onGuardar={onGuardar} />
                ))}
              </tbody>
            </table>
          </div>
  );
}

/**
 * Pestaña Factores del Niño (ficha 07). Año atípico × temporada: el ratio que calculó M6 con la venta cargada (con las
 * tiendas comunes, los meses comparados y si el año está incompleto) y el ratio aplicado, que se edita aquí (vacío = el
 * calculado). «Sincronizar con M6» vuelve a leer los ratios calculados. Editar un factor marca desactualizadas las
 * proyecciones en trabajo: hay que recalcular.
 */
export function FactoresTab({ puedeEditar, onCambio }: { puedeEditar: boolean; onCambio: () => Promise<void> }) {
  const lectura = useLectura<FactorApi[]>("/api/proyeccion/factores");
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const filas = lectura.datos ?? [];

  async function guardar(f: FactorApi, aplicado: number | null, nota: string | null): Promise<boolean> {
    setAviso(null);
    const r = await accion.ejecutar(() => api.put<FactorApi[]>("/api/proyeccion/factores", { factores: [{ anio: f.anio, temporada: f.temporada, ratio_aplicado: aplicado, nota }] }));
    if (!r.ok) return false;
    setAviso(`Factor de ${TEMPORADA[f.temporada].toLowerCase()} ${f.anio} guardado. Las proyecciones en trabajo quedan desactualizadas: recalcúlalas para que lo usen.`);
    await Promise.all([lectura.recargar(), onCambio()]);
    return true;
  }

  async function sincronizar() {
    if (!confirm("Sincronizar con M6 vuelve a calcular el ratio de cada año atípico y temporada con la venta cargada. Los factores que tú aplicaste no cambian, pero las proyecciones en trabajo quedarán desactualizadas. ¿Sincronizar?")) return;
    setAviso(null);
    const r = await accion.ejecutar(() => api.post<FactorApi[]>("/api/proyeccion/factores/sincronizar", {}));
    if (!r.ok) return;
    setAviso("Factores sincronizados con M6.");
    await Promise.all([lectura.recargar(), onCambio()]);
  }

  return (
    <Card
      titulo="Factores del Niño"
      descripcion="Cuánto vendió un año atípico frente a lo que esperaban las mismas tiendas, por temporada. 0.66 = en 2026 el invierno vendió un 34 % menos de lo normal; al proyectar, los meses del Niño se dividen entre el factor."
      acciones={
        puedeEditar ? (
          <Button variante="secundario" tamano="sm" disabled={accion.ocupado} onClick={() => void sincronizar()}>
            {accion.ocupado ? "Trabajando…" : "Sincronizar con M6"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecargar={() => void lectura.recargar()} />}
        {aviso && (
          <Alert tono="exito" onCerrar={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}
        {lectura.cargando && !lectura.datos && <Cargando />}
        {lectura.datos && (
          <TablaFactores filas={filas} soloLectura={!puedeEditar} ocupado={accion.ocupado} onGuardar={guardar} />
        )}
        <p className="text-xs text-tinta-suave">
          «Parcial» = el año todavía no está completo (el verano de un año en curso se mide con pocos meses). «Año objetivo» = el año siguiente de la proyección: si M6 lo marca atípico, su curva se repondera con el factor.
          Toda temporada nunca se ajusta.
        </p>
      </div>
    </Card>
  );
}
