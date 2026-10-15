import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { error } from "@/lib/api/respuestas";
import { comoObjeto } from "@/lib/ventas/http";
import { hoyLima } from "@/lib/tiendas/estado";
import { MENSAJE_VENTA_INVALIDA } from "./agregado";
import { huellaCargas, huellaTemporada } from "./huellas";
import { leerVentaAgrupacionCacheada, TTL_CACHE_VENTA_NINO_MS } from "./cache-venta";
import {
  aPeriodoApi,
  comoRed,
  comoResultado,
  comoResumen,
  leerAgrupacionConDatos,
  leerAgrupacionesActivasBasicas,
  leerAgrupacionesDeTemporada,
  leerCargasPublicadas,
  leerCurvaVigente,
  leerFotosPorIds,
  leerParametros,
  leerPeriodos,
  leerTiendas,
  leerVentaDeEstacionalidad,
  leerVersiones,
  type CurvaFila,
} from "./consultas";
import { aObsoleta } from "./estado";
import { huellaTemporadaDe, type InsumosTrabajo } from "./trabajo";
import { hastaPorDefecto } from "./anios";
import { armarEntradaAgrupacion } from "./entrada";
import { calcularCorrida, type EntradaCorrida, type SalidaCorrida } from "./modelo";
import { PARAMETROS_POR_DEFECTO, type PeriodoAtipicoApi, type TemporadaAgrupacion } from "./tipos-api";
import type { VentaEstacionalidad } from "./agregado";
import {
  evaluarObsolescencia,
  type CorridaParaObsolescencia,
  type EstadoGlobalActual,
  type EvaluacionVigente,
} from "./obsolescencia";
import type { MotivoObsoletaApi, ObsoletaApi } from "./tipos-api";

/**
 * Lecturas compartidas de los handlers de M6 (solo servidor): evaluar la
 * obsolescencia de las curvas vigentes a partir de su foto. Devuelven
 * `{ data, respuesta }`: si `respuesta` no es nula, el handler la devuelve tal cual
 * (el error de Postgres ya viene traducido).
 */

type Db = SupabaseClient<Database>;

export type Leido<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };

const listo = <T>(data: T): Leido<T> => ({ data, respuesta: null });
const falla = (respuesta: NextResponse): Leido<never> => ({ data: null, respuesta });

/**
 * Motivos y avisos de las curvas vigentes dadas. Solo lee las fotos de esas curvas
 * SIN `resultado` (regla 52: la foto se basta con `parametros`, `red_comparable` y
 * `resumen`); el estado de hoy lo arma quien llama con lo que ya leyó. Sin curvas no lee nada.
 */
export async function leerObsolescencia(
  db: Db,
  vigentes: readonly CurvaFila[],
  actual: EstadoGlobalActual
): Promise<Leido<Map<string, EvaluacionVigente>>> {
  if (vigentes.length === 0) return listo(new Map());

  const fotos = await leerFotosPorIds(db, [...new Set(vigentes.map((v) => v.corrida_id))]);
  if (fotos.error) return falla(traducirErrorDb(fotos.error, "evaluar obsolescencia"));

  const porId = new Map<string, CorridaParaObsolescencia>(
    fotos.data.map((f) => [
      f.id,
      {
        id: f.id,
        hasta_periodo: f.hasta_periodo.slice(0, 7),
        parametros: leerParametros(f.parametros),
        red_comparable: comoRed(f.red_comparable),
        resumen: comoResumen(f.resumen),
        resultado: f.resultado === undefined ? undefined : comoResultado(f.resultado),
      },
    ])
  );

  const curvas = vigentes.map((v) => {
    const composicion = comoObjeto(comoObjeto(v.anios_utilizados)?.composicion);
    return {
      agrupacion_id: v.agrupacion_estacionalidad_id,
      corrida_id: v.corrida_id,
      modelo: v.modelo,
      composicion:
        composicion && typeof composicion.equivalencias === "number" && typeof composicion.huella === "string"
          ? { equivalencias: composicion.equivalencias, huella: composicion.huella }
          : null,
    };
  });
  return listo(evaluarObsolescencia(curvas, porId, actual));
}

