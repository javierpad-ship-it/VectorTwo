"use client";

import { useMemo, useState } from "react";
import { formatearNumero } from "@/lib/formato";
import { UMBRAL_GML_PEQUENO, type AnalisisMarcaApi, type FilaRepartoApi } from "@/lib/marcas-barrer/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  claveTemporada,
  editarCelda,
  estaEditada,
  estadoAprobacion,
  ETIQUETA_CLAVE_TEMPORADA,
  filasAjustables,
  hayAjustes,
  hayEdiciones,
  MAX_NOTA,
  renormalizarResto,
  sePuedeAjustar,
  SIN_AJUSTES,
  sumaVector,
  temporadasDe,
  valorEfectivo,
  type ClaveTemporada,
  type EstadoAjuste,
  type FilaAjustable,
  type FuenteReparto,
} from "./ajuste";
import { CeldaPorcentaje } from "./celda-porcentaje";
import { aniosDeFilas, formatearFraccion, formatearPorcentaje, formatearTendencia, textoErrorReparto, textoEstadoReparto, textoObsoleto, TONO_VEREDICTO_ERROR, tituloAnio, soloFecha } from "./vista";

type FilaTabla =
  | { tipo: "gml"; f: FilaAjustable }
  | { tipo: "resto"; f: FilaAjustable }
  | { tipo: "miembro"; resto: FilaAjustable; m: FilaRepartoApi }
  | { tipo: "suma" };

const claveTabla = (r: FilaTabla) => (r.tipo === "suma" ? "suma" : r.tipo === "miembro" ? `m:${r.m.clave}` : r.f.clave);

/** Lo que el bloque 1 necesita del exterior para aprobar: el envío y su estado viven en el detalle (una sola puerta de escritura). */
export type AccionAprobar = {
  ocupado: boolean;
  error: { mensaje: string; codigo: string | null } | null;
  proximaVersion: number;
  onAprobar: () => void;
  /** `409 huella_cambiada`: volver a leer el análisis con los datos de hoy (se descartan los ajustes). */
  onRecalcular: () => void;
  exito: string | null;
  onCerrarExito: () => void;
};

/**
 * Bloque 1 · Dónde vende la marca (reparto `p2`, parte al barrer, normalizada por el Niño). Dos candidatos lado a lado
 * (histórico y según la cerrada de M7), la celda ajustada que se edita en línea por temporada, los GML pequeños plegados en
 * un «Resto de GÉNERO · MUNDO» que se edita como una sola fila, y la aprobación versionada con nota. Nada se aprueba solo: el
 * reparto lo aprueba una persona y la versión guarda quién y cuándo.
 */
