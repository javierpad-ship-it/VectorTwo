"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import type { AgrupacionMarcaFila, CrearMarcaCuerpo, EditarMarcaCuerpo, MarcaFila } from "@/lib/marcas/tipos-api";
import { alternarOrden, ORDEN_MARCA_INICIAL, ordenarMarcas, type ClaveOrdenMarca, type OrdenMarca } from "@/lib/marcas/ordenar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import { EditarMarcaDialogo, MAX_NOTA } from "./editar-marca-dialogo";

/** Filtro de chips: todas, una agrupación por id, o solo con tratamiento especial. */
const FILTRO_TODAS = "todas";
const FILTRO_TRATAMIENTO = "tratamiento";

type Form = { nombre: string; codigo: string; codigoTocado: boolean; agrupacionId: string; tratamiento: boolean; nota: string };

const FORM_VACIO: Form = { nombre: "", codigo: "", codigoTocado: false, agrupacionId: "", tratamiento: false, nota: "" };

function Casilla({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="h-4 w-4 rounded border-borde accent-marca disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

/**
 * Pestaña Marcas: alta, filtros (agrupación · tratamiento · texto) y tabla.
 * Agrupación y tratamiento se guardan al instante desde la fila; nombre, código
 * y nota se editan en un diálogo (Editar → Guardar).
 */
export function MarcasTabla({
  marcas,
  cargando,
  agrupaciones,
  puedeEditar,
  mostrarInactivos,
  onCambio,
}: {
  marcas: MarcaFila[];
  cargando: boolean;
  agrupaciones: AgrupacionMarcaFila[];
  puedeEditar: boolean;
  mostrarInactivos: boolean;
  onCambio: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<MarcaFila | null>(null);
  const [filtroChip, setFiltroChip] = useState<string>(FILTRO_TODAS);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<OrdenMarca>(ORDEN_MARCA_INICIAL);

  const agrupacionesActivas = agrupaciones.filter((a) => a.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const agrupacionesVisibles = mostrarInactivos ? [...agrupaciones].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)) : agrupacionesActivas;

  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);
  const agrupacionForm = agrupacionesActivas.find((a) => a.id === form.agrupacionId);

  // ─── Filtros en memoria ───
  const base = mostrarInactivos ? marcas : marcas.filter((m) => m.activo);
  const porAgrupacion = new Map<string, number>();
  let conTratamiento = 0;
  for (const m of base) {
    porAgrupacion.set(m.agrupacion_marca_id, (porAgrupacion.get(m.agrupacion_marca_id) ?? 0) + 1);
    if (m.tratamiento_especial) conTratamiento++;
  }
  const chips: ChipItem<string>[] = [
    { id: FILTRO_TODAS, label: "Todas", conteo: base.length },
    ...agrupacionesVisibles.map((a): ChipItem<string> => ({ id: a.id, label: a.nombre, conteo: porAgrupacion.get(a.id) ?? 0 })),
    { id: FILTRO_TRATAMIENTO, label: "Con tratamiento especial", conteo: conTratamiento },
  ];
  // Si la agrupación filtrada dejó de ser visible (se apagó "Mostrar inactivos"), se vuelve a "todas" sin efectos.
  const chipVigente = chips.some((c) => c.id === filtroChip) ? filtroChip : FILTRO_TODAS;
  const consulta = normalizarNombre(busqueda);
  const consultaCodigo = aCodigo(consulta);
  const filas = ordenarMarcas(
    base
      .filter((m) =>
        chipVigente === FILTRO_TODAS ? true : chipVigente === FILTRO_TRATAMIENTO ? m.tratamiento_especial : m.agrupacion_marca_id === chipVigente
      )
      .filter((m) => (consulta ? m.nombre.includes(consulta) || (consultaCodigo !== "" && m.codigo.includes(consultaCodigo)) : true)),
    orden
  );

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await onCambio();
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
    if (!nombreNormalizado || !codigoPropuesto || !form.agrupacionId) return;
    setGuardando(true);
    const cuerpo: CrearMarcaCuerpo = {
      nombre: nombreNormalizado,
      codigo: codigoPropuesto,
      agrupacion_marca_id: form.agrupacionId,
      tratamiento_especial: form.tratamiento,
      ...(form.tratamiento && form.nota.trim() !== "" ? { nota_tratamiento: form.nota.trim() } : {}),
    };
    const ok = await ejecutar(() => api.post<MarcaFila>("/api/marcas", cuerpo));
    if (ok) {
      setAviso(`Marca ${nombreNormalizado} creada en ${agrupacionForm?.nombre ?? "su agrupación"}.`);
      // Se conserva la agrupación para cargar varias seguidas de la misma.
      setForm({ ...FORM_VACIO, agrupacionId: form.agrupacionId });
    }
    setGuardando(false);
  }

  async function guardarEdicion(cuerpo: EditarMarcaCuerpo) {
    if (!editando) return;
    const ok = await ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${editando.id}`, cuerpo));
    if (ok) setEditando(null);
  }

  function abrirEdicion(m: MarcaFila) {
    setError(null);
    setEditando(m);
  }

  function cerrarEdicion() {
    setError(null);
    setEditando(null);
  }

  function cambiarAgrupacion(m: MarcaFila, agrupacion_marca_id: string) {
    if (!agrupacion_marca_id || agrupacion_marca_id === m.agrupacion_marca_id) return;
    void ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${m.id}`, { agrupacion_marca_id } satisfies EditarMarcaCuerpo));
  }

  function cambiarTratamiento(m: MarcaFila, tratamiento_especial: boolean) {
    if (!tratamiento_especial && m.nota_tratamiento) {
      if (!confirm(`¿Quitar el tratamiento especial de ${m.nombre}? Se borrará la nota "${m.nota_tratamiento}".`)) return;
    }
    void ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${m.id}`, { tratamiento_especial } satisfies EditarMarcaCuerpo));
  }

  function alternarActivo(m: MarcaFila) {
    void ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${m.id}`, { activo: !m.activo } satisfies EditarMarcaCuerpo));
  }

  function eliminar(m: MarcaFila) {
    if (!confirm(`¿Eliminar definitivamente la marca ${m.nombre}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/marcas/${m.id}`));
  }

  const columnas: Columna<MarcaFila>[] = [
    {
      clave: "codigo",
      titulo: "Código",
      ordenable: true,
      render: (m) => <code className="font-mono text-xs">{m.codigo}</code>,
    },
    {
      clave: "nombre",
      titulo: "Nombre",
      ordenable: true,
      render: (m) => <span className={`font-medium ${m.vigente ? "" : "opacity-60"}`}>{m.nombre}</span>,
    },
    {
      clave: "agrupacion",
      titulo: "Agrupación",
      ordenable: true,
      render: (m) => {
        const inactiva = !m.agrupacion_marca.activo;
        if (!puedeEditar) {
          return (
            <span className="flex flex-wrap items-center gap-1">
              {m.agrupacion_marca.nombre}
              {inactiva && <Badge tono="alerta">Agrupación inactiva</Badge>}
            </span>
          );
        }
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Select
              value={m.agrupacion_marca_id}
              onChange={(e) => cambiarAgrupacion(m, e.target.value)}
              disabled={ocupado}
              className="h-8 w-44"
              aria-label={`Agrupación de ${m.nombre}`}
            >
              {inactiva && (
                <option value={m.agrupacion_marca_id} disabled>
                  {m.agrupacion_marca.nombre} (inactiva)
                </option>
              )}
              {agrupacionesActivas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Select>
            {inactiva && <Badge tono="alerta">Agrupación inactiva</Badge>}
          </span>
        );
      },
    },
    {
      clave: "tratamiento",
      titulo: "Tratamiento especial",
      ordenable: true,
      render: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          {puedeEditar && (
            <Casilla
              checked={m.tratamiento_especial}
              disabled={ocupado}
              onChange={(v) => cambiarTratamiento(m, v)}
              label={`Tratamiento especial de ${m.nombre}`}
            />
          )}
          {m.tratamiento_especial && <Badge tono="marca">Tratamiento especial</Badge>}
        </span>
      ),
    },
    {
      clave: "nota",
      titulo: "Nota",
      render: (m) =>
        m.nota_tratamiento ? (
          <span className="block max-w-56 truncate text-tinta-suave" title={m.nota_tratamiento}>
            {m.nota_tratamiento}
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      ordenable: true,
      render: (m) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tono={m.activo ? "exito" : "alerta"}>{m.activo ? "Activa" : "Desactivada"}</Badge>
          {m.activo && !m.vigente && <Badge tono="neutro">Oculta por agrupación inactiva</Badge>}
        </span>
      ),
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (m) => (
        <div className="flex justify-end gap-1">
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => abrirEdicion(m)}>
            Editar
          </Button>
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(m)}>
            {m.activo ? "Desactivar" : "Reactivar"}
          </Button>
          <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => eliminar(m)}>
            Eliminar
          </Button>
        </div>
      ),
    });
  }

  const vacio = marcas.length === 0 ? "Sin marcas. Crea la primera o importa el archivo de marcas." : "Ninguna marca coincide con el filtro.";

  return (
    <div className="space-y-6">
      {error && !editando && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {puedeEditar && (
        <Card titulo="Nueva marca" descripcion="El nombre se guarda normalizado en mayúsculas; el código se propone a partir del nombre. Toda marca tiene agrupación.">
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
            <Field label="Agrupación" hint={agrupacionesActivas.length === 0 ? "No hay agrupaciones activas." : undefined}>
              <Select required value={form.agrupacionId} onChange={(e) => setForm({ ...form, agrupacionId: e.target.value })}>
                <option value="">—</option>
                {agrupacionesActivas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-tinta md:col-span-2">
              <Casilla
                checked={form.tratamiento}
                onChange={(v) => setForm({ ...form, tratamiento: v, nota: v ? form.nota : "" })}
                label="Tratamiento especial"
              />
              Tratamiento especial
              <span className="text-xs text-tinta-suave">(se trata aparte al elaborar los flujos)</span>
            </label>
            {form.tratamiento && (
              <Field label="Nota" hint={`${form.nota.length}/${MAX_NOTA}. Por qué se trata aparte; opcional.`} className="md:col-span-2">
                <Input value={form.nota} maxLength={MAX_NOTA} onChange={(e) => setForm({ ...form, nota: e.target.value })} />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-4 md:col-span-4">
              <Button type="submit" disabled={guardando || ocupado || !nombreNormalizado || !codigoPropuesto || !form.agrupacionId}>
                {guardando ? "Creando…" : "Crear marca"}
              </Button>
              <VistaPreviaNombre nombre={nombreNormalizado} codigo={codigoPropuesto} />
            </div>
          </form>
        </Card>
      )}

      <Card
        titulo={`Marcas (${filas.length})`}
        acciones={
          <Input
            type="search"
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-8 w-56"
            aria-label="Buscar marcas"
          />
        }
      >
        <Chips items={chips} activo={chipVigente} onCambiar={setFiltroChip} etiqueta="Filtrar por agrupación" className="mb-4" />
        <DataTable
          columnas={columnas}
          filas={filas}
          claveFila={(m) => m.id}
          cargando={cargando}
          vacio={vacio}
          ordenActual={orden}
          onOrdenar={(clave) => setOrden((actual) => alternarOrden(actual, clave as ClaveOrdenMarca))}
        />
        {puedeEditar && (
          <p className="mt-3 text-xs text-tinta-suave">
            Cambiar la agrupación o el tratamiento especial se guarda al instante; nombre, código y nota, con Editar (abre un diálogo). Al
            quitar el tratamiento se borra la nota. Pulsa un encabezado para ordenar; Agrupación ordena por valor de marca
            (de menor a mayor valor), no alfabéticamente.
          </p>
        )}
      </Card>

      {editando && (
        <EditarMarcaDialogo
          marca={editando}
          ocupado={ocupado}
          error={error}
          onCerrarError={() => setError(null)}
          onGuardar={guardarEdicion}
          onCerrar={cerrarEdicion}
        />
      )}
    </div>
  );
}
