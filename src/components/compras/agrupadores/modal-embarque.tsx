"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { editarEmbarqueSchema, guardarEmbarqueSchema } from "@/lib/compras/agrupadores/esquemas";
import { MAX_NOMBRE_AGRUPADOR, MAX_NOTA_EMBARQUE, MAX_PUERTO_EMBARQUE, MAX_REFERENCIA_LOGISTICA, TIPOS_EMBARQUE } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_TIPO_EMBARQUE,
  type AsignableApi,
  type EmbarqueApi,
  type EmbarqueDetalleApi,
  type GuardarEmbarqueCuerpo,
  type OpcionViajeApi,
  type TipoEmbarque,
} from "@/lib/compras/agrupadores/tipos-api";
import { crearEmbarque, editarEmbarque, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { etiquetaAsignable, etiquetaViaje, salidaDespuesDeLlegada, sugerirCodigo, textoFecha, viajesParaSelector } from "./vista-agrupadores";

/**
 * Crear o editar un embarque (ficha 08b §4.1 y §4.2). Al crear, el código se propone `aamm##` (el mes de la llegada) y se puede editar; si
 * no se toca, se manda vacío y el servidor lo numera. Al editar, el código y la fecha de llegada no se cambian aquí: la llegada se mueve con
 * «Cambiar fecha de llegada» (mueve las entregas, con motivo y vista previa). Un embarque local no lleva viaje. El puerto real es del
 * embarque; sugiere los habituales de sus proveedores y los ya usados. Todos los roles lo usan; la API manda.
 */
export function ModalEmbarque({
  embarque,
  viajes,
  asignables,
  puertos,
  codigosExistentes,
  viajeInicial = null,
  onCerrar,
  onGuardado,
  onRecargar,
}: {
  /** Nulo = crear. */
  embarque: EmbarqueApi | null;
  viajes: readonly OpcionViajeApi[];
  asignables: readonly AsignableApi[];
  puertos: readonly string[];
  /** Códigos de embarques ya usados, para proponer el siguiente. */
  codigosExistentes: readonly string[];
  /** Viaje con que se abre el formulario al crear (el viaje activo o el viaje desde el que se crea). */
  viajeInicial?: string | null;
  onCerrar: () => void;
  onGuardado: (e: EmbarqueApi | EmbarqueDetalleApi, creado: boolean) => void | Promise<void>;
  onRecargar?: () => void | Promise<void>;
}) {
  const edita = embarque !== null;
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    codigo: null as string | null,
    nombre: embarque?.nombre ?? "",
    tipo: (embarque?.tipo ?? "importacion") as TipoEmbarque,
    viaje: embarque ? (embarque.viaje?.id ?? "") : (viajeInicial ?? ""),
    responsable: embarque?.responsable_efectivo?.origen === "propio" ? embarque.responsable_efectivo.perfil_id : "",
    referencia: embarque?.referencia_logistica ?? "",
    puerto: embarque?.puerto_embarque ?? "",
    salida: embarque?.fecha_salida_estimada ?? "",
    llegada: embarque?.fecha_llegada_estimada ?? "",
    nota: embarque?.nota ?? "",
  }));
  const poner = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setAviso(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const llegadaVigente = edita ? embarque.fecha_llegada_estimada : form.llegada;
  const sugerido = edita ? null : sugerirCodigo(form.llegada, codigosExistentes);
  const codigoVisible = form.codigo ?? sugerido ?? "";
  const esLocal = form.tipo === "local";

  const opcionesViaje = viajesParaSelector(viajes);
  const viajeActualFuera = embarque?.viaje && !opcionesViaje.some((v) => v.id === embarque.viaje?.id) ? embarque.viaje : null;
  const habituales = embarque?.puertos_habituales ?? [];
  const sugerenciasPuerto = [...new Set([...habituales, ...puertos])];

  async function guardar() {
    setAviso(null);
    if (salidaDespuesDeLlegada(form.salida, llegadaVigente)) {
      setAviso("La salida no puede ser posterior a la llegada.");
      return;
    }
    const cuerpo: GuardarEmbarqueCuerpo = {
      nombre: form.nombre,
      tipo: form.tipo,
      viaje_id: esLocal ? null : form.viaje || null,
      responsable_id: form.responsable || null,
      referencia_logistica: form.referencia || null,
      puerto_embarque: form.puerto || null,
      fecha_salida_estimada: form.salida || null,
      nota: form.nota || null,
    };
    if (edita) cuerpo.revision = embarque.revision;
    else {
      cuerpo.fecha_llegada_estimada = form.llegada;
      // Sin tocar el código propuesto, el servidor numera: así no choca con uno que otra persona creó mientras tanto.
      if (form.codigo !== null && form.codigo.trim() !== "") cuerpo.codigo = form.codigo;
    }
    const valida = (edita ? editarEmbarqueSchema : guardarEmbarqueSchema).safeParse(cuerpo);
    if (!valida.success) {
      setAviso(valida.error.issues[0]?.message ?? "Revisa los datos del embarque.");
      return;
    }
    const r = await accion.ejecutar(() => (edita ? editarEmbarque(embarque.id, cuerpo) : crearEmbarque(cuerpo)));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar?.();
      return;
    }
    await onGuardado(r.valor.embarque, !edita);
  }

  return (
    <ModalFormulario
      titulo={edita ? `Editar embarque ${embarque.codigo}` : "Nuevo embarque"}
      descripcion={edita ? "La fecha de llegada se cambia con «Cambiar fecha de llegada», porque mueve las entregas." : "Qué llega junto, cuándo sale y cuándo llega al centro de distribución."}
      onCerrar={onCerrar}
      onEnviar={() => void guardar()}
      ocupado={accion.ocupado}
      textoGuardar={edita ? "Guardar cambios" : "Crear embarque"}
      error={aviso ?? (accion.error ? textoErrorAccion(accion.error) : null)}
      onCerrarError={() => {
        setAviso(null);
        accion.limpiar();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!edita && (
          <Field label="Código" hint={sugerido ? "Propuesto con el mes de la llegada. Cámbialo si quieres; vacío = el sistema lo numera." : "Escribe el código a mano (letras, números y guiones)."}>
            <Input value={codigoVisible} onChange={(e) => poner("codigo", e.target.value)} maxLength={30} className="font-mono uppercase" autoComplete="off" />
          </Field>
        )}
        <Field label="Nombre" className={edita ? "sm:col-span-2" : undefined}>
          <Input value={form.nombre} onChange={(e) => poner("nombre", e.target.value)} maxLength={MAX_NOMBRE_AGRUPADOR} placeholder="Ej. Nov-26 · Feria Sur" required aria-required />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.tipo}
            onChange={(e) => {
              const tipo = e.target.value as TipoEmbarque;
              setAviso(null);
              setForm((f) => ({ ...f, tipo, viaje: tipo === "local" ? "" : f.viaje }));
            }}
          >
            {TIPOS_EMBARQUE.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_EMBARQUE[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Viaje" hint={esLocal ? "Un embarque local no lleva viaje." : "Los viajes cerrados aparecen al final."}>
          <Select value={esLocal ? "" : form.viaje} onChange={(e) => poner("viaje", e.target.value)} disabled={esLocal}>
            <option value="">Sin viaje</option>
            {viajeActualFuera && <option value={viajeActualFuera.id}>{etiquetaViaje(viajeActualFuera)} (cancelado)</option>}
            {opcionesViaje.map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaViaje(v)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable" hint="Vacío = hereda el del viaje. Pueden serlo compradores y administradores activos.">
          <Select value={form.responsable} onChange={(e) => poner("responsable", e.target.value)}>
            <option value="">Hereda del viaje</option>
            {asignables.map((a) => (
              <option key={a.perfil_id} value={a.perfil_id}>
                {etiquetaAsignable(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Puerto de embarque" hint={habituales.length > 0 ? `Habitual de sus proveedores: ${habituales.join(", ")}.` : "El puerto real de este envío."}>
          <Input value={form.puerto} onChange={(e) => poner("puerto", e.target.value)} maxLength={MAX_PUERTO_EMBARQUE} list="puertos-embarque" autoComplete="off" />
          <datalist id="puertos-embarque">
            {sugerenciasPuerto.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Field label="Referencia logística" hint="BL, contenedor o guía.">
          <Input value={form.referencia} onChange={(e) => poner("referencia", e.target.value)} maxLength={MAX_REFERENCIA_LOGISTICA} autoComplete="off" />
        </Field>
        <Field label="Fecha de salida estimada" hint="Editarla no mueve entregas.">
          <Input type="date" value={form.salida} max={llegadaVigente || undefined} onChange={(e) => poner("salida", e.target.value)} />
        </Field>
        {edita ? (
          <div>
            <span className="mb-1 block text-sm font-medium text-tinta">Fecha de llegada estimada</span>
            <p className="flex h-10 items-center text-sm">{textoFecha(embarque.fecha_llegada_estimada)}</p>
            <span className="mt-1 block text-xs text-tinta-suave">Se cambia con «Cambiar fecha de llegada».</span>
          </div>
        ) : (
          <Field label="Fecha de llegada estimada" hint="Llegada al centro de distribución; alinea las entregas.">
            <Input type="date" value={form.llegada} min={form.salida || undefined} onChange={(e) => poner("llegada", e.target.value)} required aria-required />
          </Field>
        )}
        <Field label="Nota" className="sm:col-span-2">
          <Textarea value={form.nota} onChange={(e) => poner("nota", e.target.value)} maxLength={MAX_NOTA_EMBARQUE} rows={2} />
        </Field>
      </div>
      {embarque && embarque.estado !== "planificado" && embarque.estado !== "en_transito" && <Alert tono="info">Este embarque está {embarque.estado === "cancelado" ? "cancelado" : "recibido"}: el servidor no admite cambios.</Alert>}
    </ModalFormulario>
  );
}
