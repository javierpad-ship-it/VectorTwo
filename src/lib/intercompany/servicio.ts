import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { compararNombre } from "@/lib/arbol/armar-arbol";
import { cargarEstadoNivel } from "@/lib/arbol/nivel/consultas";
import { indexarNodos, type IndiceNodos } from "@/lib/arbol/nivel/indice";
import { leerMarcas } from "@/lib/marcas/consultas";
import { leerParticipacionesDeCerrada } from "@/lib/proyeccion/servicio";
import { falla, fallaDb, fallaMensaje, listo, type Salida } from "@/lib/proyeccion/servicio-base";
import { hoyLima } from "@/lib/tiendas/estado";
import {
  actualizarRegla,
  eliminarReglaDb,
  insertarRegla,
  leerEquivalencia,
  leerEquivalenciasPorIds,
  leerReglaPorId,
  leerReglasIntercompany,
  type ReglaDb,
} from "./consultas";
import {
  aplicable,
  esMarcaSugerida,
  esRangoDefecto,
  fueraDeAmbito,
  hastaDerivado,
  motivoRechazoRegla,
  pctCd,
  rangoValido,
  reglaAnterior,
  reglaVigente,
  secuenciaPorClave,
  type ReglaBase,
} from "./reglas";
import { MENSAJE_RANGO, type CrearRegla, type EditarRegla } from "./esquemas";
import {
  IMI_MAX_DEFECTO,
  IMI_MIN_DEFECTO,
  type AplicabilidadApi,
  type AvisoRegla,
  type CerradaConsultadaApi,
  type EliminarReglaApi,
  type NivelNodo,
  type ParticipacionFilaCerrada,
  type ReglaIntercompanyApi,
  type VigentesIntercompanyApi,
} from "./tipos-api";

/**
 * Servicio de M13 (solo servidor): arma el contexto (marcas, nodos con su ruta, nombres de equivalencia), llama a `consultas.ts` y
 * a la lógica pura de este módulo y devuelve `{ data, respuesta }` como el servicio de M12. Los handlers abren el cliente con
 * `supabaseAdmin()` y lo pasan. Escribe solo `crearRegla`, `editarRegla` y `eliminarRegla`; las lecturas nunca escriben. La cerrada
 * de M7 se lee con `leerParticipacionesDeCerrada` (lectura ligera: solo filas base con participaciones) y solo para decidir
 * `aplicable`; si algo falla DESPUÉS de escribir, la respuesta lleva `aplicable = null` y el aviso `aplicabilidad_no_evaluada` en
 * vez de fallar una escritura que ya ocurrió.
 */

type Db = SupabaseClient<Database>;

export const NO_ENCONTRADA = "Regla no encontrada.";

// ─── Contexto ───

type PiezaCodigo = { codigo: string; nombre: string };

type ContextoIntercompany = {
  marcas: Awaited<ReturnType<typeof leerMarcas>>["data"];
  nombreMarca: (id: string) => string;
  nodos: IndiceNodos;
  generos: Map<string, PiezaCodigo>;
  mundos: Map<string, PiezaCodigo>;
};

async function cargarContexto(d: Db): Promise<Salida<ContextoIntercompany>> {
  const [marcas, nivel] = await Promise.all([leerMarcas(d), cargarEstadoNivel(d)]);
  if (marcas.error) return fallaDb(marcas.error, "intercompany: leer marcas");
  if (nivel.error) return fallaDb(nivel.error, "intercompany: leer el árbol");
  const e = nivel.estado;
  const nombres = new Map(marcas.data.map((m) => [m.id, m.nombre]));
  return listo({
    marcas: marcas.data,
    nombreMarca: (id) => nombres.get(id) ?? id,
    nodos: indexarNodos({ generos: e.generos, mundos: e.mundos, lineas: e.lineas, nodos: e.nodos }),
    generos: new Map(e.generos.map((g) => [g.id, { codigo: g.codigo, nombre: g.nombre }])),
    mundos: new Map(e.mundos.map((m) => [m.id, { codigo: m.codigo, nombre: m.nombre }])),
  });
}

