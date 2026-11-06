"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Rol } from "@/lib/auth/roles";
import {
  ETIQUETA_AVISO_AGRUPADOR,
  type AsignableApi,
  type AsignacionApi,
  type EmbarqueDetalleApi,
  type OpcionesAgrupadoresApi,
  type PaqueteApi,
  type RespuestaMovimientoApi,
  type ViajeApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { cambiarEstadoEmbarque, cancelarPaquete, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { fechaLima, mesLargo, unidades } from "../formato";
import { DialogoAPaquete } from "./dialogo-a-paquete";
import { DialogoAsignar } from "./dialogo-asignar";
import { DialogoCancelarAgrupador } from "./dialogo-cancelar";
import { DialogoFechas } from "./dialogo-fechas";
import { DialogoIngresoPaquete } from "./dialogo-ingreso-paquete";
import { DialogoMoverPaquete } from "./dialogo-mover-paquete";
import { DialogoProgramarBarrer } from "./dialogo-programar-barrer";
import { DialogoPasarPendientes } from "./dialogo-pasar-pendientes";
import { DialogoQuitar } from "./dialogo-quitar";
import { HistorialAgrupador } from "./historial";
import { LineaTiempoEmbarque } from "./linea-tiempo";
import { AvisosBadges, EstadoEmbarqueBadge, EstadoPaqueteBadge, RecepcionBadge, ResponsableTexto, TipoEmbarqueBadge } from "./insignias";
import { ModalEmbarque } from "./modal-embarque";
import { ModalPaquete } from "./modal-paquete";
import { TablaAsignaciones } from "./tabla-asignaciones";
import { textoAvisoDetalle, puedeCerrarOCancelar, textoCostoMonedas, textoFecha, textoUnidadesEmbarque } from "./vista-agrupadores";
import { lotesAlBarrer } from "./vista-barrer";
import { fechaCorta } from "./vista-fechas";
import { pideRelectura, textoErrorAccion } from "./vista-errores";

type Dialogo =
  | { tipo: "editar" }
  | { tipo: "fecha" }
  | { tipo: "ingreso-paquete"; paquete: PaqueteApi }
  | { tipo: "paquete-nuevo" }
  | { tipo: "paquete-editar"; paquete: PaqueteApi }
  | { tipo: "agregar" }
  | { tipo: "quitar"; asignaciones: AsignacionApi[] }
  | { tipo: "a-paquete"; asignaciones: AsignacionApi[] }
  | { tipo: "programar-barrer" }
  | { tipo: "pendientes"; asignaciones: AsignacionApi[] }
  | { tipo: "mover-paquete"; paquete: PaqueteApi }
  | { tipo: "cancelar-embarque" }
  | { tipo: "cancelar-paquete"; paquete: PaqueteApi }
  | null;

export type MensajeAgrupador = { tono: "exito" | "info" | "alerta"; texto: string; avisos?: string[] };

function Dato({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tinta-suave">{titulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Mensaje de lo que hizo un movimiento: sus avisos (ninguno bloquea) se listan debajo. */
export function mensajeDeMovimiento(texto: string, r: RespuestaMovimientoApi): MensajeAgrupador {
  const avisos = r.avisos.map((a) => textoAvisoDetalle(a, ETIQUETA_AVISO_AGRUPADOR));
  return { tono: avisos.length > 0 ? "info" : "exito", texto, avisos };
}

/**
 * Detalle de un embarque (ficha 08b §4.2): cabecera con sus datos, avisos y acciones; los paquetes y «Sin paquete», cada uno con su tabla de
 * asignaciones (las históricas, atenuadas); la línea de tiempo con sus cinco hitos; y el historial. Acciones de los tres roles: Editar, Cambiar fechas, Fijar ingreso de un paquete, marcar en tránsito
 * o volver a planificado, Nuevo paquete, Agregar compras, Programar lo al barrer (si hay lotes al barrer), Quitar del embarque, Mover a paquete (con unidades) y Pasar pendientes. Solo admin y planner
 * cancelan el embarque o un paquete; los botones se ocultan por rol y la API decide. En un embarque cancelado o recibido solo queda
 * «Quitar del embarque». Recibir un embarque es de la siguiente entrega (08b-2).
 */
export function DetalleEmbarque({
  embarque,
  rol,
  opciones,
  viajes,
  asignables,
  codigosEmbarque,
  codigosPaquete,
  hrefViaje,
  onRecargar,
  onMensaje,
}: {
  embarque: EmbarqueDetalleApi;
  rol: Rol;
  opciones: OpcionesAgrupadoresApi | null;
  viajes: readonly ViajeApi[];
  asignables: readonly AsignableApi[];
  codigosEmbarque: readonly string[];
  codigosPaquete: readonly string[];
  hrefViaje: (id: string) => string;
  /** Relee el detalle, la lista y las opciones tras una escritura. */
  onRecargar: () => void | Promise<void>;
  onMensaje: (m: MensajeAgrupador | null) => void;
}) {
  const accion = useAccion();
  const [hoy] = useState(() => fechaLima());
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const puedeCancelar = puedeCerrarOCancelar(rol);
  const enCurso = embarque.estado === "planificado" || embarque.estado === "en_transito";

  const activas = embarque.asignaciones.filter((a) => !a.historica);
  const marcadas = activas.filter((a) => seleccion.has(a.id));
  // Lo marcado se limpia con cada recarga: una asignación que ya no existe no puede quedar seleccionada.
  const idsVigentes = new Set(embarque.asignaciones.map((a) => a.id));
  const alternar = (id: string, marcada: boolean) =>
    setSeleccion((s) => {
      const n = new Set([...s].filter((x) => idsVigentes.has(x)));
      if (marcada) n.add(id);
      else n.delete(id);
      return n;
    });

  const cerrar = () => setDialogo(null);
  async function tras(mensaje: MensajeAgrupador) {
    setDialogo(null);
    setSeleccion(new Set());
    onMensaje(mensaje);
    await onRecargar();
  }
  const movimiento = (texto: string) => async (r: RespuestaMovimientoApi) => tras(mensajeDeMovimiento(texto, r));

  async function cambiarEstado(accionEstado: "en_transito" | "volver_a_planificado", texto: string) {
    onMensaje(null);
    const r = await accion.ejecutar(() => cambiarEstadoEmbarque(embarque.id, { revision: embarque.revision, accion: accionEstado }));
    if (!r.ok) {
      if (pideRelectura(r.error.codigo)) await onRecargar();
      return;
    }
    onMensaje({ tono: "exito", texto });
    await onRecargar();
  }

  const hayLotesAlBarrer = lotesAlBarrer(embarque).length > 0;
  const sinPaquete = embarque.asignaciones.filter((a) => a.paquete_id === null);
  const asignacionesDe = (p: PaqueteApi) => embarque.asignaciones.filter((a) => a.paquete_id === p.id);
  const r = embarque.responsable_efectivo;

  return (
    <div className="space-y-5">
      {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}

      <Card
        titulo={`Embarque ${embarque.codigo} · ${embarque.nombre}`}
        acciones={
          <div className="flex flex-wrap justify-end gap-1.5">
            <TipoEmbarqueBadge tipo={embarque.tipo} />
            <EstadoEmbarqueBadge estado={embarque.estado} />
            <RecepcionBadge recepcion={embarque.recepcion} />
          </div>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Dato titulo="Viaje">
            {embarque.viaje ? (
              <Link href={hrefViaje(embarque.viaje.id)} className="text-marca-oscura underline-offset-2 hover:underline">
                Viaje {embarque.viaje.codigo}
                {embarque.viaje.estado === "cerrado" ? " (cerrado)" : ""}
              </Link>
            ) : (
              <span className="text-tinta-suave">{embarque.tipo === "local" ? "Local: sin viaje" : "Sin viaje"}</span>
            )}
          </Dato>
          <Dato titulo="Responsable">
            <ResponsableTexto responsable={r} faltante={embarque.avisos.includes("sin_responsable")} />
          </Dato>
          <Dato titulo="Origen">{embarque.origen ?? <span className="text-tinta-suave">—</span>}</Dato>
          <Dato titulo="Puerto de embarque">{embarque.puerto_embarque ?? <span className="text-tinta-suave">—</span>}</Dato>
          <Dato titulo="Referencia logística">{embarque.referencia_logistica ?? <span className="text-tinta-suave">—</span>}</Dato>
          <Dato titulo="Ingreso real">{embarque.fecha_llegada_real ? textoFecha(embarque.fecha_llegada_real) : <span className="text-tinta-suave">Sin recibir</span>}</Dato>
          <Dato titulo="Mes del flujo (Ingreso al stock)">{mesLargo(embarque.periodo_llegada)}</Dato>
          {(embarque.reprogramaciones_total ?? 0) > 0 && (
            <Dato titulo="Reprogramaciones">
              <Badge tono="alerta">Reprogramado ×{embarque.reprogramaciones_total}</Badge>
            </Dato>
          )}
          <Dato titulo="Unidades">
            <span className="font-mono text-xs tabular-nums">{textoUnidadesEmbarque(embarque.totales)}</span>
          </Dato>
          <Dato titulo="Contenido">
            {plural(embarque.totales.compras, "compra", "compras")} · {plural(embarque.totales.lineas, "línea", "líneas")} · {plural(embarque.totales.paquetes, "paquete", "paquetes")}
          </Dato>
          <Dato titulo="Costo">
            <span className="font-mono text-xs tabular-nums">{textoCostoMonedas(embarque.totales.costo)}</span>
          </Dato>
          <Dato titulo="Proveedores">{embarque.proveedores.length === 0 ? <span className="text-tinta-suave">—</span> : embarque.proveedores.map((p) => p.nombre).join(", ")}</Dato>
          {embarque.nota && (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs text-tinta-suave">Nota</dt>
              <dd className="text-sm">{embarque.nota}</dd>
            </div>
          )}
          {embarque.totales.historicas > 0 && (
            <div className="col-span-2 md:col-span-4 text-xs text-tinta-suave">
              {unidades(embarque.totales.historicas)} u son históricas (compra recibida o cancelada, o línea ya completa): no se mueven ni cuentan como pendientes.
            </div>
          )}
        </dl>
        {embarque.avisos.filter((a) => a !== "sin_responsable").length > 0 && (
          <div className="mt-3">
            <AvisosBadges avisos={embarque.avisos} omitir={["sin_responsable"]} />
          </div>
        )}
        {embarque.avisos.includes("en_embarque_cancelado") && (
          <div className="mt-3">
            <Alert>Este embarque está cancelado y tiene mercadería activa. Márcala en la tabla y usa «Quitar del embarque» para liberarla.</Alert>
          </div>
        )}
      </Card>

      <Card
        titulo="Línea de tiempo"
        descripcion="Los cinco hitos del embarque, con su estado, el retraso contra lo planeado al crear y cuántas veces se reprogramó."
        acciones={
          enCurso ? (
            <Button tamano="sm" variante="secundario" onClick={() => setDialogo({ tipo: "fecha" })}>
              Cambiar fechas
            </Button>
          ) : undefined
        }
      >
        <LineaTiempoEmbarque embarque={embarque} hoy={hoy} />
      </Card>

      <div className="flex flex-wrap gap-2">
        {enCurso && <Button onClick={() => setDialogo({ tipo: "editar" })}>Editar</Button>}
        {enCurso && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "fecha" })}>
            Cambiar fechas
          </Button>
        )}
        {embarque.estado === "planificado" && (
          <Button variante="secundario" disabled={accion.ocupado} onClick={() => void cambiarEstado("en_transito", `Embarque ${embarque.codigo} en tránsito.`)}>
            Marcar en tránsito
          </Button>
        )}
        {embarque.estado === "en_transito" && (
          <Button variante="secundario" disabled={accion.ocupado} onClick={() => void cambiarEstado("volver_a_planificado", `Embarque ${embarque.codigo} vuelve a planificado.`)}>
            Volver a planificado
          </Button>
        )}
        {enCurso && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "paquete-nuevo" })}>
            Nuevo paquete
          </Button>
        )}
        {enCurso && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "agregar" })}>
            Agregar compras
          </Button>
        )}
        {enCurso && hayLotesAlBarrer && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "programar-barrer" })}>
            Programar lo al barrer
          </Button>
        )}
        {enCurso && (
          <Button variante="secundario" onClick={() => setDialogo({ tipo: "pendientes", asignaciones: marcadas })} disabled={embarque.totales.pendientes === 0}>
            Pasar pendientes a…
          </Button>
        )}
        {puedeCancelar && embarque.estado !== "cancelado" && embarque.estado !== "recibido" && (
          <Button variante="peligro" onClick={() => setDialogo({ tipo: "cancelar-embarque" })}>
            Cancelar embarque
          </Button>
        )}
      </div>

      {marcadas.length > 0 && (
        <div role="region" aria-label="Acciones sobre lo marcado" className="flex flex-wrap items-center gap-2 rounded-lg border border-marca/30 bg-marca-suave/40 px-3 py-2">
          <span className="text-sm font-medium" aria-live="polite">
            {plural(marcadas.length, "asignación marcada", "asignaciones marcadas")} · {unidades(marcadas.reduce((a, x) => a + x.unidades, 0))} u
          </span>
          <Button tamano="sm" variante="secundario" onClick={() => setDialogo({ tipo: "quitar", asignaciones: marcadas })}>
            Quitar del embarque
          </Button>
          {enCurso && (
            <Button tamano="sm" variante="secundario" onClick={() => setDialogo({ tipo: "a-paquete", asignaciones: marcadas })}>
              Mover a paquete
            </Button>
          )}
          {enCurso && (
            <Button tamano="sm" variante="secundario" onClick={() => setDialogo({ tipo: "pendientes", asignaciones: marcadas })}>
              Pasar pendientes a…
            </Button>
          )}
          <Button tamano="sm" variante="fantasma" onClick={() => setSeleccion(new Set())}>
            Quitar la selección
          </Button>
        </div>
      )}

      {embarque.paquetes.map((p) => (
        <Card
          key={p.id}
          titulo={`Paquete ${p.codigo} · ${p.nombre}`}
          acciones={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <EstadoPaqueteBadge estado={p.estado} />
              {enCurso && p.estado === "abierto" && (
                <>
                  <Button tamano="sm" variante="fantasma" onClick={() => setDialogo({ tipo: "paquete-editar", paquete: p })}>
                    Editar
                  </Button>
                  <Button tamano="sm" variante="fantasma" onClick={() => setDialogo({ tipo: "mover-paquete", paquete: p })}>
                    Pasar a otro embarque
                  </Button>
                  {puedeCancelar && (
                    <Button tamano="sm" variante="peligro" onClick={() => setDialogo({ tipo: "cancelar-paquete", paquete: p })}>
                      Cancelar paquete
                    </Button>
                  )}
                </>
              )}
            </div>
          }
          descripcion={`${plural(p.totales.compras, "compra", "compras")} · ${unidades(p.totales.unidades)} u · ${unidades(p.totales.pendientes)} pendientes`}
        >
          <div className="space-y-2">
            <p className="text-xs text-tinta-suave">
              Responsable: <ResponsableTexto responsable={p.responsable_efectivo} faltante={p.avisos.includes("sin_responsable")} />
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                <span aria-hidden="true">{"\u{1F7E2}"} </span>
                Ingreso al stock:{" "}
                <strong className="tabular-nums">
                  {p.ingreso_propio && p.fecha_ingreso ? `ingreso propio: ${textoFecha(p.fecha_ingreso)}` : `hereda del embarque (${textoFecha(embarque.fecha_llegada_real ?? embarque.fecha_ingreso_estimada ?? embarque.fecha_llegada_estimada)})`}
                </strong>
              </span>
              {p.ajustado_desde && <span className="text-xs text-alerta">Ajustado a la llegada del embarque (antes: {fechaCorta(p.ajustado_desde, hoy)}).</span>}
              {(p.lotes_al_barrer ?? 0) > 0 && <span className="text-xs text-tinta-suave">{plural(p.lotes_al_barrer ?? 0, "lote al barrer", "lotes al barrer")}</span>}
              {enCurso && p.estado === "abierto" && (
                <Button tamano="sm" variante="secundario" onClick={() => setDialogo({ tipo: "ingreso-paquete", paquete: p })}>
                  Fijar ingreso…
                </Button>
              )}
            </div>
            <TablaAsignaciones
              asignaciones={asignacionesDe(p)}
              periodoEmbarque={p.periodo_ingreso ?? embarque.periodo_llegada}
              seleccion={seleccion}
              onAlternar={alternar}
              puedeSeleccionar
              vacio="Este paquete todavía no tiene mercadería."
            />
          </div>
        </Card>
      ))}

      <Card titulo="Sin paquete" descripcion={`${plural(sinPaquete.length, "asignación", "asignaciones")} del embarque que no están en ningún paquete.`}>
        <TablaAsignaciones
          asignaciones={sinPaquete}
          periodoEmbarque={embarque.periodo_llegada}
          seleccion={seleccion}
          onAlternar={alternar}
          puedeSeleccionar
          vacio={enCurso ? "Sin mercadería. Usa «Agregar compras» para asignar entregas a este embarque." : "Sin mercadería."}
        />
      </Card>

      <HistorialAgrupador referencia={{ tipo: "embarque", id: embarque.id }} titulo="Historial del embarque y sus paquetes" />

      {dialogo?.tipo === "editar" && (
        <ModalEmbarque
          embarque={embarque}
          viajes={opciones?.viajes ?? []}
          asignables={asignables}
          puertos={opciones?.puertos ?? []}
          origenes={opciones?.origenes ?? []}
          codigosExistentes={codigosEmbarque}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onCambiarFechas={() => setDialogo({ tipo: "fecha" })}
          onGuardado={() => tras({ tono: "exito", texto: `Embarque ${embarque.codigo} actualizado.` })}
        />
      )}
      {dialogo?.tipo === "fecha" && <DialogoFechas embarque={embarque} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento(`Fechas del embarque ${embarque.codigo} actualizadas.`)} />}
      {dialogo?.tipo === "ingreso-paquete" && (
        <DialogoIngresoPaquete embarque={embarque} paquete={dialogo.paquete} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento(`Ingreso al stock del paquete ${dialogo.paquete.codigo} actualizado.`)} />
      )}
      {(dialogo?.tipo === "paquete-nuevo" || dialogo?.tipo === "paquete-editar") && (
        <ModalPaquete
          embarque={embarque}
          paquete={dialogo.tipo === "paquete-editar" ? dialogo.paquete : null}
          asignables={asignables}
          codigosExistentes={codigosPaquete}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onGuardado={(_e, creado) => tras({ tono: "exito", texto: creado ? "Paquete creado." : "Paquete actualizado." })}
        />
      )}
      {dialogo?.tipo === "agregar" && (
        <DialogoAsignar modo={{ tipo: "embarque", embarque }} opciones={opciones} viajes={viajes} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento(`Mercadería asignada al embarque ${embarque.codigo}.`)} />
      )}
      {dialogo?.tipo === "quitar" && (
        <DialogoQuitar embarque={embarque} asignaciones={dialogo.asignaciones} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento(`Mercadería quitada del embarque ${embarque.codigo}: quedó sin embarque.`)} />
      )}
      {dialogo?.tipo === "a-paquete" && <DialogoAPaquete embarque={embarque} asignaciones={dialogo.asignaciones} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento("Mercadería movida de paquete.")} />}
      {dialogo?.tipo === "programar-barrer" && (
        <DialogoProgramarBarrer embarque={embarque} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento("Lo al barrer quedó programado en sus paquetes.")} />
      )}
      {dialogo?.tipo === "pendientes" && (
        <DialogoPasarPendientes embarque={embarque} seleccionadas={dialogo.asignaciones} opciones={opciones} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento("Pendientes pasados a otro embarque.")} />
      )}
      {dialogo?.tipo === "mover-paquete" && (
        <DialogoMoverPaquete embarque={embarque} paquete={dialogo.paquete} opciones={opciones} onCerrar={cerrar} onRecargar={onRecargar} onAplicado={movimiento(`Paquete ${dialogo.paquete.codigo} pasado a otro embarque.`)} />
      )}
      {dialogo?.tipo === "cancelar-embarque" && (
        <DialogoCancelarAgrupador
          tipo="Embarque"
          codigo={embarque.codigo}
          revision={embarque.revision}
          llamar={(c) => cambiarEstadoEmbarque(embarque.id, c)}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onCancelado={() => tras({ tono: "exito", texto: `Embarque ${embarque.codigo} cancelado.` })}
        />
      )}
      {dialogo?.tipo === "cancelar-paquete" && (
        <DialogoCancelarAgrupador
          tipo="Paquete"
          codigo={dialogo.paquete.codigo}
          revision={embarque.revision}
          llamar={(c) => cancelarPaquete(dialogo.paquete.id, c)}
          onCerrar={cerrar}
          onRecargar={onRecargar}
          onCancelado={() => tras({ tono: "exito", texto: `Paquete ${dialogo.paquete.codigo} cancelado.` })}
        />
      )}
    </div>
  );
}
