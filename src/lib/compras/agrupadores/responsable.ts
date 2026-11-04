import type { ResponsableEfectivoApi } from "./tipos-api";
import { ROLES_RESPONSABLE_ASIGNABLE, type OrigenResponsable, type PerfilRegistro } from "./tipos";

/**
 * Comprador responsable (ficha 08b, §2.8, R26, decisión 85). Puro.
 *
 *  - Asignables: perfiles ACTIVOS con rol `comprador` o `admin`; el planner no. Un admin desactivado, o que pasa a planner, cuenta
 *    como faltante igual que un comprador.
 *  - Uno por nivel, obligatorio solo en el viaje. Efectivo: `paquete ?? embarque ?? viaje`, calculado al leer.
 *  - Faltante (`sin_responsable`): sin efectivo, o con un efectivo que ya no es asignable. Desactivarlo o cambiarle el rol conserva la
 *    asignación; borrar el perfil la deja en nulo.
 *  - «Mis viajes / embarques / paquetes» filtran por el responsable efectivo y nunca son permiso (decisiones 12 y 28).
 */

/** `true` si el perfil puede ser responsable ahora mismo: activo y comprador o admin. `undefined` (perfil borrado) no lo es. */
export function esAsignable(perfil: Pick<PerfilRegistro, "rol" | "activo"> | null | undefined): boolean {
  return perfil != null && perfil.activo && ROLES_RESPONSABLE_ASIGNABLE.includes(perfil.rol);
}

/** Los perfiles asignables, en el orden en que llegan (el que ordena por nombre es quien lee la base). */
export function perfilesAsignables<T extends Pick<PerfilRegistro, "rol" | "activo">>(perfiles: readonly T[]): T[] {
  return perfiles.filter((p) => esAsignable(p));
}

export type ResultadoResponsable = { ok: true } | { ok: false; motivo: "responsable_no_asignable" };

/**
 * Validación al ESCRIBIR (guardar viaje, embarque o paquete; importador): `null` es válido (hereda; el viaje exige uno aparte) y un id
 * debe ser de un perfil asignable. Un perfil que no existe o un planner dan `responsable_no_asignable` (R26, caso 9).
 */
export function validarResponsable(responsableId: string | null | undefined, perfiles: readonly PerfilRegistro[]): ResultadoResponsable {
  if (responsableId == null) return { ok: true };
  return esAsignable(perfiles.find((p) => p.id === responsableId)) ? { ok: true } : { ok: false, motivo: "responsable_no_asignable" };
}

/** Los ids de responsable de cada nivel que importan a quien pregunta (nulos = no tiene). El propio nivel va en `propio`. */
export type CadenaResponsable = { propio?: string | null; embarque?: string | null; viaje?: string | null };

export type ResponsableCalculado = {
  /** `null` si ningún nivel tiene responsable. */
  efectivo: ResponsableEfectivoApi | null;
  /**
   * `true` ⇒ `sin_responsable`: no hay efectivo o el efectivo ya no es asignable (desactivado, o ya no es comprador ni admin). Que
   * el efectivo no sea asignable NO hace caer al nivel siguiente: la asignación se conserva y se avisa.
   */
  faltante: boolean;
};

/**
 * Responsable efectivo de un viaje, un embarque o un paquete: el primero no nulo de `propio`, `embarque` y `viaje` (en ese orden; cada
 * quien pasa solo los niveles que le corresponden: un embarque, `{ propio, viaje }`; un paquete, `{ propio, embarque, viaje }`).
 * `origen` dice de dónde sale: `propio`, `embarque` o `viaje`. El nombre sale de `perfiles` (`null` si el perfil ya no existe).
 */
export function responsableEfectivo(cadena: CadenaResponsable, perfiles: readonly PerfilRegistro[]): ResponsableCalculado {
  const niveles: [OrigenResponsable, string | null | undefined][] = [
    ["propio", cadena.propio],
    ["embarque", cadena.embarque],
    ["viaje", cadena.viaje],
  ];
  const hallado = niveles.find(([, id]) => id != null);
  if (!hallado) return { efectivo: null, faltante: true };
  const [origen, perfilId] = hallado as [OrigenResponsable, string];
  const perfil = perfiles.find((p) => p.id === perfilId);
  return { efectivo: { perfil_id: perfilId, nombre: perfil?.nombre ?? null, origen }, faltante: !esAsignable(perfil) };
}

/** Filtro «Mis…»: el responsable efectivo es el usuario. Es un filtro, nunca un permiso. */
export const esMio = (efectivo: Pick<ResponsableEfectivoApi, "perfil_id"> | null, perfilId: string): boolean => efectivo !== null && efectivo.perfil_id === perfilId;
