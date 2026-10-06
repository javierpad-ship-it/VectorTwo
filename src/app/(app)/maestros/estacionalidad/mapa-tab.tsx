"use client";

import { useMemo, useState } from "react";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { AgrupacionEstacionalidadFila, EquivalenciasEstacionalidadRespuesta } from "@/lib/estacionalidad/tipos-api";
import { resumirMapa, type CoberturaGenero, type LineaMapa, type ResumenMapa } from "@/lib/estacionalidad/mapa";
import type { ColorAgrupacion, MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero, plural } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { Punto } from "@/components/ui/punto";
import { useMapaColores } from "@/components/estacionalidad/badge-agrupacion";
import { LeyendaAgrupaciones } from "@/components/estacionalidad/leyenda-agrupaciones";

/** A partir de cuántas equivalencias la tarjeta ofrece un buscador en su lista. */
const UMBRAL_BUSCADOR = 30;

const EMPTY_RESUMEN: ResumenMapa = { total: 0, sinAgrupacion: { total: 0, porGenero: [], lineas: [] }, tarjetas: [], cobertura: [] };

/**
 * Pestaña Mapa: la vista de un vistazo. Cobertura por género (barra apilada
 * con un segmento por agrupación y el tramo de faltantes al final) y una
 * tarjeta por agrupación con su conteo, su barra, su desglose por género y
 * sus equivalencias agrupadas por línea. Solo lectura: "Asignar" salta a la
 * pestaña Asignación (o a Faltantes desde la tarjeta "Sin agrupación").
 */
