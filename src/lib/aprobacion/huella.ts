import { createHash } from "node:crypto";
import { canonico, type ValorCanonico } from "@/lib/ia/canonico";
import type { LoteCuerpo } from "./esquemas";
import type { EfectoGMApi, ResultadoFilaLoteApi } from "./tipos-api";

/**
 * Huellas de la aprobación en bloque (ficha 07g, D8, D10 y R22). SOLO SERVIDOR: usan `node:crypto` (sha-256 hexadecimal de `canonico`, el JSON de claves
 * ordenadas de `ia/canonico`). Viven aparte de `tipos-api.ts`, `esquemas.ts` y `reglas.ts`, que sí importa la pantalla. La pantalla nunca las calcula: recibe
 * `huella_simulacion` del `POST` simulado y la devuelve tal cual al aplicar; el servidor la recalcula con la misma función y compara.
 */

const sha256 = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");

const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Un número no finito no tiene representación canónica: se guarda como `null` (no debería ocurrir; el efecto ya devuelve `null` en esos casos). */
const num = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : x);

/**
 * D8. Huella del resultado simulado: sha-256 canónico de `{ filas, efecto_gm }`, ordenados (filas por `gm_clave`, `fila_id`, `anio`; efecto por `gm_clave`), de
 * modo que no depende del orden en que se calcularon. Es lo que el planner revisó: si al aplicar el servidor obtiene otro resultado, responde
 * `409 simulacion_distinta` sin escribir. No entran el lote, `repetido`, `simulado` ni nada derivado (las 10 mayores, los totales).
 */
export function huellaSimulacion(a: { filas: readonly ResultadoFilaLoteApi[]; efecto_gm: readonly EfectoGMApi[] }): string {
  const filas = [...a.filas]
    .sort((x, y) => porTexto(x.gm_clave, y.gm_clave) || porTexto(x.fila_id, y.fila_id) || x.anio - y.anio)
    .map(
      (f): ValorCanonico => ({
        fila_id: f.fila_id,
        anio: f.anio,
        gm_clave: f.gm_clave,
        fuente: f.fuente,
        resultado: f.resultado,
        codigo: f.codigo,
        valor: num(f.valor),
        valor_actual: num(f.valor_actual),
        brecha_u: num(f.brecha_u),
      })
    );
  const efecto = [...a.efecto_gm]
    .sort((x, y) => porTexto(x.gm_clave, y.gm_clave))
    .map(
      (e): ValorCanonico => ({
        gm_clave: e.gm_clave,
        total_antes: num(e.total_antes),
        total_despues: num(e.total_despues),
        crecimiento_implicito_antes_pct: num(e.crecimiento_implicito_antes_pct),
        crecimiento_implicito_despues_pct: num(e.crecimiento_implicito_despues_pct),
        meta_antes: num(e.meta_antes),
        meta_despues: num(e.meta_despues),
        desvio_antes_u: num(e.desvio_antes_u),
        desvio_despues_u: num(e.desvio_despues_u),
        libres_antes: e.libres_antes,
        libres_despues: e.libres_despues,
      })
    );
  return sha256(canonico({ filas, efecto_gm: efecto }));
}

/**
 * D10. `huella_cuerpo` de un lote de aprobar o reaprobar: sha-256 del cuerpo canónico. Un reintento con el mismo `lote_id` y el mismo cuerpo da la misma huella (la
 * función SQL devuelve lo guardado); otro cuerpo con el mismo `lote_id` da otra (`409 lote_ajeno`). Las filas van ordenadas por `fila_id`. `simular` no entra
 * (solo se guardan los lotes aplicados).
 */
export function huellaCuerpoLote(c: LoteCuerpo): string {
  const filas = [...c.filas]
    .sort((a, b) => porTexto(a.fila_id, b.fila_id))
    .map(
      (f): ValorCanonico => ({
        fila_id: f.fila_id,
        fuente: f.fuente,
        valor_esperado: f.valor_esperado,
        decidido_esperado: f.decidido_esperado ?? null,
        propuesta_fila_id: f.propuesta_fila_id ?? null,
      })
    );
  return sha256(
    canonico({
      lote_id: c.lote_id,
      confirmacion_id: c.confirmacion_id,
      tipo: c.tipo,
      anio: c.anio,
      huella_simulacion: c.huella_simulacion ?? null,
      revision_confirmada: c.revision_confirmada,
      nota: c.nota ?? null,
      filtro: (c.filtro ?? null) as ValorCanonico,
      filas,
    })
  );
}

/** D10 y D12. `huella_cuerpo` de un lote de reversión: el lote que se revierte, las filas marcadas (o todas) y la nota. */
export function huellaCuerpoReversion(a: { lote_id: string; confirmacion_id: string; revierte_lote_id: string; filas?: readonly string[]; nota?: string }): string {
  return sha256(
    canonico({
      lote_id: a.lote_id,
      confirmacion_id: a.confirmacion_id,
      tipo: "revertir",
      revierte_lote_id: a.revierte_lote_id,
      filas: a.filas === undefined ? null : [...a.filas].sort(porTexto),
      nota: a.nota ?? null,
    })
  );
}
