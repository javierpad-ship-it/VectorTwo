"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { guardarPaqueteSchema } from "@/lib/compras/agrupadores/esquemas";
import { MAX_NOMBRE_AGRUPADOR, MAX_NOTA_PAQUETE } from "@/lib/compras/agrupadores/tipos";
import type { AsignableApi, EmbarqueDetalleApi, GuardarPaqueteCuerpo, PaqueteApi } from "@/lib/compras/agrupadores/tipos-api";
import { crearPaquete, editarPaquete, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { etiquetaAsignable, sugerirCodigo } from "./vista-agrupadores";

/**
 * Crear o editar un paquete de un embarque (ficha 08b §4.2). El paquete es una subdivisión de UN embarque: su código `aamm##` usa el mes de
 * llegada del embarque y se propone al crear. El responsable vacío hereda el del embarque. La versión que se manda es la del EMBARQUE
 * (cubre a sus paquetes). Los tres roles lo usan; la API manda.
 */
export function ModalPaquete({
  embarque,
  paquete,
  asignables,
  codigosExistentes,
  onCerrar,
  onGuardado,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  /** Nulo = crear. */
  paquete: PaqueteApi | null;
  asignables: readonly AsignableApi[];
  /** Códigos de paquetes ya usados, para proponer el siguiente. */
  codigosExistentes: readonly string[];
  onCerrar: () => void;
  onGuardado: (e: EmbarqueDetalleApi, creado: boolean) => void | Promise<void>;
  onRecargar?: () => void | Promise<void>;
}) {
  const edita = paquete !== null;
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    codigo: null as string | null,
    nombre: paquete?.nombre ?? "",
    responsable: paquete?.responsable_efectivo?.origen === "propio" ? paquete.responsable_efectivo.perfil_id : "",
    nota: paquete?.nota ?? "",
  }));
  const poner = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setAviso(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const sugerido = edita ? null : sugerirCodigo(`${embarque.periodo_llegada}-01`, codigosExistentes);

  async function guardar() {
    setAviso(null);
    const cuerpo: GuardarPaqueteCuerpo = {
      revision_embarque: embarque.revision,
      nombre: form.nombre,
      responsable_id: form.responsable || null,
      nota: form.nota || null,
    };
    if (!edita && form.codigo !== null && form.codigo.trim() !== "") cuerpo.codigo = form.codigo;
    const valida = guardarPaqueteSchema.safeParse(cuerpo);
    if (!valida.success) {
      setAviso(valida.error.issues[0]?.message ?? "Revisa los datos del paquete.");
      return;
    }
    const r = await accion.ejecutar(() => (edita ? editarPaquete(paquete.id, cuerpo) : crearPaquete(embarque.id, cuerpo)));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onGuardado(r.valor.embarque, !edita);
  }

  return (
    <ModalFormulario
      titulo={edita ? `Editar paquete ${paquete.codigo}` : `Nuevo paquete del embarque ${embarque.codigo}`}
      descripcion="Una subdivisión del embarque: llega con él."
      onCerrar={onCerrar}
      onEnviar={() => void guardar()}
      ocupado={accion.ocupado}
      textoGuardar={edita ? "Guardar cambios" : "Crear paquete"}
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!edita && (
          <Field label="Código" hint={sugerido ? "Propuesto con el mes de llegada del embarque; vacío = el sistema lo numera." : "Escribe el código a mano (letras, números y guiones)."}>
            <Input value={form.codigo ?? sugerido ?? ""} onChange={(e) => poner("codigo", e.target.value)} maxLength={30} className="font-mono uppercase" autoComplete="off" />
          </Field>
        )}
        <Field label="Nombre" className={edita ? "sm:col-span-2" : undefined}>
          <Input value={form.nombre} onChange={(e) => poner("nombre", e.target.value)} maxLength={MAX_NOMBRE_AGRUPADOR} placeholder="Ej. Paquete denim" required aria-required />
        </Field>
        <Field label="Responsable" hint="Vacío = hereda el del embarque." className="sm:col-span-2">
          <Select value={form.responsable} onChange={(e) => poner("responsable", e.target.value)}>
            <option value="">Hereda del embarque</option>
            {asignables.map((a) => (
              <option key={a.perfil_id} value={a.perfil_id}>
                {etiquetaAsignable(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nota" className="sm:col-span-2">
          <Textarea value={form.nota} onChange={(e) => poner("nota", e.target.value)} maxLength={MAX_NOTA_PAQUETE} rows={2} />
        </Field>
      </div>
    </ModalFormulario>
  );
}
