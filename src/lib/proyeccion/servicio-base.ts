import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { error } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { errorConCodigo } from "@/lib/curvas/lectura";
import { claveGM, crearCrecimientoDe, generosDeMatriz, type MatrizCrecimientos } from "./crecimientos";
import { leerCrecimientos, leerGenerosMundos, leerProyeccionDb, type CrecimientoDb, type ProyeccionDb } from "./consultas";
import type { InfoTienda, ContextoModelo } from "./decision";
import { aAnioApi, aFilaApi, aFilaModelo, aTiendaModelo, type Catalogo, type CrecimientoDeApi, type FilaConAnios, type TiendaPyDb } from "./persistencia";
import { CALCULO_CADUCA_MS, calculoEnCurso, type RechazoRegla } from "./reglas";
import {
  RAMPA_MADURACION,
  UMBRAL_AVANCE,
  UMBRAL_COBERTURA,
  UMBRAL_COLA_LARGA,
  UMBRAL_DISPONIBILIDAD,
  claveBaseDe,
  type BloquesApi,
  type CodigoCierreBloqueadoNino,
  type DiagnosticoFactorApi,
  type EstadoFactorY,
  type FactorApi,
  type FilaModelo,
  type MotivoDesfaseFactor,
  type SobreBase,
  type Motivo,
  type CrecimientosSinAprobarApi,
  type ParametrosProyeccion,
  type ProyeccionApi,
  type RestoUsadoApi,
  type ResumenProyeccion,
  type TiendaProyeccionApi,
} from "./tipos";
import type { FactorDb } from "./consultas";

/**
 * Piezas comunes del servicio de M7: la forma de las respuestas internas (`Salida`), la proyección a la API, los parámetros y
 * el contexto de las decisiones en vivo. Solo servidor.
 */

export type Db = SupabaseClient<Database>;
export type Salida<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };
export const listo = <T>(data: T): Salida<T> => ({ data, respuesta: null });
export const falla = (respuesta: NextResponse): Salida<never> => ({ data: null, respuesta });
export const fallaRegla = (r: RechazoRegla): Salida<never> => falla(errorConCodigo(r.mensaje, r.status, r.codigo));
export const fallaDb = (e: Parameters<typeof traducirErrorDb>[0], contexto: string): Salida<never> => falla(traducirErrorDb(e, contexto));
export const fallaMensaje = (mensaje: string, status: number, codigo?: string): Salida<never> =>
  falla(codigo ? errorConCodigo(mensaje, status, codigo) : error(mensaje, status));

export type Actor = { id: string; nombre: string | null };

export const NO_ENCONTRADA = "Proyección no encontrada.";

export const sello = () => new Date().toISOString();

/** Instante (ISO) por debajo del cual un `calculando_desde` ya caducó: lo posterior es un cálculo vivo. */
export const limiteCalculoVivo = (ahora: string): string => new Date(Date.parse(ahora) - CALCULO_CADUCA_MS).toISOString();

export const PARAMETROS_DEFECTO: ParametrosProyeccion = {
  crecimiento_pct_defecto: 0,
  umbral_avance: UMBRAL_AVANCE,
  umbral_cobertura: UMBRAL_COBERTURA,
  umbral_cola_larga: UMBRAL_COLA_LARGA,
  umbral_disponibilidad: UMBRAL_DISPONIBILIDAD,
  rampa_maduracion: [...RAMPA_MADURACION],
  factores_usados: [],
  bloques: {},
};

