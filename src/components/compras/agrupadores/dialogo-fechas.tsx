"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { etiquetaMes } from "@/lib/compras/agrupadores/fechas";
import { MAX_MOTIVO_MOVIMIENTO } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_CAUSA_FECHA,
  ETIQUETA_HITO,
  LISTA_CAUSAS_FECHA,
  type CausaFecha,
  type EmbarqueDetalleApi,
  type HitoApi,
  type HitoConfirmable,
  type PlanFechasApi,
  type PlanMovimientoApi,
  type RespuestaMovimientoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { cambiarFechasEmbarque } from "@/lib/compras/agrupadores/use-agrupadores";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { MarcadorHito, EstadoHitoBadge } from "./linea-tiempo";
import {
  ahoraEnLima,
  cuerpoDeFechas,
  estaMarcado,
  fechaCorta,
  formInicialFechas,
  horaAhora,
  hitosDelEmbarque,
  marcarHito,
  textoCambioFecha,
  textoFechaHito,
  textoMeses,
  type FormFechas,
} from "./vista-fechas";

function Bloque({ hito, ahora, hoy, hitoApi, children, extra }: { hito: HitoApi["hito"]; ahora?: ReactNode; hoy: string; hitoApi?: HitoApi; children: ReactNode; extra?: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 rounded-lg border border-borde p-3" data-hito={hito}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        <MarcadorHito hito={hito} />
        {ETIQUETA_HITO[hito]}
      </legend>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-suave">
        <span>
          Ahora: <span className="font-medium text-tinta">{ahora ?? "—"}</span>
        </span>
        {hitoApi && <EstadoHitoBadge hito={hitoApi} hoy={hoy} />}
      </p>
      {children}
      {extra}
    </fieldset>
  );
}

/**
 * «Fechas del embarque» (ficha 08b-1b §4.3): cambia Zarpe, Arribo, Ingreso CD, Inicio operativo (fecha y hora opcional) e Ingreso al stock, y
 * marca hasta dónde «ya ocurrió». Solo viajan las fechas que cambian. La vista previa dice qué hitos se mueven, cuántos meses y compras (y
 * cuáles paquetes quedan quietos o suben a la llegada); reprogramar pide motivo y causa. Cada hito cambiado puede volver a su fecha anterior
 * con «Usar la fecha anterior». El Ingreso al stock sin fijar sigue al Ingreso CD; fijado, se vuelve a igualar con «Igualar al Ingreso CD».
 */
