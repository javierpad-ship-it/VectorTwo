"use client";

import { useState } from "react";
import { api, codigoDeError } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { AprobarCrecimientoValidado } from "@/lib/crecimientos/esquemas";
import { CLAVE_RESTO, type DetalleGeneroMundoApi, type RespuestaAprobarCrecimientoApi } from "@/lib/crecimientos/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRecurso } from "../use-recurso";
import { formatearFechaHora } from "../vista";
import { AprobarGM } from "./aprobar-gm";
import { GraficoGM } from "./grafico-gm";
import { ReferenciasGM } from "./referencias-gm";
import { TablaGM } from "./tabla-gm";
import { VersionesGM } from "./versiones-gm";
import {
  TEXTO_OBSOLETO,
  anioAplicacionDe,
  anioEnCursoDe,
  consultaApiGM,
  errorDeAprobarGM,
  formatearPctPlano,
  textoAprobadoOk,
  textoEstadoGM,
  textoLeyendaTiendas,
  tituloGM,
  type ModoGM,
} from "./vista";

const ID_TABLA = "tabla-anio-mes-gm";

/**
 * Presentación del detalle de un género × mundo (06d, §4.1): curva de venta (gráfico y tabla año × mes), «Cómo crece»,
 * «Aprobar» (solo HOMBRE, MUJER y el Resto) y versiones. No carga nada: `DetalleGM` la alimenta.
 */
