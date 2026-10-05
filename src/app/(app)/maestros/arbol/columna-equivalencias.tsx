"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { EQUIVALENCIA_GENERICA, aCodigo, esEquivalenciaIgualALinea, normalizarNombre } from "@/lib/arbol/normalizar";
import type { EquivalenciaArbol, EquivalenciaFila, GeneroArbol, LineaArbol, MundoArbol } from "@/lib/arbol/tipos-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/form";
import { DataTable, type Columna as ColumnaTabla } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Columna, VistaPreviaNombre, mensajeError } from "./comunes";

type Props = {
  genero: GeneroArbol;
  mundo: MundoArbol;
  nodo: LineaArbol;
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
  onError: (mensaje: string | null) => void;
};

type Edicion = { id: string; nombre: string; codigo: string; codigoTocado: boolean };

export function ColumnaEquivalencias({ genero, mundo, nodo, puedeEditar, onCambio, onError }: Props) {
  const [creando, setCreando] = useState(false);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const tieneGenerica = nodo.equivalencias.some((e) => e.es_generica);
  const ruta = `${genero.nombre} / ${mundo.nombre} / ${nodo.nombre}`;

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    onError(null);
    try {
      await accion();
      await onCambio();
      return true;
    } catch (e) {
      onError(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function alternarActivo(eq: EquivalenciaArbol) {
    if (eq.activo && !confirm(`¿Desactivar la equivalencia ${eq.nombre} en ${ruta}?`)) return;
    void ejecutar(() => api.patch<EquivalenciaFila>(`/api/equivalencias/${eq.id}`, { activo: !eq.activo }));
  }

  function eliminar(eq: EquivalenciaArbol) {
    if (!confirm(`¿Eliminar definitivamente la equivalencia ${eq.nombre} de ${ruta}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/equivalencias/${eq.id}`));
  }

  function agregarGenerica() {
    void ejecutar(() =>
      api.post<EquivalenciaFila>("/api/equivalencias", {
        genero_mundo_linea_id: nodo.nodo_id,
        nombre: EQUIVALENCIA_GENERICA.nombre,
      })
    );
  }

  async function guardarEdicion() {
    if (!edicion) return;
    const nombre = normalizarNombre(edicion.nombre);
    const codigo = aCodigo(edicion.codigoTocado ? edicion.codigo : nombre);
    if (!nombre || !codigo) {
      onError("El nombre y el código no pueden quedar vacíos.");
      return;
    }
    const ok = await ejecutar(() => api.patch<EquivalenciaFila>(`/api/equivalencias/${edicion.id}`, { nombre, codigo }));
    if (ok) setEdicion(null);
  }

  const columnas: ColumnaTabla<EquivalenciaArbol>[] = [
    {
      clave: "nombre",
      titulo: "Nombre",
      render: (eq) =>
        edicion?.id === eq.id ? (
          <Input
            value={edicion.nombre}
            onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
            className="h-8"
            autoFocus
            aria-label="Nuevo nombre"
          />
        ) : (
          <span className={`font-medium ${eq.activo ? "" : "text-tinta-suave"}`}>
            {eq.nombre}
            {eq.es_generica && (
              <span className="ml-2">
                <Badge tono="marca">Genérica</Badge>
              </span>
            )}
          </span>
        ),
    },
    {
      clave: "codigo",
      titulo: "Código",
      render: (eq) =>
        edicion?.id === eq.id ? (
          <Input
            value={edicion.codigoTocado ? edicion.codigo : aCodigo(edicion.nombre)}
            onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value, codigoTocado: true })}
            className="h-8 font-mono"
            aria-label="Nuevo código"
          />
        ) : (
          <code className="font-mono text-xs text-tinta-suave">{eq.codigo}</code>
        ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (eq) => <Badge tono={eq.activo ? "exito" : "alerta"}>{eq.activo ? "Activa" : "Inactiva"}</Badge>,
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (eq) =>
        edicion?.id === eq.id ? (
          <div className="flex justify-end gap-1">
            <Button tamano="sm" disabled={ocupado} onClick={guardarEdicion}>
              Guardar
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => setEdicion(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button
              variante="fantasma"
              tamano="sm"
              disabled={ocupado || eq.es_generica}
              title={eq.es_generica ? "La genérica no se renombra." : undefined}
              onClick={() => setEdicion({ id: eq.id, nombre: eq.nombre, codigo: eq.codigo, codigoTocado: true })}
            >
              Renombrar
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(eq)}>
              {eq.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => eliminar(eq)}>
              Eliminar
            </Button>
          </div>
        ),
    });
  }

  return (
    <Columna
      titulo="Equivalencias"
      subtitulo={ruta}
      acciones={
        puedeEditar && (
          <div className="flex shrink-0 gap-1">
            {!tieneGenerica && (
              <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={agregarGenerica}>
                Agregar SIN EQUIVALENCIA
              </Button>
            )}
            <Button variante="secundario" tamano="sm" onClick={() => setCreando((v) => !v)}>
              {creando ? "Cerrar" : "Nueva equivalencia"}
            </Button>
          </div>
        )
      }
    >
      {creando && puedeEditar && (
        <FormNuevaEquivalencia
          nodo={nodo}
          onError={onError}
          onCreada={async () => {
            setCreando(false);
            await onCambio();
          }}
        />
      )}

      {nodo.equivalencias.length === 0 ? (
        <EmptyState
          titulo="Este nodo no tiene equivalencias"
          detalle={puedeEditar ? "Crea una o agrega la genérica SIN EQUIVALENCIA." : undefined}
        />
      ) : (
        <DataTable columnas={columnas} filas={nodo.equivalencias} claveFila={(e) => e.id} />
      )}
    </Columna>
  );
}