/** `parametros` guardados → `ParametrosProyeccion` (lo que falte toma el valor por defecto). */
export function parametrosDe(json: unknown): ParametrosProyeccion {
  const o = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Partial<ParametrosProyeccion>) : {};
  return {
    crecimiento_pct_defecto: typeof o.crecimiento_pct_defecto === "number" ? o.crecimiento_pct_defecto : PARAMETROS_DEFECTO.crecimiento_pct_defecto,
    umbral_avance: typeof o.umbral_avance === "number" ? o.umbral_avance : PARAMETROS_DEFECTO.umbral_avance,
    umbral_cobertura: typeof o.umbral_cobertura === "number" ? o.umbral_cobertura : PARAMETROS_DEFECTO.umbral_cobertura,
    umbral_cola_larga: typeof o.umbral_cola_larga === "number" ? o.umbral_cola_larga : PARAMETROS_DEFECTO.umbral_cola_larga,
    umbral_disponibilidad: typeof o.umbral_disponibilidad === "number" ? o.umbral_disponibilidad : PARAMETROS_DEFECTO.umbral_disponibilidad,
    rampa_maduracion: Array.isArray(o.rampa_maduracion) && o.rampa_maduracion.length > 0 ? o.rampa_maduracion.map(Number) : [...RAMPA_MADURACION],
    factores_usados: Array.isArray(o.factores_usados) ? o.factores_usados : [],
    bloques: o.bloques && typeof o.bloques === "object" ? (o.bloques as BloquesApi) : {},
    ...(Array.isArray(o.ediciones) && o.ediciones.length > 0 ? { ediciones: o.ediciones } : {}),
    ...(o.recalculo_pendiente ? { recalculo_pendiente: true } : {}),
    // 0.10.8 (07c): quién fijó el Resto y el objetivo global; las dos claves son opcionales y viajan en el mismo `jsonb`.
    ...(o.crecimiento_resto_meta && typeof o.crecimiento_resto_meta === "object" ? { crecimiento_resto_meta: o.crecimiento_resto_meta } : {}),
    ...(typeof o.crecimiento_objetivo_pct === "number" || o.crecimiento_objetivo_pct === null ? { crecimiento_objetivo_pct: o.crecimiento_objetivo_pct } : {}),
    // 0.12.1 (06d §2.2, B1): el Resto con que se calculó. `editarProyeccion` reescribe el `jsonb` completo desde aquí: sin esta línea, el primer
    // `PATCH` de un umbral borraría la clave y B2 volvería al Resto provisional.
    ...(o.crecimiento_resto_usado && typeof o.crecimiento_resto_usado === "object" && typeof o.crecimiento_resto_usado.pct === "number"
      ? { crecimiento_resto_usado: o.crecimiento_resto_usado }
      : {}),
  };
}

/** Último mes cerrado `k` (1 a 12) de la proyección. */
export const kDe = (p: Pick<ProyeccionDb, "hasta_periodo">): number => Number(p.hasta_periodo.slice(5, 7));

/**
 * El `resumen` sin las fotos internas: `niveles_gml` (pesa lo que un nodo por cada GML) y, desde la 0.10.8, `huella_crecimientos` y
 * `gm_gml` (el GM de cada nodo) y, desde 0.14.0, `temporada_equivalencias`. El frontend no las usa.
 */
function sinFotoInterna(r: ResumenProyeccion): ResumenProyeccion {
  const { niveles_gml: _foto, gm_gml: _gm, huella_crecimientos: _huella, temporada_equivalencias: _equivalencias, ...resto } = r;
  void _foto;
  void _gm;
  void _huella;
  void _equivalencias;
  return resto;
}

/**
 * `sinAprobar` (`0.12.1`, 06d §3.1): lo que falta aprobar para cerrar, solo de una proyección en trabajo; `undefined` = quien llama no lo midió (la
 * clave no viaja) y `null` = no falta nada.
 */
