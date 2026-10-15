"use client";

import { useEffect, useMemo, useState } from "react";
import { api, codigoDeError } from "@/lib/api-client";
import { formatearNumero, mensajeError } from "@/lib/formato";
import type { AprobarCurvaRespuesta, ModeloCurva, TemporadaAgrupacion, VersionAgrupacionApi, VersionesAgrupacionApi } from "@/lib/curvas/tipos-api";
import type { MapaColores } from "@/lib/estacionalidad/colores";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { BadgeAgrupacion } from "@/components/estacionalidad/badge-agrupacion";
import { BadgeTemporada, OPCIONES_TEMPORADA, esTemporada } from "@/components/estacionalidad/temporada";
import { GraficoCurvas } from "@/components/curvas/grafico-curvas";
import { AlertaAccion } from "./alerta-accion";
import { AntesDeCalcular } from "./antes-de-calcular";
import { AprobarPanel, ID_NOTA_APROBACION } from "./aprobar-panel";
import { CandidatasTabla } from "./candidatas-tabla";
import { EfectoNinoDetalle, hayEfectoNino } from "./efecto-nino-detalle";
import { NavegarAgrupaciones } from "./navegar-agrupaciones";
import { ParametrosAgrupacion } from "./parametros-agrupacion";
import { RedComparable } from "./red-comparable";
import { TablaAnioMes } from "./tabla-anio-mes";
import {
  errorDeAprobar,
  cuerpoAprobar,
  hayCambiosSinAprobar,
  mensajeNotaRequerida,
  motivoNoSePuedeAprobar,
  motivosNotaRequerida,
  textoCalculado,
  textoRedPorAnio,
  type AccionSugerida,
  type ErrorAprobar,
} from "./trabajo-vista";
import { useRecurso } from "./use-recurso";
import { useTrabajoAgrupacion } from "./use-trabajo";
import { FotoModal, VersionesPanel } from "./versiones-panel";
import {
  aniosDeAjuste,
  compararCurvas,
  etiquetaAprobada,
  etiquetaPropuesta,
  motivoAnioSinDatos,
  redVistaDeAgrupacion,
  textoConfirmarAprobacion,
  textoNoComparable,
  modeloConNombre,
  type Vecinos,
} from "./vista";

const ID_TABLA = "tabla-anio-mes";

/**
 * Vista de trabajo de UNA agrupación (06b): aquí se mira, se ajusta y se aprueba su curva. Muestra, en el mismo
 * gráfico y la misma tabla, la curva aprobada vigente, la de cada uno de los últimos años y la propuesta
 * automática del sistema; la frase de recomendación con sus candidatas; el efecto del Niño; los parámetros de
 * ESTA agrupación (que recalculan al cambiar); el comparador con la aprobada y el botón Aprobar; la red de tiendas
 * y las versiones con su foto. No hay selección múltiple ni aprobación en bloque.
 *
 * Se monta con `key={agrupacionId}`: al cambiar de agrupación todo el estado empieza de cero. La agrupación y la
 * candidata dibujada viven en la URL (`?agrupacion=&modelo=`), que maneja el panel.
 */
