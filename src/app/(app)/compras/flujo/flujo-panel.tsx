"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { Rol } from "@/lib/auth/roles";
import { leerCompra } from "@/lib/compras/use-compras";
import { IMI_MAX, IMI_MIN } from "@/lib/flujo/tipos";
import type { ConciliacionFilaApi, SugerenciaApi } from "@/lib/flujo/tipos-api";
import { aceptarSugerencia, useAccion, useConciliacion, useFilaFlujo, useFlujo, useHuecos } from "@/lib/flujo/use-flujo";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { useColeccion } from "@/lib/use-coleccion";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { AvisoPorConfirmar } from "@/components/compras/aviso-por-confirmar";
import { AvisosFlujo } from "@/components/compras/avisos-flujo";
import { BarraFiltrosFlujo } from "@/components/compras/barra-filtros-flujo";
import { DetalleFila } from "@/components/compras/detalle-fila";
import { DialogoParametros } from "@/components/compras/dialogo-parametros";
import { mesLargo } from "@/components/compras/formato";
import { ListaFilas } from "@/components/compras/lista-filas";
import { columnasTotales, filasMatrizTotales } from "@/components/compras/matriz";
import { resumenIngreso } from "@/components/compras/vista-compras";
import { PestanaConciliacion } from "@/components/compras/pestana-conciliacion";
import { TablaMatriz } from "@/components/compras/tabla-matriz";
import {
  consultaFlujo,
  filasDeLista,
  filtrarPorTexto,
  filtrosConciliacion,
  filtrosFlujo,
  leerParametrosFlujo,
  mesesConciliables,
  nodosDeArbol,
  opcionesArbol,
  ordenarLista,
  ORDEN_INICIAL,
  type ClaveOrden,
  type FilaDeLista,
  type OrdenLista,
  type ParametrosFlujo,
  type Pestana,
} from "@/components/compras/vista-flujo";

const PAGINA = 60;

type Mensaje = { tono: "exito" | "info" | "alerta"; texto: string };

/**
 * Pantalla /compras/flujo (Flujo mensual, M8; ficha 08 §4.3 y §4.3b). Dos pestañas: **Flujo** (la lista de filas con sus totales y, al
 * abrir una, su flujo mes a mes con IMI, saldo por comprar y exceso) y **Conciliación** (los ingresos de los meses cerrados frente a las
 * recepciones registradas, con «Aceptar sugerencia»). La pestaña, los filtros, la fila abierta y el mes conciliado viven en la URL. Todos los
 * roles leen; los Parámetros y «Aceptar sugerencia» son de admin y planner (la API los exige con `requirePlanner`). El sistema calcula y
 * propone; qué comprar y qué ingreso confirmar lo decide la persona.
 */
