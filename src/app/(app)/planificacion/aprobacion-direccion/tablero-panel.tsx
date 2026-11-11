"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { AprobacionApi } from "@/lib/direccion/tipos-api";
import { mensajeError } from "@/lib/formato";
import { ETIQUETA_RESULTADO } from "@/components/direccion/formato";
import { descargarLibro } from "../proyeccion/descarga-libro";
import { AlertasTablero } from "./alertas-tablero";
import { Apoyo } from "./apoyo";
import { AvisosCabecera, BarraDecidirMovil, BarraDecision, muestraDecidir } from "./barra-decision";
import { CrecimientosGm } from "./crecimientos-gm";
import { DecisionModal } from "./decision-modal";
import { DecisionesOrigen } from "./decisiones-origen";
import { FiltrosTablero } from "./filtros-tablero";
import { FrenteAprobada } from "./frente-aprobada";
import { GraficoTablero } from "./grafico-tablero";
import { HistorialAprobaciones } from "./historial-aprobaciones";
import { Kpis } from "./kpis";
import { Mayores } from "./mayores";
import { Puente } from "./puente";
import { ResumenDecidir } from "./resumen-decidir";
import { TablaDesglose } from "./tabla-desglose";
import { TablaMensual } from "./tabla-mensual";
import { useTableroDireccion } from "./use-tablero-direccion";
import { aplicarCambio, consultaPagina, cuentaFiltros, hojasTablero, leerFiltrosUrl, limpiarRecorte, nombreArchivoDireccion, recorteVacio, descripcionDesglose, vistaBloqueos, type FiltrosVista } from "./vista-tablero";

const RUTA_PROYECCION = "/planificacion/proyeccion";

type Mensaje = { tono: "exito" | "alerta"; texto: string };

/** Qué ofrecer ante cada error del tablero (§4.2, «Estados vacíos y de error»). */
export type AccionError = "ir_a_proyeccion" | "reintentar" | "abrir_por_defecto" | "limpiar_filtros";

export function accionDeError(codigo: string | null): AccionError {
  if (codigo === "sin_proyeccion" || codigo === "sin_calcular") return "ir_a_proyeccion";
  if (codigo === "proyeccion_no_encontrada") return "abrir_por_defecto";
  if (codigo === "comparar_igual" || codigo === "marca_fuera_de_agrupacion") return "limpiar_filtros";
  return "reintentar";
}

/** El estado de error o vacío del tablero, con la acción que corresponde a su código. El mensaje del servidor se muestra siempre. */
export function ErrorTablero({ mensaje, codigo, hayFiltros, onReintentar, onPorDefecto, onLimpiar }: { mensaje: string; codigo: string | null; hayFiltros: boolean; onReintentar: () => void; onPorDefecto: () => void; onLimpiar: () => void }) {
  const accion = accionDeError(codigo);
  if (codigo === "sin_proyeccion") {
    return (
      <EmptyState titulo="No hay proyección calculada" detalle={mensaje}>
        <Link href={RUTA_PROYECCION} className="inline-flex h-11 items-center rounded-md bg-marca px-4 text-sm font-medium text-white hover:bg-marca-oscura">
          Ir a Proyección
        </Link>
      </EmptyState>
    );
  }
  if (codigo === "sin_calcular") {
    return (
      <EmptyState titulo="Calcula la proyección para verla en el tablero" detalle={mensaje}>
        <Link href={RUTA_PROYECCION} className="inline-flex h-11 items-center rounded-md bg-marca px-4 text-sm font-medium text-white hover:bg-marca-oscura">
          Ir a Proyección
        </Link>
      </EmptyState>
    );
  }
  return (
    <Alert tono={codigo === "calculo_en_curso" ? "info" : "alerta"}>
      <span className="block">{mensaje}</span>
      <span className="mt-2 flex flex-wrap gap-2">
        {accion === "abrir_por_defecto" && (
          <Button variante="secundario" className="h-11! px-5!" onClick={onPorDefecto}>
            Abrir la proyección por defecto
          </Button>
        )}
        {(accion === "limpiar_filtros" || (accion === "reintentar" && hayFiltros)) && (
          <Button variante="secundario" className="h-11! px-5!" onClick={onLimpiar}>
            Limpiar filtros
          </Button>
        )}
        {accion !== "abrir_por_defecto" && (
          <Button variante="secundario" className="h-11! px-5!" onClick={onReintentar}>
            Reintentar
          </Button>
        )}
      </span>
    </Alert>
  );
}

