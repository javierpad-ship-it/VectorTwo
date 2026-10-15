"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { descargarCsv } from "@/components/importador/csv";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { formatearNumero, plural } from "@/lib/formato";
import type { FilaApi, IndiceLineaApi, ProyeccionApi, RespuestaLineasApi } from "@/lib/proyeccion/tipos-api";
import type { DecisionFila } from "./celda-decision";
import { AlertaError, BadgeEstadoLinea, BotonEnlace, Cargando } from "./comunes";
import { DetalleFila } from "./detalle-fila";
import { SelectoresLinea } from "./filtros-vista";
import { GraficoBarras } from "./grafico-barras";
import { TablaFilas } from "./tabla-filas";
import { rutaProyeccion, useAccion, useLectura } from "./use-proyeccion";
import {
  cabeceraCsvLinea,
  construirBarras,
  ETIQUETA_ESTADO_LINEA,
  filasCsvLinea,
  filasConCurvaNueva,
  filtroAQuery,
  filtrarIndice,
  lineaElegida,
  mesAaaaMm,
  resumenTiendasLinea,
  textoPruebaAnterior,
  tiendasSinDecidirQueAlimentan,
  vecinas,
  type FiltroVista,
} from "./vista";

/**
 * Parte 1: análisis por línea (ficha 07, pasos 3 y 4). Tres filtros (género, mundo, línea) y un índice lateral con el
 * estado de cada línea para avanzar en orden. La línea elegida muestra el gráfico de unidades por año (cada barra con
 * las mismas tiendas de su año) y la tabla de sus filas GML × agrupación de marca, donde se decide el total de cada
 * año. El detalle de una fila (`&fila=`) trae la explicación completa. Nada se aprueba en bloque.
 */
