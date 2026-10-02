/**
 * Roles del sistema (docs/PLAN.md §3).
 *
 *   admin      → todo, incluida la administración de usuarios.
 *   planner    → maestros y planificación.
 *   comprador  → solo lectura; en Fase 3 registra sus compras.
 */
export const ROLES = ["admin", "planner", "comprador"] as const;

export type Rol = (typeof ROLES)[number];

export const ETIQUETA_ROL: Record<Rol, string> = {
  admin: "Administrador",
  planner: "Planner",
  comprador: "Comprador",
};

export const DESCRIPCION_ROL: Record<Rol, string> = {
  admin: "Acceso completo y administración de usuarios.",
  planner: "Edita maestros y trabaja la planificación.",
  comprador: "Consulta en solo lectura lo que se le comparte.",
};

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

/** Cualquier valor de la BD o del cliente → un Rol válido (por defecto, el más restringido). */
export function normalizarRol(valor: unknown): Rol {
  return esRol(valor) ? valor : "comprador";
}

export function esAdmin(rol: Rol): boolean {
  return rol === "admin";
}

/** Quién puede crear y editar maestros (árbol, marcas, tiendas…). */
export function puedeEditarMaestros(rol: Rol): boolean {
  return rol === "admin" || rol === "planner";
}

/** Perfil tal como lo devuelve `/api/auth/me` y lo recibe el AppShell. */
export type PerfilCliente = {
  id: string;
  email: string;
  nombre: string | null;
  rol: Rol;
};
