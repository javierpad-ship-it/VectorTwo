"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipFiltro } from "@/components/ui/chip-filtro";
import { Chips } from "@/components/ui/chips";
import { ChipsMultiples, type ChipMultipleItem } from "@/components/ui/chips-multiples";
import { Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { BLOQUES_TABLERO, MAX_AGRUPACIONES, MAX_GENEROS, MAX_TIENDAS, TEMPORADAS_TABLERO, type Bloque, type OpcionesTableroApi, type TableroApi, type TemporadaTablero } from "@/lib/direccion/tipos-api";
import { admiteLinea, AYUDA_MARCA, cuentaFiltros, ETIQUETA_BLOQUE, ETIQUETA_TEMPORADA, gruposDeTiendas, type FiltrosVista } from "./vista-tablero";

function Grupo({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-medium text-tinta">{titulo}</p>
      {children}
      {ayuda && <p className="mt-1 text-xs text-tinta-suave">{ayuda}</p>}
    </div>
  );
}

/** Los chips de una lista con tope: al llegar al máximo, los que faltan por marcar se deshabilitan y dicen por qué. */
function conTope(items: ChipMultipleItem[], marcados: readonly string[], max: number, que: string): ChipMultipleItem[] {
  if (marcados.length < max) return items;
  return items.map((i) => (marcados.includes(i.id) ? i : { ...i, disabled: true, title: `Se pueden elegir hasta ${max} ${que} a la vez.` }));
}

type PropsControles = {
  filtros: FiltrosVista;
  opciones: OpcionesTableroApi;
  /** El tablero cargado (para agrupar las tiendas por su situación y rotular con los años de la proyección). */
  tablero: Pick<TableroApi, "proyeccion" | "datos"> | null;
  onCambiar: (cambio: Partial<FiltrosVista>) => void;
};

/**
 * Los controles de filtro del tablero (ficha 14, §4.7): géneros (varios, con el atajo «Resto»), mundo y línea (línea solo con un género y un mundo,
 * como la Matriz de M7), temporada, agrupación de marca (primer nivel), marca (unidades de marca agrupadas por su agrupación, con búsqueda; una a la
 * vez), tiendas (agrupadas por su situación en el año siguiente) y bloque. Los mismos controles van en la barra y en el modal del móvil.
 */
export function ControlesFiltros({ filtros, opciones, tablero, onCambiar }: PropsControles) {
  const [buscaMarca, setBuscaMarca] = useState("");
  const proyeccion = tablero?.proyeccion ?? null;
  const delResto = useMemo(() => opciones.generos.filter((g) => g.es_resto), [opciones.generos]);
  const idsResto = useMemo(() => new Set(delResto.map((g) => g.id)), [delResto]);

  const generosMarcados = filtros.resto ? [...filtros.generos.filter((g) => !idsResto.has(g)), ...idsResto] : filtros.generos;
  const itemsGeneros = conTope(
    opciones.generos.map((g) => ({ id: g.id, label: g.nombre, disabled: filtros.resto && g.es_resto, title: filtros.resto && g.es_resto ? "Incluido en «Resto»" : undefined })),
    filtros.generos,
    MAX_GENEROS,
    "géneros"
  );

  const lineaPosible = admiteLinea(filtros);
  const lineas = lineaPosible ? opciones.lineas.filter((l) => l.genero_id === filtros.generos[0] && l.mundo_id === filtros.mundo) : [];

  const temporadas = opciones.temporadas.length > 0 ? opciones.temporadas : TEMPORADAS_TABLERO.map((id) => ({ id, nombre: ETIQUETA_TEMPORADA[id] }));

  const texto = buscaMarca.trim().toLowerCase();
  const gruposMarca = opciones.agrupaciones_marca
    .filter((a) => filtros.am.length === 0 || filtros.am.includes(a.id))
    .map((a) => ({ agrupacion: a, unidades: opciones.unidades_marca.filter((u) => u.agrupacion_marca_id === a.id && (texto === "" || u.nombre.toLowerCase().includes(texto) || u.id === filtros.marca)) }))
    .filter((g) => g.unidades.length > 0);

  const gruposTiendas = gruposDeTiendas(opciones.tiendas, tablero?.datos.tiendas ?? null, proyeccion);
  const etiquetasBloque = ETIQUETA_BLOQUE(proyeccion?.anio_siguiente ?? null);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Grupo titulo="Géneros">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipsMultiples
            etiqueta="Géneros"
            items={itemsGeneros}
            valor={generosMarcados}
            onCambiar={(ids) => onCambiar({ generos: filtros.resto ? ids.filter((id) => !idsResto.has(id)) : ids })}
          />
          {delResto.length > 0 && (
            <span title={`Marca de una vez los géneros del Resto: ${delResto.map((g) => g.nombre).join(", ")}`}>
              <ChipFiltro activo={filtros.resto} onCambiar={(v) => onCambiar({ resto: v })} grande={false}>
                Resto
              </ChipFiltro>
            </span>
          )}
        </div>
      </Grupo>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-tinta">Mundo</span>
          <Select value={filtros.mundo ?? ""} onChange={(e) => onCambiar({ mundo: e.target.value || null })}>
            <option value="">Todos</option>
            {opciones.mundos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-tinta">Línea</span>
          <Select value={filtros.linea ?? ""} disabled={!lineaPosible} onChange={(e) => onCambiar({ linea: e.target.value || null })}>
            <option value="">{lineaPosible ? "Todas" : "Elige un solo género y un mundo"}</option>
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <Grupo titulo="Temporada">
        <ChipsMultiples etiqueta="Temporada" items={temporadas.map((t) => ({ id: t.id, label: t.nombre }))} valor={filtros.temporadas} onCambiar={(ids) => onCambiar({ temporadas: ids as TemporadaTablero[] })} />
      </Grupo>

      <Grupo titulo="Bloque de tiendas">
        <Chips<Bloque> etiqueta="Bloque de tiendas" items={BLOQUES_TABLERO.map((b) => ({ id: b, label: etiquetasBloque[b] }))} activo={filtros.bloque} onCambiar={(b) => onCambiar({ bloque: b })} />
      </Grupo>

      <Grupo titulo="Agrupación de marca">
        <ChipsMultiples
          etiqueta="Agrupación de marca"
          items={conTope(
            opciones.agrupaciones_marca.map((a) => ({ id: a.id, label: a.nombre })),
            filtros.am,
            MAX_AGRUPACIONES,
            "agrupaciones de marca"
          )}
          valor={filtros.am}
          onCambiar={(ids) => onCambiar({ am: ids })}
        />
      </Grupo>

      <Grupo titulo="Marca" ayuda={AYUDA_MARCA}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input type="search" value={buscaMarca} onChange={(e) => setBuscaMarca(e.target.value)} placeholder="Buscar marca" aria-label="Buscar marca" />
          <Select value={filtros.marca ?? ""} onChange={(e) => onCambiar({ marca: e.target.value || null })} aria-label="Marca (unidad de marca)">
            <option value="">Todas</option>
            {gruposMarca.map((g) => (
              <optgroup key={g.agrupacion.id} label={g.agrupacion.nombre}>
                {g.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </Grupo>

      <div className="md:col-span-2">
        <Grupo titulo={`Tiendas${filtros.tiendas.length > 0 ? ` (${filtros.tiendas.length})` : ""}`} ayuda="Con tiendas elegidas, lo proyectado de las mismas tiendas es estimado (se atribuye) y se rotula así, con la participación usada.">
          <div className="space-y-2">
            {gruposTiendas.map((g) => {
              const ids = new Set(g.items.map((i) => i.id));
              return (
                <div key={g.clave}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-tinta-suave">{g.titulo}</p>
                  <ChipsMultiples
                    etiqueta={g.titulo}
                    items={conTope(g.items, filtros.tiendas, MAX_TIENDAS, "tiendas")}
                    valor={filtros.tiendas.filter((id) => ids.has(id))}
                    onCambiar={(elegidas) => onCambiar({ tiendas: [...filtros.tiendas.filter((id) => !ids.has(id)), ...elegidas] })}
                  />
                </div>
              );
            })}
            {gruposTiendas.length === 0 && <p className="text-sm text-tinta-suave">Sin tiendas.</p>}
          </div>
        </Grupo>
      </div>
    </div>
  );
}

/**
 * Barra de filtros de «Explorar». En pantallas anchas, los controles a la vista; en el móvil, un botón «Filtros (3)» que los abre en un modal. Todos
 * los filtros viven en la URL de la página. «Limpiar filtros» quita el recorte y conserva la proyección, la comparada y el desglose.
 */
export function FiltrosTablero({ filtros, opciones, tablero, onCambiar, onLimpiar }: Omit<PropsControles, "opciones"> & { opciones: OpcionesTableroApi | null; onLimpiar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const n = cuentaFiltros(filtros);
  const limpiar = n > 0 && (
    <Button variante="fantasma" className="h-11! md:h-8!" onClick={onLimpiar}>
      Limpiar filtros
    </Button>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variante="secundario" className="h-11! px-5!" onClick={() => setAbierto(true)} disabled={opciones === null}>
          Filtros{n > 0 ? ` (${n})` : ""}
        </Button>
        {limpiar}
      </div>
      <div className="hidden md:block">
        <Card titulo={`Filtros${n > 0 ? ` (${n})` : ""}`} descripcion="Recortan «Explorar»: tarjetas, gráfico, tablas, desglose, decisiones, apoyo y filas mayores. Lo de «Para decidir» no cambia." acciones={limpiar || undefined}>
          {opciones ? <ControlesFiltros filtros={filtros} opciones={opciones} tablero={tablero} onCambiar={onCambiar} /> : <p className="text-sm text-tinta-suave">Cargando los filtros…</p>}
        </Card>
      </div>
      {abierto && opciones && (
        <Modal
          titulo={`Filtros${n > 0 ? ` (${n})` : ""}`}
          descripcion="Recortan «Explorar»; lo de «Para decidir» no cambia."
          ancho="max-w-3xl"
          onCerrar={() => setAbierto(false)}
          pie={
            <>
              {n > 0 && (
                <Button variante="secundario" className="h-11! px-5!" onClick={onLimpiar}>
                  Limpiar filtros
                </Button>
              )}
              <Button className="h-11! px-5!" onClick={() => setAbierto(false)}>
                Ver el tablero
              </Button>
            </>
          }
        >
          <ControlesFiltros filtros={filtros} opciones={opciones} tablero={tablero} onCambiar={onCambiar} />
        </Modal>
      )}
    </div>
  );
}
