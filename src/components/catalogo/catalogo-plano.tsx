"use client";

import { useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { VistaPreviaNombre } from "./vista-previa-nombre";

/** Lo mínimo que devuelve cualquier catálogo plano (`generos`, `mundos`, `agrupaciones_marca`…). */
export type FilaCatalogoPlano = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
};

/** Claves de `F` cuyo valor es numérico (para la columna de conteo de hijos). */
export type ClaveNumerica<F> = { [K in keyof F]: F[K] extends number ? K : never }[keyof F] & string;

/** Cómo se llaman y se cuentan los hijos del catálogo (nodos del árbol, marcas…). */
export type HijosCatalogo<F> = {
  /** Campo de la fila con el conteo de hijos (activos o no), según la API: `nodos`, `marcas`, `equivalencias`. */
  clave: ClaveNumerica<F>;
  /** Título de la columna de conteo. */
  titulo: string;
  /** Frase del `confirm` de desactivar cuando hay `n > 0` hijos vigentes; se añade tras la pregunta. */
  avisoDesactivar: (n: number) => string;
  /** `title` del botón Eliminar deshabilitado por tener hijos. */
  bloqueoEliminar: string;
  /** Cómo pintar el conteo (p. ej. como enlace a la lista de hijos). Por defecto, el número. */
  render?: (fila: F, n: number) => ReactNode;
};

/** Texto libre opcional del catálogo (p. ej. la descripción de una agrupación de estacionalidad). */
export type DescripcionCatalogo<F> = {
  obtener: (fila: F) => string | null;
  /** Largo máximo que acepta la API. */
  max: number;
  /** Ayuda bajo el campo del formulario de alta. */
  hint?: string;
};

/**
 * Géneros a los que pertenece cada fila (agrupaciones de estacionalidad):
 * selector múltiple obligatorio (mínimo uno) en el alta y en la edición en
 * línea, columna Géneros con chips y badge "Sin género" resaltando la fila.
 */
export type GenerosCatalogo<F> = {
  /** Géneros de la fila, en el orden de la API. */
  obtener: (fila: F) => { id: string; nombre: string }[];
  /** Catálogo completo de géneros (`/api/generos`): el alta ofrece los activos. */
  catalogo: { id: string; nombre: string; activo: boolean }[];
  /** Mientras carga el catálogo no se puede crear. */
  cargando?: boolean;
};

type Genero = "m" | "f";

const ARTICULO: Record<Genero, { el: string; los: string; lo: string; los_: string; o: string; nuevo: string }> = {
  m: { el: "el", los: "Los", lo: "lo", los_: "los", o: "o", nuevo: "Nuevo" },
  f: { el: "la", los: "Las", lo: "la", los_: "las", o: "a", nuevo: "Nueva" },
};

type Edicion = { id: string; nombre: string; codigo: string; orden: string; descripcion: string; generoIds: string[] };

const FORM_VACIO = { nombre: "", codigo: "", codigoTocado: false, orden: "", descripcion: "", generoIds: [] as string[] };

const MOTIVO_SIN_GENERO = "Elige al menos un género.";
const TITLE_SIN_GENERO = "Asígnale al menos un género para poder usarla";

function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Mantenimiento de un catálogo plano (orden · código · nombre · [descripción] ·
 * hijos · estado) contra `/api/{recurso}`: alta arriba, edición en línea abajo,
 * desactivar/reactivar y eliminar (bloqueado con hijos).
 *
 * La columna de hijos y el bloqueo de Eliminar usan `fila[hijos.clave]`
 * (todos los hijos, según la API); `vigentes` solo alimenta el aviso del
 * `confirm` de desactivar (cuántos hijos se verán desaparecer).
 */