/** `aaaa-mm-dd` de la base → `aaaa-mm`. */
const mesDe = (fecha: string) => fecha.slice(0, 7);

/** La fila de la base en la forma que usan las reglas puras (`vigente_desde` en `aaaa-mm`). */
export const aBase = (r: ReglaDb): ReglaBase => ({
  id: r.id,
  marca_id: r.marca_id,
  genero_mundo_linea_id: r.genero_mundo_linea_id,
  equivalencia_id: r.equivalencia_id,
  vigente_desde: mesDe(r.vigente_desde),
  activo: r.activo,
});

type Aplicabilidad = (r: ReglaBase) => { aplicable: boolean | null; motivo: ReglaIntercompanyApi["motivo_no_aplicable"] };
const SIN_EVALUAR: Aplicabilidad = () => ({ aplicable: null, motivo: null });

/** Una regla de la base en la forma de la API. `todas` son las reglas activas (para el `hasta` derivado). */
export function aReglaApi(
  r: ReglaDb,
  c: ContextoIntercompany,
  todas: readonly ReglaBase[],
  nombresEq: ReadonlyMap<string, string>,
  evaluar: Aplicabilidad,
  avisos: AvisoRegla[] = []
): ReglaIntercompanyApi {
  const base = aBase(r);
  const nodo = c.nodos.get(r.genero_mundo_linea_id);
  const rutaNodo = nodo?.ruta ?? r.genero_mundo_linea_id;
  const eq = r.equivalencia_id ? (nombresEq.get(r.equivalencia_id) ?? r.equivalencia_id) : null;
  const genero = nodo ? c.generos.get(nodo.genero_id) : undefined;
  const mundo = nodo ? c.mundos.get(nodo.mundo_id) : undefined;
  const min = Number(r.cobertura_min_meses);
  const max = Number(r.cobertura_max_meses);
  const pct = Number(r.pct_directo);
  const ap = evaluar(base);
  return {
    id: r.id,
    marca_id: r.marca_id,
    marca: c.nombreMarca(r.marca_id),
    genero_mundo_linea_id: r.genero_mundo_linea_id,
    equivalencia_id: r.equivalencia_id,
    ruta: eq ? `${rutaNodo} › ${eq}` : rutaNodo,
    nivel: (nodo?.nivel_planificacion === "GMLE" ? "GMLE" : "GML") satisfies NivelNodo,
    vigente_desde: base.vigente_desde,
    hasta_derivado: hastaDerivado(todas, base),
    imi_min: min,
    imi_max: max,
    es_rango_defecto: esRangoDefecto(min, max),
    pct_directo: pct,
    pct_cd: pctCd(pct),
    pct_directo_observado: null,
    nota: r.nota,
    usuario_nombre: r.usuario_nombre,
    updated_at: r.updated_at,
    aplicable: ap.aplicable,
    motivo_no_aplicable: ap.motivo,
    fuera_de_ambito: genero && mundo ? fueraDeAmbito({ genero, mundo }) : true,
    avisos,
  };
}

// ─── La cerrada de M7 (solo para `aplicable`) ───

type CerradaLeida = { filas: ParticipacionFilaCerrada[]; info: CerradaConsultadaApi };

/**
 * Caché POR PETICIÓN de la lectura de la cerrada (año → lectura): cada llamada del servicio crea la suya con `nuevaCacheCerrada()`
 * y la pasa hacia abajo, así dentro de una misma petición la cerrada se lee una sola vez. NO es global: una cerrada nueva se ve en
 * la petición siguiente.
 */
export type CacheCerrada = Map<number, Promise<Salida<CerradaLeida | null>>>;
export const nuevaCacheCerrada = (): CacheCerrada => new Map();

/**
 * Las participaciones de las filas base de la cerrada que cubre `anio`, con una lectura LIGERA (`leerParticipacionesDeCerrada`:
 * solo filas base con `participaciones`, columnas mínimas, de a 1 000; nunca filas de tienda). Sin cerrada (`404`) → `null`
 * (`sin_cerrada`); cualquier otro error se propaga.
 */
