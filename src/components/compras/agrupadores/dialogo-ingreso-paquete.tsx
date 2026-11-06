"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_CAUSA_FECHA,
  LISTA_CAUSAS_FECHA,
  type CausaFecha,
  type EmbarqueDetalleApi,
  type PaqueteApi,
  type PlanFechasApi,
  type PlanMovimientoApi,
  type RespuestaMovimientoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { fijarIngresoPaquete } from "@/lib/compras/agrupadores/use-agrupadores";
import { fechaLima } from "../formato";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { cuerpoDeIngresoPaquete, fechaCorta, textoCambioFecha, textoFechaHito, textoMeses } from "./vista-fechas";

/** El piso del ingreso propio de un paquete: el ingreso real del embarque si ya llegó, si no su Ingreso CD (08b-1b §2.5). */
export const pisoDelPaquete = (e: Pick<EmbarqueDetalleApi, "fecha_llegada_real" | "fecha_llegada_estimada">): string => e.fecha_llegada_real ?? e.fecha_llegada_estimada;

/**
 * «Fijar ingreso…» de un paquete (ficha 08b-1b §4.5, lo al barrer): fija, cambia o suelta el ingreso al stock propio del paquete. El
 * selector no ofrece días antes de la llegada del embarque; si aun así el cambio queda antes, la vista previa lo avisa y el servidor lo sube
 * a la llegada (`ingreso_paquete_ajustado`). Si el mes cambia, mueve entregas (y repartos de lo al barrer cuando cambia la temporada):
 * la vista previa lo dice antes de aplicar. Motivo y causa son obligatorios.
 */
export function DialogoIngresoPaquete({
  embarque,
  paquete,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  paquete: PaqueteApi;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [hoy] = useState(() => fechaLima());
  const piso = pisoDelPaquete(embarque);
  const heredado = embarque.fecha_llegada_real ?? embarque.fecha_ingreso_estimada ?? embarque.fecha_llegada_estimada;
  const [fecha, setFecha] = useState(paquete.fecha_ingreso ?? (heredado > piso ? heredado : piso));
  const [motivo, setMotivo] = useState("");
  const [causa, setCausa] = useState<CausaFecha | null>(null);
  const r = cuerpoDeIngresoPaquete(paquete, embarque.revision, fecha, motivo, causa);
  const propio = paquete.ingreso_propio === true && (paquete.fecha_ingreso ?? null) !== null;

  return (
    <DialogoMovimiento<NonNullable<typeof r.cuerpo>>
      titulo={`Ingreso al stock · Paquete ${paquete.codigo}`}
      descripcion="Cuándo entra al stock lo de este paquete. Decide el mes en que cuenta en el flujo y, en lo al barrer, con qué temporada se reparte."
      cuerpo={r.cuerpo}
      llamar={(c, previsualizar) => fijarIngresoPaquete(paquete.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar={fecha === "" ? "Soltar el ingreso" : "Fijar el ingreso"}
      pista={r.pista}
      vistaExtra={(plan) => <ExtraIngreso plan={plan} hoy={hoy} />}
    >
      <div className="space-y-4">
        <div className="space-y-1 rounded-lg border border-borde p-3 text-sm">
          <p>
            <MarcadorIngreso /> Ahora:{" "}
            <strong className="tabular-nums">{propio ? `ingreso propio ${textoFechaHito(paquete.fecha_ingreso ?? null)}` : `hereda del embarque (${textoFechaHito(heredado)})`}</strong>
          </p>
          {paquete.ajustado_desde && <p className="text-xs text-alerta">Ajustado a la llegada del embarque (antes: {fechaCorta(paquete.ajustado_desde, hoy)}).</p>}
          <p className="text-xs text-tinta-suave">
            El embarque llega al CD el {textoFechaHito(piso)}: el ingreso del paquete no puede ser antes. {(paquete.lotes_al_barrer ?? 0) > 0 ? `Tiene ${paquete.lotes_al_barrer} lote(s) al barrer.` : ""}
          </p>
        </div>
        <Field label="Fecha de ingreso al stock del paquete" hint="No ofrece días antes de la llegada del embarque.">
          <Input type="date" value={fecha} min={piso} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        {propio && (
          <Button variante="secundario" tamano="sm" onClick={() => setFecha("")}>
            Soltar el ingreso propio (hereda el del embarque)
          </Button>
        )}
        {fecha === "" && propio && <p className="text-xs text-tinta-suave">Quedará heredando el ingreso del embarque ({textoFechaHito(heredado)}).</p>}
        <Field label="Causa *" hint={causa === null ? "Propuesta: Programación del ingreso." : undefined}>
          <Select value={causa ?? "programacion"} onChange={(e) => setCausa(e.target.value as CausaFecha)} aria-required>
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
      </div>
    </DialogoMovimiento>
  );
}

function MarcadorIngreso() {
  return (
    <span aria-hidden="true" className="mr-1">
      {"\u{1F7E2}"}
    </span>
  );
}

function ExtraIngreso({ plan, hoy }: { plan: PlanMovimientoApi; hoy: string }) {
  const p = plan as Partial<PlanFechasApi>;
  const cambios = p.cambios ?? [];
  const meses = p.meses ?? [];
  return (
    <div className="space-y-2 text-sm">
      {cambios.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5" aria-label="Qué cambia">
          {cambios.map((c, i) => (
            <li key={`${c.hito}-${c.paquete?.id ?? ""}-${i}`}>{textoCambioFecha(c, hoy)}</li>
          ))}
        </ul>
      )}
      {meses.length > 0 ? <p className="font-medium">Cambia el mes: {textoMeses(meses).join("; ")}.</p> : <p className="text-xs text-tinta-suave">Este ingreso no cambia el mes: el flujo no se mueve.</p>}
    </div>
  );
}
