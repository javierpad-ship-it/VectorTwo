import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mesesFaltantes } from "@/lib/curvas/anios";
import { aniosAtipicidad } from "@/lib/curvas/atipicos";
import { calcularEfectoNino } from "@/lib/curvas/lectura";
import type { TemporadaAgrupacion, VolumenAnioApi } from "@/lib/curvas/tipos-api";
import { enTandas } from "@/lib/arbol/importar";
import type { Tables, TablesInsert } from "@/lib/supabase/database.types";
import { aPeriodo } from "@/lib/ventas/periodo";
import { bloquesDeAnio, clavesPertenencia, idsDe } from "./bloques";
import { indiceMes } from "./calendario";
import { calcularProyeccion } from "./calculo";
import {
  actualizarRampaTienda,
  cambiarEstadoProyeccion,
  desactivarAnios,
  desactivarFilas,
  desactivarTiendasProyeccion,
  eliminarProyeccionCondicional,
  eliminarProyeccionDb,
  guardarResultadoCalculo,
  insertarProyeccionDb,
  leerCalculosActivos,
  leerProyeccionDb,
  leerCerradaDeAnio,
  leerFactoresDb,
  leerFilasConAnios,
  leerColaLargaDeFilas,
  leerNivelesProyectados,
  leerNombresDeAnio,
  leerTiendasProyeccion,
  leerVentaTanda,
  listarProyeccionesDb,
  soltarCalculo,
  tomarCalculo,
  upsertAnios,
  upsertFactores,
  upsertFilas,
  upsertTiendasProyeccion,
  type ProyeccionDb,
} from "./consultas";
import {
  cargarCatalogo,
  cargarContextoCalculo,
  contarCurvasObsoletas,
  estadoActualDe,
  factoresPendientes,
  leerVentaTiendaMeses,
  type ContextoCalculo,
} from "./contexto";
import {
  dudasDeRed,
  motivosDesactualizada,
  nivelesCambiados,
  prerrequisitos,
  type DatosPrerrequisitos,
} from "./desactualizado";
import { armarFilasCerradas } from "./mensual";
import {
  aPrevias,
  payloadAnioCalculo,
  payloadAnioDecision,
  payloadFila,
  payloadTiendaCalculo,
  payloadTiendaDecision,
  aFilaPlana,
  comoAvisos,
  type FilaConAnios,
} from "./persistencia";
import {
  MENSAJE_CALCULO_EN_CURSO_PROYECCION,
  MENSAJE_CALCULO_EN_CURSO_SISTEMA,
  calculoEnCurso,
  cargasIguales,
  motivoRechazoArchivarCerrada,
  motivoRechazoCerrar,
  motivoRechazoEdicion,
  motivoRechazoHasta,
  motivoRechazoTopeEnTrabajo,
  periodoADate,
  puedeEliminar,
} from "./reglas";
import {
  aFactorApi,
  aProyeccionApi,
  falla,
  fallaDb,
  fallaMensaje,
  fallaRegla,
  limiteCalculoVivo,
  listo,
  nombreDeFilaPorClave,
  parametrosDe,
  proyeccionOr404,
  sello,
  kDe,
  type Actor,
  type Db,
  type Salida,
} from "./servicio-base";
import type { CrearProyeccionCuerpo, EditarProyeccionCuerpo } from "./esquemas";
import { tendenciaUltimoAnioPct } from "./tendencia";
import { filtrarUniverso } from "./universo";
import {
  PARALELO,
  TANDA_GML,
  claveFila,
  type AvisoFila,
  type BloquesApi,
  type FactorApi,
  type Motivo,
  type ParametrosProyeccion,
  type PlanAnterior,
  type PreviasCalculo,
  type ProyeccionApi,
  type RespuestaCerradaApi,
  type RespuestaProyeccionApi,
  type ResumenProyeccion,
  type VentaProyeccion,
} from "./tipos";

/**
 * Servicio de M7: ciclo de vida de la proyección (estado inicial, crear, leer, editar, eliminar, calcular, cerrar, archivar),
 * factores del Niño y contrato de M8. Cada operación abre su cliente con `supabaseAdmin()` (los handlers nunca tocan la base)
 * y devuelve `{ data, respuesta }`: los datos o la respuesta HTTP con la que cortar. Solo servidor.
 */

const db = (): Db => supabaseAdmin();

// ─── Estado inicial: GET /api/proyeccion ───

/**
 * Motivos por los que una proyección en trabajo quedó desactualizada. Los niveles con que se calculó viajan en el `resumen`
 * (`niveles_gml`, una foto de unos cientos de nodos): así listar proyecciones no recorre las filas de ninguna. Solo una
 * proyección anterior a esa foto lee los niveles de la base, y únicamente si se pide (`leerNiveles`, en el detalle).
 */
async function desactualizadaDe(d: Db, p: ProyeccionDb, ctx: ContextoCalculo, o: { leerNiveles?: boolean } = {}): Promise<Salida<Motivo[]>> {
  if (p.estado !== "en_trabajo") return listo([]);
  const resumen = p.resumen as unknown as Partial<ResumenProyeccion> | null;
  let niveles: { gml_id: string; nivel_proyectado: string }[] = [];
  if (resumen?.niveles_gml) {
    niveles = Object.entries(resumen.niveles_gml).map(([gml_id, nivel_proyectado]) => ({ gml_id, nivel_proyectado }));
  } else if (o.leerNiveles) {
    const r = await leerNivelesProyectados(d, p.id);
    if (r.error) return fallaDb(r.error, "proyección: niveles");
    niveles = r.data;
  }
  const actuales = new Map(ctx.nodos.map((n) => [n.gml_id, n.nivel as string]));
  const parametros = parametrosDe(p.parametros);
  return listo(
    motivosDesactualizada(
      {
        calculado_at: p.calculado_at,
        hasta_periodo: p.hasta_periodo,
        recalculo_pendiente: parametros.recalculo_pendiente,
        resumen: resumen ? { curvas_usadas: resumen.curvas_usadas ?? [], version_metodo: resumen.version_metodo } : null,
        parametros: { factores_usados: parametros.factores_usados, bloques: parametros.bloques },
      },
      estadoActualDe(ctx, nivelesCambiados(niveles, actuales))
    )
  );
}

/** Años que cubre un `hasta`: el año en curso y el siguiente. */
const anioDeHasta = (hasta: string | null, hoy: string) => Number((hasta ?? hoy).slice(0, 4));

