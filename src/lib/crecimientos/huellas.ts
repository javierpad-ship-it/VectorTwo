import { createHash } from "node:crypto";

/**
 * Huellas de 06d (ficha §3, «Aprobar», paso 1). `huella_datos` es el bloqueo optimista del `POST`: la pantalla la recibe con el
 * `GET` y la devuelve al aprobar; si los datos cambiaron en medio (una carga nueva, un nodo movido de mundo, otra tienda abierta, un
 * factor del Niño, la proyección de referencia recalculada) el servidor responde `409 datos_cambiados`. md5 hexadecimal: detecta
 * cambios, no es criptografía. No depende del orden de entrada.
 */

/** Sube si cambia una fórmula de `referencias.ts` o del armado de las series (invalida todo lo calculado antes). */
export const VERSION_REFERENCIAS = 1;

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
export type FactorParaHuella = { anio: number; temporada: string; ratio_calculado: number | null; ratio_aplicado: number | null; parcial?: boolean };

/** md5 de los periodos atípicos (id, rango, estado y temporadas), ordenados. */
export function huellaPeriodosNino(periodos: readonly PeriodoParaHuella[]): string {
  return md5(
    periodos
      .map((p) => [p.id, p.desde.slice(0, 7), p.hasta.slice(0, 7), p.activo ? "1" : "0", [...(p.temporadas ?? [])].sort().join("+")].join("|"))
      .sort()
      .join("\n")
  );
}

/** md5 de los factores del Niño efectivos (año, temporada, calculado, aplicado, parcial), ordenados. */
export function huellaFactoresNino(factores: readonly FactorParaHuella[]): string {
  return md5(
    factores
      .map((f) => [f.anio, f.temporada, f.ratio_calculado ?? "", f.ratio_aplicado ?? "", f.parcial ? "1" : "0"].join("|"))
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
      p.proyeccion ? [p.proyeccion.id, p.proyeccion.calculado_at ?? "", p.proyeccion.version_metodo ?? ""].join(":") : "-",
    ].join("|")
  );
}

/** md5 de los ids de nodos (la foto de composición de un GM): sirve para comparar sin guardar la lista aparte. */
export function huellaComposicionGM(gmlIds: Iterable<string>): string {
  return md5([...gmlIds].sort().join("\n"));
}
