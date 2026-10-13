"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { descargarCsv } from "@/components/importador/csv";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { pct } from "@/components/marcas/comunes-m2b";
import {
  ETIQUETA_ESTADO_SUGERENCIA,
  type EstadoSugerencia,
  type MarcaConGml,
  type RespuestaSugerencias,
  type SugerenciaGml,
} from "@/components/marcas/tipos-m2b";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/form";
import type { OperacionesGml } from "./gml-tab";

const MAX_FILAS = 300;
const TODOS = "todos";

/** Estados sobre los que se puede actuar: la nueva y la marca al barrer (esta pasa a Por GML con confirmación). */
const SELECCIONABLES: ReadonlySet<EstadoSugerencia> = new Set<EstadoSugerencia>(["nueva", "marca_al_barrer"]);

const TONO_ESTADO: Record<EstadoSugerencia, "exito" | "marca" | "neutro" | "alerta"> = {
  nueva: "exito",
  ya_relevante: "marca",
  marca_al_barrer: "neutro",
  marca_inactiva: "alerta",
  nodo_no_vigente: "alerta",
};

type ClaveOrden = "gml" | "agrupacion" | "marca" | "rango" | "venta" | "participacion" | "estado";
type Orden = { clave: ClaveOrden; dir: "asc" | "desc" };

const clavePar = (s: SugerenciaGml) => `${s.genero_mundo_linea_id}|${s.marca_id}`;
const rutaDe = (s: SugerenciaGml) => `${s.genero} · ${s.mundo} · ${s.linea}`;

function comparar(clave: ClaveOrden, a: SugerenciaGml, b: SugerenciaGml): number {
  switch (clave) {
    case "gml":
      return rutaDe(a).localeCompare(rutaDe(b), "es");
    case "agrupacion":
      return a.agrupacion.localeCompare(b.agrupacion, "es");
    case "marca":
      return a.marca.localeCompare(b.marca, "es");
    case "rango":
      return a.rango - b.rango;
    case "venta":
      return a.venta_soles - b.venta_soles;
    case "participacion":
      return a.participacion - b.participacion;
    case "estado":
      return a.estado.localeCompare(b.estado);
  }
}

/**
 * Vista "Sugerencias": las marcas que más venden en cada GML y agrupación según
 * la venta de M5. Es ayuda: se calcula con un botón (2 a 5 s), el planner elige
 * y nada se asigna solo.
 */