/** `{ motivos }` o `null` de una agrupación. */
export function obsoletaDe(mapa: ReadonlyMap<string, { motivos: readonly MotivoObsoletaApi[] }>, agrupacionId: string): ObsoletaApi | null {
  return aObsoleta(mapa.get(agrupacionId)?.motivos);
}

/**
 * `{ error, codigo }` con el mismo `Cache-Control: no-store` que `error()`: el
 * mensaje es para la pantalla y el `codigo` (`sin_datos`, `hasta_periodo_sin_cargar`,
 * `prerrequisitos`, `datos_cambiados`, `vigente_cambiada`, `nota_requerida`…) para quien lea la respuesta cruda.
 */
export function errorConCodigo(mensaje: string, status: number, codigo: string): NextResponse {
  return NextResponse.json({ error: mensaje, codigo }, { status, headers: { "Cache-Control": "no-store" } });
}

// ─── Contexto de `calcular` y `PUT` ───

export type ContextoTrabajo = {
  insumos: InsumosTrabajo;
  /** La curva vigente de hoy (fila completa). */
  vigente: CurvaFila | null;
  /** Mayor versión ya usada (0 si no hay). */
  ultima_version: number;
  /** La venta salió de la caché de memoria (no se llamó a la función de la base). */
  cacheada: boolean;
};

/**
 * Todo lo que `calcular` y `PUT` leen, igual en los dos: la agrupación, las
 * agrupaciones de su temporada (huella de temporada), tiendas, periodos activos, la
 * curva vigente y sus versiones, y la venta de `venta_estacionalidad_agrupacion` por la
 * caché de memoria (clave: id, huella de cargas, composición y huella de temporada, que salen de
 * lecturas pequeñas). NO llama a `venta_mensual_tienda()`: la venta total por tienda sale
 * de sumar `temporadas`. `data` es `null` si la agrupación no existe (el handler responde 404).
 */
export async function leerContextoTrabajo(db: Db, id: string): Promise<Leido<ContextoTrabajo | null>> {
  const agrupacion = await leerAgrupacionConDatos(db, id);
  if (agrupacion.error) return falla(traducirErrorDb(agrupacion.error, "trabajo: leer la agrupación"));
  if (!agrupacion.data) return listo(null);
  const a = agrupacion.data;

  const [deTemporada, tiendas, periodos, vigente, versiones, cargas] = await Promise.all([
    leerAgrupacionesDeTemporada(db, a.temporada),
    leerTiendas(db),
    leerPeriodos(db, { soloActivos: true }),
    leerCurvaVigente(db, id),
    leerVersiones(db, id),
    leerCargasPublicadas(db),
  ]);
  const fallo = deTemporada.error ?? tiendas.error ?? periodos.error ?? vigente.error ?? versiones.error ?? cargas.error;
  if (fallo) return falla(traducirErrorDb(fallo, "trabajo: leer datos"));

  const venta = await leerVentaAgrupacionCacheada(
    {
      id,
      cargas_huella: huellaCargas(cargas.data),
      composicion: a.huella,
      huella_temporada: huellaTemporadaDe(a.temporada, deTemporada.data).huella,
    },
    () => leerVentaDeEstacionalidad(db, id)
  );
  if (venta.error) return falla(traducirErrorDb(venta.error, "trabajo: leer la venta"));
  if (!venta.data) return falla(error(MENSAJE_VENTA_INVALIDA, 500));

  return listo({
    insumos: {
      agrupacion: {
        id: a.id,
        nombre: a.nombre,
        codigo: a.codigo,
        activo: a.activo,
        temporada: a.temporada,
        temporada_sugerida: a.temporada_sugerida,
        generos: a.generos,
        equivalencias_activas: a.equivalencias_activas,
        huella: a.huella,
        temporadas_mezcladas: a.temporadas_mezcladas,
      },
      de_temporada: deTemporada.data,
      tiendas: tiendas.data,
      periodos: periodos.data.map(aPeriodoApi),
      venta: venta.data,
      versiones: versiones.data.length,
      hoy: hoyLima(),
    },
    vigente: vigente.data,
    ultima_version: versiones.data.reduce((m, v) => Math.max(m, v.version), 0),
    cacheada: venta.cacheada,
  });
}

