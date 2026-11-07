"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { fechaHora } from "@/components/compras/formato";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { api } from "@/lib/api-client";
import type { ProveedorDetalleApi, ProveedorFichaApi, RespuestaEliminarProveedorApi } from "@/lib/proveedores/tipos-api";
import { HistorialProveedor } from "./historial-proveedor";
import { hrefComprasDeProveedor, textoFaltan, textoPersona, textoResumen, textoRespuestaEliminar, textoUbicacion } from "./vista-proveedores";

type PestanaProveedor = "ficha" | "historial";

/**
 * Detalle de un proveedor (08c, §4.2): la ficha completa, el resumen de sus compras, «Ver sus compras» y la pestaña «Historial» (§11.P4).
 * Los botones salen según `puede` (calculado con el rol en el servidor): Editar para todos; Desactivar / Reactivar y Eliminar solo planner
 * y admin; Eliminar y Desactivar piden confirmación. Todo error de la API se muestra con `Alert`.
 */
export function DetalleProveedor({
  id,
  onVolver,
  onEditar,
  onCambio,
  onEliminado,
}: {
  /** Quien lo usa le pone `key` (p. ej. un contador) para releer ficha e historial tras guardar. */
  id: string;
  onVolver: () => void;
  onEditar: (ficha: ProveedorFichaApi) => void;
  /** Tras desactivar o reactivar: el padre recarga el listado. */
  onCambio: (mensaje: string) => void | Promise<void>;
  onEliminado: (mensaje: string) => void | Promise<void>;
}) {
  const lectura = useLectura<ProveedorDetalleApi>(`/api/compras/proveedores/${id}`);
  const accion = useAccion();
  const [pestana, setPestana] = useState<PestanaProveedor>("ficha");
  const p = lectura.datos;

  async function alternarActivo(ficha: ProveedorDetalleApi) {
    const aviso = ficha.activo ? `¿Desactivar «${ficha.nombre}»? Dejará de salir en el autocompletado; sus compras y su historial se conservan.` : `¿Reactivar «${ficha.nombre}»?`;
    if (!confirm(aviso)) return;
    const r = await accion.ejecutar(() => api.post<ProveedorFichaApi>(`/api/compras/proveedores/${ficha.id}/activo`, { activo: !ficha.activo }));
    if (!r.ok) return;
    await lectura.recargar();
    await onCambio(`«${ficha.nombre}» ${ficha.activo ? "desactivado" : "reactivado"}.`);
  }

  async function eliminar(ficha: ProveedorDetalleApi) {
    if (!confirm(`¿Eliminar «${ficha.nombre}»? Si tiene compras no se borra: queda desactivado. Los datos del proveedor y sus contactos no se pueden recuperar.`)) return;
    const r = await accion.ejecutar(() => api.delete<RespuestaEliminarProveedorApi>(`/api/compras/proveedores/${ficha.id}`));
    if (!r.ok) return;
    if (r.valor.accion === "borrado") {
      await onEliminado(textoRespuestaEliminar("borrado", ficha.nombre));
    } else {
      await lectura.recargar();
      await onCambio(textoRespuestaEliminar("desactivado", ficha.nombre));
    }
  }

  return (
    <div className="space-y-5">
      <Button variante="secundario" tamano="sm" onClick={onVolver}>
        ← Volver a la lista
      </Button>
      {lectura.error && <Alert onCerrar={() => lectura.setError(null)}>{lectura.error}</Alert>}
      {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}
      {lectura.cargando && !p && <p className="py-8 text-center text-sm text-tinta-suave">Cargando el proveedor…</p>}
      {p && (
        <>
          <section className="rounded-xl border border-borde bg-superficie p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold">{p.nombre}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
                  {p.codigo && <span>Código {p.codigo}</span>}
                  <Badge tono={p.activo ? "exito" : "alerta"}>{p.activo ? "Activo" : "Inactivo"}</Badge>
                  {p.es_intercompany && <Badge tono="marca">CD intercompany</Badge>}
                  {p.faltan.length > 0 && <Badge tono="alerta">Ficha incompleta</Badge>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.puede.editar && (
                  <Button onClick={() => onEditar(p)} disabled={accion.ocupado}>
                    Editar
                  </Button>
                )}
                {p.puede.desactivar && (
                  <Button variante="secundario" onClick={() => void alternarActivo(p)} disabled={accion.ocupado}>
                    {p.activo ? "Desactivar" : "Reactivar"}
                  </Button>
                )}
                {p.puede.eliminar && (
                  <Button variante="peligro" onClick={() => void eliminar(p)} disabled={accion.ocupado}>
                    Eliminar
                  </Button>
                )}
              </div>
            </div>
            {p.faltan.length > 0 && (
              <div className="mt-3">
                <Alert tono="info">
                  {textoFaltan(p.faltan)}. Complétalo con «Editar».
                </Alert>
              </div>
            )}
          </section>

          <Tabs
            activa={pestana}
            onCambiar={setPestana}
            items={[
              { id: "ficha", label: "Ficha" },
              { id: "historial", label: "Historial" },
            ]}
          />

          {pestana === "ficha" ? <FichaProveedor p={p} /> : <HistorialProveedor key={`${p.revision}-${p.activo}`} proveedorId={p.id} />}
        </>
      )}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</dt>
      <dd className="mt-0.5 break-words text-tinta">{valor || <span className="text-tinta-suave">—</span>}</dd>
    </div>
  );
}

