"use client";

import { useMemo, useState } from "react";
import type { DetalleFotoApi, ModeloCurva, VersionAgrupacionApi, VersionesAgrupacionApi } from "@/lib/curvas/tipos-api";
import { formatearDecimal } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { GraficoCurvas } from "@/components/curvas/grafico-curvas";
import { MiniCurva } from "@/components/curvas/mini-curva";
import { CandidatasTabla } from "./candidatas-tabla";
import { ComparadorCurvas } from "./comparador-curvas";
import { TablaAnioMes } from "./tabla-anio-mes";
import { lineasMedidaEnMuestra } from "./curva-usuario-vista";
import { parametrosDistintos } from "./trabajo-vista";
import { useRecurso } from "./use-recurso";
import {
  compararCurvas,
  esModeloCurva,
  etiquetaAprobada,
  etiquetaPropuesta,
  formatearFechaHora,
  modeloConNombre,
  motivoAnioSinDatos,
  textoEatConRuido,
  textoPartida,
  textoAnio,
} from "./vista";

const ESTADO_VERSION = {
  vigente: { texto: "vigente", tono: "exito" },
  reemplazada: { texto: "reemplazada", tono: "neutro" },
  retirada: { texto: "retirada", tono: "alerta" },
} as const;

/**
 * Historial de la agrupación: cada versión con su modelo, fecha, quién, nota y mini curva; «Ver foto» abre
 * el detalle congelado de esa aprobación y «Retirar la vigente» (con `confirm`) deja la agrupación sin curva.
 */
