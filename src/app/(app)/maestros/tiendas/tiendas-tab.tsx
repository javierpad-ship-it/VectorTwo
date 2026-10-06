"use client";

import { useId, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import { estadoTienda } from "@/lib/tiendas/estado";
import { motivoRechazoTienda } from "@/lib/tiendas/reglas";
import {
  ESTADOS_TIENDA_API,
  TIPOS_TIENDA_API,
  type CrearTiendaCuerpo,
  type EditarTiendaCuerpo,
  type EstadoTienda,
  type TiendaFila,
  type TipoTienda,
} from "@/lib/tiendas/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Alert } from "@/components/ui/alert";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import { BadgeEstado, BadgeTipo, formatearFecha, formatearMonto, leerMontoInput } from "./comunes";

export type FiltroEstado = "todos" | EstadoTienda;
type FiltroTipo = "todas" | TipoTienda;

const ZONA_TODAS = "__todas";
const ZONA_SIN = "__sin_zona";

/** Lo que el usuario escribe (fechas ISO del `type="date"`, venta como texto). */
type Campos = {
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string;
  razon_social: string;
  fecha_apertura: string;
  fecha_cierre: string;
  venta: string;
};

type Edicion = Campos & { id: string };

const FORM_VACIO: Campos = {
  codigo: "",
  nombre: "",
  tipo: "Tienda",
  zona: "",
  razon_social: "",
  fecha_apertura: "",
  fecha_cierre: "",
  venta: "",
};

/** Fila resultante (alta o actual más cambio) tal como la ven `estadoTienda` y `motivoRechazoTienda`. */
type FilaResultante = {
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada_promedio: number | null;
};

function aFila(c: Campos): FilaResultante {
  const venta = leerMontoInput(c.venta);
  return {
    codigo: aCodigo(c.codigo),
    nombre: normalizarNombre(c.nombre),
    tipo: c.tipo,
    zona: normalizarNombre(c.zona) || null,
    razon_social: normalizarNombre(c.razon_social) || null,
    fecha_apertura: c.fecha_apertura || null,
    fecha_cierre: c.fecha_cierre || null,
    venta_esperada_promedio: Number.isNaN(venta) ? null : venta,
  };
}

/** Motivo por el que no se puede guardar (cliente), o `null`. Corre antes que la API. */
function motivoNoGuardar(c: Campos): string | null {
  const fila = aFila(c);
  if (!fila.codigo) return "El código es obligatorio (letras o números).";
  if (!fila.nombre) return "El nombre es obligatorio.";
  if (Number.isNaN(leerMontoInput(c.venta))) return "La venta esperada debe ser un número.";
  return motivoRechazoTienda(fila)?.mensaje ?? null;
}

/** Al pasar a CD se vacía la venta esperada (el campo queda deshabilitado). */
function conTipo<T extends Campos>(c: T, tipo: TipoTienda): T {
  return { ...c, tipo, venta: tipo === "Centro de Distribución" ? "" : c.venta };
}

/** Al quitar la apertura se vacía el cierre (sin apertura no hay cierre). */
function conApertura<T extends Campos>(c: T, fecha_apertura: string): T {
  return { ...c, fecha_apertura, fecha_cierre: fecha_apertura ? c.fecha_cierre : "" };
}

/**
 * Pestaña Tiendas: alta, filtros (tipo · estado · zona · texto) y tabla con
 * edición en línea Editar → Guardar (un PATCH con los campos cambiados).
 */
export function TiendasTab({
  tiendas,
  cargando,
  puedeEditar,
  mostrarInactivos,
  hoy,
  filtroEstado,
  onFiltroEstado,
  onCambio,
}: {
  tiendas: TiendaFila[];
  cargando: boolean;
  puedeEditar: boolean;
  mostrarInactivos: boolean;
  /** `aaaa-mm-dd` en Lima, para anticipar el estado antes de guardar. */
  hoy: string;
  filtroEstado: FiltroEstado;
  onFiltroEstado: (f: FiltroEstado) => void;
  onCambio: () => Promise<void>;
}) {
  const idLista = useId();
  const [form, setForm] = useState<Campos>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todas");
  const [filtroZona, setFiltroZona] = useState<string>(ZONA_TODAS);
  const [busqueda, setBusqueda] = useState("");

  // ─── Valores ya usados para los <datalist> (sobre todas las filas, activas o no) ───
  const { zonas, razones } = useMemo(() => {
    const z = new Set<string>();
    const r = new Set<string>();
    for (const t of tiendas) {
      if (t.zona) z.add(t.zona);
      if (t.razon_social) r.add(t.razon_social);
    }
    return { zonas: [...z].sort((a, b) => a.localeCompare(b)), razones: [...r].sort((a, b) => a.localeCompare(b)) };
  }, [tiendas]);

  // ─── Formulario de alta ───
  const filaForm = aFila(form);
  const motivoForm = motivoNoGuardar(form);
  const estadoPrevisto = estadoTienda(filaForm, hoy);
  const esCdForm = form.tipo === "Centro de Distribución";
  const cierreAntes = Boolean(form.fecha_apertura && form.fecha_cierre && form.fecha_cierre < form.fecha_apertura);

  // ─── Filtros en memoria ───
  const base = useMemo(() => (mostrarInactivos ? tiendas : tiendas.filter((t) => t.activo)), [tiendas, mostrarInactivos]);
  const conteos = useMemo(() => {
    const porTipo: Record<TipoTienda, number> = { Tienda: 0, "Centro de Distribución": 0 };
    const porEstado: Record<EstadoTienda, number> = { Activa: 0, Planificada: 0, Cerrada: 0 };
    for (const t of base) {
      porTipo[t.tipo]++;
      porEstado[t.estado]++;
    }
    return { porTipo, porEstado };
  }, [base]);

  const chipsTipo: ChipItem<FiltroTipo>[] = [
    { id: "todas", label: "Todas", conteo: base.length },
    ...TIPOS_TIENDA_API.map((tipo): ChipItem<FiltroTipo> => ({ id: tipo, label: tipo === "Tienda" ? "Tiendas" : "CD", conteo: conteos.porTipo[tipo] })),
  ];
  const chipsEstado: ChipItem<FiltroEstado>[] = [
    { id: "todos", label: "Todos", conteo: base.length },
    ...ESTADOS_TIENDA_API.map((e): ChipItem<FiltroEstado> => ({ id: e, label: `${e}s`, conteo: conteos.porEstado[e] })),
  ];
  // Si la zona filtrada ya no existe (se borró o se apagó "Mostrar inactivos"), se vuelve a "Todas" sin efectos.
  const zonaVigente = filtroZona === ZONA_TODAS || filtroZona === ZONA_SIN || zonas.includes(filtroZona) ? filtroZona : ZONA_TODAS;

  const filas = useMemo(() => {
    const consulta = normalizarNombre(busqueda);
    const consultaCodigo = aCodigo(consulta);
    return base
      .filter((t) => (filtroTipo === "todas" ? true : t.tipo === filtroTipo))
      .filter((t) => (filtroEstado === "todos" ? true : t.estado === filtroEstado))
      .filter((t) => (zonaVigente === ZONA_TODAS ? true : zonaVigente === ZONA_SIN ? t.zona === null : t.zona === zonaVigente))
      .filter((t) => (consulta ? t.nombre.includes(consulta) || (consultaCodigo !== "" && t.codigo.includes(consultaCodigo)) : true))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [base, filtroTipo, filtroEstado, zonaVigente, busqueda]);

  async function ejecutar<T>(accion: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false }> {
    setOcupado(true);
    setError(null);
    try {
      const valor = await accion();
      await onCambio();
      return { ok: true, valor };
    } catch (e) {
      setError(mensajeError(e));
      return { ok: false };
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (motivoForm) return;
    setGuardando(true);
    const cuerpo: CrearTiendaCuerpo = {
      codigo: filaForm.codigo,
      nombre: filaForm.nombre,
      tipo: filaForm.tipo,
      zona: filaForm.zona,
      razon_social: filaForm.razon_social,
      fecha_apertura: filaForm.fecha_apertura,
      fecha_cierre: filaForm.fecha_cierre,
      venta_esperada_promedio: filaForm.venta_esperada_promedio,
    };
    const r = await ejecutar(() => api.post<TiendaFila>("/api/tiendas", cuerpo));
    if (r.ok) {
      setAviso(`Tienda ${r.valor.codigo} · ${r.valor.nombre} creada (${r.valor.estado}).`);
      // Se conservan zona y razón social para cargar varias seguidas de la misma.
      setForm({ ...FORM_VACIO, zona: form.zona, razon_social: form.razon_social });
    }
    setGuardando(false);
  }

  function empezarEdicion(t: TiendaFila) {
    setEdicion({
      id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      tipo: t.tipo,
      zona: t.zona ?? "",
      razon_social: t.razon_social ?? "",
      fecha_apertura: t.fecha_apertura ?? "",
      fecha_cierre: t.fecha_cierre ?? "",
      venta: t.venta_esperada_promedio === null ? "" : String(t.venta_esperada_promedio),
    });
  }

  /** Solo los campos que cambiaron respecto a la fila; `null` si no cambió nada. */
  function cambiosDeEdicion(t: TiendaFila, ed: Edicion): EditarTiendaCuerpo | null {
    const fila = aFila(ed);
    const cuerpo: EditarTiendaCuerpo = {};
    if (fila.codigo !== t.codigo) cuerpo.codigo = fila.codigo;
    if (fila.nombre !== t.nombre) cuerpo.nombre = fila.nombre;
    if (fila.tipo !== t.tipo) cuerpo.tipo = fila.tipo;
    if (fila.zona !== t.zona) cuerpo.zona = fila.zona;
    if (fila.razon_social !== t.razon_social) cuerpo.razon_social = fila.razon_social;
    if (fila.fecha_apertura !== t.fecha_apertura) cuerpo.fecha_apertura = fila.fecha_apertura;
    if (fila.fecha_cierre !== t.fecha_cierre) cuerpo.fecha_cierre = fila.fecha_cierre;
    if (fila.venta_esperada_promedio !== t.venta_esperada_promedio) cuerpo.venta_esperada_promedio = fila.venta_esperada_promedio;
    return Object.keys(cuerpo).length === 0 ? null : cuerpo;
  }

  async function guardarEdicion(t: TiendaFila) {
    if (!edicion) return;
    const motivo = motivoNoGuardar(edicion);
    if (motivo) {
      setError(motivo);
      return;
    }
    const cuerpo = cambiosDeEdicion(t, edicion);
    if (!cuerpo) {
      setEdicion(null);
      return;
    }
    const r = await ejecutar(() => api.patch<TiendaFila>(`/api/tiendas/${t.id}`, cuerpo));
    if (r.ok) setEdicion(null);
  }

  function alternarActivo(t: TiendaFila) {
    if (t.activo && t.estado === "Activa") {
      if (
        !confirm(
          `La tienda sigue abierta. Si cerró, registra la fecha de cierre en lugar de desactivarla.\n\n¿Desactivar ${t.codigo} · ${t.nombre} de todos modos? Dejará de aparecer en los selectores y las cargas de venta la omitirán.`
        )
      )
        return;
    }
    void ejecutar(() => api.patch<TiendaFila>(`/api/tiendas/${t.id}`, { activo: !t.activo } satisfies EditarTiendaCuerpo));
  }

  function eliminar(t: TiendaFila) {
    if (!confirm(`¿Eliminar definitivamente la tienda ${t.codigo} · ${t.nombre}? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/tiendas/${t.id}`));
  }

  // ─── Tabla ───
  const motivoEdicion = edicion ? motivoNoGuardar(edicion) : null;
  const estadoEdicion = edicion ? estadoTienda(aFila(edicion), hoy) : null;
  const esCdEdicion = edicion?.tipo === "Centro de Distribución";

  const columnas: Columna<TiendaFila>[] = [
    {
      clave: "codigo",
      titulo: "Código",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input value={edicion.codigo} onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })} className="h-8 w-28 font-mono" aria-label="Código" />
        ) : (
          <code className="font-mono text-xs">{t.codigo}</code>
        ),
    },
    {
      clave: "nombre",
      titulo: "Nombre",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} className="h-8 min-w-48" aria-label="Nombre" autoFocus />
        ) : (
          <span className={`font-medium ${t.activo ? "" : "opacity-60"}`}>{t.nombre}</span>
        ),
    },
    {
      clave: "tipo",
      titulo: "Tipo",
      render: (t) =>
        edicion?.id === t.id ? (
          <Select value={edicion.tipo} onChange={(e) => setEdicion(conTipo(edicion, e.target.value as TipoTienda))} className="h-8 w-44" aria-label="Tipo">
            {TIPOS_TIENDA_API.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </Select>
        ) : (
          <BadgeTipo tipo={t.tipo} />
        ),
    },
    {
      clave: "zona",
      titulo: "Zona",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input value={edicion.zona} list={`${idLista}-zonas`} onChange={(e) => setEdicion({ ...edicion, zona: e.target.value })} className="h-8 w-44" aria-label="Zona" />
        ) : (
          <Celda valor={t.zona} />
        ),
    },
    {
      clave: "razon_social",
      titulo: "Razón social",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input
            value={edicion.razon_social}
            list={`${idLista}-razones`}
            onChange={(e) => setEdicion({ ...edicion, razon_social: e.target.value })}
            className="h-8 w-44"
            aria-label="Razón social"
          />
        ) : (
          <Celda valor={t.razon_social} />
        ),
    },
    {
      clave: "apertura",
      titulo: "Apertura",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input type="date" value={edicion.fecha_apertura} onChange={(e) => setEdicion(conApertura(edicion, e.target.value))} className="h-8 w-40" aria-label="Fecha de apertura" />
        ) : (
          <Celda valor={t.fecha_apertura ? formatearFecha(t.fecha_apertura) : null} mono />
        ),
    },
    {
      clave: "cierre",
      titulo: "Cierre",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input
            type="date"
            value={edicion.fecha_cierre}
            min={edicion.fecha_apertura || undefined}
            disabled={!edicion.fecha_apertura}
            title={edicion.fecha_apertura ? undefined : "Para registrar un cierre, la tienda necesita fecha de apertura."}
            onChange={(e) => setEdicion({ ...edicion, fecha_cierre: e.target.value })}
            className="h-8 w-40"
            aria-label="Fecha de cierre"
          />
        ) : (
          <Celda valor={t.fecha_cierre ? formatearFecha(t.fecha_cierre) : null} mono />
        ),
    },
    {
      clave: "venta",
      titulo: "Venta esp.",
      className: "text-right",
      render: (t) =>
        edicion?.id === t.id ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={edicion.venta}
            disabled={esCdEdicion}
            title={esCdEdicion ? "Un centro de distribución no lleva venta esperada." : undefined}
            onChange={(e) => setEdicion({ ...edicion, venta: e.target.value })}
            className="h-8 w-32 text-right"
            aria-label="Venta esperada (S/ por mes)"
          />
        ) : (
          <Celda valor={t.venta_esperada_promedio === null ? null : formatearMonto(t.venta_esperada_promedio)} mono />
        ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (t) =>
        edicion?.id === t.id && estadoEdicion ? (
          <BadgeEstado estado={estadoEdicion} activo={t.activo} prefijo="Quedará" />
        ) : (
          <BadgeEstado estado={t.estado} activo={t.activo} />
        ),
    },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (t) =>
        edicion?.id === t.id ? (
          <div className="flex justify-end gap-1">
            <Button tamano="sm" disabled={ocupado || motivoEdicion !== null} title={motivoEdicion ?? undefined} onClick={() => guardarEdicion(t)}>
              {ocupado ? "Guardando…" : "Guardar"}
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => setEdicion(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => empezarEdicion(t)}>
              Editar
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(t)}>
              {t.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => eliminar(t)}>
              Eliminar
            </Button>
          </div>
        ),
    });
  }

  const vacio = tiendas.length === 0 ? "Sin tiendas. Crea la primera o importa el archivo de códigos de tiendas." : "Ninguna tienda coincide con el filtro.";

  return (
    <div className="space-y-6">
      {/* Listas de valores ya usados: las comparten el formulario de alta y la edición en línea. */}
      <datalist id={`${idLista}-zonas`}>
        {zonas.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <datalist id={`${idLista}-razones`}>
        {razones.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {puedeEditar && (
        <Card
          titulo="Nueva tienda"
          descripcion="El código es el real de la tienda (el que traen venta y stock); nombre, zona y razón social se guardan normalizados en mayúsculas."
        >
          <form onSubmit={crear} className="grid gap-4 md:grid-cols-4">
            <Field
              label="Código"
              hint={form.codigo.trim() === "" ? "Obligatorio. Ej. R401, RD50." : filaForm.codigo ? `Se guardará como ${filaForm.codigo}` : "El código es obligatorio (letras o números)."}
            >
              <Input required value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="font-mono" placeholder="R401" />
            </Field>
            <Field label="Nombre" className="md:col-span-2">
              <Input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Lukers Iquitos Lores" />
            </Field>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(e) => setForm(conTipo(form, e.target.value as TipoTienda))}>
                {TIPOS_TIENDA_API.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Zona" hint="Opcional. Se autocompleta con las zonas ya usadas.">
              <Input value={form.zona} list={`${idLista}-zonas`} onChange={(e) => setForm({ ...form, zona: e.target.value })} />
            </Field>
            <Field label="Razón social" hint="Opcional.">
              <Input value={form.razon_social} list={`${idLista}-razones`} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} />
            </Field>
            <Field label="Fecha de apertura" hint="Sin fecha, la tienda queda Planificada.">
              <Input type="date" value={form.fecha_apertura} onChange={(e) => setForm(conApertura(form, e.target.value))} />
            </Field>
            <Field
              label="Fecha de cierre"
              hint={
                cierreAntes
                  ? "La fecha de cierre no puede ser anterior a la de apertura."
                  : form.fecha_apertura
                    ? "Último día con venta (inclusive)."
                    : "Primero registra la apertura."
              }
            >
              <Input
                type="date"
                value={form.fecha_cierre}
                min={form.fecha_apertura || undefined}
                disabled={!form.fecha_apertura}
                onChange={(e) => setForm({ ...form, fecha_cierre: e.target.value })}
              />
            </Field>
            <Field
              label="Venta esperada (S/ por mes)"
              hint={esCdForm ? "Un centro de distribución no vende." : "Solo para tiendas que aún no abren: M7 la usa en lugar del histórico."}
              className="md:col-span-2"
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.venta}
                disabled={esCdForm}
                onChange={(e) => setForm({ ...form, venta: e.target.value })}
                placeholder="85000"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-4 md:col-span-4">
              <Button type="submit" disabled={guardando || ocupado || motivoForm !== null} title={motivoForm ?? undefined}>
                {guardando ? "Creando…" : "Crear tienda"}
              </Button>
              <BadgeEstado estado={estadoPrevisto} prefijo="Quedará" />
              <VistaPreviaNombre nombre={filaForm.nombre} codigo={filaForm.codigo} />
            </div>
          </form>
        </Card>
      )}

      <Card
        titulo={`Tiendas (${filas.length})`}
        acciones={
          <Input
            type="search"
            placeholder="Buscar por código o nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-8 w-56"
            aria-label="Buscar tiendas"
          />
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Chips items={chipsTipo} activo={filtroTipo} onCambiar={setFiltroTipo} etiqueta="Filtrar por tipo" />
          <Chips items={chipsEstado} activo={filtroEstado} onCambiar={onFiltroEstado} etiqueta="Filtrar por estado" />
          <Select value={zonaVigente} onChange={(e) => setFiltroZona(e.target.value)} className="h-8 w-52" aria-label="Filtrar por zona">
            <option value={ZONA_TODAS}>Todas las zonas</option>
            {zonas.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
            <option value={ZONA_SIN}>Sin zona</option>
          </Select>
        </div>
        <DataTable columnas={columnas} filas={filas} claveFila={(t) => t.id} cargando={cargando} vacio={vacio} />
        {puedeEditar && (
          <p className="mt-3 text-xs text-tinta-suave">
            Todo se edita con Editar → Guardar; el estado previsto se ve antes de confirmar. Una tienda que cerró no se desactiva: lleva
            fecha de cierre y conserva su histórico. Desactivar es para filas creadas por error.
          </p>
        )}
      </Card>
    </div>
  );
}

function Celda({ valor, mono = false }: { valor: string | null; mono?: boolean }) {
  if (!valor) return <span className="text-tinta-suave">—</span>;
  return <span className={mono ? "font-mono text-xs" : ""}>{valor}</span>;
}