function FormNuevaEquivalencia({
  nodo,
  onCreada,
  onError,
}: {
  nodo: LineaArbol;
  onCreada: () => Promise<void>;
  onError: (mensaje: string | null) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Regla de Lukers: escribir "-" significa "igual a la línea", así que la
  // equivalencia toma el nombre de la línea del nodo (igual que el importador).
  const igualALinea = esEquivalenciaIgualALinea(nombre);
  const nombreNormalizado = igualALinea ? nodo.nombre : normalizarNombre(nombre);
  const codigoPropuesto = codigoTocado ? aCodigo(codigo) : aCodigo(nombreNormalizado);
  const repetida = nodo.equivalencias.some((e) => e.nombre === nombreNormalizado);
  const listo = nombreNormalizado.length > 0 && codigoPropuesto.length > 0 && !repetida;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!listo) return;
    setGuardando(true);
    onError(null);
    try {
      await api.post<EquivalenciaFila>("/api/equivalencias", {
        genero_mundo_linea_id: nodo.nodo_id,
        nombre: nombreNormalizado,
        codigo: codigoPropuesto,
      });
      setNombre("");
      setCodigo("");
      setCodigoTocado(false);
      await onCreada();
    } catch (err) {
      onError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mb-3 space-y-3 rounded-lg border border-borde bg-fondo p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Nombre"
          hint={
            repetida
              ? "Ya existe una equivalencia con ese nombre en este nodo."
              : igualALinea
                ? "El guion significa igual a la línea: se usará su nombre."
                : "Escribe - para que se llame igual que la línea."
          }
        >
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
        </Field>
        <Field label="Código" hint="Único dentro del nodo.">
          <Input
            value={codigoTocado ? codigo : codigoPropuesto}
            onChange={(e) => {
              setCodigoTocado(true);
              setCodigo(e.target.value);
            }}
            className="font-mono"
          />
        </Field>
      </div>
      <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
      <Button type="submit" tamano="sm" disabled={!listo || guardando}>
        {guardando ? "Creando…" : "Crear equivalencia"}
      </Button>
    </form>
  );
}
