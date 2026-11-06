import { MOTIVOS_FUNCION_OC, type ActorCompra, type AvisoOc, type MotivoFuncionOc, type ResultadoEditarOc } from "./tipos";
import { CODIGO_DE_MOTIVO_OC, ESTADO_HTTP_ERROR_COMPRA, MENSAJE_ERROR_COMPRA, mensajeOcDeOtroProveedor, mensajeOcRepetida, type AvisoOcApi } from "./tipos-api";

/**
 * Número de OC de una compra (ficha 08b-1b §2.11, decisión 121). Puro: normaliza lo que se manda a `editar_oc_compra`, interpreta lo que
 * devuelve (sin confiar en su forma) y lo traduce a la respuesta de `PUT /api/compras/[id]/oc`. La escritura es la función SQL.
 */

const esRegistro = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `btrim` de la base: sin espacios al borde; vacío = sin OC (`null`). Es el mismo valor que la función guarda y compara. */
export const normalizarOc = (valor: string | null | undefined): string | null => {
  if (valor === null || valor === undefined) return null;
  const t = valor.trim();
  return t === "" ? null : t;
};

/** `p_*` de `editar_oc_compra(p_compra, p_antes, p_numero_oc, p_motivo, p_actor)`; `antes` y `numero_oc` ya normalizados. */
export type ArgsEditarOc = { p_compra: string; p_antes: string | null; p_numero_oc: string | null; p_motivo: string | null; p_actor: ActorCompra };

export function argsEditarOc(a: { compra_id: string; antes: string | null; numero_oc: string | null; motivo?: string | null; actor: ActorCompra }): ArgsEditarOc {
  return { p_compra: a.compra_id, p_antes: normalizarOc(a.antes), p_numero_oc: normalizarOc(a.numero_oc), p_motivo: normalizarOc(a.motivo ?? null), p_actor: a.actor };
}

const esMotivoOc = (m: unknown): m is MotivoFuncionOc => typeof m === "string" && (MOTIVOS_FUNCION_OC as readonly string[]).includes(m);

/** Lo que devolvió la función; una forma que no se entiende es `null` (el servicio responde 500 genérico). */
export function interpretarResultadoOc(data: unknown): ResultadoEditarOc | null {
  if (!esRegistro(data)) return null;
  if (data.ok === true) {
    const avisos = Array.isArray(data.avisos) ? data.avisos : [];
    return {
      ok: true,
      numero_oc: typeof data.numero_oc === "string" ? data.numero_oc : null,
      avisos: avisos.flatMap((a) =>
        esRegistro(a) && a.codigo === "oc_de_otro_proveedor" && typeof a.compra === "string" && typeof a.proveedor === "string"
          ? [{ codigo: "oc_de_otro_proveedor" as AvisoOc, compra: a.compra, proveedor: a.proveedor }]
          : []
      ),
    };
  }
  if (!esMotivoOc(data.motivo)) return null;
  if (data.motivo === "oc_repetida") return { ok: false, motivo: "oc_repetida", compra: typeof data.compra === "string" ? data.compra : null };
  return { ok: false, motivo: data.motivo };
}

export type ErrorDeOc = { status: number; codigo: string; mensaje: string };

/** El `404`/`409`/`400` de un rechazo de la función. `oc_repetida` nombra la compra que ya tiene la OC cuando la base la dice. */
export function errorDeOc(r: Extract<ResultadoEditarOc, { ok: false }>, numeroOc: string | null): ErrorDeOc {
  const codigo = CODIGO_DE_MOTIVO_OC[r.motivo];
  const base = { status: ESTADO_HTTP_ERROR_COMPRA[codigo], codigo, mensaje: MENSAJE_ERROR_COMPRA[codigo] };
  if (r.motivo === "oc_repetida" && r.compra !== null && numeroOc !== null) return { ...base, mensaje: mensajeOcRepetida(numeroOc, r.compra) };
  return base;
}

/** Los avisos de una OC guardada, con el texto para mostrar. */
export const avisosDeOc = (numeroOc: string | null, avisos: Extract<ResultadoEditarOc, { ok: true }>["avisos"]): AvisoOcApi[] =>
  numeroOc === null ? [] : avisos.map((a) => ({ aviso: a.codigo, detalle: mensajeOcDeOtroProveedor(numeroOc, a.compra, a.proveedor) }));
