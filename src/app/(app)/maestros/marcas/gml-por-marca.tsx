"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero, plural } from "@/lib/formato";
import { esMarcaGenerica, esMiembroEfectivo, ETIQUETA_MODALIDAD, type NodoPlano } from "@/components/marcas/comunes-m2b";
import {
  ETIQUETA_MOTIVO_IGNORADA,
  type AsignacionGml,
  type EditarMarcaCuerpoM2b,
  type EstadoGmlEspecial,
  type MarcaConGml,
  type MarcaEstadoGml,
} from "@/components/marcas/tipos-m2b";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { Columna as ColumnaLista, FilaColumna } from "../arbol/comunes";
import type { OperacionesGml } from "./gml-tab";
import { SelectorNodos } from "./selector-nodos";
import { MAX_NOTA } from "./editar-marca-dialogo";

type FiltroLista = "todas" | "por_gml" | "barrido" | "pendientes" | "ignoradas";

/** Una marca que aún no está marcada se muestra como candidata: al asignarle un GML la API la marca. */
function desdeMarca(m: MarcaConGml): MarcaEstadoGml {
  return {
    id: m.id,
    nombre: m.nombre,
    codigo: m.codigo,
    activo: m.activo,
    vigente: m.vigente,
    agrupacion_marca: { id: m.agrupacion_marca.id, nombre: m.agrupacion_marca.nombre, activo: m.agrupacion_marca.activo },
    modalidad_tratamiento: m.modalidad_tratamiento,
    modalidad_efectiva: m.modalidad_efectiva,
    nota_tratamiento: m.nota_tratamiento,
    conjunto: m.conjunto ? { id: m.conjunto.id, nombre: m.conjunto.nombre } : null,
    miembros: [],
    gml: [],
    pendiente: false,
    motivo_pendiente: null,
  };
}

function etiquetaModalidad(m: Pick<MarcaEstadoGml, "modalidad_efectiva" | "modalidad_tratamiento">): { texto: string; tono: "exito" | "neutro" } {
  if (m.modalidad_efectiva === "por_gml") return { texto: ETIQUETA_MODALIDAD.por_gml, tono: "exito" };
  if (m.modalidad_efectiva === "barrido") {
    return { texto: m.modalidad_tratamiento === null ? "Sin modalidad (al barrer)" : ETIQUETA_MODALIDAD.barrido, tono: "neutro" };
  }
  return { texto: "Sin tratamiento", tono: "neutro" };
}

function estadoAsignacion(g: AsignacionGml): { texto: string; tono: "exito" | "neutro" } {
  if (g.vigente) return { texto: "Vigente", tono: "exito" };
  if (g.motivo_ignorada === "gml_no_vigente") return { texto: `Ignorada: ${g.detalle ?? ETIQUETA_MOTIVO_IGNORADA.gml_no_vigente}`, tono: "neutro" };
  return { texto: `Ignorada: ${g.motivo_ignorada ? ETIQUETA_MOTIVO_IGNORADA[g.motivo_ignorada] : "sin motivo"}`, tono: "neutro" };
}

/**
 * Vista "Por marca": a la izquierda las marcas con tratamiento especial (con
 * casilla para los bloques); a la derecha la marca elegida, los GML donde es
 * relevante y el selector para agregarle más. Con marcas marcadas en la lista,
 * "Agregar GML" aplica a todas (producto cartesiano marcas × GML).
 */
