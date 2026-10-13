"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import type { InformeCarga } from "@/lib/ventas/tipos";
import type { ResolucionTiendaApi } from "@/lib/ventas/tipos-api";
import { formatearEntero, formatearPorcentaje, formatearSoles } from "./comunes";

/** Una tienda del archivo (desconocida o ignorada) sumada en todos los meses. */
export type GrupoTienda = {
  valor: string;
  filas: number;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
  meses: number;
  /** Peso sobre todo el archivo (todos los meses), en 0 a 100. */
  pct_filas: number;
  pct_venta: number;
  pct_stock: number;
};

const porcentajeDe = (parte: number, total: number): number => (total === 0 ? 0 : (Math.abs(parte) / Math.abs(total)) * 100);

/** Valores de la columna TIENDA con ese motivo de exclusión, sumados en todos los meses, de más a menos filas. */
export function agruparPorTienda(informe: InformeCarga, motivo: "tienda_desconocida" | "ubicacion_ignorada"): GrupoTienda[] {
  const mapa = new Map<string, GrupoTienda>();
  const total = { filas: 0, venta: 0, stock: 0 };
  for (const m of informe.meses) {
    total.filas += m.archivo.filas;
    total.venta += m.archivo.venta_soles;
    total.stock += m.archivo.stock_valorizado;
    for (const e of m.exclusiones) {
      if (e.motivo !== motivo) continue;
      const g = mapa.get(e.valor) ?? {
        valor: e.valor,
        filas: 0,
        unidades: 0,
        venta_soles: 0,
        costo_vendido: 0,
        stock_unidades: 0,
        stock_valorizado: 0,
        meses: 0,
        pct_filas: 0,
        pct_venta: 0,
        pct_stock: 0,
      };
      g.filas += e.filas;
      g.unidades += e.unidades;
      g.venta_soles += e.venta_soles;
      g.costo_vendido += e.costo_vendido;
      g.stock_unidades += e.stock_unidades;
      g.stock_valorizado += e.stock_valorizado;
      g.meses += 1;
      mapa.set(e.valor, g);
    }
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, pct_filas: porcentajeDe(g.filas, total.filas), pct_venta: porcentajeDe(g.venta_soles, total.venta), pct_stock: porcentajeDe(g.stock_valorizado, total.stock) }))
    .sort((a, b) => b.filas - a.filas);
}

function Pct({ valor }: { valor: number }) {
  return <span className="text-xs text-tinta-suave"> ({formatearPorcentaje(valor)})</span>;
}

const nombreLegible = (valor: string) => (valor === "" ? "(vacía)" : valor);

// ─── Tiendas desconocidas, con el atajo "Ignorar esta ubicación" ───

/** Tiendas del archivo que no existen en el sistema y no son una ubicación ignorada. */
export function TiendasDesconocidas({
  tiendas,
  puedeIgnorar,
  recalculando,
  onIgnorar,
}: {
  tiendas: GrupoTienda[];
  /** Hay lectura en memoria y nada en marcha: se puede guardar y recalcular. */
  puedeIgnorar: boolean;
  recalculando: boolean;
  onIgnorar: (grupo: GrupoTienda) => void;
}) {
  const columnas: Columna<GrupoTienda>[] = [
    { clave: "valor", titulo: "Tienda del archivo", render: (t) => <span className="font-medium">{nombreLegible(t.valor)}</span> },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (t) => formatearNumero(t.filas) },
    { clave: "meses", titulo: "Meses", className: "text-right font-mono", render: (t) => formatearNumero(t.meses) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (t) => formatearSoles(t.venta_soles) },
    { clave: "stock", titulo: "Stock a costo", className: "text-right font-mono", render: (t) => formatearSoles(t.stock_valorizado) },
    {
      clave: "ignorar",
      titulo: "",
      render: (t) =>
        t.valor === "" ? null : (
          <Button
            variante="secundario"
            tamano="sm"
            disabled={!puedeIgnorar}
            title={puedeIgnorar ? undefined : "Hace falta la lectura del archivo en esta pantalla y que no haya nada en marcha: vuelve a leer el archivo."}
            onClick={() => onIgnorar(t)}
            aria-label={`Ignorar la ubicación ${t.valor}`}
          >
            Ignorar esta ubicación
          </Button>
        ),
    },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Tiendas desconocidas</h3>
      <Alert>
        <strong>{plural(tiendas.length, "tienda del archivo no existe", "tiendas del archivo no existen")} en el sistema</strong> y sus filas no se cargan. Si es una tienda real, créala o
        corrige su nombre en{" "}
        <Link href="/maestros/tiendas" className="underline underline-offset-2">
          Tiendas y aperturas
        </Link>
        ; si <strong>no es una tienda</strong> (la central, una oficina), pulsa <em>Ignorar esta ubicación</em>: sus filas quedarán fuera como decisión, sin contar como error.
      </Alert>
      {recalculando && (
        <p role="status" className="text-sm text-tinta-suave">
          Recalculando el reporte…
        </p>
      )}
      <DataTable columnas={columnas} filas={tiendas} claveFila={(t) => t.valor} />
    </div>
  );
}

// ─── Ubicaciones ignoradas (decisión, no error) ───

