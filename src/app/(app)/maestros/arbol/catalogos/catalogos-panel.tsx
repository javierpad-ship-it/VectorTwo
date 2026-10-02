"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { esAdmin, type Rol } from "@/lib/auth/roles";
import { TEMPORADAS, aCodigo, normalizarNombre, type Temporada } from "@/lib/arbol/normalizar";
import { contarNodosVigentes, useArbol } from "@/lib/arbol/use-arbol";
import type { AgrupacionTallaFila, CatalogoFila, LineaFila } from "@/lib/arbol/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { BadgeTemporada, VistaPreviaNombre, mensajeError } from "../comunes";

type Pestana = "generos" | "mundos" | "lineas" | "tallas";

export function CatalogosPanel({ rol }: { rol: Rol }) {
  const [pestana, setPestana] = useState<Pestana>("generos");
  // El árbol (con inactivos) da los conteos de nodos por género y mundo para
  // las columnas y para avisar cuántos quedarán ocultos al desactivar.
  const { arbol, recargar: recargarArbol } = useArbol(true);
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

      {pestana === "generos" && (
        <CatalogoPlano
          key="generos"
          recurso="generos"
          singular="género"
          plural="géneros"
          puedeEditar={admin}
          conteo={conteos.porGenero}
          onCambio={recargarArbol}
        />
      )}
      {pestana === "mundos" && (
        <CatalogoPlano
          key="mundos"
          recurso="mundos"
          singular="mundo"
          plural="mundos"
          puedeEditar={admin}
          conteo={conteos.porMundo}
          onCambio={recargarArbol}
        />
      )}
      {pestana === "lineas" && <Lineas puedeEditar onCambio={recargarArbol} />}
      {pestana === "tallas" && <AgrupacionesTalla />}
    </div>
  );
}

// ─── Géneros y Mundos ───

type EdicionCatalogo = { id: string; nombre: string; codigo: string; orden: string };