export function leerParticipacionesCerrada(anio: number, cache: CacheCerrada = nuevaCacheCerrada()): Promise<Salida<CerradaLeida | null>> {
  const previa = cache.get(anio);
  if (previa) return previa;
  const lectura = leerParticipacionesCerradaSinCache(anio);
  cache.set(anio, lectura);
  return lectura;
}

async function leerParticipacionesCerradaSinCache(anio: number): Promise<Salida<CerradaLeida | null>> {
  const r = await leerParticipacionesDeCerrada(anio);
  if (r.respuesta) {
    if (r.respuesta.status === 404) return listo(null);
    return falla(r.respuesta);
  }
  const filas: ParticipacionFilaCerrada[] = r.data.filas.map((f) => ({
    gml_id: f.gml_id,
    por_clave_flujo: f.participaciones.por_clave_flujo.map((x) => ({ marca_id: x.marca_id, participacion: x.participacion })),
    por_marca: f.participaciones.por_marca ? f.participaciones.por_marca.map((x) => ({ marca_id: x.marca_id, participacion: x.participacion })) : null,
  }));
  return listo({ filas, info: { anio: r.data.anio_pedido, cubre: r.data.cubre, con_por_marca: filas.some((f) => f.por_marca !== null) } });
}

type ResultadoAplicabilidad = { evaluar: Aplicabilidad; cerrada: CerradaConsultadaApi | null; evaluada: boolean };

/**
 * `aplicable` con la cerrada del año del mes. Con `blando`, si no se puede leer queda "no evaluada" (`evaluar` da `null` y
 * `evaluada = false`); sin cerrada (404) NO es un fallo: `aplicable = null` con `sin_cerrada` y `evaluada = true`.
 */
async function aplicabilidadDe(anio: number, blando: boolean, cache: CacheCerrada): Promise<Salida<ResultadoAplicabilidad>> {
  const c = await leerParticipacionesCerrada(anio, cache);
  if (c.respuesta) {
    if (blando) return listo({ evaluar: SIN_EVALUAR, cerrada: null, evaluada: false });
    return falla(c.respuesta);
  }
  const filas = c.data ? c.data.filas : null;
  return listo({ evaluar: (r) => aplicable(r, filas), cerrada: c.data ? c.data.info : null, evaluada: true });
}

const anioDe = (mes: string) => Number(mes.slice(0, 4));
const mesActual = () => hoyLima().slice(0, 7);

// ─── Lecturas ───

async function nombresDeEquivalencias(d: Db, reglas: readonly ReglaDb[]): Promise<Salida<Map<string, string>>> {
  const ids = [...new Set(reglas.map((r) => r.equivalencia_id).filter((x): x is string => x !== null))];
  if (ids.length === 0) return listo(new Map());
  const eq = await leerEquivalenciasPorIds(d, ids);
  if (eq.error) return fallaDb(eq.error, "intercompany: leer equivalencias");
  return listo(new Map(eq.data.map((e) => [e.id, e.nombre])));
}

