"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Rol } from "@/lib/auth/roles";
import type { AsignableApi, AvisoDetalleApi, EntregaSinEmbarqueApi, OpcionesAgrupadoresApi, ViajeApi, ViajeDetalleApi } from "@/lib/compras/agrupadores/tipos-api";
import { ETIQUETA_AVISO_AGRUPADOR } from "@/lib/compras/agrupadores/tipos-api";
import { cambiarEstadoViaje, useAccion, useSinAsignar } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { unidades } from "../formato";
import { DialogoAsignar } from "./dialogo-asignar";
import { DialogoCancelarAgrupador } from "./dialogo-cancelar";
import { DialogoComprasViaje } from "./dialogo-compras-viaje";
import { HistorialAgrupador } from "./historial";
import { AvisosBadges, EstadoEmbarqueBadge, EstadoViajeBadge, ResponsableTexto, TipoEmbarqueBadge } from "./insignias";
import { mensajeDeMovimiento, type MensajeAgrupador } from "./detalle-embarque";
import { ModalEmbarque } from "./modal-embarque";
import { ModalViaje } from "./modal-viaje";
import { TablaCompras, TablaEntregasSinEmbarque } from "./tablas-sin-agrupador";
import { puedeCerrarOCancelar, textoAvisoDetalle, textoCostoMonedas, textoFecha } from "./vista-agrupadores";
import { pideRelectura, textoErrorAccion } from "./vista-errores";

type Dialogo =
  | { tipo: "editar" }
  | { tipo: "agregar" }
  | { tipo: "quitar" }
  | { tipo: "embarque" }
  | { tipo: "asignar-embarque"; entregas: EntregaSinEmbarqueApi[] }
  | { tipo: "cancelar" }
  | null;

