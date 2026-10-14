"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { descargarVistaCsv, descargarVistaExcel, type ColumnaGmle, type VistaDescarga } from "@/lib/reportes/descargas";
import { PAGINA_FILAS, ampliarLimite, filasPorAnadir, hayMasFilas, limitarFilas } from "@/lib/reportes/paginacion";
import { ETIQUETA_ANOMALIA_GMLE, PRIORIDAD_ANOMALIA_GMLE, type AnomaliaGmle } from "@/lib/reportes/tipos-api";
import { DESCRIPCION_ANOMALIA } from "@/lib/reportes/textos";
import { formatearNumero, mensajeError } from "@/lib/formato";
import type { Columna } from "@/components/ui/data-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Dónde se corrige cada cosa: el reporte solo enlaza, nunca escribe. */
export const RUTAS_CORRECCION = {
  asignacion: "/maestros/estacionalidad?pestana=asignacion",
  faltantes: "/maestros/estacionalidad?pestana=faltantes",
  agrupaciones: "/maestros/estacionalidad?pestana=agrupaciones",
  arbol: "/maestros/arbol",
} as const;

export function EnlaceCorreccion({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-marca-oscura underline underline-offset-2 hover:text-marca">
      {children}
    </Link>
  );
}

const TONO_PRIORIDAD = { alta: "alerta", media: "marca", baja: "neutro" } as const;

/** Chips de anomalía de una fila: el color sigue la prioridad y el tooltip explica el porqué. */
export function AnomaliaBadges({ codigos }: { codigos: readonly AnomaliaGmle[] }) {
  if (codigos.length === 0) return <span className="text-tinta-suave">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {codigos.map((c) => (
        <span key={c} title={`${DESCRIPCION_ANOMALIA[c]} Prioridad ${PRIORIDAD_ANOMALIA_GMLE[c]}.`}>
          <Badge tono={TONO_PRIORIDAD[PRIORIDAD_ANOMALIA_GMLE[c]]}>{ETIQUETA_ANOMALIA_GMLE[c]}</Badge>
        </span>
      ))}
    </span>
  );
}

/**
 * Columnas de `DataTable` a partir de las de descarga: misma `clave`, mismo
 * orden y mismo título, ordenables por el valor de la descarga. `render`
 * sobrescribe la celda de las que en pantalla llevan badge o punto.
 */
export function columnasDeTabla<T>(
  columnas: readonly ColumnaGmle<T>[],
  render: Partial<Record<string, (fila: T) => ReactNode>> = {},
  className: Partial<Record<string, string>> = {}
): Columna<T>[] {
  return columnas.map((c) => ({
    clave: c.clave,
    titulo: c.titulo,
    ordenable: true,
    className: className[c.clave],
    render: render[c.clave] ?? ((f: T) => c.valor(f)),
  }));
}

/** Botones "Descargar CSV" y "Descargar Excel" sobre lo filtrado y en el orden visible. */
export function BotonesDescarga<T>({
  vista,
  columnas,
  filas,
}: {
  vista: VistaDescarga;
  columnas: readonly ColumnaGmle<T>[];
  filas: readonly T[];
}) {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function csv() {
    setError(null);
    try {
      descargarVistaCsv(vista, columnas, filas);
    } catch (e) {
      setError(`No se pudo generar el CSV: ${mensajeError(e)}`);
    }
  }

  async function excel() {
    setGenerando(true);
    setError(null);
    try {
      await descargarVistaExcel(vista, columnas, filas);
    } catch (e) {
      setError(`No se pudo generar el Excel: ${mensajeError(e)}`);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variante="secundario" tamano="sm" onClick={csv} disabled={filas.length === 0}>
          Descargar CSV
        </Button>
        <Button variante="secundario" tamano="sm" onClick={() => void excel()} disabled={filas.length === 0 || generando}>
          {generando ? "Generando Excel…" : "Descargar Excel"}
        </Button>
      </div>
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
    </div>
  );
}

/**
 * Limita las filas que se pintan (`PAGINA_FILAS` al inicio, otras tantas con
 * "Mostrar más"). El límite vuelve a una página cuando cambia la lista (otro
 * filtro u otro orden): se compara la identidad del arreglo en vez de usar un
 * efecto. Quien descarga debe seguir usando `filas` completo, no `mostradas`.
 */
export function useFilasLimitadas<T>(filas: readonly T[]) {
  const [estado, setEstado] = useState<{ para: readonly T[]; limite: number }>({ para: filas, limite: PAGINA_FILAS });
  const limite = estado.para === filas ? estado.limite : PAGINA_FILAS;
  const mostradas = useMemo(() => limitarFilas(filas, limite), [filas, limite]);
  return {
    mostradas,
    total: filas.length,
    hayMas: hayMasFilas(limite, filas.length),
    siguiente: filasPorAnadir(limite, filas.length),
    mostrarMas: () => setEstado({ para: filas, limite: ampliarLimite(limite, filas.length) }),
  };
}

/** Pie de una tabla limitada: "Mostrando X de Y" y el botón "Mostrar N más". Sin nada que paginar no pinta nada. */
export function PieMostrarMas({
  mostradas,
  total,
  siguiente,
  hayMas,
  onMostrarMas,
}: {
  mostradas: number;
  total: number;
  siguiente: number;
  hayMas: boolean;
  onMostrarMas: () => void;
}) {
  if (total <= PAGINA_FILAS) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-tinta-suave" aria-live="polite">
      <span>
        Mostrando {formatearNumero(mostradas)} de {formatearNumero(total)} filas. La descarga incluye todas las filtradas.
      </span>
      {hayMas && (
        <Button variante="secundario" tamano="sm" onClick={onMostrarMas}>
          Mostrar {formatearNumero(siguiente)} más
        </Button>
      )}
    </div>
  );
}
