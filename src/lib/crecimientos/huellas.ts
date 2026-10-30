import { createHash } from "node:crypto";

/**
 * Huellas de 06d (ficha §3, «Aprobar», paso 1). `huella_datos` es el bloqueo optimista del `POST`: la pantalla la recibe con el
 * `GET` y la devuelve al aprobar; si los datos cambiaron en medio (una carga nueva, un nodo movido de mundo, otra tienda abierta, un
 * factor del Niño, la proyección de referencia recalculada) el servidor responde `409 datos_cambiados`. md5 hexadecimal: detecta
 * cambios, no es criptografía. No depende del orden de entrada.
 */

/**
 * Sube si cambia una fórmula de `referencias.ts` o del armado de las series (invalida todo lo calculado antes). `2` (`0.14.0`, 06e): cierre por
 * curva, base corregida del Niño, factor relativo y `sobre_base`.
 */
export const VERSION_REFERENCIAS = 2;

const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");

/** Las tres marcas de tiempo del árbol que entran en la clave de la caché y en la huella (M1). */
export type MarcasArbol = {
  /** `max(updated_at)` de `genero_mundo_linea`. */
  nodos: string;
  /** `max(updated_at)` de `equivalencias`. */
  equivalencias: string;
  /** `max(updated_at)` de `agrupaciones_estacionalidad`. */
  agrupaciones: string;
};

export type PeriodoParaHuella = { id: string; desde: string; hasta: string; activo: boolean; temporadas?: readonly string[] | null };
/** Un factor del Niño para la huella. Las columnas de `0.14.0` (06e §2.3) son opcionales: una fila de `0.13.x` las trae `null`. */
export type FactorParaHuella = {
  anio: number;
  temporada: string;
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
  parcial?: boolean;
  formula?: string | null;
  ratio_volumen?: number | null;
  ratio_control?: number | null;
  huella_cargas?: string | null;
  huella_composicion?: string | null;
  aplicado_huella?: string | null;
};

/** md5 de las curvas vigentes (id y versión de cada una, ordenadas): cambiar la curva de una agrupación mueve el cierre por curva (R21). */
export function huellaCurvasVigentes(curvas: readonly { id: string; version: number; agrupacion_id: string }[]): string {
  return md5(
    curvas
      .map((c) => [c.agrupacion_id, c.id, c.version].join("|"))
      .sort()
      .join("\n")
  );
}

/** md5 de los ids de las tiendas de `M(Y+1)`, ordenados: una tienda que entra o sale de la base cambia la base por curva (R21). */
export function huellaTiendasSiguiente(ids: Iterable<string>): string {
  return md5([...ids].sort().join("\n"));
}

/** md5 de los periodos atípicos (id, rango, estado y temporadas), ordenados. */
export function huellaPeriodosNino(periodos: readonly PeriodoParaHuella[]): string {
  return md5(
    periodos
      .map((p) => [p.id, p.desde.slice(0, 7), p.hasta.slice(0, 7), p.activo ? "1" : "0", [...(p.temporadas ?? [])].sort().join("+")].join("|"))
      .sort()
      .join("\n")
  );
}

/** md5 de los factores del Niño (año, temporada, calculado, aplicado, parcial y las columnas de `0.14.0`), ordenados. */
export function huellaFactoresNino(factores: readonly FactorParaHuella[]): string {
  return md5(
    factores
      .map((f) =>
        [
          f.anio,
          f.temporada,
          f.ratio_calculado ?? "",
          f.ratio_aplicado ?? "",
          f.parcial ? "1" : "0",
          f.formula ?? "",
          f.ratio_volumen ?? "",
          f.ratio_control ?? "",
          f.huella_cargas ?? "",
          f.huella_composicion ?? "",
          f.aplicado_huella ?? "",
        ].join("|")
      )
      .sort()
      .join("\n")
  );
}

export type PartesHuellaDatos = {
  /** Año de aplicación (`Y+1`). */
  anio: number;
  /** `huellaCargas` de los meses publicados. */
  cargas_huella: string;
  marcas: MarcasArbol;
  /** `huellaRed` del maestro de tiendas. */
  red_huella: string;
  periodos_huella: string;
  factores_huella: string;
  /** 06e: `huellaCurvasVigentes` de las curvas vigentes de las agrupaciones. */
  curvas_huella: string;
  /** 06e: `huellaTiendasSiguiente` de `M(Y+1)`. */
  tiendas_siguiente_huella: string;
  /** La proyección de referencia elegida (id, `calculado_at` y método) o `null`. */
  proyeccion: { id: string; calculado_at: string | null; version_metodo: number | null } | null;
};

/** md5 de todo lo que cambia una cifra de la pantalla. */
export function huellaDatosGM(p: PartesHuellaDatos): string {
  return md5(
    [
      VERSION_REFERENCIAS,
      p.anio,
      p.cargas_huella,
      p.marcas.nodos,
      p.marcas.equivalencias,
      p.marcas.agrupaciones,
      p.red_huella,
      p.periodos_huella,
      p.factores_huella,
      p.curvas_huella,
      p.tiendas_siguiente_huella,
      p.proyeccion ? [p.proyeccion.id, p.proyeccion.calculado_at ?? "", p.proyeccion.version_metodo ?? ""].join(":") : "-",
    ].join("|")
  );
}

/** md5 de los ids de nodos (la foto de composición de un GM): sirve para comparar sin guardar la lista aparte. */
export function huellaComposicionGM(gmlIds: Iterable<string>): string {
  return md5([...gmlIds].sort().join("\n"));
}