export async function leerEstadoInicial(): Promise<Salida<RespuestaProyeccionApi>> {
  const d = db();
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  const [lista, ventaTienda, obsoletas] = await Promise.all([listarProyeccionesDb(d), leerVentaTiendaMeses(d), contarCurvasObsoletas(d, ctx)]);
  if (lista.error) return fallaDb(lista.error, "proyección: listar");
  if (ventaTienda.respuesta) return falla(ventaTienda.respuesta);
  if (obsoletas.respuesta) return falla(obsoletas.respuesta);

  const hasta = ctx.hastaDefecto;
  const anio = anioDeHasta(hasta, ctx.hoy);
  const ultimoPublicado = ctx.publicados.length > 0 ? ctx.publicados[ctx.publicados.length - 1] : null;
  const sinCurva = ctx.agrupaciones.filter((a) => !ctx.vigentes.some((v) => v.agrupacion_id === a.id)).map((a) => ({ id: a.id, nombre: a.nombre }));
  const conVenta = new Set(ventaTienda.data.filter((v) => v.unidades > 0).map((v) => v.tienda_id));
  const pend = factoresPendientes(ctx, anio);
  const dudas = hasta ? dudasDeRed(ctx.tiendas, ventaTienda.data, anio, hasta, ctx.publicados) : [];
  const prereq = prerrequisitos({
    anio,
    hasta,
    mesesPublicados: ctx.publicados,
    tiendas: ctx.tiendas,
    tiendasConVenta: conVenta,
    dudasDeRed: dudas,
    agrupacionesSinCurva: sinCurva,
    curvasObsoletas: obsoletas.data,
    factoresFaltantes: pend.faltantes,
    anioSiguienteAtipico: pend.siguienteAtipico,
  });

  const claves = clavesPertenencia(ctx.tiendas, anio);
  const bloques: BloquesApi = { [anio]: bloquesDeAnio(ctx.tiendas, anio, claves), [anio + 1]: bloquesDeAnio(ctx.tiendas, anio + 1, claves) };
  const ahora = sello();
  const proyecciones: ProyeccionApi[] = [];
  for (const p of lista.data) {
    const des = await desactualizadaDe(d, p, ctx);
    if (des.respuesta) return falla(des.respuesta);
    proyecciones.push(aProyeccionApi(p, des.data, ahora));
  }
  const factores = await factoresConPendientes(d, ctx, anio);
  if (factores.respuesta) return falla(factores.respuesta);

  return listo({
    datos: {
      desde: ctx.publicados[0] ?? null,
      hasta: ultimoPublicado,
      meses_publicados: ctx.publicados,
      meses_faltantes: ultimoPublicado ? mesesFaltantes(ctx.publicados, ultimoPublicado) : [],
      ultimo_mes_cerrado: ctx.ultimoCerrado,
      curvas_vigentes: ctx.vigentes.length,
      agrupaciones_sin_curva: sinCurva,
      curvas_obsoletas: obsoletas.data,
      tendencia_ultimo_anio_pct: tendenciaUltimoAnioPct({
        anioEnCurso: anio,
        tiendas: ctx.tiendas,
        venta: ventaTienda.data,
        publicados: ctx.publicados,
        periodos: ctx.periodosClase,
        factores: ctx.factores,
      }),
    },
    prerrequisitos: prereq,
    bloques_hoy: bloques,
    proyecciones,
    factores: factores.data,
  });
}

// ─── Una proyección ───

export async function leerProyeccion(id: string): Promise<Salida<ProyeccionApi>> {
  const d = db();
  const p = await proyeccionOr404(d, id);
  if (p.respuesta) return falla(p.respuesta);
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const des = await desactualizadaDe(d, p.data, ctxR.data, { leerNiveles: true });
  if (des.respuesta) return falla(des.respuesta);
  return listo(aProyeccionApi(p.data, des.data, sello()));
}

/** Prerrequisitos que bloquean el cálculo (lo que `crear` y `calcular` comprueban antes de leer venta). */
async function bloqueos(d: Db, ctx: ContextoCalculo, anio: number, hasta: string): Promise<Salida<null>> {
  const venta = await leerVentaTiendaMeses(d);
  if (venta.respuesta) return falla(venta.respuesta);
  const conVenta: DatosPrerrequisitos["tiendasConVenta"] = new Set(venta.data.filter((v) => v.unidades > 0).map((v) => v.tienda_id));
  const p = prerrequisitos({ anio, hasta, mesesPublicados: ctx.publicados, tiendas: ctx.tiendas, tiendasConVenta: conVenta });
  if (p.bloquea.length > 0) {
    const faltantes = p.bloquea.find((m) => m.codigo === "meses_faltantes")?.detalle;
    return falla(
      errorConCodigoExtra(p.bloquea.map((m) => m.mensaje).join(" "), 409, "prerrequisitos", { bloquea: p.bloquea, ...(faltantes ? { meses_faltantes: faltantes } : {}) })
    );
  }
  return listo(null);
}

