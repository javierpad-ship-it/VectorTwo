"use client";

import { useMemo, useState } from "react";
import { useArbol } from "@/lib/arbol/use-arbol";
import { formatearNumero } from "@/lib/formato";
import { VENTANAS, type MarcaBarrerResumenApi } from "@/lib/marcas-barrer/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/form";
import { useListaBarrer } from "./use-marcas-barrer";
import {
  alternarOrden,
  ETIQUETA_MODALIDAD_BARRER,
  ETIQUETA_MODO,
  ETIQUETA_SOLO,
  FILTROS_VACIOS,
  filtrarLista,
  formatearFraccion,
  hayFiltros,
  opcionesFiltro,
  ordenarLista,
  ORDEN_LISTA_DEFECTO,
  ORDEN_SOLO,
  periodoCorto,
  resumenLista,
  soloFecha,
  textoErrorReparto,
  textoEstadoReparto,
  textoGmlConVenta,
  textoResumenLista,
  TONO_VEREDICTO_ERROR,
  type ClaveOrdenLista,
  type FiltrosLista,
  type OrdenLista,
  type ParametrosVista,
} from "./vista";
import { descargarLista } from "./descarga";

/**
 * Paso 0 · Lista (ficha 12, sección 4): una fila por marca al barrer o mixta, en orden de unidades de la ventana. Sale de la
 * función resumen de la API, no de los hechos. Decide qué marca abrir primero: las sin reparto bloquean a M8 para sus lotes y
 * las inestables conviene acotarlas con un alcance. Los filtros se combinan; los conteos del pie son los de lo que se ve.
 */
