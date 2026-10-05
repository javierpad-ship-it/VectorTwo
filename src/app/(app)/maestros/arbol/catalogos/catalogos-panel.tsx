"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { esAdmin, type Rol } from "@/lib/auth/roles";
import { TEMPORADAS, aCodigo, normalizarNombre, type Temporada } from "@/lib/arbol/normalizar";
import { contarNodosVigentes, useArbol } from "@/lib/arbol/use-arbol";
import type { AgrupacionTallaFila, CatalogoFila, LineaFila } from "@/lib/arbol/tipos-api";
import { CatalogoPlano, type HijosCatalogo } from "@/components/catalogo/catalogo-plano";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { BadgeTemporada, VistaPreviaNombre, mensajeError } from "../comunes";

type Pestana = "generos" | "mundos" | "lineas" | "tallas";

/** Géneros y mundos cuentan nodos del árbol; mismos textos para ambos (los dos son masculinos). */
const HIJOS_NODOS: HijosCatalogo<CatalogoFila> = {
  clave: "nodos",
  titulo: "Nodos",
  avisoDesactivar: (n) => `Quedarán ocultos ${n} nodo${n === 1 ? "" : "s"} del árbol hasta que lo reactives.`,
  bloqueoEliminar: "Tiene nodos: desactívalo en vez de eliminarlo.",
};

const NOTA_PIE_NODOS = "Desactivar oculta sus nodos del árbol sin perderlos; eliminar solo es posible sin nodos asociados.";