function errorConCodigoExtra(mensaje: string, status: number, codigo: string, extra: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: mensaje, codigo, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

// ─── Crear ───

export async function crearProyeccion(cuerpo: CrearProyeccionCuerpo, actor: Actor): Promise<Salida<ProyeccionApi>> {
  const d = db();
  // Antes de leer nada pesado: si ya hay un cálculo en el sistema, no se empieza otro.
  const libre = await rechazoCalculoSimultaneo(d, null);
  if (libre.respuesta) return falla(libre.respuesta);
  // El contexto completo (con el EAT de M6 y las marcas): el cálculo corre en esta misma petición.
  const ctxR = await cargarContextoCalculo(d);
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  if (ctx.publicados.length === 0 || ctx.hastaDefecto === null) {
    return fallaMensaje("No hay meses publicados y cerrados: carga la venta en Venta y stock.", 409, "sin_datos");
  }
  const hasta = cuerpo.hasta_periodo ?? ctx.hastaDefecto;
  // El año en curso es el del último mes cerrado; «datos hasta» solo puede retroceder dentro de ese año.
  const anio = Number(ctx.hastaDefecto.slice(0, 4));
  const rechazoHasta = motivoRechazoHasta(hasta, anio, ctx.hastaDefecto);
  if (rechazoHasta) return fallaMensaje(rechazoHasta, 400);
  if (!(hasta in ctx.cargas)) return fallaMensaje(`El mes ${hasta} no está publicado en Venta y stock.`, 409, "hasta_periodo_sin_cargar");

  const nombres = await leerNombresDeAnio(d, anio);
  if (nombres.error) return fallaDb(nombres.error, "proyección: nombres");
  if (nombres.data.some((n) => n.nombre.trim().toUpperCase() === cuerpo.nombre.trim().toUpperCase())) {
    return fallaMensaje("Ya existe una proyección con ese nombre para ese año.", 409, "nombre_repetido");
  }
  const tope = motivoRechazoTopeEnTrabajo(nombres.data.filter((n) => n.estado === "en_trabajo").length, anio);
  if (tope) return fallaRegla(tope);

  const bloqueo = await bloqueos(d, ctx, anio, hasta);
  if (bloqueo.respuesta) return falla(bloqueo.respuesta);

  let origen: ProyeccionDb | null = null;
  if (cuerpo.copiar_de) {
    const o = await proyeccionOr404(d, cuerpo.copiar_de);
    if (o.respuesta) return falla(o.respuesta);
    if (o.data.anio_en_curso !== anio) return fallaMensaje("Solo se pueden copiar decisiones de otra proyección del mismo año.", 409, "copia_otro_anio");
    origen = o.data;
  }

  const base = parametrosDe({});
  const parametros: ParametrosProyeccion = { ...base, ...(cuerpo.parametros ?? {}) };
  const nueva: TablesInsert<"proyecciones"> = {
    anio_en_curso: anio,
    nombre: cuerpo.nombre,
    estado: "en_trabajo",
    hasta_periodo: periodoADate(hasta),
    parametros: parametros as unknown as TablesInsert<"proyecciones">["parametros"],
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  };
  const ins = await insertarProyeccionDb(d, nueva);
  if (ins.error) return fallaDb(ins.error, "proyección: crear");

  const calculada = await ejecutarCalculo(d, ins.data, ctx, { previasDe: origen });
  if (calculada.respuesta) {
    // Una proyección que nunca llegó a calcularse no sirve para nada: se retira.
    await eliminarProyeccionDb(d, ins.data.id);
    return falla(calculada.respuesta);
  }
  return calculada;
}

// ─── Editar / eliminar ───

export async function editarProyeccion(id: string, cuerpo: EditarProyeccionCuerpo): Promise<Salida<ProyeccionApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  const rechazo = motivoRechazoEdicion({ estado: p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : "en_trabajo", calculandoDesde: p.calculando_desde, ahora: sello() });
  if (rechazo) return fallaRegla(rechazo);

  const cambio: Parameters<typeof cambiarEstadoProyeccion>[3] = {};
  if (cuerpo.nombre !== undefined) {
    const nombres = await leerNombresDeAnio(d, p.anio_en_curso);
    if (nombres.error) return fallaDb(nombres.error, "proyección: nombres");
    if (nombres.data.some((n) => n.id !== id && n.nombre.trim().toUpperCase() === cuerpo.nombre?.trim().toUpperCase())) {
      return fallaMensaje("Ya existe una proyección con ese nombre para ese año.", 409, "nombre_repetido");
    }
    cambio.nombre = cuerpo.nombre;
  }
  if (cuerpo.nota !== undefined) cambio.nota = cuerpo.nota;

  const parametros = parametrosDe(p.parametros);
  let recalcular = false;
  if (cuerpo.hasta_periodo !== undefined) {
    const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
    if (ctxR.respuesta) return falla(ctxR.respuesta);
    const rechazoHasta = motivoRechazoHasta(cuerpo.hasta_periodo, p.anio_en_curso, ctxR.data.ultimoCerrado);
    if (rechazoHasta) return fallaMensaje(rechazoHasta, 400);
    if (!(cuerpo.hasta_periodo in ctxR.data.cargas)) return fallaMensaje(`El mes ${cuerpo.hasta_periodo} no está publicado en Venta y stock.`, 409, "hasta_periodo_sin_cargar");
    cambio.hasta_periodo = periodoADate(cuerpo.hasta_periodo);
    recalcular = cuerpo.hasta_periodo !== p.hasta_periodo.slice(0, 7);
  }
  if (cuerpo.parametros) {
    const nuevos = { ...parametros, ...cuerpo.parametros };
    recalcular = recalcular || JSON.stringify({ ...nuevos, bloques: null, factores_usados: null, recalculo_pendiente: null }) !== JSON.stringify({ ...parametros, bloques: null, factores_usados: null, recalculo_pendiente: null });
    // Las tiendas con la rampa del defecto anterior siguen al defecto nuevo; las que se editaron a mano, no.
    if (cuerpo.parametros.rampa_maduracion && JSON.stringify(cuerpo.parametros.rampa_maduracion) !== JSON.stringify(parametros.rampa_maduracion)) {
      const filas = await leerTiendasProyeccion(d, id);
      if (filas.error) return fallaDb(filas.error, "proyección: tiendas");
      for (const t of filas.data) {
        if (JSON.stringify(t.rampa) === JSON.stringify(parametros.rampa_maduracion)) {
          const r = await actualizarRampaTienda(d, t.id, cuerpo.parametros.rampa_maduracion);
          if (r.error) return fallaDb(r.error, "proyección: rampa de las tiendas");
        }
      }
    }
    parametros.crecimiento_pct_defecto = nuevos.crecimiento_pct_defecto;
    parametros.umbral_avance = nuevos.umbral_avance;
    parametros.umbral_cobertura = nuevos.umbral_cobertura;
    parametros.umbral_cola_larga = nuevos.umbral_cola_larga;
    parametros.umbral_disponibilidad = nuevos.umbral_disponibilidad;
    parametros.rampa_maduracion = nuevos.rampa_maduracion;
  }
  if (recalcular) parametros.recalculo_pendiente = true;
  if (cuerpo.parametros || recalcular) cambio.parametros = parametros as unknown as TablesInsert<"proyecciones">["parametros"];

  // Condicional: solo si sigue en trabajo y sin cálculo vivo (otra persona pudo cerrarla o calcularla mientras tanto).
  const r = await cambiarEstadoProyeccion(d, id, "en_trabajo", cambio, { sinCalculoDesde: limiteCalculoVivo(sello()) });
  if (r.error) return fallaDb(r.error, "proyección: editar");
  if (!r.data) return fallaMensaje("La proyección cambió mientras se editaba (se cerró o empezó a calcularse). Vuelve a cargar.", 409, "estado_cambiado");
  return leerProyeccion(id);
}

export async function eliminarProyeccion(id: string): Promise<Salida<{ id: string }>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  const estado = p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : "en_trabajo";
  if (estado === "en_trabajo" && calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  // ¿Alguna decisión? (registros decididos o total decidido de una tienda).
  const filas = await leerFilasConAnios(d, id, { columnas: "previas" });
  if (filas.error) return fallaDb(filas.error, "proyección: decisiones");
  const tiendas = await leerTiendasProyeccion(d, id);
  if (tiendas.error) return fallaDb(tiendas.error, "proyección: tiendas");
  const hayDecisiones = filas.data.some((f) => f.proyeccion_fila_anios.some((a) => a.decidido !== null)) || tiendas.data.some((t) => t.decidido !== null);
  const rechazo = puedeEliminar({ estado, hayDecisiones });
  if (rechazo) return fallaRegla(rechazo);
  // Condicional: solo si sigue en trabajo y sin cálculo vivo.
  const r = await eliminarProyeccionCondicional(d, id, limiteCalculoVivo(sello()));
  if (r.error) return fallaDb(r.error, "proyección: eliminar");
  if (!r.data) return fallaMensaje("La proyección cambió mientras se eliminaba (se cerró o empezó a calcularse). Vuelve a cargar.", 409, "estado_cambiado");
  return listo({ id });
}

