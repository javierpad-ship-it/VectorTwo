"use client";

import { memo, useMemo, useState } from "react";
import { filtrarReporte, hayFiltros, type FilaDetalleGmle, type FiltrosGmle } from "@/lib/reportes/filtros";
import {
  MAX_EQUIVALENCIAS_PETICION,
  MESES_CORTOS,
  armarMatriz,
  calcularGeometria,
  colorAnio,
  etiquetaBarra,
  formatearSoles,
  formatearUnidades,
  formatearVariacion,
  idsParaPeticion,
  variacionAnual,
  variacionesMatriz,
  type MatrizMensual,
} from "@/lib/reportes/histograma";
import { formatearNumero, plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { useUnidadesMensuales } from "./use-unidades-mensuales";

type Activa = { iAnio: number; mes: number };

/** Tono de una variación: sube = éxito, baja = alerta, sin dato o 0 = neutro. */
function claseVariacion(pct: number | null): string {
  if (pct === null || Math.round(pct * 10) === 0) return "text-tinta-suave";
  return pct > 0 ? "text-exito" : "text-alerta";
}

/**
 * Barras agrupadas en SVG inline: eje X = 12 meses, una barra por año, eje Y
 * = unidades. Los colores de texto, rejilla y barras salen de los tokens del
 * tema (clases `fill-*` / `stroke-*`), así que siguen al tema (hoy solo claro: `globals.css` no define modo oscuro).
 * El ancho natural crece con los años; por debajo de él el contenedor hace
 * scroll horizontal en vez de apretar las barras.
 */
function GraficoBarras({
  matriz,
  variaciones,
  activa,
  onActivar,
}: {
  matriz: MatrizMensual;
  variaciones: (number | null)[][];
  activa: Activa | null;
  onActivar: (a: Activa | null) => void;
}) {
  const g = useMemo(() => calcularGeometria(matriz), [matriz]);
  const resumen = `Barras agrupadas de unidades vendidas por mes, una por año (${matriz.anios.join(", ")}). La tabla de abajo trae las cifras exactas.`;

  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Gráfico de unidades por mes y año (desplazable)">
      <svg
        viewBox={`0 0 ${g.ancho} ${g.alto}`}
        width="100%"
        style={{ minWidth: g.ancho }}
        className="block h-auto select-none"
        role="group"
        aria-label={resumen}
      >
        {/* Rejilla y eje Y */}
        {g.ticks.map((t) => (
          <g key={t.valor}>
            <line x1={g.area.x} x2={g.area.x + g.area.ancho} y1={t.y} y2={t.y} className={t.valor === 0 ? "stroke-tinta-suave" : "stroke-borde"} strokeWidth={1} />
            <text x={g.area.x - 8} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize={11} className="fill-tinta-suave">
              {t.etiqueta}
            </text>
          </g>
        ))}

        {/* Eje X */}
        {g.grupos.map((m) => (
          <text key={m.mes} x={m.centro} y={g.alto - g.margen.inf + 18} textAnchor="middle" fontSize={11} className="fill-tinta-suave">
            {m.etiqueta}
          </text>
        ))}

        {/* Barras: solo donde hay dato (un mes sin datos queda vacío, no en cero) */}
        {g.barras.map((b) => {
          const variacion = variaciones[b.iAnio][b.mes];
          const texto = etiquetaBarra(b.anio, b.mes, b.valor, variacion);
          const esActiva = activa?.iAnio === b.iAnio && activa.mes === b.mes;
          return (
            <rect
              key={`${b.anio}-${b.mes}`}
              x={b.x}
              y={b.y}
              width={b.ancho}
              height={b.alto}
              rx={Math.min(2, b.ancho / 3)}
              fill={b.color}
              fillOpacity={activa && !esActiva ? 0.55 : 1}
              stroke={esActiva ? "currentColor" : "none"}
              strokeWidth={esActiva ? 1.5 : 0}
              className="text-tinta"
              role="img"
              aria-label={texto}
              onMouseEnter={() => onActivar({ iAnio: b.iAnio, mes: b.mes })}
              onMouseLeave={() => onActivar(null)}
            >
              <title>{texto}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

type FilaTabla = { clave: string; etiqueta: string; mes: number | null };

/** Matriz mes × año con el total por mes (última columna), el total por año (última fila) y la variación contra el año anterior. */
function TablaMatriz({ matriz, variaciones }: { matriz: MatrizMensual; variaciones: (number | null)[][] }) {
  const filas = useMemo<FilaTabla[]>(
    () => [...MESES_CORTOS.map((etiqueta, mes) => ({ clave: String(mes), etiqueta, mes })), { clave: "total", etiqueta: "Total", mes: null }],
    []
  );

  const columnas = useMemo<Columna<FilaTabla>[]>(() => {
    const celda = (valor: number | null, pct: number | null, negrita = false) =>
      valor === null ? (
        <span className="text-tinta-suave" title="Sin datos">
          —
        </span>
      ) : (
        <span className="flex flex-col items-end leading-tight">
          <span className={negrita ? "font-semibold" : ""}>{formatearUnidades(valor)}</span>
          {pct !== null && <span className={`whitespace-nowrap text-xs ${claseVariacion(pct)}`}>{formatearVariacion(pct)}</span>}
        </span>
      );

    return [
      { clave: "mes", titulo: "Mes", className: "whitespace-nowrap", render: (f) => (f.mes === null ? <strong>{f.etiqueta}</strong> : f.etiqueta) },
      ...matriz.anios.map<Columna<FilaTabla>>((anio, i) => ({
        clave: `a${anio}`,
        titulo: String(anio),
        className: "text-right tabular-nums",
        render: (f) =>
          f.mes === null ? celda(matriz.totalesAnio[i], variacionAnual(matriz, i), true) : celda(matriz.valores[i][f.mes], variaciones[i][f.mes]),
      })),
      {
        clave: "total",
        titulo: "Total",
        className: "text-right tabular-nums",
        render: (f) => celda(f.mes === null ? matriz.total : matriz.totalesMes[f.mes], null, true),
      },
    ];
  }, [matriz, variaciones]);

  return (
    <div className="space-y-2">
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(f) => f.clave}
        claseFila={(f) => (f.mes === null ? "bg-neutro-suave/60" : "hover:bg-fondo/60")}
      />
      <p className="text-xs text-tinta-suave">
        El porcentaje compara cada mes con el mismo mes del año anterior, solo donde ambos existen. En la fila Total compara solo los meses que los dos años
        tienen (un año a medio cargar no se mide contra uno completo). «—» = mes sin datos.
      </p>
    </div>
  );
}

/**
 * Histograma de unidades vendidas por mes y año (M11 · Resumen). Sigue los
 * filtros de la barra del reporte: manda los `equivalencia_ids` de las filas
 * que pasan (nada si no hay ningún filtro = todas) y no llama a la API si los
 * filtros no dejan ninguna equivalencia.
 */
export const HistogramaUnidades = memo(function HistogramaUnidades({ detalle, filtros }: { detalle: FilaDetalleGmle[]; filtros: FiltrosGmle }) {
  const [activa, setActiva] = useState<Activa | null>(null);
  const [tablaAbierta, setTablaAbierta] = useState(true);

  const ids = useMemo(
    () =>
      idsParaPeticion(
        filtrarReporte(detalle, filtros).map((f) => f.id),
        hayFiltros(filtros)
      ),
    [detalle, filtros]
  );
  const { tipo, datos, cargando, error, reintentar } = useUnidadesMensuales(ids);

  const matriz = useMemo(() => (datos ? armarMatriz(datos.meses) : null), [datos]);
  const variaciones = useMemo(() => (matriz ? variacionesMatriz(matriz) : []), [matriz]);

  const contexto = ids === null ? "Todas las equivalencias" : `${formatearNumero(ids.length)} ${ids.length === 1 ? "equivalencia filtrada" : "equivalencias filtradas"}`;
  const hayDatos = matriz !== null && matriz.anios.length > 0;
  const mostrandoDatos = hayDatos && !error && (tipo === "todas" || tipo === "ids");

  // El cursor puede seguir sobre una barra que ya no existe cuando llegan datos
  // con menos años (React no dispara `onMouseLeave` al desmontarla): se descarta
  // en vez de leer fuera de la matriz.
  const activaVigente = activa && matriz && activa.iAnio >= 0 && activa.iAnio < matriz.anios.length && activa.mes >= 0 && activa.mes < 12 ? activa : null;
  const lectura =
    activaVigente && matriz
      ? etiquetaBarra(
          matriz.anios[activaVigente.iAnio],
          activaVigente.mes,
          matriz.valores[activaVigente.iAnio]?.[activaVigente.mes] ?? 0,
          variaciones[activaVigente.iAnio]?.[activaVigente.mes] ?? null
        )
      : null;

  return (
    <Card
      titulo="Unidades vendidas por mes y año"
      descripcion="Para validar la data histórica y la forma de cada agrupación. Sigue los filtros de la barra de arriba."
    >
      <div className="space-y-4" aria-busy={cargando}>
        <p className="text-sm text-tinta-suave">
          <span className="font-medium text-tinta">{contexto}</span>
          {mostrandoDatos && datos && (
            <>
              {" "}
              · <strong className="font-semibold text-tinta">{formatearUnidades(datos.total_unidades)}</strong> unidades ·{" "}
              <strong className="font-semibold text-tinta">{formatearSoles(datos.total_venta_soles)}</strong> de venta ·{" "}
              {plural(matriz?.mesesConDatos ?? 0, "mes con datos", "meses con datos")}
            </>
          )}
          {cargando && datos && <span className="ml-2 text-xs">Actualizando…</span>}
        </p>

        {tipo === "vacia" && (
          <EmptyState titulo="Los filtros no dejan ninguna equivalencia." detalle="Ajusta o limpia los filtros para ver las unidades vendidas." />
        )}

        {tipo === "excede" && (
          <Alert tono="info">
            Los filtros dejan {formatearNumero(ids?.length ?? 0)} equivalencias y el histograma admite hasta {formatearNumero(MAX_EQUIVALENCIAS_PETICION)}. Acota
            los filtros (agrupación, género, mundo o texto).
          </Alert>
        )}

        {error && (
          <div className="space-y-2">
            <Alert>No se pudo cargar el histograma: {error}</Alert>
            <Button variante="secundario" tamano="sm" onClick={reintentar}>
              Reintentar
            </Button>
          </div>
        )}

        {!error && (tipo === "todas" || tipo === "ids") && cargando && !datos && (
          <p className="py-10 text-center text-sm text-tinta-suave">Cargando unidades vendidas…</p>
        )}

        {!error && !cargando && (tipo === "todas" || tipo === "ids") && matriz && !hayDatos && (
          <EmptyState titulo="Sin ventas registradas para esta selección." detalle="Las equivalencias elegidas no tienen unidades vendidas en ningún mes." />
        )}

        {mostrandoDatos && matriz && (
          <div className={cargando ? "space-y-4 opacity-60 transition-opacity" : "space-y-4 transition-opacity"}>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Leyenda de años">
              {matriz.anios.map((anio, i) => (
                <li key={anio} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: colorAnio(anio) }} />
                  <span className="text-tinta">{anio}</span>
                  {matriz.totalesAnio[i] === null && <span className="text-xs text-tinta-suave">(sin datos)</span>}
                </li>
              ))}
            </ul>

            <p className="min-h-5 text-sm text-tinta">
              {lectura ?? <span className="text-tinta-suave">Pasa el cursor sobre una barra para ver su valor exacto.</span>}
            </p>

            <GraficoBarras matriz={matriz} variaciones={variaciones} activa={activaVigente} onActivar={setActiva} />

            <div className="space-y-3">
              <Button variante="fantasma" tamano="sm" onClick={() => setTablaAbierta((a) => !a)} aria-expanded={tablaAbierta} aria-controls="tabla-unidades-mensuales">
                {tablaAbierta ? "Ocultar tabla" : "Ver tabla"}
              </Button>
              <div id="tabla-unidades-mensuales" hidden={!tablaAbierta}>
                {tablaAbierta && <TablaMatriz matriz={matriz} variaciones={variaciones} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
});
