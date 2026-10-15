"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Switch } from "@/components/ui/switch";
import { hojasMensual } from "@/lib/proyeccion/excel";
import type { FilaMensualApi, IndiceLineaApi, ProyeccionApi, RespuestaMensualApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, Cargando, NUM } from "./comunes";
import { ComposicionBloques } from "./composicion-bloques";
import { descargarLibro } from "./descarga-libro";
import { FiltrosVista, type OpcionCatalogo } from "./filtros-vista";
import { nombresDeFiltro } from "./matriz-tab";
import { rutaProyeccion, useLectura } from "./use-proyeccion";
import {
  BLOQUES_MENSUAL,
  celdasDeAnio,
  ETIQUETA_BLOQUE,
  filtroAQuery,
  indiceMes,
  mesAaaaMm,
  nombreArchivoProyeccion,
  nombreMes,
  textoOrigenMeses,
  unidades,
  type BloqueMensual,
  type FiltroVista,
} from "./vista";

const TH = "px-2 py-1.5 text-right font-medium";

function CeldasAnio({ fila, anio, k, conCorte }: { fila: Pick<FilaMensualApi, "anios">; anio: number; k: number; conCorte: boolean }) {
  const a = fila.anios.find((x) => x.anio === anio);
  if (!a) {
    return (
      <>
        {Array.from({ length: 13 }, (_, i) => (
          <td key={i} className={`px-2 py-1.5 ${NUM} text-tinta-suave`}>
            —
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      {celdasDeAnio(a).map((c) => {
        const real = c.origen === "real";
        const corte = conCorte && c.mes === k ? "border-r-2 border-marca" : "";
        return (
          <td
            key={c.mes}
            title={c.valor === null ? "Sin curva vigente: el total está en la columna Total, sin meses" : `${nombreMes(c.mes)} ${anio}: ${real ? "real" : "proyectado"}`}
            className={`px-2 py-1.5 ${NUM} ${corte} ${real ? "bg-neutro-suave text-tinta-suave" : "bg-superficie italic"}`}
          >
            {c.valor === null ? "—" : unidades(c.valor)}
          </td>
        );
      })}
      <td className={`px-2 py-1.5 ${NUM} border-l border-borde font-semibold`} title={textoOrigenMeses(a) ?? undefined}>
        {unidades(a.total)}
        {a.sin_curva > 0 && (
          <span className="ml-1 rounded bg-alerta-suave px-1 font-sans text-[10px] font-medium text-alerta" title="Hay filas sin curva vigente: su total no está repartido en meses">
            sin curva
          </span>
        )}
      </td>
    </>
  );
}

/**
 * La tabla mensual (presentación pura): doce meses del año en curso y del siguiente por fila, el real en gris y redonda, el
 * proyectado en cursiva, una línea vertical en el último mes cerrado (`k`) y los totales al pie. Un mes sin curva queda
 * vacío («—»), no en cero.
 */
export function TablaMensual({
  datos,
  anioEnCurso: y,
  k,
  bloque,
  porAgrupacion,
}: {
  datos: Pick<RespuestaMensualApi, "filas" | "totales">;
  anioEnCurso: number;
  k: number;
  bloque: BloqueMensual;
  porAgrupacion: boolean;
}) {
  const totalY = datos.totales.find((t) => t.anio === y);
  const totalS = datos.totales.find((t) => t.anio === y + 1);
  const totales: Pick<FilaMensualApi, "anios"> | null =
    totalY || totalS
      ? { anios: [totalY, totalS].filter((t): t is NonNullable<typeof t> => t !== undefined).map((t) => ({ anio: t.anio, total: t.total, meses: t.meses, origen_meses: t.origen_meses, sin_curva: 0 })) }
      : null;
  return (
    <>
            <div className="overflow-x-auto rounded-lg border border-borde">
              <table className="w-full text-sm">
                <thead className="bg-neutro-suave text-xs uppercase tracking-wide text-tinta-suave">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-10 bg-neutro-suave px-3 py-2 text-left font-medium">
                      {porAgrupacion ? "Línea · agrupación de marca" : "Género · mundo · línea"}
                    </th>
                    <th colSpan={13} className="border-l border-borde px-2 py-1 text-center font-medium">
                      {y}
                    </th>
                    <th colSpan={13} className="border-l border-borde px-2 py-1 text-center font-medium">
                      {y + 1}
                    </th>
                  </tr>
                  <tr>
                    {[y, y + 1].flatMap((anio) => [
                      ...Array.from({ length: 12 }, (_, i) => (
                        <th key={`${anio}-${i}`} className={`${TH} ${i === 0 ? "border-l border-borde" : ""}`}>
                          {nombreMes(i + 1)}
                        </th>
                      )),
                      <th key={`${anio}-t`} className={`${TH} border-l border-borde`}>
                        Total
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody className="divide-y divide-borde">
                  {datos.filas.length === 0 && (
                    <tr>
                      <td colSpan={27} className="px-3 py-6 text-center text-tinta-suave">
                        Ninguna fila coincide con los filtros y el bloque elegidos.
                      </td>
                    </tr>
                  )}
                  {datos.filas.map((f) => (
                    <tr key={`${f.ids.genero_id}-${f.ids.mundo_id}-${f.ids.linea_id}-${f.ids.agrupacion_marca_id ?? ""}-${f.bloque}`}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-superficie px-3 py-1.5">
                        {f.genero} · {f.mundo} · {f.linea}
                        {f.agrupacion_marca && <span className="ml-1 text-tinta-suave">· {f.agrupacion_marca}</span>}
                      </td>
                      <CeldasAnio fila={f} anio={y} k={k} conCorte />
                      <CeldasAnio fila={f} anio={y + 1} k={k} conCorte={false} />
                    </tr>
                  ))}
                </tbody>
                {totales !== null && (
                  <tfoot className="border-t-2 border-borde bg-neutro-suave/60 font-medium">
                    <tr>
                      <td className="sticky left-0 z-10 bg-neutro-suave px-3 py-1.5">Total ({ETIQUETA_BLOQUE[bloque].toLowerCase()})</td>
                      <CeldasAnio fila={totales} anio={y} k={k} conCorte />
                      <CeldasAnio fila={totales} anio={y + 1} k={k} conCorte={false} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
    </>
  );
}

/**
 * Parte 3: vista mensual, solo lectura (ficha 07, paso 5b). Los totales vigentes de cada fila, repartidos con la curva
 * vigente de M6: en el año en curso los meses cerrados llevan el real (fondo gris, redonda) y los restantes el
 * proyectado (cursiva), con una línea vertical en el último mes cerrado; el año siguiente, doce meses proyectados.
 * Conmutador de bloque (todas, mismas, nuevas, cierres), los mismos filtros que la Matriz, «por agrupación de marca» y
 * exportación a Excel. No hay ninguna celda editable; es lo que consume M8.
 */
export function MensualTab({
  proyeccion,
  filtro,
  indice,
  agrupacionesEstacionalidad,
  agrupacionesMarca,
  onFiltro,
  onLimpiar,
}: {
  proyeccion: ProyeccionApi;
  filtro: FiltroVista;
  indice: readonly IndiceLineaApi[];
  agrupacionesEstacionalidad: readonly OpcionCatalogo[];
  agrupacionesMarca: readonly OpcionCatalogo[];
  onFiltro: (cambios: Partial<FiltroVista>) => void;
  onLimpiar: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const k = indiceMes(proyeccion.hasta_periodo);
  const [bloque, setBloque] = useState<BloqueMensual>("todas");
  const [porAgrupacion, setPorAgrupacion] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [errorExcel, setErrorExcel] = useState<string | null>(null);

  const query = filtroAQuery(filtro);
  query.set("bloque", bloque);
  query.set("por_agrupacion", porAgrupacion ? "1" : "0");
  const lectura = useLectura<RespuestaMensualApi>(`${rutaProyeccion(proyeccion.id)}/mensual?${query.toString()}`, true);
  const datos = lectura.datos;

  const itemsBloque: ChipItem<BloqueMensual>[] = BLOQUES_MENSUAL.map((b) => ({ id: b, label: ETIQUETA_BLOQUE[b] }));

  async function exportar() {
    if (!datos) return;
    setDescargando(true);
    setErrorExcel(null);
    try {
      const nombres = nombresDeFiltro(indice, agrupacionesMarca, agrupacionesEstacionalidad);
      const f = datos.filtro;
      const hojas = hojasMensual({
        filas: datos.filas,
        bloques: datos.bloques,
        anio: y,
        filtro: { ...f, agrupacion_estacionalidad_id: f.agrupacion_estacionalidad_id ? (nombres[f.agrupacion_estacionalidad_id] ?? f.agrupacion_estacionalidad_id) : null },
        datosHasta: mesAaaaMm(proyeccion.hasta_periodo),
        nombresFiltro: nombres,
      });
      await descargarLibro({ MENSUAL: hojas.MENSUAL, BLOQUES: hojas.BLOQUES, FILTROS: hojas.FILTROS }, nombreArchivoProyeccion(y, "mensual"));
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="space-y-4">
      <FiltrosVista filtro={filtro} indice={indice} agrupacionesEstacionalidad={agrupacionesEstacionalidad} agrupacionesMarca={agrupacionesMarca} onCambiar={onFiltro} onLimpiar={onLimpiar} />

      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {errorExcel && <Alert onCerrar={() => setErrorExcel(null)}>No se pudo generar el Excel: {errorExcel}</Alert>}
      {lectura.cargando && !datos && <Cargando texto="Armando la vista mensual…" />}

      {datos && (
        <>
          <ComposicionBloques bloques={proyeccion.bloques} anios={[y, y + 1]} />
          <Card
            titulo={`Mensual · ${proyeccion.nombre}`}
            descripcion={`Datos hasta ${mesAaaaMm(proyeccion.hasta_periodo)}. Solo lectura: es el reparto de los totales vigentes con las curvas de M6, y lo que consume el flujo de mercadería (M8).`}
            acciones={
              <Button variante="secundario" tamano="sm" onClick={() => void exportar()} disabled={descargando || lectura.cargando || datos.filas.length === 0}>
                {descargando ? "Generando…" : "Exportar a Excel"}
              </Button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Bloque</span>
                <Chips<BloqueMensual> items={itemsBloque} activo={bloque} onCambiar={setBloque} etiqueta="Bloque de tiendas" />
              </div>
              <Switch checked={porAgrupacion} onChange={setPorAgrupacion} label="Mostrar por agrupación de marca" />
            </div>
            {lectura.cargando && <p className="mb-2 text-xs italic text-tinta-suave">Actualizando…</p>}
            <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-neutro-suave" /> Real (meses cerrados)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-borde bg-superficie" /> <em>Proyectado</em>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-0.5 bg-marca" /> Último mes cerrado ({nombreMes(k)} {y})
              </span>
            </p>
            <TablaMensual datos={datos} anioEnCurso={y} k={k} bloque={bloque} porAgrupacion={porAgrupacion} />
            <p className="mt-3 text-xs text-tinta-suave">
              Un mes de una fila sin curva vigente aparece vacío («—»), no en cero: su total sí cuenta en la columna Total. En el total de varias filas, un mes es real solo si todas sus partes son reales.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