// ─── Calcular ───

export async function calcularServicio(id: string): Promise<Salida<ProyeccionApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (p.estado === "cerrada") return fallaMensaje("La proyección está cerrada: es solo lectura. Cópiala para seguir trabajando.", 409, "cerrada");
  if (p.estado === "archivada") return fallaMensaje("La proyección está archivada: es solo lectura.", 409, "archivada");
  if (calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  const libre = await rechazoCalculoSimultaneo(d, p.id);
  if (libre.respuesta) return falla(libre.respuesta);
  const ctxR = await cargarContextoCalculo(d);
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  return ejecutarCalculo(d, p, ctxR.data, { previasDe: null });
}

/** Quién entra al detalle de `por_tienda`: nuevas y cierres, referentes, las que salen de `M(Y+1)` y, sin referente, las de las mismas. */
export function tiendasDeDetalle(
  tiendas: readonly { id: string; tipo: string; activo: boolean; fecha_apertura: string | null; referente_id: string | null }[],
  bloques: BloquesApi,
  anio: number
): Set<string> {
  const ids = new Set<string>();
  for (const z of [anio, anio + 1]) {
    for (const t of [...bloques[z].nuevas, ...bloques[z].cierres]) ids.add(t.tienda_id);
  }
  const nuevas = [...bloques[anio].nuevas, ...bloques[anio + 1].nuevas];
  let sinReferente = false;
  for (const t of nuevas) {
    const ref = t.referente_id ? tiendas.find((x) => x.id === t.referente_id) : undefined;
    if (ref && ref.tipo === "Tienda" && ref.activo) ids.add(ref.id);
    else sinReferente = true;
  }
  const siguientes = idsDe(bloques[anio + 1].mismas);
  for (const t of bloques[anio].mismas) if (!siguientes.has(t.tienda_id)) ids.add(t.tienda_id);
  if (sinReferente) {
    for (const t of [...bloques[anio].mismas, ...bloques[anio + 1].mismas]) ids.add(t.tienda_id);
  }
  return ids;
}

/** Corre `tareas` con a lo sumo `n` a la vez, en orden de resultado. */
async function enParalelo<T, R>(items: readonly T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= items.length) return;
      salida[i] = await f(items[i]);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

async function leerPlanAnterior(d: Db, anio: number): Promise<Salida<PlanAnterior | null>> {
  const cerrada = await leerCerradaDeAnio(d, anio - 1);
  if (cerrada.error) return fallaDb(cerrada.error, "proyección: plan anterior");
  if (!cerrada.data) return listo(null);
  const filas = await leerFilasConAnios(d, cerrada.data.id, { columnas: "ligeras", tiendaId: null, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "proyección: plan anterior");
  const totales = new Map<string, number>();
  for (const f of filas.data) {
    const a = f.proyeccion_fila_anios.find((x) => x.anio === anio && x.activo);
    const vigente = a ? (a.decidido ?? a.propuesto) : null;
    if (vigente !== null && vigente !== undefined) totales.set(claveFila(null, f.gml_id, f.equivalencia_id, f.agrupacion_marca_id), vigente);
  }
  return listo({ nombre: cerrada.data.nombre, totales });
}

type OpcionesCalculo = { previasDe: ProyeccionDb | null };

/**
 * Solo un cálculo pesado a la vez en todo el sistema. Dos barreras: un semáforo de proceso (`calculoLocal`, la barrera exacta
 * dentro de una instancia) y la base (`calculando_desde` vivo de CUALQUIER otra proyección, que cubre varias instancias).
 */
let calculoLocal = false;

async function rechazoCalculoSimultaneo(d: Db, exceptoId: string | null): Promise<Salida<null>> {
  if (calculoLocal) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_SISTEMA, 409, "calculo_en_curso");
  const otros = await leerCalculosActivos(d, exceptoId, limiteCalculoVivo(sello()));
  if (otros.error) return fallaDb(otros.error, "proyección: cálculos en curso");
  if (otros.data.length > 0) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_SISTEMA, 409, "calculo_en_curso");
  return listo(null);
}

/**
 * Pone `calculando_desde`, comprueba que nadie más calcula, lee la venta por tandas, calcula, guarda (sin tocar las decisiones)
 * y libera. Si algo falla libera el candado y responde con el motivo; nada de lo escrito se deshace (sin transacción: repetir
 * el cálculo lo repara). Si dos instancias toman el candado a la vez, sigue la más antigua y la otra se retira (409).
 */
async function ejecutarCalculo(d: Db, proy: ProyeccionDb, ctx: ContextoCalculo, o: OpcionesCalculo): Promise<Salida<ProyeccionApi>> {
  const ahora = sello();
  if (calculoEnCurso(proy.calculando_desde, ahora)) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  if (calculoLocal) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_SISTEMA, 409, "calculo_en_curso");
  calculoLocal = true;
  let valorTomado: string | null = null;
  try {
    const tomado = await tomarCalculo(d, proy.id, proy.calculando_desde, ahora);
    if (tomado.error) return fallaDb(tomado.error, "proyección: iniciar cálculo");
    if (!tomado.data) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
    valorTomado = tomado.data.calculando_desde ?? ahora;

    const otros = await leerCalculosActivos(d, proy.id, limiteCalculoVivo(ahora));
    if (otros.error) return fallaDb(otros.error, "proyección: cálculos en curso");
    const miInicio = Date.parse(valorTomado);
    const pasanAntes = otros.data.some((x) => Date.parse(x.calculando_desde) < miInicio || (Date.parse(x.calculando_desde) === miInicio && x.id < proy.id));
    if (pasanAntes) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_SISTEMA, 409, "calculo_en_curso");

    return await calcularYGuardar(d, tomado.data, ctx, o, ahora, valorTomado);
  } finally {
    // Suelta el candado solo si sigue siendo el que se tomó.
    if (valorTomado !== null) await soltarCalculo(d, proy.id, valorTomado);
    calculoLocal = false;
  }
}

