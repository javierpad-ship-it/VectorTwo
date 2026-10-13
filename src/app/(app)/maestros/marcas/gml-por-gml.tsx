"use client";

import { useMemo, useState } from "react";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero, plural } from "@/lib/formato";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { esMarcaGenerica, esMiembroEfectivo, ETIQUETA_MODALIDAD, rutaNodo, type NodoPlano } from "@/components/marcas/comunes-m2b";
import type { EstadoGmlEspecial, MarcaConGml, NodoEstadoGml } from "@/components/marcas/tipos-m2b";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import type { OperacionesGml } from "./gml-tab";
import { BarraFiltroNodos, FILTRO_NODOS_VACIO, filtrarNodos, type FiltroNodos } from "./selector-nodos";

const MAX_FILAS = 200;
const MAX_OTRAS_MARCAS = 30;

type FilaNodo = NodoPlano & { estado: NodoEstadoGml | null };

/**
 * Vista "Por GML": los nodos con sus marcas relevantes por agrupación; al
 * abrir uno se ven, agrupadas por agrupación de marca, las marcas con casilla
 * para hacerlas relevantes o quitarlas. Con nodos marcados en la tabla, las
 * acciones se aplican a todos (marcas × nodos).
 */
export function GmlPorGml({
  estado,
  marcas,
  nodos,
  agrupaciones,
  ops,
  nodoInicial,
}: {
  estado: EstadoGmlEspecial | null;
  marcas: MarcaConGml[];
  nodos: NodoPlano[];
  agrupaciones: AgrupacionMarcaFila[];
  ops: OperacionesGml;
  nodoInicial: string | null;
}) {
  const [filtro, setFiltro] = useState<FiltroNodos>(FILTRO_NODOS_VACIO);
  const [soloConRelevantes, setSoloConRelevantes] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(nodoInicial);
  const [nodosSel, setNodosSel] = useState<Set<string>>(() => new Set());
  const [marcasSel, setMarcasSel] = useState<Set<string>>(() => new Set());
  const [busquedaMarca, setBusquedaMarca] = useState("");

  const porNodo = useMemo(() => new Map((estado?.por_nodo ?? []).map((n) => [n.genero_mundo_linea_id, n])), [estado]);
  const agrupacionesOrdenadas = useMemo(
    () => [...agrupaciones].filter((a) => a.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es")),
    [agrupaciones]
  );

  // Los nodos con relevantes que ya no están vigentes (línea desactivada) no vienen del árbol vigente: se agregan sin género ni mundo
  // para poder verlos con los filtros en "todos".
  const filas: FilaNodo[] = useMemo(() => {
    const deArbol = nodos.map((n): FilaNodo => ({ ...n, estado: porNodo.get(n.id) ?? null }));
    const ids = new Set(nodos.map((n) => n.id));
    const extra = (estado?.por_nodo ?? [])
      .filter((p) => !ids.has(p.genero_mundo_linea_id))
      .map(
        (p): FilaNodo => ({
          id: p.genero_mundo_linea_id,
          generoId: "",
          genero: p.genero,
          mundoId: "",
          mundo: p.mundo,
          lineaId: "",
          linea: p.linea,
          nivel: p.nivel_planificacion,
          vigente: p.vigente,
          equivalencias: 0,
          estado: p,
        })
      );
    return [...deArbol, ...extra];
  }, [nodos, estado, porNodo]);

  const filtradas = useMemo(() => {
    const base = filtrarNodos(filas, filtro) as FilaNodo[];
    return soloConRelevantes ? base.filter((f) => f.estado !== null) : base;
  }, [filas, filtro, soloConRelevantes]);
  const visibles = filtradas.slice(0, MAX_FILAS);

  const abierto = abiertoId ? filas.find((f) => f.id === abiertoId) ?? null : null;
  const nodosObjetivo = nodosSel.size > 0 ? [...nodosSel] : abierto ? [abierto.id] : [];

  // ─── Lista de marcas del detalle ───
  const relevantesEnAbierto = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of abierto?.estado?.agrupaciones ?? []) for (const x of a.marcas) m.set(x.marca_id, x.vigente);
    return m;
  }, [abierto]);
  const consulta = normalizarNombre(busquedaMarca);
  const unidades = marcas.filter((m) => m.activo && !esMiembroEfectivo(m) && !esMarcaGenerica(m.nombre));
  const marcadas = unidades.filter((m) => m.tratamiento_especial || relevantesEnAbierto.has(m.id));
  const otras = consulta.length >= 2 ? unidades.filter((m) => !m.tratamiento_especial && !relevantesEnAbierto.has(m.id) && m.nombre.includes(consulta)) : [];
  const mostradas = [...marcadas.filter((m) => consulta === "" || m.nombre.includes(consulta)), ...otras.slice(0, MAX_OTRAS_MARCAS)];
  const porAgrupacion = new Map<string, MarcaConGml[]>();
  for (const m of mostradas) {
    const l = porAgrupacion.get(m.agrupacion_marca_id) ?? [];
    l.push(m);
    porAgrupacion.set(m.agrupacion_marca_id, l);
  }
  const gruposMarcas = [...porAgrupacion.entries()]
    .map(([id, lista]) => ({
      id,
      nombre: lista[0].agrupacion_marca.nombre,
      orden: lista[0].agrupacion_marca.orden,
      lista: lista.sort((a, b) => Number(b.tratamiento_especial) - Number(a.tratamiento_especial) || a.nombre.localeCompare(b.nombre, "es")),
    }))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
  const marcasElegidas = marcas.filter((m) => marcasSel.has(m.id));

  async function accionBloque(accion: "asignar" | "quitar") {
    if (marcasElegidas.length === 0 || nodosObjetivo.length === 0) return;
    const ok = await ops.asignar(
      { forma: "cartesiano", accion, marca_ids: marcasElegidas.map((m) => m.id), nodo_ids: nodosObjetivo },
      marcasElegidas,
      { siempreConfirmar: nodosObjetivo.length > 1 }
    );
    if (ok) setMarcasSel(new Set());
  }

  const columnas: Columna<FilaNodo>[] = [
    {
      clave: "sel",
      titulo: "",
      render: (f) => (
        <Checkbox
          checked={nodosSel.has(f.id)}
          disabled={!f.vigente}
          onChange={(v) => {
            const s = new Set(nodosSel);
            if (v) s.add(f.id);
            else s.delete(f.id);
            setNodosSel(s);
          }}
          label={`Elegir ${rutaNodo(f)} para un bloque`}
        />
      ),
    },
    { clave: "genero", titulo: "Género", render: (f) => f.genero },
    { clave: "mundo", titulo: "Mundo", render: (f) => f.mundo },
    {
      clave: "linea",
      titulo: "Línea",
      render: (f) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{f.linea}</span>
          {!f.vigente && <Badge tono="alerta">No vigente</Badge>}
        </span>
      ),
    },
    { clave: "nivel", titulo: "Nivel", render: (f) => (f.nivel === "GMLE" ? <Badge tono="marca">GMLE</Badge> : <span className="text-tinta-suave">GML</span>) },
    {
      clave: "relevantes",
      titulo: "Relevantes",
      render: (f) => {
        if (!f.estado) return <span className="text-tinta-suave">—</span>;
        const e = f.estado;
        return (
          <span className="flex flex-wrap items-center gap-x-1 text-xs">
            {agrupacionesOrdenadas.map((a, i) => {
              const m = e.agrupaciones.find((x) => x.agrupacion_marca_id === a.id)?.marcas ?? [];
              return (
                <span key={a.id}>
                  {i > 0 && <span className="text-tinta-suave"> · </span>}
                  <span className="text-tinta-suave">{a.nombre}: </span>
                  {m.length === 0
                    ? "—"
                    : m.map((x, j) => (
                        <span key={x.marca_id} className={x.vigente ? "font-medium text-tinta" : "text-tinta-suave opacity-60"} title={x.vigente ? undefined : "Ignorada"}>
                          {j > 0 ? ", " : ""}
                          {x.nombre}
                        </span>
                      ))}
                </span>
              );
            })}
          </span>
        );
      },
    },
    {
      clave: "n",
      titulo: "N.º",
      render: (f) => {
        if (!f.estado) return <span className="text-tinta-suave">0</span>;
        const exceso = f.estado.agrupaciones.filter((a) => a.marcas.filter((m) => m.vigente).length > 4);
        return (
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-mono">{f.estado.relevantes_vigentes}</span>
            {exceso.length > 0 && (
              <span title={`Más de 4 en ${exceso.map((a) => a.nombre).join(", ")}: Javier habló de 3 o 4; es un aviso, no un tope.`}>
                <Badge tono="alerta">Más de 4</Badge>
              </span>
            )}
          </span>
        );
      },
    },
    {
      clave: "abrir",
      titulo: "",
      className: "text-right",
      render: (f) => (
        <Button variante={f.id === abiertoId ? "primario" : "fantasma"} tamano="sm" onClick={() => setAbiertoId(f.id === abiertoId ? null : f.id)} aria-pressed={f.id === abiertoId}>
          {f.id === abiertoId ? "Abierto" : "Abrir"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card
        titulo={`GML (${formatearNumero(filtradas.length)})`}
        descripcion="Cada fila es un género-mundo-línea vigente. Ábrelo para ver y cambiar sus marcas relevantes; marca varios para actuar en bloque."
        acciones={<Switch checked={soloConRelevantes} onChange={setSoloConRelevantes} label="Solo con relevantes" />}
      >
        <div className="space-y-3">
          <BarraFiltroNodos nodos={nodos} filtro={filtro} onCambiar={setFiltro} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variante="fantasma"
              tamano="sm"
              disabled={filtradas.filter((f) => f.vigente).length === 0}
              onClick={() => setNodosSel(new Set(filtradas.filter((f) => f.vigente).map((f) => f.id)))}
            >
              Marcar los {formatearNumero(filtradas.filter((f) => f.vigente).length)} filtrados
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={nodosSel.size === 0} onClick={() => setNodosSel(new Set())}>
              Limpiar ({formatearNumero(nodosSel.size)})
            </Button>
          </div>
          <DataTable
            columnas={columnas}
            filas={visibles}
            claveFila={(f) => f.id}
            cargando={!estado && nodos.length === 0}
            vacio={soloConRelevantes ? "Ningún GML con relevantes coincide con el filtro." : "Ningún GML coincide con el filtro."}
            claseFila={(f) => (f.id === abiertoId ? "bg-marca-suave/40" : f.vigente ? undefined : "opacity-60")}
          />
          {filtradas.length > visibles.length && (
            <p className="text-xs text-tinta-suave">
              Mostrando {visibles.length} de {formatearNumero(filtradas.length)}: afina los filtros.
            </p>
          )}
        </div>
      </Card>

      {abierto ? (
        <Card
          titulo={rutaNodo(abierto)}
          descripcion={`Nivel ${abierto.nivel}${abierto.vigente ? "" : " · GML no vigente"}. Las marcas con tratamiento especial van primero; busca para añadir cualquier otra marca activa.`}
          acciones={<Button variante="fantasma" tamano="sm" onClick={() => setAbiertoId(null)}>Cerrar</Button>}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="search"
                placeholder="Buscar marca para añadir (mínimo 2 letras)…"
                value={busquedaMarca}
                onChange={(e) => setBusquedaMarca(e.target.value)}
                className="h-8 w-72"
                aria-label="Buscar marca"
              />
              <Button tamano="sm" disabled={ops.ocupado || marcasSel.size === 0 || nodosObjetivo.length === 0} onClick={() => void accionBloque("asignar")}>
                Hacer relevantes ({marcasSel.size}){nodosObjetivo.length > 1 ? ` en ${plural(nodosObjetivo.length, "GML", "GML")}` : ""}
              </Button>
              <Button variante="peligro" tamano="sm" disabled={ops.ocupado || marcasSel.size === 0 || nodosObjetivo.length === 0} onClick={() => void accionBloque("quitar")}>
                Quitar ({marcasSel.size}){nodosObjetivo.length > 1 ? ` en ${plural(nodosObjetivo.length, "GML", "GML")}` : ""}
              </Button>
              {nodosSel.size > 0 && <span className="text-xs text-tinta-suave">Las acciones se aplican a los {nodosSel.size} GML marcados en la tabla.</span>}
            </div>

            {gruposMarcas.length === 0 && <EmptyState titulo="Sin marcas para mostrar" detalle="Marca marcas con tratamiento especial o busca una por nombre." />}
            {gruposMarcas.map((g) => (
              <div key={g.id}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">{g.nombre}</h3>
                <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {g.lista.map((m) => {
                    const rel = relevantesEnAbierto.get(m.id);
                    return (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={marcasSel.has(m.id)}
                          onChange={(v) => {
                            const s = new Set(marcasSel);
                            if (v) s.add(m.id);
                            else s.delete(m.id);
                            setMarcasSel(s);
                          }}
                          label={`Elegir ${m.nombre}`}
                        />
                        <span className="min-w-0 truncate" title={m.nombre}>
                          {m.nombre}
                        </span>
                        {rel === true && <Badge tono="exito">Relevante aquí</Badge>}
                        {rel === false && <Badge tono="neutro">Ignorada</Badge>}
                        {rel === undefined && !m.tratamiento_especial && <Badge tono="neutro">Se marcará</Badge>}
                        {rel === undefined && m.modalidad_efectiva === "barrido" && <Badge tono="neutro">{ETIQUETA_MODALIDAD.barrido}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {otras.length > MAX_OTRAS_MARCAS && <p className="text-xs text-tinta-suave">Mostrando {MAX_OTRAS_MARCAS} de {otras.length} coincidencias: escribe más para acotar.</p>}
          </div>
        </Card>
      ) : (
        <EmptyState titulo="Abre un GML" detalle="Pulsa Abrir en una fila para ver sus marcas relevantes y cambiarlas." />
      )}
    </div>
  );
}
