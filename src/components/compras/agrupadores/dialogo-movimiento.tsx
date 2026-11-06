"use client";

import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { ETIQUETA_AVISO_AGRUPADOR, type MovimientoApi, type PlanMovimientoApi, type RespuestaMovimientoApi, type UbicacionMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { esPlan, useAccion, type ResultadoMovimiento } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { resumenPlan, textoAvisoDetalle } from "./vista-agrupadores";

const MAX_FILAS_VISTA = 50;

const textoUbicacion = (u: UbicacionMovimientoApi): string => `${mesCorto(u.periodo)} · ${u.embarque ? `Embarque ${u.embarque.codigo}` : "sin embarque"}${u.paquete ? ` · P ${u.paquete.codigo}` : ""}`;

/**
 * Vista previa de un movimiento (ficha 08b §3, §4.2): la frase que dice qué mueve, los avisos (temporada, fusión de entregas, mes cerrado…
 * ninguno bloquea) y, debajo, de dónde a dónde va cada línea. El plan lo calcula el servidor con `?previsualizar=1`, sin escribir.
 */
export function VistaPreviaPlan({ plan, extra }: { plan: PlanMovimientoApi; extra?: ReactNode }) {
  const columnas: Columna<MovimientoApi>[] = [
    { clave: "compra", titulo: "Compra", render: (m) => <span className="whitespace-nowrap font-medium">{m.compra_numero}</span> },
    { clave: "linea", titulo: "Línea", render: (m) => <span className="text-xs">{m.linea}</span> },
    { clave: "de", titulo: "De", render: (m) => <span className="whitespace-nowrap text-xs">{textoUbicacion(m.de)}</span> },
    { clave: "a", titulo: "A", render: (m) => <span className="whitespace-nowrap text-xs">{textoUbicacion(m.a)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (m) => <span className="font-mono tabular-nums">{unidades(m.unidades)}</span> },
  ];
  const mostradas = plan.movimientos.slice(0, MAX_FILAS_VISTA);
  return (
    <section aria-label="Vista previa" className="space-y-3 rounded-lg border border-marca/30 bg-marca-suave/40 p-3">
      <p className="text-sm font-medium text-tinta">{resumenPlan(plan)}</p>
      {extra}
      {plan.avisos.length > 0 && (
        <ul className="space-y-1 text-xs text-alerta">
          {plan.avisos.map((a, i) => (
            <li key={`${a.aviso}-${i}`}>⚠ {textoAvisoDetalle(a, ETIQUETA_AVISO_AGRUPADOR)}</li>
          ))}
        </ul>
      )}
      {plan.movimientos.length > 0 && (
        <div className="space-y-1">
          <DataTable columnas={columnas} filas={mostradas} claveFila={(m) => `${m.compra_numero}|${m.linea}|${textoUbicacion(m.de)}|${textoUbicacion(m.a)}`} />
          {plan.movimientos.length > MAX_FILAS_VISTA && <p className="text-xs text-tinta-suave">Se muestran {MAX_FILAS_VISTA} de {plural(plan.movimientos.length, "movimiento", "movimientos")}.</p>}
        </div>
      )}
    </section>
  );
}

/**
 * Cascarón de todo movimiento con vista previa (cambiar la fecha de llegada, asignar, quitar, pasar pendientes, mover un paquete):
 *
 *  1. La persona completa el formulario (`children`); cuando `cuerpo` es válido puede pulsar «Ver vista previa».
 *  2. La vista previa llama a la API con `?previsualizar=1` y guarda el plan con la forma del cuerpo que lo originó.
 *  3. «Aplicar» solo se habilita con un plan vigente (si la persona cambió algo, hay que volver a previsualizar) y manda el cuerpo con la
 *     `huella_plan` de lo que vio: el servidor reintenta una vez si la huella no cambió y, si no, responde `409 plan_cambio` (R19).
 *
 * Los errores de la API se muestran con `Alert`; `plan_cambio`, `compra_cambio` y `agrupador_cambio` descartan el plan y releen.
 */
export function DialogoMovimiento<C extends { huella_plan?: string }>({
  titulo,
  descripcion,
  cuerpo,
  llamar,
  onAplicado,
  onCerrar,
  onRecargar,
  textoAplicar = "Aplicar",
  confirmar,
  pista,
  ancho = "max-w-3xl",
  vistaExtra,
  children,
}: {
  titulo: string;
  descripcion?: string;
  /** El cuerpo listo para enviar, sin la huella; `null` si el formulario aún no es válido. */
  cuerpo: C | null;
  llamar: (cuerpo: C, previsualizar: boolean) => Promise<ResultadoMovimiento>;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  /** Relee la pantalla cuando lo que la persona veía ya no vale. */
  onRecargar?: () => void | Promise<void>;
  textoAplicar?: string;
  /** Texto de un `confirm` antes de escribir (acciones que conviene reconfirmar). */
  confirmar?: (plan: PlanMovimientoApi) => string;
  /** Qué falta para poder previsualizar, mientras `cuerpo` es nulo. */
  pista?: string;
  ancho?: string;
  /** Lo que la vista previa dice además del plan (p. ej. los cambios de fechas y los meses que se mueven, 08b-1b §4.3). */
  vistaExtra?: (plan: PlanMovimientoApi) => ReactNode;
  children: ReactNode;
}) {
  const accion = useAccion();
  const [guardado, setGuardado] = useState<{ firma: string; plan: PlanMovimientoApi } | null>(null);
  const firma = cuerpo === null ? null : JSON.stringify(cuerpo);
  const planVigente = guardado !== null && guardado.firma === firma ? guardado.plan : null;

  async function previsualizar() {
    if (cuerpo === null || firma === null) return;
    const r = await accion.ejecutar(() => llamar(cuerpo, true));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    if (esPlan(r.valor)) setGuardado({ firma, plan: r.valor });
  }

  async function aplicar() {
    if (cuerpo === null || planVigente === null) return;
    if (confirmar && !confirm(confirmar(planVigente))) return;
    const r = await accion.ejecutar(() => llamar({ ...cuerpo, huella_plan: planVigente.huella_plan }, false));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) {
        setGuardado(null);
        await onRecargar?.();
      }
      return;
    }
    if (!esPlan(r.valor)) await onAplicado(r.valor);
  }

  return (
    <Modal
      titulo={titulo}
      descripcion={descripcion}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho={ancho}
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={accion.ocupado}>
            Cancelar
          </Button>
          <Button variante="secundario" onClick={() => void previsualizar()} disabled={accion.ocupado || cuerpo === null}>
            {accion.ocupado && planVigente === null ? "Calculando…" : "Ver vista previa"}
          </Button>
          <Button onClick={() => void aplicar()} disabled={accion.ocupado || planVigente === null} title={planVigente === null ? "Primero mira la vista previa." : undefined}>
            {accion.ocupado && planVigente !== null ? "Aplicando…" : textoAplicar}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}
        {children}
        {cuerpo === null && pista && <p className="text-xs text-tinta-suave">{pista}</p>}
        {guardado !== null && planVigente === null && cuerpo !== null && <Alert tono="info">Cambiaste algo: vuelve a mirar la vista previa antes de aplicar.</Alert>}
        {planVigente && <VistaPreviaPlan plan={planVigente} extra={vistaExtra?.(planVigente)} />}
      </div>
    </Modal>
  );
}
