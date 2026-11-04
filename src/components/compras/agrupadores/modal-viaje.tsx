"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { editarViajeSchema, guardarViajeSchema } from "@/lib/compras/agrupadores/esquemas";
import { MAX_DESTINO_VIAJE, MAX_NOMBRE_AGRUPADOR, MAX_NOTA_VIAJE } from "@/lib/compras/agrupadores/tipos";
import type { AsignableApi, GuardarViajeCuerpo, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { crearViaje, editarViaje, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { etiquetaAsignable, sugerirCodigo } from "./vista-agrupadores";

/**
 * Crear o editar un viaje de compras (ficha 08b §4.3). Al crear, el código se propone `aamm##` con el mes de inicio y se puede editar; el
 * responsable es obligatorio (comprador o administrador activos; el planner no). Los tres roles lo usan, también con el viaje cerrado; un
 * viaje cancelado no se edita. Cerrar, reabrir y cancelar van aparte (solo admin y planner).
 */
export function ModalViaje({
  viaje,
  asignables,
  perfilId,
  codigosExistentes,
  onCerrar,
  onGuardado,
  onRecargar,
}: {
  /** Nulo = crear. */
  viaje: ViajeApi | null;
  asignables: readonly AsignableApi[];
  /** Quien abre el formulario: si es asignable, es el responsable propuesto al crear. */
  perfilId: string;
  codigosExistentes: readonly string[];
  onCerrar: () => void;
  onGuardado: (v: ViajeApi, creado: boolean) => void | Promise<void>;
  onRecargar?: () => void | Promise<void>;
}) {
  const edita = viaje !== null;
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    codigo: null as string | null,
    nombre: viaje?.nombre ?? "",
    destino: viaje?.destino ?? "",
    inicio: viaje?.fecha_inicio ?? "",
    fin: viaje?.fecha_fin ?? "",
    responsable: viaje?.responsable?.perfil_id ?? (asignables.some((a) => a.perfil_id === perfilId) ? perfilId : ""),
    nota: viaje?.nota ?? "",
  }));
  const poner = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setAviso(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const sugerido = edita ? null : sugerirCodigo(form.inicio, codigosExistentes);
  const codigoVisible = form.codigo ?? sugerido ?? "";
  // El responsable actual puede haber dejado de ser asignable: se conserva visible para no vaciarlo sin querer.
  const actualFuera = viaje?.responsable && !asignables.some((a) => a.perfil_id === viaje.responsable?.perfil_id) ? viaje.responsable : null;

  async function guardar() {
    setAviso(null);
    const cuerpo: GuardarViajeCuerpo = {
      nombre: form.nombre,
      destino: form.destino || null,
      fecha_inicio: form.inicio,
      fecha_fin: form.fin || null,
      responsable_id: form.responsable,
      nota: form.nota || null,
    };
    if (edita) cuerpo.revision = viaje.revision;
    else if (form.codigo !== null && form.codigo.trim() !== "") cuerpo.codigo = form.codigo;
    const valida = (edita ? editarViajeSchema : guardarViajeSchema).safeParse(cuerpo);
    if (!valida.success) {
      setAviso(form.responsable === "" ? "Elige un responsable." : (valida.error.issues[0]?.message ?? "Revisa los datos del viaje."));
      return;
    }
    const r = await accion.ejecutar(() => (edita ? editarViaje(viaje.id, cuerpo) : crearViaje(cuerpo)));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onGuardado(r.valor.viaje, !edita);
  }

  return (
    <ModalFormulario
      titulo={edita ? `Editar viaje ${viaje.codigo}` : "Nuevo viaje"}
      descripcion="Dónde y cuándo se compró. El viaje es contexto y filtro: no es un presupuesto."
      onCerrar={onCerrar}
      onEnviar={() => void guardar()}
      ocupado={accion.ocupado}
      textoGuardar={edita ? "Guardar cambios" : "Crear viaje"}
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!edita && (
          <Field label="Código" hint={sugerido ? "Propuesto con el mes de inicio. Cámbialo si quieres; vacío = el sistema lo numera." : "Escribe el código a mano (letras, números y guiones)."}>
            <Input value={codigoVisible} onChange={(e) => poner("codigo", e.target.value)} maxLength={30} className="font-mono uppercase" autoComplete="off" />
          </Field>
        )}
        <Field label="Nombre" className={edita ? "sm:col-span-2" : undefined}>
          <Input value={form.nombre} onChange={(e) => poner("nombre", e.target.value)} maxLength={MAX_NOMBRE_AGRUPADOR} placeholder="Ej. Feria Sur · oct-2026" required aria-required />
        </Field>
        <Field label="Destino" hint="País, ciudad o feria.">
          <Input value={form.destino} onChange={(e) => poner("destino", e.target.value)} maxLength={MAX_DESTINO_VIAJE} />
        </Field>
        <Field label="Responsable" hint="Obligatorio. Compradores y administradores activos.">
          <Select value={form.responsable} onChange={(e) => poner("responsable", e.target.value)} required aria-required>
            <option value="">Elige un responsable</option>
            {actualFuera && <option value={actualFuera.perfil_id}>{actualFuera.nombre ?? "Sin nombre"} (ya no disponible)</option>}
            {asignables.map((a) => (
              <option key={a.perfil_id} value={a.perfil_id}>
                {etiquetaAsignable(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Inicio">
          <Input type="date" value={form.inicio} max={form.fin || undefined} onChange={(e) => poner("inicio", e.target.value)} required aria-required />
        </Field>
        <Field label="Fin" hint="Opcional.">
          <Input type="date" value={form.fin} min={form.inicio || undefined} onChange={(e) => poner("fin", e.target.value)} />
        </Field>
        <Field label="Nota" className="sm:col-span-2">
          <Textarea value={form.nota} onChange={(e) => poner("nota", e.target.value)} maxLength={MAX_NOTA_VIAJE} rows={2} />
        </Field>
      </div>
    </ModalFormulario>
  );
}
