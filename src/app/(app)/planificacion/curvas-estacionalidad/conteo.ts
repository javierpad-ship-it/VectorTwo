import { temporadaDistinta, type AgrupacionConTemporada } from "./tipos";

export type ConteoAgrupaciones = {
  /** Activas: el conjunto sobre el que se cuentan todos los demás números. */
  activas: number;
  invierno: number;
  verano: number;
  todo_el_ano: number;
  /** Activas cuya temporada difiere de la sugerida (aviso `temporada_sugerida_distinta`). */
  distinta: number;
  /** Inactivas: no entran en ningún otro conteo (la tabla las muestra al final, atenuadas). */
  inactivas: number;
};

/** Conteos de la pestaña Curvas, todos sobre las agrupaciones activas; las inactivas van aparte. */
export function contarAgrupaciones(agrupaciones: readonly AgrupacionConTemporada[]): ConteoAgrupaciones {
  const c: ConteoAgrupaciones = { activas: 0, invierno: 0, verano: 0, todo_el_ano: 0, distinta: 0, inactivas: 0 };
  for (const a of agrupaciones) {
    if (!a.activo) {
      c.inactivas++;
      continue;
    }
    c.activas++;
    if (a.temporada === "invierno" || a.temporada === "verano" || a.temporada === "todo_el_ano") c[a.temporada]++;
    if (temporadaDistinta(a)) c.distinta++;
  }
  return c;
}
