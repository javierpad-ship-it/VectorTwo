"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_CAUSA_FECHA,
  LISTA_CAUSAS_FECHA,
  type AsignacionApi,
  type CausaFecha,
  type EmbarqueDetalleApi,
  type RespuestaMovimientoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { moverAPaquete } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { DialogoMovimiento, ExtraMesesPlan } from "./dialogo-movimiento";
import { textoFecha, textoLinea } from "./vista-agrupadores";
import { cambiaDeMes, cuerpoMoverAPaquete, itemsDeTanda, mesDeDestinoPantalla, textoErrorBarrer } from "./vista-barrer";

/**
 * «Mover a paquete» (ficha 08b §3.3 y 08b-1b §4.5): cambia de paquete asignaciones del MISMO embarque, con UNIDADES editables por
 * asignación (por defecto, todas; menos unidades mueve solo una parte). «Sin paquete» las saca del paquete. Si el paquete de destino tiene
 * ingreso propio en otro mes (o se sacan de uno que lo tiene), el movimiento cambia de mes: entonces la vista previa es obligatoria y se
 * piden motivo y causa; si no, se aplica directo (la vista previa es opcional). Se permite aunque el embarque tenga recepciones, salvo que
 * cambie de mes (`asignacion_con_recepciones`). Un paquete de otro embarque da `409 paquete_de_otro_embarque`.
 */
export function DialogoAPaquete({
  embarque,
  asignaciones,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  asignaciones: readonly AsignacionApi[];
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [paqueteId, setPaqueteId] = useState("");
  const [escritas, setEscritas] = useState<Record<string, string>>(() => Object.fromEntries(asignaciones.map((a) => [a.id, String(a.unidades)])));
  const [motivo, setMotivo] = useState("");
  const [causa, setCausa] = useState<CausaFecha>("programacion");
  const paquetes = embarque.paquetes.filter((p) => p.estado === "abierto");
  const destino = paquetes.find((p) => p.id === paqueteId) ?? null;
  const heredado = embarque.fecha_llegada_real ?? embarque.fecha_ingreso_estimada ?? embarque.fecha_llegada_estimada;

  const { items, error: errorUnidades } = itemsDeTanda(escritas, asignaciones);
  const excedida = asignaciones.find((a) => (items.find((i) => i.id === a.id)?.unidades ?? 0) > a.unidades);
  const mesDestino = mesDeDestinoPantalla(embarque, destino);
  const cambiaMes = cambiaDeMes(items, asignaciones, mesDestino, destino?.id ?? null);
  const total = items.reduce((a, i) => a + i.unidades, 0);

  let pista: string | undefined;
  if (errorUnidades) pista = errorUnidades;
  else if (items.length === 0) pista = "Escribe las unidades de al menos una asignación.";
  else if (excedida) pista = `${excedida.compra.numero}: no puedes mover más de ${unidades(excedida.unidades)} u.`;
  else if (cambiaMes && motivo.trim() === "") pista = "Esto cambia de mes: escribe el motivo.";
  const valido = pista === undefined;
  const cuerpo = valido ? cuerpoMoverAPaquete({ revision: embarque.revision, paqueteId: destino?.id ?? null, items, asignaciones, motivo: cambiaMes ? motivo : "", causa: cambiaMes ? causa : null }) : null;

  return (
    <DialogoMovimiento<NonNullable<typeof cuerpo>>
      titulo="Mover a paquete"
      descripcion={`${plural(asignaciones.length, "asignación", "asignaciones")} del embarque ${embarque.codigo}. ${cambiaMes ? "Esto cambia de mes: mira la vista previa." : "No cambia ningún mes."}`}
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => moverAPaquete(embarque.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Mover"
      previaOpcional={!cambiaMes}
      textoError={(e) => textoErrorBarrer(e)}
      pista={pista}
      vistaExtra={(plan) => <ExtraMesesPlan plan={plan} />}
      ancho="max-w-2xl"
    >
      <div className="space-y-4">
        <Field label="Paquete de destino">
          <Select value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
            <option value="">Sin paquete</option>
            {paquetes.map((p) => (
              <option key={p.id} value={p.id}>
                Paquete {p.codigo} · {p.nombre} · {p.ingreso_propio && p.fecha_ingreso ? `ingreso propio ${textoFecha(p.fecha_ingreso)}` : `hereda del embarque (${textoFecha(heredado)})`}
              </option>
            ))}
          </Select>
        </Field>

        <section aria-label="Unidades a mover" className="space-y-2">
          <p className="text-xs font-medium text-tinta-suave">Unidades de cada asignación que se mueven</p>
          <ul className="space-y-2">
            {asignaciones.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 basis-40 text-sm">
                  <span className="font-medium">{a.compra.numero}</span> · {textoLinea(a.linea)} · <span className="whitespace-nowrap">{mesCorto(a.periodo)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Input
                    inputMode="numeric"
                    value={escritas[a.id] ?? ""}
                    onChange={(e) => setEscritas((x) => ({ ...x, [a.id]: e.target.value }))}
                    aria-label={`Unidades de ${a.compra.numero}, ${textoLinea(a.linea)}`}
                    className="w-24 text-right font-mono tabular-nums"
                    autoComplete="off"
                  />
                  <span className="whitespace-nowrap text-xs text-tinta-suave">de {unidades(a.unidades)} u</span>
                  <Button tamano="sm" variante="fantasma" onClick={() => setEscritas((x) => ({ ...x, [a.id]: String(a.unidades) }))} aria-label={`Mover todo de ${a.compra.numero}, ${textoLinea(a.linea)}`}>
                    Todo
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-tinta-suave" aria-live="polite">
            Se mueven {unidades(total)} u.
          </p>
        </section>

        {cambiaMes && (
          <section aria-label="Motivo y causa" className="grid gap-3 sm:grid-cols-2">
            <Field label="Causa *" hint="Obligatoria porque cambia de mes.">
              <Select value={causa} onChange={(e) => setCausa(e.target.value as CausaFecha)} aria-required>
                {LISTA_CAUSAS_FECHA.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETA_CAUSA_FECHA[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motivo *" hint="Queda en el historial del embarque.">
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} aria-required />
            </Field>
          </section>
        )}
      </div>
    </DialogoMovimiento>
  );
}