async function calcularYGuardar(d: Db, proy: ProyeccionDb, ctx: ContextoCalculo, o: OpcionesCalculo, ahora: string, valorTomado: string): Promise<Salida<ProyeccionApi>> {
  const inicio = Date.now();
  const Y = proy.anio_en_curso;
  const k = kDe(proy);
  const hasta = proy.hasta_periodo.slice(0, 7);
  const parametros = parametrosDe(proy.parametros);
  if (!(hasta in ctx.cargas)) return fallaMensaje(`El mes ${hasta} no está publicado en Venta y stock.`, 409, "hasta_periodo_sin_cargar");
  const bloqueo = await bloqueos(d, ctx, Y, hasta);
  if (bloqueo.respuesta) return falla(bloqueo.respuesta);

  // Bloques y claves de pertenencia (M(Y−3) … M(Y+1)).
  const claves = clavesPertenencia(ctx.tiendas, Y);
  const bloques: BloquesApi = { [Y]: bloquesDeAnio(ctx.tiendas, Y, claves), [Y + 1]: bloquesDeAnio(ctx.tiendas, Y + 1, claves) };
  if (bloques[Y].mismas.length === 0) return fallaMensaje(`Ninguna tienda estuvo abierta los doce meses de ${Y - 1}.`, 409, "prerrequisitos");

  // Tiendas con detalle y desde cuándo (W12; más atrás si hay una apertura histórica para el perfil de rampa).
  const detalle = tiendasDeDetalle(ctx.tiendas, bloques, Y);
  const inicioW12 = indiceMes(Y, k) - 11;
  let desdeIdx = inicioW12;
  const primerPublicado = ctx.publicados[0];
  const primerIdx = primerPublicado ? indiceMes(Number(primerPublicado.slice(0, 4)), Number(primerPublicado.slice(5, 7))) : inicioW12;
  for (const t of ctx.tiendas) {
    if (t.tipo !== "Tienda" || !t.activo || !t.fecha_apertura) continue;
    const idx = indiceMes(Number(t.fecha_apertura.slice(0, 4)), Number(t.fecha_apertura.slice(5, 7)));
    if (idx >= primerIdx && idx + 12 <= indiceMes(Y, k) + 1 && idx < inicioW12) {
      detalle.add(t.id);
      desdeIdx = Math.min(desdeIdx, idx);
    }
  }
  const desdeW12 = aPeriodo(Math.floor(desdeIdx / 12), (desdeIdx % 12) + 1);
  const desde = aPeriodo(Y - 3, 1);

  // Venta: tandas de nodos, a lo sumo PARALELO a la vez; todas deben leer el mismo estado de los datos (I7).
  const tandas = enTandas(ctx.nodos.map((n) => n.gml_id), TANDA_GML);
  const lecturas = await enParalelo(tandas, PARALELO, (gmlIds) => leerVentaTanda(d, { gmlIds, grupos: claves, tiendasDetalle: [...detalle], desde, desdeW12 }));
  for (const l of lecturas) {
    if (l.error) return fallaDb(l.error, "proyección: leer venta");
    if (!l.data) return fallaMensaje("La lectura de venta no devolvió datos válidos.", 500);
  }
  const ventas = lecturas.map((l) => l.data as VentaProyeccion);
  if (!cargasIguales(ventas.map((v) => v.cargas))) {
    return fallaMensaje("Se publicó o cambió una carga mientras se calculaba. Vuelve a calcular.", 409, "datos_cambiaron");
  }
  const venta: VentaProyeccion = {
    filas: ventas.flatMap((v) => v.filas),
    por_tienda: ventas.flatMap((v) => v.por_tienda),
    equivalencias: ventas.flatMap((v) => v.equivalencias),
    detalle_w12: ventas.flatMap((v) => v.detalle_w12),
    disponibilidad: ventas.flatMap((v) => v.disponibilidad),
    cargas: ventas[0]?.cargas ?? {},
  };

  // Decisiones previas (de esta proyección o de la que se copia) y plan anterior.
  const propias = await leerFilasConAnios(d, proy.id, { columnas: "previas" });
  if (propias.error) return fallaDb(propias.error, "proyección: leer filas");
  const tiendasPropias = await leerTiendasProyeccion(d, proy.id);
  if (tiendasPropias.error) return fallaDb(tiendasPropias.error, "proyección: leer tiendas");
  let previas: PreviasCalculo = aPrevias(propias.data, tiendasPropias.data);
  if (o.previasDe) {
    const f = await leerFilasConAnios(d, o.previasDe.id, { columnas: "previas" });
    const t = await leerTiendasProyeccion(d, o.previasDe.id);
    if (f.error ?? t.error) return fallaDb((f.error ?? t.error) as NonNullable<typeof f.error>, "proyección: leer la proyección de origen");
    previas = aPrevias(f.data, t.data);
  }
  const plan = await leerPlanAnterior(d, Y);
  if (plan.respuesta) return falla(plan.respuesta);

  const salida = calcularProyeccion({
    anio: Y,
    k,
    hoy: ctx.hoy,
    parametros: {
      crecimiento_pct_defecto: parametros.crecimiento_pct_defecto,
      umbral_avance: parametros.umbral_avance,
      umbral_cobertura: parametros.umbral_cobertura,
      umbral_cola_larga: parametros.umbral_cola_larga,
      umbral_disponibilidad: parametros.umbral_disponibilidad,
      rampa_maduracion: parametros.rampa_maduracion,
    },
    tiendas: ctx.tiendas,
    nodos: ctx.nodos,
    agrupaciones: ctx.agrupaciones,
    vigentes: ctx.vigentes,
    periodos: ctx.periodosClase,
    factores: ctx.factores,
    venta: filtrarUniverso(venta, Y, k),
    planAnterior: plan.data,
    configFlujo: ctx.configFlujo,
    previas,
  });

  // ── Guardar: filas, registros por año y tiendas; nunca las decisiones ──
  // Antes de escribir: la proyección debe seguir en trabajo y con el candado que se tomó (si se cerró, archivó o eliminó, se aborta).
  const vigente = await leerProyeccionDb(d, proy.id);
  if (vigente.error) return fallaDb(vigente.error, "proyección: comprobar estado");
  if (!vigente.data || vigente.data.estado !== "en_trabajo" || !vigente.data.calculando_desde || Date.parse(vigente.data.calculando_desde) !== Date.parse(valorTomado)) return cambioDuranteCalculo();
  const guardado = await guardarCalculo(d, proy.id, salida, propias.data, tiendasPropias.data, !!o.previasDe);
  if (guardado.respuesta) return falla(guardado.respuesta);

  const factoresUsados: ParametrosProyeccion["factores_usados"] = ctx.factoresDb
    .map((f) => aFactorApi(f, Y + 1))
    .map((f) => ({ anio: f.anio, temporada: f.temporada, ratio: f.ratio_efectivo, origen: f.origen }));
  const nuevosParametros: ParametrosProyeccion = { ...parametros, factores_usados: factoresUsados, bloques: salida.bloques };
  delete nuevosParametros.recalculo_pendiente;
  const niveles_gml: Record<string, string> = {};
  for (const f of salida.filas) niveles_gml[f.gml_id] = f.nivel;
  const resumen: ResumenProyeccion = { ...salida.resumen, duracion_ms: Date.now() - inicio, niveles_gml };
  const upd = await guardarResultadoCalculo(d, proy.id, valorTomado, {
    parametros: nuevosParametros as unknown as TablesInsert<"proyecciones">["parametros"],
    resumen: resumen as unknown as TablesInsert<"proyecciones">["resumen"],
    calculado_at: ahora,
    calculando_desde: null,
  });
  if (upd.error) return fallaDb(upd.error, "proyección: guardar resumen");
  if (!upd.data) return cambioDuranteCalculo();
  const des = await desactualizadaDe(d, upd.data, ctx);
  if (des.respuesta) return falla(des.respuesta);
  return listo(aProyeccionApi(upd.data, des.data, sello()));
}

