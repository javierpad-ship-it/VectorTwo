"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import type { AgrupacionMarcaFila, MarcaFila } from "@/lib/marcas/tipos-api";
import { alternarOrden, ORDEN_MARCA_INICIAL, ordenarMarcas, type ClaveOrdenMarca, type OrdenMarca } from "@/lib/marcas/ordenar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import {
  confirmacionCambioModalidad,
  cuerpoModalidad,
  esMarcaGenerica,
  esMiembroEfectivo,
  estaPendiente,
  ETIQUETA_MODALIDAD,
  MODALIDADES_ELEGIBLES,
  motivoPendienteMarca,
  sinModalidadGuardada,
  textoConfirmarModalidad,
  TEXTO_PENDIENTE,
} from "@/components/marcas/comunes-m2b";
import {
  ETIQUETA_AVISO_CONJUNTO,
  type AvisoConjunto,
  type CrearMarcaCuerpoM2b,
  type EditarMarcaCuerpoM2b,
  type MarcaConGml,
  type ModalidadEfectiva,
} from "@/components/marcas/tipos-m2b";
import { EditarMarcaDialogo, MAX_NOTA } from "./editar-marca-dialogo";
import { CrearConjuntoDialogo } from "./crear-conjunto-dialogo";

/** Filtro de chips: todas, una agrupación por id, o uno de los filtros de tratamiento y conjuntos. */
const FILTRO_TODAS = "todas";
const FILTRO_TRATAMIENTO = "tratamiento";
const FILTRO_POR_GML = "por_gml";
const FILTRO_BARRIDO = "barrido";
const FILTRO_MIXTA = "mixta";
const FILTRO_PENDIENTES = "pendientes";
const FILTRO_EN_CONJUNTO = "en_conjunto";
const FILTRO_CABEZAS = "cabezas";

const NUEVA_CABEZA = "__nueva_cabeza__";

type Form = {
  nombre: string;
  codigo: string;
  codigoTocado: boolean;
  agrupacionId: string;
  tratamiento: boolean;
  modalidad: ModalidadEfectiva;
  nota: string;
};

const FORM_VACIO: Form = { nombre: "", codigo: "", codigoTocado: false, agrupacionId: "", tratamiento: false, modalidad: "barrido", nota: "" };

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

/** Marcada con esa modalidad y que cuenta por sí misma (un miembro de conjunto efectivo cuenta como su cabeza). */
function enTratamiento(m: MarcaConGml, modalidad: ModalidadEfectiva): boolean {
  return m.tratamiento_especial && !esMiembroEfectivo(m) && m.modalidad_efectiva === modalidad;
}

/** Explica un aviso de conjunto de una marca miembro, con los nombres reales (va en el `title`). */
function textoAviso(aviso: AvisoConjunto, m: MarcaConGml, cabeza: MarcaConGml | undefined): string {
  const nombreCabeza = m.conjunto?.nombre ?? "su cabeza";
  switch (aviso) {
    case "agrupacion_distinta":
      return `Está en ${m.agrupacion_marca.nombre}; en el flujo cuenta como ${cabeza?.agrupacion_marca.nombre ?? "la agrupación de la cabeza"}, la agrupación de ${nombreCabeza}.`;
    case "cabeza_inactiva":
      return `${nombreCabeza} está inactiva: ${m.nombre} cuenta como ella misma mientras tanto.`;
    case "config_propia_ignorada":
      return `Tiene tratamiento especial o GML propios: quedan ignorados mientras pertenezca a ${nombreCabeza}.`;
    case "cadena":
      return `${nombreCabeza} es miembro de otro conjunto (cadena): el flujo solo resuelve un nivel. Corrígelo en Conjuntos.`;
  }
}

/**
 * Pestaña Marcas: alta, filtros (agrupación · tratamiento · conjuntos · texto)
 * y tabla. Agrupación, tratamiento, modalidad y conjunto se guardan al instante
 * desde la fila; nombre, código y nota se editan en un diálogo.
 */
