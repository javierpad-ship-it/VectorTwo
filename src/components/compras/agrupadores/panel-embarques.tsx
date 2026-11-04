"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { useEmbarque, useEmbarques, type FiltrosEmbarques as FiltrosApi } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import type { ContextoAgrupadores } from "./contexto";
import { DetalleEmbarque } from "./detalle-embarque";
import { descargarEmbarques } from "./descarga";
import { FiltrosEmbarques } from "./filtros-embarques";
import { ListaEmbarques } from "./lista-embarques";
import { ModalEmbarque } from "./modal-embarque";
import { textoErrorAccion } from "./vista-errores";
import { filtrarEmbarques, mioEfectivo, ordenarEmbarques, esMio, viajeParaApi } from "./vista-agrupadores";

/**
 * La pestaña Embarques (ficha 08b §4.1 y §4.2): la lista con sus filtros y el detalle de un embarque. El viaje activo filtra la lista (los
 * embarques del viaje; «Sin viaje» muestra los locales). «Mis embarques» y el texto se aplican en el navegador; el comprador responsable de
 * alguno abre con «Mis embarques» activo. Los tres roles crean y editan; cancelar es de admin y planner.
 */
export function PanelEmbarques({ ctx }: { ctx: ContextoAgrupadores }) {
  const { parametros, rol, perfilId } = ctx;
  const enLista = parametros.embarque === null;
  const filtros: FiltrosApi = {
    estado: parametros.estado ?? undefined,
    tipo: parametros.tipo ?? undefined,
    viaje_id: viajeParaApi(ctx.viajeActivo),
    desde: parametros.desde ?? undefined,
    hasta: parametros.hasta ?? undefined,
    atrasados: parametros.atrasados || undefined,
  };
  const lista = useEmbarques(enLista && ctx.viajeActivoListo ? filtros : null);
  const detalle = useEmbarque(parametros.embarque);
  const accion = useAccion();
  const [creando, setCreando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const embarques = useMemo(() => lista.datos?.embarques ?? [], [lista.datos]);
  const hayMios = embarques.some((e) => esMio(e.responsable_efectivo, perfilId));
  const mio = mioEfectivo(parametros.mio, rol, hayMios);
  const visibles = useMemo(() => ordenarEmbarques(filtrarEmbarques(embarques, parametros, perfilId, mio)), [embarques, parametros, perfilId, mio]);

  const asignables = ctx.opciones?.asignables ?? ctx.viajes?.asignables ?? [];
  const errorCarga = lista.error ?? detalle.error;
  const limpiarErrores = () => {
    lista.setError(null);
    detalle.setError(null);
  };
  async function recargarTodo() {
    await Promise.all([lista.recargar(), detalle.recargar(), ctx.recargarBase()]);
  }

  async function exportar() {
    ctx.setMensaje(null);
    accion.limpiar();
    setExportando(true);
    const r = await accion.ejecutar(() => descargarEmbarques({ embarques: visibles, viajes: ctx.viajes?.viajes ?? [], asignables }));
    setExportando(false);
    if (r.ok) ctx.setMensaje({ tono: "exito", texto: `Excel descargado: ${plural(visibles.length, "embarque", "embarques")} con sus paquetes y asignaciones.` });
  }

  // ── Detalle ──
  if (parametros.embarque) {
    return (
      <div className="space-y-5">
        <Link href={ctx.href({ embarque: null })} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          ← Volver a los embarques
        </Link>
        {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
        {detalle.cargando && !detalle.datos && <p className="py-8 text-center text-sm text-tinta-suave">Cargando el embarque…</p>}
        {detalle.datos && (
          <DetalleEmbarque
            embarque={detalle.datos.embarque}
            rol={rol}
            opciones={ctx.opciones}
            viajes={ctx.viajes?.viajes ?? []}
            asignables={asignables}
            codigosEmbarque={(ctx.opciones?.embarques ?? []).map((e) => e.codigo)}
            codigosPaquete={(ctx.opciones?.paquetes ?? []).map((p) => p.codigo)}
            hrefViaje={(id) => ctx.href({ pestana: "viajes", viaje: id, embarque: null })}
            onRecargar={recargarTodo}
            onMensaje={ctx.setMensaje}
          />
        )}
      </div>
    );
  }

  // ── Lista ──
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-tinta-suave">
          Qué llega junto, cuándo sale y cuándo llega al centro de distribución. La fecha de llegada alinea las entregas de cada embarque: cambiarla las mueve en bloque, con motivo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variante="secundario" onClick={() => void exportar()} disabled={exportando || lista.cargando || visibles.length === 0} title="Descarga los embarques de la lista con sus paquetes y asignaciones en Excel">
            {exportando ? "Preparando Excel…" : "Excel"}
          </Button>
          <Button onClick={() => setCreando(true)}>Nuevo embarque</Button>
        </div>
      </div>

      {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
      {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}

      <div className="space-y-3">
        <FiltrosEmbarques parametros={parametros} mio={mio} onCambiar={ctx.cambiar} />
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {plural(visibles.length, "embarque", "embarques")}
          {visibles.length !== embarques.length ? ` de ${embarques.length}` : ""}
          {lista.cargando && embarques.length > 0 ? " · actualizando…" : ""}
        </p>
      </div>

      <ListaEmbarques embarques={visibles} enlace={(e) => ctx.href({ embarque: e.id })} cargando={(lista.cargando && embarques.length === 0) || !ctx.viajeActivoListo} />

      {creando && (
        <ModalEmbarque
          embarque={null}
          viajes={ctx.opciones?.viajes ?? []}
          asignables={asignables}
          puertos={ctx.opciones?.puertos ?? []}
          codigosExistentes={(ctx.opciones?.embarques ?? []).map((e) => e.codigo)}
          viajeInicial={/^[0-9a-f-]{36}$/i.test(ctx.viajeActivo) ? ctx.viajeActivo : null}
          onCerrar={() => setCreando(false)}
          onRecargar={recargarTodo}
          onGuardado={async (e) => {
            setCreando(false);
            ctx.setMensaje({ tono: "exito", texto: `Embarque ${e.codigo} creado. Agrega compras para asignarle mercadería.` });
            await recargarTodo();
            ctx.navegar({ embarque: e.id });
          }}
        />
      )}
    </div>
  );
}