export function aProyeccionApi(
  p: ProyeccionDb,
  desactualizada: Motivo[],
  ahora: string,
  sinAprobar?: CrecimientosSinAprobarApi | null,
  /** `0.14.0` (06e): lo que impide cerrar por el Niño (solo en trabajo); `undefined` = quien llama no lo midió y `null` = nada lo impide. */
  cierreBloqueadoPor?: { codigo: CodigoCierreBloqueadoNino; mensaje: string }[] | null
): ProyeccionApi {
  const parametros = parametrosDe(p.parametros);
  return {
    id: p.id,
    anio_en_curso: p.anio_en_curso,
    anio_siguiente: p.anio_en_curso + 1,
    nombre: p.nombre,
    estado: p.estado === "cerrada" || p.estado === "archivada" ? p.estado : "en_trabajo",
    hasta_periodo: p.hasta_periodo.slice(0, 7),
    parametros,
    resumen: p.resumen === null ? null : sinFotoInterna(p.resumen as unknown as ResumenProyeccion),
    calculando: calculoEnCurso(p.calculando_desde, ahora),
    calculando_desde: p.calculando_desde,
    calculado_at: p.calculado_at,
    cerrada_at: p.cerrada_at,
    cerrada_por_nombre: p.cerrada_por_nombre,
    nota: p.nota,
    usuario_nombre: p.usuario_nombre,
    created_at: p.created_at,
    updated_at: p.updated_at,
    desactualizada,
    bloques: parametros.bloques,
    ...(sinAprobar !== undefined && p.estado === "en_trabajo" ? { crecimientos_sin_aprobar: sinAprobar } : {}),
    ...(cierreBloqueadoPor !== undefined && p.estado === "en_trabajo" ? { cierre_bloqueado_por: cierreBloqueadoPor } : {}),
  };
}

/** Lee la proyección o responde `404`. */
export async function proyeccionOr404(db: Db, id: string): Promise<Salida<ProyeccionDb>> {
  const { data, error: err } = await leerProyeccionDb(db, id);
  if (err) return fallaDb(err, "leer proyección");
  if (!data) return fallaMensaje(NO_ENCONTRADA, 404);
  return listo(data);
}

/** Lo que `aFactorApi` lee de una fila de `factores_volumen_atipico`; las columnas de 0.14.0 son opcionales (una fila sin escribir o de 0.13.x no las trae). */
type FilaFactor = Pick<FactorDb, "anio" | "temporada" | "ratio_calculado" | "ratio_aplicado" | "parcial" | "tiendas_comunes" | "meses_comparados" | "calculado_at" | "nota"> &
  Partial<Pick<FactorDb, "formula" | "ratio_volumen" | "ratio_control" | "diagnostico" | "updated_at">>;

/** `diagnostico` (jsonb) → `DiagnosticoFactorApi`; lo que no tiene la forma esperada (o `null`) es `null`. */
export function diagnosticoDe(json: Json | null | undefined): DiagnosticoFactorApi | null {
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) return null;
  const d = json as unknown as Partial<DiagnosticoFactorApi>;
  if (!Array.isArray(d.meses)) return null;
  return {
    meses: d.meses,
    ratio_fuera: typeof d.ratio_fuera === "number" ? d.ratio_fuera : null,
    meses_periodo: typeof d.meses_periodo === "number" ? d.meses_periodo : 0,
    meses_periodo_con_dato: typeof d.meses_periodo_con_dato === "number" ? d.meses_periodo_con_dato : 0,
    // El año de referencia lo escribe `sincronizarFactores` dentro del jsonb; un diagnóstico anterior no lo trae.
    ...(typeof d.anio_ref === "number" ? { anio_ref: d.anio_ref } : {}),
  };
}

/** Holgura entre `calculado_at` (reloj del servidor) y `updated_at` (reloj de la base, que escribe el trigger) para saber que la última escritura fue un «Sincronizar». */
const HOLGURA_SINCRONIZAR_MS = 60_000;

/**
 * Cuándo se escribió `ratio_aplicado`. No hay columna propia (sin migración nueva): se usa `updated_at` de la fila, pero solo si `ratio_aplicado` no es nulo y la
 * última escritura NO fue un «Sincronizar» (que escribe `calculado_at` y también mueve `updated_at`: `updated_at ≤ calculado_at + 60 s`). En ese caso la fecha real del
 * valor escrito no se conoce y es `null` (la pantalla dice «confirmado» sin día). Sin `ratio_aplicado` o sin `updated_at`, `null`.
 */
