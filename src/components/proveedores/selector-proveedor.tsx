"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { api, codigoDeError, ErrorApi } from "@/lib/api-client";
import type { ParecidoProveedorApi, ProveedorFichaApi } from "@/lib/proveedores/tipos-api";
import { hayNombreIgual, normalizarTexto, textoParecido } from "./vista-proveedores";

export type OpcionProveedor = { id: string; nombre: string };

const MAX_OPCIONES = 8;

function listaDe(cuerpo: Record<string, unknown> | null, clave: string): unknown {
  return cuerpo ? cuerpo[clave] : undefined;
}

function parecidosDe(e: unknown): ParecidoProveedorApi[] {
  const l = e instanceof ErrorApi ? listaDe(e.cuerpo, "parecidos") : undefined;
  return Array.isArray(l) ? (l as ParecidoProveedorApi[]) : [];
}

/**
 * Autocompletado de proveedores activos con la opción «Crear «X»» (alta al vuelo, 08c, §4.2). Lo usan la captura de compras (`0.13.1`) y los
 * filtros. Al crear, la API (`modo: "rapido"`) frena dos casos: un nombre repetido («usar el existente», o «está inactivo: pide a un admin o
 * planner que lo reactive») y un nombre parecido (pregunta «¿es alguno de estos?» con [Usar este] y [No, crear «X»]). Lo creado al vuelo sale
 * con «Ficha incompleta» y se completa después en Proveedores. Es un combobox accesible: flechas, Enter y Esc.
 */