const comparar = (a: ReglaIntercompanyApi, b: ReglaIntercompanyApi) =>
  compararNombre(a.marca, b.marca) ||
  compararNombre(a.ruta, b.ruta) ||
  (a.vigente_desde < b.vigente_desde ? -1 : a.vigente_desde > b.vigente_desde ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * `GET /api/intercompany/reglas?mes=&incluir_historial=1`: sin historial, la regla vigente de cada clave en `mes` (por defecto el
 * mes en curso de Lima); con él, todas. Cada una con `hasta_derivado`, `aplicable` (cerrada de M7), `fuera_de_ambito` y nombres.
 */
export async function listarReglas(d: Db, mesPedido: string | undefined, historial: boolean): Promise<Salida<ReglaIntercompanyApi[]>> {
  const mes = mesPedido ?? mesActual();
  const reglas = await leerReglasIntercompany(d);
  if (reglas.error) return fallaDb(reglas.error, "intercompany: leer las reglas");
  const ctx = await cargarContexto(d);
  if (ctx.respuesta) return falla(ctx.respuesta);
  const nombres = await nombresDeEquivalencias(d, reglas.data);
  if (nombres.respuesta) return falla(nombres.respuesta);

  const base = reglas.data.map(aBase);
  let elegidas: ReglaDb[] = reglas.data;
  if (!historial) {
    const vigentes = new Set<string>();
    for (const lista of secuenciaPorClave(base).values()) {
      const v = reglaVigente(lista, lista[0], mes);
      if (v) vigentes.add(v.id);
    }
    elegidas = reglas.data.filter((r) => vigentes.has(r.id));
  }

  let evaluar: Aplicabilidad = SIN_EVALUAR;
  if (elegidas.length > 0) {
    const ap = await aplicabilidadDe(anioDe(mes), false, nuevaCacheCerrada());
    if (ap.respuesta) return falla(ap.respuesta);
    evaluar = ap.data.evaluar;
  }
  return listo(elegidas.map((r) => aReglaApi(r, ctx.data, base, nombres.data, evaluar)).sort(comparar));
}

/**
 * `GET /api/intercompany/vigentes?desde=&hasta=`: el contrato de M8 (el comprador no puede llamar aquí; M8 lo incluye en su respuesta).
 * Todas las reglas activas, o solo las que rigen en algún mes de `[desde, hasta]`, con `hasta_derivado`. NO evalúa `aplicable`
 * (`null`): M8 ya tiene la cerrada y usa `aplicable()` de `reglas.ts`.
 */
export async function leerVigentes(d: Db, desde: string | undefined, hasta: string | undefined): Promise<Salida<VigentesIntercompanyApi>> {
  const reglas = await leerReglasIntercompany(d);
  if (reglas.error) return fallaDb(reglas.error, "intercompany: leer las reglas");
  const ctx = await cargarContexto(d);
  if (ctx.respuesta) return falla(ctx.respuesta);
  const nombres = await nombresDeEquivalencias(d, reglas.data);
  if (nombres.respuesta) return falla(nombres.respuesta);

  const base = reglas.data.map(aBase);
  const todas = reglas.data.map((r) => aReglaApi(r, ctx.data, base, nombres.data, SIN_EVALUAR));
  const reglasApi = todas
    .filter((r) => (hasta === undefined || r.vigente_desde <= hasta) && (desde === undefined || r.hasta_derivado === null || r.hasta_derivado >= desde))
    .sort(comparar);
  const marcas = [...new Map(reglasApi.map((r) => [r.marca_id, r.marca])).entries()]
    .map(([marca_id, nombre]) => ({ marca_id, nombre }))
    .sort((a, b) => compararNombre(a.nombre, b.nombre) || (a.marca_id < b.marca_id ? -1 : 1));
  return listo({ reglas: reglasApi, marcas });
}

/** `GET /api/intercompany/aplicabilidad`: si una regla de esa marca en ese nodo sería aplicable con la cerrada de hoy (aviso previo a guardar). */
export async function leerAplicabilidad(d: Db, marcaId: string, gmlId: string, mesPedido: string | undefined): Promise<Salida<AplicabilidadApi>> {
  const ctx = await cargarContexto(d);
  if (ctx.respuesta) return falla(ctx.respuesta);
  if (!ctx.data.marcas.some((m) => m.id === marcaId)) return fallaMensaje("Marca no encontrada.", 404);
  if (!ctx.data.nodos.has(gmlId)) return fallaMensaje("Nodo género-mundo-línea no encontrado.", 404);
  const c = await leerParticipacionesCerrada(anioDe(mesPedido ?? mesActual()), nuevaCacheCerrada());
  if (c.respuesta) return falla(c.respuesta);
  const r = aplicable({ marca_id: marcaId, genero_mundo_linea_id: gmlId }, c.data ? c.data.filas : null);
  return listo({ aplicable: r.aplicable, motivo_no_aplicable: r.motivo, cerrada: c.data ? c.data.info : null });
}

// ─── Escrituras ───

export type Actor = { id: string; nombre: string | null };

/**
 * La respuesta de una escritura: la regla ya guardada con su `aplicable`. La escritura YA ocurrió, así que NUNCA falla: si no se
 * puede leer lo demás (las otras reglas, los nombres o la cerrada), devuelve la regla con lo que haya, `aplicable = null` y el
 * aviso `aplicabilidad_no_evaluada` (el `hasta_derivado` sale entonces solo con la propia regla). Se loguea el motivo.
 */
async function respuestaDeEscritura(d: Db, c: ContextoIntercompany, r: ReglaDb, cache: CacheCerrada): Promise<Salida<ReglaIntercompanyApi>> {
  const avisos: AvisoRegla[] = esMarcaSugerida(c.nombreMarca(r.marca_id)) ? [] : ["fuera_de_marcas_sugeridas"];
  const sinEvaluar = (todas: readonly ReglaBase[], nombres: ReadonlyMap<string, string>) =>
    listo(aReglaApi(r, c, todas, nombres, SIN_EVALUAR, [...avisos, "aplicabilidad_no_evaluada"]));

  const todas = await leerReglasIntercompany(d);
  if (todas.error) {
    fallaDb(todas.error, "intercompany: leer las reglas tras escribir");
    const propios = await nombresDeEquivalencias(d, [r]);
    return sinEvaluar([aBase(r)], propios.respuesta ? new Map() : propios.data);
  }
  const nombres = await nombresDeEquivalencias(d, [r, ...todas.data]);
  if (nombres.respuesta) return sinEvaluar(todas.data.map(aBase), new Map());
  const ap = await aplicabilidadDe(anioDe(mesActual()), true, cache);
  if (ap.respuesta) return sinEvaluar(todas.data.map(aBase), nombres.data);
  if (!ap.data.evaluada) return sinEvaluar(todas.data.map(aBase), nombres.data);
  return listo(aReglaApi(r, c, todas.data.map(aBase), nombres.data, ap.data.evaluar, avisos));
}

/**
 * `POST /api/intercompany/reglas`: crea una regla (`201`). Rechazos (`motivoRechazoRegla`): `404` marca, nodo o equivalencia;
 * `409` con `codigo`. Sin rango se guardan 4 y 8. El único de la base (clave + mes) cubre la carrera entre dos planners.
 */
export async function crearRegla(d: Db, cuerpo: CrearRegla, actor: Actor): Promise<Salida<ReglaIntercompanyApi>> {
  const ctx = await cargarContexto(d);
  if (ctx.respuesta) return falla(ctx.respuesta);
  const c = ctx.data;
  const reglas = await leerReglasIntercompany(d);
  if (reglas.error) return fallaDb(reglas.error, "intercompany: leer las reglas");
  let equivalencia: Awaited<ReturnType<typeof leerEquivalencia>>["data"] = null;
  if (cuerpo.equivalencia_id !== null) {
    const e = await leerEquivalencia(d, cuerpo.equivalencia_id);
    if (e.error) return fallaDb(e.error, "intercompany: leer la equivalencia");
    equivalencia = e.data;
  }

  const rechazo = motivoRechazoRegla(
    {
      marca: c.marcas.find((m) => m.id === cuerpo.marca_id),
      marcas: c.marcas,
      nodo: c.nodos.get(cuerpo.genero_mundo_linea_id),
      equivalencia_id: cuerpo.equivalencia_id,
      equivalencia: equivalencia ?? undefined,
    },
    { existentes: reglas.data.map(aBase), vigente_desde: cuerpo.vigente_desde }
  );
  if (rechazo) return fallaMensaje(rechazo.mensaje, rechazo.status, rechazo.codigo);

  const insertada = await insertarRegla(d, {
    marca_id: cuerpo.marca_id,
    genero_mundo_linea_id: cuerpo.genero_mundo_linea_id,
    equivalencia_id: cuerpo.equivalencia_id,
    vigente_desde: `${cuerpo.vigente_desde}-01`,
    cobertura_min_meses: cuerpo.imi_min ?? IMI_MIN_DEFECTO,
    cobertura_max_meses: cuerpo.imi_max ?? IMI_MAX_DEFECTO,
    pct_directo: cuerpo.pct_directo,
    nota: cuerpo.nota,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  });
  if (insertada.error || !insertada.data) {
    if (insertada.error?.code === "23505") return fallaMensaje("Ya hay una regla de esa clave desde ese mes: edítala.", 409, "clave_mes_repetido");
    return fallaDb(insertada.error as NonNullable<typeof insertada.error>, "intercompany: guardar la regla");
  }
  return respuestaDeEscritura(d, c, insertada.data, nuevaCacheCerrada());
}

/**
 * `PATCH /api/intercompany/reglas/[id]`: edita rango, porcentaje y nota. `404` si no existe; `400` `rango_invalido` si el tope
 * resultante es menor que el mínimo resultante. Sin cambios reales responde la regla tal cual y no escribe (idempotente: ni
 * `updated_at` ni quién la editó cambian).
 */
export async function editarRegla(d: Db, id: string, cuerpo: EditarRegla, actor: Actor): Promise<Salida<ReglaIntercompanyApi>> {
  const actual = await leerReglaPorId(d, id);
  if (actual.error) return fallaDb(actual.error, "intercompany: leer la regla");
  if (!actual.data) return fallaMensaje(NO_ENCONTRADA, 404);
  const r = actual.data;

  const min = cuerpo.imi_min ?? Number(r.cobertura_min_meses);
  const max = cuerpo.imi_max ?? Number(r.cobertura_max_meses);
  if (!rangoValido(min, max)) return fallaMensaje(MENSAJE_RANGO, 400, "rango_invalido");
  const pct = cuerpo.pct_directo ?? Number(r.pct_directo);
  const nota = cuerpo.nota === undefined ? r.nota : cuerpo.nota;

  const ctx = await cargarContexto(d);
  if (ctx.respuesta) return falla(ctx.respuesta);
  const cambia = min !== Number(r.cobertura_min_meses) || max !== Number(r.cobertura_max_meses) || pct !== Number(r.pct_directo) || nota !== r.nota;
  let guardada: ReglaDb = r;
  if (cambia) {
    const u = await actualizarRegla(d, id, {
      cobertura_min_meses: min,
      cobertura_max_meses: max,
      pct_directo: pct,
      nota,
      perfil_id: actor.id,
      usuario_nombre: actor.nombre,
    });
    if (u.error) return fallaDb(u.error, "intercompany: guardar la regla");
    if (!u.data) return fallaMensaje(NO_ENCONTRADA, 404);
    guardada = u.data;
  }
  return respuestaDeEscritura(d, ctx.data, guardada, nuevaCacheCerrada());
}

/**
 * `DELETE /api/intercompany/reglas/[id]`: borra la fila; la regla anterior de la misma clave exacta (si la hay) vuelve a regir desde
 * entonces. `404` si no existe (repetir el borrado también: ya no está).
 */
export async function eliminarRegla(d: Db, id: string): Promise<Salida<EliminarReglaApi>> {
  const actual = await leerReglaPorId(d, id);
  if (actual.error) return fallaDb(actual.error, "intercompany: leer la regla");
  if (!actual.data) return fallaMensaje(NO_ENCONTRADA, 404);
  const todas = await leerReglasIntercompany(d);
  if (todas.error) return fallaDb(todas.error, "intercompany: leer las reglas");
  const anterior = reglaAnterior(todas.data.map(aBase), aBase(actual.data));
  const b = await eliminarReglaDb(d, id);
  if (b.error) return fallaDb(b.error, "intercompany: eliminar la regla");
  return listo({ id, regla_anterior_id: anterior ? anterior.id : null });
}