export function aplicadoAtDe(f: { ratio_aplicado: number | string | null; updated_at?: string | null; calculado_at: string | null }): string | null {
  if (f.ratio_aplicado === null || !f.updated_at) return null;
  if (f.calculado_at !== null) {
    const u = Date.parse(f.updated_at);
    const c = Date.parse(f.calculado_at);
    if (Number.isFinite(u) && Number.isFinite(c) && u - c <= HOLGURA_SINCRONIZAR_MS) return null;
  }
  return f.updated_at;
}

const numeroONulo = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export function aFactorApi(f: FilaFactor, anioObjetivo: number, estado?: { estado: EstadoFactorY; motivos_desfase: MotivoDesfaseFactor[] }): FactorApi {
  const calculado = f.ratio_calculado === null ? null : Number(f.ratio_calculado);
  const aplicado = f.ratio_aplicado === null ? null : Number(f.ratio_aplicado);
  const diagnostico = diagnosticoDe(f.diagnostico);
  return {
    anio: f.anio,
    temporada: f.temporada === "verano" ? "verano" : "invierno",
    formula: f.formula ?? null,
    ratio_volumen: numeroONulo(f.ratio_volumen),
    ratio_control: numeroONulo(f.ratio_control),
    meses_periodo: diagnostico?.meses_periodo ?? 0,
    meses_periodo_con_dato: diagnostico?.meses_periodo_con_dato ?? 0,
    diagnostico,
    ...(estado ? { estado: estado.estado, motivos_desfase: estado.motivos_desfase } : {}),
    ratio_calculado: calculado,
    ratio_aplicado: aplicado,
    ratio_efectivo: aplicado ?? calculado,
    origen: aplicado !== null ? "manual" : calculado !== null ? "calculado" : null,
    parcial: f.parcial,
    tiendas_comunes: f.tiendas_comunes,
    meses_comparados: f.meses_comparados,
    calculado_at: f.calculado_at,
    aplicado_at: aplicadoAtDe(f),
    nota: f.nota,
    objetivo: f.anio >= anioObjetivo,
  };
}

/**
 * El contexto de las decisiones en vivo (`aplicarDecision`, `aplicarDecisionTienda`, `recalcularBaseSiguiente`), armado con
 * la foto que la proyección guardó al calcular (`parametros.bloques`) y las filas ya leídas. Sin releer venta ni M4.
 */
export function contextoModelo(
  p: ProyeccionDb,
  parametros: ParametrosProyeccion,
  catalogo: Catalogo,
  tiendasRows: readonly TiendaPyDb[],
  filas: readonly FilaModelo[],
  /** `0.12.1` (06d §3.1): la FOTO de lo aplicado (`cargarMatriz`): las celdas de HOMBRE y MUJER con su versión y el Resto con que se calculó. */
  foto: FotoCrecimientos
): ContextoModelo {
  const Y = p.anio_en_curso;
  const todas = new Map<string, { codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null; venta_esperada: number | null; referente_id: string | null }>();
  for (const anio of [Y, Y + 1]) {
    const b = parametros.bloques[anio];
    if (!b) continue;
    for (const lista of [b.mismas, b.nuevas, b.cierres, b.fuera]) {
      for (const t of lista) {
        todas.set(t.tienda_id, {
          codigo: t.codigo,
          nombre: t.nombre,
          fecha_apertura: t.fecha_apertura,
          fecha_cierre: t.fecha_cierre,
          venta_esperada: t.venta_esperada ?? null,
          referente_id: t.referente_id ?? null,
        });
      }
    }
  }
  const rampaDe = (id: string): number[] | null => {
    const r = tiendasRows.find((x) => x.tienda_id === id);
    return r && Array.isArray(r.rampa) ? (r.rampa as unknown[]).map(Number) : null;
  };
  const info = new Map<string, InfoTienda>();
  for (const [id, t] of todas) {
    info.set(id, {
      codigo: t.codigo,
      nombre: t.nombre,
      fecha_apertura: t.fecha_apertura,
      fecha_cierre: t.fecha_cierre,
      venta_esperada: t.venta_esperada,
      referente_codigo: t.referente_id ? (todas.get(t.referente_id)?.codigo ?? null) : null,
      rampa: rampaDe(id),
    });
  }
  const crecimientos = new Map<string, number>();
  for (const f of filas) {
    if (f.tienda_id !== null) continue;
    const r = f.registros.find((x) => x.anio === Y + 1);
    if (r?.crecimiento_pct !== null && r?.crecimiento_pct !== undefined) crecimientos.set(f.clave, r.crecimiento_pct);
  }
  return {
    anio: Y,
    k: kDe(p),
    // 0.12.1: lleva el Resto de la FOTO (aprobado o provisional), así los respaldos de `decision.ts` usan el Resto correcto sin tocarlo.
    crecimiento_pct_defecto: foto.resto.pct,
    umbral_cola_larga: parametros.umbral_cola_larga,
    rampa_maduracion: parametros.rampa_maduracion,
    nombresCurva: new Map([...catalogo.agrupacionesEstacionalidad].map(([id, a]) => [id, a.nombre])),
    mismasSiguiente: new Set((parametros.bloques[Y + 1]?.mismas ?? []).map((t) => t.tienda_id)),
    tiendas: info,
    // 0.10.8 (07c): fila con % propio > celda GM > Resto, todo bruto. El nodo (vigente, del catálogo) da el paso de la clave base al GM.
    crecimientoDe: crearCrecimientoDe({
      matriz: foto.matriz,
      resto: foto.resto.pct,
      gmDe: (gml) => {
        const n = catalogo.nodos.get(gml);
        return n ? { genero_id: n.genero_id, mundo_id: n.mundo_id, nombre: `${n.genero} · ${n.mundo}` } : undefined;
      },
      pctFilaDe: (cb) => crecimientos.get(cb),
    }),
  };
}

