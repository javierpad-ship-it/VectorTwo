import type { CampoFaltante } from "./constantes";

/**
 * Qué le falta a una ficha para estar completa (08c, §3.2, `faltan` y «Ficha incompleta»). Puro. Faltan: el país, el RUC / Tax ID, la
 * dirección y al menos un contacto. Un proveedor creado al vuelo o por `importar_compra` sale con casi todo.
 */
export type FichaParaCompletitud = {
  pais: string | null;
  identificacion: string | null;
  direccion: string | null;
  contactos: readonly unknown[];
};

const vacio = (v: string | null | undefined) => typeof v !== "string" || v.trim() === "";

export function camposFaltantes(f: FichaParaCompletitud): CampoFaltante[] {
  const faltan: CampoFaltante[] = [];
  if (vacio(f.pais)) faltan.push("pais");
  if (vacio(f.identificacion)) faltan.push("identificacion");
  if (vacio(f.direccion)) faltan.push("direccion");
  if (f.contactos.length === 0) faltan.push("contacto");
  return faltan;
}
