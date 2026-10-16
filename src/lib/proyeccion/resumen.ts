import { pendienteDeRevision } from "./cola-larga";
import type { AvisoFila, ResumenProyeccion, Subbloque } from "./tipos-api";

/**
 * Conteos y totales del `resumen` de una proyección (ficha 07, tabla `proyecciones.resumen`). Puro. Se calculan al calcular y se
 * REFRESCAN cada vez que cambia una decisión (`decididas`, `filas_para_revision`, `totales` y `avisos` son un reflejo de lo
 * guardado, no una foto del momento de calcular).
 */

export type FilaParaResumen = {
  clave: string;
  tienda_id: string | null;
  registros: readonly {
    anio: number;
    bloque: "mismas" | "nuevas" | "cierres";
    subbloque: Subbloque | null;
    vigente: number | null;
    decidido: number | null;
    avisos: readonly AvisoFila[];
  }[];
};

export type ConteosResumen = Pick<ResumenProyeccion, "filas_por_anio" | "decididas" | "totales" | "avisos"> & { filas_para_revision: number };

export function conteosResumen(filas: readonly FilaParaResumen[], anio: number): ConteosResumen {
  const filasPorAnio: Record<number, number> = { [anio]: 0, [anio + 1]: 0 };
  const decididas: Record<number, number> = { [anio]: 0, [anio + 1]: 0 };
  const totales: ResumenProyeccion["totales"] = {
    [anio]: { mismas: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0 },
    [anio + 1]: { mismas: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0 },
  };
  const avisos: ResumenProyeccion["avisos"] = {};
  const paraRevision = new Set<string>();
  for (const f of filas) {
    for (const r of f.registros) {
      const t = totales[r.anio];
      if (!t) continue;
      const v = r.vigente ?? 0;
      if (r.bloque === "mismas") t.mismas += v;
      else if (r.bloque === "cierres") t.cierres += v;
      else if (r.subbloque === "nuevas_anterior") t.nuevas_anterior += v;
      else t.aperturas += v;
      t.total += v;
      if (f.tienda_id === null) {
        filasPorAnio[r.anio] += 1;
        if (r.decidido !== null) decididas[r.anio] += 1;
      }
      for (const a of r.avisos) avisos[a] = (avisos[a] ?? 0) + 1;
      if (f.tienda_id === null && pendienteDeRevision(r)) paraRevision.add(f.clave);
    }
  }
  return { filas_por_anio: filasPorAnio, decididas, totales, avisos, filas_para_revision: paraRevision.size };
}
