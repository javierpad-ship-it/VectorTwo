"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import type {
  CrearUbicacionIgnoradaPeticion,
  EditarUbicacionIgnoradaPeticion,
  UbicacionIgnoradaApi,
} from "@/lib/tiendas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { formatearFechaCorta } from "./comunes";

const URL_UBICACIONES = "/api/tiendas/ubicaciones-ignoradas";
const NOMBRE_MAX = 120;
const NOTA_MAX = 200;

/** Motivo por el que no se puede guardar (cliente), o `null`. Corre antes que la API. */
function motivoNoGuardar(nombre: string, nota: string): string | null {
  const n = normalizarNombre(nombre);
  if (n === "") return "El nombre es obligatorio.";
  if (n.length > NOMBRE_MAX) return `El nombre no puede superar ${NOMBRE_MAX} caracteres.`;
  if (nota.trim().length > NOTA_MAX) return `La nota no puede superar ${NOTA_MAX} caracteres.`;
  return null;
}

/**
 * Pestaña Ubicaciones ignoradas (ficha M5c): los nombres de la columna TIENDA del archivo de venta que no
 * son tiendas. Alta en línea; nombre y nota se editan en un diálogo; quitar pide confirmación.
 * Solo se monta para planner y admin (la API exige `requirePlanner`, lecturas incluidas).
 */
