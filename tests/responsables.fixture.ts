import type { AsignacionEntrada, PerfilEntrada } from "@/lib/responsables/matriz";
import type { GeneroEntrada, LineaEntrada, MundoEntrada, NodoEntrada } from "@/lib/arbol/armar-arbol";
import { armarMatriz, type LineaMatrizEntrada } from "@/lib/responsables/matriz";

/** UUID v4 válido y determinista: `uuid(7)` → `00000000-0000-4000-8000-000000000007`. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const NOMBRES_GENEROS = ["HOMBRE", "MUJER", "NIÑO", "NIÑA", "BEBE", "UNISEX", "ACCESORIOS", "HOGAR"];
export const NOMBRES_MUNDOS = ["URBANO", "FORMAL", "DEPORTE", "PLAYA", "BASICOS"];

/** 8 géneros (ids 1–8). */
export const generos: GeneroEntrada[] = NOMBRES_GENEROS.map((nombre, i) => ({
  id: uuid(i + 1),
  codigo: nombre.replace(/\W/g, "_"),
  nombre,
  orden: (i + 1) * 10,
  activo: true,
}));

/** 5 mundos (ids 101–105). */
export const mundos: MundoEntrada[] = NOMBRES_MUNDOS.map((nombre, i) => ({
  id: uuid(101 + i),
  codigo: nombre,
  nombre,
  orden: (i + 1) * 10,
  activo: true,
}));

export const ANA = uuid(901);
export const LUIS = uuid(902);
export const ADMIN = uuid(903);
export const PLANNER = uuid(904);

export const perfiles: PerfilEntrada[] = [
  { id: ANA, nombre: "ANA RAMOS", email: "ana@lukers.pe", rol: "comprador", activo: true },
  { id: LUIS, nombre: null, email: "luis@lukers.pe", rol: "comprador", activo: true },
  { id: ADMIN, nombre: "JAVIER", email: "javier@lukers.pe", rol: "admin", activo: true },
  { id: PLANNER, nombre: "PAOLA", email: "paola@lukers.pe", rol: "planner", activo: true },
];

export const asignacion = (generoIdx: number, mundoIdx: number, perfilId: string, activo = true): AsignacionEntrada => ({
  genero_id: uuid(generoIdx),
  mundo_id: uuid(100 + mundoIdx),
  perfil_id: perfilId,
  activo,
});

export const lineas: LineaMatrizEntrada[] = [1, 2, 3].map((n) => ({ id: uuid(500 + n), activo: true }));
export const lineasCompletas: LineaEntrada[] = lineas.map((l, i) => ({
  id: l.id,
  codigo: `L${i}`,
  nombre: `LINEA ${i}`,
  temporada: "Todo el año",
  activo: l.activo,
}));

export const nodo = (generoIdx: number, mundoIdx: number, lineaIdx: number, activo = true): NodoEntrada => ({
  id: uuid(1000 + generoIdx * 100 + mundoIdx * 10 + lineaIdx),
  genero_id: uuid(generoIdx),
  mundo_id: uuid(100 + mundoIdx),
  linea_id: uuid(500 + lineaIdx),
  activo,
});

/** Atajo: la matriz con el catálogo de la ficha (8 × 5) y lo que se quiera pisar. */
export function matriz(
  extra: Partial<{
    generos: GeneroEntrada[];
    mundos: MundoEntrada[];
    asignaciones: AsignacionEntrada[];
    perfiles: PerfilEntrada[];
    nodos: NodoEntrada[];
    lineas: LineaMatrizEntrada[];
    incluirInactivos: boolean;
  }> = {}
) {
  return armarMatriz(
    extra.generos ?? generos,
    extra.mundos ?? mundos,
    extra.asignaciones ?? [],
    extra.perfiles ?? perfiles,
    extra.nodos ?? [],
    extra.lineas ?? lineas,
    { incluirInactivos: extra.incluirInactivos ?? false }
  );
}