/** `crecimientoDe` para las respuestas de lectura: el % efectivo de una fila base de `Y+1` con la matriz guardada y el árbol vigente. */
export function crecimientoParaApi(matriz: MatrizCrecimientos, resto: number, catalogo: Catalogo): CrecimientoDeApi {
  const f = crearCrecimientoDe({
    matriz,
    resto,
    gmDe: (gml) => {
      const n = catalogo.nodos.get(gml);
      return n ? { genero_id: n.genero_id, mundo_id: n.mundo_id, nombre: `${n.genero} · ${n.mundo}` } : undefined;
    },
  });
  return (claveBase, pctFila) => f(claveBase, pctFila);
}

/** La foto de los crecimientos de una proyección: la matriz que aplicó el último cálculo y el Resto con que se calculó. */
export type FotoCrecimientos = { matriz: MatrizCrecimientos; resto: RestoUsadoApi };

/**
 * `0.12.1` (06d §3.1): la FOTO de lo aplicado de una proyección, lista para el método. `matriz` sale de las filas de `proyeccion_crecimientos`
 * (solo los géneros de la matriz, con `crecimiento_id` y `version`); `resto` es `parametros.crecimiento_resto_usado` o, en una proyección
 * calculada antes de `0.12.1`, `crecimiento_pct_defecto` (que es justo lo que usó). Nunca lee el global: solo el cálculo lo hace.
 */
export async function cargarMatriz(db: Db, p: ProyeccionDb): Promise<Salida<FotoCrecimientos>> {
  const [celdas, catalogo] = await Promise.all([leerCrecimientos(db, p.id), leerGenerosMundos(db)]);
  if (celdas.error) return fallaDb(celdas.error, "proyección: leer la foto de los crecimientos");
  if (catalogo.error) return fallaDb(catalogo.error, "proyección: leer géneros y mundos");
  return listo(fotoDe(p, celdas.data, generosDeMatriz(catalogo.generos).map((g) => g.id)));
}