export function UbicacionesTab({
  ubicaciones,
  cargando,
  onCambio,
  onIrATiendas,
}: {
  ubicaciones: UbicacionIgnoradaApi[];
  cargando: boolean;
  onCambio: () => Promise<void>;
  /** Cambia a la pestaña Tiendas (el badge «Sin efecto» enlaza ahí). */
  onIrATiendas: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<UbicacionIgnoradaApi | null>(null);

  const nombreNormal = normalizarNombre(nombre);
  const motivoForm = motivoNoGuardar(nombre, nota);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (motivoForm || guardando) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const cuerpo: CrearUbicacionIgnoradaPeticion = { nombre: nombreNormal, nota: nota.trim() === "" ? null : nota.trim() };
      const creada = await api.post<UbicacionIgnoradaApi>(URL_UBICACIONES, cuerpo);
      setAviso(`«${creada.nombre}» se añadió a las ubicaciones ignoradas.`);
      setNombre("");
      setNota("");
      await onCambio();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(u: UbicacionIgnoradaApi) {
    if (!confirm(`«${u.nombre}» volverá a salir como tienda desconocida en la próxima lectura. ¿Quitarla de la lista?`)) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await api.delete<{ id: string }>(`${URL_UBICACIONES}/${u.id}`);
      setAviso(`«${u.nombre}» se quitó de las ubicaciones ignoradas.`);
      await onCambio();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(false);
    }
  }

  const columnas: Columna<UbicacionIgnoradaApi>[] = [
    { clave: "nombre", titulo: "Nombre", render: (u) => <span className="font-medium">{u.nombre}</span> },
    { clave: "nota", titulo: "Nota", render: (u) => (u.nota ? <span>{u.nota}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "creada", titulo: "Creada", render: (u) => <span className="whitespace-nowrap font-mono text-xs">{formatearFechaCorta(u.created_at)}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (u) =>
        u.sin_efecto ? (
          <div className="space-y-1">
            <Badge tono="alerta">Sin efecto: existe la tienda {u.sin_efecto.codigo}</Badge>
            <div className="text-xs text-tinta-suave">
              {u.sin_efecto.activo ? "La tienda manda: sus filas se cargan como tienda." : "La tienda manda: sus filas salen como «Tienda desactivada»."}{" "}
              <button type="button" onClick={onIrATiendas} className="font-medium text-marca-oscura underline underline-offset-2">
                Ver en Tiendas
              </button>
            </div>
          </div>
        ) : (
          <Badge tono="exito">En efecto</Badge>
        ),
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (u) => (
        <div className="flex justify-end gap-1">
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => setEditando(u)} aria-label={`Editar ${u.nombre}`}>
            Editar
          </Button>
          <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => void quitar(u)} aria-label={`Quitar ${u.nombre}`}>
            Quitar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      <Card
        titulo="Nueva ubicación ignorada"
        descripcion="Nombres de la columna TIENDA del archivo de venta que no son tiendas (central, oficinas, almacenes de muestras). Sus filas quedan fuera de toda carga como decisión, sin contar como error ni crear tiendas. Si existe una tienda con el mismo nombre, la tienda manda."
      >
        <form onSubmit={crear} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <Field
            label="Nombre"
            hint={nombre.trim() === "" ? "Tal como viene en la columna TIENDA del archivo." : nombreNormal ? `Se guardará como ${nombreNormal}` : "El nombre es obligatorio."}
          >
            <Input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Central ejemplo" maxLength={NOMBRE_MAX + 40} />
          </Field>
          <Field label="Nota" hint={`Opcional. ${nota.trim().length}/${NOTA_MAX}`}>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Oficina administrativa, solo stock de muestras" maxLength={NOTA_MAX + 40} />
          </Field>
          <div className="md:pt-6">
            <Button type="submit" disabled={guardando || ocupado || motivoForm !== null} title={motivoForm ?? undefined}>
              {guardando ? "Añadiendo…" : "Añadir ubicación"}
            </Button>
          </div>
        </form>
      </Card>

      <Card titulo={`Ubicaciones ignoradas (${ubicaciones.length})`}>
        <DataTable
          columnas={columnas}
          filas={ubicaciones}
          claveFila={(u) => u.id}
          cargando={cargando}
          vacio="Todavía no hay ubicaciones ignoradas. También puedes añadirlas desde el reporte previo de la carga de venta."
        />
        <p className="mt-3 text-xs text-tinta-suave">
          Quitar una ubicación no cambia lo ya cargado: en la próxima lectura del archivo volverá a salir como tienda desconocida.
        </p>
      </Card>

      {editando && (
        <EditarUbicacion
          ubicacion={editando}
          onCerrar={() => setEditando(null)}
          onGuardada={async (u) => {
            setAviso(`«${u.nombre}» se actualizó.`);
            setEditando(null);
            await onCambio();
          }}
        />
      )}
    </div>
  );
}

/** Diálogo para cambiar el nombre y la nota de una ubicación (un `PATCH` con lo que cambió). */
function EditarUbicacion({
  ubicacion,
  onCerrar,
  onGuardada,
}: {
  ubicacion: UbicacionIgnoradaApi;
  onCerrar: () => void;
  onGuardada: (u: UbicacionIgnoradaApi) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(ubicacion.nombre);
  const [nota, setNota] = useState(ubicacion.nota ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const motivo = motivoNoGuardar(nombre, nota);
  const cuerpo: EditarUbicacionIgnoradaPeticion = {};
  if (normalizarNombre(nombre) !== ubicacion.nombre) cuerpo.nombre = normalizarNombre(nombre);
  if ((nota.trim() || null) !== ubicacion.nota) cuerpo.nota = nota.trim() === "" ? null : nota.trim();
  const sinCambios = Object.keys(cuerpo).length === 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo || enviando) return;
    if (sinCambios) {
      onCerrar();
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const u = await api.patch<UbicacionIgnoradaApi>(`${URL_UBICACIONES}/${ubicacion.id}`, cuerpo);
      await onGuardada(u);
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={`Editar «${ubicacion.nombre}»`}
      descripcion="El nombre se guarda normalizado (mayúsculas, sin espacios de más) y debe ser el que trae el archivo de venta."
      onCerrar={onCerrar}
      cerrable={!enviando}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-editar-ubicacion" disabled={enviando || motivo !== null || sinCambios} title={motivo ?? (sinCambios ? "No hay nada que cambiar." : undefined)}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="form-editar-ubicacion" onSubmit={enviar} className="space-y-4">
        <Field label="Nombre" hint={normalizarNombre(nombre) ? `Se guardará como ${normalizarNombre(nombre)}` : "El nombre es obligatorio."}>
          <Input required value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={enviando} autoFocus />
        </Field>
        <Field label="Nota" hint={`Opcional. ${nota.trim().length}/${NOTA_MAX}`}>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} disabled={enviando} maxLength={NOTA_MAX + 40} />
        </Field>
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      </form>
    </Modal>
  );
}
