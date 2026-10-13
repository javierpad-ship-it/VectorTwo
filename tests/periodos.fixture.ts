import { listarMeses } from "@/lib/ventas/periodo";
import type { PeriodoParaClase } from "@/lib/curvas/atipicos";

/** Fixtures sintéticos de M6 paso 1 (nada real de Lukers). */

export const periodoFx = (
  id: string,
  desde: string,
  hasta: string,
  extra: Partial<Pick<PeriodoParaClase, "alcance" | "activo" | "motivo">> = {}
): PeriodoParaClase => ({
  id,
  desde,
  hasta,
  motivo: extra.motivo ?? `Periodo ${id}`,
  alcance: extra.alcance ?? "invierno",
  activo: extra.activo ?? true,
});

/** El Niño de la ficha: 2023-03 a 2023-05, alcance invierno. */
export const NINO_2023 = periodoFx("nino-2023", "2023-03", "2023-05", { motivo: "Niño costero 2023" });

/** Meses publicados de 2023-01 a 2026-09 (45 meses), como en los ejemplos de la ficha. */
export const PUBLICADOS_2023_2026_09 = listarMeses("2023-01", "2026-09");

export const ABRIGO = { temporada: "invierno" } as const;
export const VERANO = { temporada: "verano" } as const;
export const TODO_EL_ANO = { temporada: "todo_el_ano" } as const;