export function CatalogosPanel({ rol }: { rol: Rol }) {
  const [pestana, setPestana] = useState<Pestana>("generos");
  // El árbol (con inactivos) solo sirve para avisar cuántos nodos vigentes
  // quedarán ocultos al desactivar un género o mundo; los conteos de las
  // tablas vienen de la propia API de cada catálogo.
  const { arbol, error: errorArbol, setError: setErrorArbol, recargar: recargarArbol } = useArbol(true);
  const conteos = useMemo(() => contarNodosVigentes(arbol), [arbol]);
  const admin = esAdmin(rol);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Catálogos del árbol</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Géneros y mundos son la raíz del árbol y los mantiene el administrador. Las líneas las mantiene planificación.
          </p>
        </div>
        <Link
          href="/maestros/arbol"
          className="inline-flex h-10 items-center rounded-md border border-borde bg-superficie px-4 text-sm font-medium text-tinta hover:bg-neutro-suave"
        >
          Ver árbol
        </Link>
      </div>

      <Tabs<Pestana>
        items={[
          { id: "generos", label: "Géneros" },
          { id: "mundos", label: "Mundos" },
          { id: "lineas", label: "Líneas" },
          { id: "tallas", label: "Agrupaciones de talla" },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      {errorArbol && (
        <Alert onCerrar={() => setErrorArbol(null)}>
          No se pudo cargar el árbol para calcular los avisos de desactivación: {errorArbol}
        </Alert>
      )}

      {pestana === "generos" && (
        <CatalogoPlano<CatalogoFila>
          key="generos"
          recurso="generos"
          singular="género"
          plural="géneros"
          puedeEditar={admin}
          hijos={HIJOS_NODOS}
          vigentes={(f) => conteos.porGenero.get(f.id) ?? 0}
          notaPie={NOTA_PIE_NODOS}
          onCambio={recargarArbol}
        />
      )}
      {pestana === "mundos" && (
        <CatalogoPlano<CatalogoFila>
          key="mundos"
          recurso="mundos"
          singular="mundo"
          plural="mundos"
          puedeEditar={admin}
          hijos={HIJOS_NODOS}
          vigentes={(f) => conteos.porMundo.get(f.id) ?? 0}
          notaPie={NOTA_PIE_NODOS}
          onCambio={recargarArbol}
        />
      )}
      {pestana === "lineas" && <Lineas puedeEditar onCambio={recargarArbol} />}
      {pestana === "tallas" && <AgrupacionesTalla />}
    </div>
  );
}

// ─── Líneas ───

type EdicionLinea = { id: string; nombre: string; codigo: string };

function Lineas({ puedeEditar, onCambio }: { puedeEditar: boolean; onCambio: () => Promise<void> }) {
  const { datos, cargando, error, setError, recargar } = useColeccion<LineaFila>("/api/lineas?incluir_inactivos=1");
  const [form, setForm] = useState({ nombre: "", codigo: "", codigoTocado: false, temporada: "Todo el año" as Temporada });
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<EdicionLinea | null>(null);
  const [filtro, setFiltro] = useState("");

  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);
  const consulta = normalizarNombre(filtro);
  const filas = consulta ? datos.filter((l) => l.nombre.includes(consulta) || l.codigo.includes(aCodigo(consulta))) : datos;

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await Promise.all([recargar(), onCambio()]);
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreNormalizado || !codigoPropuesto) return;
    setGuardando(true);
    const ok = await ejecutar(() =>
      api.post<LineaFila>("/api/lineas", { nombre: nombreNormalizado, codigo: codigoPropuesto, temporada: form.temporada })
    );
    if (ok) {
      setAviso(`Línea ${nombreNormalizado} creada. Cuélgala de un género y mundo desde el árbol.`);
      setForm({ nombre: "", codigo: "", codigoTocado: false, temporada: "Todo el año" });
    }
    setGuardando(false);
  }

  async function guardarEdicion() {
    if (!edicion) return;
    const nombre = normalizarNombre(edicion.nombre);
    const codigo = aCodigo(edicion.codigo);
    if (!nombre || !codigo) {
      setError("El nombre y el código no pueden quedar vacíos.");
      return;
    }
    const ok = await ejecutar(() => api.patch<LineaFila>(`/api/lineas/${edicion.id}`, { nombre, codigo }));
    if (ok) setEdicion(null);
  }

  function cambiarTemporada(l: LineaFila, temporada: Temporada) {
    void ejecutar(() => api.patch<LineaFila>(`/api/lineas/${l.id}`, { temporada }));
  }

  function alternarActivo(l: LineaFila) {
    if (l.activo) {
      const detalle = l.nodos > 0 ? ` Quedarán ocultos ${l.nodos} nodo${l.nodos === 1 ? "" : "s"} del árbol hasta que la reactives.` : "";
      if (!confirm(`¿Desactivar la línea ${l.nombre}?${detalle}`)) return;
    }
    void ejecutar(() => api.patch<LineaFila>(`/api/lineas/${l.id}`, { activo: !l.activo }));
  }

  function eliminar(l: LineaFila) {
    if (!confirm(`¿Eliminar definitivamente la línea ${l.nombre}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/lineas/${l.id}`));
  }

  const columnas: Columna<LineaFila>[] = [
    {
      clave: "codigo",
      titulo: "Código",
      render: (l) =>
        edicion?.id === l.id ? (
          <Input value={edicion.codigo} onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })} className="h-8 w-44 font-mono" aria-label="Código" />
        ) : (
          <code className="font-mono text-xs">{l.codigo}</code>
        ),
    },
    {
      clave: "nombre",
      titulo: "Nombre",
      render: (l) =>
        edicion?.id === l.id ? (
          <Input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} className="h-8" aria-label="Nombre" autoFocus />
        ) : (
          <span className="font-medium">{l.nombre}</span>
        ),
    },
    {
      clave: "temporada",
      titulo: "Temporada",
      render: (l) =>
        puedeEditar ? (
          <Select
            value={l.temporada}
            onChange={(e) => cambiarTemporada(l, e.target.value as Temporada)}
            disabled={ocupado}
            className="h-8 w-36"
            aria-label={`Temporada de ${l.nombre}`}
          >
            {TEMPORADAS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        ) : (
          <BadgeTemporada temporada={l.temporada} />
        ),
    },
    {
      clave: "nodos",
      titulo: "Nodos",
      render: (l) => <span className="text-tinta-suave">en {l.nodos} nodo{l.nodos === 1 ? "" : "s"}</span>,
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (l) => <Badge tono={l.activo ? "exito" : "alerta"}>{l.activo ? "Activa" : "Desactivada"}</Badge>,
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (l) =>
        edicion?.id === l.id ? (
          <div className="flex justify-end gap-1">
            <Button tamano="sm" disabled={ocupado} onClick={guardarEdicion}>
              {ocupado ? "Guardando…" : "Guardar"}
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
              disabled={ocupado}
              onClick={() => setEdicion({ id: l.id, nombre: l.nombre, codigo: l.codigo })}
            >
              Editar
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(l)}>
              {l.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button
              variante="peligro"
              tamano="sm"
              disabled={ocupado || l.nodos > 0}
              title={l.nodos > 0 ? "Está en nodos del árbol: desactívala en vez de eliminarla." : undefined}
              onClick={() => eliminar(l)}
            >
              Eliminar
            </Button>
          </div>
        ),
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {puedeEditar && (
        <Card titulo="Nueva línea" descripcion="La línea es catálogo: existe una sola vez aunque esté en muchos cruces género-mundo.">
          <form onSubmit={crear} className="grid gap-4 md:grid-cols-4">
            <Field label="Nombre" className="md:col-span-2">
              <Input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </Field>
            <Field label="Código" hint="Solo letras, números y _.">
              <Input
                value={form.codigoTocado ? form.codigo : codigoPropuesto}
                onChange={(e) => setForm({ ...form, codigo: e.target.value, codigoTocado: true })}
                className="font-mono"
              />
            </Field>
            <Field label="Temporada">
              <Select value={form.temporada} onChange={(e) => setForm({ ...form, temporada: e.target.value as Temporada })}>
                {TEMPORADAS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-4 md:col-span-4">
              <Button type="submit" disabled={guardando || ocupado || !nombreNormalizado || !codigoPropuesto}>
                {guardando ? "Creando…" : "Crear línea"}
              </Button>
              <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
            </div>
          </form>
        </Card>
      )}

      <Card
        titulo={`Líneas (${datos.length})`}
        acciones={
          <Input
            type="search"
            placeholder="Filtrar…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="h-8 w-48"
            aria-label="Filtrar líneas"
          />
        }
      >
        <DataTable columnas={columnas} filas={filas} claveFila={(l) => l.id} cargando={cargando} vacio={consulta ? "Ninguna línea coincide." : "Sin líneas. Importa el CSV o crea la primera."} />
        <p className="mt-3 text-xs text-tinta-suave">
          Cambiar la temporada se guarda al instante y se refleja en el badge del árbol.
        </p>
      </Card>
    </div>
  );
}

// ─── Agrupaciones de talla ───

function AgrupacionesTalla() {
  const { datos, cargando, error, setError } = useColeccion<AgrupacionTallaFila>("/api/agrupaciones-talla");

  const columnas: Columna<AgrupacionTallaFila>[] = [
    { clave: "orden", titulo: "Orden", className: "w-20", render: (f) => <span className="font-mono text-xs text-tinta-suave">{f.orden}</span> },
    { clave: "codigo", titulo: "Código", render: (f) => <code className="font-mono text-xs">{f.codigo}</code> },
    { clave: "nombre", titulo: "Nombre", render: (f) => <span className="font-medium">{f.nombre}</span> },
  ];

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      <Alert tono="info">
        Catálogo fijo: la venta y el stock llegan consolidados por agrupación de talla, así que no se edita desde la pantalla.
        Un cambio acá sería una migración con su entrada en DECISIONES.
      </Alert>
      <Card titulo="Agrupaciones de talla">
        <DataTable columnas={columnas} filas={datos} claveFila={(f) => f.id} cargando={cargando} />
      </Card>
    </div>
  );
}
