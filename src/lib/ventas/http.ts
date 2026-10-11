import { NextResponse } from "next/server";
import type { Tables } from "@/lib/supabase/database.types";
import type { Json } from "@/lib/supabase/database.types";
import type { MedidasCarga } from "./tipos";

/**
 * Pequeñas ayudas de los handlers de M5 (solo servidor).
 */

/**
 * `{ error, codigo, ...extra }`: como `error()` de `respuestas.ts` pero con un
 * código de máquina y campos extra al lado del mensaje (`api-client.ts` solo
 * expone `error`; los demás campos sirven a quien lea la respuesta cruda).
 */
export function errorConCodigo(mensaje: string, status: number, codigo: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: mensaje, codigo, ...extra }, { status });
}

/** Nombre con el que se firma una carga: el del perfil o, si no tiene, su correo. */
export function nombreDeUsuario(perfil: Pick<Tables<"perfiles">, "nombre" | "email">): string {
  const n = perfil.nombre?.trim();
  return n ? n : perfil.email;
}

/** `Json` desconocido → objeto plano, o `null`. */
export function comoObjeto(valor: Json | unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** `medido`/`esperado` del `jsonb` que devuelve `publicar_carga_venta_stock`. */
export function leerMedidasJson(valor: unknown): MedidasCarga {
  const o = comoObjeto(valor) ?? {};
  return {
    filas: num(o.filas),
    unidades: num(o.unidades),
    venta_soles: num(o.venta_soles),
    costo_vendido: num(o.costo_vendido),
    stock_unidades: num(o.stock_unidades),
    stock_valorizado: num(o.stock_valorizado),
  };
}

export type ResultadoPublicar =
  | { ok: true; medido: MedidasCarga; reemplaza: { id: string; filas: number } | null }
  | { ok: false; motivo: "no_en_curso" }
  | { ok: false; motivo: "no_concilia"; esperado: MedidasCarga; medido: MedidasCarga };

/** Interpreta el `jsonb` de la función SQL de publicación; cualquier forma inesperada se trata como `no_en_curso`. */
export function leerResultadoPublicar(valor: Json | unknown): ResultadoPublicar {
  const o = comoObjeto(valor);
  if (!o) return { ok: false, motivo: "no_en_curso" };
  if (o.ok === true) {
    const r = comoObjeto(o.reemplaza);
    return {
      ok: true,
      medido: leerMedidasJson(o.medido),
      reemplaza: r && typeof r.id === "string" ? { id: r.id, filas: num(r.filas) } : null,
    };
  }
  if (o.motivo === "no_concilia") {
    return { ok: false, motivo: "no_concilia", esperado: leerMedidasJson(o.esperado), medido: leerMedidasJson(o.medido) };
  }
  return { ok: false, motivo: "no_en_curso" };
}

/**
 * Argumentos de `publicar_carga_venta_stock` a partir de lo esperado. SIN
 * redondear: `esperado` ya viene en céntimos exactos (`esperadoDeMes`) y
 * `publicarSchema` exige hasta 2 decimales; volver a redondear no aporta nada y
 * una corrección mal hecha cambiaría un total que la base compara exacto.
 */
export function argumentosPublicar(cargaId: string, esperado: MedidasCarga) {
  return {
    p_carga: cargaId,
    p_filas: esperado.filas,
    p_unidades: esperado.unidades,
    p_venta: esperado.venta_soles,
    p_costo: esperado.costo_vendido,
    p_stock_unidades: esperado.stock_unidades,
    p_stock_valorizado: esperado.stock_valorizado,
  };
}