export function SelectorProveedor({
  etiqueta = "Proveedor",
  proveedores,
  valor,
  onElegir,
  onCreado,
  permitirCrear = true,
  deshabilitado = false,
}: {
  etiqueta?: string;
  /** Solo los activos (el listado con `?activos=1`). */
  proveedores: readonly OpcionProveedor[];
  /** El id elegido, o `null`. */
  valor: string | null;
  onElegir: (p: OpcionProveedor) => void;
  /** Tras crear uno: para que quien lo usa recargue su lista. */
  onCreado?: (ficha: ProveedorFichaApi) => void | Promise<void>;
  permitirCrear?: boolean;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const [texto, setTexto] = useState(() => proveedores.find((p) => p.id === valor)?.nombre ?? "");
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usarExistente, setUsarExistente] = useState<OpcionProveedor | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [parecidos, setParecidos] = useState<ParecidoProveedorApi[] | null>(null);

  const q = normalizarTexto(texto);
  const coincidencias = proveedores.filter((p) => q === "" || normalizarTexto(p.nombre).includes(q)).slice(0, MAX_OPCIONES);
  const nombreNuevo = texto.trim();
  const puedeCrear = permitirCrear && nombreNuevo !== "" && !hayNombreIgual(proveedores, nombreNuevo);
  // Las opciones navegables con el teclado: las coincidencias y, al final, «Crear».
  const total = coincidencias.length + (puedeCrear ? 1 : 0);

  function elegir(p: OpcionProveedor) {
    setTexto(p.nombre);
    setAbierto(false);
    setError(null);
    setUsarExistente(null);
    setParecidos(null);
    onElegir(p);
  }

  async function crear(confirmarParecido: boolean) {
    if (creando) return;
    setCreando(true);
    setError(null);
    setUsarExistente(null);
    setAviso(null);
    try {
      const ficha = await api.post<ProveedorFichaApi>("/api/compras/proveedores", { modo: "rapido", nombre: nombreNuevo, ...(confirmarParecido ? { confirmar_parecido: true } : {}) });
      setParecidos(null);
      setAbierto(false);
      setTexto(ficha.nombre);
      setAviso(`«${ficha.nombre}» se creó con la ficha incompleta: complétala en Compras → Proveedores.`);
      await onCreado?.(ficha);
      onElegir({ id: ficha.id, nombre: ficha.nombre });
    } catch (e) {
      const codigo = codigoDeError(e);
      if (codigo === "nombre_parecido") {
        setParecidos(parecidosDe(e));
      } else {
        setParecidos(null);
        setError(e instanceof Error ? e.message : "No pudimos crear el proveedor.");
        if (codigo === "nombre_repetido" && e instanceof ErrorApi) {
          const c = listaDe(e.cuerpo, "conflicto") as { id?: unknown; nombre?: unknown; activo?: unknown } | undefined;
          if (c && typeof c.id === "string" && typeof c.nombre === "string" && c.activo !== false) setUsarExistente({ id: c.id, nombre: c.nombre });
        }
      }
    } finally {
      setCreando(false);
    }
  }

  function alPulsar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAbierto(true);
      setResaltado((i) => Math.min(total - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && abierto && total > 0) {
      e.preventDefault();
      if (resaltado < coincidencias.length) elegir(coincidencias[resaltado]);
      else void crear(false);
    } else if (e.key === "Escape") {
      setAbierto(false);
    }
  }

  const idLista = `${id}-lista`;
  return (
    <div className="space-y-2">
      <div className="relative">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-tinta">{etiqueta}</span>
          <Input
            role="combobox"
            aria-expanded={abierto}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={abierto && total > 0 ? `${id}-op-${resaltado}` : undefined}
            autoComplete="off"
            value={texto}
            disabled={deshabilitado || creando}
            placeholder="Escribe para buscar o crear…"
            onChange={(e) => {
              setTexto(e.target.value);
              setAbierto(true);
              setResaltado(0);
              setError(null);
              setAviso(null);
              setUsarExistente(null);
            }}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            onKeyDown={alPulsar}
          />
        </label>
        {abierto && total > 0 && (
          <ul id={idLista} role="listbox" aria-label={`Opciones de ${etiqueta.toLowerCase()}`} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-borde bg-superficie py-1 shadow-lg">
            {coincidencias.map((p, i) => (
              <li
                key={p.id}
                id={`${id}-op-${i}`}
                role="option"
                aria-selected={p.id === valor}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(p)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === resaltado ? "bg-marca-suave text-marca-oscura" : "text-tinta hover:bg-neutro-suave"}`}
              >
                {p.nombre}
              </li>
            ))}
            {puedeCrear && (
              <li
                id={`${id}-op-${coincidencias.length}`}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void crear(false)}
                className={`cursor-pointer border-t border-borde px-3 py-2 text-sm font-medium ${coincidencias.length === resaltado ? "bg-marca-suave text-marca-oscura" : "text-marca-oscura hover:bg-neutro-suave"}`}
              >
                Crear «{nombreNuevo}»
              </li>
            )}
          </ul>
        )}
      </div>
      {creando && <p className="text-xs text-tinta-suave">Creando el proveedor…</p>}
      {error && (
        <Alert onCerrar={() => setError(null)}>
          {error}
          {usarExistente && (
            <>
              {" "}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => elegir(usarExistente)}>
                Usar «{usarExistente.nombre}»
              </button>
            </>
          )}
        </Alert>
      )}
      {aviso && (
        <Alert tono="info" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}
      {parecidos && (
        <Modal
          titulo="¿Es alguno de estos?"
          descripcion={`Ya hay proveedores con un nombre parecido a «${nombreNuevo}».`}
          onCerrar={() => setParecidos(null)}
          cerrable={!creando}
          ancho="max-w-lg"
          pie={
            <>
              <Button variante="secundario" onClick={() => setParecidos(null)} disabled={creando}>
                Cancelar
              </Button>
              <Button onClick={() => void crear(true)} disabled={creando}>
                No, crear «{nombreNuevo}»
              </Button>
            </>
          }
        >
          <ul className="space-y-2">
            {parecidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-borde px-3 py-2 text-sm">
                <span className="min-w-0 break-words">{textoParecido(p)}</span>
                <Button variante="secundario" tamano="sm" onClick={() => elegir({ id: p.id, nombre: p.nombre })} disabled={creando}>
                  Usar este
                </Button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