/** La foto a partir de las celdas ya leídas (sin tocar la base). */
export function fotoDe(p: Pick<ProyeccionDb, "parametros">, celdas: readonly CrecimientoDb[], generosMatriz: Iterable<string>): FotoCrecimientos {
  const generos = new Set(generosMatriz);
  const parametros = parametrosDe(p.parametros);
  const mapa = new Map<string, number>();
  const ids = new Map<string, string>();
  const versiones = new Map<string, number>();
  const sobre = new Map<string, SobreBase>();
  for (const c of celdas) {
    if (!generos.has(c.genero_id)) continue;
    const clave = claveGM(c.genero_id, c.mundo_id);
    mapa.set(clave, Number(c.pct));
    if (c.crecimiento_id) ids.set(clave, c.crecimiento_id);
    if (c.version !== null && c.version !== undefined) versiones.set(clave, c.version);
    // 06e: una foto sin `sobre_base` (escrita antes de 0.14.0) se lee `bruta`.
    sobre.set(clave, c.sobre_base === "corregida" ? "corregida" : "bruta");
  }
  const usado = parametros.crecimiento_resto_usado;
  // 06e: el Resto de una proyección calculada antes de 0.14.0 no trae `sobre_base` y se lee `bruta` (así se calculó); el de 0.14.0 lo trae explícito.
  const sobreResto: SobreBase = usado?.sobre_base === "corregida" ? "corregida" : "bruta";
  const resto: RestoUsadoApi = usado
    ? { pct: usado.pct, crecimiento_id: usado.crecimiento_id ?? null, version: usado.version ?? null, por_nombre: usado.por_nombre ?? null, at: usado.at ?? null, sobre_base: sobreResto }
    : { pct: parametros.crecimiento_pct_defecto, crecimiento_id: null, version: null, por_nombre: null, at: null, sobre_base: "bruta" };
  return { matriz: { celdas: mapa, generos, ids, versiones, sobre, resto: { id: resto.crecimiento_id, version: resto.version, sobre_base: sobreResto } }, resto };
}

/** Clave base de una fila (misma GML-AM, sin tienda). */
export const claveBaseFila = (f: Pick<FilaModelo, "clave">): string => claveBaseDe(f.clave);

// ─── Tiendas a la API ───

/**
 * `proyeccion_tiendas` + sus filas → `TiendaProyeccionApi`. El código, el nombre y el referente salen de la foto de bloques
 * que la proyección guardó al calcular (`parametros.bloques`), no de M4 hoy.
 */
export function aTiendaApi(
  row: TiendaPyDb,
  filas: readonly FilaConAnios[],
  catalogo: Catalogo,
  parametros: ParametrosProyeccion,
  p: ProyeccionDb,
  /** `0.10.7`: suma del vigente de las filas de la tienda en el año y cuántas están fijadas a mano (de `resumenFilasDeTienda`). */
  resumenFilas: { suma_filas: number | null; filas_fijadas: number } = { suma_filas: null, filas_fijadas: 0 },
  /** `0.10.8` (07d): `F` de la tienda (solo aperturas con venta esperada) para `escala`; `undefined` = no se pudo medir. */
  fraccion?: number | null
): TiendaProyeccionApi {
  const t = aTiendaModelo(row);
  const todas = new Map<string, { codigo: string; nombre: string }>();
  for (const b of Object.values(parametros.bloques)) for (const lista of [b.mismas, b.nuevas, b.cierres, b.fuera]) for (const x of lista) todas.set(x.tienda_id, { codigo: x.codigo, nombre: x.nombre });
  const info = todas.get(row.tienda_id) ?? { codigo: row.tienda_id.slice(0, 8), nombre: "Tienda" };
  const referente = t.referente_id_usado ? todas.get(t.referente_id_usado) : undefined;
  const vigente = t.decidido ?? t.propuesto;
  const avisos = [...t.avisos];
  if (t.decidido !== null && t.propuesta_al_decidir !== t.propuesto && !avisos.includes("propuesta_cambio")) avisos.push("propuesta_cambio");
  const k = kDe(p);
  return {
    tienda_id: row.tienda_id,
    codigo: info.codigo,
    nombre: info.nombre,
    bloque: t.bloque,
    subbloque: t.subbloque,
    anio: t.anio,
    fecha_usada: t.fecha_usada,
    venta_esperada: t.venta_esperada_usada,
    referente: t.referente_id_usado && referente ? { id: t.referente_id_usado, codigo: referente.codigo, nombre: referente.nombre } : null,
    origen_composicion: t.origen_composicion,
    unidades_maduras: t.unidades_maduras,
    rampa: t.rampa,
    vendido: t.vendido,
    propuesto: t.propuesto,
    metodo: t.metodo,
    referencia_alternativa: t.referencia_alternativa,
    referencia_tres_meses: t.referencia_tres_meses,
    decidido: t.decidido,
    origen: t.origen,
    propuesta_al_decidir: t.propuesta_al_decidir,
    vigente,
    explicacion: t.explicacion,
    nota: t.nota,
    pasa_a_mismas: t.anio === p.anio_en_curso && (parametros.bloques[p.anio_en_curso + 1]?.mismas ?? []).some((x) => x.tienda_id === row.tienda_id),
    filas: filas.map((f) => aFilaApi(f, catalogo, k, p.anio_en_curso)).filter((f): f is NonNullable<typeof f> => f !== null),
    avisos,
    suma_filas: resumenFilas.suma_filas,
    filas_fijadas: resumenFilas.filas_fijadas,
    escala: escalaDe(t, p, fraccion ?? null),
  };
}