function cambioDuranteCalculo(): Salida<never> {
  return fallaMensaje("La proyección cambió mientras se calculaba (se cerró, se archivó o se eliminó). El cálculo se descartó; vuelve a cargar.", 409, "estado_cambiado");
}

/**
 * `upsert` de filas, registros y tiendas por tandas. Lo que ya no aparece se marca `activo = false` (conserva sus decisiones y
 * no cuenta). Nunca escribe `decidido`, `origen`, `nota`, `propuesta_al_decidir` ni `decidido_*` (lo prueba la forma de
 * `payloadAnioCalculo`). Si un registro decidido cambió de bloque (una fecha de M4 corregida), queda `bloque_cambiado`.
 */
async function guardarCalculo(
  d: Db,
  proyeccionId: string,
  salida: ReturnType<typeof calcularProyeccion>,
  existentes: readonly FilaConAnios[],
  tiendasExistentes: readonly Tables<"proyeccion_tiendas">[],
  copiando: boolean
): Promise<Salida<null>> {
  const idsFilas = await upsertFilas(d, salida.filas.map((f) => payloadFila(proyeccionId, f)));
  if (idsFilas.error) return fallaDb(idsFilas.error, "proyección: guardar filas");

  const nuevasClaves = new Set(salida.filas.map((f) => f.clave));
  const sobran = existentes.filter((e) => e.activo && !nuevasClaves.has(e.clave)).map((e) => e.id);
  const desact = await desactivarFilas(d, sobran);
  if (desact.error) return fallaDb(desact.error, "proyección: desactivar filas");

  const previas = new Map(existentes.map((e) => [e.clave, e]));
  const registros: TablesInsert<"proyeccion_fila_anios">[] = [];
  const vivos = new Set<string>();
  for (const f of salida.filas) {
    const filaId = idsFilas.data.get(f.clave);
    if (!filaId) continue;
    const previa = previas.get(f.clave);
    for (const r of f.registros) {
      vivos.add(`${filaId}#${r.anio}`);
      const antes = previa?.proyeccion_fila_anios.find((a) => a.anio === r.anio);
      const extra: AvisoFila[] = [];
      if (!copiando && antes && antes.decidido !== null && (antes.bloque !== r.bloque || (antes.subbloque ?? null) !== (r.subbloque ?? null))) extra.push("bloque_cambiado");
      // Al copiar las decisiones de otra proyección, las decisiones se escriben (la proyección nueva no tiene ninguna); al recalcular, nunca.
      registros.push(copiando ? { ...payloadAnioDecision(filaId, r, undefined), avisos: payloadAnioCalculo(filaId, r, extra).avisos } : payloadAnioCalculo(filaId, r, extra));
    }
  }
  const up = await upsertAnios(d, registros);
  if (up.error) return fallaDb(up.error, "proyección: guardar registros");

  const huerfanos: string[] = [];
  for (const e of existentes) for (const a of e.proyeccion_fila_anios) if (a.activo && !vivos.has(`${e.id}#${a.anio}`)) huerfanos.push(a.id);
  const dA = await desactivarAnios(d, huerfanos);
  if (dA.error) return fallaDb(dA.error, "proyección: desactivar registros");

  const existentesT = new Map(tiendasExistentes.map((t) => [`${t.tienda_id}#${t.anio}`, t]));
  const tiendas = salida.tiendas.map((t) => (copiando ? payloadTiendaDecision(proyeccionId, t) : payloadTiendaCalculo(proyeccionId, t, existentesT.has(`${t.tienda_id}#${t.anio}`))));
  const upT = await upsertTiendasProyeccion(d, tiendas);
  if (upT.error) return fallaDb(upT.error, "proyección: guardar tiendas");
  const vivasT = new Set(salida.tiendas.map((t) => `${t.tienda_id}#${t.anio}`));
  const sobranT = tiendasExistentes.filter((t) => t.activo && !vivasT.has(`${t.tienda_id}#${t.anio}`)).map((t) => t.id);
  const dT = await desactivarTiendasProyeccion(d, sobranT);
  if (dT.error) return fallaDb(dT.error, "proyección: desactivar tiendas");
  return listo(null);
}

// ─── Cerrar y archivar ───

