"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { CODIGOS_CIERRE_BLOQUEADO_NINO, type ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError } from "./comunes";
import { rutaProyeccion, useAccion } from "./use-proyeccion";
import {
  cierreExigeRecalcular,
  crecimientosSinAprobarDe,
  enlaceCrecimientoGeneroMundo,
  enlaceDetalleGeneroMundo,
  leerCrecimientosSinAprobar,
  lineasDeCierre,
  listaSinDecidir,
  listaTiendasSinDecidir,
  MAX_SIN_DECIDIR,
  motivosCierreBloqueado,
  RUTA_APROBAR_CRECIMIENTOS,
  textoFaltanCrecimientos,
  textoMotivoDesactualizada,
  textoReaprobarUno,
  type GrupoSinDecidir,
} from "./vista";
import { formatearNumero } from "@/lib/formato";

/** Una lista de filas sin decidir (hasta `MAX_SIN_DECIDIR`, con el total y una pista de dónde decidirlas). */
export function GrupoLista({ titulo, grupo, pista }: { titulo: string; grupo: GrupoSinDecidir; pista: string }) {
  const resto = grupo.total - grupo.lineas.length;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {grupo.total > MAX_SIN_DECIDIR ? `${titulo}: primeras ${MAX_SIN_DECIDIR} de ${formatearNumero(grupo.total)}` : `${titulo} (${formatearNumero(grupo.total)})`}
      </p>
      <ul className="max-h-56 list-disc space-y-0.5 overflow-y-auto rounded-md border border-borde bg-fondo py-2 pl-7 pr-3 text-xs">
        {grupo.lineas.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {resto > 0 && <p className="text-xs text-tinta-suave">… y {formatearNumero(resto)} más.</p>}
      <p className="text-xs text-tinta-suave">{pista}</p>
    </div>
  );
}

/**
 * Cerrar la proyección (ficha 07, paso 7). Resume filas decididas y sin decidir por año, cola larga que se cerrará con la
 * propuesta y avisos, y pide confirmación. El servidor bloquea si queda sin decidir una fila con propuesta mayor o igual
 * al umbral de cola larga, o una tienda nueva con venta esperada; si la proyección está desactualizada, ofrece cerrar de
 * todos modos (`?forzar=1`, que solo salta ese aviso). Al cerrar, la cerrada anterior del mismo año pasa a archivada y
 * una cerrada es solo lectura: nunca se vuelve a repartir. Desde 0.12.1 (06d) tampoco se cierra sin los crecimientos aprobados de HOMBRE y
 * MUJER por mundo y el Resto: ese motivo bloquea sin excepción (no hay «Cerrar de todos modos») y manda a Curvas → Crecimiento por género × mundo.
 * Desde 0.14.0 (06e) tampoco se cierra, ni forzando, con 2027 marcado como año del Niño, con un factor del Niño de 2026 faltante, desfasado o sin
 * confirmar, con un factor o una agrupación que cambió después de calcular, ni con crecimientos de antes de 0.14.0 por reaprobar: el modal lista cada
 * motivo con su enlace (Factores del Niño, Curvas o la pantalla del GM) o con «Recalcular ahora».
 */
