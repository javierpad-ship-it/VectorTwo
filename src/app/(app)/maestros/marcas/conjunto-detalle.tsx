"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero, plural } from "@/lib/formato";
import type { EditarMarcaCuerpoM2b, MarcaConGml, MiembrosCuerpo, MiembrosRespuesta, ModalidadEfectiva } from "@/components/marcas/tipos-m2b";
import { ETIQUETA_AVISO_CONJUNTO, ETIQUETA_MOTIVO_RECHAZO_CONJUNTO } from "@/components/marcas/tipos-m2b";
import type { ConjuntoFila } from "@/components/marcas/tipos-m2b";
import { cuerpoModalidad, esMarcaGenerica, ETIQUETA_MODALIDAD, MODALIDADES_ELEGIBLES, sinModalidadGuardada, textoConfirmarModalidad } from "@/components/marcas/comunes-m2b";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { MAX_NOTA } from "./editar-marca-dialogo";

export type ConjuntoVista = ConjuntoFila & {
  /** Cabeza sin miembros todavía: no aparece en `GET /api/marcas/conjuntos` y se arma desde la lista de marcas. */
  sintetico?: boolean;
};

const MAX_FILAS_CANDIDATAS = 50;

/**
 * Detalle de un conjunto: cabecera (casilla, modalidad y nota de la cabeza),
 * tabla de miembros (quitar, alinear agrupación) y alta de miembros con
 * búsqueda y selección múltiple. Todo cambio pasa por `mutar`, que bloquea la
 * pantalla, recarga las colecciones y devuelve `true` si salió bien.
 */