// ─── Efecto del Niño a demanda (Años Niño y `/anios?con_volumen=1`) ───

export type EfectoNinoCalculado = {
  entrada: EntradaCorrida | null;
  /** `null` sin meses publicados y cerrados. */
  salida: SalidaCorrida | null;
  venta: VentaEstacionalidad;
  periodos: PeriodoAtipicoApi[];
  /** Agrupaciones activas (para el "N agrupaciones" y "Ver"). */
  activas: { id: string; nombre: string; temporada: TemporadaAgrupacion }[];
  hasta_periodo: string | null;
  /** md5 de las cargas publicadas con las que se calculó. */
  huella_cargas: string;
  /** `true` si no se llamó a la función de la base. */
  cacheada: boolean;
};

/**
 * Calcula a demanda las series por temporada (y, con `agrupacionId`, la agrupación)
 * con los parámetros POR DEFECTO y UNA lectura de `venta_estacionalidad_agrupacion`
 * (por la caché). No toca `corridas_estacionalidad`. Sin agrupación, `salida.resultado.agrupaciones`
 * va vacío y el efecto sale de las series por temporada. `data` es `null` si la agrupación
 * pedida no existe.
 */
export async function calcularEfectoNino(db: Db, agrupacionId: string | null): Promise<Leido<EfectoNinoCalculado | null>> {
  const [periodos, cargas, tiendas, activas, agrupacion] = await Promise.all([
    leerPeriodos(db, { soloActivos: true }),
    leerCargasPublicadas(db),
    leerTiendas(db),
    leerAgrupacionesActivasBasicas(db),
    agrupacionId === null ? Promise.resolve({ data: null, error: null }) : leerAgrupacionConDatos(db, agrupacionId),
  ]);
  const fallo = periodos.error ?? cargas.error ?? tiendas.error ?? activas.error ?? agrupacion.error;
  if (fallo) return falla(traducirErrorDb(fallo, "años atípicos: leer datos"));
  if (agrupacionId !== null && !agrupacion.data) return listo(null);

  const cargasHuella = huellaCargas(cargas.data);
  const venta = await leerVentaAgrupacionCacheada(
    { id: agrupacionId, cargas_huella: cargasHuella, composicion: agrupacion.data?.huella ?? "", huella_temporada: huellaTemporada(activas.data.map((x) => ({ ...x, huella: "" }))) },
    () => leerVentaDeEstacionalidad(db, agrupacionId),
    { ttl_ms: TTL_CACHE_VENTA_NINO_MS }
  );
  if (venta.error) return falla(traducirErrorDb(venta.error, "años atípicos: leer la venta"));
  if (!venta.data) return falla(error(MENSAJE_VENTA_INVALIDA, 500));

  const hasta = hastaPorDefecto(venta.data.meses_publicados, hoyLima());
  const activasPorTemporada: Partial<Record<TemporadaAgrupacion, number>> = {};
  for (const a of activas.data) activasPorTemporada[a.temporada] = (activasPorTemporada[a.temporada] ?? 0) + 1;
  const periodosApi = periodos.data.map(aPeriodoApi);
  const a = agrupacion.data;
  const entrada =
    hasta === null
      ? null
      : armarEntradaAgrupacion(
          {
            hasta_periodo: hasta,
            meses_publicados: venta.data.meses_publicados,
            venta: venta.data,
            tiendas: tiendas.data,
            periodos: periodosApi,
            agrupacion: a
              ? {
                  id: a.id,
                  temporada: a.temporada,
                  composicion: { equivalencias: a.equivalencias_activas, huella: a.huella },
                  temporada_sugerida: a.temporada_sugerida,
                  temporadas_mezcladas: a.temporadas_mezcladas,
                }
              : null,
            activas_por_temporada: activasPorTemporada,
          },
          PARAMETROS_POR_DEFECTO
        );
  return listo({
    entrada,
    salida: entrada ? calcularCorrida(entrada, PARAMETROS_POR_DEFECTO) : null,
    venta: venta.data,
    periodos: periodosApi,
    activas: activas.data,
    hasta_periodo: hasta,
    huella_cargas: huellaCargas(venta.data.cargas),
    cacheada: venta.cacheada,
  });
}
