"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import { formatearNumero, mensajeError } from "@/lib/formato";
import { useResponsables } from "@/lib/responsables/use-responsables";
import { filtrarCeldas } from "@/lib/responsables/filtros";
import { COLUMNAS_CSV_RESPONSABLES, filasCsvResponsables } from "@/lib/responsables/csv";
import type { FiltroCeldas } from "@/lib/responsables/tipos";
import {
  claveCelda,
  describirResultado,
  desgloseFaltantes,
  indexarCeldas,
  motivoCargaNoValida,
  nombreVisible,
  ordenarCompradores,
  type AmbitoBloque,
} from "@/lib/responsables/pantalla";
import type { AsignarMasivaCuerpo, CeldaResponsable, ResultadoAsignarMasiva } from "@/lib/responsables/tipos-api";
import { descargarCsv } from "@/components/importador/csv";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { MatrizTabla } from "./matriz-tabla";
import { PanelBloque } from "./panel-bloque";

type ChipId = "todas" | "faltantes" | "mias" | "otro";

const SIN_RESPONSABLE = "__sin__";
const VACIO: readonly CeldaResponsable[] = [];

export function ResponsablesPanel({ rol, usuarioId, responsableInicial }: { rol: Rol; usuarioId: string; responsableInicial?: string }) {
  const puedeAsignar = puedeEditarMaestros(rol);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const { datos, cargando, error, setError, recargar, aplicarCelda } = useResponsables(mostrarInactivos);

  // El filtro solo se guarda cuando el usuario lo elige; mientras tanto se deriva
  // (el comprador con combinaciones abre en "Mis combinaciones") sin efectos.
  const [filtroElegido, setFiltroElegido] = useState<FiltroCeldas | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set());
  const [bloque, setBloque] = useState<AmbitoBloque | null>(null);
  const [bloqueOcupado, setBloqueOcupado] = useState(false);

  const celdas = datos?.celdas ?? VACIO;
  const generos = datos?.generos;
  const mundos = datos?.mundos;
  const resumen = datos?.resumen;

  const indice = useMemo(() => indexarCeldas(celdas), [celdas]);
  const compradores = useMemo(() => ordenarCompradores(datos?.compradores ?? []), [datos]);

  const conteos = useMemo(
    () => ({
      todas: filtrarCeldas([...celdas], "todas").length,
      faltantes: filtrarCeldas([...celdas], "faltantes").length,
      sinResponsable: filtrarCeldas([...celdas], "sin_responsable").length,
      mias: filtrarCeldas([...celdas], { responsable: usuarioId }).length,
    }),
    [celdas, usuarioId]
  );

  const filtroPorDefecto: FiltroCeldas = responsableInicial
    ? { responsable: responsableInicial }
    : rol === "comprador" && conteos.mias > 0
      ? { responsable: usuarioId }
      : "todas";
  const filtro = filtroElegido ?? filtroPorDefecto;

  const visiblesLista = useMemo(() => filtrarCeldas([...celdas], filtro), [celdas, filtro]);
  const visibles = useMemo(() => new Set(visiblesLista.map((c) => claveCelda(c.genero_id, c.mundo_id))), [visiblesLista]);

  const chipActivo: ChipId =
    filtro === "todas" ? "todas" : filtro === "faltantes" ? "faltantes" : typeof filtro === "object" && filtro.responsable === usuarioId ? "mias" : "otro";
  const valorSelect = typeof filtro === "object" ? filtro.responsable : filtro === "sin_responsable" ? SIN_RESPONSABLE : "";

  const generosActivos = generos?.filter((g) => g.activo).length ?? 0;
  const mundosActivos = mundos?.filter((m) => m.activo).length ?? 0;

  function elegirChip(id: ChipId) {
    if (id === "todas") setFiltroElegido("todas");
    else if (id === "faltantes") setFiltroElegido("faltantes");
    else if (id === "mias") setFiltroElegido({ responsable: usuarioId });
  }

  function elegirResponsable(valor: string) {
    setFiltroElegido(valor === "" ? "todas" : valor === SIN_RESPONSABLE ? "sin_responsable" : { responsable: valor });
  }

  async function asignarCelda(celda: CeldaResponsable, perfilId: string | null) {
    const k = claveCelda(celda.genero_id, celda.mundo_id);
    setGuardando((prev) => new Set(prev).add(k));
    setErrorAccion(null);
    setResultado(null);
    try {
      const nueva = await api.put<CeldaResponsable>("/api/responsables", {
        genero_id: celda.genero_id,
        mundo_id: celda.mundo_id,
        perfil_id: perfilId,
      });
      aplicarCelda(nueva);
      await recargar();
    } catch (e) {
      setErrorAccion(mensajeError(e));
      // Recarga también la lista de compradores (el usuario pudo desactivarse o borrarse).
      await recargar();
    } finally {
      setGuardando((prev) => {
        const sig = new Set(prev);
        sig.delete(k);
        return sig;
      });
    }
  }

  async function aplicarBloque(cuerpo: AsignarMasivaCuerpo, quitar: boolean) {
    setBloqueOcupado(true);
    setErrorAccion(null);
    setResultado(null);
    try {
      const r = await api.post<ResultadoAsignarMasiva>("/api/responsables/asignar", cuerpo);
      setResultado(describirResultado(r, quitar));
      setBloque(null);
      await recargar();
    } catch (e) {
      setErrorAccion(mensajeError(e));
      await recargar();
    } finally {
      setBloqueOcupado(false);
    }
  }

  function descargar() {
    if (!generos || !mundos) return;
    descargarCsv([...COLUMNAS_CSV_RESPONSABLES], filasCsvResponsables(visiblesLista, generos, mundos), "responsables-genero-mundo.csv");
  }

  const tituloBloque = useMemo(() => {
    if (bloque === null) return null;
    if (bloque === "todas") return { titulo: "Asignar toda la matriz", de: "de toda la matriz" };
    if ("genero_id" in bloque) {
      const n = generos?.find((g) => g.id === bloque.genero_id)?.nombre ?? "";
      return { titulo: `Asignar las combinaciones de ${n}`, de: `de ${n}` };
    }
    const n = mundos?.find((m) => m.id === bloque.mundo_id)?.nombre ?? "";
    return { titulo: `Asignar las combinaciones del mundo ${n}`, de: `del mundo ${n}` };
  }, [bloque, generos, mundos]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Responsables género-mundo</h1>
          <p className="mt-1 max-w-3xl text-sm text-tinta-suave">
            Qué comprador responde por cada combinación de género y mundo. Sirve para filtrar lo que le toca a cada uno: todos los compradores
            pueden ver todo.
          </p>
        </div>
        <Button variante="secundario" onClick={descargar} disabled={!datos || visiblesLista.length === 0}>
          Descargar CSV
        </Button>
      </div>

      {!puedeAsignar && <Alert tono="info">Vista de solo lectura. Ves a quién le toca cada combinación; el reparto lo hace planeamiento.</Alert>}

      {error && (
        <Alert onCerrar={() => setError(null)}>
          No se pudieron cargar los responsables: {error}{" "}
          <button type="button" onClick={() => void recargar()} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </Alert>
      )}
      {errorAccion && <Alert onCerrar={() => setErrorAccion(null)}>{errorAccion}</Alert>}
      {resultado && (
        <Alert tono="exito" onCerrar={() => setResultado(null)}>
          {resultado}
        </Alert>
      )}

      {!datos && cargando && <p className="text-sm text-tinta-suave">Cargando los responsables…</p>}

      {datos && resumen && generos && mundos && (
        <>
          <div className="space-y-2">
            <p className="text-sm text-tinta">
              {formatearNumero(generosActivos)} géneros × {formatearNumero(mundosActivos)} mundos = {formatearNumero(resumen.combinaciones)}{" "}
              combinaciones · {formatearNumero(resumen.con_responsable)} con responsable ·{" "}
              <span className={resumen.faltantes > 0 ? "font-semibold text-alerta" : "text-exito"}>
                {formatearNumero(resumen.faltantes)} {resumen.faltantes === 1 ? "faltante" : "faltantes"}
              </span>
              {cargando && <span className="ml-2 italic text-tinta-suave">Actualizando…</span>}
            </p>
            {resumen.faltantes > 0 ? (
              <p className="text-xs text-tinta-suave">
                {desgloseFaltantes(resumen)}
                {resumen.faltantes_sin_lineas > 0 &&
                  ` · ${resumen.faltantes_sin_lineas} ${resumen.faltantes_sin_lineas === 1 ? "está en una combinación sin líneas" : "están en combinaciones sin líneas"}`}
              </p>
            ) : (
              resumen.combinaciones > 0 && <Alert tono="exito">Toda combinación vigente tiene responsable</Alert>
            )}
          </div>

          {puedeAsignar && compradores.length === 0 && (
            <Alert tono="info">
              No hay compradores activos. Un administrador puede crearlos en{" "}
              {rol === "admin" ? (
                <Link href="/usuarios" className="font-medium underline underline-offset-2">
                  Usuarios
                </Link>
              ) : (
                "Usuarios"
              )}
              .
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Chips<ChipId>
                etiqueta="Filtrar combinaciones"
                activo={chipActivo}
                onCambiar={elegirChip}
                items={[
                  { id: "todas", label: "Todas", conteo: conteos.todas },
                  { id: "faltantes", label: "Faltantes", conteo: conteos.faltantes },
                  ...(conteos.mias > 0 ? [{ id: "mias" as const, label: "Mis combinaciones", conteo: conteos.mias }] : []),
                ]}
              />
              <Select
                value={valorSelect}
                onChange={(e) => elegirResponsable(e.target.value)}
                className="h-8! w-auto! min-w-52 text-xs"
                aria-label="Filtrar por responsable"
              >
                <option value="">Responsable: todos</option>
                {resumen.por_responsable.map((p) => (
                  <option key={p.perfil_id} value={p.perfil_id}>
                    {nombreVisible(p)} ({p.combinaciones})
                  </option>
                ))}
                {typeof filtro === "object" && !resumen.por_responsable.some((p) => p.perfil_id === filtro.responsable) && (
                  <option value={filtro.responsable}>Responsable elegido (sin combinaciones vigentes)</option>
                )}
                <option value={SIN_RESPONSABLE}>Sin responsable ({conteos.sinResponsable})</option>
              </Select>
            </div>
            <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />
          </div>

          {puedeAsignar && bloque !== null && tituloBloque && (
            <PanelBloque
              key={bloque === "todas" ? "todas" : "genero_id" in bloque ? `g-${bloque.genero_id}` : `m-${bloque.mundo_id}`}
              ambito={bloque}
              titulo={tituloBloque.titulo}
              deLabel={tituloBloque.de}
              celdas={celdas}
              compradores={compradores}
              ocupado={bloqueOcupado}
              onCerrar={() => setBloque(null)}
              onAplicar={aplicarBloque}
            />
          )}

          {generos.length === 0 || mundos.length === 0 ? (
            <EmptyState titulo="No hay combinaciones" detalle="Faltan géneros o mundos activos. Un administrador puede crearlos en Catálogos del árbol." />
          ) : (
            <MatrizTabla
              generos={generos}
              mundos={mundos}
              celdas={celdas}
              indice={indice}
              visibles={visibles}
              compradores={compradores}
              puedeAsignar={puedeAsignar}
              guardando={guardando}
              bloqueado={bloqueOcupado}
              onAsignar={(c, p) => void asignarCelda(c, p)}
              onBloque={(a) => {
                setResultado(null);
                setBloque(a);
              }}
            />
          )}

          <Card titulo="Carga por responsable" descripcion="Cuántas combinaciones vigentes tiene cada uno. Haz clic en un nombre para filtrar la matriz.">
            {resumen.por_responsable.length === 0 ? (
              <p className="text-sm text-tinta-suave">Todavía no hay combinaciones asignadas.</p>
            ) : (
              <ul className="divide-y divide-borde">
                {resumen.por_responsable.map((p) => {
                  const motivo = motivoCargaNoValida(p, celdas);
                  const activo = typeof filtro === "object" && filtro.responsable === p.perfil_id;
                  return (
                    <li key={p.perfil_id} className="flex items-center justify-between gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => setFiltroElegido({ responsable: p.perfil_id })}
                        aria-pressed={activo}
                        className={`min-w-0 truncate text-left text-sm underline-offset-2 hover:underline ${activo ? "font-semibold text-marca-oscura" : "text-tinta"}`}
                      >
                        {nombreVisible(p)}
                        {p.perfil_id === usuarioId && <span className="ml-1 text-xs text-tinta-suave">(tú)</span>}
                      </button>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-tinta-suave">
                        {motivo && <Badge tono="alerta">{motivo}</Badge>}
                        <span className="font-mono text-sm text-tinta">{p.combinaciones}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