function Parte({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="border-b border-borde pb-1">
      <h2 className="text-lg font-semibold text-tinta">{titulo}</h2>
      <p className="text-sm text-tinta-suave">{detalle}</p>
    </div>
  );
}

/**
 * Pantalla /planificacion/aprobacion-direccion (M14, ficha 14 §4): el tablero con el que dirección aprueba la proyección anual. Solo lectura salvo
 * la decisión. Dos partes, en este orden: «Para decidir» (SIEMPRE la proyección entera: resumen, puente, alertas y diferencia con lo aprobado) y
 * «Explorar» (el recorte de los filtros: tarjetas, gráfico y tabla mensual, desglose, cómo se decidió, datos de apoyo y filas mayores). La proyección,
 * la comparada y todos los filtros viven en la URL. Admin y planner ven lo mismo; solo el admin tiene «Decidir», siempre a la vista (arriba en
 * escritorio, abajo en el móvil). La aprobación avisa: no bloquea el cierre ni las compras.
 */
export function TableroPanel({ esAdmin }: { esAdmin: boolean }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const filtros = useMemo(() => leerFiltrosUrl(params), [params]);
  const { opciones, tablero, bloqueos, aprobaciones, recargarTodo } = useTableroDireccion(filtros);

  const [decidiendo, setDecidiendo] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);

  const catalogo = opciones.datos;
  /** Cambia los filtros en la URL sin recargar la página; el resultado queda coherente con las reglas de la API. */
  const cambiar = useCallback(
    (cambio: Partial<FiltrosVista>, modo: "push" | "replace" = "replace") => {
      const q = consultaPagina(aplicarCambio(filtros, cambio, catalogo));
      const url = q === "" ? pathname : `${pathname}?${q}`;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [filtros, catalogo, pathname]
  );
  const limpiar = useCallback(() => cambiar(limpiarRecorte(filtros)), [cambiar, filtros]);

  // Con error, lo último leído es de otra consulta: no se muestra debajo del error.
  const t = tablero.error === null ? tablero.datos : null;
  const cargandoTablero = tablero.cargando;
  const vBloqueos = useMemo(
    () => vistaBloqueos({ enTrabajo: t?.proyeccion.estado === "en_trabajo", datos: bloqueos.datos, cargando: bloqueos.cargando, error: bloqueos.error }),
    [t?.proyeccion.estado, bloqueos.datos, bloqueos.cargando, bloqueos.error]
  );
  const historial = aprobaciones.datos?.historial ?? null;
  const nFiltros = cuentaFiltros(filtros);
  const conDecidir = muestraDecidir(esAdmin, t);

  async function exportar() {
    if (!t) return;
    setMensaje(null);
    setExportando(true);
    try {
      const hojas = hojasTablero({ tablero: t, opciones: catalogo, filtros, bloqueos: vBloqueos, historial: historial ?? [], ahora: new Date().toISOString() });
      const nombre = nombreArchivoDireccion(t.proyeccion.anio_en_curso);
      await descargarLibro(hojas, nombre);
      setMensaje({ tono: "exito", texto: `Excel descargado (${nombre}) con la proyección y los filtros que ves.` });
    } catch (e) {
      setMensaje({ tono: "alerta", texto: `No se pudo generar el Excel: ${mensajeError(e)}` });
    } finally {
      setExportando(false);
    }
  }

  async function registrada(a: AprobacionApi) {
    setDecidiendo(false);
    setMensaje({ tono: "exito", texto: `Decisión registrada: ${ETIQUETA_RESULTADO[a.resultado].toLowerCase()} por ${a.usuario_nombre.replace(/\.+$/, "")}. Queda en el historial.` });
    await recargarTodo();
  }

  async function recargarTrasCambio() {
    setDecidiendo(false);
    setMensaje({ tono: "alerta", texto: "La proyección cambió: se volvió a cargar el tablero. Revisa las cifras antes de decidir de nuevo." });
    await recargarTodo();
  }

  return (
    <div className={`space-y-5 ${conDecidir ? "pb-20 md:pb-0" : ""}`}>
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">Aprobación de dirección</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Lo que se va a comprar, mes a mes, frente a lo vendido; de dónde sale el aumento, qué riesgo corre y qué cambió desde lo último aprobado. La aprobación queda registrada y avisa en Proyección y
          en Flujo mensual: no bloquea el cierre ni las compras.
        </p>
      </div>

      <BarraDecision
        opciones={catalogo}
        tablero={t}
        filtros={filtros}
        esAdmin={esAdmin}
        cargando={cargandoTablero}
        exportando={exportando}
        onProyeccion={(id) => cambiar({ proyeccion: id, comparar: filtros.comparar === id ? null : filtros.comparar }, "push")}
        onComparar={(v) => cambiar({ comparar: v })}
        onDecidir={() => setDecidiendo(true)}
        onExcel={() => void exportar()}
      />

      {mensaje && (
        <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
          {mensaje.texto}
        </Alert>
      )}
      {opciones.error && (
        <Alert tono="alerta" onCerrar={() => opciones.setError(null)}>
          No se pudieron leer las opciones del tablero (proyecciones y filtros): {opciones.error}{" "}
          <button type="button" onClick={() => void opciones.recargar()} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </Alert>
      )}

      {tablero.error && (
        <ErrorTablero
          mensaje={tablero.error}
          codigo={tablero.codigo}
          hayFiltros={nFiltros > 0}
          onReintentar={() => void tablero.recargar()}
          onPorDefecto={() => cambiar({ proyeccion: null, comparar: null }, "push")}
          onLimpiar={() => cambiar({ ...limpiarRecorte(filtros), comparar: null })}
        />
      )}

      {!t && !tablero.error && <p className="py-10 text-center text-sm text-tinta-suave">Cargando el tablero…</p>}

      {t && (
        <>
          <AvisosCabecera tablero={t} opciones={catalogo} />

          <section className="space-y-4" aria-label="Para decidir">
            <Parte titulo="Para decidir" detalle="Siempre la proyección entera, sin filtros: es lo que se aprueba." />
            <ResumenDecidir tablero={t} bloqueos={vBloqueos} />
            <Puente tablero={t} />
            <AlertasTablero alertas={t.alertas} bloqueos={vBloqueos} onReintentarBloqueos={() => void bloqueos.recargar()} />
            <FrenteAprobada tablero={t} />
          </section>

          <section className="space-y-4" aria-label="Explorar" aria-busy={cargandoTablero}>
            <Parte titulo="Explorar" detalle={`El recorte que elijas${cargandoTablero ? " · actualizando…" : ""}. Filtrar no cambia lo que se aprueba.`} />
            <FiltrosTablero filtros={filtros} opciones={catalogo} tablero={t} onCambiar={cambiar} onLimpiar={limpiar} />
            {recorteVacio(t) ? (
              <EmptyState titulo="Sin venta ni proyección con estos filtros" detalle={t.filtros.texto}>
                <Button variante="secundario" className="h-11! px-5!" onClick={limpiar}>
                  Limpiar filtros
                </Button>
              </EmptyState>
            ) : (
              <>
                <Kpis tablero={t} />
                <Card nivel={3} titulo="Mes a mes" descripcion="Lo proyectado frente a lo vendido en los años anteriores y en el año en curso.">
                  <div className="space-y-5">
                    <GraficoTablero tablero={t} />
                    <TablaMensual tablero={t} />
                  </div>
                </Card>
                <Card nivel={3} titulo="Desglose" descripcion={descripcionDesglose(t)}>
                  <TablaDesglose tablero={t} opciones={catalogo} actualizando={cargandoTablero} onDimension={(d) => cambiar({ desglose: d })} onFiltrar={(c) => cambiar(c, "push")} />
                </Card>
              </>
            )}
            <CrecimientosGm tablero={t} />
            {!recorteVacio(t) && (
              <>
                <DecisionesOrigen tablero={t} />
                <Apoyo tablero={t} />
                <Mayores tablero={t} />
              </>
            )}
          </section>

          <HistorialAprobaciones historial={historial} cargando={aprobaciones.cargando} error={aprobaciones.error} onReintentar={() => void aprobaciones.recargar()} />

          {conDecidir && <BarraDecidirMovil tablero={t} cargando={cargandoTablero} onDecidir={() => setDecidiendo(true)} />}
          {decidiendo && conDecidir && <DecisionModal tablero={t} filtros={filtros} bloqueos={vBloqueos} onCerrar={() => setDecidiendo(false)} onRegistrada={(a) => void registrada(a)} onRecargar={() => void recargarTrasCambio()} />}
        </>
      )}
    </div>
  );
}
