import { createHash } from "node:crypto";
import type { Mes } from "@/lib/compras/tipos";
import { VERSION_METODO_FLUJO, type HuellaBaseJson } from "./tipos";

/**
 * Huellas del flujo de M8 (ficha 08, §0.6 y regla 8 y 24). `huellaCalculoFlujo` (la de M8) NO es `huellaFlujo` de M12, que es la de
 * la configuración de marcas. sha-256 hexadecimal sobre un JSON canónico (claves ordenadas): el mismo contenido da siempre la misma
 * huella. Es más sensible que necesario, nunca menos. Pura salvo por `node:crypto`.
 */

/** JSON con las claves de cada objeto ordenadas, para que el orden de las claves no cambie la huella. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor === undefined ? null : valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  const objeto = valor as Record<string, unknown>;
  return `{${Object.keys(objeto)
    .sort()
    .filter((k) => objeto[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(objeto[k])}`)
    .join(",")}}`;
}

const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** `sha(flujo_huella_base() + mes de hoy en Lima + VERSION_METODO_FLUJO)`: la clave del resultado completo del cálculo. */
export function huellaCalculoFlujo(huellaBase: HuellaBaseJson, mesLima: Mes): string {
  return sha(jsonCanonico({ base: huellaBase, mes_lima: mesLima, version: VERSION_METODO_FLUJO }));
}

/**
 * Una huella por cada lectura que el servicio cachea (§0.6): al cambiar una sola parte (p. ej. una compra nueva) solo se releen esas
 * lecturas y se recalcula; el resto sale de la caché. `cargas` incluye todas las cargas publicadas (publicar un mes cambia solo esa).
 */
export type ClavesCache = {
  cerradas: string;
  cargas: string;
  compras: string;
  parametros: string;
  repartos: string;
  reglas: string;
  config: string;
  /**
   * Lo que `stock_flujo` lee ADEMÁS de la carga: `tiendas` (`activo` y `tipo` deciden CD / tiendas / inactivas) y `marcas` (la
   * pertenencia a conjuntos, `marcas_unidad`). Una carga publicada no cambia, pero su agregación sí con estas dos tablas.
   */
  stock: string;
};

export function clavesCache(huellaBase: HuellaBaseJson): ClavesCache {
  return {
    cerradas: sha(jsonCanonico(huellaBase.cerradas)),
    cargas: sha(jsonCanonico(huellaBase.cargas)),
    compras: sha(jsonCanonico(huellaBase.compras)),
    parametros: sha(jsonCanonico(huellaBase.parametros)),
    repartos: sha(jsonCanonico(huellaBase.repartos)),
    reglas: sha(jsonCanonico(huellaBase.reglas)),
    config: sha(jsonCanonico(huellaBase.config)),
    stock: sha(jsonCanonico({ tiendas: huellaBase.config.tiendas, marcas: huellaBase.config.marcas })),
  };
}
