"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { MAX_CONTACTOS_POR_PROVEEDOR } from "@/lib/proveedores/constantes";
import { contactoVacio, marcarPrincipal, type BorradorContacto } from "./vista-proveedores";

/**
 * Los contactos de un proveedor (08c, §4.2): una tarjeta por contacto con nombre*, cargo, teléfono, correo y la radio «Principal», y
 * «+ Agregar contacto» hasta 20. Se guardan junto con la ficha, en una sola transacción. `errores` trae los mensajes por
 * `contactos.<fila>.<campo>`.
 */
export function Contactos({
  contactos,
  errores,
  deshabilitado = false,
  onCambiar,
}: {
  contactos: readonly BorradorContacto[];
  errores: Record<string, string>;
  deshabilitado?: boolean;
  onCambiar: (contactos: BorradorContacto[]) => void;
}) {
  const cambiar = (clave: string, cambio: Partial<BorradorContacto>) => onCambiar(contactos.map((c) => (c.clave === clave ? { ...c, ...cambio } : c)));
  return (
    <div className="space-y-3">
      {errores.contactos && <p className="text-xs font-medium text-alerta">{errores.contactos}</p>}
      {contactos.length === 0 && <p className="text-sm text-tinta-suave">Sin contactos todavía. Un proveedor con al menos un contacto cuenta como ficha completa.</p>}
      {contactos.map((c, i) => (
        <fieldset key={c.clave} className="space-y-3 rounded-lg border border-borde p-3" disabled={deshabilitado}>
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Contacto {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *" error={errores[`contactos.${i}.nombre`]}>
              <Input value={c.nombre} maxLength={120} aria-invalid={Boolean(errores[`contactos.${i}.nombre`])} onChange={(e) => cambiar(c.clave, { nombre: e.target.value })} />
            </Field>
            <Field label="Cargo" error={errores[`contactos.${i}.cargo`]}>
              <Input value={c.cargo} maxLength={80} onChange={(e) => cambiar(c.clave, { cargo: e.target.value })} />
            </Field>
            <Field label="Teléfono" error={errores[`contactos.${i}.telefono`]}>
              <Input type="tel" value={c.telefono} maxLength={40} onChange={(e) => cambiar(c.clave, { telefono: e.target.value })} />
            </Field>
            <Field label="Correo" error={errores[`contactos.${i}.correo`]}>
              <Input type="email" value={c.correo} maxLength={120} aria-invalid={Boolean(errores[`contactos.${i}.correo`])} onChange={(e) => cambiar(c.clave, { correo: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-9 items-center gap-2 text-sm text-tinta">
              <input type="radio" name="contacto-principal" checked={c.es_principal} onChange={() => onCambiar(marcarPrincipal(contactos, c.clave))} className="h-4 w-4 accent-marca" />
              Principal
            </label>
            <Button variante="peligro" tamano="sm" onClick={() => onCambiar(contactos.filter((x) => x.clave !== c.clave))} aria-label={`Quitar contacto ${i + 1}`}>
              Quitar
            </Button>
          </div>
        </fieldset>
      ))}
      <Button variante="secundario" onClick={() => onCambiar([...contactos, contactoVacio()])} disabled={deshabilitado || contactos.length >= MAX_CONTACTOS_POR_PROVEEDOR}>
        + Agregar contacto
      </Button>
      {contactos.length >= MAX_CONTACTOS_POR_PROVEEDOR && <p className="text-xs text-tinta-suave">Máximo {MAX_CONTACTOS_POR_PROVEEDOR} contactos por proveedor.</p>}
    </div>
  );
}
