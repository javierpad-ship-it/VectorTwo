import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { error } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { errorConCodigo } from "@/lib/curvas/lectura";
import { leerProyeccionDb, type ProyeccionDb } from "./consultas";
import type { InfoTienda, ContextoModelo } from "./decision";
import { aAnioApi, aFilaApi, aFilaModelo, aTiendaModelo, type Catalogo, type FilaConAnios, type TiendaPyDb } from "./persistencia";
import { CALCULO_CADUCA_MS, calculoEnCurso, type RechazoRegla } from "./reglas";
import {
  RAMPA_MADURACION,
  UMBRAL_AVANCE,
  UMBRAL_COBERTURA,
  UMBRAL_COLA_LARGA,
  claveBaseDe,
  type BloquesApi,
  type FactorApi,
  type FilaModelo,
  type Motivo,
  type ParametrosProyeccion,
  type ProyeccionApi,
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
    rampa_maduracion: Array.isArray(o.rampa_maduracion) && o.rampa_maduracion.length > 0 ? o.rampa_maduracion.map(Number) : [...RAMPA_MADURACION],
    factores_usados: Array.isArray(o.factores_usados) ? o.factores_usados : [],
    bloques: o.bloques && typeof o.bloques === "object" ? (o.bloques as BloquesApi) : {},
    ...(o.recalculo_pendiente ? { recalculo_pendiente: true } : {}),
  };
}

/** Último mes cerrado `k` (1 a 12) de la proyección. */
export const kDe = (p: Pick<ProyeccionDb, "hasta_periodo">): number => Number(p.hasta_periodo.slice(5, 7));

/** El `resumen` sin la foto interna de niveles (pesa lo que un nodo por cada GML y el frontend no la usa). */
function sinFotoInterna(r: ResumenProyeccion): ResumenProyeccion {
  const { niveles_gml: _foto, ...resto } = r;
  void _foto;
  return resto;
}

export function aProyeccionApi(p: ProyeccionDb, desactualizada: Motivo[], ahora: string): ProyeccionApi {
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
  };
}

/** Lee la proyección o responde `404`. */
export async function proyeccionOr404(db: Db, id: string): Promise<Salida<ProyeccionDb>> {
  const { data, error: err } = await leerProyeccionDb(db, id);
  if (err) return fallaDb(err, "leer proyección");
  if (!data) return fallaMensaje(NO_ENCONTRADA, 404);
  return listo(data);
}

export function aFactorApi(f: Pick<FactorDb, "anio" | "temporada" | "ratio_calculado" | "ratio_aplicado" | "parcial" | "tiendas_comunes" | "meses_comparados" | "calculado_at" | "nota">, anioObjetivo: number): FactorApi {
  const calculado = f.ratio_calculado === null ? null : Number(f.ratio_calculado);
  const aplicado = f.ratio_aplicado === null ? null : Number(f.ratio_aplicado);
  return {
    anio: f.anio,
    temporada: f.temporada === "verano" ? "verano" : "invierno",
    ratio_calculado: calculado,
    ratio_aplicado: aplicado,
    ratio_efectivo: aplicado ?? calculado,
    origen: aplicado !== null ? "manual" : calculado !== null ? "calculado" : null,
    parcial: f.parcial,
    tiendas_comunes: f.tiendas_comunes,
    meses_comparados: f.meses_comparados,
    calculado_at: f.calculado_at,
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
  filas: readonly FilaModelo[]
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
    crecimiento_pct_defecto: parametros.crecimiento_pct_defecto,
    umbral_cola_larga: parametros.umbral_cola_larga,
    rampa_maduracion: parametros.rampa_maduracion,
    nombresCurva: new Map([...catalogo.agrupacionesEstacionalidad].map(([id, a]) => [id, a.nombre])),
    mismasSiguiente: new Set((parametros.bloques[Y + 1]?.mismas ?? []).map((t) => t.tienda_id)),
    tiendas: info,
    crecimientoDe: (cb) => crecimientos.get(cb) ?? parametros.crecimiento_pct_defecto,
  };
}

/** Clave base de una fila (misma GML-AM, sin tienda). */
export const claveBaseFila = (f: Pick<FilaModelo, "clave">): string => claveBaseDe(f.clave);

// ─── Tiendas a la API ───

/**
 * `proyeccion_tiendas` + sus filas → `TiendaProyeccionApi`. El código, el nombre y el referente salen de la foto de bloques
 * que la proyección guardó al calcular (`parametros.bloques`), no de M4 hoy.
 */
export function aTiendaApi(row: TiendaPyDb, filas: readonly FilaConAnios[], catalogo: Catalogo, parametros: ParametrosProyeccion, p: ProyeccionDb): TiendaProyeccionApi {
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