export async function cerrarProyeccion(id: string, nota: string | null | undefined, forzar: boolean, actor: Actor): Promise<Salida<ProyeccionApi & { archivada_id: string | null }>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const des = await desactualizadaDe(d, p, ctxR.data);
  if (des.respuesta) return falla(des.respuesta);

  const filas = await leerFilasConAnios(d, id, { columnas: "ligeras", tiendaId: null, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "proyección: leer filas");
  const tiendas = await leerTiendasProyeccion(d, id);
  if (tiendas.error) return fallaDb(tiendas.error, "proyección: leer tiendas");
  const parametros = parametrosDe(p.parametros);

  const resultado = motivoRechazoCerrar({
    estado: p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : "en_trabajo",
    calculandoDesde: p.calculando_desde,
    ahora: sello(),
    anioEnCurso: p.anio_en_curso,
    filasBase: filas.data.map((f) => ({
      clave: f.clave,
      anios: Object.fromEntries(
        f.proyeccion_fila_anios.filter((a) => a.activo).map((a) => [a.anio, { clave: f.clave, propuesto: a.propuesto, decidido: a.decidido, avisos: comoAvisos(a.avisos) }])
      ),
    })),
    tiendas: tiendas.data.filter((t) => t.activo && t.bloque === "nuevas").map((t) => ({ tienda_id: t.tienda_id, anio: t.anio, venta_esperada: t.venta_esperada_usada === null ? null : Number(t.venta_esperada_usada), decidido: t.decidido })),
    desactualizada: des.data.length > 0,
    forzar,
    umbralColaLarga: parametros.umbral_cola_larga,
  });
  if (!resultado.ok) {
    let filasLegibles: Record<string, unknown>[] | undefined;
    if (resultado.filas_sin_decidir) {
      // Nombre del GML (género · mundo · línea · equivalencia · marca) para que la lista se lea sin traducir claves.
      const catalogo = await cargarContextoCatalogo(d);
      if (catalogo.respuesta) return falla(catalogo.respuesta);
      // Las de revisión por cola larga traen además la demanda corregida y la disponibilidad con que quedaron.
      const idPorClave = new Map(filas.data.map((f) => [f.clave, f.id]));
      const ids = resultado.filas_sin_decidir.filter((f) => f.motivo === "revision_cola_larga").map((f) => idPorClave.get(f.clave)).filter((x): x is string => x !== undefined);
      const colas = await leerColaLargaDeFilas(d, id, ids);
      if (colas.error) return fallaDb(colas.error, "proyección: cola larga");
      filasLegibles = resultado.filas_sin_decidir.map((f) => {
        const cola = f.motivo === "revision_cola_larga" ? colas.data.get(idPorClave.get(f.clave) ?? "") : undefined;
        return {
          ...f,
          ...nombreDeFilaPorClave(f.clave, catalogo.data),
          ...(f.motivo === "revision_cola_larga" ? { demanda_corregida: cola?.demanda_corregida ?? null, disponibilidad: cola?.disponibilidad ?? null } : {}),
        };
      });
    }
    return falla(
      errorConCodigoExtra(resultado.rechazo.mensaje, resultado.rechazo.status, resultado.rechazo.codigo, {
        filas_sin_decidir: filasLegibles,
        total_filas_sin_decidir: resultado.total_filas_sin_decidir,
        total_filas_para_revision: resultado.total_filas_para_revision,
        tiendas_sin_decidir: resultado.tiendas_sin_decidir,
        desactualizada: des.data,
      })
    );
  }

  // Una sola `cerrada` por año: la anterior pasa a `archivada` y luego esta se cierra; todo con UPDATE condicional (no hay
  // transacción: si el cierre falla, el archivado se revierte).
  const anterior = await leerCerradaDeAnio(d, p.anio_en_curso);
  if (anterior.error) return fallaDb(anterior.error, "proyección: leer la cerrada anterior");
  let archivadaId: string | null = null;
  if (anterior.data && anterior.data.id !== id) {
    const arch = await cambiarEstadoProyeccion(d, anterior.data.id, "cerrada", { estado: "archivada" });
    if (arch.error) return fallaDb(arch.error, "proyección: archivar la cerrada anterior");
    archivadaId = arch.data?.id ?? null;
  }
  const revertirArchivado = async () => {
    if (archivadaId !== null) await cambiarEstadoProyeccion(d, archivadaId, "archivada", { estado: "cerrada" });
  };
  const cerrada = await cambiarEstadoProyeccion(
    d,
    id,
    "en_trabajo",
    {
      estado: "cerrada",
      cerrada_at: sello(),
      cerrada_por_id: actor.id,
      cerrada_por_nombre: actor.nombre,
      ...(nota !== undefined ? { nota } : {}),
    },
    { sinCalculoDesde: limiteCalculoVivo(sello()) }
  );
  if (cerrada.error) {
    await revertirArchivado();
    return fallaDb(cerrada.error, "proyección: cerrar");
  }
  if (!cerrada.data) {
    await revertirArchivado();
    return fallaMensaje("La proyección cambió mientras se cerraba (empezó a calcularse o ya no está en trabajo). Vuelve a cargar.", 409, "estado_cambiado");
  }
  return listo({ ...aProyeccionApi(cerrada.data, [], sello()), archivada_id: archivadaId });
}

/** Archivar la `cerrada` de un año deja a M8 sin proyección: exige `confirmar_sin_cerrada` (si no, `409 ultima_cerrada`). */
export async function archivarProyeccion(id: string, confirmarSinCerrada = false): Promise<Salida<ProyeccionApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  if (pR.data.estado === "archivada") return fallaMensaje("La proyección ya está archivada.", 409, "archivada");
  if (calculoEnCurso(pR.data.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  const desde = pR.data.estado === "cerrada" ? "cerrada" : "en_trabajo";
  const rechazo = motivoRechazoArchivarCerrada({ estado: desde, anio: pR.data.anio_en_curso, confirmar: confirmarSinCerrada });
  if (rechazo) return fallaRegla(rechazo);
  const r = await cambiarEstadoProyeccion(d, id, desde, { estado: "archivada" }, { sinCalculoDesde: limiteCalculoVivo(sello()) });
  if (r.error) return fallaDb(r.error, "proyección: archivar");
  if (!r.data) return fallaMensaje("La proyección cambió de estado. Vuelve a cargar.", 409, "estado_cambiado");
  return listo(aProyeccionApi(r.data, [], sello()));
}

// ─── Factores del Niño ───

/** `anio#temporada` de los años atípicos que M6 reconoce hoy. */
function aniosAtipicosPorTemporada(ctx: ContextoCalculo): Set<string> {
  const salida = new Set<string>();
  for (const temporada of ["invierno", "verano"] as const) {
    const { anios } = aniosAtipicidad({ agrupacion: { temporada }, periodos: ctx.periodosClase, mesesPublicados: ctx.publicados });
    for (const a of anios) if (a.clase === "atipico") salida.add(`${a.anio}#${temporada}`);
  }
  return salida;
}

async function factoresConPendientes(d: Db, ctx: ContextoCalculo, anioEnCurso: number): Promise<Salida<FactorApi[]>> {
  const filas = ctx.factoresDb;
  const salida = new Map<string, FactorApi>();
  for (const f of filas) salida.set(`${f.anio}#${f.temporada}`, aFactorApi(f, anioEnCurso + 1));
  // Los años atípicos de M6 que aún no tienen fila aparecen vacíos, para que el planner los vea pendientes (incluye el año siguiente).
  for (const temporada of ["invierno", "verano"] as const) {
    const { anios } = aniosAtipicidad({ agrupacion: { temporada }, periodos: ctx.periodosClase, mesesPublicados: ctx.publicados });
    for (const a of anios) {
      if (a.clase !== "atipico" || salida.has(`${a.anio}#${temporada}`)) continue;
      salida.set(
        `${a.anio}#${temporada}`,
        aFactorApi({ anio: a.anio, temporada, ratio_calculado: null, ratio_aplicado: null, parcial: !a.completo, tiendas_comunes: null, meses_comparados: null, calculado_at: null, nota: null }, anioEnCurso + 1)
      );
    }
  }
  void d;
  return listo([...salida.values()].sort((x, y) => x.anio - y.anio || x.temporada.localeCompare(y.temporada)));
}

export async function leerFactores(): Promise<Salida<FactorApi[]>> {
  const d = db();
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  return factoresConPendientes(d, ctxR.data, anioDeHasta(ctxR.data.hastaDefecto, ctxR.data.hoy));
}

export async function guardarFactores(
  cuerpo: { factores: { anio: number; temporada: string; ratio_aplicado: number | null; nota?: string | null }[] },
  actor: Actor
): Promise<Salida<FactorApi[]>> {
  const d = db();
  const actuales = await leerFactoresDb(d);
  if (actuales.error) return fallaDb(actuales.error, "factores: leer");
  // Solo los años con periodo atípico (M6) tienen factor; limpiar uno que ya existía sí se permite.
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: false });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const atipicos = aniosAtipicosPorTemporada(ctxR.data);
  for (const f of cuerpo.factores) {
    if (atipicos.has(`${f.anio}#${f.temporada}`)) continue;
    const yaExistia = actuales.data.some((x) => x.anio === f.anio && x.temporada === f.temporada);
    if (f.ratio_aplicado === null && yaExistia) continue;
    return fallaMensaje(
      `${f.anio} no tiene un periodo atípico de ${f.temporada} en Estacionalidad: solo se ajusta el factor de los años atípicos. Márcalo allí primero.`,
      400,
      "anio_sin_periodo_atipico"
    );
  }
  const filas: TablesInsert<"factores_volumen_atipico">[] = cuerpo.factores.map((f) => {
    const previa = actuales.data.find((x) => x.anio === f.anio && x.temporada === f.temporada);
    return {
      anio: f.anio,
      temporada: f.temporada,
      ratio_aplicado: f.ratio_aplicado,
      nota: f.nota === undefined ? (previa?.nota ?? null) : f.nota,
      perfil_id: actor.id,
      usuario_nombre: actor.nombre,
    };
  });
  const r = await upsertFactores(d, filas);
  if (r.error) return fallaDb(r.error, "factores: guardar");
  return leerFactores();
}

