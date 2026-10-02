import type { Rol } from "@/lib/auth/roles";

export type NavLink = {
  href: string;
  label: string;
  /** Roles que ven el item. Si falta, lo ven todos los de la sección. */
  roles?: Rol[];
  /** Activo solo con coincidencia exacta (para padres con hijos). */
  exact?: boolean;
  /** Marcado mientras el módulo que lo construye no esté listo. */
  pendiente?: string;
};

export type NavSection = {
  title: string;
  roles: Rol[];
  links: NavLink[];
};

const TODOS: Rol[] = ["admin", "planner", "comprador"];
const PLANIFICACION: Rol[] = ["admin", "planner"];

/**
 * Única fuente de verdad del menú. De acá salen los links del sidebar y el
 * guard que impide entrar a una ruta por URL directa (`puedeVerRuta`).
 *
 * Los items marcados `pendiente` apuntan a módulos que todavía no existen:
 * se muestran deshabilitados para que el menú ya refleje el plan completo
 * de la Fase 1 (docs/PLAN.md §4).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "General",
    roles: TODOS,
    links: [{ href: "/", label: "Inicio", exact: true }],
  },
  {
    // La sección la ven todos porque el árbol de producto es el vocabulario
    // común con los compradores (solo lectura para ellos; M1). El resto de
    // maestros sigue siendo de planificación.
    title: "Maestros",
    roles: TODOS,
    links: [
      { href: "/maestros/arbol", label: "Árbol de producto" },
      { href: "/maestros/marcas", label: "Agrupaciones y marcas", roles: PLANIFICACION, pendiente: "M2" },
      { href: "/maestros/estacionalidad", label: "Agrup. de estacionalidad", roles: PLANIFICACION, pendiente: "M3" },
      { href: "/maestros/tiendas", label: "Tiendas y aperturas", roles: PLANIFICACION, pendiente: "M4" },
    ],
  },
  {
    title: "Administración",
    roles: ["admin"],
    links: [{ href: "/usuarios", label: "Usuarios" }],
  },
];

export function seccionesVisibles(rol: Rol): NavSection[] {
  return NAV_SECTIONS.filter((s) => s.roles.includes(rol))
    .map((s) => ({
      ...s,
      links: s.links.filter((l) => !l.roles || l.roles.includes(rol)),
    }))
    .filter((s) => s.links.length > 0);
}

export function esActivo(pathname: string, link: NavLink): boolean {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href);
}

/** ¿Este rol puede abrir esta ruta? Por prefijo: las subrutas heredan el permiso. */
export function puedeVerRuta(rol: Rol, pathname: string): boolean {
  if (pathname === "/") return true;
  const permitidas = seccionesVisibles(rol)
    .flatMap((s) => s.links)
    .filter((l) => !l.pendiente)
    .map((l) => l.href)
    .filter((href) => href !== "/");
  return permitidas.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}