function FichaProveedor({ p }: { p: ProveedorDetalleApi }) {
  const plazos = [p.plazo_produccion_dias !== null ? `${p.plazo_produccion_dias} d producción` : null, p.plazo_transito_dias !== null ? `${p.plazo_transito_dias} d tránsito` : null].filter(Boolean).join(" + ");
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm" aria-label="Empresa">
        <h3 className="text-sm font-semibold">Empresa</h3>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Dato titulo="RUC / Tax ID" valor={p.identificacion} />
          <Dato titulo="País · región" valor={p.pais ? textoUbicacion(p) : null} />
          <Dato titulo="Ciudad" valor={p.ciudad} />
          <Dato titulo="Dirección" valor={p.direccion} />
          {p.nota && <Dato titulo="Nota" valor={p.nota} />}
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm" aria-label="Importación">
        <h3 className="text-sm font-semibold">Importación</h3>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Dato titulo="Puerto de embarque habitual" valor={p.puerto_embarque} />
          <Dato titulo="Incoterm habitual" valor={p.incoterm} />
          <Dato titulo="Moneda habitual" valor={p.moneda} />
          <Dato titulo="Plazos" valor={plazos || null} />
          <Dato titulo="Condiciones de pago" valor={p.condiciones_pago} />
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm" aria-label="Contactos">
        <h3 className="text-sm font-semibold">Contactos ({p.contactos.length})</h3>
        {p.contactos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Sin contactos.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {p.contactos.map((c) => (
              <li key={c.id} className="rounded-lg border border-borde p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {c.nombre}
                  {c.es_principal && <Badge tono="marca">Principal</Badge>}
                </p>
                {c.cargo && <p className="text-tinta-suave">{c.cargo}</p>}
                {c.telefono && <p>{c.telefono}</p>}
                {c.correo && <p className="break-all">{c.correo}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm" aria-label="Compras">
        <h3 className="text-sm font-semibold">Compras</h3>
        <p className="text-sm">{textoResumen(p.resumen)}</p>
        {p.resumen.ultima_compra && <p className="text-xs text-tinta-suave">Última compra: {p.resumen.ultima_compra}</p>}
        <Link href={hrefComprasDeProveedor(p.id)} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          Ver sus compras
        </Link>
      </section>

      <p className="text-xs text-tinta-suave">
        Creado por {textoPersona(p.creado_por, fechaHora)}
        {p.modificado_por ? ` · Último cambio: ${textoPersona(p.modificado_por, fechaHora)}` : ""}
      </p>
    </div>
  );
}