export function GmlPorMarca({
  estado,
  marcas,
  nodos,
  ops,
  marcaInicial,
  onIrAConjuntos,
}: {
  estado: EstadoGmlEspecial | null;
  marcas: MarcaConGml[];
  nodos: NodoPlano[];
  ops: OperacionesGml;
  marcaInicial: string | null;
  onIrAConjuntos: (cabezaId: string) => void;
}) {
  const [selId, setSelId] = useState<string | null>(marcaInicial);
  const [adicionales, setAdicionales] = useState<string[]>(marcaInicial ? [marcaInicial] : []);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set());
  const [filtro, setFiltro] = useState<FiltroLista>("todas");
  const [busqueda, setBusqueda] = useState("");
  const [agregandoMarca, setAgregandoMarca] = useState(false);
  const [nodosSel, setNodosSel] = useState<Set<string>>(() => new Set());
  const [nota, setNota] = useState("");
  const [seleccionGml, setSeleccionGml] = useState<Set<string>>(() => new Set());
  const [notas, setNotas] = useState<Record<string, string>>({});

  const porId = useMemo(() => new Map(marcas.map((m) => [m.id, m])), [marcas]);

  const lista = useMemo(() => {
    const base = estado?.marcas ?? [];
    const ids = new Set(base.map((m) => m.id));
    const extra = adicionales.filter((id) => !ids.has(id)).flatMap((id) => (porId.get(id) ? [desdeMarca(porId.get(id) as MarcaConGml)] : []));
    return [...base, ...extra].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [estado, adicionales, porId]);

  const consulta = normalizarNombre(busqueda);
  const filtradas = lista.filter((m) => {
    if (consulta && !m.nombre.includes(consulta)) return false;
    switch (filtro) {
      case "por_gml":
        return m.modalidad_efectiva === "por_gml";
      case "barrido":
        return m.modalidad_efectiva === "barrido";
      case "pendientes":
        return m.pendiente;
      case "ignoradas":
        return m.gml.some((g) => !g.vigente);
      default:
        return true;
    }
  });
  const chips: ChipItem<FiltroLista>[] = [
    { id: "todas", label: "Todas", conteo: lista.length },
    { id: "por_gml", label: "Por GML", conteo: lista.filter((m) => m.modalidad_efectiva === "por_gml").length },
    { id: "barrido", label: "Al barrer", conteo: lista.filter((m) => m.modalidad_efectiva === "barrido").length },
    { id: "pendientes", label: "Pendientes", conteo: lista.filter((m) => m.pendiente).length },
    { id: "ignoradas", label: "Con ignoradas", conteo: lista.filter((m) => m.gml.some((g) => !g.vigente)).length },
  ];

  const sel = lista.find((m) => m.id === selId) ?? filtradas[0] ?? null;
  const marcaSel = sel ? porId.get(sel.id) : undefined;
  const miembroDe = marcaSel && esMiembroEfectivo(marcaSel) ? marcaSel.conjunto : null;

  // Marcas sobre las que actúa "Agregar GML": las marcadas en la lista o, si no hay, la elegida.
  const idsObjetivo = marcadas.size > 0 ? [...marcadas] : sel ? [sel.id] : [];
  const objetivo: MarcaConGml[] = idsObjetivo.flatMap((id) => (porId.get(id) ? [porId.get(id) as MarcaConGml] : []));

  const nodosPorMarca = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const x of estado?.marcas ?? []) m.set(x.id, new Set(x.gml.map((g) => g.genero_mundo_linea_id)));
    return m;
  }, [estado]);
  const yaRelevante = (nodoId: string) => objetivo.length > 0 && objetivo.every((m) => nodosPorMarca.get(m.id)?.has(nodoId) === true);

  // Candidatas para "Agregar marca…": activas, sin casilla (las demás ya están en la lista), sin conjunto efectivo y no genéricas.
  const enLista = new Set(lista.map((m) => m.id));
  const candidatas = marcas
    .filter((m) => m.activo && !enLista.has(m.id) && !esMiembroEfectivo(m) && !esMarcaGenerica(m.nombre) && !m.tratamiento_especial)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  function seleccionarMarca(id: string) {
    setSelId(id);
    setSeleccionGml(new Set());
    setNodosSel(new Set());
    if (!estado?.marcas.some((m) => m.id === id) && !adicionales.includes(id)) setAdicionales([...adicionales, id]);
  }

  async function cambiarModalidad(valor: string) {
    if (!sel || !marcaSel || (valor !== "por_gml" && valor !== "barrido")) return;
    if (valor === marcaSel.modalidad_tratamiento) return;
    const vigentes = sel.gml.length;
    if (valor === "barrido" && vigentes > 0 && !confirm(`¿Pasar ${sel.nombre} a Al barrer? Sus ${vigentes} GML quedarán ignorados (no se borran).`)) return;
    const cuerpo: EditarMarcaCuerpoM2b = { modalidad_tratamiento: valor };
    await ops.mutar(() => api.patch(`/api/marcas/${sel.id}`, cuerpo));
  }

  async function aplicarGml() {
    if (objetivo.length === 0 || nodosSel.size === 0) return;
    const notaLimpia = nota.trim();
    const ok = await ops.asignar(
      {
        forma: "cartesiano",
        accion: "asignar",
        marca_ids: objetivo.map((m) => m.id),
        nodo_ids: [...nodosSel],
        ...(notaLimpia ? { nota: notaLimpia } : {}),
      },
      objetivo,
      { siempreConfirmar: objetivo.length > 1 }
    );
    if (ok) {
      setNodosSel(new Set());
      setNota("");
    }
  }

  async function quitarSeleccionados() {
    if (!sel) return;
    const elegidos = sel.gml.filter((g) => seleccionGml.has(g.id));
    if (elegidos.length === 0) return;
    const ok = await ops.asignar(
      { forma: "pares", accion: "quitar", pares: elegidos.map((g) => ({ marca_id: sel.id, nodo_id: g.genero_mundo_linea_id })) },
      [marcaSel as MarcaConGml].filter(Boolean)
    );
    if (ok) setSeleccionGml(new Set());
  }

  async function quitarUna(g: AsignacionGml) {
    if (!sel) return;
    if (!confirm(`¿Quitar a ${sel.nombre} de ${g.genero} · ${g.mundo} · ${g.linea}?`)) return;
    await ops.mutar(() => api.delete(`/api/marcas/gml-especial/${g.id}`));
  }

  async function guardarNota(g: AsignacionGml) {
    const nueva = (notas[g.id] ?? g.nota ?? "").trim();
    if (nueva === (g.nota ?? "")) return;
    const ok = await ops.mutar(() => api.patch(`/api/marcas/gml-especial/${g.id}`, { nota: nueva === "" ? null : nueva }));
    if (ok) {
      const resto = { ...notas };
      delete resto[g.id];
      setNotas(resto);
    }
  }

  const columnasGml: Columna<AsignacionGml>[] = [
    {
      clave: "sel",
      titulo: "",
      render: (g) => (
        <Checkbox
          checked={seleccionGml.has(g.id)}
          onChange={(v) => {
            const s = new Set(seleccionGml);
            if (v) s.add(g.id);
            else s.delete(g.id);
            setSeleccionGml(s);
          }}
          label={`Seleccionar ${g.genero} ${g.mundo} ${g.linea}`}
        />
      ),
    },
    { clave: "genero", titulo: "Género", render: (g) => g.genero },
    { clave: "mundo", titulo: "Mundo", render: (g) => g.mundo },
    { clave: "linea", titulo: "Línea", render: (g) => <span className="font-medium">{g.linea}</span> },
    { clave: "nivel", titulo: "Nivel", render: (g) => (g.nivel_planificacion === "GMLE" ? <Badge tono="marca">GMLE</Badge> : <span className="text-tinta-suave">GML</span>) },
    {
      clave: "nota",
      titulo: "Nota",
      render: (g) => (
        <Input
          value={notas[g.id] ?? g.nota ?? ""}
          maxLength={MAX_NOTA}
          disabled={ops.ocupado}
          onChange={(e) => setNotas({ ...notas, [g.id]: e.target.value })}
          onBlur={() => void guardarNota(g)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-8 w-48"
          aria-label={`Nota de ${g.genero} ${g.mundo} ${g.linea}`}
          placeholder="Sin nota"
        />
      ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (g) => {
        const e = estadoAsignacion(g);
        return <Badge tono={e.tono}>{e.texto}</Badge>;
      },
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (g) => (
        <Button variante="fantasma" tamano="sm" disabled={ops.ocupado} onClick={() => void quitarUna(g)}>
          Quitar
        </Button>
      ),
    },
  ];

  const nGmlTexto = plural(nodosSel.size, "GML", "GML");
  const textoAplicar =
    marcadas.size > 1 ? `Hacer relevantes en ${nGmlTexto} para las ${marcadas.size} marcas seleccionadas` : `Hacer relevante en ${nGmlTexto}`;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <ColumnaLista
          titulo="Marcas con tratamiento especial"
          subtitulo={`${filtradas.length} de ${lista.length}${marcadas.size > 0 ? ` · ${marcadas.size} marcadas para el bloque` : ""}`}
          acciones={
            <Button variante="secundario" tamano="sm" onClick={() => setAgregandoMarca((v) => !v)}>
              {agregandoMarca ? "Cerrar" : "Agregar marca…"}
            </Button>
          }
        >
          {agregandoMarca && (
            <div className="mb-3 rounded-lg border border-borde bg-fondo p-3">
              <Field label="Marca sin tratamiento especial" hint="Al asignarle un GML se marcará con tratamiento especial (Por GML), con confirmación.">
                <Select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      seleccionarMarca(e.target.value);
                      setAgregandoMarca(false);
                    }
                  }}
                >
                  <option value="">Elige una marca…</option>
                  {candidatas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} · {m.agrupacion_marca.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <div className="mb-2 space-y-2">
            <Input type="search" placeholder="Buscar marca…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="h-8" aria-label="Buscar marca" />
            <Chips items={chips} activo={filtro} onCambiar={setFiltro} etiqueta="Filtrar marcas" />
            {filtradas.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-tinta-suave">
                <Checkbox
                  checked={filtradas.every((m) => marcadas.has(m.id))}
                  indeterminado={filtradas.some((m) => marcadas.has(m.id))}
                  onChange={(v) => {
                    const s = new Set(marcadas);
                    for (const m of filtradas) {
                      if (v) s.add(m.id);
                      else s.delete(m.id);
                    }
                    setMarcadas(s);
                  }}
                  label="Marcar todas las marcas visibles para el bloque"
                />
                Marcar las visibles para un bloque
              </label>
            )}
          </div>
          <ul className="space-y-0.5">
            {filtradas.map((m) => {
              const mod = etiquetaModalidad(m);
              const ignoradas = m.gml.filter((g) => !g.vigente).length;
              const miembro = m.conjunto && porId.get(m.id) && esMiembroEfectivo(porId.get(m.id) as MarcaConGml);
              return (
                <li key={m.id} className="flex items-center gap-1">
                  <Checkbox
                    checked={marcadas.has(m.id)}
                    onChange={(v) => {
                      const s = new Set(marcadas);
                      if (v) s.add(m.id);
                      else s.delete(m.id);
                      setMarcadas(s);
                    }}
                    label={`Marcar ${m.nombre} para el bloque`}
                    className="ml-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <FilaColumna seleccionada={m.id === sel?.id} atenuada={!m.activo || Boolean(miembro)} onClick={() => seleccionarMarca(m.id)}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.nombre}</span>
                        <span className="block truncate text-xs text-tinta-suave">{m.agrupacion_marca.nombre}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          <Badge tono={mod.tono}>{mod.texto}</Badge>
                          {m.pendiente && <Badge tono="alerta">Pendiente: sin GML</Badge>}
                          {miembro && <Badge tono="neutro">en {m.conjunto?.nombre}</Badge>}
                          {!m.activo && <Badge tono="alerta">Inactiva</Badge>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-tinta-suave">
                        <span className="block">{m.gml.length} GML</span>
                        {ignoradas > 0 && <span className="block">{ignoradas} ignorada{ignoradas === 1 ? "" : "s"}</span>}
                      </span>
                    </FilaColumna>
                  </div>
                </li>
              );
            })}
          </ul>
          {lista.length === 0 && <EmptyState titulo="Ninguna marca con tratamiento especial" detalle="Usa “Agregar marca…” o márcalas en la pestaña Marcas." />}
          {lista.length > 0 && filtradas.length === 0 && <p className="px-2 py-3 text-sm text-tinta-suave">Ninguna marca coincide con el filtro.</p>}
        </ColumnaLista>
      </div>

      <div className="space-y-4 lg:col-span-8">
        {!sel && <EmptyState titulo="Elige una marca" detalle="Verás los GML donde es relevante y podrás agregarle más." />}
        {sel && (
          <>
            <Card
              titulo={sel.nombre}
              descripcion={`${sel.agrupacion_marca.nombre}${sel.activo ? "" : " · marca inactiva"}`}
              acciones={
                <span className="flex flex-wrap items-center justify-end gap-1">
                  <Badge tono={etiquetaModalidad(sel).tono}>{etiquetaModalidad(sel).texto}</Badge>
                  {sel.pendiente && <Badge tono="alerta">Pendiente: sin GML</Badge>}
                </span>
              }
            >
              <div className="space-y-3">
                {miembroDe && (
                  <Alert tono="info">
                    {sel.nombre} cuenta como {miembroDe.nombre}: hazlo relevante en {miembroDe.nombre}.{" "}
                    <button type="button" onClick={() => seleccionarMarca(miembroDe.id)} className="font-medium underline underline-offset-2">
                      Ir a {miembroDe.nombre}
                    </button>{" "}
                    ·{" "}
                    <button type="button" onClick={() => onIrAConjuntos(miembroDe.id)} className="font-medium underline underline-offset-2">
                      Ver el conjunto
                    </button>
                  </Alert>
                )}
                {marcaSel && !marcaSel.tratamiento_especial && (
                  <p className="text-sm text-tinta-suave">Sin tratamiento especial: se marcará con tratamiento especial (Por GML) al asignarle un GML.</p>
                )}
                {marcaSel?.tratamiento_especial && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Modalidad">
                      <Select value={marcaSel.modalidad_tratamiento ?? ""} onChange={(e) => void cambiarModalidad(e.target.value)} disabled={ops.ocupado}>
                        {marcaSel.modalidad_tratamiento === null && (
                          <option value="" disabled>
                            Sin modalidad (al barrer)
                          </option>
                        )}
                        <option value="por_gml">{ETIQUETA_MODALIDAD.por_gml}</option>
                        <option value="barrido">{ETIQUETA_MODALIDAD.barrido}</option>
                      </Select>
                    </Field>
                    <div>
                      <p className="mb-1 text-sm font-medium text-tinta">Nota de tratamiento</p>
                      <p className="text-sm text-tinta-suave">{sel.nota_tratamiento ?? "—"}</p>
                      <p className="mt-1 text-xs text-tinta-suave">Se edita en la pestaña Marcas (Editar).</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card
              titulo={`GML donde es relevante (${sel.gml.length})`}
              acciones={
                <Button variante="peligro" tamano="sm" disabled={ops.ocupado || seleccionGml.size === 0} onClick={() => void quitarSeleccionados()}>
                  Quitar {seleccionGml.size} seleccionado{seleccionGml.size === 1 ? "" : "s"}
                </Button>
              }
            >
              <div className="space-y-2">
                {sel.gml.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-tinta-suave">
                    <Checkbox
                      checked={seleccionGml.size === sel.gml.length}
                      indeterminado={seleccionGml.size > 0}
                      onChange={(v) => setSeleccionGml(v ? new Set(sel.gml.map((g) => g.id)) : new Set())}
                      label="Seleccionar todos los GML de la marca"
                    />
                    Seleccionar todos
                  </label>
                )}
                <DataTable
                  columnas={columnasGml}
                  filas={sel.gml}
                  claveFila={(g) => g.id}
                  vacio={sel.modalidad_efectiva === "barrido" ? "Marca al barrer: flujo independiente, sin GML." : "Sin GML. Asígnale al menos uno o pásala a Al barrer."}
                  claseFila={(g) => (g.vigente ? undefined : "opacity-60")}
                />
              </div>
            </Card>

            <Card
              titulo="Agregar GML"
              descripcion={
                objetivo.length > 1
                  ? `Se aplicará a las ${objetivo.length} marcas marcadas en la lista (${objetivo.map((m) => m.nombre).join(", ")}).`
                  : `Elige los GML donde ${sel.nombre} es relevante. Marca varias marcas en la lista para hacer un bloque.`
              }
            >
              {nodos.length === 0 ? (
                <p className="text-sm text-tinta-suave">Cargando el árbol de producto…</p>
              ) : (
                <div className="space-y-3">
                  <SelectorNodos nodos={nodos} yaRelevante={yaRelevante} seleccion={nodosSel} onSeleccion={setNodosSel} />
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Nota (opcional)" hint={`${nota.length}/${MAX_NOTA}`} className="w-72 max-w-full">
                      <Input value={nota} maxLength={MAX_NOTA} onChange={(e) => setNota(e.target.value)} />
                    </Field>
                    <Button disabled={ops.ocupado || nodosSel.size === 0 || objetivo.length === 0} onClick={() => void aplicarGml()}>
                      {textoAplicar}
                    </Button>
                    {objetivo.length > 1 && nodosSel.size > 0 && (
                      <span className="text-xs text-tinta-suave">{formatearNumero(objetivo.length * nodosSel.size)} pares en total</span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
