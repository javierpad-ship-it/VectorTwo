import type { Tables } from "@/lib/supabase/database.types";
import { compararNombre, nivelDeNodo, nodoVigente } from "../armar-arbol";
import type { NivelPlanificacion } from "../tipos";

/**
 * Índice de nodos género-mundo-línea con su ruta legible, su nivel de
 * planificación y su vigencia (con el motivo cuando no es vigente). Lo comparten
 * el estado de marcas relevantes, la asignación en bloque, las sugerencias y el
 * contrato de M7/M8. Puro: se arma con las cuatro tablas leídas planas.
 */

export type NodoInfo = {
  id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  /** `GENERO · MUNDO · LINEA`, como se muestra en pantalla. */
  ruta: string;
  nivel_planificacion: NivelPlanificacion;
  /** `nodoVigente` de M1: nodo, género, mundo y línea activos. */
  vigente: boolean;
  /** Qué padre está inactivo (`"línea TERNO inactiva"`), `null` si es vigente. */
  motivo_no_vigente: string | null;
};

export type IndiceNodos = Map<string, NodoInfo>;

export type EntradaIndiceNodos = {
  generos: Pick<Tables<"generos">, "id" | "nombre" | "activo">[];
  mundos: Pick<Tables<"mundos">, "id" | "nombre" | "activo">[];
  lineas: Pick<Tables<"lineas">, "id" | "nombre" | "activo">[];
  nodos: (Pick<Tables<"genero_mundo_linea">, "id" | "genero_id" | "mundo_id" | "linea_id" | "activo"> &
    Partial<Pick<Tables<"genero_mundo_linea">, "nivel_planificacion">>)[];
};

/** Qué piezas del nodo están inactivas, en castellano llano; `null` si todas están activas. */
export function motivoNodoNoVigente(piezas: {
  nodo: boolean;
  genero: { nombre: string; activo: boolean };
  mundo: { nombre: string; activo: boolean };
  linea: { nombre: string; activo: boolean };
}): string | null {
  const motivos: string[] = [];
  if (!piezas.nodo) motivos.push("nodo inactivo");
  if (!piezas.genero.activo) motivos.push(`género ${piezas.genero.nombre} inactivo`);
  if (!piezas.mundo.activo) motivos.push(`mundo ${piezas.mundo.nombre} inactivo`);
  if (!piezas.linea.activo) motivos.push(`línea ${piezas.linea.nombre} inactiva`);
  return motivos.length > 0 ? motivos.join(" y ") : null;
}

export function indexarNodos(entrada: EntradaIndiceNodos): IndiceNodos {
  const generos = new Map(entrada.generos.map((g) => [g.id, g]));
  const mundos = new Map(entrada.mundos.map((m) => [m.id, m]));
  const lineas = new Map(entrada.lineas.map((l) => [l.id, l]));
  const indice: IndiceNodos = new Map();
  for (const n of entrada.nodos) {
    const genero = generos.get(n.genero_id);
    const mundo = mundos.get(n.mundo_id);
    const linea = lineas.get(n.linea_id);
    if (!genero || !mundo || !linea) continue; // imposible con las FK
    indice.set(n.id, {
      id: n.id,
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      genero: genero.nombre,
      mundo: mundo.nombre,
      linea: linea.nombre,
      ruta: `${genero.nombre} · ${mundo.nombre} · ${linea.nombre}`,
      nivel_planificacion: nivelDeNodo(n),
      vigente: nodoVigente(n, genero, mundo, linea),
      motivo_no_vigente: motivoNodoNoVigente({ nodo: n.activo, genero, mundo, linea }),
    });
  }
  return indice;
}

/** Orden de pantalla de los nodos: género, mundo y línea por nombre; `id` desempata. */
export function compararNodos(a: NodoInfo, b: NodoInfo): number {
  return (
    compararNombre(a.genero, b.genero) ||
    compararNombre(a.mundo, b.mundo) ||
    compararNombre(a.linea, b.linea) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