/**
 * `POST factores/sincronizar` (no es un `GET` con efectos). Calcula a demanda, con UNA lectura de venta (la lógica de
 * `/api/periodos-atipicos/anios?con_volumen=1`), el factor de cada año atípico por temporada y guarda `ratio_calculado`,
 * `huella_cargas`, `calculado_at` y `parcial`. No toca `ratio_aplicado` ni `nota`.
 */
export async function sincronizarFactores(actor: Actor): Promise<Salida<FactorApi[]>> {
  const d = db();
  const calculo = await calcularEfectoNino(d, null);
  if (calculo.respuesta) return falla(calculo.respuesta);
  const c = calculo.data;
  if (!c) return fallaMensaje("No se pudo calcular el efecto del Niño.", 500);
  if (c.salida === null) return fallaMensaje("No hay meses publicados y cerrados: carga la venta en Venta y stock.", 409, "sin_datos");
  const filasEfecto = c.salida.efecto_atipico.por_temporada;
  const ahora = sello();
  const salida: TablesInsert<"factores_volumen_atipico">[] = [];
  for (const temporada of ["invierno", "verano"] as TemporadaAgrupacion[]) {
    const volumenDeAnio = (anio: number): { ratio_volumen: number | null; volumen: VolumenAnioApi } | null => {
      const fila = filasEfecto.find((f) => f.anio === anio && f.temporada === temporada);
      if (!fila) return null;
      return {
        ratio_volumen: fila.ratio_volumen,
        volumen: {
          nivel: "temporada",
          temporada,
          ratio_control: fila.ratio_control,
          ratio_relativo: fila.ratio_relativo,
          crecimiento_normal: fila.crecimiento_normal,
          anio_referencia: fila.anio_referencia,
          tiendas_comunes: fila.tiendas_comunes,
          meses_comparados: fila.meses_comparados,
          agrupaciones: fila.agrupaciones,
          ratio_agrupacion: null,
          corrida_id: null,
        },
      };
    };
    const { anios } = aniosAtipicidad({
      agrupacion: { temporada },
      periodos: c.periodos,
      mesesPublicados: c.venta.meses_publicados,
      volumenDeAnio,
    });
    for (const a of anios) {
      if (a.clase !== "atipico" || (temporada !== "invierno" && temporada !== "verano")) continue;
      const ratio = a.ratio_volumen;
      salida.push({
        anio: a.anio,
        temporada,
        ratio_calculado: ratio === null ? null : Math.round(ratio * 10000) / 10000,
        huella_cargas: c.huella_cargas,
        calculado_at: ahora,
        tiendas_comunes: a.volumen?.tiendas_comunes ?? null,
        meses_comparados: a.volumen?.meses_comparados ?? null,
        parcial: !a.completo,
        perfil_id: actor.id,
        usuario_nombre: actor.nombre,
      });
    }
  }
  if (salida.length > 0) {
    const r = await upsertFactores(d, salida);
    if (r.error) return fallaDb(r.error, "factores: sincronizar");
  }
  return leerFactores();
}

// ─── Contrato de M8: GET /api/proyeccion/cerrada ───

/**
 * `leerProyeccionCerrada(anio)`: la `cerrada` más reciente que cubra el año — primero la de `anio_en_curso = anio`; si no hay,
 * la de `anio − 1` (su año siguiente es `anio`). `404 sin_cerrada` si ninguna. M8 nunca recalcula ni reparte: esto es lo
 * guardado. Devuelve las filas del año pedido por género · mundo · línea · equivalencia · agrupación de marca · bloque · tienda.
 */
export async function leerProyeccionCerrada(anio: number): Promise<Salida<RespuestaCerradaApi>> {
  const d = db();
  let cubre: "en_curso" | "siguiente" = "en_curso";
  let r = await leerCerradaDeAnio(d, anio);
  if (r.error) return fallaDb(r.error, "proyección: leer la cerrada");
  if (!r.data) {
    cubre = "siguiente";
    r = await leerCerradaDeAnio(d, anio - 1);
    if (r.error) return fallaDb(r.error, "proyección: leer la cerrada");
  }
  const cerrada = r.data;
  if (!cerrada) return fallaMensaje(`No hay una proyección cerrada que cubra ${anio}.`, 404, "sin_cerrada");

  const catalogo = await cargarContextoCatalogo(d);
  if (catalogo.respuesta) return falla(catalogo.respuesta);
  const filas = await leerFilasConAnios(d, cerrada.id, { columnas: "cerrada", soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "proyección: leer las filas");
  const k = kDe(cerrada);
  const planas = filas.data
    .map((f) => aFilaPlana(f, catalogo.data, k, cerrada.anio_en_curso, true))
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const parametros = parametrosDe(cerrada.parametros);
  return listo({
    proyeccion: aProyeccionApi(cerrada, [], sello()),
    anio_pedido: anio,
    cubre,
    bloques: parametros.bloques,
    filas: armarFilasCerradas(planas, [anio]),
  });
}

async function cargarContextoCatalogo(d: Db) {
  const c = await cargarCatalogo(d);
  if (c.respuesta) return falla(c.respuesta);
  return listo(c.data.catalogo);
}

export { cargarContextoCatalogo };
export type { CrearProyeccionCuerpo, EditarProyeccionCuerpo };
