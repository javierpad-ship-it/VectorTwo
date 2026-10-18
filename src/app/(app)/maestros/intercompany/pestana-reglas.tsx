"use client";

import { useMemo, useState } from "react";
import type { ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { mensajeError } from "@/lib/formato";
import { CeldaAplicable, CeldaImi, CeldaPctDirecto, CeldaRuta } from "./comunes";
import { descargarReglas } from "./descarga";
import { COLUMNAS_REGLAS, filtrosTexto, type ClaveColumnaRegla } from "./excel-vista";
import { hayFiltrosActivos, ordenarReglas, periodoCorto, resumenReglas, textoObservado, textoResumen, textoTablaVacia, type NodoIntercompany, type ParametrosVista } from "./vista";

/**
 * Pestaña Reglas (ficha 13, sección 4): una fila por clave con la regla vigente en el mes elegido. Las filas son las que dejan los
 * filtros y son también las del Excel. Sin ninguna regla se muestra el estado vacío con "Nueva regla".
 */
export function PestanaReglas({
  reglas,
  mes,
  cargando,
  sinReglas,
  vigentesEnMes,
  parametros,
  nodos,
  marcas,
  onNueva,
  onNuevaVigencia,
  onVerHistorial,
}: {
  reglas: readonly ReglaIntercompanyApi[];
  mes: string;
  cargando: boolean;
  /** No hay ninguna regla creada (ni siquiera en el historial). */
  sinReglas: boolean;
  /** Cuántas reglas rigen en el mes antes de aplicar los filtros (si hay y la tabla queda vacía, las oculta el filtro). Por defecto las que se ven. */
  vigentesEnMes?: number;
  parametros: ParametrosVista;
  nodos: readonly NodoIntercompany[];
  marcas: readonly { id: string; nombre: string }[];
  onNueva: () => void;
  onNuevaVigencia: (base: ReglaIntercompanyApi) => void;
  onVerHistorial: (regla: ReglaIntercompanyApi) => void;
}) {
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const filas = useMemo(() => ordenarReglas(reglas), [reglas]);
  const resumen = useMemo(() => resumenReglas(filas), [filas]);

  async function descargar() {
    setDescargando(true);
    setErrorDescarga(null);
    try {
      await descargarReglas(filas, filtrosTexto(parametros, mes, nodos, marcas));
    } catch (e) {
      setErrorDescarga(mensajeError(e));
    } finally {
      setDescargando(false);
    }
  }

  const render: Record<ClaveColumnaRegla, (r: ReglaIntercompanyApi) => React.ReactNode> = {
    marca: (r) => <span className="font-medium">{r.marca}</span>,
    ruta: (r) => <CeldaRuta regla={r} />,
    desde: (r) => <span className="whitespace-nowrap">{periodoCorto(r.vigente_desde)}</span>,
    min: (r) => <CeldaImi valor={r.imi_min} defecto={r.es_rango_defecto} />,
    max: (r) => <CeldaImi valor={r.imi_max} />,
    directo: (r) => <CeldaPctDirecto regla={r} />,
    // El % del CD ya va bajo el % directo: la columna solo existe en el Excel, no en la tabla.
    del_cd: () => null,
    observado: (r) => <span className="whitespace-nowrap font-mono text-xs tabular-nums">{textoObservado(r.pct_directo_observado)}</span>,
    aplicable: (r) => <CeldaAplicable regla={r} />,
    nota: (r) => <span className="text-tinta-suave">{r.nota ?? "—"}</span>,
  };
  const alineadas: ClaveColumnaRegla[] = ["min", "max", "directo", "observado"];
  const columnas: Columna<ReglaIntercompanyApi>[] = [
    ...COLUMNAS_REGLAS.filter((c) => c.clave !== "del_cd").map((c) => ({
      clave: c.clave,
      titulo: c.clave === "min" ? "IMI mín" : c.titulo,
      render: render[c.clave],
      className: alineadas.includes(c.clave) ? "text-right" : undefined,
    })),
    {
      clave: "acciones",
      titulo: "Acciones",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <Button variante="secundario" tamano="sm" onClick={() => onNuevaVigencia(r)}>
            Nueva vigencia
          </Button>
          <Button variante="fantasma" tamano="sm" onClick={() => onVerHistorial(r)}>
            Historial
          </Button>
        </span>
      ),
    },
  ];

  if (sinReglas) {
    return (
      <EmptyState titulo="Todavía no hay reglas de intercompany" detalle="Crea la primera: elige la marca, el GML, desde qué mes rige, el rango IMI (4–8 por defecto) y el % que llega directo.">
        <Button onClick={onNueva}>+ Nueva regla</Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta-suave" aria-live="polite">
          {textoResumen(resumen)}
        </p>
        <Button variante="secundario" tamano="sm" onClick={() => void descargar()} disabled={descargando || filas.length === 0}>
          {descargando ? "Generando…" : "Excel"}
        </Button>
      </div>
      {errorDescarga && <Alert onCerrar={() => setErrorDescarga(null)}>{errorDescarga}</Alert>}
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(r) => r.id}
        cargando={cargando}
        vacio={textoTablaVacia({ mes, filtrosActivos: hayFiltrosActivos(parametros), vigentesEnMes: vigentesEnMes ?? reglas.length })}
      />
    </div>
  );
}