export function CerrarModal({ proyeccion, onCerrar, onCerrada, onRecalcular }: { proyeccion: ProyeccionApi; onCerrar: () => void; onCerrada: (p: ProyeccionApi) => Promise<void> | void; onRecalcular: () => void }) {
  const [nota, setNota] = useState("");
  const [forzar, setForzar] = useState(false);
  const accion = useAccion();
  const lineas = lineasDeCierre(proyeccion);
  const desactualizada = proyeccion.desactualizada.length > 0;
  // El método viejo y los crecimientos sin aplicar no se saltan con «cerrar de todos modos»: hay que recalcular.
  const exigeRecalcular = cierreExigeRecalcular(proyeccion);
  const sinDecidir = listaSinDecidir(accion.error?.detalle);
  const tiendasSinDecidir = listaTiendasSinDecidir(accion.error?.detalle, proyeccion.bloques);
  // Lo que falta aprobar: lo que dijo el servidor al rechazar o, antes de intentarlo, lo que ya trae la proyección.
  const rechazoSinAprobar = accion.error?.codigo === "crecimientos_sin_aprobar" ? leerCrecimientosSinAprobar(accion.error.detalle) : null;
  const sinAprobar = rechazoSinAprobar ?? crecimientosSinAprobarDe(proyeccion);
  const bloqueadoSinAprobar = sinAprobar !== null || accion.error?.codigo === "crecimientos_sin_aprobar";
  const faltaAprobar = sinAprobar === null || sinAprobar.faltan.length > 0 || sinAprobar.resto_provisional;
  const reaprobar = sinAprobar?.reaprobar ?? [];
  // El Niño de `Y`: lo que trae la proyección (`cierre_bloqueado_por`) y, si el servidor acaba de rechazar con uno de esos códigos, ese rechazo.
  const rechazo = accion.error ? { codigo: accion.error.codigo, mensaje: accion.error.mensaje } : null;
  const motivosNino = motivosCierreBloqueado(proyeccion, rechazo);
  const rechazoDelNino = accion.error?.codigo ? (CODIGOS_CIERRE_BLOQUEADO_NINO as readonly string[]).includes(accion.error.codigo) : false;

  async function cerrar() {
    const r = await accion.ejecutar(() => api.post<ProyeccionApi>(`${rutaProyeccion(proyeccion.id)}/cerrar${forzar ? "?forzar=1" : ""}`, { nota: nota.trim() === "" ? null : nota.trim() }));
    if (!r.ok) return;
    await onCerrada(r.valor);
    onCerrar();
  }

  return (
    <Modal
      titulo={`Cerrar ${proyeccion.nombre}`}
      descripcion={`La proyección cerrada es el único insumo de volumen del flujo de mercadería. La cerrada anterior de ${proyeccion.anio_en_curso} pasará a archivada.`}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" disabled={accion.ocupado} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button disabled={accion.ocupado || exigeRecalcular || bloqueadoSinAprobar || motivosNino.length > 0 || (desactualizada && !forzar)} onClick={() => void cerrar()}>
            {accion.ocupado ? "Cerrando…" : "Cerrar proyección"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {accion.error && !rechazoDelNino && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={onRecalcular} />}
        {motivosNino.length > 0 && (
          <Alert tono="alerta">
            <span className="block font-medium">No se puede cerrar: el Niño de {proyeccion.anio_en_curso} no está resuelto.</span>
            <ul className="mt-1 list-disc space-y-1.5 pl-5 text-sm">
              {motivosNino.map((m) => (
                <li key={m.codigo}>
                  {m.mensaje}
                  {m.enlace && (
                    <>
                      {" "}
                      <Link href={m.enlace.href} onClick={onCerrar} className="font-medium underline underline-offset-2">
                        {m.enlace.texto}
                      </Link>
                    </>
                  )}
                  {m.recalcular && (
                    <>
                      {" "}
                      <button type="button" onClick={onRecalcular} disabled={accion.ocupado} className="font-medium underline underline-offset-2 disabled:opacity-50">
                        Recalcular ahora
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <span className="mt-1 block text-xs">Estos motivos no se pueden saltar con «Cerrar de todos modos».</span>
          </Alert>
        )}
        {reaprobar.length > 0 && (
          <Alert tono="alerta">
            <span className="block font-medium">No se puede cerrar: hay crecimientos por reaprobar.</span>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {reaprobar.map((r) => (
                <li key={r.clave}>
                  {textoReaprobarUno(r, proyeccion.anio_en_curso)}.{" "}
                  <Link href={enlaceDetalleGeneroMundo(proyeccion.anio_siguiente, proyeccion.id, r.clave)} onClick={onCerrar} className="font-medium underline underline-offset-2">
                    Reaprobar {r.nombre}
                  </Link>
                </li>
              ))}
            </ul>
            <span className="mt-1 block text-xs">Reaprobar conserva el total del GM y redistribuye entre sus líneas; después recalcula la proyección. Este motivo no se puede saltar.</span>
          </Alert>
        )}
        {bloqueadoSinAprobar && faltaAprobar && (
          <Alert tono="alerta">
            <span className="block font-medium">No se puede cerrar: faltan crecimientos aprobados.</span>
            {sinAprobar ? (
              <span className="mt-1 block">{textoFaltanCrecimientos(sinAprobar, proyeccion.anio_siguiente)}.</span>
            ) : (
              <span className="mt-1 block">Faltan crecimientos de {proyeccion.anio_siguiente} por aprobar.</span>
            )}
            {sinAprobar && sinAprobar.faltan.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {sinAprobar.faltan.map((f) => (
                  <li key={f.clave}>{f.nombre}</li>
                ))}
                {sinAprobar.resto_provisional && <li>Resto (provisional)</li>}
              </ul>
            )}
            <span className="mt-1 block text-xs">Apruébalos en {RUTA_APROBAR_CRECIMIENTOS}. Este motivo no se puede saltar.</span>
            <span className="mt-1 block">
              <Link href={enlaceCrecimientoGeneroMundo(proyeccion.anio_siguiente, proyeccion.id)} className="font-medium underline underline-offset-2">
                Ir a Crecimiento por género × mundo
              </Link>
            </span>
          </Alert>
        )}
        {sinDecidir && sinDecidir.umbral.total > 0 && (
          <GrupoLista
            titulo={`Filas por decidir con propuesta de ${proyeccion.parametros.umbral_cola_larga} unidades o más`}
            grupo={sinDecidir.umbral}
            pista="Decídelas en Por línea; la matriz con «Solo sin proyectar» ayuda a encontrarlas."
          />
        )}
        {sinDecidir && sinDecidir.revision.total > 0 && (
          <GrupoLista
            titulo="Filas para revisión por cola larga con quiebres de stock"
            grupo={sinDecidir.revision}
            pista="Su propuesta es la demanda corregida por disponibilidad; compárala con el avance normal en el detalle de la fila. En la matriz, el chip «Para revisión» las encuentra."
          />
        )}
        {tiendasSinDecidir && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Tiendas nuevas por decidir ({tiendasSinDecidir.length}):</p>
            <ul className="list-disc space-y-0.5 pl-7 text-xs">
              {tiendasSinDecidir.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="text-sm text-tinta-suave">
          Se bloquea si queda sin decidir, en cualquiera de los dos años, una fila con propuesta mayor o igual a {proyeccion.parametros.umbral_cola_larga} unidades, una fila para revisión (cola larga con quiebres de stock) o una tienda nueva con venta esperada. Lo demás (la cola larga) se cierra con la propuesta y queda marcado.
          Tampoco se cierra, ni forzando, si {proyeccion.anio_siguiente} está marcado como año del Niño, si el factor del Niño de {proyeccion.anio_en_curso} falta, está desfasado o sin confirmar, o si hay un crecimiento de antes de 0.14.0 por reaprobar.
          Una proyección cerrada es solo lectura: para seguir, se copia.
        </p>
        {desactualizada && (
          <Alert tono="alerta">
            <span className="block">La proyección está desactualizada: {proyeccion.desactualizada.map((m) => textoMotivoDesactualizada(m, proyeccion.anio_en_curso)).join("; ")}. Lo recomendable es recalcular antes de cerrar.</span>
            {exigeRecalcular ? (
              <span className="mt-2 block text-sm">
                Hay que recalcular antes de cerrar: este motivo no se puede saltar.{" "}
                <button type="button" onClick={onRecalcular} disabled={accion.ocupado} className="font-medium underline underline-offset-2 disabled:opacity-50">
                  Recalcular ahora
                </button>
              </span>
            ) : (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <Checkbox checked={forzar} onChange={setForzar} label="Cerrar de todos modos" />
                Cerrar de todos modos, con los datos con que se calculó
              </label>
            )}
          </Alert>
        )}
        <Field label="Nota (opcional)" hint="Hasta 500 caracteres. Queda guardada con la proyección cerrada.">
          <Input value={nota} maxLength={500} disabled={accion.ocupado} onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
