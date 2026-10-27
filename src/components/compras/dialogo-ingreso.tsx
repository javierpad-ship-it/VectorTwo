"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { recibirSchema } from "@/lib/compras/esquemas";
import type { CompraApi, EntregaLineaApi, LineaCompraApi, RecibirCuerpo } from "@/lib/compras/tipos-api";
import { confirmarIngreso, useAccion } from "@/lib/compras/use-compras";
import { mesLargo, unidades } from "./formato";
import { fechaPorDefectoIngreso, mesesParaIngreso, mesPorDefectoIngreso, resumenIngreso, unidadesConfirmables } from "./vista-compras";

/**
 * «Confirmar ingreso» de una línea o de una entrega (ficha 08 §0.5 y §4.4; solo admin y planner). Se elige el mes X en que llegó (por
 * defecto el que sugiere la conciliación; si no hay, el de la entrega; si es futura, el mes en curso), las unidades y la fecha. Si X ya
 * está publicado, esas unidades dejan de esperarse en el flujo (ya están en el inventario); si no, suman en X. Los valores se validan con
 * el mismo esquema que la API; el botón se desactiva mientras envía y un error de la API (p. ej. `compra_cambio`) se muestra aquí.
 */
export function DialogoIngreso({
  compra,
  linea,
  numeroLinea,
  entrega,
  kPrima,
  hoyFecha,
  onGuardado,
  onRecargar,
  onCerrar,
}: {
  compra: CompraApi;
  linea: LineaCompraApi;
  numeroLinea: number;
  /** La entrega desde la que se abrió, o `null` si se confirma a nivel de línea. */
  entrega: EntregaLineaApi | null;
  /** Último mes publicado, si ya se conoce. */
  kPrima: string | null;
  /** Hoy en Lima (`aaaa-mm-dd`). */
  hoyFecha: string;
  onGuardado: (compra: CompraApi) => void;
  onRecargar: () => Promise<unknown>;
  onCerrar: () => void;
}) {
  const hoyMes = hoyFecha.slice(0, 7);
  const maximo = unidadesConfirmables(linea);
  const sugeridas = entrega?.sugerencia?.unidades;
  const [mes, setMes] = useState(() => mesPorDefectoIngreso({ entrega, fechaCompra: compra.fecha_compra, hoyMes }));
  const [cantidad, setCantidad] = useState(() => String(Math.min(maximo, sugeridas ?? entrega?.pendiente ?? maximo)));
  const [fecha, setFecha] = useState(() => fechaPorDefectoIngreso(mesPorDefectoIngreso({ entrega, fechaCompra: compra.fecha_compra, hoyMes }), hoyFecha));
  const [fechaTocada, setFechaTocada] = useState(false);
  const [nota, setNota] = useState("");
  const [intento, setIntento] = useState(false);
  const accion = useAccion();

  const meses = mesesParaIngreso({ fechaCompra: compra.fecha_compra, hoyMes, hastaMin: entrega?.periodo });
  const n = cantidad.trim() === "" ? Number.NaN : Number(cantidad.replace(/\s/g, ""));
  const cuerpo: RecibirCuerpo = { revision: compra.revision, recepciones: [{ linea_id: linea.id, recibida_periodo: mes, unidades: n, fecha_recepcion: fecha, nota: nota.trim() === "" ? undefined : nota }] };
  const validacion = recibirSchema.safeParse(cuerpo);
  const error = !validacion.success ? (validacion.error.issues[0]?.message ?? "Revisa los datos.") : n > maximo ? `Solo faltan ${unidades(maximo)} u por confirmar en esta línea.` : null;
  const publicado = kPrima !== null && mes <= kPrima;

  async function guardar() {
    setIntento(true);
    if (error || !validacion.success) return;
    const r = await accion.ejecutar(() => confirmarIngreso(compra.id, cuerpo));
    if (r.ok) onGuardado(r.valor);
  }

  return (
    <Modal
      titulo={`Confirmar ingreso · ${compra.numero}, línea ${numeroLinea}`}
      descripcion={entrega ? `Entrega de ${mesLargo(entrega.periodo)}: ${unidades(entrega.unidades)} u, faltan ${unidades(entrega.pendiente)} u.` : `Faltan ${unidades(maximo)} u por confirmar.`}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={accion.ocupado}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={accion.ocupado}>
            {accion.ocupado ? "Confirmando…" : "Confirmar ingreso"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mes en que llegó" hint={entrega?.sugerencia ? "Sugerido por la conciliación" : undefined}>
            <Select
              value={mes}
              onChange={(e) => {
                setMes(e.target.value);
                if (!fechaTocada) setFecha(fechaPorDefectoIngreso(e.target.value, hoyFecha));
              }}
            >
              {meses.map((m) => (
                <option key={m} value={m}>
                  {mesLargo(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unidades" hint={`Hasta ${unidades(maximo)}`}>
            <Input inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-invalid={intento && error !== null} />
          </Field>
          <Field label="Fecha del ingreso">
            <Input
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                setFechaTocada(true);
              }}
            />
          </Field>
        </div>
        <Field label="Nota (opcional)">
          <Input value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />
        </Field>
        <Alert tono="info">
          {publicado
            ? `${mesLargo(mes)} ya está publicado: esas unidades dejan de esperarse en el flujo (ya están en el inventario) y la conciliación las contrasta.`
            : `${mesLargo(mes)} todavía no está publicado: esas unidades suman al flujo en ese mes.`}{" "}
          {Number.isFinite(n) && n > 0 && !error ? `Vas a confirmar ${resumenIngreso(compra.numero, numeroLinea, n, mes)}.` : ""}
        </Alert>
        {intento && error && <Alert>{error}</Alert>}
        {accion.error && (
          <Alert onCerrar={accion.limpiar}>
            {accion.error.mensaje}
            {accion.error.codigo === "compra_cambio" && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={async () => {
                    await onRecargar();
                    onCerrar();
                  }}
                >
                  Recargar la compra
                </button>
              </>
            )}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