export function FlujoPanel({ rol }: { rol: Rol }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosFlujo((k) => search.get(k));
  const puedeEscribir = rol === "admin" || rol === "planner";

  const enLista = parametros.pestana === "flujo" && parametros.fila === null;
  const lista = useFlujo(filtrosFlujo(parametros), enLista);
  // Fuera de la lista (detalle o conciliación) la cabecera sale de Huecos, que trae los mismos `datos` en 0,4 MB en vez de la lista completa.
  const cabecera = useHuecos(1, !enLista);
  const detalle = useFilaFlujo(parametros.pestana === "flujo" ? parametros.fila : null);
  const conciliacion = useConciliacion(filtrosConciliacion(parametros), parametros.pestana === "conciliacion");
  const arbol = useArbol(false);
  const agrupaciones = useColeccion<AgrupacionMarcaFila>("/api/agrupaciones-marca");
  const accion = useAccion();

  const [orden, setOrden] = useState<OrdenLista>(ORDEN_INICIAL);
  const [texto, setTexto] = useState("");
  const [paginado, setPaginado] = useState<{ clave: string; limite: number }>({ clave: "", limite: PAGINA });
  const [dialogoParametros, setDialogoParametros] = useState(false);
  const [aceptando, setAceptando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);

  const irA = (siguiente: ParametrosFlujo, modo: "push" | "replace") => {
    const q = consultaFlujo(siguiente);
    const url = q === "" ? pathname : `${pathname}?${q}`;
    if (modo === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  const cambiar = (c: Partial<ParametrosFlujo>) => irA({ ...parametros, ...c }, "replace");
  const cambiarPestana = (p: Pestana) => irA({ ...parametros, pestana: p, fila: null }, "push");

  const datos = (enLista ? lista.datos?.datos : cabecera.datos?.datos) ?? null;
  const rango = { imi_min: datos?.parametros.imi_min ?? IMI_MIN, imi_max: datos?.parametros.imi_max ?? IMI_MAX, meses_tarjeta: datos?.parametros.meses_tarjeta ?? 6 };

  const nodos = useMemo(() => nodosDeArbol(arbol.arbol), [arbol.arbol]);
  const opciones = useMemo(() => opcionesArbol(nodos, parametros), [nodos, parametros]);
  const opcionesAgrupacion = useMemo(() => agrupaciones.datos.filter((a) => a.activo).map((a) => ({ id: a.id, nombre: a.nombre })), [agrupaciones.datos]);

  const filasLista = useMemo<FilaDeLista[]>(() => (lista.datos ? filasDeLista(lista.datos.filas, lista.datos.catalogo) : []), [lista.datos]);
  const visibles = useMemo(() => ordenarLista(filtrarPorTexto(filasLista, texto), orden), [filasLista, texto, orden]);
  const claveFiltros = `${consultaFlujo(parametros)}|${texto}|${orden.clave}${orden.dir}`;
  const limite = paginado.clave === claveFiltros ? paginado.limite : PAGINA;

  const enlaceFila = (f: FilaDeLista) => `${pathname}?${consultaFlujo({ ...parametros, fila: { gml_id: f.fila.gml_id, equivalencia_id: f.fila.equivalencia_id, agrupacion_marca_id: f.fila.agrupacion_marca_id } })}`;

  const consultaLista = consultaFlujo({ ...parametros, fila: null });
  const hrefLista = consultaLista === "" ? pathname : `${pathname}?${consultaLista}`;

  const ordenar = (clave: ClaveOrden) => setOrden((o) => (o.clave === clave ? { clave, dir: o.dir === "asc" ? "desc" : "asc" } : { clave, dir: clave === "fila" || clave === "estado" ? "asc" : "desc" }));

  const errorCarga = (enLista ? lista.error : cabecera.error) ?? detalle.error ?? conciliacion.error ?? arbol.error ?? agrupaciones.error;
  const limpiarErrores = () => {
    lista.setError(null);
    cabecera.setError(null);
    detalle.setError(null);
    conciliacion.setError(null);
    arbol.setError(null);
    agrupaciones.setError(null);
  };

  const periodoConciliado = parametros.periodo ?? conciliacion.datos?.periodo ?? datos?.k_prima ?? "";
  const mesesParaConciliar = datos ? mesesConciliables(datos.k_prima) : periodoConciliado ? [periodoConciliado] : [];

  async function recargarTodo() {
    await Promise.all([lista.recargar(), cabecera.recargar(), conciliacion.recargar(), detalle.recargar()]);
  }

  async function aceptar(fila: ConciliacionFilaApi, s: SugerenciaApi) {
    setMensaje(null);
    accion.limpiar();
    setAceptando(s.entrega_id);
    const r = await accion.ejecutar(async () => {
      // La revisión vigente de la compra se lee justo antes de pedir la confirmación: si alguien la cambió, la API responde `compra_cambio`.
      const compra = await leerCompra(s.compra_id);
      const numeroLinea = compra.lineas.findIndex((l) => l.id === s.linea_id) + 1;
      if (!confirm(`Confirmar ${resumenIngreso(s.compra_numero, numeroLinea, s.unidades, fila.periodo)}.`)) return null;
      return aceptarSugerencia({ periodo: fila.periodo, linea_id: s.linea_id, entrega_id: s.entrega_id, unidades: s.unidades, revision: compra.revision });
    });
    setAceptando(null);
    if (!r.ok) {
      // Una sugerencia vencida o una compra que cambió se arreglan releyendo.
      if (r.error.codigo === "sugerencia_vencida" || r.error.codigo === "compra_cambio") await recargarTodo();
      return;
    }
    if (r.valor === null) return;
    setMensaje({ tono: "exito", texto: `Ingreso confirmado: ${s.unidades} u de ${s.compra_numero} en ${mesLargo(fila.periodo)}, a tu nombre.` });
    await recargarTodo();
  }

  async function parametrosGuardados() {
    setDialogoParametros(false);
    setMensaje({ tono: "exito", texto: "Parámetros guardados. El flujo se recalculó con los valores nuevos." });
    await recargarTodo();
  }

  const cargandoLista = enLista && lista.cargando && !lista.datos;
  const sinCerrada = errorCarga !== null && datos === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Flujo mensual</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Para cada fila, mes a mes: la demanda proyectada, lo que llega, el stock de la cadena y el IMI (meses de inventario) resultante, con el saldo que debe llegar para no bajar del mínimo y el
            exceso sobre el máximo. El sistema calcula y avisa; qué comprar, cuánto y cuándo lo decides tú.
          </p>
          {datos && (
            <p className="mt-1 text-xs text-tinta-suave">
              Proyección cerrada «{datos.cerrada.nombre}» · datos hasta {mesLargo(datos.k_prima)} (el stock es el de ese mes) · horizonte hasta {mesLargo(datos.horizonte.hasta)} · IMI objetivo{" "}
              {datos.parametros.imi_min}–{datos.parametros.imi_max}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeEscribir && datos && (
            <Button variante="secundario" onClick={() => setDialogoParametros(true)}>
              Parámetros
            </Button>
          )}
        </div>
      </div>

      {mensaje && (
        <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
          {mensaje.texto}
        </Alert>
      )}
      {errorCarga && (
        <Alert onCerrar={limpiarErrores}>
          {errorCarga}
          {sinCerrada && puedeEscribir && (
            <>
              {" "}
              <Link href="/planificacion/proyeccion" className="underline underline-offset-2">
                Ir a Proyección
              </Link>
            </>
          )}
        </Alert>
      )}
      {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}

      {datos && <AvisosFlujo datos={datos} enlaceProyeccion={puedeEscribir} />}
      {datos && <AvisoPorConfirmar resumen={datos.por_confirmar} mes={datos.periodos[1]} onRevisar={() => irA({ ...parametros, pestana: "conciliacion", soloConciliacion: "por_confirmar", fila: null }, "push")} />}

      <Tabs
        activa={parametros.pestana}
        onCambiar={cambiarPestana}
        items={[
          { id: "flujo", label: "Flujo" },
          { id: "conciliacion", label: "Conciliación" },
        ]}
      />

      {parametros.pestana === "flujo" && parametros.fila === null && (
        <div className="space-y-4">
          <BarraFiltrosFlujo parametros={parametros} generos={opciones.generos} mundos={opciones.mundos} lineas={opciones.lineas} agrupaciones={opcionesAgrupacion} onCambiar={cambiar} />
          {cargandoLista && <p className="py-8 text-center text-sm text-tinta-suave">Calculando el flujo…</p>}
          {lista.datos && (
            <>
              <Card titulo="Total de las filas mostradas" descripcion="Cambia con los filtros. El IMI no cuenta las filas sin curva de estacionalidad: su stock se mostraría sin su venta.">
                <TablaMatriz
                  columnas={columnasTotales(lista.datos.datos.periodos)}
                  filas={filasMatrizTotales(lista.datos.totales, columnasTotales(lista.datos.datos.periodos), { imiMin: rango.imi_min, imiMax: rango.imi_max })}
                  titulo="Totales del flujo de las filas mostradas"
                />
              </Card>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="w-full max-w-xs">
                  <label className="mb-1 block text-sm font-medium text-tinta" htmlFor="buscar-fila">
                    Buscar fila
                  </label>
                  <Input id="buscar-fila" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Género, mundo, línea o agrupación" />
                </div>
                <p className="text-xs text-tinta-suave" aria-live="polite">
                  {plural(visibles.length, "fila", "filas")}
                  {visibles.length !== filasLista.length ? ` de ${filasLista.length}` : ""} · el saldo es el de los próximos {rango.meses_tarjeta} meses{lista.cargando ? " · actualizando…" : ""}
                </p>
              </div>
              {filasLista.length === 0 ? (
                <EmptyState titulo="Ninguna fila con estos filtros" detalle="Prueba quitando algún filtro." />
              ) : (
                <>
                  <ListaFilas filas={visibles.slice(0, limite)} parametros={rango} orden={orden} onOrdenar={ordenar} enlace={enlaceFila} cargando={lista.cargando && !lista.datos} />
                  {visibles.length > limite && (
                    <div className="flex justify-center">
                      <Button variante="secundario" onClick={() => setPaginado({ clave: claveFiltros, limite: limite + PAGINA })}>
                        Mostrar más ({visibles.length - limite} restantes)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {parametros.pestana === "flujo" && parametros.fila !== null && (
        <div className="space-y-4">
          <Link href={hrefLista} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
            ← Volver a la lista
          </Link>
          {detalle.cargando && !detalle.datos && <p className="py-8 text-center text-sm text-tinta-suave">Cargando la fila…</p>}
          {detalle.datos && <DetalleFila detalle={detalle.datos} parametros={{ imi_min: rango.imi_min, imi_max: rango.imi_max }} historia={parametros.historia} onHistoria={(n) => cambiar({ historia: n })} />}
        </div>
      )}

      {parametros.pestana === "conciliacion" && (
        <div className="space-y-4">
          <BarraFiltrosFlujo parametros={parametros} generos={opciones.generos} mundos={opciones.mundos} lineas={opciones.lineas} agrupaciones={opcionesAgrupacion} onCambiar={cambiar} />
          <PestanaConciliacion
            datos={conciliacion.datos}
            cargando={conciliacion.cargando}
            periodo={periodoConciliado}
            meses={mesesParaConciliar}
            onPeriodo={(m) => cambiar({ periodo: m })}
            puedeEscribir={puedeEscribir}
            aceptando={aceptando}
            onAceptar={(f, s) => void aceptar(f, s)}
          />
        </div>
      )}

      {dialogoParametros && datos && <DialogoParametros parametros={datos.parametros} onGuardado={() => void parametrosGuardados()} onCerrar={() => setDialogoParametros(false)} />}
    </div>
  );
}