export function VersionesPanel({
  versiones,
  ocupado,
  puedeRetirar,
  onVerFoto,
  onRetirar,
}: {
  versiones: { datos: VersionesAgrupacionApi | null; cargando: boolean; error: string | null; setError: (e: string | null) => void };
  ocupado: boolean;
  puedeRetirar: boolean;
  onVerFoto: (v: VersionAgrupacionApi) => void;
  onRetirar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const lista = versiones.datos?.versiones ?? [];
  const resumen = lista
    .slice(0, 3)
    .map((v) => `v${v.version} ${ESTADO_VERSION[v.estado].texto} · ${v.modelo}`)
    .join("   ");

  return (
    <Card
      titulo={`Versiones${versiones.datos ? ` (${lista.length})` : ""}`}
      descripcion="Cada aprobación guarda una foto de los datos y parámetros de ese momento."
      acciones={
        <div className="flex flex-wrap justify-end gap-2">
          {puedeRetirar && (
            <Button variante="peligro" tamano="sm" onClick={onRetirar} disabled={ocupado}>
              Retirar la vigente
            </Button>
          )}
          <Button variante="fantasma" tamano="sm" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
            {abierto ? "Ocultar" : "Mostrar"}
          </Button>
        </div>
      }
    >
      {versiones.error && <Alert onCerrar={() => versiones.setError(null)}>No se pudieron leer las versiones: {versiones.error}</Alert>}
      {!abierto ? (
        <p className="text-sm text-tinta-suave">{versiones.cargando && !versiones.datos ? "Cargando…" : lista.length === 0 ? "Todavía no hay versiones aprobadas." : resumen}</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía no hay versiones aprobadas.</p>
      ) : (
        <ul className="divide-y divide-borde" aria-label="Versiones de la curva">
          {lista.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3 text-sm">
              <div className="min-w-56 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-tinta">
                  <strong>v{v.version}</strong>
                  <Badge tono={ESTADO_VERSION[v.estado].tono}>{ESTADO_VERSION[v.estado].texto}</Badge>
                  <span>{modeloConNombre(v.modelo)}</span>
                  {v.origen === "prestada" && <Badge tono="marca">Prestada</Badge>}
                  {v.origen_curva === "usuario" && <Badge tono="marca">Mi curva</Badge>}
                  {v.origen_curva === "avanzada" && <Badge tono="neutro">Avanzada</Badge>}
                  {!v.recomendada && v.recomendada_entonces && <Badge tono="alerta">El sistema proponía {v.recomendada_entonces}</Badge>}
                </p>
                <p className="text-xs text-tinta-suave">
                  {formatearFechaHora(v.aprobada_at)} · {v.usuario_nombre ?? "—"}
                  {v.eat !== null && ` · ${textoEatConRuido(v.eat, v.ruido_normal)}`}
                  {v.origen_curva === "usuario" && v.curva_manual && v.curva_manual.eat_en_muestra !== null && ` · ${textoEatConRuido(v.curva_manual.eat_en_muestra, v.ruido_normal)} (en muestra)`}
                </p>
                {v.nota && <p className="text-xs text-tinta">Nota: «{v.nota}»</p>}
                {v.parametros_resumen.length > 0 && <p className="text-xs text-tinta-suave">Parámetros: {v.parametros_resumen.join(" · ")}</p>}
              </div>
              <MiniCurva vigente={v.curva} etiqueta={`Curva de la versión ${v.version}`} />
              <Button variante="secundario" tamano="sm" onClick={() => onVerFoto(v)}>
                Ver foto
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ID_TABLA_FOTO = "tabla-anio-mes-foto";

/**
 * «Ver foto»: el detalle CONGELADO de una versión (solo lectura): los datos y parámetros de aquel momento, el
 * gráfico y la tabla de esos años y las candidatas de entonces, comparados con la curva de ESA misma foto (la
 * diferencia es 0.0 salvo que se aprobara otra candidata). No evalúa obsolescencia: es historia.
 */
export function FotoModal({
  agrupacionId,
  version,
  versionModeloActual,
  onCerrar,
}: {
  agrupacionId: string;
  version: VersionAgrupacionApi;
  versionModeloActual: number;
  onCerrar: () => void;
}) {
  const { datos, cargando, error, setError } = useRecurso<DetalleFotoApi>(`/api/curvas/corridas/${version.foto_id}/agrupaciones/${agrupacionId}`);
  const [elegida, setElegida] = useState<ModeloCurva | null>(null);

  const resultado = datos?.resultado ?? null;
  // La versión del usuario (`U`) no es una candidata de la foto: se dibuja desde `curva_de_la_foto`, no desde `candidatas`.
  const modeloDeLaFoto = datos?.curva_de_la_foto?.modelo;
  const modelo: ModeloCurva | null = elegida ?? (modeloDeLaFoto && esModeloCurva(modeloDeLaFoto) ? modeloDeLaFoto : null) ?? resultado?.recomendada ?? null;
  const candidata = useMemo(() => resultado?.candidatas.find((c) => c.modelo === modelo && c.curva !== null) ?? null, [resultado, modelo]);
  const curvaPropuesta = modelo === "T" ? (datos?.temporada_curva?.curva_T ?? null) : (candidata?.curva ?? null);
  const propuesta = useMemo(() => (curvaPropuesta && modelo ? { etiqueta: etiquetaPropuesta(modelo), curva: curvaPropuesta } : null), [curvaPropuesta, modelo]);
  const deLaFoto = datos?.curva_de_la_foto ?? null;
  const vigenteGraf = useMemo(() => (deLaFoto ? { etiqueta: etiquetaAprobada(deLaFoto.version, deLaFoto.modelo), curva: deLaFoto.curva } : null), [deLaFoto]);
  const comparacion = useMemo(() => (propuesta && deLaFoto ? compararCurvas(deLaFoto.curva, propuesta.curva, deLaFoto.modelo === modelo) : null), [propuesta, deLaFoto, modelo]);
  const motivos = useMemo(() => {
    const m = new Map<number, string>();
    if (!datos) return m;
    for (const a of datos.resultado.anios) {
      const sinRed = datos.red.find((r) => r.anio === a.anio)?.sin_red ?? false;
      const motivo = motivoAnioSinDatos(a, { sinRed, faltantes: datos.foto.resumen.meses_publicados?.faltantes ?? [] });
      if (motivo) m.set(a.anio, motivo);
    }
    return m;
  }, [datos]);

  const f = datos?.foto ?? null;
  // Una versión `U` no trae candidata `U`: su curva sale de `curva_de_la_foto` y lo medido de `foto.resumen.curva_usuario`.
  const usuario = f?.resumen.curva_usuario ?? null;
  const modeloAnterior = f?.resumen.version_modelo !== undefined && f.resumen.version_modelo < versionModeloActual;
  const distintos = f ? parametrosDistintos(f.parametros) : [];

  return (
    <Modal
      titulo={`Foto de la versión ${version.version} · ${datos?.agrupacion.nombre ?? ""}`}
      descripcion={f ? `Foto del ${formatearFechaHora(f.created_at)} · datos hasta ${f.hasta_periodo} · modelo v${f.resumen.version_modelo ?? "?"}${modeloAnterior ? " (calculada con un modelo anterior)" : ""} · parámetros de ese momento` : "Cargando la foto…"}
      onCerrar={onCerrar}
      ancho="max-w-6xl"
      pie={
        <Button variante="secundario" onClick={onCerrar}>
          Cerrar
        </Button>
      }
    >
      {error && <Alert onCerrar={() => setError(null)}>No se pudo cargar la foto: {error}</Alert>}
      {!datos || !resultado || !f ? (
        !error && <p className="py-8 text-center text-sm text-tinta-suave">{cargando ? "Cargando la foto…" : "Sin información."}</p>
      ) : (
        <div className="space-y-6">
          <div className="space-y-1 text-sm">
            <p className="text-tinta">
              Aprobada con <strong>{modeloConNombre(version.modelo)}</strong>
              {f.usuario_nombre ? ` por ${f.usuario_nombre}` : ""}. Años usados:{" "}
              {resultado.anios
                .filter((a) => a.en_ajuste)
                .sort((a, b) => a.anio - b.anio)
                .map((a) => textoAnio(a))
                .join(" · ") || "ninguno"}
              .
            </p>
            <p className="text-xs text-tinta-suave">{distintos.length > 0 ? `Parámetros distintos del valor por defecto: ${distintos.join(" · ")}.` : "Parámetros: todos por defecto."}</p>
            {f.resumen.hasta_fue_por_defecto === false && <p className="text-xs text-tinta-suave">«Calcular hasta» se eligió a mano al aprobar (no era el último mes cerrado).</p>}
            {version.nota && <p className="text-xs text-tinta">Nota: «{version.nota}»</p>}
            {resultado.avisos.length > 0 && (
              <ul className="space-y-0.5 text-xs text-tinta-suave" aria-label="Avisos de la foto">
                {resultado.avisos.map((a, i) => (
                  <li key={`${a.codigo}-${i}`}>{a.detalle}</li>
                ))}
              </ul>
            )}
          </div>

          <GraficoCurvas resultado={resultado} propuesta={propuesta} vigente={vigenteGraf} temporada={datos.temporada_curva} idTabla={ID_TABLA_FOTO} />
          <TablaAnioMes
            id={ID_TABLA_FOTO}
            anios={resultado.anios}
            propuesta={propuesta}
            vigente={vigenteGraf}
            umbralDominante={f.parametros.umbral_tienda_dominante}
            nombreArchivo={`foto-${datos.agrupacion.codigo.toLowerCase()}-v${version.version}-anio-mes.csv`}
            motivos={motivos}
          />
          {usuario && (
            <div className="space-y-1 rounded-md border border-borde bg-fondo px-3 py-2 text-sm" aria-label="Curva del usuario de esta versión">
              <p className="font-medium text-tinta">Curva del usuario (U) · se escribió, no la calculó el sistema</p>
              <p className="text-xs text-tinta-suave">
                Valores ingresados (%): {usuario.valores_ingresados.map((v) => formatearDecimal(v, 1)).join(" · ")}. Partió de {textoPartida(usuario.partida)}.
              </p>
              {lineasMedidaEnMuestra({ ...usuario, ruido_normal: f.resumen.ruido_normal ?? null }).map((l, i) => (
                <p key={i} className="text-xs text-tinta">
                  {l}
                </p>
              ))}
            </div>
          )}
          <CandidatasTabla resultado={resultado} seleccionada={modelo} onSeleccionar={(m) => m !== "U" && setElegida(m)} />
          {propuesta && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-tinta">Candidata frente a la curva de esta foto</h3>
              <ComparadorCurvas propuesta={propuesta} vigente={vigenteGraf} comparacion={comparacion} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