function Dato({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tinta-suave">{titulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Detalle de un viaje (ficha 08b §4.3): sus datos, las compras del viaje (agregar y quitar, también con el viaje cerrado), sus embarques y lo
 * que todavía no tiene embarque, con «Asignar a embarque…». Los tres roles editan, agregan y quitan compras y crean embarques del viaje; solo
 * admin y planner cierran, reabren y cancelan (los botones se ocultan por rol y la API decide). Un viaje cerrado solo informa: el aviso lo dice.
 */
export function DetalleViaje({
  detalle,
  rol,
  perfilId,
  asignables,
  opciones,
  viajes,
  esActivo,
  ocupadoActivo,
  hrefEmbarque,
  onUsarActivo,
  onRecargar,
  onMensaje,
}: {
  detalle: ViajeDetalleApi;
  rol: Rol;
  perfilId: string;
  asignables: readonly AsignableApi[];
  opciones: OpcionesAgrupadoresApi | null;
  viajes: readonly ViajeApi[];
  esActivo: boolean;
  ocupadoActivo: boolean;
  hrefEmbarque: (id: string) => string;
  onUsarActivo: () => void;
  /** Relee el detalle, las listas y las opciones. */
  onRecargar: () => void | Promise<void>;
  onMensaje: (m: MensajeAgrupador | null) => void;
}) {
  const { viaje, compras, embarques } = detalle;
  const accion = useAccion();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [marcadasCompras, setMarcadasCompras] = useState<ReadonlySet<string>>(new Set());
  const [marcadasEntregas, setMarcadasEntregas] = useState<ReadonlySet<string>>(new Set());
  const sinEmbarque = useSinAsignar({ viaje_id: viaje.id });
  const sinViaje = useSinAsignar(dialogo?.tipo === "agregar" ? {} : null);
  const cancelado = viaje.estado === "cancelado";
  const puedeCancelar = puedeCerrarOCancelar(rol);
  const entregas = sinEmbarque.datos?.entregas ?? [];

  const alternar = (set: ReadonlySet<string>, poner: (s: ReadonlySet<string>) => void) => (id: string, marcada: boolean) => {
    const n = new Set(set);
    if (marcada) n.add(id);
    else n.delete(id);
    poner(n);
  };

  const cerrar = () => setDialogo(null);
  async function tras(texto: string, avisos: AvisoDetalleApi[] = []) {
    setDialogo(null);
    setMarcadasCompras(new Set());
    setMarcadasEntregas(new Set());
    onMensaje({ tono: avisos.length > 0 ? "info" : "exito", texto, avisos: avisos.map((a) => textoAvisoDetalle(a, ETIQUETA_AVISO_AGRUPADOR)) });
    await Promise.all([onRecargar(), sinEmbarque.recargar()]);
  }

  async function cambiarEstado(accionEstado: "cerrar" | "reabrir") {
    const texto = accionEstado === "cerrar" ? `¿Cerrar el viaje ${viaje.codigo}? Sigue aceptando compras y embarques, pero deja de ser el viaje activo por defecto y pasa al final de los selectores.` : `¿Reabrir el viaje ${viaje.codigo}?`;
    if (!confirm(texto)) return;
    onMensaje(null);
    const r = await accion.ejecutar(() => cambiarEstadoViaje(viaje.id, { revision: viaje.revision, accion: accionEstado }));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar();
      return;
    }
    onMensaje({ tono: "exito", texto: accionEstado === "cerrar" ? `Viaje ${viaje.codigo} cerrado.` : `Viaje ${viaje.codigo} reabierto.` });
    await onRecargar();
  }

  const comprasMarcadas = compras.filter((c) => marcadasCompras.has(c.id));
  const entregasMarcadas = entregas.filter((e) => marcadasEntregas.has(e.entrega_id));

  return (
    <div className="space-y-5">
      {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}
      {sinViaje.error && <Alert onCerrar={() => sinViaje.setError(null)}>{sinViaje.error}</Alert>}
      {viaje.estado === "cerrado" && <Alert tono="info">{`El viaje ${viaje.codigo} está cerrado: igual se le pueden añadir y quitar compras y embarques; todo queda registrado.`}</Alert>}
      {cancelado && <Alert>Este viaje está cancelado y ya no admite cambios.</Alert>}

      <Card titulo={`Viaje ${viaje.codigo} · ${viaje.nombre}`} acciones={<EstadoViajeBadge estado={viaje.estado} />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Dato titulo="Destino">{viaje.destino ?? <span className="text-tinta-suave">—</span>}</Dato>
          <Dato titulo="Fechas">
            {textoFecha(viaje.fecha_inicio)}
            {viaje.fecha_fin ? ` – ${textoFecha(viaje.fecha_fin)}` : ""}
          </Dato>
          <Dato titulo="Responsable">
            <ResponsableTexto responsable={viaje.responsable ? { ...viaje.responsable, origen: "propio" } : null} faltante={!viaje.responsable_valido || viaje.avisos.includes("sin_responsable")} />
          </Dato>
          <Dato titulo="Compras">{plural(viaje.totales.compras, "compra", "compras")}</Dato>
          <Dato titulo="Unidades">
            <span className="font-mono text-xs tabular-nums">{unidades(viaje.totales.unidades)} u</span>
          </Dato>
          <Dato titulo="Costo">
            <span className="font-mono text-xs tabular-nums">{textoCostoMonedas(viaje.totales.costo)}</span>
          </Dato>
          <Dato titulo="Embarques">{plural(viaje.totales.embarques, "embarque", "embarques")}</Dato>
          <Dato titulo="Sin embarque">
            <span className={`font-mono text-xs tabular-nums ${viaje.totales.unidades_sin_embarque > 0 ? "font-medium text-alerta" : ""}`}>{unidades(viaje.totales.unidades_sin_embarque)} u</span>
          </Dato>
          {viaje.nota && (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs text-tinta-suave">Nota</dt>
              <dd className="text-sm">{viaje.nota}</dd>
            </div>
          )}
        </dl>
        {viaje.avisos.filter((a) => a !== "sin_responsable").length > 0 && (
          <div className="mt-3">
            <AvisosBadges avisos={viaje.avisos} omitir={["sin_responsable"]} />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        {!cancelado && <Button onClick={() => setDialogo({ tipo: "editar" })}>Editar</Button>}
        {!cancelado && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "embarque" })}>
            Nuevo embarque del viaje
          </Button>
        )}
        {!cancelado && !esActivo && (
          <Button variante="secundario" disabled={ocupadoActivo} onClick={onUsarActivo}>
            Usar como viaje activo
          </Button>
        )}
        {esActivo && <span className="inline-flex h-10 items-center text-sm text-tinta-suave">Es tu viaje activo.</span>}
        {puedeCancelar && viaje.estado === "abierto" && (
          <Button variante="secundario" disabled={accion.ocupado} onClick={() => void cambiarEstado("cerrar")}>
            Cerrar viaje
          </Button>
        )}
        {puedeCancelar && viaje.estado === "cerrado" && (
          <Button variante="secundario" disabled={accion.ocupado} onClick={() => void cambiarEstado("reabrir")}>
            Reabrir viaje
          </Button>
        )}
        {puedeCancelar && !cancelado && (
          <Button variante="peligro" onClick={() => setDialogo({ tipo: "cancelar" })}>
            Cancelar viaje
          </Button>
        )}
      </div>

      <Card
        titulo="Compras del viaje"
        acciones={
          !cancelado ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button tamano="sm" onClick={() => setDialogo({ tipo: "agregar" })}>
                Agregar compras
              </Button>
              <Button tamano="sm" variante="secundario" disabled={comprasMarcadas.length === 0} onClick={() => setDialogo({ tipo: "quitar" })}>
                Quitar del viaje{comprasMarcadas.length > 0 ? ` (${comprasMarcadas.length})` : ""}
              </Button>
            </div>
          ) : undefined
        }
      >
        <TablaCompras compras={compras} seleccion={marcadasCompras} onAlternar={alternar(marcadasCompras, setMarcadasCompras)} vacio="Este viaje todavía no tiene compras." />
      </Card>

      <Card titulo="Embarques del viaje" descripcion={plural(embarques.length, "embarque", "embarques")}>
        {embarques.length === 0 ? (
          <p className="text-sm text-tinta-suave">Todavía no hay embarques en este viaje.</p>
        ) : (
          <ul className="divide-y divide-borde">
            {embarques.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link href={hrefEmbarque(e.id)} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
                    Embarque {e.codigo}
                  </Link>
                  <span className="ml-2 text-sm">{e.nombre}</span>
                  <p className="text-xs text-tinta-suave">
                    Llega {textoFecha(e.fecha_llegada_estimada)} · {unidades(e.totales.unidades)} u · {textoCostoMonedas(e.totales.costo)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <TipoEmbarqueBadge tipo={e.tipo} />
                  <EstadoEmbarqueBadge estado={e.estado} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        titulo="Sin embarque"
        descripcion="Entregas de este viaje que todavía no están en ningún embarque."
        acciones={
          <Button tamano="sm" disabled={entregasMarcadas.length === 0} onClick={() => setDialogo({ tipo: "asignar-embarque", entregas: entregasMarcadas })}>
            Asignar a embarque…{entregasMarcadas.length > 0 ? ` (${entregasMarcadas.length})` : ""}
          </Button>
        }
      >
        {sinEmbarque.error && <Alert onCerrar={() => sinEmbarque.setError(null)}>{sinEmbarque.error}</Alert>}
        <TablaEntregasSinEmbarque
          entregas={entregas}
          seleccion={marcadasEntregas}
          onAlternar={alternar(marcadasEntregas, setMarcadasEntregas)}
          cargando={sinEmbarque.cargando && !sinEmbarque.datos}
          vacio="Todo lo de este viaje ya tiene embarque."
        />
      </Card>

      <HistorialAgrupador referencia={{ tipo: "viaje", id: viaje.id }} titulo="Historial del viaje" />

      {dialogo?.tipo === "editar" && (
        <ModalViaje
          viaje={viaje}
          asignables={asignables}
          perfilId={perfilId}
          codigosExistentes={viajes.map((v) => v.codigo)}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onGuardado={() => tras(`Viaje ${viaje.codigo} actualizado.`)}
        />
      )}
      {dialogo?.tipo === "embarque" && (
        <ModalEmbarque
          embarque={null}
          viajes={opciones?.viajes ?? []}
          asignables={asignables}
          puertos={opciones?.puertos ?? []}
          codigosExistentes={(opciones?.embarques ?? []).map((e) => e.codigo)}
          viajeInicial={viaje.id}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onGuardado={(e) => tras(`Embarque ${e.codigo} creado en el viaje ${viaje.codigo}.`)}
        />
      )}
      {dialogo?.tipo === "agregar" && sinViaje.datos && (
        <DialogoComprasViaje
          key="agregar"
          modo={{ tipo: "agregar", viaje, candidatas: sinViaje.datos?.compras_sin_viaje ?? [] }}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onHecho={tras}
        />
      )}
      {dialogo?.tipo === "quitar" && <DialogoComprasViaje modo={{ tipo: "quitar", viaje, compras: comprasMarcadas }} onCerrar={cerrar} onRecargar={onRecargar} onHecho={tras} />}
      {dialogo?.tipo === "asignar-embarque" && (
        <DialogoAsignar
          modo={{ tipo: "entregas", entregas: dialogo.entregas }}
          opciones={opciones}
          viajes={viajes}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onAplicado={async (r) => {
            const m = mensajeDeMovimiento(`Mercadería asignada al embarque ${r.embarque.codigo}.`, r);
            await tras(m.texto, r.avisos);
          }}
        />
      )}
      {dialogo?.tipo === "cancelar" && (
        <DialogoCancelarAgrupador
          tipo="Viaje"
          codigo={viaje.codigo}
          revision={viaje.revision}
          llamar={(c) => cambiarEstadoViaje(viaje.id, c)}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onCancelado={() => tras(`Viaje ${viaje.codigo} cancelado.`)}
        />
      )}
    </div>
  );
}
