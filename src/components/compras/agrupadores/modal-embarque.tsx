"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { editarEmbarqueSchema, guardarEmbarqueSchema } from "@/lib/compras/agrupadores/esquemas";
import { esMomentoFuturo, ordenDeFechasRoto } from "@/lib/compras/agrupadores/fechas";
import { MAX_NOMBRE_AGRUPADOR, MAX_NOTA_EMBARQUE, MAX_ORIGEN_EMBARQUE, MAX_PUERTO_EMBARQUE, MAX_REFERENCIA_LOGISTICA, TIPOS_EMBARQUE } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_TIPO_EMBARQUE,
  type AsignableApi,
  type EmbarqueApi,
  type EmbarqueDetalleApi,
  type GuardarEmbarqueCuerpo,
  type HitoConfirmable,
  type OpcionViajeApi,
  type TipoEmbarque,
} from "@/lib/compras/agrupadores/tipos-api";
import { cambiarFechasEmbarque, crearEmbarque, editarEmbarque, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { FilaHito } from "./linea-tiempo";
import { ModalFormulario } from "./modal-formulario";
import { pideRelectura, textoErrorAccion } from "./vista-errores";
import { etiquetaAsignable, etiquetaViaje, salidaDespuesDeLlegada, sugerirCodigo, viajesParaSelector } from "./vista-agrupadores";
import { ahoraEnLima, hitosDelEmbarque, horaAhora } from "./vista-fechas";

/** Orígenes que se sugieren siempre (los de Javier), además de los ya usados. */
const ORIGENES_HABITUALES = ["California", "Nueva York"];

/** Hasta dónde «ya ocurrió» al crear: lo que se manda después a `/fechas` como `hito_confirmado`. */
const OPCIONES_OCURRIDO: { valor: "" | HitoConfirmable; texto: string }[] = [
  { valor: "", texto: "Nada todavía" },
  { valor: "zarpe", texto: "Ya zarpó (salió)" },
  { valor: "arribo", texto: "Ya llegó a puerto" },
  { valor: "ingreso_cd", texto: "Ya llegó al CD" },
  { valor: "inicio_operativo", texto: "Ya empezó la operación en el CD" },
];

/**
 * Crear o editar un embarque (ficha 08b §4.1 y §4.2; 08b-1b §4.3). Al crear, el código se propone `aamm##` (el mes del Ingreso CD) y se
 * puede editar; si no se toca, se manda vacío y el servidor lo numera. Al crear se escriben las fechas por hito (Zarpe, Arribo, Ingreso CD
 * obligatorio, Inicio operativo con hora opcional e Ingreso al stock, vacío = el mismo día del Ingreso CD), el origen y hasta dónde «ya
 * ocurrió». Al editar NO hay fechas: se muestran de solo lectura y se cambian con «Cambiar fechas», que mueve entregas y pide vista previa,
 * motivo y causa; el origen sí se edita. Un embarque local no lleva viaje ni arribo. Todos los roles lo usan; la API manda.
 */
export function ModalEmbarque({
  embarque,
  viajes,
  asignables,
  puertos,
  origenes = [],
  codigosExistentes,
  viajeInicial = null,
  onCerrar,
  onGuardado,
  onRecargar,
  onCambiarFechas,
}: {
  /** Nulo = crear. */
  embarque: EmbarqueApi | null;
  viajes: readonly OpcionViajeApi[];
  asignables: readonly AsignableApi[];
  puertos: readonly string[];
  /** Orígenes ya usados, como sugerencia del campo Origen. */
  origenes?: readonly string[];
  /** Códigos de embarques ya usados, para proponer el siguiente. */
  codigosExistentes: readonly string[];
  /** Viaje con que se abre el formulario al crear (el viaje activo o el viaje desde el que se crea). */
  viajeInicial?: string | null;
  onCerrar: () => void;
  /** `aviso` es un problema que no impidió crear (p. ej. no se pudo marcar «ya ocurrió»). */
  onGuardado: (e: EmbarqueApi | EmbarqueDetalleApi, creado: boolean, aviso?: string | null) => void | Promise<void>;
  onRecargar?: () => void | Promise<void>;
  /** Al editar: abre «Fechas del embarque» (cierra este formulario). */
  onCambiarFechas?: () => void;
}) {
  const edita = embarque !== null;
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const [ahora] = useState(() => ahoraEnLima());
  const [form, setForm] = useState(() => ({
    codigo: null as string | null,
    nombre: embarque?.nombre ?? "",
    tipo: (embarque?.tipo ?? "importacion") as TipoEmbarque,
    viaje: embarque ? (embarque.viaje?.id ?? "") : (viajeInicial ?? ""),
    responsable: embarque?.responsable_efectivo?.origen === "propio" ? embarque.responsable_efectivo.perfil_id : "",
    referencia: embarque?.referencia_logistica ?? "",
    puerto: embarque?.puerto_embarque ?? "",
    origen: embarque?.origen ?? "",
    zarpe: "",
    arribo: "",
    llegada: "",
    inicioFecha: "",
    inicioHora: "",
    ingreso: "",
    ocurrido: "" as "" | HitoConfirmable,
    nota: embarque?.nota ?? "",
  }));
  const poner = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setAviso(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const sugerido = edita ? null : sugerirCodigo(form.llegada, codigosExistentes);
  const codigoVisible = form.codigo ?? sugerido ?? "";
  const esLocal = form.tipo === "local";

  const opcionesViaje = viajesParaSelector(viajes);
  const viajeActualFuera = embarque?.viaje && !opcionesViaje.some((v) => v.id === embarque.viaje?.id) ? embarque.viaje : null;
  const habituales = embarque?.puertos_habituales ?? [];
  const sugerenciasPuerto = [...new Set([...habituales, ...puertos])];
  const sugerenciasOrigen = [...new Set([...origenes, ...ORIGENES_HABITUALES])];

  // Avisos de orden (no bloquean; la salida posterior al Ingreso CD sí, y se dice al guardar).
  const ordenAviso = edita ? [] : ordenDeFechasRoto({ zarpe: form.zarpe || null, arribo: esLocal ? null : form.arribo || null, ingreso_cd: form.llegada || null, inicio_operativo: form.inicioFecha || null, ingreso_stock: form.ingreso || null });

  /** Lo que impide marcar «ya ocurrió» (falta la fecha de ese hito o es futura), o `null`. */
  function problemaOcurrido(): string | null {
    const h = form.ocurrido;
    if (h === "") return null;
    const rango = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo"].indexOf(h) + 1;
    const falta = (nombre: string) => `Para marcar «${OPCIONES_OCURRIDO.find((o) => o.valor === h)?.texto.toLowerCase()}» pon la fecha de ${nombre}.`;
    if (h === "zarpe" && form.zarpe === "") return falta("zarpe");
    if (h === "arribo" && form.arribo === "") return falta("arribo");
    if (h === "inicio_operativo" && form.inicioFecha === "") return falta("inicio operativo");
    const futuras: [string, boolean][] = [
      [form.zarpe, rango >= 1],
      [form.arribo, rango >= 2 && !esLocal],
      [form.llegada, rango >= 3],
    ];
    if (futuras.some(([f, aplica]) => aplica && f !== "" && f > ahora.fecha)) return "No puedes marcar como ocurrida una fecha futura.";
    if (rango >= 4 && form.inicioFecha !== "" && esMomentoFuturo(form.inicioFecha, form.inicioHora || null, ahora)) return "No puedes marcar como ocurrida una fecha futura.";
    return null;
  }

  async function guardar() {
    setAviso(null);
    if (!edita) {
      if (salidaDespuesDeLlegada(form.zarpe, form.llegada)) {
        setAviso("El zarpe no puede ser posterior al Ingreso CD.");
        return;
      }
      if (form.inicioHora !== "" && form.inicioFecha === "") {
        setAviso("Pon la fecha del inicio operativo antes que la hora.");
        return;
      }
      const p = problemaOcurrido();
      if (p) {
        setAviso(p);
        return;
      }
    }
    const cuerpo: GuardarEmbarqueCuerpo = {
      nombre: form.nombre,
      tipo: form.tipo,
      viaje_id: esLocal ? null : form.viaje || null,
      responsable_id: form.responsable || null,
      referencia_logistica: form.referencia || null,
      puerto_embarque: form.puerto || null,
      origen: form.origen.trim() || null,
      nota: form.nota || null,
    };
    if (edita) cuerpo.revision = embarque.revision;
    else {
      cuerpo.fecha_salida_estimada = form.zarpe || null;
      cuerpo.fecha_puerto_estimada = esLocal ? null : form.arribo || null;
      cuerpo.fecha_llegada_estimada = form.llegada;
      cuerpo.fecha_inicio_operativo_estimada = form.inicioFecha || null;
      cuerpo.hora_inicio_operativo = form.inicioFecha && form.inicioHora ? form.inicioHora : null;
      cuerpo.fecha_ingreso_estimada = form.ingreso || null;
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
    let avisoFinal: string | null = null;
    if (!edita && form.ocurrido !== "") {
      // «Ya ocurrió» se marca con la ruta de fechas, con la revisión del embarque recién creado (el alta no lo recibe).
      const creado = r.valor.embarque;
      const m = await accion.ejecutar(() => cambiarFechasEmbarque(creado.id, { revision: creado.revision, hito_confirmado: form.ocurrido as HitoConfirmable }));
      if (!m.ok) avisoFinal = `El embarque se creó, pero no se pudo marcar «ya ocurrió»: ${m.error.mensaje} Márcalo desde «Cambiar fechas».`;
    }
    await onGuardado(r.valor.embarque, !edita, avisoFinal);
  }

  return (
    <ModalFormulario
      titulo={edita ? `Editar embarque ${embarque.codigo}` : "Nuevo embarque"}
      descripcion={edita ? "Las fechas se cambian con «Cambiar fechas», porque pueden mover las entregas." : "Qué llega junto, cuándo sale y cuándo llega al centro de distribución."}
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
          <Field label="Código" hint={sugerido ? "Propuesto con el mes del Ingreso CD. Cámbialo si quieres; vacío = el sistema lo numera." : "Escribe el código a mano (letras, números y guiones)."}>
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
              setForm((f) => ({ ...f, tipo, viaje: tipo === "local" ? "" : f.viaje, arribo: tipo === "local" ? "" : f.arribo }));
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
        <Field label="Origen" hint="Almacén o ciudad de donde sale (California, Nueva York…). Es texto libre.">
          <Input value={form.origen} onChange={(e) => poner("origen", e.target.value)} maxLength={MAX_ORIGEN_EMBARQUE} list="origenes-embarque" autoComplete="off" />
          <datalist id="origenes-embarque">
            {sugerenciasOrigen.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
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

        {edita ? (
          <div className="sm:col-span-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-tinta">Fechas del embarque (solo lectura)</span>
              {onCambiarFechas && (
                <Button variante="secundario" tamano="sm" onClick={onCambiarFechas}>
                  Cambiar fechas
                </Button>
              )}
            </div>
            <ol className="space-y-1.5" aria-label="Fechas del embarque">
              {hitosDelEmbarque(embarque, ahora.fecha).map((h) => (
                <FilaHito key={h.hito} h={h} hoy={ahora.fecha} />
              ))}
            </ol>
            <p className="mt-1 text-xs text-tinta-suave">Se cambian con «Cambiar fechas»: editar el nombre u otro dato no las toca.</p>
          </div>
        ) : (
          <fieldset className="min-w-0 space-y-3 rounded-lg border border-borde p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold">Fechas por hito</legend>
            <p className="text-xs text-tinta-suave">ⓘ El Ingreso al stock decide el mes en que la mercadería cuenta en el flujo.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zarpe (salida)" hint="Editarla no mueve entregas.">
                <Input type="date" value={form.zarpe} max={form.llegada || undefined} onChange={(e) => poner("zarpe", e.target.value)} />
              </Field>
              {!esLocal && (
                <Field label="Arribo (puerto)">
                  <Input type="date" value={form.arribo} onChange={(e) => poner("arribo", e.target.value)} />
                </Field>
              )}
              <Field label="Ingreso CD" hint="Llegada al centro de distribución. Obligatoria. Si solo sabes el mes, pon el 15.">
                <Input type="date" value={form.llegada} min={form.zarpe || undefined} onChange={(e) => poner("llegada", e.target.value)} required aria-required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inicio operativo">
                  <Input type="date" value={form.inicioFecha} onChange={(e) => setForm((f) => ({ ...f, inicioFecha: e.target.value, inicioHora: e.target.value === "" ? "" : f.inicioHora }))} />
                </Field>
                <Field label="Hora (opcional)">
                  <Input type="time" value={form.inicioHora} onChange={(e) => poner("inicioHora", e.target.value)} disabled={form.inicioFecha === ""} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Ingreso al stock" hint="Vacío = el mismo día del Ingreso CD.">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="date" value={form.ingreso} onChange={(e) => poner("ingreso", e.target.value)} className="w-44" />
                    <Button variante="secundario" tamano="sm" onClick={() => poner("ingreso", "")} disabled={form.ingreso === ""}>
                      Igualar al Ingreso CD
                    </Button>
                  </div>
                </Field>
              </div>
              <Field label="¿Ya ocurrió?" hint="Hasta dónde llegó este embarque. Pide la fecha de ese hito, que no sea futura.">
                <Select value={form.ocurrido} onChange={(e) => poner("ocurrido", e.target.value as "" | HitoConfirmable)}>
                  {OPCIONES_OCURRIDO.filter((o) => !(esLocal && o.valor === "arribo")).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.ocurrido === "inicio_operativo" && (
                <div className="flex items-end">
                  <Button variante="secundario" tamano="sm" onClick={() => setForm((f) => ({ ...f, inicioFecha: f.inicioFecha || ahora.fecha, inicioHora: horaAhora(ahora) }))}>
                    Ahora
                  </Button>
                </div>
              )}
            </div>
            {ordenAviso.length > 0 && (
              <ul className="space-y-1 text-xs text-alerta" aria-live="polite">
                {ordenAviso.map((t) => (
                  <li key={t}>⚠ {t} Se guarda igual.</li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        <Field label="Nota" className="sm:col-span-2">
          <Textarea value={form.nota} onChange={(e) => poner("nota", e.target.value)} maxLength={MAX_NOTA_EMBARQUE} rows={2} />
        </Field>
      </div>
      {embarque && embarque.estado !== "planificado" && embarque.estado !== "en_transito" && <Alert tono="info">Este embarque está {embarque.estado === "cancelado" ? "cancelado" : "recibido"}: el servidor no admite cambios.</Alert>}
    </ModalFormulario>
  );
}
