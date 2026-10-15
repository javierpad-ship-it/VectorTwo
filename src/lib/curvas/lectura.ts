import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { error } from "@/lib/api/respuestas";
import { comoObjeto } from "@/lib/ventas/http";
import { hoyLima } from "@/lib/tiendas/estado";
import { hastaPorDefecto } from "./anios";
import {
  aCorridaResumen,
  comoEfecto,
  comoRed,
  comoResultado,
  comoResumen,
  leerCargasPublicadas,
  leerCorridaPorId,
  leerCorridaReferencia,
  leerCorridasPorIds,
  leerParametros,
  leerTiendas,
  leerUltimaCorrida,
  leerVentaMensualTienda,
  type AgrupacionConDatos,
  type CorridaFila,
  type CurvaFila,
} from "./consultas";
import { aObsoleta, type CorridaVista } from "./estado";
import { evaluarObsolescencia, type CorridaParaObsolescencia, type EstadoGlobalActual } from "./obsolescencia";
import type { PeriodoParaClase } from "./atipicos";
import type { MotivoObsoletaApi, ObsoletaApi } from "./tipos-api";
import { CORRIDA_NO_ENCONTRADA } from "./esquemas";

/**
 * Lecturas compartidas de los handlers de M6 (solo servidor): resolver la
 * corrida que se está viendo y evaluar la obsolescencia de las curvas vigentes.
 * Devuelven `{ data, respuesta }`: si `respuesta` no es nula, el handler la
 * devuelve tal cual (el error de Postgres ya viene traducido).
 */

type Db = SupabaseClient<Database>;

export type Leido<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };

const listo = <T>(data: T): Leido<T> => ({ data, respuesta: null });
const falla = (respuesta: NextResponse): Leido<never> => ({ data: null, respuesta });

/**
 * La corrida pedida por id (`404` si no existe) o, sin id, la de referencia;
 * con `ultimaSiNoHayReferencia` (la pantalla de Curvas), la última si ninguna
 * está marcada. `data` es `null` si no hay corrida que mostrar.
 */
export async function resolverCorrida(
  db: Db,
  corridaId: string | null,
  opciones: { ultimaSiNoHayReferencia: boolean }
): Promise<Leido<CorridaFila | null>> {
  if (corridaId !== null) {
    const { data, error: err } = await leerCorridaPorId(db, corridaId);
    if (err) return falla(traducirErrorDb(err, "leer corrida"));
    if (!data) return falla(error(CORRIDA_NO_ENCONTRADA, 404));
    return listo(data);
  }
  const ref = await leerCorridaReferencia(db);
  if (ref.error) return falla(traducirErrorDb(ref.error, "leer corrida de referencia"));
  if (ref.data || !opciones.ultimaSiNoHayReferencia) return listo(ref.data);
  const ultima = await leerUltimaCorrida(db);
  if (ultima.error) return falla(traducirErrorDb(ultima.error, "leer última corrida"));
  return listo(ultima.data);
}

export function aCorridaVista(fila: CorridaFila): CorridaVista {
  return {
    resumen: aCorridaResumen(fila),
    resultado: comoResultado(fila.resultado),
    efecto_atipico: comoEfecto(fila.efecto_atipico),
  };
}

/**
 * Motivos de obsolescencia de las curvas vigentes dadas. Solo lee (tiendas, venta
 * por tienda, cargas, corridas de esas curvas): nunca la vista materializada.
 * Sin curvas no lee nada.
 */
export async function leerObsolescencia(
  db: Db,
  vigentes: readonly CurvaFila[],
  agrupaciones: readonly AgrupacionConDatos[],
  periodosActivos: readonly PeriodoParaClase[]
): Promise<Leido<Map<string, MotivoObsoletaApi[]>>> {
  if (vigentes.length === 0) return listo(new Map());

  const idsCorrida = [...new Set(vigentes.map((v) => v.corrida_id))];
  const [corridas, tiendas, venta, cargas] = await Promise.all([
    leerCorridasPorIds(db, idsCorrida),
    leerTiendas(db),
    leerVentaMensualTienda(db),
    leerCargasPublicadas(db),
  ]);
  const fallo = corridas.error ?? tiendas.error ?? venta.error ?? cargas.error;
  if (fallo) return falla(traducirErrorDb(fallo, "evaluar obsolescencia"));

  const corridasPorId = new Map<string, CorridaParaObsolescencia>(
    corridas.data.map((c) => [
      c.id,
      {
        id: c.id,
        hasta_periodo: c.hasta_periodo.slice(0, 7),
        parametros: leerParametros(c.parametros),
        red_comparable: comoRed(c.red_comparable),
        cargas: comoResumen(c.resumen).cargas ?? {},
        resultado: comoResultado(c.resultado),
      },
    ])
  );

  const actual: EstadoGlobalActual = {
    tiendas: tiendas.data,
    venta: venta.data,
    cargas: cargas.data,
    periodos: periodosActivos,
    agrupaciones: new Map(agrupaciones.map((a) => [a.id, { temporada: a.temporada, equivalencias: a.equivalencias_activas, huella: a.huella }])),
    hasta_actual: hastaPorDefecto(Object.keys(cargas.data), hoyLima()),
  };

  const curvas = vigentes.map((v) => {
    const composicion = comoObjeto(comoObjeto(v.anios_utilizados)?.composicion);
    return {
      agrupacion_id: v.agrupacion_estacionalidad_id,
      corrida_id: v.corrida_id,
      composicion:
        composicion && typeof composicion.equivalencias === "number" && typeof composicion.huella === "string"
          ? { equivalencias: composicion.equivalencias, huella: composicion.huella }
          : null,
    };
  });
  return listo(evaluarObsolescencia(curvas, corridasPorId, actual));
}

/** `{ motivos }` o `null` de una agrupación. */
export function obsoletaDe(mapa: ReadonlyMap<string, readonly MotivoObsoletaApi[]>, agrupacionId: string): ObsoletaApi | null {
  return aObsoleta(mapa.get(agrupacionId));
}

/**
 * `{ error, codigo }` con el mismo `Cache-Control: no-store` que `error()`: el
 * mensaje es para la pantalla y el `codigo` (`sin_datos`, `hasta_periodo_sin_cargar`,
 * `calculo_en_curso`, `candidata_no_disponible`, `sin_cambio`…) para quien lea la respuesta cruda.
 */
export function errorConCodigo(mensaje: string, status: number, codigo: string): NextResponse {
  return NextResponse.json({ error: mensaje, codigo }, { status, headers: { "Cache-Control": "no-store" } });
}
