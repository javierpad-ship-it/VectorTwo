import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { ArbolConNivel, CambioMarca, MarcaConGml, Modalidad, MotivoPendiente, NivelPlanificacion } from "./tipos-m2b";

/** Las tres marcas genéricas que M5 fija en MID VALUE: no entran en conjuntos ni se planifican aparte. */
const MARCAS_GENERICAS = new Set(["VARIOS", "OTROS", "SIN MARCA"]);

export function esMarcaGenerica(nombre: string): boolean {
  return MARCAS_GENERICAS.has(normalizarNombre(nombre));
}

export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = { por_gml: "Por GML", barrido: "Al barrer" };

/** Nivel de un nodo; un árbol anterior a `0010` no lo trae y se lee como GML. */
export function nivelDe(l: { nivel_planificacion?: NivelPlanificacion | null }): NivelPlanificacion {
  return l.nivel_planificacion === "GMLE" ? "GMLE" : "GML";
}

/** Un nodo género-mundo-línea aplanado, para filtrar y elegir sin recorrer el árbol en cada render. */
export type NodoPlano = {
  id: string;
  generoId: string;
  genero: string;
  mundoId: string;
  mundo: string;
  lineaId: string;
  linea: string;
  nivel: NivelPlanificacion;
  vigente: boolean;
  equivalencias: number;
};

export function aplanarNodos(arbol: ArbolConNivel | null, soloVigentes = true): NodoPlano[] {
  if (!arbol) return [];
  const nodos: NodoPlano[] = [];
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (soloVigentes && !l.vigente) continue;
        nodos.push({
          id: l.nodo_id,
          generoId: g.id,
          genero: g.nombre,
          mundoId: m.id,
          mundo: m.nombre,
          lineaId: l.linea_id,
          linea: l.nombre,
          nivel: nivelDe(l),
          vigente: l.vigente,
          equivalencias: l.equivalencias.length,
        });
      }
    }
  }
  return nodos;
}

export function rutaNodo(n: Pick<NodoPlano, "genero" | "mundo" | "linea">): string {
  return `${n.genero} · ${n.mundo} · ${n.linea}`;
}

/** La marca es miembro de un conjunto efectivo (su cabeza está activa): cuenta como la cabeza. */
export function esMiembroEfectivo(m: Pick<MarcaConGml, "conjunto">): boolean {
  return m.conjunto !== null && m.conjunto !== undefined && m.conjunto.activo;
}

/**
 * Misma regla que `motivoPendiente` de la API (regla 9), con lo que ya trae `GET /api/marcas`:
 * marcada y no miembro de un conjunto efectivo (la que cuenta es su cabeza); no vigente →
 * `marca_no_vigente`; modalidad nula → `sin_modalidad`; por GML con 0 GML vigentes → `sin_gml`.
 * Al barrer nunca es pendiente.
 */
export function motivoPendienteMarca(m: MarcaConGml): MotivoPendiente | null {
  if (!m.tratamiento_especial || esMiembroEfectivo(m)) return null;
  if (!m.vigente) return "marca_no_vigente";
  if (m.modalidad_tratamiento === null) return "sin_modalidad";
  if (m.modalidad_tratamiento === "por_gml" && m.gml_vigentes === 0) return "sin_gml";
  return null;
}

/** Pendiente por cualquier motivo (lo mismo que `pendiente` en `GET /api/marcas/gml-especial`). */
export function estaPendiente(m: MarcaConGml): boolean {
  return motivoPendienteMarca(m) !== null;
}

export const TEXTO_PENDIENTE: Record<MotivoPendiente, string> = {
  sin_gml: "Pendiente: sin GML",
  sin_modalidad: "Pendiente: sin modalidad",
  marca_no_vigente: "Pendiente: marca no vigente",
};

/**
 * Conteos del resumen, con los mismos criterios que `resumen` de `GET /api/marcas/gml-especial`:
 * los miembros de un conjunto efectivo no cuentan (su configuración propia está ignorada) y
 * `marcadas = por_gml + barrido + sin_modalidad`. `pendientes` son las `sin_gml`, como
 * `pendientes_sin_gml`. Recibe las marcas ya filtradas por activas (o no) por quien llama.
 */
export function resumenTratamiento(marcas: readonly MarcaConGml[]) {
  const r = { marcadas: 0, porGml: 0, barrido: 0, sinModalidad: 0, pendientes: 0 };
  for (const m of marcas) {
    if (!m.tratamiento_especial || esMiembroEfectivo(m)) continue;
    r.marcadas++;
    if (m.modalidad_tratamiento === "por_gml") r.porGml++;
    else if (m.modalidad_tratamiento === "barrido") r.barrido++;
    else r.sinModalidad++;
    if (motivoPendienteMarca(m) === "sin_gml") r.pendientes++;
  }
  return r;
}

/** Qué le pasaría a la marca al hacerla relevante en un GML (`null` si ya es por GML). */
export function cambioMarcaDe(m: Pick<MarcaConGml, "tratamiento_especial" | "modalidad_tratamiento">): CambioMarca["de"] | null {
  if (!m.tratamiento_especial) return "sin_tratamiento";
  if (m.modalidad_tratamiento === "por_gml") return null;
  return m.modalidad_tratamiento === "barrido" ? "barrido" : "sin_modalidad";
}

export function textoCambioMarca(nombre: string, de: CambioMarca["de"]): string {
  switch (de) {
    case "sin_tratamiento":
      return `${nombre} se marcará con tratamiento especial (Por GML)`;
    case "barrido":
      return `${nombre} pasará de Al barrer a Por GML`;
    case "sin_modalidad":
      return `${nombre} (sin modalidad) pasará a Por GML`;
  }
}

/** Participación (0..1) como porcentaje legible. */
export function pct(x: number): string {
  return `${(x * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;
}