export function CatalogoPlano<F extends FilaCatalogoPlano>({
  recurso,
  singular,
  plural,
  genero = "m",
  puedeEditar,
  hijos,
  vigentes,
  descripcion,
  generos,
  ordenar,
  columnasExtra = [],
  notaPie,
  avisoSoloLectura,
  mostrarInactivos,
  onCambio,
}: {
  /** Segmento de `/api/{recurso}` (p. ej. `generos`, `agrupaciones-marca`). */
  recurso: string;
  singular: string;
  plural: string;
  /** Género gramatical de `singular`, para los textos ("el género", "la agrupación"). */
  genero?: Genero;
  puedeEditar: boolean;
  hijos: HijosCatalogo<F>;
  /** Hijos vigentes por fila (los que de verdad se ocultarán al desactivar). Sin esto, no hay aviso. */
  vigentes?: (fila: F) => number;
  /** Si el catálogo tiene descripción libre: campo en el alta y columna editable en línea. */
  descripcion?: DescripcionCatalogo<F>;
  /** Si el catálogo se asigna a uno o más géneros (obligatorio): selector, columna Géneros y resaltado de las filas sin género. */
  generos?: GenerosCatalogo<F>;
  /** Orden de presentación de las filas; ausente, el de la API. */
  ordenar?: (a: F, b: F) => number;
  /** Columnas adicionales, entre el conteo de hijos y el estado. */
  columnasExtra?: Columna<F>[];
  /** Nota al pie de la tabla. */
  notaPie?: string;
  /** Texto del aviso cuando `puedeEditar` es falso. Por defecto, "lo gestiona un administrador". */
  avisoSoloLectura?: string;
  /** `false` oculta las filas inactivas (filtro en memoria); ausente, se muestran todas. */
  mostrarInactivos?: boolean;
  /** Se llama tras cada escritura exitosa, para que quien lo usa recargue lo suyo. */
  onCambio?: () => Promise<void> | void;
}) {
  const { datos, cargando, error, setError, recargar } = useColeccion<F>(`/api/${recurso}?incluir_inactivos=1`);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);

  const a = ARTICULO[genero];
  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);
  const visibles = mostrarInactivos === false ? datos.filter((f) => f.activo) : datos;
  const filas = useMemo(() => (ordenar ? [...visibles].sort(ordenar) : visibles), [visibles, ordenar]);
  const sinGeneroForm = generos !== undefined && form.generoIds.length === 0;
  const contarHijos = (f: F) => f[hijos.clave] as unknown as number;

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await Promise.all([recargar(), onCambio?.()]);
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
    if (!nombreNormalizado || !codigoPropuesto || sinGeneroForm) return;
    setGuardando(true);
    const ok = await ejecutar(() =>
      api.post<F>(`/api/${recurso}`, {
        nombre: nombreNormalizado,
        codigo: codigoPropuesto,
        ...(form.orden.trim() !== "" ? { orden: Number(form.orden) } : {}),
        ...(descripcion && form.descripcion.trim() !== "" ? { descripcion: form.descripcion.trim() } : {}),
        ...(generos ? { genero_ids: form.generoIds } : {}),
      })
    );
    if (ok) {
      setAviso(`${capitalizar(singular)} ${nombreNormalizado} cread${a.o}.`);
      setForm(FORM_VACIO);
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
    if (generos && edicion.generoIds.length === 0) {
      setError(MOTIVO_SIN_GENERO);
      return;
    }
    const ok = await ejecutar(() =>
      api.patch<F>(`/api/${recurso}/${edicion.id}`, {
        nombre,
        codigo,
        orden: Number(edicion.orden) || 0,
        // Vacía viaja como null: así se puede borrar una descripción existente.
        ...(descripcion ? { descripcion: edicion.descripcion.trim() === "" ? null : edicion.descripcion.trim() } : {}),
        ...(generos ? { genero_ids: edicion.generoIds } : {}),
      })
    );
    if (ok) setEdicion(null);
  }

  function alternarActivo(f: F) {
    if (f.activo) {
      // El aviso habla de hijos vigentes (los que de verdad se verán desaparecer).
      const n = vigentes ? vigentes(f) : 0;
      const detalle = n > 0 ? ` ${hijos.avisoDesactivar(n)}` : "";
      if (!confirm(`¿Desactivar ${a.el} ${singular} ${f.nombre}?${detalle}`)) return;
    }
    void ejecutar(() => api.patch<F>(`/api/${recurso}/${f.id}`, { activo: !f.activo }));
  }

  function eliminar(f: F) {
    if (!confirm(`¿Eliminar definitivamente ${a.el} ${singular} ${f.nombre}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/${recurso}/${f.id}`));
  }

  const columnas: Columna<F>[] = [
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
    ...(generos
      ? [
          {
            clave: "generos",
            titulo: "Géneros",
            render: (f: F) => {
              if (edicion?.id === f.id) {
                return (
                  <SelectorGeneros
                    generos={generos}
                    valor={edicion.generoIds}
                    onCambiar={(generoIds) => setEdicion({ ...edicion, generoIds })}
                    disabled={ocupado}
                    etiqueta={`Géneros de ${f.nombre}`}
                  />
                );
              }
              const lista = generos.obtener(f);
              return lista.length > 0 ? (
                <ul className="flex flex-wrap gap-1" aria-label={`Géneros de ${f.nombre}`}>
                  {lista.map((g) => (
                    <li key={g.id}>
                      <Badge>{g.nombre}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <span title={TITLE_SIN_GENERO} className="whitespace-nowrap">
                  <Badge tono="alerta">Sin género</Badge>
                </span>
              );
            },
          } satisfies Columna<F>,
        ]
      : []),
    ...(descripcion
      ? [
          {
            clave: "descripcion",
            titulo: "Descripción",
            render: (f: F) => {
              if (edicion?.id === f.id) {
                return (
                  <Input
                    value={edicion.descripcion}
                    maxLength={descripcion.max}
                    onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })}
                    className="h-8 w-64"
                    aria-label="Descripción"
                    placeholder="Para qué sirve"
                  />
                );
              }
              const texto = descripcion.obtener(f);
              return texto ? (
                <span className="block max-w-64 truncate text-tinta-suave" title={texto}>
                  {texto}
                </span>
              ) : (
                <span className="text-tinta-suave">—</span>
              );
            },
          } satisfies Columna<F>,
        ]
      : []),
    {
      clave: hijos.clave,
      titulo: hijos.titulo,
      render: (f) => {
        const n = contarHijos(f);
        return hijos.render ? hijos.render(f, n) : <span className="text-tinta-suave">{n}</span>;
      },
    },
    ...columnasExtra,
    {
      clave: "estado",
      titulo: "Estado",
      render: (f) => <Badge tono={f.activo ? "exito" : "alerta"}>{f.activo ? `Activ${a.o}` : `Desactivad${a.o}`}</Badge>,
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (f) => {
        const tieneHijos = contarHijos(f) > 0;
        return edicion?.id === f.id ? (
          <div className="flex justify-end gap-1">
            <Button
              tamano="sm"
              disabled={ocupado || (generos !== undefined && edicion.generoIds.length === 0)}
              title={generos !== undefined && edicion.generoIds.length === 0 ? MOTIVO_SIN_GENERO : undefined}
              onClick={guardarEdicion}
            >
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
              className="whitespace-nowrap"
              disabled={ocupado}
              onClick={() =>
                setEdicion({
                  id: f.id,
                  nombre: f.nombre,
                  codigo: f.codigo,
                  orden: String(f.orden),
                  descripcion: descripcion ? (descripcion.obtener(f) ?? "") : "",
                  generoIds: generos ? generos.obtener(f).map((g) => g.id) : [],
                })
              }
            >
              {generos && generos.obtener(f).length === 0 ? "Asignar géneros" : "Editar"}
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(f)}>
              {f.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button
              variante="peligro"
              tamano="sm"
              disabled={ocupado || tieneHijos}
              title={tieneHijos ? hijos.bloqueoEliminar : undefined}
              onClick={() => eliminar(f)}
            >
              Eliminar
            </Button>
          </div>
        );
      },
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
        <Card titulo={`${a.nuevo} ${singular}`} descripcion="El nombre se guarda normalizado en mayúsculas; el código se propone a partir del nombre.">
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
            {descripcion && (
              <Field
                label="Descripción"
                hint={`${form.descripcion.length}/${descripcion.max}.${descripcion.hint ? ` ${descripcion.hint}` : ""}`}
                className="md:col-span-4"
              >
                <Input
                  value={form.descripcion}
                  maxLength={descripcion.max}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
              </Field>
            )}
            {generos && (
              <div className="md:col-span-4">
                <span className="mb-1 block text-sm font-medium text-tinta">Géneros</span>
                <SelectorGeneros
                  generos={generos}
                  valor={form.generoIds}
                  onCambiar={(generoIds) => setForm({ ...form, generoIds })}
                  disabled={guardando || ocupado}
                  etiqueta="Géneros de la nueva agrupación"
                />
                <span className={`mt-1 block text-xs ${sinGeneroForm ? "text-alerta" : "text-tinta-suave"}`}>
                  {generos.cargando
                    ? "Cargando géneros…"
                    : sinGeneroForm
                      ? `${MOTIVO_SIN_GENERO} Solo recibirá equivalencias de los géneros que marques.`
                      : "Solo recibirá equivalencias de los géneros marcados."}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4 md:col-span-4">
              <Button
                type="submit"
                disabled={guardando || ocupado || !nombreNormalizado || !codigoPropuesto || sinGeneroForm || generos?.cargando === true}
                title={sinGeneroForm ? MOTIVO_SIN_GENERO : undefined}
              >
                {guardando ? "Creando…" : `Crear ${singular}`}
              </Button>
              <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
            </div>
          </form>
        </Card>
      ) : (
        <Alert tono="info">
          {avisoSoloLectura ?? `${a.los} ${plural} ${a.los_} gestiona un administrador. Acá puedes consultar${a.los_}.`}
        </Alert>
      )}

      <Card titulo={capitalizar(plural)}>
        <DataTable
          columnas={columnas}
          filas={filas}
          claveFila={(f) => f.id}
          cargando={cargando}
          claseFila={generos ? (f) => (generos.obtener(f).length === 0 ? "bg-alerta-suave/40 hover:bg-alerta-suave/60" : undefined) : undefined}
        />
        {notaPie && <p className="mt-3 text-xs text-tinta-suave">{notaPie}</p>}
      </Card>
    </div>
  );
}

/** Casillas-chip de los géneros: los activos, más los inactivos que la fila ya tiene (se pueden quitar pero no volver a añadir). */
function SelectorGeneros<F>({
  generos,
  valor,
  onCambiar,
  disabled,
  etiqueta,
}: {
  generos: GenerosCatalogo<F>;
  valor: string[];
  onCambiar: (ids: string[]) => void;
  disabled: boolean;
  etiqueta: string;
}) {
  const items = generos.catalogo
    .filter((g) => g.activo || valor.includes(g.id))
    .map((g) => ({
      id: g.id,
      label: g.activo ? g.nombre : `${g.nombre} (inactivo)`,
      disabled: !g.activo && !valor.includes(g.id),
    }));
  if (items.length === 0) return <span className="text-xs text-tinta-suave">{generos.cargando ? "Cargando géneros…" : "No hay géneros activos."}</span>;
  return <ChipsMultiples items={items} valor={valor} onCambiar={onCambiar} disabled={disabled} etiqueta={etiqueta} />;
}