export function MapaTab({
  lista,
  cargando,
  agrupaciones,
  onAsignar,
  onIrAFaltantes,
}: {
  lista: EquivalenciasEstacionalidadRespuesta | null;
  cargando: boolean;
  agrupaciones: AgrupacionEstacionalidadFila[];
  onAsignar: (agrupacionId: string) => void;
  onIrAFaltantes: () => void;
}) {
  const colores = useMapaColores(agrupaciones);
  const resumen = useMemo(
    () => (lista ? resumirMapa(lista.equivalencias, agrupaciones, lista.generos, lista.lineas) : EMPTY_RESUMEN),
    [lista, agrupaciones]
  );

  if (!lista) {
    return <EmptyState titulo={cargando ? "Cargando el mapa…" : "No hay datos que mostrar."} />;
  }

  const itemsLeyenda = resumen.tarjetas.map((t) => ({ id: t.agrupacion.id, nombre: t.agrupacion.nombre, conteo: t.total, activo: t.agrupacion.activo }));

  return (
    <div className="space-y-6">
      <Card titulo="Cobertura por género" descripcion="Cada barra reparte las equivalencias activas del género entre sus agrupaciones; el tramo rayado es lo que falta asignar.">
        {resumen.cobertura.length === 0 ? (
          <EmptyState titulo="No hay equivalencias activas en el árbol." />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {resumen.cobertura.map((g) => (
                <BarraGenero key={g.id} genero={g} colores={colores} />
              ))}
            </div>
            <LeyendaAgrupaciones items={itemsLeyenda} colores={colores} sinAgrupacion={resumen.sinAgrupacion.total} className="border-t border-borde pt-3" />
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <Tarjeta
          titulo="Sin agrupación"
          tono={resumen.sinAgrupacion.total === 0 ? "exito" : "alerta"}
          descripcion={
            resumen.sinAgrupacion.total === 0
              ? "Toda equivalencia tiene agrupación. Listo para M6."
              : "Equivalencias activas sin agrupación o con una agrupación inactiva: no se pueden proyectar."
          }
          total={resumen.sinAgrupacion.total}
          totalGlobal={resumen.total}
          porGenero={resumen.sinAgrupacion.porGenero}
          lineas={resumen.sinAgrupacion.lineas}
          accion={resumen.sinAgrupacion.total > 0 ? { texto: "Ir a Faltantes", onClick: onIrAFaltantes } : undefined}
        />
        {resumen.tarjetas.map((t) => (
          <Tarjeta
            key={t.agrupacion.id}
            titulo={t.agrupacion.nombre}
            codigo={t.agrupacion.codigo}
            descripcion={t.agrupacion.descripcion ?? undefined}
            inactiva={!t.agrupacion.activo}
            tono={colores.get(t.agrupacion.id) ?? "alerta"}
            total={t.total}
            totalGlobal={resumen.total}
            porGenero={t.porGenero}
            lineas={t.lineas}
            accion={{ texto: "Asignar", onClick: () => onAsignar(t.agrupacion.id) }}
          />
        ))}
      </div>

      {resumen.tarjetas.length === 0 && (
        <EmptyState titulo="Todavía no hay agrupaciones" detalle="Créalas en la pestaña Agrupaciones o súbelas con un archivo en Importar; aquí verás una tarjeta por cada una." />
      )}
    </div>
  );
}

// ─── Cobertura por género ───

const TRAMA_FALTANTES = "repeating-linear-gradient(135deg, var(--alerta-suave) 0 6px, color-mix(in srgb, var(--alerta) 35%, var(--alerta-suave)) 6px 8px)";

function BarraGenero({ genero, colores }: { genero: CoberturaGenero; colores: MapaColores }) {
  const asignadas = genero.total - genero.faltantes;
  const pct = genero.total > 0 ? Math.round((asignadas / genero.total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 truncate font-medium text-tinta sm:w-32" title={genero.nombre}>
        {genero.nombre}
      </span>
      <div
        className="flex h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-neutro-suave"
        role="img"
        aria-label={`${genero.nombre}: ${formatearNumero(asignadas)} de ${formatearNumero(genero.total)} equivalencias con agrupación`}
      >
        {genero.segmentos.map((s) => (
          <span
            key={s.agrupacionId}
            className="h-full border-r border-superficie/70 last:border-r-0"
            style={{ width: `${(s.conteo / genero.total) * 100}%`, backgroundColor: colores.get(s.agrupacionId)?.pleno }}
            title={`${s.nombre} · ${plural(s.conteo, "equivalencia", "equivalencias")}`}
          />
        ))}
        {genero.faltantes > 0 && (
          <span
            className="h-full"
            style={{ width: `${(genero.faltantes / genero.total) * 100}%`, backgroundImage: TRAMA_FALTANTES }}
            title={`Sin agrupación · ${plural(genero.faltantes, "equivalencia", "equivalencias")}`}
          />
        )}
      </div>
      <span className="w-28 shrink-0 text-right font-mono text-xs text-tinta-suave" title="Con agrupación / total del género">
        {formatearNumero(asignadas)} / {formatearNumero(genero.total)} <span className={genero.faltantes === 0 ? "text-exito" : ""}>({pct} %)</span>
      </span>
    </div>
  );
}

// ─── Tarjeta por agrupación ───

type TonoTarjeta = ColorAgrupacion | "alerta" | "exito";

function estilosDe(tono: TonoTarjeta): { franja: string; numero: string; barra: string; chip?: { fondo: string; texto: string } } {
  if (tono === "alerta") return { franja: "var(--alerta)", numero: "text-alerta", barra: "var(--alerta)" };
  if (tono === "exito") return { franja: "var(--exito)", numero: "text-exito", barra: "var(--exito)" };
  return { franja: tono.pleno, numero: "text-tinta", barra: tono.pleno, chip: { fondo: tono.suave, texto: tono.texto } };
}

function Tarjeta({
  titulo,
  codigo,
  descripcion,
  inactiva = false,
  tono,
  total,
  totalGlobal,
  porGenero,
  lineas,
  accion,
}: {
  titulo: string;
  codigo?: string;
  descripcion?: string;
  inactiva?: boolean;
  tono: TonoTarjeta;
  total: number;
  totalGlobal: number;
  porGenero: { id: string; nombre: string; conteo: number }[];
  lineas: LineaMapa[];
  accion?: { texto: string; onClick: () => void };
}) {
  const [abierta, setAbierta] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // Líneas desplegadas a mano. Con una búsqueda activa se despliegan solas las que coinciden.
  const [lineasAbiertas, setLineasAbiertas] = useState<ReadonlySet<string>>(new Set());
  const estilos = estilosDe(tono);
  const buscando = normalizarNombre(busqueda) !== "";
  const alternarLinea = (id: string) =>
    setLineasAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });
  const pct = totalGlobal > 0 ? (total / totalGlobal) * 100 : 0;
  const conBuscador = total > UMBRAL_BUSCADOR;
  const esSinAgrupacion = tono === "alerta" || tono === "exito";

  const lineasVisibles = useMemo(() => {
    const consulta = normalizarNombre(busqueda);
    if (!abierta || consulta === "") return lineas;
    return lineas
      .map((l) => ({
        ...l,
        equivalencias: l.nombre.includes(consulta)
          ? l.equivalencias
          : l.equivalencias.filter((e) => e.nombre.includes(consulta) || e.codigo.includes(consulta) || e.rutaCorta.includes(consulta)),
      }))
      .filter((l) => l.equivalencias.length > 0)
      .map((l) => ({ ...l, conteo: l.equivalencias.length }));
  }, [lineas, busqueda, abierta]);

  return (
    <section
      className={`flex flex-col rounded-xl border bg-superficie shadow-sm ${inactiva ? "opacity-75" : ""} ${
        tono === "alerta" ? "border-alerta/40 bg-alerta-suave/30" : tono === "exito" ? "border-exito/40 bg-exito-suave/40" : "border-borde"
      }`}
      style={{ borderLeft: `6px solid ${estilos.franja}` }}
      aria-label={titulo}
    >
      <div className="flex flex-1 flex-col gap-3 px-4 py-4">
        <header className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {!esSinAgrupacion && <Punto color={inactiva ? null : estilos.franja} className="h-2.5 w-2.5" />}
            <h3 className={`truncate text-base font-semibold ${esSinAgrupacion ? estilos.numero : "text-tinta"}`} title={titulo}>
              {titulo}
            </h3>
            {inactiva && <Badge tono="alerta">Inactiva</Badge>}
          </div>
          {codigo && <code className="font-mono text-xs text-tinta-suave">{codigo}</code>}
          {descripcion && <p className="mt-1 text-xs text-tinta-suave">{descripcion}</p>}
        </header>

        <div>
          <p className="flex items-baseline gap-2">
            <span className={`text-3xl font-semibold tabular-nums ${estilos.numero}`}>{formatearNumero(total)}</span>
            <span className="text-xs text-tinta-suave">
              {total === 1 ? "equivalencia" : "equivalencias"}
              {totalGlobal > 0 && ` · ${pct < 1 && pct > 0 ? "<1" : Math.round(pct)} % del total`}
            </span>
          </p>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutro-suave" role="img" aria-label={`${Math.round(pct)} % de las equivalencias`}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(pct, total > 0 ? 1.5 : 0)}%`, backgroundColor: estilos.barra }} />
          </div>
          {inactiva && total > 0 && <p className="mt-1 text-xs text-alerta">Sus equivalencias cuentan como faltantes mientras esté inactiva.</p>}
        </div>

        {porGenero.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Por género">
            {porGenero.map((g) => (
              <li
                key={g.id}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${estilos.chip ? "" : esSinAgrupacion && tono === "alerta" ? "bg-alerta-suave text-alerta" : "bg-neutro-suave text-tinta-suave"}`}
                style={estilos.chip ? { backgroundColor: estilos.chip.fondo, color: estilos.chip.texto } : undefined}
              >
                {g.nombre} <span className="font-mono">{formatearNumero(g.conteo)}</span>
              </li>
            ))}
          </ul>
        )}

        {total > 0 && (
          <div className="space-y-2">
            <Button variante="fantasma" tamano="sm" className="-ml-3" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
              {abierta ? "Ocultar" : `Ver equivalencias (${formatearNumero(total)})`}
            </Button>
            {abierta && (
              <div className="space-y-2">
                {conBuscador && (
                  <Input
                    type="search"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar línea, equivalencia o ruta…"
                    className="h-8"
                    aria-label={`Buscar en ${titulo}`}
                  />
                )}
                {lineasVisibles.length === 0 ? (
                  <p className="text-xs text-tinta-suave">Ninguna equivalencia coincide.</p>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-tinta-suave">
                      <span>{formatearNumero(lineasVisibles.length)} {lineasVisibles.length === 1 ? "línea" : "líneas"}</span>
                      {!buscando && (
                        <button
                          type="button"
                          className="font-medium text-marca-oscura hover:underline"
                          onClick={() =>
                            setLineasAbiertas(lineasAbiertas.size === lineasVisibles.length ? new Set() : new Set(lineasVisibles.map((l) => l.id)))
                          }
                        >
                          {lineasAbiertas.size === lineasVisibles.length ? "Cerrar todas" : "Abrir todas"}
                        </button>
                      )}
                    </div>
                    <ul className="max-h-80 divide-y divide-borde overflow-y-auto rounded-lg border border-borde bg-fondo text-xs">
                      {lineasVisibles.map((l) => {
                        const desplegada = buscando || lineasAbiertas.has(l.id);
                        return (
                          <li key={l.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-medium text-tinta hover:bg-neutro-suave"
                              aria-expanded={desplegada}
                              onClick={() => alternarLinea(l.id)}
                              disabled={buscando}
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span aria-hidden className={`inline-block text-tinta-suave transition-transform ${desplegada ? "rotate-90" : ""}`}>
                                  ▸
                                </span>
                                <span className="truncate">{l.nombre}</span>
                              </span>
                              <span className="font-mono text-tinta-suave">{formatearNumero(l.conteo)}</span>
                            </button>
                            {desplegada && (
                              <ul className="space-y-1 border-t border-borde bg-superficie px-2 py-1.5 pl-6">
                                {l.equivalencias.map((e) => (
                                  <li key={e.id} className="flex items-baseline justify-between gap-2">
                                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                                      <span className="text-tinta">{e.nombre}</span>
                                      {e.es_generica && <Badge tono="marca">Genérica</Badge>}
                                      {e.motivo_faltante === "agrupacion_inactiva" && <span className="text-alerta">· agrupación inactiva</span>}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-tinta-suave/80">{e.rutaCorta}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {accion && (
        <footer className="border-t border-borde px-4 py-2">
          <Button variante="secundario" tamano="sm" onClick={accion.onClick}>
            {accion.texto}
          </Button>
        </footer>
      )}
    </section>
  );
}