export function LineaTab({
  proyeccion,
  filtro,
  indice,
  filaId,
  bloqueada,
  nombresAgrupacion,
  onFiltro,
  onFila,
  onIrATiendas,
  onCambio,
  onRecalcular,
}: {
  proyeccion: ProyeccionApi;
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  filaId: string | null;
  bloqueada: boolean;
  nombresAgrupacion: ReadonlyMap<string, string>;
  onFiltro: (cambios: Partial<FiltroVista>) => void;
  onFila: (id: string | null) => void;
  onIrATiendas: () => void;
  onCambio: () => Promise<void>;
  onRecalcular: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const ruta = rutaProyeccion(proyeccion.id);
  const [q, setQ] = useState("");
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const refDetalle = useRef<HTMLDivElement>(null);

  const elegida = lineaElegida(indice, filtro);
  const visibles = useMemo(() => filtrarIndice(indice, filtro, q), [indice, filtro, q]);
  const { anterior, siguiente } = useMemo(() => vecinas(visibles, elegida), [visibles, elegida]);

  const url = elegida ? `${ruta}/lineas?${filtroAQuery(filtro, ["genero", "mundo", "linea"]).toString()}` : null;
  const lineas = useLectura<RespuestaLineasApi>(url);
  const datos = lineas.datos;

  const barras = useMemo(() => (datos ? construirBarras({ anioEnCurso: y, lineas: datos, bloques: proyeccion.bloques }) : []), [datos, y, proyeccion.bloques]);
  const sinDecidir = datos ? tiendasSinDecidirQueAlimentan(datos, y) : [];
  const baseFilas = datos ? datos.filas.filter((f) => f.tienda_id === null && f.activo) : [];
  const conCurvaNueva = filasConCurvaNueva(baseFilas);
  const gmlId = baseFilas[0]?.gml_id ?? null;

  useEffect(() => {
    if (filaId) refDetalle.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [filaId]);

  async function recargarTodo() {
    await Promise.all([lineas.recargar(), onCambio()]);
  }

  async function decidir(fila: FilaApi, anio: number, cuerpo: DecisionFila): Promise<boolean> {
    setAviso(null);
    const r = await accion.ejecutar(() => api.put(`${ruta}/filas/${fila.id}/anios/${anio}`, cuerpo));
    if (!r.ok) return false;
    await recargarTodo();
    return true;
  }

  async function aplicarCurvaLinea() {
    if (!gmlId) return;
    if (!confirm(`Se copiará el reparto con la curva nueva sobre el reparto guardado de ${plural(conCurvaNueva, "fila", "filas")} de la línea, en los dos años. Los totales decididos no cambian. ¿Aplicar la curva nueva?`)) return;
    setAviso(null);
    const r = await accion.ejecutar(() => api.post<{ aplicadas: number }>(`${ruta}/aplicar-curva`, { gml_id: gmlId }));
    if (!r.ok) return;
    setAviso(`Se aplicó la curva nueva en ${plural(r.valor.aplicadas, "registro", "registros")}.`);
    await recargarTodo();
  }

  function descargarCsvLinea() {
    if (!datos || !elegida) return;
    descargarCsv(cabeceraCsvLinea(y), filasCsvLinea(datos.filas, y), `proyeccion-${y}-${y + 1}-${elegida.linea.toLowerCase().replace(/\s+/g, "-")}.csv`);
  }

  const agrupaciones = [...new Set(baseFilas.map((f) => f.agrupacion_estacionalidad?.nombre).filter((n): n is string => Boolean(n)))].join(", ");
  const mismasPorAnio = barras.map((b) => `${b.anio} ${b.tiendas ?? "—"}`).join(" · ");

  return (
    <div className="grid gap-4 xl:grid-cols-[17rem_1fr]">
      {/* Índice lateral: el estado de cada línea para avanzar en orden */}
      <aside className="space-y-2 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
        <Field label="Buscar línea">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="DENIM, POLO…" className="h-9" />
        </Field>
        <p className="text-xs text-tinta-suave">{plural(visibles.length, "línea", "líneas")}</p>
        <ul className="max-h-96 divide-y divide-borde overflow-y-auto rounded-lg border border-borde bg-superficie xl:max-h-none">
          {visibles.length === 0 && <li className="px-3 py-4 text-sm text-tinta-suave">Ninguna línea coincide.</li>}
          {visibles.map((i) => {
            const activa = elegida?.genero_id === i.genero_id && elegida.mundo_id === i.mundo_id && elegida.linea_id === i.linea_id;
            return (
              <li key={`${i.genero_id}|${i.mundo_id}|${i.linea_id}`}>
                <button
                  type="button"
                  aria-current={activa ? "true" : undefined}
                  onClick={() => onFiltro({ genero: i.genero_id, mundo: i.mundo_id, linea: i.linea_id })}
                  className={`flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm hover:bg-fondo ${activa ? "bg-marca-suave" : ""}`}
                >
                  <span className="font-medium">{i.linea}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
                    {i.genero} · {i.mundo}
                    <BadgeEstadoLinea estado={i.estado} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectoresLinea filtro={filtro} indice={indice} onCambiar={onFiltro} />
        </div>

        {!elegida && (
          <EmptyState titulo="Elige una línea para empezar" detalle="Filtra por género y mundo o escoge una línea del índice. Trabaja una línea a la vez: el índice muestra cuáles faltan.">
            <Resumen indice={visibles} />
          </EmptyState>
        )}

        {elegida && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {elegida.genero} · {elegida.mundo} · {elegida.linea}
                </h2>
                <p className="mt-0.5 text-sm text-tinta-suave">
                  <BadgeEstadoLinea estado={elegida.estado} /> <span className="ml-1">datos hasta {mesAaaaMm(proyeccion.hasta_periodo)}</span>
                  {agrupaciones && <span> · curva: {agrupaciones}</span>}
                  {datos && <span> · mismas tiendas: {mismasPorAnio}</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variante="secundario" tamano="sm" disabled={!anterior} onClick={() => anterior && onFiltro({ genero: anterior.genero_id, mundo: anterior.mundo_id, linea: anterior.linea_id })}>
                  ← Anterior
                </Button>
                <Button variante="secundario" tamano="sm" disabled={!siguiente} onClick={() => siguiente && onFiltro({ genero: siguiente.genero_id, mundo: siguiente.mundo_id, linea: siguiente.linea_id })}>
                  Siguiente →
                </Button>
              </div>
            </div>

            {lineas.error && <AlertaError error={lineas.error} onCerrar={() => lineas.setError(null)} onRecargar={() => void lineas.recargar()} />}
            {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={onRecalcular} onRecargar={() => void recargarTodo()} />}
            {aviso && (
              <Alert tono="exito" onCerrar={() => setAviso(null)}>
                {aviso}
              </Alert>
            )}
            {lineas.cargando && !datos && <Cargando texto="Leyendo la línea…" />}

            {datos && (
              <>
                {datos.avisos_linea.includes("tienda_nueva_sin_decidir") && sinDecidir.length > 0 && (
                  <Alert tono="alerta">
                    La base de {y + 1} incluye una tienda nueva sin decidir ({sinDecidir.join(", ")}): su propuesta de {y} alimenta la base.{" "}
                    <BotonEnlace onClick={onIrATiendas}>Decídela en Tiendas nuevas y cierres</BotonEnlace>
                  </Alert>
                )}
                {datos.avisos_linea.includes("tienda_nueva_sin_decidir") && sinDecidir.length === 0 && (
                  <Alert tono="alerta">
                    La base de {y + 1} incluye una tienda nueva sin decidir. <BotonEnlace onClick={onIrATiendas}>Decídela en Tiendas nuevas y cierres</BotonEnlace>
                  </Alert>
                )}
                {conCurvaNueva > 0 && !bloqueada && (
                  <Alert tono="alerta">
                    <span className="block">
                      La curva cambió en {plural(conCurvaNueva, "fila", "filas")} de la línea: el reparto decidido conserva la versión anterior. Ábrelas para ver los dos repartos o aplícalas todas.
                    </span>
                    <span className="mt-1 block">
                      <BotonEnlace onClick={() => void aplicarCurvaLinea()} disabled={accion.ocupado}>
                        Aplicar curva nueva a toda la línea
                      </BotonEnlace>
                    </span>
                  </Alert>
                )}

                <Card titulo="Unidades por año" descripcion={`Cada barra con las mismas tiendas de su año; ${y} = vendido + resto; ${y + 1} = proyección.`}>
                  <GraficoBarras barras={barras} anioEnCurso={y} />
                </Card>

                <Card titulo="Filas de la línea (GML × agrupación de marca)" descripcion="Escribe la cifra y pulsa Enter, o ✓ para aceptar la propuesta. Nada se aprueba en bloque.">
                  <TablaFilas
                    filas={datos.filas}
                    lineas={datos}
                    anioEnCurso={y}
                    crecimientoDefecto={proyeccion.parametros.crecimiento_pct_defecto}
                    bloqueada={bloqueada}
                    ocupado={accion.ocupado}
                    filaSeleccionada={filaId}
                    onSeleccionar={(id) => onFila(id === filaId ? null : id)}
                    onDecidir={decidir}
                    onCsv={descargarCsvLinea}
                  />
                  <div className="mt-3 space-y-0.5 text-xs text-tinta-suave">
                    {resumenTiendasLinea(datos, y).map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                    {resumenTiendasLinea(datos, y + 1).map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                    <p>
                      <BotonEnlace onClick={onIrATiendas}>Ir a Tiendas nuevas y cierres</BotonEnlace>
                    </p>
                  </div>
                  {datos.prueba_anterior && (
                    <p className="mt-3 rounded-md bg-fondo px-3 py-2 text-xs text-tinta-suave">
                      Línea · {textoPruebaAnterior({ anio: y - 1, ...datos.prueba_anterior }, proyeccion.hasta_periodo)}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-tinta-suave">
                    {ETIQUETA_ESTADO_LINEA[elegida.estado]} · {formatearNumero(baseFilas.length)} filas con venta en los últimos 24 meses.
                  </p>
                </Card>
              </>
            )}

            {filaId && (
              <div ref={refDetalle}>
                <DetalleFila proyeccion={proyeccion} filaId={filaId} nombresAgrupacion={nombresAgrupacion} bloqueada={bloqueada} onCerrar={() => onFila(null)} onCambio={recargarTodo} onRecalcular={onRecalcular} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Resumen({ indice }: { indice: readonly IndiceLineaApi[] }) {
  const conteo = { sin_proyectar: 0, parcial: 0, proyectada: 0, curva_cambio: 0, propuesta_cambio: 0 };
  for (const i of indice) conteo[i.estado] += 1;
  return (
    <span className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
      <span>{conteo.sin_proyectar} sin proyectar</span>
      <span>{conteo.parcial} parciales</span>
      <span>{conteo.proyectada} proyectadas</span>
      {conteo.curva_cambio > 0 && <span>{conteo.curva_cambio} con curva nueva</span>}
      {conteo.propuesta_cambio > 0 && <span>{conteo.propuesta_cambio} con propuesta distinta</span>}
    </span>
  );
}
