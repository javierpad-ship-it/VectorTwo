import { createHash } from "node:crypto";
import { canonico, type ValorCanonico } from "./canonico";

/**
 * Huellas de la propuesta con IA (ficha 07e, §5.3; R12). Puras (sha-256 hexadecimal de `canonico`). Ninguna lleva ids ni datos
 * fuera de lo que ya se guarda en `ia_entradas`.
 */

export const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");

/** Huella de una entrada: sha-256 de `canonico(contenido)`. */
export const huellaEntrada = (contenido: ValorCanonico): string => sha256(canonico(contenido));

/** Huella de una llamada: `{ version_prompt, modelo, bloque, sufijo }`. */
export function huellaLlamada(args: { version_prompt: string; modelo: string; bloque: ValorCanonico; sufijo: ValorCanonico }): string {
  return huellaEntrada({ version_prompt: args.version_prompt, modelo: args.modelo, bloque: args.bloque, sufijo: args.sufijo });
}

export type MetaParaHuella = { pct: number; sobre: "corregida" | "bruta"; total: number; fijas: number; libre: number; provisional: boolean };

/** Huella de un GM: la clave del reuso. Se calcula en el primer paso, antes de llamar. */
export function huellaGM(args: { version_prompt: string; modelo: string; bloques: readonly string[]; meta: MetaParaHuella | null }): string {
  return huellaEntrada({
    version_prompt: args.version_prompt,
    modelo: args.modelo,
    bloques: [...args.bloques],
    meta: args.meta === null ? null : { pct: args.meta.pct, sobre: args.meta.sobre, total: args.meta.total, fijas: args.meta.fijas, libre: args.meta.libre, provisional: args.meta.provisional },
  });
}

export type FilaParaHuellaHistoria = {
  clave: string;
  /** `historico.anios[]`: por año, los meses con sus unidades y si son atípicos. */
  anios: readonly { anio: number; meses: readonly { periodo: string; unidades: number; atipico: boolean }[] }[];
  /** `vendido` de la fila en el año en curso. */
  vendido_y: number;
  avance_y: number | null;
  curva_origen: readonly { agrupacion_id: string; curva_id: string; version: number; peso: number }[];
  /** `factores_mes[Y]`: doce factores del año en curso, o `null`. */
  factores_mes_y: readonly number[] | null;
};

/**
 * Huella de la historia de un GM (revisión, bloqueante B1): las filas base ACTIVAS ordenadas por `clave`, con su historia, el vendido
 * y el avance del año en curso, `curva_origen`, `factores_mes[Y]` y el conjunto de claves. No recibe (ni lee) el estado de las filas:
 * decidir, aceptar la IA, poner un % propio o pasar una fila de libre a fija no la cambian.
 */
export function huellaHistoria(filas: readonly FilaParaHuellaHistoria[]): string {
  const ordenadas = [...filas].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  return huellaEntrada({
    filas: ordenadas.map((f) => ({
      clave: f.clave,
      anios: [...f.anios]
        .sort((a, b) => a.anio - b.anio)
        .map((a) => ({ anio: a.anio, meses: a.meses.map((m) => ({ p: m.periodo, u: m.unidades, a: m.atipico })) })),
      vendido_y: f.vendido_y,
      avance_y: f.avance_y,
      curva_origen: f.curva_origen.map((c) => ({ a: c.agrupacion_id, c: c.curva_id, v: c.version, p: c.peso })),
      factores_mes_y: f.factores_mes_y === null ? null : [...f.factores_mes_y],
    })),
  });
}
