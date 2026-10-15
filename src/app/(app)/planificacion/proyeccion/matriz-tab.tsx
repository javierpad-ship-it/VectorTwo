"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { hojasMatriz } from "@/lib/proyeccion/excel";
import type { IndiceLineaApi, NodoMatrizApi, ProyeccionApi, RespuestaMatrizApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BadgeEstadoLinea, Cargando, NUM } from "./comunes";
import { ComposicionBloques } from "./composicion-bloques";
import { descargarLibro } from "./descarga-libro";
import { FiltrosVista, type OpcionCatalogo } from "./filtros-vista";
import { rutaProyeccion, useLectura } from "./use-proyeccion";
import {
  claveNodo,
  esPlegable,
  filtroAQuery,
  formatearPct,
  hayCierres,
  mesAaaaMm,
  nodoVisible,
  nombreArchivoProyeccion,
  resumenBloquesAnio,
  textoPieMatriz,
  unidades,
  claveGenero,
  claveMundo,
  type FiltroVista,
} from "./vista";

const TH = "px-2 py-2 text-right font-medium";

/** Mapa `id → nombre` de lo que se puede filtrar, para que la hoja FILTROS diga «HOMBRE» y no un identificador. */
export function nombresDeFiltro(indice: readonly IndiceLineaApi[], marcas: readonly OpcionCatalogo[], estacionalidad: readonly OpcionCatalogo[]): Record<string, string | null> {
  const m: Record<string, string | null> = {};
  for (const i of indice) {
    m[i.genero_id] = i.genero;
    m[i.mundo_id] = i.mundo;
    m[i.linea_id] = i.linea;
  }
  for (const a of marcas) m[a.id] = a.nombre;
  for (const a of estacionalidad) m[a.id] = a.nombre;
  return m;
}

/**
 * Parte 2: la matriz (ficha 07, paso 5). Una fila por género · mundo · línea (desplegable por género y mundo; fila
 * Compañía arriba), siempre en unidades y sin solapes: venta a la fecha, mismas tiendas, nuevas del año anterior,
 * aperturas y total de cada año, con la variación y el estado de la línea. Con los mismos filtros que la vista Mensual y
 * exportación a Excel (SheetJS en el navegador) que respeta los filtros activos. En la matriz no se decide nada.
 */
