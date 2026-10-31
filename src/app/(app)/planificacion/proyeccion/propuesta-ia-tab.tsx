"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { hojasPropuestaIa } from "@/lib/ia/excel";
import type { CorridaApi, GMIaDetalleApi, GMIaResumenApi, ServicioIaApi } from "@/lib/ia/tipos-api";
import type { IndiceLineaApi, ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BotonEnlace, Cargando, NUM } from "./comunes";
import { descargarLibro } from "./descarga-libro";
import { GenerarIaModal } from "./generar-ia-modal";
import { GmIaDetalle, type DestinoLinea } from "./gm-ia-detalle";
import {
  ESTADO_GM,
  NOTA_CERRAR_A_MANO,
  claveGmValida,
  gmPendiente,
  lineaServicioEncendido,
  llevaAFactores,
  metaProvisional,
  nivelEsfuerzo,
  nombreGm,
  ordenarGms,
  permiteGenerar,
  textoAbsorcionGm,
  textoCorridaEnCurso,
  textoEstadoGm,
  textoFijas,
  textoGenerada,
  textoMeta,
  textoPrerrequisito,
  textoServicioApagado,
  type EstadoIaProyeccionApi,
  type SeleccionGms,
} from "./propuesta-ia-vista";
import { useAccion } from "./use-proyeccion";
import { rutaIa, useEstadoIa } from "./use-propuesta-ia";
import { formatearPct, unidades } from "./vista";

const RUTA_ADMIN_IA = "/administracion/ia";

/** Cabecera de servicio (§4.1): encendida con proveedor y modelo vigentes, o apagada con el motivo y sin ofrecer generar. */
export function CabeceraServicioIa({ servicio, anioSiguiente, esAdmin }: { servicio: ServicioIaApi; anioSiguiente: number; esAdmin: boolean }) {
  const apagada = textoServicioApagado(servicio);
  return (
    <div className="space-y-2">
      {apagada ? (
        <Alert tono="alerta">
          <span className="block font-medium">IA apagada</span>
          <span className="block">{apagada}</span>
          {(servicio.proveedor || servicio.modelo) && (
            <span className="mt-1 block text-xs">
              Proveedor del servidor: {servicio.proveedor ?? "—"} · modelo en la configuración: {servicio.modelo ?? "—"}
            </span>
          )}
        </Alert>
      ) : (
        <Alert tono="exito">{lineaServicioEncendido(servicio, anioSiguiente)}</Alert>
      )}
      {esAdmin && (
        <p className="text-sm">
          <Link href={RUTA_ADMIN_IA} className="font-medium text-marca-oscura underline underline-offset-2 hover:text-marca">
            Administración → Motor de IA
          </Link>
        </p>
      )}
      <Alert tono="info">{NOTA_CERRAR_A_MANO}</Alert>
    </div>
  );
}

/** Lo que bloquea y lo que avisa antes de generar. */
export function PrerrequisitosIa({ estado, onIrAFactores }: { estado: EstadoIaProyeccionApi; onIrAFactores: () => void }) {
  const { bloquea, avisa } = estado.prerrequisitos;
  if (bloquea.length === 0 && avisa.length === 0) return null;
  return (
    <div className="space-y-2">
      {bloquea.map((m) => (
        <Alert key={`b-${m}`} tono="alerta">
          <span className="block">No se puede generar: {textoPrerrequisito(m, estado.gms).replace(/^[A-Z]/, (c) => c.toLowerCase())}</span>
          {llevaAFactores(m) && (
            <span className="mt-1 block">
              <BotonEnlace onClick={onIrAFactores}>Ir a Factores del Niño</BotonEnlace>
            </span>
          )}
        </Alert>
      ))}
      {avisa.map((m) => (
        <Alert key={`a-${m}`} tono="info">
          {textoPrerrequisito(m, estado.gms)}
        </Alert>
      ))}
    </div>
  );
}