export function DetalleGMVista({
  detalle,
  anio,
  proyeccionId,
  enTrabajo,
  ocupado,
  bloqueo,
  errorAprobar,
  exito,
  onCerrarError,
  onCerrarExito,
  onAprobar,
  onVolver,
  onIrAResto,
}: {
  detalle: DetalleGeneroMundoApi;
  anio: number;
  proyeccionId: string | null;
  enTrabajo: { id: string; nombre: string }[] | null;
  ocupado: boolean;
  bloqueo?: string | null;
  errorAprobar: string | null;
  exito: string | null;
  onCerrarError: () => void;
  onCerrarExito: () => void;
  onAprobar: (cuerpo: AprobarCrecimientoValidado) => void | Promise<void>;
  onVolver: () => void;
  onIrAResto: () => void;
}) {
  const [modo, setModo] = useState<ModoGM>("unidades");
  const titulo = tituloGM(detalle);
  const esResto = detalle.clave === CLAVE_RESTO;
  const anioEnCurso = anioEnCursoDe(detalle.series) ?? anio - 1;
  const v = detalle.vigente;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variante="fantasma" tamano="sm" onClick={onVolver}>
          ← Género × mundo
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-tinta">{titulo}</h2>
          {!detalle.mundo_activo && <Badge tono="neutro">mundo desactivado</Badge>}
          <Badge tono={!detalle.detallable ? "neutro" : detalle.estado === "aprobado" ? "exito" : "alerta"}>{detalle.estado === "obsoleto" && detalle.detallable ? "Obsoleto" : textoEstadoGM(detalle)}</Badge>
        </div>
        <p className="text-sm text-tinta-suave">
          {esResto
            ? `El Resto suma todos los géneros que no se aprueban por separado (distintos de HOMBRE y MUJER) y es el crecimiento de ${anio} que ellos siguen.`
            : `Curva de venta y crecimiento de ${anio} de este género × mundo, sobre las mismas tiendas.`}{" "}
          {v ? (
            <>
              Aprobado: <strong className="text-tinta">{formatearPctPlano(v.pct)}</strong> (v{v.version}, {v.por_nombre ?? "—"}, {formatearFechaHora(v.aprobada_at)}).
            </>
          ) : detalle.detallable ? (
            "Todavía sin crecimiento aprobado."
          ) : null}
        </p>
        {detalle.estado === "obsoleto" && detalle.motivo_obsoleto && (
          <Alert tono="info">
            Obsoleto: {TEXTO_OBSOLETO[detalle.motivo_obsoleto]}. El crecimiento aprobado sigue aplicándose; revisa las cifras y, si hace falta, aprueba una versión nueva.
          </Alert>
        )}
      </div>

      {exito && (
        <Alert tono="exito" onCerrar={onCerrarExito}>
          {exito}
        </Alert>
      )}

      {detalle.avisos.map((a) => (
        <Alert key={a.codigo} tono="info">
          <span className="block">{a.mensaje}</span>
          {a.detalle && a.detalle.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {a.detalle.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </Alert>
      ))}

      <Card titulo="Curva de venta" descripcion="La venta mensual de las mismas tiendas, un año contra otro. El año en curso se completa con la proyección de referencia.">
        <div className="space-y-4">
          <p className="text-sm text-tinta">{textoLeyendaTiendas(detalle, anioEnCurso)}</p>
          {detalle.tiendas.fuera.length > 0 && (
            <details className="text-xs text-tinta-suave">
              <summary className="cursor-pointer">{detalle.tiendas.fuera.length === 1 ? "1 tienda con venta quedó fuera de la comparación" : `${detalle.tiendas.fuera.length} tiendas con venta quedaron fuera de la comparación`}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {detalle.tiendas.fuera.map((t) => (
                  <li key={t.tienda_id}>
                    {t.tienda_id}: {t.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <GraficoGM detalle={detalle} modo={modo} onModo={setModo} idTabla={ID_TABLA} />
          <TablaGM id={ID_TABLA} detalle={detalle} modo={modo} nombreArchivo={`curva-${esResto ? "resto" : titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, "-")}.csv`} />
        </div>
      </Card>

      <Card titulo="Cómo crece" descripcion={`Lo que dicen las cifras para decidir el crecimiento bruto de ${anio}. Solo informan: tú decides el %.`}>
        <ReferenciasGM detalle={detalle} />
      </Card>

      {detalle.detallable ? (
        <AprobarGM
          key={`${detalle.huella_datos}|${v?.version ?? 0}`}
          detalle={detalle}
          anio={anio}
          proyeccionId={proyeccionId}
          enTrabajo={enTrabajo}
          ocupado={ocupado}
          bloqueo={bloqueo}
          error={errorAprobar}
          onCerrarError={onCerrarError}
          onAprobar={onAprobar}
        />
      ) : (
        <Card titulo={`Aprobar ${anio}`}>
          <div className="space-y-2 text-sm">
            <p className="text-tinta">
              {detalle.genero} no se aprueba por separado: sigue al <strong>Resto</strong>. Puedes analizar su curva aquí, pero el crecimiento de {anio} se aprueba una sola vez en el Resto.
            </p>
            <Button variante="secundario" tamano="sm" onClick={onIrAResto}>
              Ir al Resto
            </Button>
          </div>
        </Card>
      )}

      <VersionesGM versiones={detalle.versiones} anio={anio} />
    </div>
  );
}

/**
 * Detalle de un género × mundo (o del Resto): carga `GET /api/curvas/genero-mundo/[clave]` y aprueba con el `POST`. Las
 * respuestas `409` (`datos_cambiados`, `vigente_cambiada`) recargan el detalle y muestran su mensaje; `sin_cambio` dice
 * contra qué versión coincide. Tras aprobar se recarga el detalle y se avisa a la lista (`onCambio`).
 */
export function DetalleGM({
  clave,
  anioUrl,
  proyeccionUrl,
  proyeccionId,
  enTrabajo,
  referenciaCargando,
  onVolver,
  onIrAResto,
  onCambio,
}: {
  clave: string;
  anioUrl: number | null;
  proyeccionUrl: string | null;
  /** La proyección de referencia que usó la lista (la de la URL o la que eligió el servidor). */
  proyeccionId: string | null;
  enTrabajo: { id: string; nombre: string }[] | null;
  /** La lista aún carga: no se sabe qué proyección de referencia se usa. */
  referenciaCargando: boolean;
  onVolver: () => void;
  onIrAResto: () => void;
  onCambio: () => Promise<void> | void;
}) {
  const recurso = useRecurso<DetalleGeneroMundoApi>(`/api/curvas/genero-mundo/${clave}${consultaApiGM({ anio: anioUrl, proyeccion: proyeccionUrl })}`);
  const [ocupado, setOcupado] = useState(false);
  const [errorAprobar, setErrorAprobar] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const detalle = recurso.datos;

  async function aprobar(cuerpo: AprobarCrecimientoValidado) {
    if (!detalle) return;
    setOcupado(true);
    setErrorAprobar(null);
    setExito(null);
    try {
      const r = await api.post<RespuestaAprobarCrecimientoApi>(`/api/curvas/genero-mundo/${clave}`, cuerpo);
      setExito(textoAprobadoOk(tituloGM(detalle), r.vigente, cuerpo.anio, r.proyecciones_desactualizadas));
      await Promise.all([recurso.recargar(), Promise.resolve(onCambio())]);
    } catch (e) {
      const r = errorDeAprobarGM(codigoDeError(e), mensajeError(e), detalle.vigente);
      setErrorAprobar(r.mensaje);
      if (r.recargar) await recurso.recargar();
    } finally {
      setOcupado(false);
    }
  }

  if (!detalle) {
    return (
      <div className="space-y-4">
        <Button variante="fantasma" tamano="sm" onClick={onVolver}>
          ← Género × mundo
        </Button>
        {recurso.error && <Alert onCerrar={() => recurso.setError(null)}>No se pudo cargar el detalle: {recurso.error}</Alert>}
        <Card titulo={clave === CLAVE_RESTO ? "Resto" : "Género × mundo"} descripcion={recurso.cargando ? "Cargando…" : undefined}>
          <p className="text-sm text-tinta-suave">{recurso.cargando ? "Calculando la curva y las referencias. La primera carga puede tardar unos segundos." : "No hay datos para mostrar."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {recurso.error && <Alert onCerrar={() => recurso.setError(null)}>No se pudo actualizar el detalle: {recurso.error}</Alert>}
      <DetalleGMVista
        detalle={detalle}
        anio={anioAplicacionDe(detalle)}
        proyeccionId={proyeccionId}
        enTrabajo={enTrabajo}
        ocupado={ocupado || recurso.cargando}
        bloqueo={referenciaCargando ? "Espera: se está leyendo la proyección de referencia." : null}
        errorAprobar={errorAprobar}
        exito={exito}
        onCerrarError={() => setErrorAprobar(null)}
        onCerrarExito={() => setExito(null)}
        onAprobar={aprobar}
        onVolver={onVolver}
        onIrAResto={onIrAResto}
      />
    </div>
  );
}
