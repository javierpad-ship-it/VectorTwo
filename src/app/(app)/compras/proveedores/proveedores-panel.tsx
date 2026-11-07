"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { fechaLima } from "@/components/compras/formato";
import { descargarLibro } from "@/app/(app)/planificacion/proyeccion/descarga-libro";
import { DetalleProveedor } from "@/components/proveedores/detalle-proveedor";
import { FormularioProveedor } from "@/components/proveedores/formulario-proveedor";
import {
  contactoPrincipal,
  faltanDeListado,
  FILTROS_INICIALES,
  filtrarProveedores,
  hojaProveedores,
  NOMBRE_ARCHIVO_PROVEEDORES,
  paisesDe,
  textoFaltan,
  textoParecido,
  textoUbicacion,
  type EstadoFiltro,
  type FiltrosProveedores,
} from "@/components/proveedores/vista-proveedores";
import { puedeCambiarIntercompany } from "@/lib/proveedores/reglas";
import type { Rol } from "@/lib/auth/roles";
import type { ProveedorFichaApi, ProveedorListadoApi } from "@/lib/proveedores/tipos-api";
import { useColeccion } from "@/lib/use-coleccion";

type Vista = { tipo: "lista" } | { tipo: "detalle"; id: string };
type Mensaje = { tono: "exito" | "info"; texto: string };

/**
 * Proveedores (`/compras/proveedores`, ficha 08c §4.2). Los tres roles ven y crean/editan (decisión 28); desactivar, reactivar y eliminar
 * son de admin y planner, y marcar «intercompany» también (la API lo exige: aquí solo se ocultan los botones). Lista con búsqueda y filtros
 * (activos / inactivos / todos, país, intercompany), «Ficha incompleta», Excel; detalle con historial; alta y edición en un diálogo.
 */
