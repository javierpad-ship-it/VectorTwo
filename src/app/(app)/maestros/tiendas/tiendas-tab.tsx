"use client";

import { useId, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import { estadoTienda } from "@/lib/tiendas/estado";
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
import { Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Alert } from "@/components/ui/alert";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import { BadgeEstado, BadgeTipo, formatearFecha, formatearMonto } from "./comunes";
import { EditarTiendaDialogo } from "./editar-tienda-dialogo";
import { aFila, cambiosDeEdicion, CamposTienda, FORM_VACIO, motivoNoGuardar, type Campos } from "./formulario-tienda";

export type FiltroEstado = "todos" | EstadoTienda;
type FiltroTipo = "todas" | TipoTienda;

const ZONA_TODAS = "__todas";
const ZONA_SIN = "__sin_zona";

/**
 * Pestaña Tiendas: alta, filtros (tipo · estado · zona · texto) y tabla. Editar
 * abre un diálogo con todos los campos; Guardar envía un PATCH con los cambiados.
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
  const [editando, setEditando] = useState<TiendaFila | null>(null);
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

  // M7: pueden ser referente las tiendas activas de tipo Tienda (el CD no vende).
  const tiendasReferencia = useMemo(
    () => tiendas.filter((t) => t.activo && t.tipo === "Tienda").sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [tiendas]
  );

  // ─── Formulario de alta ───
  const filaForm = aFila(form);
  const motivoForm = motivoNoGuardar(form);
  const estadoPrevisto = estadoTienda(filaForm, hoy);

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
      ...(form.referencia ? { tienda_referencia_id: form.referencia } : {}),
    };
    const r = await ejecutar(() => api.post<TiendaFila>("/api/tiendas", cuerpo));
    if (r.ok) {
      setAviso(`Tienda ${r.valor.codigo} · ${r.valor.nombre} creada (${r.valor.estado}).`);
      // Se conservan zona y razón social para cargar varias seguidas de la misma.
      setForm({ ...FORM_VACIO, zona: form.zona, razon_social: form.razon_social });
    }
    setGuardando(false);
  }

  function abrirEdicion(t: TiendaFila) {
    setError(null);
    setEditando(t);
  }

  function cerrarEdicion() {
    setError(null);
    setEditando(null);
  }

  async function guardarEdicion(campos: Campos) {
    if (!editando) return;
    const motivo = motivoNoGuardar(campos);
    if (motivo) {
      setError(motivo);
      return;
    }
    const cuerpo = cambiosDeEdicion(editando, campos);
    if (!cuerpo) {
      setEditando(null);
      return;
    }
    const r = await ejecutar(() => api.patch<TiendaFila>(`/api/tiendas/${editando.id}`, cuerpo));
    if (r.ok) setEditando(null);
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
  const columnas: Columna<TiendaFila>[] = [
    { clave: "codigo", titulo: "Código", render: (t) => <code className="font-mono text-xs">{t.codigo}</code> },
    { clave: "nombre", titulo: "Nombre", render: (t) => <span className={`font-medium ${t.activo ? "" : "opacity-60"}`}>{t.nombre}</span> },
    { clave: "tipo", titulo: "Tipo", render: (t) => <BadgeTipo tipo={t.tipo} /> },
    { clave: "zona", titulo: "Zona", render: (t) => <Celda valor={t.zona} /> },
    { clave: "razon_social", titulo: "Razón social", render: (t) => <Celda valor={t.razon_social} /> },
    { clave: "apertura", titulo: "Apertura", render: (t) => <Celda valor={t.fecha_apertura ? formatearFecha(t.fecha_apertura) : null} mono /> },
    { clave: "cierre", titulo: "Cierre", render: (t) => <Celda valor={t.fecha_cierre ? formatearFecha(t.fecha_cierre) : null} mono /> },
    {
      clave: "venta",
      titulo: "Venta esp.",
      className: "text-right",
      render: (t) => <Celda valor={t.venta_esperada_promedio === null ? null : formatearMonto(t.venta_esperada_promedio)} mono />,
    },
    {
      clave: "referencia",
      titulo: "Referente",
      render: (t) => <Celda valor={t.tienda_referencia?.codigo ?? null} mono />,
    },
    { clave: "estado", titulo: "Estado", render: (t) => <BadgeEstado estado={t.estado} activo={t.activo} /> },
  ];

  if (puedeEditar) {
    columnas.push({
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (t) => (
        <div className="flex justify-end gap-1">
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => abrirEdicion(t)}>
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
      {/* Listas de valores ya usados: las comparten el formulario de alta y el diálogo de edición. */}
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

      {error && !editando && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
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
            <CamposTienda valor={form} onCambio={setForm} idLista={idLista} tiendasReferencia={tiendasReferencia} />
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
            Todo se edita con Editar (abre un diálogo con todos los campos); el estado previsto se ve antes de confirmar. Una tienda que cerró no se desactiva: lleva
            fecha de cierre y conserva su histórico. Desactivar es para filas creadas por error.
          </p>
        )}
      </Card>

      {editando && (
        <EditarTiendaDialogo
          tienda={editando}
          hoy={hoy}
          idLista={idLista}
          ocupado={ocupado}
          error={error}
          onCerrarError={() => setError(null)}
          tiendasReferencia={tiendasReferencia}
          onGuardar={guardarEdicion}
          onCerrar={cerrarEdicion}
        />
      )}
    </div>
  );
}

function Celda({ valor, mono = false }: { valor: string | null; mono?: boolean }) {
  if (!valor) return <span className="text-tinta-suave">—</span>;
  return <span className={mono ? "font-mono text-xs" : ""}>{valor}</span>;
}