function CatalogoPlano({
  recurso,
  singular,
  plural,
  puedeEditar,
  conteo,
  onCambio,
}: {
  recurso: "generos" | "mundos";
  singular: string;
  plural: string;
  puedeEditar: boolean;
  conteo: Map<string, number>;
  onCambio: () => Promise<void>;
}) {
  const { datos, cargando, error, setError, recargar } = useColeccion<CatalogoFila>(`/api/${recurso}?incluir_inactivos=1`);
  const [form, setForm] = useState({ nombre: "", codigo: "", codigoTocado: false, orden: "" });
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<EdicionCatalogo | null>(null);

  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);

  async function refrescar() {
    await Promise.all([recargar(), onCambio()]);
  }

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      await refrescar();
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreNormalizado || !codigoPropuesto) return;
    setGuardando(true);
    const ok = await ejecutar(() =>
      api.post<CatalogoFila>(`/api/${recurso}`, {
        nombre: nombreNormalizado,
        codigo: codigoPropuesto,
        ...(form.orden.trim() !== "" ? { orden: Number(form.orden) } : {}),
      })
    );
    if (ok) {
      setAviso(`${singular.charAt(0).toUpperCase() + singular.slice(1)} ${nombreNormalizado} creado.`);
      setForm({ nombre: "", codigo: "", codigoTocado: false, orden: "" });
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
    const ok = await ejecutar(() =>
      api.patch<CatalogoFila>(`/api/${recurso}/${edicion.id}`, { nombre, codigo, orden: Number(edicion.orden) || 0 })
    );
    if (ok) setEdicion(null);
  }

  function alternarActivo(f: CatalogoFila) {
    if (f.activo) {
      const n = conteo.get(f.id) ?? 0;
      const detalle = n > 0 ? ` Quedarán ocultos ${n} nodo${n === 1 ? "" : "s"} del árbol hasta que lo reactives.` : "";
      if (!confirm(`¿Desactivar el ${singular} ${f.nombre}?${detalle}`)) return;
    }
    void ejecutar(() => api.patch<CatalogoFila>(`/api/${recurso}/${f.id}`, { activo: !f.activo }));
  }

  function eliminar(f: CatalogoFila) {
    if (!confirm(`¿Eliminar definitivamente el ${singular} ${f.nombre}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/${recurso}/${f.id}`));
  }

  const columnas: Columna<CatalogoFila>[] = [
    {
      clave: "orden",
      titulo: "Orden",
      className: "w-20",
      render: (f) =>
        edicion?.id === f.id ? (
          <Input type="number" min={0} value={edicion.orden} onChange={(e) => setEdicion({ ...edicion, orden: e.target.value })} className="h-8 w-20" aria-label="Orden" />
        ) : (
          <span className="font-mono text-xs text-tinta-suave">{f.orden}</span>
        ),
    },
    {
      clave: "codigo",
      titulo: "Código",
      render: (f) =>
        edicion?.id === f.id ? (
          <Input value={edicion.codigo} onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })} className="h-8 w-40 font-mono" aria-label="Código" />
        ) : (
          <code className="font-mono text-xs">{f.codigo}</code>
        ),
    },
    {
      clave: "nombre",
      titulo: "Nombre",
      render: (f) =>
        edicion?.id === f.id ? (
          <Input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} className="h-8" aria-label="Nombre" autoFocus />
        ) : (
          <span className="font-medium">{f.nombre}</span>
        ),
    },
    {
      clave: "nodos",
      titulo: "Nodos",
      render: (f) => <span className="text-tinta-suave">{conteo.get(f.id) ?? 0}</span>,
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (f) => <Badge tono={f.activo ? "exito" : "alerta"}>{f.activo ? "Activo" : "Desactivado"}</Badge>,
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (f) =>
        edicion?.id === f.id ? (
          <div className="flex justify-end gap-1">
            <Button tamano="sm" onClick={guardarEdicion}>
              Guardar
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => setEdicion(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button
              variante="fantasma"
              tamano="sm"
              onClick={() => setEdicion({ id: f.id, nombre: f.nombre, codigo: f.codigo, orden: String(f.orden) })}
            >
              Editar
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => alternarActivo(f)}>
              {f.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button
              variante="peligro"
              tamano="sm"
              disabled={(conteo.get(f.id) ?? 0) > 0}
              title={(conteo.get(f.id) ?? 0) > 0 ? "Tiene nodos: desactívalo en vez de eliminarlo." : undefined}
              onClick={() => eliminar(f)}
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

      {puedeEditar ? (
        <Card titulo={`Nuevo ${singular}`} descripcion="El nombre se guarda normalizado en mayúsculas; el código se propone a partir del nombre.">
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
            <Field label="Orden" hint="Posición en las listas.">
              <Input type="number" min={0} value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
            </Field>
            <div className="flex flex-wrap items-center gap-4 md:col-span-4">
              <Button type="submit" disabled={guardando || !nombreNormalizado || !codigoPropuesto}>
                {guardando ? "Creando…" : `Crear ${singular}`}
              </Button>
              <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
            </div>
          </form>
        </Card>
      ) : (
        <Alert tono="info">Los {plural} los gestiona un administrador. Acá puedes consultarlos.</Alert>
      )}

      <Card titulo={plural.charAt(0).toUpperCase() + plural.slice(1)}>
        <DataTable columnas={columnas} filas={datos} claveFila={(f) => f.id} cargando={cargando} />
        <p className="mt-3 text-xs text-tinta-suave">
          Desactivar oculta sus nodos del árbol sin perderlos; eliminar solo es posible sin nodos asociados.
        </p>
      </Card>
    </div>
  );
}

// ─── Líneas ───

type EdicionLinea = { id: string; nombre: string; codigo: string };

function Lineas({ puedeEditar, onCambio }: { puedeEditar: boolean; onCambio: () => Promise<void> }) {
  const { datos, cargando, error, setError, recargar } = useColeccion<LineaFila>("/api/lineas?incluir_inactivos=1");
  const [form, setForm] = useState({ nombre: "", codigo: "", codigoTocado: false, temporada: "Todo el año" as Temporada });
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<EdicionLinea | null>(null);
  const [filtro, setFiltro] = useState("");

  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);
  const consulta = normalizarNombre(filtro);
  const filas = consulta ? datos.filter((l) => l.nombre.includes(consulta) || l.codigo.includes(aCodigo(consulta))) : datos;

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      await Promise.all([recargar(), onCambio()]);
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
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
            <Button tamano="sm" onClick={guardarEdicion}>
              Guardar
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => setEdicion(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button variante="fantasma" tamano="sm" onClick={() => setEdicion({ id: l.id, nombre: l.nombre, codigo: l.codigo })}>
              Editar
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => alternarActivo(l)}>
              {l.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button
              variante="peligro"
              tamano="sm"
              disabled={l.nodos > 0}
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
              <Button type="submit" disabled={guardando || !nombreNormalizado || !codigoPropuesto}>
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