export function DialogoFechas({
  embarque,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const [ahora] = useState(() => ahoraEnLima());
  const hoy = ahora.fecha;
  const [form, setForm] = useState<FormFechas>(() => formInicialFechas(embarque));
  const inicial = formInicialFechas(embarque);
  const esLocal = embarque.tipo === "local";
  const ocultos: HitoConfirmable[] = esLocal ? ["arribo"] : [];
  const poner = (c: Partial<FormFechas>) => setForm((f) => ({ ...f, ...c }));
  const hitosActuales = hitosDelEmbarque(embarque, hoy);
  const hitoDe = (h: HitoApi["hito"]) => hitosActuales.find((x) => x.hito === h);

  const r = cuerpoDeFechas(embarque, form, ahora);
  const marca = (hito: HitoConfirmable) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={estaMarcado(form.confirmado, hito)}
        onChange={(v) => {
          const nuevo = marcarHito(hito, v, ocultos);
          const c: Partial<FormFechas> = { confirmado: nuevo };
          if (v && hito === "inicio_operativo") {
            if (form.inicioFecha === "") c.inicioFecha = hoy;
            if (form.inicioHora === "") c.inicioHora = horaAhora(ahora);
          }
          poner(c);
        }}
        label={`¿Ya ocurrió? ${ETIQUETA_HITO[hito]}`}
      />
      <span>¿Ya ocurrió?</span>
      {estaMarcado(form.confirmado, hito) && form.confirmado !== hito && <span className="text-xs text-tinta-suave">(porque un hito posterior ya ocurrió)</span>}
    </label>
  );
  const anterior = (cambio: boolean, alVolver: Partial<FormFechas>) =>
    cambio ? (
      <Button variante="fantasma" tamano="sm" onClick={() => poner(alVolver)}>
        Usar la fecha anterior
      </Button>
    ) : null;

  const ingresoEfectivoAhora = embarque.fecha_ingreso_estimada ?? embarque.fecha_llegada_estimada;
  const ingresoEfectivoNuevo = form.ingresoFijo ? form.ingresoStock : form.ingresoCd;
  const motivoObligatorio = r.reprograma;

  return (
    <DialogoMovimiento<NonNullable<typeof r.cuerpo>>
      titulo={`Fechas del embarque ${embarque.codigo}`}
      descripcion="El Ingreso al stock decide el mes en que la mercadería cuenta en el flujo. Solo cambian las fechas que modifiques."
      cuerpo={r.cuerpo}
      llamar={(c, previsualizar) => cambiarFechasEmbarque(embarque.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Guardar las fechas"
      pista={r.pista}
      vistaExtra={(plan) => <ExtraFechas plan={plan} embarque={embarque} hoy={hoy} />}
    >
      <div className="space-y-3">
        <Bloque hito="zarpe" hoy={hoy} hitoApi={hitoDe("zarpe")} ahora={textoFechaHito(embarque.fecha_salida_estimada)}>
          <Field label="Nueva fecha de zarpe" hint="Vacía = sin fecha.">
            <Input type="date" value={form.zarpe} onChange={(e) => poner({ zarpe: e.target.value })} />
          </Field>
          {marca("zarpe")}
          {anterior(form.zarpe !== inicial.zarpe, { zarpe: inicial.zarpe })}
        </Bloque>

        {!esLocal && (
          <Bloque hito="arribo" hoy={hoy} hitoApi={hitoDe("arribo")} ahora={textoFechaHito(embarque.fecha_puerto_estimada ?? null)}>
            <Field label="Nueva fecha de arribo a puerto" hint="Vacía = sin fecha.">
              <Input type="date" value={form.arribo} onChange={(e) => poner({ arribo: e.target.value })} />
            </Field>
            {marca("arribo")}
            {anterior(form.arribo !== inicial.arribo, { arribo: inicial.arribo })}
          </Bloque>
        )}

        <Bloque hito="ingreso_cd" hoy={hoy} hitoApi={hitoDe("ingreso_cd")} ahora={textoFechaHito(embarque.fecha_llegada_estimada)}>
          <Field label="Nueva fecha de Ingreso CD" hint="Obligatoria. Si solo sabes el mes, pon el 15.">
            <Input type="date" value={form.ingresoCd} onChange={(e) => poner({ ingresoCd: e.target.value })} required aria-required />
          </Field>
          {marca("ingreso_cd")}
          {anterior(form.ingresoCd !== inicial.ingresoCd, { ingresoCd: inicial.ingresoCd })}
        </Bloque>

        <Bloque hito="inicio_operativo" hoy={hoy} hitoApi={hitoDe("inicio_operativo")} ahora={textoFechaHito(embarque.fecha_inicio_operativo_estimada ?? null, embarque.hora_inicio_operativo ?? null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nueva fecha de inicio operativo">
              <Input type="date" value={form.inicioFecha} onChange={(e) => poner(e.target.value === "" ? { inicioFecha: "", inicioHora: "" } : { inicioFecha: e.target.value })} />
            </Field>
            <Field label="Hora (opcional)" hint="Hora de Lima.">
              <Input type="time" value={form.inicioHora} onChange={(e) => poner({ inicioHora: e.target.value })} disabled={form.inicioFecha === ""} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {marca("inicio_operativo")}
            {form.confirmado === "inicio_operativo" && (
              <Button variante="secundario" tamano="sm" onClick={() => poner({ inicioFecha: form.inicioFecha === "" ? hoy : form.inicioFecha, inicioHora: horaAhora(ahora) })}>
                Ahora
              </Button>
            )}
          </div>
          {anterior(form.inicioFecha !== inicial.inicioFecha || form.inicioHora !== inicial.inicioHora, { inicioFecha: inicial.inicioFecha, inicioHora: inicial.inicioHora })}
        </Bloque>

        <Bloque
          hito="ingreso_stock"
          hoy={hoy}
          hitoApi={hitoDe("ingreso_stock")}
          ahora={`${textoFechaHito(ingresoEfectivoAhora)}${embarque.fecha_ingreso_estimada ? " (fijado)" : " (igual al Ingreso CD)"}`}
        >
          {form.ingresoFijo ? (
            <>
              <Field label="Nueva fecha de Ingreso al stock" hint="Manda el mes del flujo. Se confirma al recibir el embarque.">
                <Input type="date" value={form.ingresoStock} onChange={(e) => poner({ ingresoStock: e.target.value })} required aria-required />
              </Field>
              <Button variante="secundario" tamano="sm" onClick={() => poner({ ingresoFijo: false, ingresoStock: "" })}>
                Igualar al Ingreso CD
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                Sigue al Ingreso CD: <strong className="tabular-nums">{textoFechaHito(ingresoEfectivoNuevo || null)}</strong>
                {ingresoEfectivoNuevo !== ingresoEfectivoAhora && <span className="text-xs text-tinta-suave"> (antes {textoFechaHito(ingresoEfectivoAhora)})</span>}
              </p>
              <Button variante="secundario" tamano="sm" onClick={() => poner({ ingresoFijo: true, ingresoStock: form.ingresoStock || form.ingresoCd })}>
                Fijar fecha
              </Button>
            </>
          )}
          {anterior(form.ingresoFijo !== inicial.ingresoFijo || form.ingresoStock !== inicial.ingresoStock, { ingresoFijo: inicial.ingresoFijo, ingresoStock: inicial.ingresoStock })}
          <p className="text-xs text-tinta-suave">Mes del flujo hoy: {etiquetaMes(embarque.periodo_llegada)}.</p>
        </Bloque>

        <fieldset className="min-w-0 space-y-3 rounded-lg border border-borde p-3">
          <legend className="px-1 text-sm font-semibold">Motivo y causa {motivoObligatorio ? "(obligatorios: esto reprograma)" : "(solo si reprogramas)"}</legend>
          <Field label={`Causa${motivoObligatorio ? " *" : ""}`} hint={r.causaEfectiva === "programacion" && form.causa === null ? "Propuesta porque solo cambia el Ingreso al stock." : undefined}>
            <Select value={r.causaEfectiva ?? ""} onChange={(e) => poner({ causa: (e.target.value || null) as CausaFecha | null })} aria-required={motivoObligatorio}>
              <option value="">Elige la causa…</option>
              {LISTA_CAUSAS_FECHA.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETA_CAUSA_FECHA[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Motivo${motivoObligatorio ? " *" : ""}`} hint="Queda en el historial del embarque.">
            <Textarea value={form.motivo} onChange={(e) => poner({ motivo: e.target.value })} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} aria-required={motivoObligatorio} />
          </Field>
        </fieldset>
        {r.noFutura.length > 0 && (
          <ul className="space-y-1 text-xs text-alerta" aria-live="polite">
            {r.noFutura.map((t) => (
              <li key={t}>⚠ {t}</li>
            ))}
          </ul>
        )}
      </div>
    </DialogoMovimiento>
  );
}

/** Lo que la vista previa de fechas dice además del plan: qué hitos cambian, cuántos meses y qué paquetes se quedan quietos. */
function ExtraFechas({ plan, embarque, hoy }: { plan: PlanMovimientoApi; embarque: EmbarqueDetalleApi; hoy: string }) {
  const p = plan as Partial<PlanFechasApi>;
  const cambios = p.cambios ?? [];
  const meses = p.meses ?? [];
  const tocados = new Set(cambios.filter((c) => c.hito === "ingreso_paquete").map((c) => c.paquete?.id));
  const quietos = embarque.paquetes.filter((x) => x.estado === "abierto" && x.ingreso_propio === true && !tocados.has(x.id));
  return (
    <div className="space-y-2 text-sm">
      {cambios.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5" aria-label="Qué cambia">
          {cambios.map((c, i) => (
            <li key={`${c.hito}-${c.paquete?.id ?? ""}-${i}`}>{textoCambioFecha(c, hoy)}</li>
          ))}
        </ul>
      )}
      {meses.length > 0 && (
        <p className="font-medium">
          Cambia el mes del flujo: {textoMeses(meses).join("; ")}.
        </p>
      )}
      {meses.length > 0 &&
        quietos.map((q) => (
          <p key={q.id} className="text-xs text-tinta-suave">
            El paquete «{q.nombre}» tiene ingreso propio ({fechaCorta(q.fecha_ingreso ?? null, hoy)}) y no se mueve.
          </p>
        ))}
      {p.reprograma === false && cambios.length > 0 && <p className="text-xs text-tinta-suave">No es una reprogramación: no suma al contador de cambios.</p>}
    </div>
  );
}