export function ListaMarcas({
  parametros,
  onCambiar,
  onAbrir,
}: {
  parametros: ParametrosVista;
  onCambiar: (cambios: Partial<Pick<ParametrosVista, "ventana" | "modo">>) => void;
  onAbrir: (marcaId: string) => void;
}) {
  const lista = useListaBarrer(parametros.ventana);
  const arbol = useArbol(false);
  const [filtros, setFiltros] = useState<FiltrosLista>(FILTROS_VACIOS);
  const [orden, setOrden] = useState<OrdenLista>(ORDEN_LISTA_DEFECTO);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  const datos = lista.datos;
  const marcas = useMemo(() => datos?.marcas ?? [], [datos]);
  const opciones = useMemo(() => opcionesFiltro(marcas, arbol.arbol), [marcas, arbol.arbol]);
  const visibles = useMemo(() => ordenarLista(filtrarLista(marcas, filtros), orden), [marcas, filtros, orden]);
  const resumen = useMemo(() => resumenLista(visibles), [visibles]);
  const conteoSolo = useMemo(() => {
    const base = resumenLista(filtrarLista(marcas, { ...filtros, solo: [] }));
    return { sin_reparto: base.sin_reparto, obsoletas: base.obsoletas, mixtas: base.mixtas, inestables: base.inestables };
  }, [marcas, filtros]);

  const ventana = datos?.datos.ventana ?? parametros.ventana;

  async function descargar() {
    if (!datos) return;
    setDescargando(true);
    setErrorDescarga(null);
    try {
      await descargarLista(datos, visibles, filtros, opciones);
    } catch (e) {
      setErrorDescarga(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }

  const columnas: Columna<MarcaBarrerResumenApi>[] = [
    {
      clave: "marca",
      titulo: "Marca",
      ordenable: true,
      render: (m) => (
        <div>
          <button type="button" onClick={() => onAbrir(m.id)} className="text-left font-medium text-marca-oscura underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
            {m.nombre}
          </button>
          {m.miembros.length > 0 && <p className="text-xs text-tinta-suave">+ {m.miembros.join(", ")}</p>}
        </div>
      ),
    },
    { clave: "modalidad", titulo: "Modalidad", render: (m) => <Badge tono={m.modalidad === "mixta" ? "marca" : "neutro"}>{ETIQUETA_MODALIDAD_BARRER[m.modalidad]}</Badge> },
    { clave: "agrupacion", titulo: "Agrup.", render: (m) => m.agrupacion_marca.nombre },
    { clave: "unidades", titulo: `Unid. ${ventana} m`, ordenable: true, className: "text-right tabular-nums", render: (m) => formatearNumero(m.unidades_ventana) },
    {
      clave: "barrer",
      titulo: "Al barrer",
      className: "text-right tabular-nums",
      render: (m) => formatearFraccion(m.share_barrido, 0),
    },
    {
      clave: "especifica",
      titulo: "Específica",
      className: "text-right tabular-nums",
      render: (m) => (m.modalidad === "mixta" && m.share_barrido !== null ? formatearFraccion(1 - m.share_barrido, 0) : "—"),
    },
    { clave: "gml", titulo: "GML con venta (pequeños)", className: "whitespace-nowrap tabular-nums", render: (m) => textoGmlConVenta(m) },
    {
      clave: "error",
      titulo: "Error reparto",
      ordenable: true,
      className: "whitespace-nowrap",
      render: (m) =>
        m.error_reparto.pp === null ? (
          <span className="text-tinta-suave" title="Sin dos años con datos para comprobarlo">
            —
          </span>
        ) : (
          <Badge tono={m.error_reparto.veredicto ? TONO_VEREDICTO_ERROR[m.error_reparto.veredicto] : "neutro"}>{textoErrorReparto(m.error_reparto)}</Badge>
        ),
    },
    {
      clave: "vigente",
      titulo: "Reparto vigente",
      className: "whitespace-nowrap",
      render: (m) =>
        m.vigente ? (
          <span title={m.vigente.aprobada_por_nombre ? `Aprobado por ${m.vigente.aprobada_por_nombre}` : undefined}>
            v{m.vigente.version} · {soloFecha(m.vigente.aprobada_at)}
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (m) => {
        const e = textoEstadoReparto({ vigente: m.vigente !== null, obsoleto: m.obsoleto, diferenciaPp: m.diferencia_pp });
        return <Badge tono={e.tono}>{e.texto}</Badge>;
      },
    },
    {
      clave: "abrir",
      titulo: "",
      render: (m) => (
        <Button tamano="sm" variante="secundario" onClick={() => onAbrir(m.id)} aria-label={`Abrir ${m.nombre}`}>
          Abrir
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card
        titulo="Marcas al barrer por GML"
        descripcion={
          datos?.datos.hasta_periodo
            ? `Datos hasta ${periodoCorto(datos.datos.hasta_periodo)} · ${formatearNumero(datos.datos.cargas)} ${datos.datos.cargas === 1 ? "carga publicada" : "cargas publicadas"}`
            : "Cuánto vende cada marca al barrer en cada GML y cómo repartir una compra de la marca entre ellos."
        }
        acciones={
          <div className="flex flex-wrap items-end justify-end gap-2">
            <Field label="Ventana" className="w-32">
              <Select value={parametros.ventana} onChange={(e) => onCambiar({ ventana: Number(e.target.value) as ParametrosVista["ventana"] })}>
                {VENTANAS.map((v) => (
                  <option key={v} value={v}>
                    {v} meses
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Modo del reparto" className="w-40">
              <Select value={parametros.modo} onChange={(e) => onCambiar({ modo: e.target.value as ParametrosVista["modo"] })}>
                {(Object.keys(ETIQUETA_MODO) as ParametrosVista["modo"][]).map((m) => (
                  <option key={m} value={m}>
                    {ETIQUETA_MODO[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variante="secundario" onClick={() => void lista.recargar()} disabled={lista.cargando}>
              Recargar
            </Button>
            <Button variante="secundario" onClick={() => void descargar()} disabled={!datos || descargando || visibles.length === 0}>
              {descargando ? "Generando…" : "Excel"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {lista.error && <Alert>No se pudo leer la lista de marcas: {lista.error}</Alert>}
          {errorDescarga && <Alert onCerrar={() => setErrorDescarga(null)}>{errorDescarga}</Alert>}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Modalidad">
              <Select value={filtros.modalidad} onChange={(e) => setFiltros({ ...filtros, modalidad: e.target.value as FiltrosLista["modalidad"] })}>
                <option value="todas">Todas</option>
                <option value="barrido">{ETIQUETA_MODALIDAD_BARRER.barrido}</option>
                <option value="mixta">{ETIQUETA_MODALIDAD_BARRER.mixta}</option>
              </Select>
            </Field>
            <Field label="Agrupación de marca">
              <Select value={filtros.agrupacion} onChange={(e) => setFiltros({ ...filtros, agrupacion: e.target.value })}>
                <option value="">Todas</option>
                {opciones.agrupaciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Género">
              <Select value={filtros.genero} onChange={(e) => setFiltros({ ...filtros, genero: e.target.value })}>
                <option value="">Todos</option>
                {opciones.generos.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mundo">
              <Select value={filtros.mundo} onChange={(e) => setFiltros({ ...filtros, mundo: e.target.value })}>
                <option value="">Todos</option>
                {opciones.mundos.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Línea">
              <Select value={filtros.linea} onChange={(e) => setFiltros({ ...filtros, linea: e.target.value })}>
                <option value="">Todas</option>
                {opciones.lineas.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-tinta">Solo:</span>
            <ChipsMultiples
              etiqueta="Mostrar solo"
              items={ORDEN_SOLO.map((s) => ({ id: s, label: `${ETIQUETA_SOLO[s]} (${conteoSolo[s]})` }))}
              valor={filtros.solo}
              onCambiar={(ids) => setFiltros({ ...filtros, solo: ORDEN_SOLO.filter((s) => ids.includes(s)) })}
            />
            {hayFiltros(filtros) && (
              <Button tamano="sm" variante="fantasma" onClick={() => setFiltros(FILTROS_VACIOS)}>
                Quitar filtros
              </Button>
            )}
          </div>

          {!lista.cargando && marcas.length === 0 && !lista.error ? (
            <EmptyState
              titulo="Todavía no hay marcas al barrer ni mixtas"
              detalle="Marca una marca con tratamiento especial y modalidad «Al barrer» o «Mixta» en Agrupaciones y marcas para analizarla aquí."
            />
          ) : (
            <DataTable
              columnas={columnas}
              filas={visibles}
              claveFila={(m) => m.id}
              cargando={lista.cargando && !datos}
              vacio="Ninguna marca cumple los filtros."
              ordenActual={orden}
              onOrdenar={(clave) => setOrden(alternarOrden(orden, clave as ClaveOrdenLista))}
            />
          )}

          {datos && marcas.length > 0 && (
            <p className="text-sm text-tinta-suave" aria-live="polite">
              {textoResumenLista(resumen, ventana)}
              {hayFiltros(filtros) ? ` (de ${formatearNumero(marcas.length)} en total)` : ""}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