export function ConjuntoDetalle({
  conjunto,
  marcas,
  ocupado,
  mutar,
  onResultado,
}: {
  conjunto: ConjuntoVista;
  marcas: MarcaConGml[];
  ocupado: boolean;
  mutar: (accion: () => Promise<unknown>) => Promise<boolean>;
  /** Mensaje de éxito (o aviso) tras una operación en bloque. */
  onResultado: (mensaje: string, tono?: "exito" | "info") => void;
}) {
  const { cabeza, miembros } = conjunto;
  const marcaCabeza = marcas.find((m) => m.id === cabeza.id) ?? null;
  const porId = new Map(marcas.map((m) => [m.id, m]));

  const [seleccionMiembros, setSeleccionMiembros] = useState<Set<string>>(() => new Set());
  const [busqueda, setBusqueda] = useState("");
  const [seleccionNuevas, setSeleccionNuevas] = useState<Set<string>>(() => new Set());
  const [nota, setNota] = useState<string | null>(null);

  // ─── Cabecera ───
  const notaActual = marcaCabeza?.nota_tratamiento ?? "";
  const notaEditada = nota ?? notaActual;

  function cambiarCasilla(v: boolean) {
    if (!marcaCabeza) return;
    if (!v) {
      const partes: string[] = [];
      if (marcaCabeza.nota_tratamiento) partes.push(`Se borrará la nota "${marcaCabeza.nota_tratamiento}".`);
      if (marcaCabeza.gml_asignados > 0) {
        partes.push(`Sus ${marcaCabeza.gml_asignados} GML relevantes se conservan, pero quedarán ignorados hasta que vuelvas a marcarla.`);
      }
      partes.push(`El conjunto entero dejará de tratarse aparte: ${cabeza.nombre} manda en el flujo.`);
      if (!confirm(`¿Quitar el tratamiento especial de ${cabeza.nombre}?\n${partes.join("\n")}`)) return;
    }
    void mutar(() => api.patch(`/api/marcas/${cabeza.id}`, { tratamiento_especial: v } satisfies EditarMarcaCuerpoM2b));
  }

  function cambiarModalidad(valor: string) {
    if (!marcaCabeza || !MODALIDADES_ELEGIBLES.includes(valor as ModalidadEfectiva)) return;
    const nueva = valor as ModalidadEfectiva;
    if (nueva === marcaCabeza.modalidad_efectiva && !sinModalidadGuardada(marcaCabeza)) return;
    const de: ModalidadEfectiva = marcaCabeza.modalidad_efectiva ?? "barrido";
    const cambian = de === "mixta" ? marcaCabeza.gml_vigentes : marcaCabeza.gml_asignados;
    if (!confirm(textoConfirmarModalidad({ nombre: cabeza.nombre, de, a: nueva, gml: cambian, tieneReparto: null }))) return;
    void mutar(() => api.patch(`/api/marcas/${cabeza.id}`, cuerpoModalidad(nueva)));
  }

  async function guardarNota() {
    const limpia = notaEditada.trim();
    const ok = await mutar(() => api.patch(`/api/marcas/${cabeza.id}`, { nota_tratamiento: limpia === "" ? null : limpia } satisfies EditarMarcaCuerpoM2b));
    if (ok) setNota(null);
  }

  function reactivarCabeza() {
    void mutar(() => api.patch(`/api/marcas/${cabeza.id}`, { activo: true } satisfies EditarMarcaCuerpoM2b));
  }

  // ─── Miembros ───
  const idsMiembros = new Set(miembros.map((m) => m.id));
  const seleccionados = miembros.filter((m) => seleccionMiembros.has(m.id));
  const todosSel = miembros.length > 0 && seleccionados.length === miembros.length;
  const agrupacionDeMiembro = (id: string) => porId.get(id)?.agrupacion_marca_id;
  const desalineados = miembros.filter((m) => {
    const propia = agrupacionDeMiembro(m.id);
    return propia !== undefined && propia !== cabeza.agrupacion_marca.id;
  });

  async function quitar(ids: string[], texto: string) {
    if (ids.length === 0) return;
    if (!confirm(texto)) return;
    const cuerpo: MiembrosCuerpo = { cabeza_marca_id: cabeza.id, accion: "quitar", marca_ids: ids };
    let respuesta: MiembrosRespuesta | null = null;
    const ok = await mutar(async () => {
      respuesta = await api.post<MiembrosRespuesta>("/api/marcas/conjuntos/miembros", cuerpo);
    });
    if (ok) {
      setSeleccionMiembros(new Set());
      const r = respuesta as MiembrosRespuesta | null;
      if (r) onResultado(`${plural(r.quitadas, "marca salió", "marcas salieron")} de ${cabeza.nombre}. Vuelven a contar como ellas mismas.`);
    }
  }

  async function alinear() {
    if (desalineados.length === 0) return;
    const texto =
      `¿Pasar ${plural(desalineados.length, "marca", "marcas")} a la agrupación ${cabeza.agrupacion_marca.nombre}?\n` +
      `Cambia el maestro de marcas (cada marca queda en la agrupación de ${cabeza.nombre}); no toca la venta cargada.`;
    if (!confirm(texto)) return;
    const fallos: string[] = [];
    const ok = await mutar(async () => {
      for (const m of desalineados) {
        try {
          await api.patch(`/api/marcas/${m.id}`, { agrupacion_marca_id: cabeza.agrupacion_marca.id } satisfies EditarMarcaCuerpoM2b);
        } catch (e) {
          fallos.push(`${m.nombre}: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      if (fallos.length > 0) throw new Error(`No se pudieron alinear ${fallos.length} de ${desalineados.length}. ${fallos.join(" · ")}`);
    });
    if (ok) onResultado(`${plural(desalineados.length, "marca alineada", "marcas alineadas")} con ${cabeza.agrupacion_marca.nombre}.`);
  }

  const columnasMiembros: Columna<ConjuntoFila["miembros"][number]>[] = [
    {
      clave: "sel",
      titulo: "",
      render: (m) => (
        <Checkbox
          checked={seleccionMiembros.has(m.id)}
          onChange={(v) => {
            const s = new Set(seleccionMiembros);
            if (v) s.add(m.id);
            else s.delete(m.id);
            setSeleccionMiembros(s);
          }}
          label={`Seleccionar ${m.nombre}`}
        />
      ),
    },
    { clave: "nombre", titulo: "Marca", render: (m) => <span className="font-medium">{m.nombre}</span> },
    {
      clave: "agrupacion",
      titulo: "Agrupación propia",
      render: (m) => {
        const distinta = m.avisos.includes("agrupacion_distinta") || (agrupacionDeMiembro(m.id) !== undefined && agrupacionDeMiembro(m.id) !== cabeza.agrupacion_marca.id);
        return (
          <span className="flex flex-wrap items-center gap-1">
            {m.agrupacion_marca.nombre}
            {distinta && (
              <span title={`En el flujo cuenta como ${cabeza.agrupacion_marca.nombre}, la agrupación de ${cabeza.nombre}.`}>
                <Badge tono="alerta">Distinta de la cabeza</Badge>
              </span>
            )}
          </span>
        );
      },
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (m) => (
        <span title={m.activo ? undefined : "Desactivada: la membresía vale igual y su venta histórica sigue en el conjunto."}>
          <Badge tono={m.activo ? "exito" : "neutro"}>{m.activo ? "Activa" : "Desactivada"}</Badge>
        </span>
      ),
    },
    {
      clave: "avisos",
      titulo: "Avisos",
      render: (m) => {
        const otros = m.avisos.filter((a) => a !== "agrupacion_distinta");
        if (otros.length === 0) return <span className="text-tinta-suave">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {otros.map((a) => (
              <span key={a} title={a === "config_propia_ignorada" ? "Tenía tratamiento especial o GML relevantes propios: quedan ignorados mientras esté en el conjunto." : undefined}>
                <Badge tono="alerta">{a === "config_propia_ignorada" ? "Relevantes propios ignorados" : ETIQUETA_AVISO_CONJUNTO[a]}</Badge>
              </span>
            ))}
          </span>
        );
      },
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (m) => (
        <Button
          variante="fantasma"
          tamano="sm"
          disabled={ocupado}
          onClick={() =>
            void quitar([m.id], `¿Quitar ${m.nombre} de ${cabeza.nombre}? Vuelve a contar como ella misma y recupera su configuración propia si la tenía.`)
          }
        >
          Quitar
        </Button>
      ),
    },
  ];

  // ─── Agregar marcas ───
  const consulta = normalizarNombre(busqueda);
  const candidatas = marcas
    .filter(
      (m) =>
        m.activo &&
        m.id !== cabeza.id &&
        m.miembros === 0 &&
        !esMarcaGenerica(m.nombre) &&
        !idsMiembros.has(m.id) &&
        (consulta === "" || m.nombre.includes(consulta))
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const visibles = candidatas.slice(0, MAX_FILAS_CANDIDATAS);
  const elegidas = marcas.filter((m) => seleccionNuevas.has(m.id));
  const enOtro = elegidas.filter((m) => m.conjunto && m.conjunto.id !== cabeza.id);
  const puedeAgregar = cabeza.activo;

  async function agregar() {
    if (elegidas.length === 0) return;
    if (enOtro.length > 0) {
      const lista = enOtro.map((m) => `${m.nombre} (de ${m.conjunto?.nombre})`).join(", ");
      if (!confirm(`Estas marcas cambiarán de conjunto: ${lista}.\n¿Agregar ${plural(elegidas.length, "marca", "marcas")} a ${cabeza.nombre}?`)) return;
    }
    const propias = elegidas.filter((m) => m.tratamiento_especial || m.gml_asignados > 0);
    if (propias.length > 0 && enOtro.length === 0) {
      const lista = propias.map((m) => m.nombre).join(", ");
      if (!confirm(`${lista} tiene tratamiento especial o GML propios: quedarán ignorados mientras pertenezca${propias.length === 1 ? "" : "n"} a ${cabeza.nombre}.\n¿Continuar?`)) return;
    }
    const cuerpo: MiembrosCuerpo = { cabeza_marca_id: cabeza.id, accion: "asignar", marca_ids: elegidas.map((m) => m.id) };
    let respuesta: MiembrosRespuesta | null = null;
    const ok = await mutar(async () => {
      respuesta = await api.post<MiembrosRespuesta>("/api/marcas/conjuntos/miembros", cuerpo);
    });
    if (!ok) return;
    setSeleccionNuevas(new Set());
    const r = respuesta as MiembrosRespuesta | null;
    if (!r) return;
    const partes = [`${plural(r.asignadas, "marca agregada", "marcas agregadas")} a ${cabeza.nombre}`];
    if (r.sin_cambio > 0) partes.push(`${formatearNumero(r.sin_cambio)} ya estaban`);
    if (r.no_permitidas.length > 0) {
      partes.push(
        `no entraron ${r.no_permitidas.map((n) => `${n.marca} (${ETIQUETA_MOTIVO_RECHAZO_CONJUNTO[n.motivo] ?? n.motivo})`).join("; ")}`
      );
    }
    onResultado(`${partes.join(" · ")}.`, r.no_permitidas.length > 0 ? "info" : "exito");
  }

  return (
    <div className="space-y-4">
      <Card
        titulo={cabeza.nombre}
        descripcion={`Cabeza del conjunto · código ${cabeza.codigo}`}
        acciones={
          <span className="flex flex-wrap items-center justify-end gap-1">
            <Badge tono="neutro">{cabeza.agrupacion_marca.nombre}</Badge>
            {!conjunto.sintetico && <Badge tono={cabeza.vende ? "exito" : "neutro"}>{cabeza.vende ? "Vende" : "Sin venta propia"}</Badge>}
            {!cabeza.activo && <Badge tono="alerta">Cabeza inactiva</Badge>}
          </span>
        }
      >
        <div className="space-y-3">
          {!cabeza.activo && (
            <Alert tono="info">
              La cabeza está inactiva: sus miembros cuentan como ellos mismos mientras tanto, sin perder nada.{" "}
              <button type="button" onClick={reactivarCabeza} disabled={ocupado} className="font-medium underline underline-offset-2">
                Reactivar {cabeza.nombre}
              </button>
            </Alert>
          )}
          {conjunto.sintetico && (
            <Alert tono="info">
              {cabeza.nombre} todavía no tiene miembros: agrégalos abajo. Un conjunto sin miembros no aparece en la lista hasta que tenga uno.
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-tinta">Tratamiento especial de la cabeza</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={cabeza.tratamiento_especial}
                  disabled={ocupado || !marcaCabeza}
                  onChange={cambiarCasilla}
                  label={`Tratamiento especial de ${cabeza.nombre}`}
                />
                Se trata aparte
              </label>
              <p className="text-xs text-tinta-suave">En el flujo manda la configuración de la cabeza; la de los miembros queda ignorada.</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-tinta">Modalidad</p>
              {cabeza.tratamiento_especial ? (
                <Select
                  value={marcaCabeza && !sinModalidadGuardada(marcaCabeza) ? (marcaCabeza.modalidad_efectiva ?? "") : ""}
                  onChange={(e) => cambiarModalidad(e.target.value)}
                  disabled={ocupado || !marcaCabeza}
                  className="h-8"
                  aria-label={`Modalidad de ${cabeza.nombre}`}
                >
                  {(!marcaCabeza || sinModalidadGuardada(marcaCabeza)) && (
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
              ) : (
                <p className="text-sm text-tinta-suave">Sin tratamiento especial.</p>
              )}
              {cabeza.tratamiento_especial && cabeza.modalidad_efectiva === "por_gml" && (
                <p className="text-xs text-tinta-suave">
                  {cabeza.gml_vigentes > 0 ? `Relevante en ${plural(cabeza.gml_vigentes, "GML", "GML")}.` : "Pendiente: sin GML relevantes."}
                </p>
              )}
              {cabeza.tratamiento_especial && cabeza.modalidad_efectiva === "mixta" && (
                <p className="text-xs text-tinta-suave">
                  {cabeza.gml_vigentes > 0
                    ? `Específica en ${plural(cabeza.gml_vigentes, "GML", "GML")}; el resto va al barrer.`
                    : "Mixta sin GML específicos: se comporta como al barrer."}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-tinta" htmlFor="nota-cabeza">
                Nota
              </label>
              <div className="flex gap-2">
                <Input
                  id="nota-cabeza"
                  value={notaEditada}
                  maxLength={MAX_NOTA}
                  disabled={ocupado || !cabeza.tratamiento_especial}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder={cabeza.tratamiento_especial ? "Por qué se trata aparte" : "Solo con tratamiento especial"}
                  className="h-8"
                />
                <Button variante="secundario" tamano="sm" disabled={ocupado || notaEditada.trim() === notaActual.trim()} onClick={() => void guardarNota()}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        titulo={`Miembros (${miembros.length})`}
        descripcion="Cuentan como la cabeza en el flujo. Quitar una marca la devuelve a contar como ella misma."
        acciones={
          <span className="flex flex-wrap justify-end gap-2">
            <Button
              variante="secundario"
              tamano="sm"
              disabled={ocupado || desalineados.length === 0}
              title={desalineados.length === 0 ? "Todos los miembros ya están en la agrupación de la cabeza." : undefined}
              onClick={() => void alinear()}
            >
              Alinear agrupación de los miembros con la cabeza
            </Button>
            <Button
              variante="peligro"
              tamano="sm"
              disabled={ocupado || seleccionados.length === 0}
              onClick={() =>
                void quitar(
                  seleccionados.map((m) => m.id),
                  `¿Quitar ${plural(seleccionados.length, "marca", "marcas")} de ${cabeza.nombre}? Vuelven a contar como ellas mismas y recuperan su configuración propia si la tenían.`
                )
              }
            >
              Quitar {seleccionados.length} seleccionada{seleccionados.length === 1 ? "" : "s"}
            </Button>
          </span>
        }
      >
        {miembros.length > 0 && (
          <label className="mb-3 flex items-center gap-2 text-sm text-tinta-suave">
            <Checkbox
              checked={todosSel}
              indeterminado={seleccionados.length > 0}
              onChange={(v) => setSeleccionMiembros(v ? new Set(miembros.map((m) => m.id)) : new Set())}
              label="Seleccionar todos los miembros"
            />
            Seleccionar todos
          </label>
        )}
        <DataTable columnas={columnasMiembros} filas={miembros} claveFila={(m) => m.id} vacio="Sin miembros. Agrégalos desde el buscador de abajo." />
      </Card>

      <Card titulo="Agregar marcas" descripcion={`Marcas activas que no son cabeza ni VARIOS, OTROS o SIN MARCA. Las que ya están en otro conjunto cambiarán a ${cabeza.nombre}.`}>
        {!puedeAgregar && <Alert tono="info">Reactiva la cabeza para poder agregar miembros.</Alert>}
        {puedeAgregar && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="search"
                placeholder="Buscar marca por nombre…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-8 w-64"
                aria-label="Buscar marcas para agregar"
              />
              <Button tamano="sm" disabled={ocupado || elegidas.length === 0} onClick={() => void agregar()}>
                Agregar {elegidas.length} a {cabeza.nombre}
              </Button>
              {elegidas.length > 0 && (
                <Button variante="fantasma" tamano="sm" onClick={() => setSeleccionNuevas(new Set())}>
                  Limpiar selección
                </Button>
              )}
            </div>
            {candidatas.length === 0 ? (
              <EmptyState titulo="Ninguna marca disponible" detalle={consulta ? "Ninguna coincide con la búsqueda." : "Todas las marcas activas ya son miembros o cabezas."} />
            ) : (
              <>
                <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {visibles.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={seleccionNuevas.has(m.id)}
                        onChange={(v) => {
                          const s = new Set(seleccionNuevas);
                          if (v) s.add(m.id);
                          else s.delete(m.id);
                          setSeleccionNuevas(s);
                        }}
                        label={`Agregar ${m.nombre}`}
                      />
                      <span className="min-w-0 truncate" title={m.nombre}>
                        {m.nombre}
                      </span>
                      <span className="shrink-0 text-xs text-tinta-suave">{m.agrupacion_marca.nombre}</span>
                      {m.conjunto && (
                        <span className="shrink-0">
                          <Badge tono="neutro">en {m.conjunto.nombre}</Badge>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {candidatas.length > visibles.length && (
                  <p className="text-xs text-tinta-suave">
                    Mostrando {visibles.length} de {formatearNumero(candidatas.length)}: escribe en el buscador para acotar.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