export function MatrizTab({
  proyeccion,
  filtro,
  indice,
  agrupacionesEstacionalidad,
  agrupacionesMarca,
  onFiltro,
  onLimpiar,
  onIrALinea,
  onIrATiendas,
}: {
  proyeccion: ProyeccionApi;
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  agrupacionesEstacionalidad: readonly OpcionCatalogo[];
  agrupacionesMarca: readonly OpcionCatalogo[];
  onFiltro: (cambios: Partial<FiltroVista>) => void;
  onLimpiar: () => void;
  onIrALinea: (ids: NodoMatrizApi["ids"]) => void;
  onIrATiendas: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const [porMarca, setPorMarca] = useState(false);
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());
  const [descargando, setDescargando] = useState(false);
  const [errorExcel, setErrorExcel] = useState<string | null>(null);

  const query = filtroAQuery(filtro);
  query.set("por", porMarca ? "agrupacion_marca" : "arbol");
  const lectura = useLectura<RespuestaMatrizApi>(`${rutaProyeccion(proyeccion.id)}/matriz?${query.toString()}`, true);
  const datos = lectura.datos;

  const conCierresY = datos ? hayCierres(datos.nodos, "en_curso") : false;

  function alternar(clave: string) {
    setPlegados((prev) => {
      const sig = new Set(prev);
      if (sig.has(clave)) sig.delete(clave);
      else sig.add(clave);
      return sig;
    });
  }

  async function exportar() {
    if (!datos) return;
    setDescargando(true);
    setErrorExcel(null);
    try {
      const nombres = nombresDeFiltro(indice, agrupacionesMarca, agrupacionesEstacionalidad);
      const f = datos.filtro;
      const hojas = hojasMatriz({
        nodos: datos.nodos,
        bloques: datos.bloques,
        anio: y,
        filtro: { ...f, agrupacion_estacionalidad_id: f.agrupacion_estacionalidad_id ? (nombres[f.agrupacion_estacionalidad_id] ?? f.agrupacion_estacionalidad_id) : null },
        datosHasta: mesAaaaMm(proyeccion.hasta_periodo),
        nombresFiltro: nombres,
      });
      await descargarLibro({ MATRIZ: hojas.MATRIZ, BLOQUES: hojas.BLOQUES, FILTROS: hojas.FILTROS }, nombreArchivoProyeccion(y, "matriz"));
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }

  const desvio = datos?.resumen.desvio_prueba_anterior_pct ?? null;

  return (
    <div className="space-y-4">
      <FiltrosVista filtro={filtro} indice={indice} agrupacionesEstacionalidad={agrupacionesEstacionalidad} agrupacionesMarca={agrupacionesMarca} onCambiar={onFiltro} onLimpiar={onLimpiar} />

      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {errorExcel && (
        <Alert onCerrar={() => setErrorExcel(null)}>No se pudo generar el Excel: {errorExcel}</Alert>
      )}
      {lectura.cargando && !datos && <Cargando texto="Armando la matriz…" />}

      {datos && (
        <>
          <ComposicionBloques bloques={proyeccion.bloques} anios={[y, y + 1]} />

          <Card
            titulo={`Matriz · ${proyeccion.nombre}`}
            descripcion={`Datos hasta ${mesAaaaMm(proyeccion.hasta_periodo)}${desvio !== null ? ` · en ${y - 1} el método se desvió ${formatearPct(desvio)} (dentro de muestra)` : ""}. Unidades; nada se decide aquí.`}
            acciones={
              <div className="flex flex-wrap items-center gap-3">
                <Switch checked={porMarca} onChange={setPorMarca} label="Por agrupación de marca" />
                <Button variante="secundario" tamano="sm" onClick={() => void exportar()} disabled={descargando || lectura.cargando || datos.nodos.length === 0}>
                  {descargando ? "Generando…" : "Exportar a Excel"}
                </Button>
              </div>
            }
          >
            {lectura.cargando && <p className="mb-2 text-xs italic text-tinta-suave">Actualizando…</p>}
            <TablaMatriz
              datos={datos}
              proyeccion={proyeccion}
              porMarca={porMarca}
              plegados={plegados}
              onAlternar={alternar}
              onIrALinea={onIrALinea}
              onIrATiendas={onIrATiendas}
            />
            <p className="mt-3 text-sm text-tinta-suave">{textoPieMatriz(datos.resumen, y)}</p>
            <p className="mt-1 text-xs text-tinta-suave">
              Total {y} = mismas tiendas + nuevas del año anterior + aperturas{conCierresY ? " + cierres" : ""}; la venta a la fecha es la parte real de ese total y no se suma. Las celdas de tiendas nuevas llevan a la pestaña Tiendas nuevas y cierres.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * La tabla de la matriz (presentación pura): jerarquía compañía → género → mundo → línea con los desplegables de género y
 * mundo, columnas sin solapes y las columnas de cierres solo si alguna línea las tiene. Recibe los datos ya leídos.
 */
export function TablaMatriz({
  datos,
  proyeccion,
  porMarca,
  plegados,
  onAlternar,
  onIrALinea,
  onIrATiendas,
}: {
  datos: Pick<RespuestaMatrizApi, "nodos">;
  proyeccion: Pick<ProyeccionApi, "anio_en_curso" | "bloques">;
  porMarca: boolean;
  plegados: ReadonlySet<string>;
  onAlternar: (clave: string) => void;
  onIrALinea: (ids: NodoMatrizApi["ids"]) => void;
  onIrATiendas: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const visibles = datos.nodos.filter((n) => nodoVisible(n, plegados));
  const conCierresY = hayCierres(datos.nodos, "en_curso");
  const conCierresS = hayCierres(datos.nodos, "siguiente");
  const bY = resumenBloquesAnio(proyeccion.bloques[y]);
  const bS = resumenBloquesAnio(proyeccion.bloques[y + 1]);
  const codigosY = (ts: { codigo: string }[]) => (ts.length === 0 ? "" : `(${ts.map((t) => t.codigo).join(", ")})`);
  return (
    <>
            <div className="overflow-x-auto rounded-lg border border-borde">
              <table className="w-full text-sm">
                <thead className="bg-neutro-suave text-xs uppercase tracking-wide text-tinta-suave">
                  <tr>
                    <th rowSpan={2} className="px-3 py-2 text-left font-medium">
                      {porMarca ? "Género · agrupación de marca" : "Género · mundo · línea"}
                    </th>
                    <th colSpan={5 + (conCierresY ? 1 : 0)} className="border-l border-borde px-2 py-1 text-center font-medium">
                      {y}
                    </th>
                    <th colSpan={5 + (conCierresS ? 1 : 0)} className="border-l border-borde px-2 py-1 text-center font-medium">
                      {y + 1}
                    </th>
                    <th rowSpan={2} className="px-3 py-2 text-left font-medium">
                      Estado
                    </th>
                  </tr>
                  <tr>
                    <th className={`${TH} border-l border-borde`} title="Unidades reales de enero al último mes cerrado, todas las tiendas (sin el CD)">
                      Venta a la fecha
                    </th>
                    <th className={TH}>Mismas tiendas</th>
                    <th className={TH}>
                      Nuevas año ant. <span className="block font-mono normal-case">{codigosY(bY.anterior)}</span>
                    </th>
                    <th className={TH}>
                      Aperturas <span className="block font-mono normal-case">{codigosY(bY.aperturas)}</span>
                    </th>
                    {conCierresY && <th className={TH}>Cierres</th>}
                    <th className={TH}>Total {y}</th>
                    <th className={`${TH} border-l border-borde`}>Mismas tiendas</th>
                    <th className={TH}>
                      Nuevas año ant. <span className="block font-mono normal-case">{codigosY(bS.anterior)}</span>
                    </th>
                    <th className={TH}>
                      Aperturas <span className="block font-mono normal-case">{codigosY(bS.aperturas)}</span>
                    </th>
                    {conCierresS && <th className={TH}>Cierres</th>}
                    <th className={TH}>Total {y + 1}</th>
                    <th className={TH}>Var.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borde">
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={12 + (conCierresY ? 1 : 0) + (conCierresS ? 1 : 0)} className="px-3 py-6 text-center text-tinta-suave">
                        Ninguna línea coincide con los filtros.
                      </td>
                    </tr>
                  )}
                  {visibles.map((n) => {
                    const sangria = n.nivel === "compania" ? 0 : n.nivel === "genero" ? 0 : n.nivel === "mundo" ? 1 : n.nivel === "linea" ? 2 : 1;
                    const clase = n.nivel === "compania" ? "bg-neutro-suave font-semibold" : n.nivel === "genero" ? "bg-fondo font-semibold" : n.nivel === "mundo" ? "font-medium" : "";
                    const clave = n.nivel === "genero" ? claveGenero(n) : n.nivel === "mundo" ? claveMundo(n) : "";
                    const plegado = clave !== "" && plegados.has(clave);
                    return (
                      <tr key={claveNodo(n)} className={clase}>
                        <td className="px-3 py-2" style={{ paddingLeft: `${0.75 + sangria * 1.25}rem` }}>
                          <span className="inline-flex items-center gap-1.5">
                            {esPlegable(n) && (
                              <button type="button" onClick={() => onAlternar(clave)} aria-expanded={!plegado} aria-label={`${plegado ? "Desplegar" : "Plegar"} ${n.nombre}`} className="text-tinta-suave hover:text-tinta">
                                {plegado ? "▸" : "▾"}
                              </button>
                            )}
                            {n.nivel === "linea" ? (
                              <button type="button" onClick={() => onIrALinea(n.ids)} title="Abrir esta línea en Por línea" className="text-left text-marca-oscura underline-offset-2 hover:underline">
                                {n.nombre}
                              </button>
                            ) : (
                              n.nombre
                            )}
                          </span>
                        </td>
                        <td className={`px-2 py-2 border-l border-borde ${NUM}`}>{unidades(n.en_curso.venta_a_la_fecha)}</td>
                        <td className={`px-2 py-2 ${NUM}`}>{unidades(n.en_curso.mismas)}</td>
                        <CeldaTiendas valor={n.en_curso.nuevas_anterior} onClick={onIrATiendas} />
                        <CeldaTiendas valor={n.en_curso.aperturas} onClick={onIrATiendas} />
                        {conCierresY && <td className={`px-2 py-2 ${NUM}`}>{unidades(n.en_curso.cierres)}</td>}
                        <td className={`px-2 py-2 ${NUM} font-semibold`}>{unidades(n.en_curso.total)}</td>
                        <td className={`px-2 py-2 border-l border-borde ${NUM}`}>{unidades(n.siguiente.mismas)}</td>
                        <CeldaTiendas valor={n.siguiente.nuevas_anterior} onClick={onIrATiendas} />
                        <CeldaTiendas valor={n.siguiente.aperturas} onClick={onIrATiendas} />
                        {conCierresS && <td className={`px-2 py-2 ${NUM}`}>{unidades(n.siguiente.cierres)}</td>}
                        <td className={`px-2 py-2 ${NUM} font-semibold`}>{unidades(n.siguiente.total)}</td>
                        <td className={`px-2 py-2 ${NUM}`}>{formatearPct(n.variacion_pct)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <BadgeEstadoLinea estado={n.estado} />
                            {n.estado === "parcial" && (
                              <span className="font-mono text-xs text-tinta-suave" title={`Filas decididas: ${y} y ${y + 1}`}>
                                {n.en_curso.decididas}/{n.en_curso.filas} · {n.siguiente.decididas}/{n.siguiente.filas}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
    </>
  );
}

function CeldaTiendas({ valor, onClick }: { valor: number; onClick: () => void }) {
  if (valor === 0) return <td className={`px-2 py-2 ${NUM} text-tinta-suave`}>—</td>;
  return (
    <td className={`px-2 py-2 ${NUM}`}>
      <button type="button" onClick={onClick} title="Ver las tiendas nuevas" className="font-mono tabular-nums underline-offset-2 hover:text-marca-oscura hover:underline">
        {unidades(valor)}
      </button>
    </td>
  );
}
