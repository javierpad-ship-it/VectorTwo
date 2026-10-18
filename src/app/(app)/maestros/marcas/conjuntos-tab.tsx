"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { descargarCsv } from "@/components/importador/csv";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { useConjuntos } from "@/components/marcas/use-conjuntos";
import { ETIQUETA_MODALIDAD } from "@/components/marcas/comunes-m2b";
import { ETIQUETA_AVISO_CONJUNTO, type MarcaConGml, type MiembrosCuerpo, type MiembrosRespuesta } from "@/components/marcas/tipos-m2b";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { Columna, FilaColumna } from "../arbol/comunes";
import { ConjuntoDetalle, type ConjuntoVista } from "./conjunto-detalle";
import { CrearConjuntoDialogo } from "./crear-conjunto-dialogo";
import { SugerenciasConjuntos } from "./sugerencias-conjuntos";

type Filtro = "todos" | "avisos";

/**
 * Pestaña Conjuntos (admin y planner): varias marcas comerciales que para el
 * flujo son una sola. Izquierda, la lista de conjuntos; derecha, el detalle del
 * seleccionado. La cabeza es una marca más del maestro (con su agrupación) y
 * los miembros se cuentan como ella al leer; M5 no cambia.
 */
export function ConjuntosTab({
  marcas,
  agrupaciones,
  cabezaInicial,
  onCambio,
}: {
  marcas: MarcaConGml[];
  agrupaciones: AgrupacionMarcaFila[];
  /** Conjunto que se abre al entrar (viene del badge "Conjunto · n" de la tabla de marcas). */
  cabezaInicial: string | null;
  /** Recarga marcas y agrupaciones del panel tras una escritura. */
  onCambio: () => Promise<void>;
}) {
  // Los conjuntos con cabeza inactiva también se piden: es justo el aviso que importa.
  const conj = useConjuntos(true);
  const [seleccionId, setSeleccionId] = useState<string | null>(cabezaInicial);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ mensaje: string; tono: "exito" | "info" } | null>(null);

  const conjuntos = conj.datos?.conjuntos ?? [];
  const resumen = conj.datos?.resumen;

  /** Cabeza recién creada o elegida que aún no tiene miembros: no viene en la lista, se arma desde las marcas. */
  const marcaSel = seleccionId ? marcas.find((m) => m.id === seleccionId) : undefined;
  const sinMiembros: ConjuntoVista | null =
    marcaSel && !conjuntos.some((c) => c.cabeza.id === marcaSel.id)
      ? {
          sintetico: true,
          efectivo: marcaSel.activo,
          avisos: [],
          miembros: [],
          cabeza: {
            id: marcaSel.id,
            nombre: marcaSel.nombre,
            codigo: marcaSel.codigo,
            activo: marcaSel.activo,
            agrupacion_marca: { id: marcaSel.agrupacion_marca.id, nombre: marcaSel.agrupacion_marca.nombre },
            tratamiento_especial: marcaSel.tratamiento_especial,
            modalidad_efectiva: marcaSel.modalidad_efectiva,
            gml_vigentes: marcaSel.gml_vigentes,
            vende: false,
          },
        }
      : null;

  const consulta = normalizarNombre(busqueda);
  const filtrados = conjuntos.filter(
    (c) =>
      (filtro === "todos" || c.avisos.length > 0 || c.miembros.some((m) => m.avisos.length > 0)) &&
      (consulta === "" || c.cabeza.nombre.includes(consulta) || c.miembros.some((m) => m.nombre.includes(consulta)))
  );
  const conAvisos = conjuntos.filter((c) => c.avisos.length > 0 || c.miembros.some((m) => m.avisos.length > 0)).length;
  const chips: ChipItem<Filtro>[] = [
    { id: "todos", label: "Todos", conteo: conjuntos.length },
    { id: "avisos", label: "Con avisos", conteo: conAvisos },
  ];

  const seleccionado: ConjuntoVista | null =
    sinMiembros ?? conjuntos.find((c) => c.cabeza.id === seleccionId) ?? (seleccionId === null ? (filtrados[0] ?? conjuntos[0] ?? null) : null);

  async function recargar() {
    await Promise.all([conj.recargar(), onCambio()]);
  }

  /** Ejecuta una escritura: bloquea la pantalla, muestra el error de la API y recarga al terminar. */
  async function mutar(accion: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setError(null);
    setResultado(null);
    try {
      await accion();
      await recargar();
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /** Crea un conjunto desde una sugerencia: la cabeza ya existe, solo se le asignan los miembros. */
  async function crearDesdeSugerencia(cabezaId: string, marcaIds: string[]): Promise<boolean> {
    const cuerpo: MiembrosCuerpo = { cabeza_marca_id: cabezaId, accion: "asignar", marca_ids: marcaIds };
    let respuesta: MiembrosRespuesta | null = null;
    const ok = await mutar(async () => {
      respuesta = await api.post<MiembrosRespuesta>("/api/marcas/conjuntos/miembros", cuerpo);
    });
    if (ok) {
      const r = respuesta as MiembrosRespuesta | null;
      setSeleccionId(cabezaId);
      if (r) {
        const rechazadas = r.no_permitidas.length;
        setResultado({
          mensaje: `${plural(r.asignadas, "marca agregada", "marcas agregadas")} al conjunto.${rechazadas > 0 ? ` No entraron: ${r.no_permitidas.map((n) => n.marca).join(", ")}.` : ""}`,
          tono: rechazadas > 0 ? "info" : "exito",
        });
      }
    }
    return ok;
  }

  function descargarConjuntos() {
    const filas: string[][] = [];
    for (const c of conjuntos) {
      for (const m of c.miembros) filas.push([m.nombre, c.cabeza.nombre, m.agrupacion_marca.nombre, c.cabeza.agrupacion_marca.nombre]);
    }
    descargarCsv(["MARCA", "CONJUNTO", "AGRUPACION_MARCA", "AGRUPACION_CABEZA"], filas, "conjuntos-de-marcas.csv");
  }

  return (
    <div className="space-y-4">
      {conj.error && (
        <Alert onCerrar={() => conj.setError(null)}>
          No se pudieron cargar los conjuntos: {conj.error}{" "}
          <button type="button" onClick={() => void conj.recargar()} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </Alert>
      )}
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {resultado && (
        <Alert tono={resultado.tono} onCerrar={() => setResultado(null)}>
          {resultado.mensaje}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">
          {resumen
            ? `${plural(resumen.conjuntos, "conjunto", "conjuntos")} · ${plural(resumen.marcas_en_conjunto, "marca", "marcas")} en conjuntos` +
              (resumen.cabezas_inactivas > 0 ? ` · ${plural(resumen.cabezas_inactivas, "cabeza inactiva", "cabezas inactivas")}` : "") +
              (resumen.con_agrupacion_distinta > 0 ? ` · ${plural(resumen.con_agrupacion_distinta, "con agrupación distinta", "con agrupación distinta")}` : "") +
              (resumen.cadenas > 0 ? ` · ${plural(resumen.cadenas, "cadena", "cadenas")}` : "")
            : conj.cargando
              ? "Cargando conjuntos…"
              : ""}
          {conj.cargando && resumen && <span className="ml-2 italic">Actualizando…</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variante="secundario" onClick={descargarConjuntos} disabled={conjuntos.length === 0}>
            Descargar conjuntos (CSV)
          </Button>
          <Button onClick={() => setCreando(true)} disabled={ocupado}>
            Crear conjunto
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Columna titulo="Conjuntos" subtitulo={`${filtrados.length} de ${conjuntos.length}`}>
            <div className="mb-2 space-y-2">
              <Input
                type="search"
                placeholder="Buscar conjunto o miembro…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-8"
                aria-label="Buscar conjuntos"
              />
              <Chips items={chips} activo={filtro} onCambiar={setFiltro} etiqueta="Filtrar conjuntos" />
            </div>
            <ul className="space-y-0.5">
              {sinMiembros && (
                <li>
                  <FilaColumna seleccionada onClick={() => setSeleccionId(sinMiembros.cabeza.id)}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{sinMiembros.cabeza.nombre}</span>
                      <span className="text-xs text-tinta-suave">Sin miembros todavía</span>
                    </span>
                  </FilaColumna>
                </li>
              )}
              {filtrados.map((c) => {
                const avisos = [...new Set([...c.avisos, ...c.miembros.flatMap((m) => m.avisos)])];
                return (
                  <li key={c.cabeza.id}>
                    <FilaColumna
                      seleccionada={!sinMiembros && c.cabeza.id === seleccionado?.cabeza.id}
                      atenuada={!c.cabeza.activo}
                      onClick={() => setSeleccionId(c.cabeza.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.cabeza.nombre}</span>
                        <span className="block text-xs text-tinta-suave">
                          {c.cabeza.agrupacion_marca.nombre} · {c.miembros.length} miembro{c.miembros.length === 1 ? "" : "s"}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {c.cabeza.tratamiento_especial && c.cabeza.modalidad_efectiva === "barrido" && <Badge tono="neutro">{ETIQUETA_MODALIDAD.barrido}</Badge>}
                          {c.cabeza.tratamiento_especial && c.cabeza.modalidad_efectiva === "por_gml" && (
                            <Badge tono="exito">Por GML · {c.cabeza.gml_vigentes}</Badge>
                          )}
                          {c.cabeza.tratamiento_especial && c.cabeza.modalidad_efectiva === "mixta" && (
                            <Badge tono="marca">Mixta · {c.cabeza.gml_vigentes}</Badge>
                          )}
                          {avisos.map((a) => (
                            <Badge key={a} tono="alerta">
                              {a === "agrupacion_distinta" ? "Agrupación distinta" : ETIQUETA_AVISO_CONJUNTO[a]}
                            </Badge>
                          ))}
                        </span>
                      </span>
                    </FilaColumna>
                  </li>
                );
              })}
            </ul>
            {conjuntos.length === 0 && !sinMiembros && !conj.cargando && (
              <EmptyState
                titulo="Todavía no hay conjuntos"
                detalle="Crea uno con una marca cabeza (ALFA) y agrega sus miembros (ALFA JEANS, ALFA KIDS), o mira las sugerencias de abajo."
              />
            )}
            {conjuntos.length > 0 && filtrados.length === 0 && <p className="px-2 py-3 text-sm text-tinta-suave">Ningún conjunto coincide con el filtro.</p>}
          </Columna>
        </div>

        <div className="lg:col-span-8">
          {seleccionado ? (
            <ConjuntoDetalle
              key={seleccionado.cabeza.id}
              conjunto={seleccionado}
              marcas={marcas}
              ocupado={ocupado}
              mutar={mutar}
              onResultado={(mensaje, tono = "exito") => setResultado({ mensaje, tono })}
            />
          ) : (
            <EmptyState titulo="Elige un conjunto" detalle={`Se ven ${formatearNumero(conjuntos.length)} conjuntos. Crea uno nuevo con el botón de arriba.`} />
          )}
        </div>
      </div>

      <SugerenciasConjuntos ocupado={ocupado} onCrear={crearDesdeSugerencia} />

      {creando && (
        <CrearConjuntoDialogo
          marcas={marcas}
          agrupaciones={agrupaciones}
          onCerrar={() => setCreando(false)}
          onCreado={async (cabezaId) => {
            setCreando(false);
            setSeleccionId(cabezaId);
            await recargar();
          }}
        />
      )}
    </div>
  );
}