/**
 * `0.10.8` (07d §4): la escala de la venta esperada de una tienda nueva (solo aperturas con `V`). `con_meses_reales`: el año de la tarjeta es `Y` y la
 * tienda ya abrió en un mes cerrado (`fecha_apertura` hasta el último mes cerrado): la cifra por venta esperada es solo referencia.
 */
export function escalaDe(t: Pick<ReturnType<typeof aTiendaModelo>, "bloque" | "subbloque" | "anio" | "venta_esperada_usada" | "fecha_usada">, p: Pick<ProyeccionDb, "anio_en_curso" | "hasta_periodo">, fraccion: number | null): TiendaProyeccionApi["escala"] {
  const V = t.venta_esperada_usada;
  // Solo las aperturas (la tienda abre en el año de la tarjeta): una tienda que ya abrió el año anterior no se explica con la fracción del año de apertura.
  if (t.bloque !== "nuevas" || t.subbloque !== "aperturas" || V === null) return null;
  return {
    venta_mensual: V,
    anio_maduro: 12 * V,
    fraccion,
    venta_anio_apertura: fraccion === null ? null : 12 * V * fraccion,
    con_meses_reales: t.anio === p.anio_en_curso && t.fecha_usada.slice(0, 7) <= p.hasta_periodo.slice(0, 7),
  };
}

export { aAnioApi, aFilaModelo };

/**
 * Nombre legible de una fila base a partir de su `clave` (`tienda|gml|equivalencia|agrupación`): «HOMBRE · URBANO · DENIM ·
 * RECONOCIDO». Lo que no esté en el catálogo se omite; si no queda nada, «Fila sin nombre».
 */
export function nombreDeFilaPorClave(clave: string, catalogo: Catalogo): {
  nombre: string;
  genero: string | null;
  mundo: string | null;
  linea: string | null;
  equivalencia: string | null;
  agrupacion_marca: string | null;
} {
  const [, gmlId = "", equivalenciaId = "", marcaId = ""] = clave.split("|");
  const nodo = catalogo.nodos.get(gmlId);
  const equivalencia = nodo && equivalenciaId ? (nodo.equivalencias.get(equivalenciaId) ?? null) : null;
  const marca = marcaId ? (catalogo.agrupacionesMarca.get(marcaId) ?? null) : null;
  const partes = [nodo?.genero ?? null, nodo?.mundo ?? null, nodo?.linea ?? null, equivalencia, marca];
  return {
    nombre: partes.filter((x): x is string => !!x).join(" · ") || "Fila sin nombre",
    genero: nodo?.genero ?? null,
    mundo: nodo?.mundo ?? null,
    linea: nodo?.linea ?? null,
    equivalencia,
    agrupacion_marca: marca,
  };
}