export function BloqueReparto({
  analisis,
  fuente,
  onFuente,
  ajuste,
  onAjuste,
  nota,
  onNota,
  accion,
}: {
  analisis: AnalisisMarcaApi;
  fuente: FuenteReparto;
  onFuente: (f: FuenteReparto) => void;
  ajuste: EstadoAjuste;
  onAjuste: (a: EstadoAjuste) => void;
  nota: string;
  onNota: (n: string) => void;
  accion: AccionAprobar;
}) {
  const { parametros } = analisis;
  const filas = useMemo(() => filasAjustables(analisis, fuente), [analisis, fuente]);
  const temporadas = useMemo(() => temporadasDe(analisis), [analisis]);
  const [temporadaElegida, setTemporadaElegida] = useState<ClaveTemporada>("verano");
  const temporada: ClaveTemporada = temporadas.includes(temporadaElegida) ? temporadaElegida : (temporadas[0] ?? "anual");
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());
  const [avisoRenormalizar, setAvisoRenormalizar] = useState<string | null>(null);

  const anios = useMemo(() => aniosDeFilas(analisis.filas), [analisis.filas]);
  const aprob = useMemo(
    () => estadoAprobacion(filas, temporadas, ajuste, { ventana_meses: parametros.ventana_meses, alcance: parametros.alcance, fuente }, nota),
    [filas, temporadas, ajuste, parametros.ventana_meses, parametros.alcance, fuente, nota]
  );
  const hayCerrada = parametros.fuente_disponible.includes("cerrada");
  const hayEdit = hayEdiciones(ajuste);
  const huboAjuste = hayAjustes(filas, temporadas, ajuste);

  const tabla: FilaTabla[] = useMemo(() => {
    const salida: FilaTabla[] = [];
    for (const f of filas) {
      salida.push(f.tipo === "gml" ? { tipo: "gml", f } : { tipo: "resto", f });
      if (f.tipo === "resto" && abiertos.has(f.clave)) for (const m of f.miembros) salida.push({ tipo: "miembro", resto: f, m });
    }
    if (filas.length > 0) salida.push({ tipo: "suma" });
    return salida;
  }, [filas, abiertos]);

  const vigenteDe = (r: FilaTabla): number | null => {
    if (r.tipo === "gml" && r.f.fila) return r.f.fila.p2.find((x) => claveTemporada(x.temporada) === temporada)?.vigente ?? null;
    if (r.tipo === "resto" && r.f.resto) return r.f.resto.p2.find((x) => claveTemporada(x.temporada) === temporada)?.vigente ?? null;
    return null;
  };
  const hayVigente = analisis.vigente !== null;

  function alternar(clave: string) {
    const s = new Set(abiertos);
    if (s.has(clave)) s.delete(clave);
    else s.add(clave);
    setAbiertos(s);
  }

  function renormalizar() {
    let estado = ajuste;
    const mensajes: string[] = [];
    for (const t of temporadas) {
      if (Object.keys(ajuste.editadas[t] ?? {}).length === 0) continue;
      const r = renormalizarResto(filas, t, estado);
      estado = r.estado;
      if (!r.ok) mensajes.push(`${ETIQUETA_CLAVE_TEMPORADA[t]}: ${r.motivo}`);
    }
    setAvisoRenormalizar(mensajes.length > 0 ? mensajes.join(" ") : null);
    onAjuste(estado);
  }

  function volverACalculado() {
    if (hayEdit && !confirm("¿Descartar los ajustes y volver a lo calculado?")) return;
    setAvisoRenormalizar(null);
    onAjuste(SIN_AJUSTES);
  }

  const columnas: Columna<FilaTabla>[] = [
    {
      clave: "gml",
      titulo: "GML / unidad",
      render: (r) => {
        if (r.tipo === "suma") return <span className="font-semibold">Suma</span>;
        if (r.tipo === "miembro") return <span className="pl-6 text-tinta-suave">{r.m.ruta}</span>;
        if (r.tipo === "resto") {
          const abierto = abiertos.has(r.f.clave);
          return (
            <button
              type="button"
              aria-expanded={abierto}
              onClick={() => alternar(r.f.clave)}
              className="text-left font-medium text-tinta hover:text-marca-oscura focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
            >
              <span aria-hidden>{abierto ? "▾" : "▸"}</span> {r.f.etiqueta}{" "}
              <span className="font-normal text-tinta-suave">
                ({r.f.miembros.length} GML &lt; {UMBRAL_GML_PEQUENO} u) · {abierto ? "ocultar" : `ver los ${r.f.miembros.length}`}
              </span>
            </button>
          );
        }
        return (
          <span className="font-medium">
            {r.f.etiqueta} {r.f.nivel === "GMLE" && <Badge tono="marca">GMLE</Badge>}
          </span>
        );
      },
    },
    {
      clave: "unidades",
      titulo: `Unid. ${parametros.ventana_meses} m`,
      className: "text-right tabular-nums",
      render: (r) => {
        if (r.tipo === "suma") return <span className="font-semibold">{formatearNumero(filas.reduce((s, f) => s + f.unidades, 0))}</span>;
        return formatearNumero(r.tipo === "miembro" ? r.m.unidades_ventana : r.f.unidades);
      },
    },
    {
      clave: "hist",
      titulo: "p2 hist.",
      className: "text-right tabular-nums",
      render: (r) => {
        if (r.tipo === "suma") return <span className="font-semibold">{formatearPorcentaje(filas.reduce((s, f) => s + (f.historico[temporada] ?? 0), 0))}</span>;
        if (r.tipo === "miembro") return formatearFraccion(r.m.p2.find((x) => claveTemporada(x.temporada) === temporada)?.historico);
        return formatearPorcentaje(r.f.historico[temporada]);
      },
    },
    {
      clave: "cerrada",
      titulo: "p2 cerrada",
      className: "text-right tabular-nums",
      render: (r) => {
        if (!hayCerrada) return <span className="text-tinta-suave">—</span>;
        if (r.tipo === "suma") return <span className="font-semibold">{formatearPorcentaje(filas.reduce((s, f) => s + (f.cerrada[temporada] ?? 0), 0))}</span>;
        if (r.tipo === "miembro") return formatearFraccion(r.m.p2.find((x) => claveTemporada(x.temporada) === temporada)?.cerrada);
        return formatearPorcentaje(r.f.cerrada[temporada]);
      },
    },
    ...(hayVigente
      ? ([
          {
            clave: "vigente",
            titulo: `Vigente v${analisis.vigente?.version}`,
            className: "text-right tabular-nums text-tinta-suave",
            render: (r: FilaTabla) => (r.tipo === "suma" || r.tipo === "miembro" ? "" : formatearFraccion(vigenteDe(r))),
          },
        ] satisfies Columna<FilaTabla>[])
      : []),
    {
      clave: "ajustado",
      titulo: "p2 ajust.",
      className: "text-right",
      render: (r) => {
        if (r.tipo === "miembro") return <span className="text-tinta-suave">—</span>;
        if (r.tipo === "suma") {
          const s = sumaVector(filas, temporada, ajuste);
          const ok = Math.abs(s - 100) <= 0.05;
          return (
            <span className={`font-semibold tabular-nums ${ok ? "text-exito" : "text-alerta"}`} aria-live="polite">
              {formatearPorcentaje(s)}
              {!ok && <span className="sr-only"> (no suma 100)</span>}
            </span>
          );
        }
        return (
          <CeldaPorcentaje
            valor={valorEfectivo(r.f, temporada, ajuste)}
            editada={estaEditada(r.f, temporada, ajuste)}
            escalada={ajuste.escaladas[temporada]?.[r.f.clave] !== undefined}
            etiqueta={`p2 ajustado de ${r.f.etiqueta}${temporada === "anual" ? "" : ` (${ETIQUETA_CLAVE_TEMPORADA[temporada].toLowerCase()})`}, en porcentaje`}
            disabled={accion.ocupado || !sePuedeAjustar(r.f, temporada)}
            onCommit={(v) => onAjuste(editarCelda(ajuste, r.f, temporada, v))}
          />
        );
      },
    },
    {
      clave: "p1",
      titulo: "p1 (peso en el GML)",
      className: "text-right tabular-nums",
      render: (r) => (r.tipo === "gml" ? formatearFraccion(r.f.fila?.p1_ventana) : r.tipo === "miembro" ? formatearFraccion(r.m.p1_ventana) : <span className="text-tinta-suave">—</span>),
    },
    {
      clave: "tendencia",
      titulo: "Tendencia",
      className: "text-right tabular-nums",
      render: (r) => (r.tipo === "gml" ? formatearTendencia(r.f.fila?.tendencia) : r.tipo === "miembro" ? formatearTendencia(r.m.tendencia) : <span className="text-tinta-suave">—</span>),
    },
    ...anios.map(
      (anio): Columna<FilaTabla> => ({
        clave: `a${anio}`,
        titulo: tituloAnio(anio, parametros.hasta_periodo),
        className: "text-right tabular-nums",
        render: (r) => {
          const fila = r.tipo === "gml" ? r.f.fila : r.tipo === "miembro" ? r.m : null;
          const u = fila?.unidades_anual.find((x) => x.anio === anio);
          return u ? formatearNumero(u.unidades) : <span className="text-tinta-suave">—</span>;
        },
      })
    ),
  ];

  const err = analisis.error_reparto;
  const v = analisis.vigente;
  const estadoVigente = v ? textoEstadoReparto({ vigente: true, obsoleto: analisis.obsoleto, diferenciaPp: v.diferencia_pp }) : null;

  return (
    <Card
      titulo={`1. Dónde vende ${analisis.marca.nombre}`}
      descripcion="Reparto p2 de la parte al barrer, normalizada por el Niño: qué parte de una compra de la marca va a cada GML."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {temporadas.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-tinta">Temporada:</span>
              <Chips<ClaveTemporada>
                etiqueta="Temporada del reparto"
                items={temporadas.map((t) => ({ id: t, label: ETIQUETA_CLAVE_TEMPORADA[t] }))}
                activo={temporada}
                onCambiar={setTemporadaElegida}
              />
            </div>
          )}
          <p className="text-tinta-suave">
            <span className="font-medium text-tinta">Error del reparto</span>{" "}
            {err.pp === null ? (
              "sin backtesting (hace falta un año completo con datos previos)"
            ) : (
              <>
                {err.anios.length > 0 ? `${err.anios.map((a) => a.anio).join(", ")}: ` : ""}
                <Badge tono={err.veredicto ? TONO_VEREDICTO_ERROR[err.veredicto] : "neutro"}>{textoErrorReparto(err)}</Badge>
                {err.veredicto === "inestable" && " · conviene acotar con un alcance o comprar con los porcentajes del comprador"}
              </>
            )}
          </p>
        </div>

        {v ? (
          <div className="rounded-md border border-borde bg-neutro-suave px-3 py-2 text-sm">
            <p>
              <span className="font-medium">Reparto vigente v{v.version}</span> · {soloFecha(v.aprobada_at)} · aprobado por {v.aprobada_por_nombre ?? "—"} · {v.ventana_meses} meses,{" "}
              {v.modo === "por_temporada" ? "por temporada" : v.modo === "anual" ? "anual" : v.modo}, {v.fuente === "cerrada" ? "según la cerrada" : "histórico"}
              {v.nota ? ` · nota: «${v.nota}»` : ""}
              {estadoVigente && (
                <>
                  {" "}
                  <Badge tono={estadoVigente.tono}>{estadoVigente.texto}</Badge>
                </>
              )}
            </p>
            {analisis.obsoleto.length > 0 && <p className="mt-1 text-alerta">Está obsoleto porque {textoObsoleto(analisis.obsoleto, v.diferencia_pp)}. No se recalcula solo: apruébalo de nuevo cuando quieras.</p>}
          </div>
        ) : (
          <p className="text-sm text-alerta">Esta marca todavía no tiene reparto aprobado: sus lotes quedarán con aviso «sin reparto» en el flujo.</p>
        )}

        {filas.length === 0 ? (
          <EmptyState
            titulo="No hay reparto que calcular"
            detalle={
              analisis.avisos.includes("sin_venta_barrer")
                ? "La marca no tiene venta al barrer en la ventana elegida: prueba con una ventana más larga o revisa su modalidad."
                : "Ningún GML con venta al barrer queda dentro del alcance elegido."
            }
          />
        ) : (
          <DataTable columnas={columnas} filas={tabla} claveFila={claveTabla} claseFila={(r) => (r.tipo === "suma" ? "bg-neutro-suave/60" : r.tipo === "miembro" ? "bg-fondo/40" : undefined)} />
        )}

        {analisis.fuera_de_alcance.length > 0 && (
          <p className="text-xs text-tinta-suave">
            Fuera del alcance (no se reparte, no entra en el denominador):{" "}
            {analisis.fuera_de_alcance.map((o) => `${o.ruta} ${formatearNumero(o.unidades)} u`).join("; ")}.
          </p>
        )}
        {analisis.marca.modalidad === "mixta" && analisis.marca.gml_especificos.length > 0 && (
          <p className="text-xs text-tinta-suave">
            Compras específicas (no se reparten; entran directo al flujo de su GML): {analisis.marca.gml_especificos.map((g) => g.ruta).join("; ")}.
          </p>
        )}

        {filas.length > 0 && (
          <div className="space-y-3 border-t border-borde pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-tinta">Fuente a aprobar:</span>
                <Chips<FuenteReparto>
                  etiqueta="Fuente del reparto"
                  items={[
                    { id: "historico", label: "Histórico" },
                    { id: "cerrada", label: hayCerrada ? "Cerrada" : "Cerrada (sin cerrada)" },
                  ]}
                  activo={fuente}
                  onCambiar={(f) => {
                    if (f === "cerrada" && !hayCerrada) return;
                    onFuente(f);
                  }}
                />
              </div>
              <Button variante="secundario" tamano="sm" onClick={renormalizar} disabled={accion.ocupado || Object.values(ajuste.editadas).every((m) => !m || Object.keys(m).length === 0)}>
                Renormalizar el resto
              </Button>
              <Button variante="fantasma" tamano="sm" onClick={volverACalculado} disabled={accion.ocupado || !hayEdit}>
                Volver a lo calculado
              </Button>
            </div>
            {!hayCerrada && <p className="text-xs text-tinta-suave">No hay proyección cerrada con participación de esta marca, así que solo se puede aprobar el reparto histórico.</p>}
            {avisoRenormalizar && <Alert tono="info">{avisoRenormalizar}</Alert>}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-tinta">
                Nota {aprob.notaRequerida ? "(obligatoria)" : "(opcional)"}
              </span>
              <textarea
                value={nota}
                onChange={(e) => onNota(e.target.value)}
                maxLength={MAX_NOTA}
                rows={2}
                disabled={accion.ocupado}
                aria-describedby="nota-reparto-ayuda"
                className="w-full rounded-md border border-borde bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-suave/70 focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20 disabled:bg-neutro-suave"
                placeholder="Por qué se aprueba así (queda en la versión)"
              />
              <span id="nota-reparto-ayuda" className="mt-1 block text-xs text-tinta-suave">
                {aprob.notaRequerida ? `Obligatoria porque ${aprob.razonesNota.join(", ")}. ` : "Obligatoria si ajustas, usas otra ventana que 24 meses, la fuente cerrada o un alcance. "}
                {nota.length}/{MAX_NOTA}
              </span>
            </label>

            {accion.error && (
              <Alert>
                {accion.error.mensaje}
                {accion.error.codigo === "huella_cambiada" && (
                  <>
                    {" "}
                    <button type="button" onClick={accion.onRecalcular} className="font-semibold underline">
                      Volver a calcular con los datos de hoy
                    </button>{" "}
                    (se descartan los ajustes sin aprobar).
                  </>
                )}
              </Alert>
            )}
            {accion.exito && <Alert tono="exito" onCerrar={accion.onCerrarExito}>{accion.exito}</Alert>}

            {aprob.bloqueos.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-alerta" aria-live="polite">
                {aprob.bloqueos.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={accion.onAprobar} disabled={accion.ocupado || aprob.bloqueos.length > 0}>
                {accion.ocupado ? "Aprobando…" : `Aprobar este reparto como v${accion.proximaVersion}`}
              </Button>
              <span className="text-xs text-tinta-suave">
                {huboAjuste ? "Con ajustes tuyos." : "Sin ajustes: se aprueba lo calculado."} La versión guarda quién la aprobó y cuándo.
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