/** La tabla de GM (HOMBRE, MUJER y los del Resto agrupados al final). */
export function TablaGmIa({
  gms,
  onVer,
  onReintentar,
  motivoSinDetalle = null,
}: {
  gms: readonly GMIaResumenApi[];
  onVer: (clave: string) => void;
  onReintentar?: (clave: string) => void;
  /** Con la IA apagada el servidor no entrega el detalle del GM (409): «Ver» queda deshabilitado y este es el motivo. */
  motivoSinDetalle?: string | null;
}) {
  const filas = useMemo(() => ordenarGms(gms), [gms]);
  const columnas: Columna<GMIaResumenApi>[] = [
    {
      clave: "gm",
      titulo: "GM",
      render: (g) => (
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {nombreGm(g)}
          {g.es_resto && <Badge tono="neutro">Resto</Badge>}
        </span>
      ),
    },
    {
      clave: "meta",
      titulo: "Meta",
      render: (g) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs tabular-nums">{textoMeta(g.meta)}</span>
          {metaProvisional(g.meta) && <Badge tono="alerta">provisional</Badge>}
        </span>
      ),
    },
    { clave: "fijas", titulo: "Fijas", render: (g) => <span className="font-mono text-xs tabular-nums">{textoFijas(g.meta)}</span> },
    { clave: "libre", titulo: "Libre", className: NUM, render: (g) => unidades(g.meta_libre) },
    { clave: "natural", titulo: "Natural IA", className: NUM, render: (g) => unidades(g.natural_libres) },
    {
      clave: "esfuerzo",
      titulo: "Esfuerzo",
      render: (g) => {
        const n = nivelEsfuerzo(g.esfuerzo_pct);
        if (n.nivel === "sin_dato") return <span className="text-tinta-suave">—</span>;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`${NUM} ${n.nivel === "muy_exigente" ? "font-semibold" : ""}`}>{formatearPct(g.esfuerzo_pct, 1)}</span>
            {n.nivel !== "normal" && <Badge tono={n.tono}>{n.texto}</Badge>}
          </span>
        );
      },
    },
    { clave: "forzadas", titulo: "Forzadas / ceden", className: NUM, render: (g) => (g.propuesta ? `${g.filas_forzadas} / ${g.filas_que_ceden}` : "—") },
    {
      clave: "absorbido",
      titulo: "Absorbido",
      render: (g) => {
        const a = textoAbsorcionGm(g.absorcion);
        return a ? <span className={`block max-w-48 text-xs ${a.alerta ? "text-alerta" : ""}`}>{a.texto}</span> : <span className="text-tinta-suave">—</span>;
      },
    },
    { clave: "sin_decidir", titulo: "Año en curso sin decidir", className: NUM, render: (g) => unidades(g.filas_y_sin_decidir) },
    {
      clave: "estado",
      titulo: "Estado",
      render: (g) => (
        <div className="space-y-1">
          <Badge tono={ESTADO_GM[g.estado]?.tono ?? "neutro"}>{textoEstadoGm(g)}</Badge>
          {g.configuracion_cambiada && (
            <p className="text-xs text-tinta-suave" title="El modelo o el prompt vigentes no son los que generaron esta propuesta">
              configuración distinta
            </p>
          )}
          {g.estado === "fallida" && onReintentar && <BotonEnlace onClick={() => onReintentar(g.gm_clave)}>Reintentar este GM</BotonEnlace>}
        </div>
      ),
    },
    { clave: "generada", titulo: "Generada", render: (g) => <span className="block max-w-56 text-xs text-tinta-suave">{textoGenerada(g.propuesta)}</span> },
    {
      clave: "ver",
      titulo: "",
      className: "whitespace-nowrap",
      render: (g) => (
        <Button
          variante="secundario"
          tamano="sm"
          aria-label={`Ver ${nombreGm(g)}`}
          disabled={motivoSinDetalle !== null}
          title={motivoSinDetalle ? `El detalle no está disponible con la IA apagada. ${motivoSinDetalle}` : undefined}
          onClick={() => onVer(g.gm_clave)}
        >
          Ver
        </Button>
      ),
    },
  ];
  return (
    <section aria-label="Propuesta de la IA por género y mundo">
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(g) => g.gm_clave}
        claseFila={(g) => (g.estado === "meta_movida" || g.estado === "desactualizada" || g.estado === "fallida" ? "bg-alerta-suave/30" : undefined)}
        vacio="Ningún género · mundo con filas base en el año siguiente."
      />
    </section>
  );
}