export function MarcasTabla({
  marcas,
  cargando,
  agrupaciones,
  puedeEditar,
  mostrarInactivos,
  onCambio,
  onIrAGml,
  onIrAConjunto,
}: {
  marcas: MarcaConGml[];
  cargando: boolean;
  agrupaciones: AgrupacionMarcaFila[];
  puedeEditar: boolean;
  mostrarInactivos: boolean;
  onCambio: () => Promise<void>;
  /** Abre la pestaña de marcas relevantes con la marca seleccionada. */
  onIrAGml: (marcaId: string) => void;
  /** Abre la pestaña Conjuntos con el conjunto de esa cabeza seleccionado. */
  onIrAConjunto: (cabezaId: string) => void;
}) {
  const [form, setForm] = useState<Form>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<MarcaConGml | null>(null);
  const [nuevoConjuntoPara, setNuevoConjuntoPara] = useState<MarcaConGml | null>(null);
  const [filtroChip, setFiltroChip] = useState<string>(FILTRO_TODAS);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<OrdenMarca>(ORDEN_MARCA_INICIAL);

  const agrupacionesActivas = agrupaciones.filter((a) => a.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const agrupacionesVisibles = mostrarInactivos ? [...agrupaciones].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)) : agrupacionesActivas;

  const nombreNormalizado = normalizarNombre(form.nombre);
  const codigoPropuesto = form.codigoTocado ? aCodigo(form.codigo) : aCodigo(nombreNormalizado);
  const agrupacionForm = agrupacionesActivas.find((a) => a.id === form.agrupacionId);

  const porId = new Map(marcas.map((m) => [m.id, m]));
  /** Cabezas a las que se puede mandar una marca: activas con miembros (una cabeza inactiva no admite entradas). */
  const cabezas = marcas.filter((m) => m.miembros > 0 && m.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // ─── Filtros en memoria ───
  const base = mostrarInactivos ? marcas : marcas.filter((m) => m.activo);
  const porAgrupacion = new Map<string, number>();
  const conteo = { tratamiento: 0, porGml: 0, barrido: 0, mixta: 0, pendientes: 0, enConjunto: 0, cabezas: 0 };
  for (const m of base) {
    porAgrupacion.set(m.agrupacion_marca_id, (porAgrupacion.get(m.agrupacion_marca_id) ?? 0) + 1);
    if (m.tratamiento_especial) conteo.tratamiento++;
    if (enTratamiento(m, "por_gml")) conteo.porGml++;
    if (enTratamiento(m, "barrido")) conteo.barrido++;
    if (enTratamiento(m, "mixta")) conteo.mixta++;
    if (estaPendiente(m)) conteo.pendientes++;
    if (m.conjunto_marca_id) conteo.enConjunto++;
    if (m.miembros > 0) conteo.cabezas++;
  }
  const chips: ChipItem<string>[] = [
    { id: FILTRO_TODAS, label: "Todas", conteo: base.length },
    ...agrupacionesVisibles.map((a): ChipItem<string> => ({ id: a.id, label: a.nombre, conteo: porAgrupacion.get(a.id) ?? 0 })),
    { id: FILTRO_TRATAMIENTO, label: "Con tratamiento especial", conteo: conteo.tratamiento },
    { id: FILTRO_POR_GML, label: "Por GML", conteo: conteo.porGml },
    { id: FILTRO_BARRIDO, label: "Al barrer", conteo: conteo.barrido },
    { id: FILTRO_MIXTA, label: "Mixtas", conteo: conteo.mixta },
    { id: FILTRO_PENDIENTES, label: "Pendientes", conteo: conteo.pendientes },
    { id: FILTRO_EN_CONJUNTO, label: "En conjunto", conteo: conteo.enConjunto },
    { id: FILTRO_CABEZAS, label: "Cabezas", conteo: conteo.cabezas },
  ];
  // Si la agrupación filtrada dejó de ser visible (se apagó "Mostrar inactivos"), se vuelve a "todas" sin efectos.
  const chipVigente = chips.some((c) => c.id === filtroChip) ? filtroChip : FILTRO_TODAS;
  const consulta = normalizarNombre(busqueda);
  const consultaCodigo = aCodigo(consulta);

  function pasaChip(m: MarcaConGml): boolean {
    switch (chipVigente) {
      case FILTRO_TODAS:
        return true;
      case FILTRO_TRATAMIENTO:
        return m.tratamiento_especial;
      case FILTRO_POR_GML:
        return enTratamiento(m, "por_gml");
      case FILTRO_BARRIDO:
        return enTratamiento(m, "barrido");
      case FILTRO_MIXTA:
        return enTratamiento(m, "mixta");
      case FILTRO_PENDIENTES:
        return estaPendiente(m);
      case FILTRO_EN_CONJUNTO:
        return Boolean(m.conjunto_marca_id);
      case FILTRO_CABEZAS:
        return m.miembros > 0;
      default:
        return m.agrupacion_marca_id === chipVigente;
    }
  }

  const filas = ordenarMarcas(
    base.filter(pasaChip).filter((m) => (consulta ? m.nombre.includes(consulta) || (consultaCodigo !== "" && m.codigo.includes(consultaCodigo)) : true)),
    orden
  ) as MarcaConGml[];

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
    const cuerpo: CrearMarcaCuerpoM2b = {
      nombre: nombreNormalizado,
      codigo: codigoPropuesto,
      agrupacion_marca_id: form.agrupacionId,
      tratamiento_especial: form.tratamiento,
      // Sin modalidad la API la deja al barrer; solo se manda cuando se pide por GML o mixta.
      ...(form.tratamiento && form.modalidad !== "barrido" ? cuerpoModalidad(form.modalidad) : {}),
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

  async function guardarEdicion(cuerpo: EditarMarcaCuerpoM2b) {
    if (!editando) return;
    const ok = await ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${editando.id}`, cuerpo));
    if (ok) setEditando(null);
  }

  function abrirEdicion(m: MarcaConGml) {
    setError(null);
    setEditando(m);
  }

  function cerrarEdicion() {
    setError(null);
    setEditando(null);
  }

  function parchear(m: MarcaConGml, cuerpo: EditarMarcaCuerpoM2b) {
    return ejecutar(() => api.patch<MarcaFila>(`/api/marcas/${m.id}`, cuerpo));
  }

  function cambiarAgrupacion(m: MarcaConGml, agrupacion_marca_id: string) {
    if (!agrupacion_marca_id || agrupacion_marca_id === m.agrupacion_marca_id) return;
    void parchear(m, { agrupacion_marca_id });
  }

  function cambiarTratamiento(m: MarcaConGml, tratamiento_especial: boolean) {
    if (!tratamiento_especial) {
      const partes: string[] = [];
      if (m.nota_tratamiento) partes.push(`Se borrará la nota "${m.nota_tratamiento}".`);
      if (m.gml_asignados > 0) {
        partes.push(
          `Sus ${m.gml_asignados} GML relevantes se conservan, pero quedarán ignorados hasta que vuelvas a marcarla.`
        );
      }
      if (partes.length > 0 && !confirm(`¿Quitar el tratamiento especial de ${m.nombre}?\n${partes.join("\n")}`)) return;
    }
    void parchear(m, { tratamiento_especial });
  }

  function cambiarModalidad(m: MarcaConGml, valor: string) {
    if (!MODALIDADES_ELEGIBLES.includes(valor as ModalidadEfectiva)) return;
    const nueva = valor as ModalidadEfectiva;
    if (nueva === m.modalidad_efectiva && !sinModalidadGuardada(m)) return;
    // Cambia el estado de los GML (se ignoran o dejan de ignorarse) y el reparto/proyecciones vigentes: casi siempre se confirma.
    const de = m.modalidad_efectiva ?? "barrido";
    const { pide, gml } = confirmacionCambioModalidad(m, de, nueva);
    if (pide && !confirm(textoConfirmarModalidad({ nombre: m.nombre, de, a: nueva, gml, tieneReparto: null }))) return;
    void parchear(m, cuerpoModalidad(nueva));
  }

  function cambiarConjunto(m: MarcaConGml, valor: string) {
    if (valor === NUEVA_CABEZA) {
      setError(null);
      setNuevoConjuntoPara(m);
      return;
    }
    const destino = valor === "" ? null : valor;
    if (destino === (m.conjunto_marca_id ?? null)) return;
    if (destino) {
      const cabeza = porId.get(destino);
      const propias: string[] = [];
      if (m.tratamiento_especial) propias.push("tratamiento especial");
      if (m.gml_asignados > 0) propias.push(`${m.gml_asignados} GML relevantes`);
      if (propias.length > 0 && !confirm(`${m.nombre} tiene ${propias.join(" y ")} propios: quedarán ignorados mientras pertenezca a ${cabeza?.nombre ?? "ese conjunto"}.`)) {
        return;
      }
      if (m.conjunto && m.conjunto.id !== destino && !confirm(`${m.nombre} está en ${m.conjunto.nombre}: cambiará de conjunto.`)) return;
    }
    void parchear(m, { conjunto_marca_id: destino });
  }

  function alternarActivo(m: MarcaConGml) {
    void parchear(m, { activo: !m.activo });
  }

  function eliminar(m: MarcaConGml) {
    const gml = m.gml_asignados > 0 ? ` Se eliminarán también sus ${m.gml_asignados} GML.` : "";
    if (!confirm(`¿Eliminar definitivamente la marca ${m.nombre}?${gml} Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/marcas/${m.id}`));
  }

  const columnas: Columna<MarcaConGml>[] = [
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
              className="h-8 w-56"
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
      render: (m) => {
        const miembro = esMiembroEfectivo(m);
        const pendiente = motivoPendienteMarca(m);
        const ignoradas = Math.max(0, m.gml_asignados - m.gml_vigentes);
        return (
          <div className={`space-y-1 ${miembro ? "opacity-60" : ""}`} title={miembro ? `Cuenta como ${m.conjunto?.nombre}: su configuración propia queda ignorada.` : undefined}>
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
              {puedeEditar && m.tratamiento_especial && (
                <Select
                  value={sinModalidadGuardada(m) ? "" : (m.modalidad_efectiva ?? "")}
                  onChange={(e) => cambiarModalidad(m, e.target.value)}
                  disabled={ocupado}
                  className="h-8 w-60"
                  aria-label={`Modalidad de ${m.nombre}`}
                >
                  {sinModalidadGuardada(m) && (
                    <option value="" disabled>
                      Sin modalidad (al barrer)
                    </option>
                  )}
                  {MODALIDADES_ELEGIBLES.map((o) => (
                    <option key={o} value={o}>
                      {ETIQUETA_MODALIDAD[o]}
                    </option>
                  ))}
                </Select>
              )}
            </span>
            {m.tratamiento_especial && (
              <span className="flex flex-wrap items-center gap-1">
                {m.modalidad_efectiva === "por_gml" && (
                  <button
                    type="button"
                    onClick={() => onIrAGml(m.id)}
                    title="Ver sus GML relevantes"
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
                  >
                    <Badge tono="exito">Por GML · {m.gml_vigentes}</Badge>
                  </button>
                )}
                {ignoradas > 0 && <Badge tono="neutro">{ignoradas === 1 ? "1 ignorada" : `${ignoradas} ignoradas`}</Badge>}
                {pendiente && <Badge tono="alerta">{TEXTO_PENDIENTE[pendiente]}</Badge>}
                {m.modalidad_efectiva === "mixta" && (
                  <button
                    type="button"
                    onClick={() => onIrAGml(m.id)}
                    title="Ver sus GML específicos"
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
                  >
                    <Badge tono="marca">Mixta · {m.gml_vigentes} específicos</Badge>
                  </button>
                )}
                {m.modalidad_efectiva === "barrido" && <Badge tono="neutro">{sinModalidadGuardada(m) ? "Sin modalidad (al barrer)" : "Al barrer"}</Badge>}
                {miembro && <span className="text-xs text-tinta-suave">cuenta como {m.conjunto?.nombre}</span>}
              </span>
            )}
            {!m.tratamiento_especial && miembro && m.gml_asignados > 0 && (
              <span className="text-xs text-tinta-suave">cuenta como {m.conjunto?.nombre}</span>
            )}
          </div>
        );
      },
    },
    {
      clave: "conjunto",
      titulo: "Conjunto",
      render: (m) => {
        const cabeza = m.conjunto ? porId.get(m.conjunto.id) : undefined;
        const avisos = m.avisos_conjunto ?? [];
        const titulo = avisos.map((a) => textoAviso(a, m, cabeza)).join("\n");
        const esCabeza = m.miembros > 0;
        const generica = esMarcaGenerica(m.nombre);
        return (
          <div className="space-y-1">
            <span className="flex flex-wrap items-center gap-1" title={titulo || undefined}>
              {esCabeza && (
                <button
                  type="button"
                  onClick={() => onIrAConjunto(m.id)}
                  title="Abrir el conjunto"
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
                >
                  <Badge tono="marca">
                    Conjunto · {m.miembros} marca{m.miembros === 1 ? "" : "s"}
                  </Badge>
                </button>
              )}
              {!esCabeza && m.conjunto && <Badge tono={m.conjunto.activo ? "marca" : "neutro"}>en {m.conjunto.nombre}</Badge>}
              {avisos.map((a) => (
                <Badge key={a} tono="alerta">
                  {ETIQUETA_AVISO_CONJUNTO[a]}
                </Badge>
              ))}
            </span>
            {puedeEditar && !esCabeza && (
              <Select
                value={m.conjunto_marca_id ?? ""}
                onChange={(e) => cambiarConjunto(m, e.target.value)}
                disabled={ocupado || generica}
                title={generica ? "VARIOS, OTROS y SIN MARCA no entran en conjuntos." : undefined}
                className="h-8 w-52"
                aria-label={`Conjunto de ${m.nombre}`}
              >
                <option value="">Sin conjunto</option>
                {m.conjunto_marca_id && !cabezas.some((c) => c.id === m.conjunto_marca_id) && (
                  <option value={m.conjunto_marca_id}>{m.conjunto?.nombre ?? "Conjunto"} (inactiva)</option>
                )}
                {cabezas
                  .filter((c) => c.id !== m.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                <option value={NUEVA_CABEZA}>Nueva cabeza…</option>
              </Select>
            )}
          </div>
        );
      },
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
                onChange={(v) => setForm({ ...form, tratamiento: v, nota: v ? form.nota : "", modalidad: v ? form.modalidad : "barrido" })}
                label="Tratamiento especial"
              />
              Tratamiento especial
              <span className="text-xs text-tinta-suave">(se trata aparte al elaborar los flujos)</span>
            </label>
            {form.tratamiento && (
              <>
                <Field
                  label="Modalidad"
                  hint={
                    form.modalidad === "por_gml"
                      ? "Quedará pendiente hasta asignarle GML."
                      : form.modalidad === "mixta"
                        ? "Compras específicas en algunos GML y el resto al barrer; sin GML se comporta como al barrer."
                        : "Flujo propio, sin detalle por GML."
                  }
                >
                  <Select value={form.modalidad} onChange={(e) => setForm({ ...form, modalidad: e.target.value as ModalidadEfectiva })}>
                    <option value="barrido">{ETIQUETA_MODALIDAD.barrido}</option>
                    <option value="por_gml">{ETIQUETA_MODALIDAD.por_gml}</option>
                    <option value="mixta">{ETIQUETA_MODALIDAD.mixta}</option>
                  </Select>
                </Field>
                <Field label="Nota" hint={`${form.nota.length}/${MAX_NOTA}. Por qué se trata aparte; opcional.`}>
                  <Input value={form.nota} maxLength={MAX_NOTA} onChange={(e) => setForm({ ...form, nota: e.target.value })} />
                </Field>
              </>
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
        <Chips items={chips} activo={chipVigente} onCambiar={setFiltroChip} etiqueta="Filtrar marcas" className="mb-4" />
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
            Cambiar la agrupación, el tratamiento especial, la modalidad o el conjunto se guarda al instante; nombre, código y nota, con
            Editar (abre un diálogo). Al quitar el tratamiento se borra la nota, pero sus GML relevantes se conservan ignorados. Una marca
            miembro de un conjunto cuenta como su cabeza en el flujo. Pulsa un encabezado para ordenar; Agrupación ordena por valor de
            marca (de menor a mayor valor), no alfabéticamente.
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

      {nuevoConjuntoPara && (
        <CrearConjuntoDialogo
          marcas={marcas}
          agrupaciones={agrupaciones}
          miembroInicial={nuevoConjuntoPara}
          onCerrar={() => setNuevoConjuntoPara(null)}
          onCreado={async (cabezaId) => {
            setNuevoConjuntoPara(null);
            await onCambio();
            onIrAConjunto(cabezaId);
          }}
        />
      )}
    </div>
  );
}
