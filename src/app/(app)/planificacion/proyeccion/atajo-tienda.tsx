"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { TiendaFila } from "@/lib/tiendas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { cambiosDeEdicion, camposDeTienda, motivoNoGuardar, type Campos } from "../../maestros/tiendas/formulario-tienda";
import { AlertaError } from "./comunes";
import { useAccion } from "./use-proyeccion";

const ID_FORM = "form-atajo-tienda";

/**
 * Atajo a Tiendas (M4) desde la tarjeta de una tienda nueva (ficha 07, paso 2): fecha de apertura y de cierre, venta
 * esperada y tienda de referencia, con `PATCH /api/tiendas/[id]`. Cambiar cualquiera marca la proyección como
 * desactualizada (`tiendas_cambiadas`): hay que recalcular para que las cifras lo reflejen; las decisiones se conservan.
 */
export function AtajoTienda({
  tienda,
  tiendas,
  onCerrar,
  onGuardado,
}: {
  tienda: TiendaFila;
  /** Todas las tiendas (para elegir el referente). */
  tiendas: readonly TiendaFila[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}) {
  const [campos, setCampos] = useState<Campos>(() => camposDeTienda(tienda));
  const accion = useAccion();
  const motivo = motivoNoGuardar(campos);
  const referentes = tiendas.filter((t) => t.activo && t.tipo === "Tienda" && t.id !== tienda.id).sort((a, b) => a.codigo.localeCompare(b.codigo));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo || accion.ocupado) return;
    const cuerpo = cambiosDeEdicion(tienda, campos);
    if (!cuerpo) {
      onCerrar();
      return;
    }
    const r = await accion.ejecutar(() => api.patch<TiendaFila>(`/api/tiendas/${tienda.id}`, cuerpo));
    if (!r.ok) return;
    await onGuardado();
    onCerrar();
  }

  return (
    <Modal
      titulo={`${tienda.codigo} · ${tienda.nombre}`}
      descripcion="Estos datos son de Tiendas (M4). Al guardar, la proyección queda desactualizada: recalcúlala para que las cifras los usen. Tus decisiones se conservan."
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-2xl"
      pie={
        <>
          <Button variante="fantasma" disabled={accion.ocupado} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" form={ID_FORM} disabled={accion.ocupado || motivo !== null} title={motivo ?? undefined}>
            {accion.ocupado ? "Guardando…" : "Guardar en Tiendas"}
          </Button>
        </>
      }
    >
      <form id={ID_FORM} onSubmit={(e) => void guardar(e)} className="grid gap-4 sm:grid-cols-2">
        {accion.error && (
          <div className="sm:col-span-2">
            <AlertaError error={accion.error} onCerrar={accion.limpiar} />
          </div>
        )}
        <Field label="Fecha de apertura" hint="Primer día con venta.">
          <Input type="date" value={campos.fecha_apertura} onChange={(e) => setCampos({ ...campos, fecha_apertura: e.target.value, fecha_cierre: e.target.value ? campos.fecha_cierre : "" })} />
        </Field>
        <Field label="Fecha de cierre" hint="Último día con venta (inclusive). Vacía si la tienda sigue abierta.">
          <Input type="date" value={campos.fecha_cierre} min={campos.fecha_apertura || undefined} disabled={!campos.fecha_apertura} onChange={(e) => setCampos({ ...campos, fecha_cierre: e.target.value })} />
        </Field>
        <Field label="Venta esperada del año de apertura (S/, sin IGV)" hint="Soles que la tienda venderá desde que abre hasta el 31 de diciembre de ese año, sin IGV. No es venta mensual ni de tienda madura.">
          <Input type="number" step="0.01" min="0" value={campos.venta} onChange={(e) => setCampos({ ...campos, venta: e.target.value })} placeholder="850000" />
        </Field>
        <Field label="Tienda de referencia" hint="Aquella a cuya composición de venta debe parecerse. Sin referente, el promedio de las mismas tiendas.">
          <Select value={campos.referencia} onChange={(e) => setCampos({ ...campos, referencia: e.target.value })}>
            <option value="">Sin referente (promedio de la red)</option>
            {referentes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.codigo} · {t.nombre}
              </option>
            ))}
          </Select>
        </Field>
        {motivo && <p className="text-xs text-alerta sm:col-span-2">{motivo}</p>}
        <div className="sm:col-span-2">
          <Alert tono="info">
            Para cambiar zona, razón social o el resto de los datos de la tienda usa{" "}
            <Link href="/maestros/tiendas" className="font-medium underline underline-offset-2">
              Tiendas y aperturas
            </Link>
            .
          </Alert>
        </div>
      </form>
    </Modal>
  );
}