export function DetalleAgrupacion({
  agrupacionId,
  nombreInicial,
  colores,
  modeloInicial,
  onModelo,
  vecinos,
  ordenPorDefecto,
  onIrA,
  onVolver,
  onIrAPeriodos,
  onCambio,
}: {
  agrupacionId: string;
  /** El nombre de la lista, para el texto «Leyendo la venta de …» mientras llega el primer cálculo. */
  nombreInicial: string | null;
  colores: MapaColores;
  /** La candidata de `?modelo=` (o `null`: la recomendada). */
  modeloInicial: ModeloCurva | null;
  /** Se llama al dibujar otra candidata, para llevarla a la URL. */
  onModelo: (m: ModeloCurva) => void;
  /** Anterior y siguiente en el orden de la lista (`null` mientras no se conoce la lista). */
  vecinos: Vecinos | null;
  /** El orden es el de la lista completa (no se recordó el filtro). */
  ordenPorDefecto: boolean;
  /** Cambia a otra agrupación (la URL cambia; esta vista se vuelve a montar). */
  onIrA: (agrupacionId: string) => void;
  onVolver: () => void;
  /** Lleva a la pestaña Periodos atípicos. */
  onIrAPeriodos: () => void;
  /** Tras aprobar, retirar o cambiar la temporada: recarga la lista y las agrupaciones. */
  onCambio: () => Promise<void> | void;
}) {
  const t = useTrabajoAgrupacion(agrupacionId);
  const versiones = useRecurso<VersionesAgrupacionApi>(`/api/curvas/agrupaciones/${agrupacionId}/versiones`);
  const [elegida, setElegida] = useState<ModeloCurva | null>(modeloInicial);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [errorAccion, setErrorAccion] = useState<ErrorAprobar | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [redAbierta, setRedAbierta] = useState(false);
  const [foto, setFoto] = useState<VersionAgrupacionApi | null>(null);

  const { datos, parametros } = t;
  const calculo = datos?.calculo ?? null;
  const resultado = calculo?.resultado ?? null;
  const vigente = datos?.vigente ?? null;

  const modelo: ModeloCurva | null = useMemo(() => {
    if (!resultado) return null;
    const sirve = (m: ModeloCurva | null) => m !== null && resultado.candidatas.some((c) => c.modelo === m && c.curva !== null);
    return sirve(elegida) ? elegida : resultado.recomendada;
  }, [resultado, elegida]);
  const candidata = useMemo(() => resultado?.candidatas.find((c) => c.modelo === modelo && c.curva !== null) ?? null, [resultado, modelo]);

  const propuesta = useMemo(() => (candidata?.curva && modelo ? { etiqueta: etiquetaPropuesta(modelo), curva: candidata.curva } : null), [candidata, modelo]);
  const aprobada = useMemo(() => (vigente ? { etiqueta: etiquetaAprobada(vigente.version, vigente.modelo), curva: vigente.curva } : null), [vigente]);
  const comparacion = useMemo(() => (propuesta && vigente ? compararCurvas(vigente.curva, propuesta.curva, vigente.modelo === modelo) : null), [propuesta, vigente, modelo]);
  const avisoNoComparable = useMemo(
    () => (resultado ? textoNoComparable(datos?.comparador?.comparable_con_vigente, vigente?.anios_ajuste ?? null, aniosDeAjuste(resultado.anios)) : null),
    [datos?.comparador?.comparable_con_vigente, vigente?.anios_ajuste, resultado]
  );
  const motivosAnios = useMemo(() => {
    const m = new Map<number, string>();
    if (!calculo || !datos) return m;
    for (const a of calculo.resultado.anios) {
      const sinRed = calculo.red.find((r) => r.anio === a.anio)?.sin_red ?? false;
      const motivo = motivoAnioSinDatos(a, { sinRed, faltantes: datos.datos.faltantes });
      if (motivo) m.set(a.anio, motivo);
    }
    return m;
  }, [calculo, datos]);
  const red = useMemo(
    () => (calculo && parametros ? redVistaDeAgrupacion(calculo.red, calculo.tiendas, calculo.resultado, parametros.umbral_tienda_dominante) : null),
    [calculo, parametros]
  );

  const motivosNota = parametros ? motivosNotaRequerida(parametros, modelo, resultado?.recomendada ?? null) : [];
  const motivoNoPuede = motivoNoSePuedeAprobar({ datos, recalculando: t.recalculando, desactualizado: t.desactualizado, fallo: t.error !== null, tieneCandidata: candidata !== null });

  function elegirCandidata(m: ModeloCurva) {
    setElegida(m);
    onModelo(m);
  }

  /** Recarga lo que depende de la base: el cálculo (con lo que hay en pantalla), las versiones y la lista. */
  async function recargarTodo() {
    t.recalcular();
    await Promise.all([versiones.recargar(), onCambio()]);
  }

  function accion(a: AccionSugerida) {
    if (a.tipo === "recargar") t.recalcular();
    else if (a.tipo === "pestana") onIrAPeriodos();
    else if (a.tipo === "candidata") document.getElementById("candidatas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function aprobar() {
    if (!datos || !resultado || !modelo || !candidata) return;
    setErrorAccion(null);
    setAviso(null);
    const motivos = motivosNotaRequerida(datos.parametros, modelo, resultado.recomendada);
    if (motivos.length > 0 && nota.trim() === "") {
      setErrorAccion(errorDeAprobar("nota_requerida", mensajeNotaRequerida(motivos)));
      document.getElementById(ID_NOTA_APROBACION)?.focus();
      return;
    }
    const cuerpo = cuerpoAprobar(datos, modelo, nota);
    if (!cuerpo) return;
    const nombresTiendas = new Map((calculo?.tiendas ?? []).map((x) => [x.id, x.codigo]));
    const texto = textoConfirmarAprobacion({
      agrupacion: datos.agrupacion.nombre,
      temporada: datos.agrupacion.temporada,
      modelo,
      recomendada: resultado.recomendada,
      anios: resultado.anios,
      eat: candidata.eat,
      ruidoNormal: resultado.ruido_normal,
      versionVigente: vigente?.version ?? null,
      comparacion,
      comparableConVigente: datos.comparador?.comparable_con_vigente ?? null,
      aniosAjusteVigente: vigente?.anios_ajuste ?? null,
      aniosExcluidos: datos.parametros.anios_excluidos,
      tiendasExcluidas: datos.parametros.tiendas_excluidas.map((id) => nombresTiendas.get(id) ?? id),
      tratamiento: datos.parametros.tratamiento_atipicos,
      hasta: cuerpo.parametros.hasta_periodo,
      avisos: [...datos.prerrequisitos.avisa, ...resultado.avisos],
      nota,
    });
    if (!confirm(texto)) return;
    setOcupado(true);
    try {
      const r = await api.put<AprobarCurvaRespuesta>(`/api/curvas/agrupaciones/${agrupacionId}`, cuerpo);
      setNota("");
      setAviso(`Curva ${r.curva.modelo} aprobada como versión ${r.curva.version} de ${datos.agrupacion.nombre}.`);
      await recargarTodo();
    } catch (e) {
      const codigo = codigoDeError(e);
      const err = errorDeAprobar(codigo, mensajeError(e));
      if (codigo === "datos_cambiados" || codigo === "vigente_cambiada") {
        // La pantalla recarga sola con lo que el planner tenía puesto; el mensaje explica por qué.
        setErrorAccion({ mensaje: `${err.mensaje} Ya se volvió a cargar con tus parámetros: revisa y vuelve a aprobar.`, accion: null });
        await recargarTodo();
      } else {
        setErrorAccion(err);
      }
    } finally {
      setOcupado(false);
    }
  }

  async function retirar() {
    if (!vigente || !datos) return;
    if (!confirm(`¿Retirar la curva vigente de ${datos.agrupacion.nombre} (v${vigente.version}, ${modeloConNombre(vigente.modelo)})? La agrupación quedará sin curva hasta que apruebes otra.`)) return;
    setOcupado(true);
    setErrorAccion(null);
    setAviso(null);
    try {
      await api.delete(`/api/curvas/agrupaciones/${agrupacionId}`);
      setAviso(`${datos.agrupacion.nombre}: curva retirada. La agrupación quedó sin curva.`);
      await recargarTodo();
    } catch (e) {
      setErrorAccion(errorDeAprobar(codigoDeError(e), mensajeError(e)));
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarTemporada(temporada: TemporadaAgrupacion) {
    setOcupado(true);
    setErrorAccion(null);
    setAviso(null);
    try {
      await api.patch(`/api/agrupaciones-estacionalidad/${agrupacionId}`, { temporada });
      setAviso("Temporada guardada. La curva vigente se marca obsoleta hasta que vuelvas a aprobar; ya se volvió a calcular.");
      await recargarTodo();
    } catch (e) {
      setErrorAccion(errorDeAprobar(codigoDeError(e), mensajeError(e)));
    } finally {
      setOcupado(false);
    }
  }

  const sinAprobar = hayCambiosSinAprobar({ nota, hasta: t.hasta, parametros, iniciales: t.iniciales });

  /** Cambia de agrupación; con cambios sin aprobar (parámetros, «Calcular hasta» o una nota) pide confirmación antes de perderlos. */
  function irA(id: string) {
    if (ocupado || foto) return;
    if (sinAprobar && !confirm("Tienes cambios sin aprobar en esta agrupación (parámetros o nota). Si cambias de agrupación se pierden. ¿Cambiar de todos modos?")) return;
    onIrA(id);
  }

  // Atajos ← y →: solo si no se está escribiendo (campos, listas) y sin teclas modificadoras.
  const anteriorId = vecinos?.anterior?.id ?? null;
  const siguienteId = vecinos?.siguiente?.id ?? null;
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || el.closest("input, select, textarea, [role=slider], dialog"))) return;
      const destino = e.key === "ArrowLeft" ? anteriorId : siguienteId;
      if (destino) {
        e.preventDefault();
        irA(destino);
      }
    }
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  });

  const volver = (
    <Button variante="secundario" tamano="sm" onClick={onVolver}>
      ← Agrupaciones
    </Button>
  );

  // ─── Primera lectura o apertura fallida ───
  if (!datos || !parametros) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {volver}
          {vecinos && <NavegarAgrupaciones vecinos={vecinos} porDefecto={ordenPorDefecto} deshabilitado={false} onIr={irA} />}
        </div>
        {t.error && (
          <AlertaAccion
            error={{ ...errorDeAprobar(t.error.codigo, t.error.mensaje), accion: { tipo: "recargar", etiqueta: "Volver a intentar" } }}
            onAccion={() => t.recalcular()}
            onCerrar={t.limpiarError}
          />
        )}
        {!t.error && (
          <p className="py-10 text-center text-sm text-tinta-suave" aria-live="polite">
            Leyendo la venta de {nombreInicial ?? "la agrupación"}…
          </p>
        )}
      </div>
    );
  }

  const { agrupacion } = datos;
  const hastaVigente = vigente?.hasta_periodo ?? null;
  const redPorAnio = textoRedPorAnio(calculo?.red ?? []);

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {volver}
          {vecinos && <NavegarAgrupaciones vecinos={vecinos} porDefecto={ordenPorDefecto} deshabilitado={ocupado} onIr={irA} />}
          <BadgeAgrupacion agrupacion={agrupacion} colores={colores} />
          {agrupacion.generos.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="Géneros">
              {agrupacion.generos.map((g) => (
                <li key={g}>
                  <Badge>{g}</Badge>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="text-tinta-suave">Temporada</span>
            <Select
              aria-label={`Temporada de ${agrupacion.nombre}`}
              value={agrupacion.temporada}
              disabled={ocupado}
              onChange={(e) => {
                if (esTemporada(e.target.value)) void cambiarTemporada(e.target.value);
              }}
              className="h-8 w-40!"
            >
              {OPCIONES_TEMPORADA.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </Select>
          </label>
          {agrupacion.temporada_sugerida !== null && agrupacion.temporada_sugerida !== agrupacion.temporada && (
            <span className="inline-flex items-center gap-1.5 text-xs text-alerta">
              Sugerida por sus líneas: <BadgeTemporada temporada={agrupacion.temporada_sugerida} />
            </span>
          )}
        </div>
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {formatearNumero(agrupacion.equivalencias_activas)} equivalencias activas{redPorAnio ? ` · ${redPorAnio}` : ""}
          {" · "}
          {t.recalculando ? (
            <span className="font-medium text-marca-oscura">Recalculando…</span>
          ) : (
            textoCalculado(calculo?.duracion_ms ?? null, datos.datos.hasta_periodo, hastaVigente) || "Sin cálculo"
          )}
          {datos.datos.meses_posteriores.length > 0 && ` · ${datos.datos.meses_posteriores.length} ${datos.datos.meses_posteriores.length === 1 ? "mes publicado" : "meses publicados"} después de ${datos.datos.hasta_periodo ?? "—"} (no entran)`}
        </p>
      </div>

      {t.error && <AlertaAccion error={errorDeAprobar(t.error.codigo, t.error.mensaje)} onAccion={accion} onCerrar={t.limpiarError} />}
      {!agrupacion.activo && <Alert>Esta agrupación está inactiva: se puede mirar, pero no aprobar su curva.</Alert>}

      <AntesDeCalcular
        datos={datos}
        confirmadoSinPeriodos={parametros.sin_periodos_confirmado}
        onConfirmarSinPeriodos={(v) => t.cambiar((p) => ({ ...p, sin_periodos_confirmado: v }))}
        onIrAPeriodos={onIrAPeriodos}
        deshabilitado={ocupado}
      />

      {resultado && calculo && (
        <>
          <Card
            titulo="Curvas de la agrupación"
            descripcion="La aprobada vigente, la curva de cada año sobre las mismas tiendas dentro de cada año y la propuesta del sistema, en el mismo gráfico."
          >
            <GraficoCurvas resultado={resultado} propuesta={propuesta} vigente={aprobada} temporada={calculo.temporada_curva} idTabla={ID_TABLA} />
          </Card>

          <Card titulo="Tabla año × mes" descripcion="Las cifras exactas del gráfico, la diferencia entre propuesta y aprobada, y el promedio, índice y años considerados de cada mes.">
            <TablaAnioMes
              id={ID_TABLA}
              anios={resultado.anios}
              propuesta={propuesta}
              vigente={aprobada}
              umbralDominante={parametros.umbral_tienda_dominante}
              nombreArchivo={`curva-${agrupacion.codigo.toLowerCase()}-anio-mes.csv`}
              motivos={motivosAnios}
            />
          </Card>

          <div className={`grid items-start gap-6 ${hayEfectoNino(resultado) ? "xl:grid-cols-5" : ""}`}>
            <div id="candidatas" className={hayEfectoNino(resultado) ? "xl:col-span-3" : ""}>
              <Card
                titulo="Lo que propone el sistema"
                descripcion="El modelo propone y compara con backtesting (se deja un año fuera y se compara con lo que ocurrió); tú eliges con el botón de la izquierda."
              >
                <CandidatasTabla resultado={resultado} seleccionada={modelo} onSeleccionar={elegirCandidata} avisoNoComparable={avisoNoComparable} />
              </Card>
            </div>
            {hayEfectoNino(resultado) && (
              <div className="xl:col-span-2">
                <EfectoNinoDetalle resultado={resultado} />
              </div>
            )}
          </div>
        </>
      )}

      <ParametrosAgrupacion
        datos={datos}
        parametros={parametros}
        hasta={t.hasta}
        deshabilitado={ocupado}
        onCambiar={t.cambiar}
        onCambiarHasta={t.cambiarHasta}
        onRestablecer={t.restablecer}
      />

      {resultado && calculo && (
        <>
          <AprobarPanel
            datos={datos}
            modelo={modelo}
            propuesta={propuesta}
            vigente={aprobada}
            comparacion={comparacion}
            avisoNoComparable={avisoNoComparable}
            nota={nota}
            onNota={setNota}
            motivosNota={motivosNota}
            puedeAprobar={motivoNoPuede === null}
            motivoNoPuede={motivoNoPuede}
            ocupado={ocupado}
            error={errorAccion}
            aviso={aviso}
            onAprobar={() => void aprobar()}
            onAccion={accion}
            onCerrarError={() => setErrorAccion(null)}
            onCerrarAviso={() => setAviso(null)}
          />

          <Card
            titulo="Red comparable de esta agrupación"
            descripcion="Las tiendas de cada año con su peso sobre la venta de ESTA agrupación y su perfil frente al de la agrupación."
            acciones={
              <Button variante="fantasma" tamano="sm" aria-expanded={redAbierta} onClick={() => setRedAbierta((a) => !a)}>
                {redAbierta ? "Ocultar" : "Mostrar"}
              </Button>
            }
          >
            {!redAbierta ? (
              <p className="text-sm text-tinta-suave">Plegado.</p>
            ) : red ? (
              <RedComparable
                red={red}
                referencia="la agrupación"
                pie="Una tienda marcada «Distinta» se aparta del perfil de la agrupación más que el ruido entre años normales y pesa lo suficiente. Es un diagnóstico y no cambia la curva; para sacar una tienda del cálculo, exclúyela en Parámetros."
              />
            ) : null}
          </Card>
        </>
      )}

      {/* Si el cálculo está bloqueado, los mensajes de aprobar/retirar/temporada igual deben verse. */}
      {!resultado && (errorAccion || aviso) && (
        <>
          {errorAccion && <AlertaAccion error={errorAccion} onAccion={accion} onCerrar={() => setErrorAccion(null)} />}
          {aviso && (
            <Alert tono="exito" onCerrar={() => setAviso(null)}>
              {aviso}
            </Alert>
          )}
        </>
      )}

      <VersionesPanel versiones={versiones} ocupado={ocupado} puedeRetirar={vigente !== null} onVerFoto={setFoto} onRetirar={() => void retirar()} />

      {foto && <FotoModal agrupacionId={agrupacionId} version={foto} versionModeloActual={datos.version_modelo} onCerrar={() => setFoto(null)} />}
    </div>
  );
}