/** Lo que se ve con el estado ya leído: cabecera, prerrequisitos, controles y tabla. */
export function VistaPropuestaIa({
  estado,
  anioSiguiente,
  esAdmin,
  bloqueada,
  corridaPropia = false,
  generando = false,
  excelOcupado = false,
  onGenerar,
  onVer,
  onExcel,
  onCancelarCorrida,
  onIrAFactores,
}: {
  estado: EstadoIaProyeccionApi;
  anioSiguiente: number;
  esAdmin: boolean;
  bloqueada: boolean;
  corridaPropia?: boolean;
  generando?: boolean;
  excelOcupado?: boolean;
  onGenerar: (seleccion: SeleccionGms) => void;
  onVer: (clave: string) => void;
  onExcel: () => void;
  onCancelarCorrida: (c: CorridaApi) => void;
  onIrAFactores: () => void;
}) {
  const permiso = permiteGenerar(estado, bloqueada);
  const motivoApagada = estado.servicio.disponible ? null : (textoServicioApagado(estado.servicio) ?? "la IA está apagada");
  const pendientes = estado.gms.filter(gmPendiente).length;
  const corrida = estado.corrida_en_curso;
  return (
    <div className="space-y-4">
      <CabeceraServicioIa servicio={estado.servicio} anioSiguiente={anioSiguiente} esAdmin={esAdmin} />
      <PrerrequisitosIa estado={estado} onIrAFactores={onIrAFactores} />
      {corrida && !corridaPropia && (
        <Alert tono="info">
          <span className="block">{textoCorridaEnCurso(corrida)}</span>
          <span className="mt-1 block">
            <BotonEnlace onClick={() => onCancelarCorrida(corrida)}>Cancelar esa corrida</BotonEnlace>
          </span>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">
          {estado.gms.length} GM · {pendientes} pendientes o desactualizados
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* El Excel arma su hoja FILAS con el detalle de cada GM, que el servidor no entrega con la IA apagada. */}
          <Button
            variante="secundario"
            disabled={excelOcupado || motivoApagada !== null || !estado.gms.some((g) => g.propuesta)}
            title={motivoApagada ? `El Excel necesita el detalle de cada GM, que no está disponible con la IA apagada. ${motivoApagada}` : undefined}
            onClick={onExcel}
          >
            {excelOcupado ? "Preparando Excel…" : "Descargar Excel"}
          </Button>
          {/* Con el servicio apagado no se ofrece generar: el motivo ya está arriba. */}
          {estado.servicio.disponible && (
            <Button disabled={!permiso.ok || generando} title={permiso.motivo ?? undefined} onClick={() => onGenerar("pendientes")}>
              Generar propuesta IA
            </Button>
          )}
        </div>
      </div>

      <TablaGmIa gms={estado.gms} onVer={onVer} motivoSinDetalle={motivoApagada} onReintentar={estado.servicio.disponible && permiso.ok ? (clave) => onGenerar([clave]) : undefined} />
    </div>
  );
}

/**
 * Pestaña «Propuesta IA» (ficha 07e, §4.1; solo admin y planner: el comprador no entra a la proyección y la API le responde 403). Lee
 * `GET …/ia`, muestra el servicio, los prerrequisitos y una fila por género × mundo con la meta, el natural de la IA, el esfuerzo, lo
 * absorbido y el estado; «Ver» abre el detalle del GM (`?gm_ia=`). «Generar propuesta IA» abre el modal que conduce la corrida. La
 * propuesta del método no cambia: aquí solo se mira y se pide la de la IA; aceptarla es fila a fila en Por línea.
 */
export function PropuestaIaTab({
  proyeccion,
  indice,
  gmClave,
  esAdmin,
  bloqueada,
  onGm,
  onIrALinea,
  onIrAFactores,
}: {
  proyeccion: ProyeccionApi;
  indice: readonly IndiceLineaApi[];
  gmClave: string | null;
  esAdmin: boolean;
  bloqueada: boolean;
  onGm: (clave: string | null) => void;
  onIrALinea: (d: DestinoLinea) => void;
  onIrAFactores: () => void;
}) {
  const lectura = useEstadoIa(proyeccion.id);
  const estado = lectura.datos;
  const [dialogo, setDialogo] = useState<{ seleccion: SeleccionGms } | null>(null);
  const excel = useAccion();
  const cancelar = useAccion();

  // Si la proyección se recalcula, el estado de la IA (prerrequisitos, metas) se lee de nuevo.
  const recargarLectura = lectura.recargar;
  const calculadoAt = proyeccion.calculado_at;
  const ultimoCalculo = useRef(calculadoAt);
  useEffect(() => {
    if (ultimoCalculo.current === calculadoAt) return;
    ultimoCalculo.current = calculadoAt;
    void recargarLectura();
  }, [calculadoAt, recargarLectura]);

  async function descargarExcel() {
    if (!estado) return;
    await excel.ejecutar(async () => {
      // El detalle de cada GM con propuesta, de a cuatro en cuatro: la hoja FILAS necesita las filas de todos.
      const conPropuesta = ordenarGms(estado.gms).filter((g) => g.propuesta);
      const detalles: GMIaDetalleApi[] = [];
      for (let i = 0; i < conPropuesta.length; i += 4) {
        const lote = await Promise.all(conPropuesta.slice(i, i + 4).map((g) => api.get<GMIaDetalleApi>(`${rutaIa(proyeccion.id)}/gm/${encodeURIComponent(g.gm_clave)}`)));
        detalles.push(...lote);
      }
      const hojas = hojasPropuestaIa({ gms: ordenarGms(estado.gms), detalles, anioEnCurso: proyeccion.anio_en_curso });
      await descargarLibro({ GM: hojas.GM, FILAS: hojas.FILAS }, `propuesta-ia-${proyeccion.anio_siguiente}.xlsx`);
    });
  }

  async function cancelarCorrida(c: CorridaApi) {
    if (!confirm("¿Cancelar la corrida en curso? Los GM ya generados se conservan; los pendientes no se generan.")) return;
    const r = await cancelar.ejecutar(() => api.post<CorridaApi>(`${rutaIa(proyeccion.id)}/corridas/${c.id}/terminar`, { cancelar: true }));
    if (r.ok) await lectura.recargar();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta-suave">
        La meta de {proyeccion.anio_siguiente} por género × mundo se aprueba en Curvas. La IA hace una primera propuesta razonada de cada fila (su natural y cuánto se aparta para cumplir la meta); tú decides, fila por fila, en la pestaña Por línea.
      </p>

      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {excel.error && <AlertaError error={excel.error} onCerrar={excel.limpiar} />}
      {cancelar.error && <AlertaError error={cancelar.error} onCerrar={cancelar.limpiar} onRecargar={() => void lectura.recargar()} />}
      {lectura.cargando && !estado && <Cargando texto="Leyendo el estado de la IA…" />}

      {/* Con la IA apagada no se abre el detalle (el servidor responde 409), ni siquiera por un enlace con `?gm_ia=`: se ve la tabla con el motivo. */}
      {estado && estado.servicio.disponible && gmClave !== null && claveGmValida(gmClave) ? (
        <GmIaDetalle proyeccionId={proyeccion.id} anioEnCurso={proyeccion.anio_en_curso} clave={gmClave} indice={indice} onVolver={() => onGm(null)} onIrALinea={onIrALinea} />
      ) : (
        estado && (
          <VistaPropuestaIa
            estado={estado}
            anioSiguiente={proyeccion.anio_siguiente}
            esAdmin={esAdmin}
            bloqueada={bloqueada}
            generando={dialogo !== null}
            excelOcupado={excel.ocupado}
            onGenerar={(seleccion) => setDialogo({ seleccion })}
            onVer={(clave) => onGm(clave)}
            onExcel={() => void descargarExcel()}
            onCancelarCorrida={(c) => void cancelarCorrida(c)}
            onIrAFactores={onIrAFactores}
          />
        )
      )}

      {dialogo && estado && (
        <GenerarIaModal
          proyeccionId={proyeccion.id}
          estado={estado}
          seleccionInicial={dialogo.seleccion}
          onCerrar={() => setDialogo(null)}
          onTermino={() => void lectura.recargar()}
        />
      )}
    </div>
  );
}