export function ProveedoresPanel({ rol }: { rol: Rol }) {
  const lista = useColeccion<ProveedorListadoApi>("/api/compras/proveedores");
  const [filtros, setFiltros] = useState<FiltrosProveedores>(FILTROS_INICIALES);
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [formulario, setFormulario] = useState<{ ficha: ProveedorFichaApi | null } | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [version, setVersion] = useState(0);
  const [exportando, setExportando] = useState(false);

  const visibles = useMemo(() => filtrarProveedores(lista.datos, filtros), [lista.datos, filtros]);
  const paises = useMemo(() => paisesDe(lista.datos), [lista.datos]);
  const puertos = useMemo(() => [...new Set(lista.datos.map((p) => p.puerto_embarque).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "es")), [lista.datos]);
  const conteo = useMemo(() => ({ activos: lista.datos.filter((p) => p.activo).length, inactivos: lista.datos.filter((p) => !p.activo).length, todos: lista.datos.length }), [lista.datos]);
  const hayFiltros = filtros.q !== "" || filtros.pais !== "" || filtros.intercompany || filtros.estado !== "activos";

  async function guardado(ficha: ProveedorFichaApi) {
    const eraNuevo = formulario?.ficha === null;
    setFormulario(null);
    await lista.recargar();
    setVersion((v) => v + 1);
    const parecidos = ficha.parecidos ?? [];
    setMensaje(
      parecidos.length > 0
        ? { tono: "info", texto: `«${ficha.nombre}» ${eraNuevo ? "creado" : "guardado"}. Ojo, hay nombres parecidos: ${parecidos.map(textoParecido).join("; ")}.` }
        : { tono: "exito", texto: `«${ficha.nombre}» ${eraNuevo ? "creado" : "guardado"}.` },
    );
    setVista({ tipo: "detalle", id: ficha.id });
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarLibro({ PROVEEDORES: hojaProveedores(visibles) }, NOMBRE_ARCHIVO_PROVEEDORES(fechaLima()));
    } catch (e) {
      lista.setError(e instanceof Error ? e.message : "No pudimos preparar el Excel.");
    } finally {
      setExportando(false);
    }
  }

  const columnas: Columna<ProveedorListadoApi>[] = [
    {
      clave: "nombre",
      titulo: "Proveedor",
      render: (p) => (
        <div className="min-w-0">
          <button type="button" onClick={() => setVista({ tipo: "detalle", id: p.id })} className="text-left font-medium text-marca-oscura underline-offset-2 hover:underline">
            {p.nombre}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {p.codigo && <span className="text-xs text-tinta-suave">{p.codigo}</span>}
            {p.es_intercompany && <Badge tono="marca">Intercompany</Badge>}
            {!p.completo && (
              <span title={textoFaltan(faltanDeListado(p))}>
                <Badge tono="alerta">Ficha incompleta</Badge>
              </span>
            )}
          </div>
        </div>
      ),
    },
    { clave: "ubicacion", titulo: "País · región", render: (p) => <span className="whitespace-nowrap">{textoUbicacion(p)}</span> },
    { clave: "puerto", titulo: "Puerto habitual", render: (p) => p.puerto_embarque ?? <span className="text-tinta-suave">—</span> },
    { clave: "incoterm", titulo: "Incoterm", render: (p) => p.incoterm ?? <span className="text-tinta-suave">—</span> },
    { clave: "moneda", titulo: "Moneda", render: (p) => p.moneda ?? <span className="text-tinta-suave">—</span> },
    {
      clave: "contacto",
      titulo: "Contacto principal",
      render: (p) => {
        const c = contactoPrincipal(p);
        if (!c) return <span className="text-tinta-suave">—</span>;
        return (
          <div className="min-w-0 text-xs">
            <div className="text-sm">{c.nombre}</div>
            {c.correo && <div className="break-all text-tinta-suave">{c.correo}</div>}
          </div>
        );
      },
    },
    { clave: "compras", titulo: "Compras", className: "text-right", render: (p) => <span className="font-mono tabular-nums">{p.compras}</span> },
    { clave: "estado", titulo: "Estado", render: (p) => <Badge tono={p.activo ? "exito" : "alerta"}>{p.activo ? "Activo" : "Inactivo"}</Badge> },
  ];

  if (vista.tipo === "detalle") {
    return (
      <div className="space-y-5">
        {mensaje && (
          <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
            {mensaje.texto}
          </Alert>
        )}
        <DetalleProveedor
          key={`${vista.id}-${version}`}
          id={vista.id}
          onVolver={() => {
            setVista({ tipo: "lista" });
            setMensaje(null);
          }}
          onEditar={(ficha) => setFormulario({ ficha })}
          onCambio={async (texto) => {
            await lista.recargar();
            setVersion((v) => v + 1);
            setMensaje({ tono: "exito", texto });
          }}
          onEliminado={async (texto) => {
            await lista.recargar();
            setVista({ tipo: "lista" });
            setMensaje({ tono: "exito", texto });
          }}
        />
        {formulario && (
          <FormularioProveedor
            ficha={formulario.ficha}
            puedeIntercompany={puedeCambiarIntercompany(rol)}
            puertosSugeridos={puertos}
            onCerrar={() => setFormulario(null)}
            onGuardado={guardado}
            onAbrirExistente={(id) => {
              setFormulario(null);
              setVista({ tipo: "detalle", id });
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Proveedores</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Las fichas de los proveedores de importación, con sus contactos, su puerto habitual y sus condiciones. Cualquiera crea y edita; desactivar, eliminar y marcar «intercompany» es del
            planner. Cada cambio queda en el historial.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variante="secundario" onClick={() => void exportar()} disabled={exportando || lista.cargando || visibles.length === 0} title="Descarga en Excel los proveedores de la lista, sin datos bancarios">
            {exportando ? "Preparando Excel…" : "Excel"}
          </Button>
          <Button onClick={() => setFormulario({ ficha: null })}>Nuevo proveedor</Button>
        </div>
      </div>

      {mensaje && (
        <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
          {mensaje.texto}
        </Alert>
      )}
      {lista.error && <Alert onCerrar={() => lista.setError(null)}>{lista.error}</Alert>}

      <section aria-label="Filtros" className="space-y-3 rounded-lg border border-borde bg-superficie p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Buscar">
            <Input type="search" value={filtros.q} placeholder="Nombre, código, RUC, país, puerto o contacto" onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
          </Field>
          <Field label="País">
            <Select value={filtros.pais} onChange={(e) => setFiltros({ ...filtros, pais: e.target.value })}>
              <option value="">Todos los países</option>
              {paises.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chips<EstadoFiltro>
            etiqueta="Estado del proveedor"
            activo={filtros.estado}
            onCambiar={(estado) => setFiltros({ ...filtros, estado })}
            items={[
              { id: "activos", label: "Activos", conteo: conteo.activos },
              { id: "inactivos", label: "Inactivos", conteo: conteo.inactivos },
              { id: "todos", label: "Todos", conteo: conteo.todos },
            ]}
          />
          <Switch checked={filtros.intercompany} onChange={(intercompany) => setFiltros({ ...filtros, intercompany })} label="Solo intercompany" />
        </div>
      </section>

      <p className="text-sm text-tinta-suave" aria-live="polite">
        {lista.cargando ? "Cargando…" : lista.error && lista.datos.length === 0 ? "" : `${visibles.length} de ${lista.datos.length} proveedores`}
      </p>

      {/* Si la lista falló y no hay datos, solo se ve la alerta de error: no es cierto que «todavía no haya proveedores». */}
      {!lista.cargando && lista.error && lista.datos.length === 0 ? null : !lista.cargando && lista.datos.length === 0 ? (
        <EmptyState titulo="Todavía no hay proveedores" detalle="Crea el primero con «Nuevo proveedor». Los que ya existen en COTV se cargan una sola vez desde su base.">
          <Button onClick={() => setFormulario({ ficha: null })}>Nuevo proveedor</Button>
        </EmptyState>
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              columnas={columnas}
              filas={visibles}
              claveFila={(p) => p.id}
              cargando={lista.cargando}
              vacio={hayFiltros ? "Ningún proveedor coincide con los filtros." : "Sin proveedores."}
            />
          </div>
          {/* En el celular las columnas pasan a tarjetas: lo principal a la vista y el resto en «Ver más» (ficha 08c, M6). */}
          <ul className="space-y-3 md:hidden" aria-label="Proveedores">
            {!lista.cargando && visibles.length === 0 && <li className="rounded-lg border border-dashed border-borde px-4 py-6 text-center text-sm text-tinta-suave">{hayFiltros ? "Ningún proveedor coincide con los filtros." : "Sin proveedores."}</li>}
            {visibles.map((p) => {
              const c = contactoPrincipal(p);
              return (
                <li key={p.id} className="rounded-xl border border-borde bg-superficie p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => setVista({ tipo: "detalle", id: p.id })} className="min-w-0 break-words text-left font-medium text-marca-oscura underline-offset-2 hover:underline">
                      {p.nombre}
                    </button>
                    <Badge tono={p.activo ? "exito" : "alerta"}>{p.activo ? "Activo" : "Inactivo"}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-tinta-suave">{textoUbicacion(p)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.es_intercompany && <Badge tono="marca">Intercompany</Badge>}
                    {!p.completo && <Badge tono="alerta">Ficha incompleta</Badge>}
                  </div>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer py-1 text-tinta-suave">Ver más</summary>
                    <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-tinta-suave">Código</dt>
                      <dd>{p.codigo ?? "—"}</dd>
                      <dt className="text-tinta-suave">Puerto</dt>
                      <dd>{p.puerto_embarque ?? "—"}</dd>
                      <dt className="text-tinta-suave">Incoterm</dt>
                      <dd>{p.incoterm ?? "—"}</dd>
                      <dt className="text-tinta-suave">Moneda</dt>
                      <dd>{p.moneda ?? "—"}</dd>
                      <dt className="text-tinta-suave">Contacto</dt>
                      <dd className="break-all">{c ? [c.nombre, c.correo].filter(Boolean).join(" · ") : "—"}</dd>
                      <dt className="text-tinta-suave">Compras</dt>
                      <dd>{p.compras}</dd>
                    </dl>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {formulario && (
        <FormularioProveedor
          ficha={formulario.ficha}
          puedeIntercompany={puedeCambiarIntercompany(rol)}
          puertosSugeridos={puertos}
          onCerrar={() => setFormulario(null)}
          onGuardado={guardado}
          onAbrirExistente={(id) => {
            setFormulario(null);
            setVista({ tipo: "detalle", id });
          }}
        />
      )}
    </div>
  );
}

