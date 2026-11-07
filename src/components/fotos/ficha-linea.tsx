"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, codigoDeError, ErrorApi } from "@/lib/api-client";
import { borradorDeFicha, cuerpoFichaLinea, fichaActualDeConflicto, fichaCambio, textoFichaLinea, type BorradorFichaLinea } from "@/lib/fotos/cliente";
import { MAX_DESCRIPCION_LINEA, MAX_MODELO_LINEA } from "@/lib/fotos/esquemas";
import type { LineaFichaApi } from "@/lib/fotos/tipos-api";

/**
 * Descripción y modelo de una línea (08c, §4.3, §2.7): qué es el producto y el código del proveedor, con edición en el sitio
 * («Editar» → guardar o cancelar). Va con control de concurrencia propio: manda lo que vio el formulario (`antes`) y, si otra persona
 * ya lo cambió, la API responde `409 linea_cambio`; entonces se muestra lo que hay ahora y se deja volver a guardar sobre eso. No usa la
 * revisión de la compra. Los tres roles pueden editar mientras la compra y la línea admitan cambios.
 */
export function FichaLinea({
  compraId,
  lineaId,
  descripcion,
  modelo,
  editable,
  etiqueta,
}: {
  compraId: string;
  lineaId: string;
  descripcion: string | null;
  modelo: string | null;
  editable: boolean;
  etiqueta: string;
}) {
  const [guardada, setGuardada] = useState<{ descripcion: string | null; modelo: string | null }>({ descripcion, modelo });
  const [borrador, setBorrador] = useState<BorradorFichaLinea | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actualConflicto, setActualConflicto] = useState<{ descripcion: string | null; modelo: string | null } | null>(null);

  // Si la compra se relee con valores distintos a los que tengo, me alineo (siempre que no esté editando).
  const firmaServidor = `${descripcion ?? ""}\u0000${modelo ?? ""}`;
  const [firmaVista, setFirmaVista] = useState(firmaServidor);
  if (firmaVista !== firmaServidor) {
    setFirmaVista(firmaServidor);
    if (borrador === null) setGuardada({ descripcion, modelo });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!borrador || enviando) return;
    if (!fichaCambio(guardada, borrador)) {
      setBorrador(null);
      return;
    }
    setEnviando(true);
    setError(null);
    setActualConflicto(null);
    try {
      const r = await api.patch<LineaFichaApi>(`/api/compras/${compraId}/lineas/${lineaId}/ficha`, cuerpoFichaLinea(guardada, borrador));
      setGuardada({ descripcion: r.descripcion, modelo: r.modelo });
      setBorrador(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar los cambios.");
      if (codigoDeError(err) === "linea_cambio" && err instanceof ErrorApi) {
        const actual = fichaActualDeConflicto(err.cuerpo);
        if (actual) {
          // Se toma lo que hay ahora como base: si el usuario vuelve a guardar, lo hace a sabiendas sobre eso.
          setGuardada(actual);
          setActualConflicto(actual);
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  if (borrador) {
    return (
      <form onSubmit={guardar} className="space-y-3 rounded-lg border border-borde bg-fondo/50 p-3" aria-label={`Descripción y modelo de ${etiqueta}`}>
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {actualConflicto && (
          <Alert tono="info">
            Ahora dice: {textoFichaLinea(actualConflicto)}. Si guardas, reemplazas ese valor.
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Descripción" hint="Qué es el producto («Jean slim azul medio»). Sale en las proformas.">
            <Input value={borrador.descripcion} maxLength={MAX_DESCRIPCION_LINEA} onChange={(e) => setBorrador({ ...borrador, descripcion: e.target.value })} disabled={enviando} />
          </Field>
          <Field label="Modelo" hint="Código o estilo del proveedor («DL-2231»).">
            <Input value={borrador.modelo} maxLength={MAX_MODELO_LINEA} onChange={(e) => setBorrador({ ...borrador, modelo: e.target.value })} disabled={enviando} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            variante="secundario"
            onClick={() => {
              setBorrador(null);
              setError(null);
              setActualConflicto(null);
            }}
            disabled={enviando}
          >
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  const vacia = guardada.descripcion === null && guardada.modelo === null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      <p className={`min-w-0 break-words ${vacia ? "text-tinta-suave" : "text-tinta"}`}>
        <span className="text-xs font-medium uppercase tracking-wide text-tinta-suave">Descripción · modelo </span>
        {textoFichaLinea(guardada)}
      </p>
      {editable && (
        <Button variante="fantasma" tamano="sm" onClick={() => setBorrador(borradorDeFicha(guardada))} aria-label={`Editar descripción y modelo de ${etiqueta}`}>
          Editar
        </Button>
      )}
    </div>
  );
}
