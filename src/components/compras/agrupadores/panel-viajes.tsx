"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Input } from "@/components/ui/form";
import { ESTADOS_VIAJE } from "@/lib/compras/agrupadores/tipos";
import { ETIQUETA_ESTADO_VIAJE, type ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { cambiarEstadoViaje, useAccion, useViaje } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import type { ContextoAgrupadores } from "./contexto";
import { DetalleViaje } from "./detalle-viaje";
import { DialogoCancelarAgrupador } from "./dialogo-cancelar";
import { descargarViajes } from "./descarga";
import { ListaViajes, textoCuentaViajes } from "./lista-viajes";
import { ModalViaje } from "./modal-viaje";
import { filtrarViajes, esMio, mioEfectivo, ordenarViajes, puedeCerrarOCancelar, type ParametrosAgrupadores } from "./vista-agrupadores";
import { pideRelectura, textoErrorAccion } from "./vista-errores";

/**
 * La pestaña Viajes (ficha 08b §4.3): la lista con «Mis viajes» o «Todos», estado y texto, y el detalle de un viaje. Los tres roles crean y
 * editan viajes y les agregan o quitan compras (también con el viaje cerrado); cerrar, reabrir y cancelar son de admin y planner (los botones
 * se ocultan por rol y la API responde `403`). «Usar como viaje activo» guarda la preferencia de este navegador.
 */
export function PanelViajes({ ctx }: { ctx: ContextoAgrupadores }) {
  const { parametros, rol, perfilId } = ctx;
  const detalle = useViaje(parametros.viaje);
  const accion = useAccion();
  const [creando, setCreando] = useState(false);
  const [cancelando, setCancelando] = useState<ViajeApi | null>(null);
  const [exportando, setExportando] = useState(false);

  const todos = useMemo(() => ctx.viajes?.viajes ?? [], [ctx.viajes]);
  const hayMios = todos.some((v) => v.estado === "abierto" && esMio(v.responsable, perfilId));
  const mio = mioEfectivo(parametros.mio, rol, hayMios);
  const visibles = useMemo(() => ordenarViajes(filtrarViajes(todos, parametros, perfilId, mio)), [todos, parametros, perfilId, mio]);
  const asignables = ctx.opciones?.asignables ?? ctx.viajes?.asignables ?? [];
  const puedeCerrar = puedeCerrarOCancelar(rol);

  async function recargarTodo() {
    await Promise.all([detalle.recargar(), ctx.recargarBase()]);
  }

  async function cambiarEstado(v: ViajeApi, que: "cerrar" | "reabrir") {
    const texto = que === "cerrar" ? `¿Cerrar el viaje ${v.codigo}? Sigue aceptando compras y embarques, pero deja de ser el viaje activo por defecto y pasa al final de los selectores.` : `¿Reabrir el viaje ${v.codigo}?`;
    if (!confirm(texto)) return;
    ctx.setMensaje(null);
    const r = await accion.ejecutar(() => cambiarEstadoViaje(v.id, { revision: v.revision, accion: que }));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await recargarTodo();
      return;
    }
    ctx.setMensaje({ tono: "exito", texto: que === "cerrar" ? `Viaje ${v.codigo} cerrado.` : `Viaje ${v.codigo} reabierto.` });
    await recargarTodo();
  }

  async function exportar() {
    ctx.setMensaje(null);
    accion.limpiar();
    setExportando(true);
    const r = await accion.ejecutar(() => descargarViajes({ viajes: visibles, asignables }));
    setExportando(false);
    if (r.ok) ctx.setMensaje({ tono: "exito", texto: `Excel descargado: ${plural(visibles.length, "viaje", "viajes")}.` });
  }

  const usarActivo = (v: ViajeApi) => void ctx.usarComoViajeActivo(v.id);

  // ── Detalle ──
  if (parametros.viaje) {
    return (
      <div className="space-y-5">
        <Link href={ctx.href({ viaje: null })} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          ← Volver a los viajes
        </Link>
        {detalle.error && <Alert onCerrar={() => detalle.setError(null)}>{detalle.error}</Alert>}
        {detalle.cargando && !detalle.datos && <p className="py-8 text-center text-sm text-tinta-suave">Cargando el viaje…</p>}
        {detalle.datos && (
          <DetalleViaje
            detalle={detalle.datos}
            rol={rol}
            perfilId={perfilId}
            asignables={asignables}
            opciones={ctx.opciones}
            viajes={todos}
            esActivo={ctx.viajeActivo === detalle.datos.viaje.id}
            ocupadoActivo={ctx.viajeActivoOcupado}
            hrefEmbarque={(id) => ctx.href({ pestana: "embarques", embarque: id, viaje: null })}
            onUsarActivo={() => usarActivo(detalle.datos!.viaje)}
            onRecargar={recargarTodo}
            onMensaje={ctx.setMensaje}
          />
        )}
      </div>
    );
  }

  // ── Lista ──
  const estados: ChipItem<string>[] = [{ id: "todos", label: "Todos" }, ...ESTADOS_VIAJE.map((e) => ({ id: e as string, label: ETIQUETA_ESTADO_VIAJE[e] }))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-tinta-suave">
          Dónde y cuándo se compró. El viaje es contexto y filtro, no un presupuesto: se sigue comprando por oportunidad. Un viaje cerrado sigue aceptando compras y embarques; solo avisa.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variante="secundario" onClick={() => void exportar()} disabled={exportando || visibles.length === 0} title="Descarga los viajes de la lista en Excel (con la hoja AGRUPADORES para reimportar)">
            {exportando ? "Preparando Excel…" : "Excel"}
          </Button>
          <Button onClick={() => setCreando(true)}>Nuevo viaje</Button>
        </div>
      </div>

      {ctx.viajes === null && <p className="py-6 text-center text-sm text-tinta-suave">Cargando los viajes…</p>}
      {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Chips
            etiqueta="Responsable"
            items={[
              { id: "mios", label: "Mis viajes" },
              { id: "todos", label: "Todos" },
            ]}
            activo={mio ? "mios" : "todos"}
            onCambiar={(id) => ctx.cambiar({ mio: id === "mios" })}
          />
          <Chips etiqueta="Estado" items={estados} activo={parametros.estadoViaje ?? "todos"} onCambiar={(id) => ctx.cambiar({ estadoViaje: id === "todos" ? null : (id as ParametrosAgrupadores["estadoViaje"]) })} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Buscar" className="col-span-2 md:col-span-1">
            <Input value={parametros.q} onChange={(e) => ctx.cambiar({ q: e.target.value })} placeholder="Código, nombre, destino o responsable" />
          </Field>
        </div>
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {textoCuentaViajes(visibles.length, todos.length)}
        </p>
      </div>

      <ListaViajes
        viajes={visibles}
        enlace={(v) => ctx.href({ viaje: v.id })}
        viajeActivo={ctx.viajeActivo}
        puedeCerrarOCancelar={puedeCerrar}
        ocupado={accion.ocupado || ctx.viajeActivoOcupado}
        onUsarActivo={usarActivo}
        onCerrarViaje={(v) => void cambiarEstado(v, "cerrar")}
        onReabrir={(v) => void cambiarEstado(v, "reabrir")}
        onCancelar={setCancelando}
        cargando={ctx.viajes === null}
      />

      {creando && (
        <ModalViaje
          viaje={null}
          asignables={asignables}
          perfilId={perfilId}
          codigosExistentes={todos.map((v) => v.codigo)}
          onCerrar={() => setCreando(false)}
          onRecargar={recargarTodo}
          onGuardado={async (v) => {
            setCreando(false);
            ctx.setMensaje({ tono: "exito", texto: `Viaje ${v.codigo} creado.` });
            await recargarTodo();
            ctx.navegar({ viaje: v.id });
          }}
        />
      )}
      {cancelando && (
        <DialogoCancelarAgrupador
          tipo="Viaje"
          codigo={cancelando.codigo}
          revision={cancelando.revision}
          llamar={(c) => cambiarEstadoViaje(cancelando.id, c)}
          onCerrar={() => setCancelando(null)}
          onRecargar={recargarTodo}
          onCancelado={async () => {
            ctx.setMensaje({ tono: "exito", texto: `Viaje ${cancelando.codigo} cancelado.` });
            setCancelando(null);
            await recargarTodo();
          }}
        />
      )}
    </div>
  );
}