/** Las ubicaciones que ya están en la lista, con su línea propia: son una exclusión por decisión y no suman al porcentaje de errores. */
export function UbicacionesIgnoradas({ ubicaciones, notas }: { ubicaciones: GrupoTienda[]; notas: ReadonlyMap<string, string> }) {
  const columnas: Columna<GrupoTienda>[] = [
    {
      clave: "valor",
      titulo: "Ubicación del archivo",
      render: (u) => (
        <div>
          <span className="font-medium">{nombreLegible(u.valor)}</span>
          {notas.get(u.valor) && <div className="text-xs text-tinta-suave">{notas.get(u.valor)}</div>}
        </div>
      ),
    },
    {
      clave: "filas",
      titulo: "Filas",
      className: "text-right font-mono",
      render: (u) => (
        <>
          {formatearNumero(u.filas)}
          <Pct valor={u.pct_filas} />
        </>
      ),
    },
    { clave: "meses", titulo: "Meses", className: "text-right font-mono", render: (u) => formatearNumero(u.meses) },
    { clave: "unidades", titulo: "Unidades", className: "text-right font-mono", render: (u) => formatearEntero(u.unidades) },
    {
      clave: "venta",
      titulo: "Venta",
      className: "text-right font-mono",
      render: (u) => (
        <>
          {formatearSoles(u.venta_soles)}
          <Pct valor={u.pct_venta} />
        </>
      ),
    },
    { clave: "costo", titulo: "Costo", className: "text-right font-mono", render: (u) => formatearSoles(u.costo_vendido) },
    { clave: "stock_u", titulo: "Stock (u.)", className: "text-right font-mono", render: (u) => formatearEntero(u.stock_unidades) },
    {
      clave: "stock",
      titulo: "Stock a costo",
      className: "text-right font-mono",
      render: (u) => (
        <>
          {formatearSoles(u.stock_valorizado)}
          <Pct valor={u.pct_stock} />
        </>
      ),
    },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Ubicaciones ignoradas</h3>
      <p className="text-xs text-tinta-suave">
        {plural(ubicaciones.length, "ubicación del archivo está", "ubicaciones del archivo están")} en la lista de ubicaciones ignoradas: no son tiendas. Sus filas quedan fuera como decisión
        (no cuentan en el porcentaje de errores ni crean tiendas) y aparecen también en «Excluidas por decisión» del detalle de cada mes. La lista se administra en{" "}
        <Link href="/maestros/tiendas" className="underline underline-offset-2">
          Maestros → Tiendas → Ubicaciones ignoradas
        </Link>
        ; para quitar una hay que volver a leer el archivo.
      </p>
      <DataTable columnas={columnas} filas={ubicaciones} claveFila={(u) => u.valor} />
    </div>
  );
}

/** Notas de las ubicaciones ignoradas que devolvió `previsualizar`, por nombre. */
export function notasDeIgnoradas(tiendas: readonly ResolucionTiendaApi[]): Map<string, string> {
  const notas = new Map<string, string>();
  for (const t of tiendas) if (t.resultado === "ignorada" && t.nota) notas.set(t.valor, t.nota);
  return notas;
}

// ─── Diálogo de confirmación con nota ───

const NOTA_MAX = 200;

/**
 * Confirmación de "Ignorar esta ubicación": dice qué se ignora y cuánto pesa en todos los meses del
 * archivo, deja escribir una nota opcional y, al confirmar, guarda y recalcula sin releer. Si falla
 * (por ejemplo, un `409` porque alguien creó la tienda), el error se muestra aquí y no se cierra.
 */
export function IgnorarUbicacion({
  grupo,
  confirmar,
  onCerrar,
}: {
  grupo: GrupoTienda;
  confirmar: (valor: string, nota: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando || nota.length > NOTA_MAX) return;
    setEnviando(true);
    setError(null);
    try {
      await confirmar(grupo.valor, nota);
      onCerrar();
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={`Ignorar «${grupo.valor}»`}
      descripcion="No es una tienda: sus filas quedarán fuera de toda carga como decisión, sin contar como error."
      onCerrar={onCerrar}
      cerrable={!enviando}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-ignorar-ubicacion" disabled={enviando || nota.length > NOTA_MAX}>
            {enviando ? "Ignorando y recalculando…" : "Ignorar esta ubicación"}
          </Button>
        </>
      }
    >
      <form id="form-ignorar-ubicacion" onSubmit={enviar} className="space-y-4">
        <p className="text-sm">
          «<strong>{grupo.valor}</strong>» tiene {plural(grupo.filas, "fila", "filas")} en {plural(grupo.meses, "mes", "meses")} del archivo ({formatearPorcentaje(grupo.pct_filas)} de las filas,{" "}
          {formatearPorcentaje(grupo.pct_venta)} de la venta y {formatearPorcentaje(grupo.pct_stock)} del stock a costo). Se guarda en la lista de ubicaciones ignoradas y el reporte se recalcula sin
          releer el archivo; los totales de QlikView que ya escribiste se conservan.
        </p>
        <Field label="Nota (opcional)" hint={`Para qué sirve esta ubicación, por ejemplo «Oficina administrativa, solo stock de muestras». ${nota.length}/${NOTA_MAX}`}>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={NOTA_MAX} disabled={enviando} autoFocus />
        </Field>
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      </form>
    </Modal>
  );
}