export function GmlSugerencias({
  marcas,
  agrupaciones,
  ops,
}: {
  marcas: MarcaConGml[];
  agrupaciones: AgrupacionMarcaFila[];
  ops: OperacionesGml;
}) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [top, setTop] = useState("4");
  const [minPct, setMinPct] = useState("5");
  const [medida, setMedida] = useState<"venta_soles" | "unidades">("venta_soles");
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<RespuestaSugerencias | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set());
  const [generoId, setGeneroId] = useState(TODOS);
  const [mundo, setMundo] = useState(TODOS);
  const [linea, setLinea] = useState("");
  const [agrupacion, setAgrupacion] = useState(TODOS);
  const [soloNuevas, setSoloNuevas] = useState(false);
  const [orden, setOrden] = useState<Orden>({ clave: "gml", dir: "asc" });

  const topNum = Number(top);
  const minNum = Number(minPct);
  const parametrosValidos = Number.isInteger(topNum) && topNum >= 1 && topNum <= 10 && minNum >= 0 && minNum <= 50;

  async function calcular() {
    if (!parametrosValidos) return;
    setCalculando(true);
    setError(null);
    const q = new URLSearchParams();
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    q.set("top", String(topNum));
    q.set("min_participacion", String(minNum / 100));
    q.set("medida", medida);
    try {
      const r = await api.get<RespuestaSugerencias>(`/api/marcas/gml-especial/sugerencias?${q.toString()}`);
      setDatos(r);
      setSeleccion(new Set());
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCalculando(false);
    }
  }

  // Filtros por género, mundo, línea y agrupación sobre lo calculado.
  const sugerencias = useMemo(() => datos?.sugerencias ?? [], [datos]);
  const generos = useMemo(() => [...new Set(sugerencias.map((s) => s.genero))].sort((a, b) => a.localeCompare(b, "es")), [sugerencias]);
  const mundos = useMemo(
    () => [...new Set(sugerencias.filter((s) => generoId === TODOS || s.genero === generoId).map((s) => s.mundo))].sort((a, b) => a.localeCompare(b, "es")),
    [sugerencias, generoId]
  );
  const agrupacionesPresentes = useMemo(() => {
    const orden = new Map(agrupaciones.map((a) => [a.nombre, a.orden]));
    return [...new Set(sugerencias.map((s) => s.agrupacion))].sort((a, b) => (orden.get(a) ?? 99) - (orden.get(b) ?? 99) || a.localeCompare(b, "es"));
  }, [sugerencias, agrupaciones]);

  const consultaLinea = linea.trim().toLocaleUpperCase("es");
  const mundoVigente = mundo === TODOS || mundos.includes(mundo) ? mundo : TODOS;
  const filtradas = useMemo(() => {
    const base = sugerencias.filter(
      (s) =>
        (generoId === TODOS || s.genero === generoId) &&
        (mundoVigente === TODOS || s.mundo === mundoVigente) &&
        (consultaLinea === "" || s.linea.includes(consultaLinea)) &&
        (agrupacion === TODOS || s.agrupacion === agrupacion) &&
        (!soloNuevas || s.estado === "nueva")
    );
    const signo = orden.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => signo * comparar(orden.clave, a, b) || rutaDe(a).localeCompare(rutaDe(b), "es") || a.rango - b.rango);
  }, [sugerencias, generoId, mundoVigente, consultaLinea, agrupacion, soloNuevas, orden]);
  const visibles = filtradas.slice(0, MAX_FILAS);

  const nuevasFiltradas = filtradas.filter((s) => s.estado === "nueva");
  const elegidas = sugerencias.filter((s) => seleccion.has(clavePar(s)));
  const porId = useMemo(() => new Map(marcas.map((m) => [m.id, m])), [marcas]);

  async function aplicar() {
    if (elegidas.length === 0) return;
    const marcasObjetivo = [...new Set(elegidas.map((s) => s.marca_id))].flatMap((id) => (porId.get(id) ? [porId.get(id) as MarcaConGml] : []));
    const ok = await ops.asignar(
      { forma: "pares", accion: "asignar", pares: elegidas.map((s) => ({ marca_id: s.marca_id, nodo_id: s.genero_mundo_linea_id })) },
      marcasObjetivo,
      { siempreConfirmar: true }
    );
    if (ok) {
      setSeleccion(new Set());
      // Los estados cambiaron: se recalculan con los mismos parámetros para no mostrar "Nueva" lo que ya es relevante.
      await calcular();
    }
  }

  function descargar() {
    descargarCsv(
      ["MARCA", "GENERO", "MUNDO", "LINEA", "NOTA", "AGRUPACION", "RANGO", "VENTA", "PARTICIPACION", "ESTADO"],
      filtradas.map((s) => [
        s.marca,
        s.genero,
        s.mundo,
        s.linea,
        "",
        s.agrupacion,
        s.rango,
        s.venta_soles,
        Number(s.participacion.toFixed(4)),
        ETIQUETA_ESTADO_SUGERENCIA[s.estado],
      ]),
      "sugerencias-marcas-relevantes.csv"
    );
  }

  function ordenar(clave: string) {
    setOrden((o) => (o.clave === clave ? { clave: o.clave, dir: o.dir === "asc" ? "desc" : "asc" } : { clave: clave as ClaveOrden, dir: "asc" }));
  }

  const columnas: Columna<SugerenciaGml>[] = [
    {
      clave: "sel",
      titulo: "",
      render: (s) => (
        <Checkbox
          checked={seleccion.has(clavePar(s))}
          disabled={!SELECCIONABLES.has(s.estado)}
          onChange={(v) => {
            const x = new Set(seleccion);
            if (v) x.add(clavePar(s));
            else x.delete(clavePar(s));
            setSeleccion(x);
          }}
          label={`Elegir ${s.marca} en ${rutaDe(s)}`}
        />
      ),
    },
    {
      clave: "gml",
      titulo: "GML",
      ordenable: true,
      render: (s) => (
        <span>
          {rutaDe(s)} {s.nivel_planificacion === "GMLE" && <Badge tono="marca">GMLE</Badge>}
        </span>
      ),
    },
    { clave: "agrupacion", titulo: "Agrupación", ordenable: true, render: (s) => s.agrupacion },
    {
      clave: "marca",
      titulo: "Marca",
      ordenable: true,
      render: (s) => (
        <span className="font-medium">
          {s.marca}
          {s.miembros !== undefined && s.miembros > 0 && <span className="ml-1 text-xs font-normal text-tinta-suave">({s.miembros + 1} marcas)</span>}
        </span>
      ),
    },
    { clave: "rango", titulo: "Rango", ordenable: true, className: "text-right", render: (s) => <span className="font-mono">{s.rango}</span> },
    {
      clave: "venta",
      titulo: medida === "unidades" ? "Unidades" : "Venta (S/)",
      ordenable: true,
      className: "text-right",
      render: (s) => <span className="font-mono">{formatearNumero(Math.round(medida === "unidades" ? s.unidades : s.venta_soles))}</span>,
    },
    { clave: "participacion", titulo: "Participación", ordenable: true, className: "text-right", render: (s) => <span className="font-mono">{pct(s.participacion)}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      ordenable: true,
      render: (s) => (
        <span title={s.estado === "marca_al_barrer" ? "Asignarla la pasa de Al barrer a Por GML (con confirmación)." : undefined}>
          <Badge tono={TONO_ESTADO[s.estado]}>{ETIQUETA_ESTADO_SUGERENCIA[s.estado]}</Badge>
        </span>
      ),
    },
  ];

  const chipsSoloNuevas: ChipItem<"todas" | "nuevas">[] = [
    { id: "todas", label: "Todas", conteo: sugerencias.length },
    { id: "nuevas", label: "Solo nuevas", conteo: sugerencias.filter((s) => s.estado === "nueva").length },
  ];

  return (
    <div className="space-y-4">
      <Card
        titulo="Parámetros"
        descripcion="Por defecto: los últimos doce meses publicados, las 4 primeras marcas por GML y agrupación, con al menos 5 % de participación. Excluye VARIOS, OTROS y SIN MARCA."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Desde (mes)" hint="Vacío: once meses antes de «hasta».">
            <Input type="month" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta (mes)" hint="Vacío: el último mes publicado.">
            <Input type="month" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="Primeras por GML y agrupación" hint="De 1 a 10.">
            <Input type="number" min={1} max={10} step={1} value={top} onChange={(e) => setTop(e.target.value)} />
          </Field>
          <Field label="Participación mínima (%)" hint="De 0 a 50.">
            <Input type="number" min={0} max={50} step={1} value={minPct} onChange={(e) => setMinPct(e.target.value)} />
          </Field>
          <Field label="Medida">
            <Select value={medida} onChange={(e) => setMedida(e.target.value as "venta_soles" | "unidades")}>
              <option value="venta_soles">Venta en soles</option>
              <option value="unidades">Unidades</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void calcular()} disabled={calculando || ops.ocupado || !parametrosValidos}>
            {calculando ? "Calculando… (puede tardar unos segundos)" : "Calcular sugerencias"}
          </Button>
          {!parametrosValidos && <span className="text-xs text-alerta">Revisa los parámetros: primeras entre 1 y 10, participación entre 0 y 50.</span>}
        </div>
      </Card>

      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}

      {datos && (
        <Card
          titulo={`Sugerencias (${formatearNumero(filtradas.length)} de ${formatearNumero(sugerencias.length)})`}
          descripcion={`Rango ${datos.rango.desde} a ${datos.rango.hasta} · ${plural(datos.rango.meses_publicados, "mes publicado", "meses publicados")} · ${formatearNumero(datos.resumen.nodos)} GML · ${formatearNumero(datos.resumen.nuevas)} nuevas · ${formatearNumero(datos.resumen.ya_relevantes)} ya relevantes · ${formatearNumero(datos.resumen.al_barrer)} de marcas al barrer`}
          acciones={
            <Button variante="secundario" tamano="sm" onClick={descargar} disabled={filtradas.length === 0}>
              Descargar sugerencias (CSV)
            </Button>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-tinta">Género</span>
                <Select value={generoId} onChange={(e) => setGeneroId(e.target.value)} className="h-8 w-40">
                  <option value={TODOS}>Todos</option>
                  {generos.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-tinta">Mundo</span>
                <Select value={mundoVigente} onChange={(e) => setMundo(e.target.value)} className="h-8 w-40">
                  <option value={TODOS}>Todos</option>
                  {mundos.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-tinta">Línea</span>
                <Input type="search" value={linea} onChange={(e) => setLinea(e.target.value)} placeholder="Buscar línea…" className="h-8 w-40" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-tinta">Agrupación</span>
                <Select value={agrupacion} onChange={(e) => setAgrupacion(e.target.value)} className="h-8 w-40">
                  <option value={TODOS}>Todas</option>
                  {agrupacionesPresentes.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </label>
              <Chips items={chipsSoloNuevas} activo={soloNuevas ? "nuevas" : "todas"} onCambiar={(id) => setSoloNuevas(id === "nuevas")} etiqueta="Filtrar por estado" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variante="fantasma"
                tamano="sm"
                disabled={nuevasFiltradas.length === 0}
                onClick={() => setSeleccion(new Set([...seleccion, ...nuevasFiltradas.map(clavePar)]))}
              >
                Elegir las {formatearNumero(nuevasFiltradas.length)} nuevas filtradas
              </Button>
              <Button variante="fantasma" tamano="sm" disabled={seleccion.size === 0} onClick={() => setSeleccion(new Set())}>
                Limpiar ({seleccion.size})
              </Button>
              <Button disabled={ops.ocupado || calculando || elegidas.length === 0} onClick={() => void aplicar()}>
                Hacer relevantes {elegidas.length} seleccionada{elegidas.length === 1 ? "" : "s"}
              </Button>
            </div>

            <DataTable
              columnas={columnas}
              filas={visibles}
              claveFila={clavePar}
              vacio={sugerencias.length === 0 ? "Sin sugerencias con estos parámetros: baja la participación mínima o amplía el rango." : "Ninguna sugerencia coincide con el filtro."}
              ordenActual={orden}
              onOrdenar={ordenar}
              claseFila={(s) => (SELECCIONABLES.has(s.estado) ? undefined : "opacity-60")}
            />
            {filtradas.length > visibles.length && (
              <p className="text-xs text-tinta-suave">
                Mostrando {visibles.length} de {formatearNumero(filtradas.length)}: afina los filtros (el CSV lleva todas las filtradas).
              </p>
            )}
          </div>
        </Card>
      )}

      <p className="text-xs text-tinta-suave">Las sugerencias salen de la venta de M5 y nunca se aplican solas: tú decides cuáles son relevantes.</p>
    </div>
  );
}
