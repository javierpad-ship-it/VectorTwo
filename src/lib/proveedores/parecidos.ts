import { aCodigo } from "@/lib/arbol/normalizar";
import { similitud } from "@/lib/ventas/sugerir-mapeo";
import { MAX_PARECIDOS, UMBRAL_PARECIDO_PROVEEDOR } from "./constantes";
import type { ParecidoProveedorApi } from "./tipos-api";

/**
 * Parecido entre nombres de proveedor (08c, §3.2, R12). Puro. Se compara el NOMBRE LIMPIO: `aCodigo` (sin tildes ni signos) y, desde el
 * final, sin las palabras de razón social o de giro. «Textil Delta» frente a «Textiles Delta Ltd.» da 0,83 limpio (0,71 crudo).
 */

/** Palabras que cierran un nombre sin identificar a la empresa (ya en forma de código: `S.A.C.` → `S_A_C`). */
export const PALABRAS_RAZON_SOCIAL: ReadonlySet<string> = new Set([
  "LTD",
  "LIMITED",
  "CO",
  "CORP",
  "INC",
  "LLC",
  "SA",
  "S_A",
  "SAC",
  "S_A_C",
  "SRL",
  "S_R_L",
  "EIRL",
  "SAA",
  "GMBH",
  "TRADING",
  "COMPANY",
  "IMPORT",
  "EXPORT",
]);

const MAX_PALABRAS_SUFIJO = 3;

/** El nombre sin razón social: «Textiles Delta Ltd.» → `TEXTILES_DELTA`. Si no quedara nada, el código completo. */
export function nombreLimpio(nombre: string): string {
  const codigo = aCodigo(nombre);
  const palabras = codigo === "" ? [] : codigo.split("_");
  let fin = palabras.length;
  let quitoAlgo = true;
  while (quitoAlgo && fin > 1) {
    quitoAlgo = false;
    for (let k = Math.min(MAX_PALABRAS_SUFIJO, fin - 1); k >= 1; k -= 1) {
      if (PALABRAS_RAZON_SOCIAL.has(palabras.slice(fin - k, fin).join("_"))) {
        fin -= k;
        quitoAlgo = true;
        break;
      }
    }
  }
  return palabras.slice(0, fin).join("_");
}

export type ProveedorParaParecido = { id: string; nombre: string; activo: boolean };

/**
 * Hasta tres proveedores ACTIVOS con un nombre parecido, de mayor a menor similitud. `propioId` excluye al propio proveedor al editarlo.
 * Quien llama decide antes si el nombre está repetido (`nombre_repetido`): esto solo avisa de los que se le parecen.
 */
export function buscarParecidos(nombre: string, existentes: readonly ProveedorParaParecido[], propioId?: string): ParecidoProveedorApi[] {
  const limpio = nombreLimpio(nombre);
  if (limpio === "") return [];
  const hallados: ParecidoProveedorApi[] = [];
  for (const p of existentes) {
    if (!p.activo || p.id === propioId) continue;
    const otro = nombreLimpio(p.nombre);
    if (otro === "") continue;
    if (otro === limpio) {
      hallados.push({ id: p.id, nombre: p.nombre, similitud: 1, motivo: "misma_razon_social" });
      continue;
    }
    const s = similitud(limpio, otro);
    if (s >= UMBRAL_PARECIDO_PROVEEDOR) hallados.push({ id: p.id, nombre: p.nombre, similitud: s, motivo: "similar" });
  }
  hallados.sort((a, b) => b.similitud - a.similitud || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
  return hallados.slice(0, MAX_PARECIDOS);
}
