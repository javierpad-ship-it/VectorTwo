import type { NodoInfo } from "@/lib/arbol/nivel/indice";
import { modalidadEfectiva, modalidadPorDefecto } from "../reglas";
import { marcasPorId, unidadDeMarca, type MarcaConjunto, type UnidadDeMarca } from "../conjuntos/reglas";
import type {
  CambioMarca,
  MotivoIgnorada,
  MotivoNoPermitidoGml,
  MotivoPendiente,
} from "../tipos-api";

/**
 * Reglas de las marcas relevantes por GML (docs/modulos/02b-marcas-tratamiento-gml.md,
 * reglas 5, 7, 9 y 11). Funciones puras. Una marca es relevante en un GML
 * mediante un par marca × nodo (`marca_gml_especial`); lo que cuenta en el
 * flujo es la UNIDAD de marca (la cabeza del conjunto, si lo hay).
 */

export { modalidadEfectiva, modalidadPorDefecto };

/** Una marca con lo que 02b necesita; una fila de `marcas` lo cumple. */
export type MarcaGml = MarcaConjunto & {
  codigo?: string;
  tratamiento_especial: boolean;
  modalidad_tratamiento: string | null;
  nota_tratamiento?: string | null;
};

export type AgrupacionGml = { id: string; nombre: string; activo: boolean; orden?: number };

/** Una fila de `marca_gml_especial`. `activo = false` se lee como ausente (la API nunca lo escribe). */
export type AsignacionGmlEntrada = {
  id: string;
  marca_id: string;
  genero_mundo_linea_id: string;
  nota: string | null;
  activo: boolean;
  created_at: string;
};

/** Regla 1 de M2: la marca se ve si ella y su agrupación están activas. */
export function marcaVigenteGml(marca: Pick<MarcaGml, "activo">, agrupacion: Pick<AgrupacionGml, "activo"> | undefined): boolean {
  return Boolean(agrupacion) && marca.activo && (agrupacion as AgrupacionGml).activo;
}

/**
 * Regla 7: qué le pasa a la marca al recibir su primer GML. Sin casilla,
 * al barrer o sin modalidad pasa a `por_gml`; si ya es `por_gml`, `null`.
 */
export function cambioMarca(marca: Pick<MarcaGml, "tratamiento_especial" | "modalidad_tratamiento">): CambioMarca | null {
  if (!marca.tratamiento_especial) return { de: "sin_tratamiento", a: "por_gml" };
  if (marca.modalidad_tratamiento === "por_gml") return null;
  if (marca.modalidad_tratamiento === "barrido") return { de: "barrido", a: "por_gml" };
  return { de: "sin_modalidad", a: "por_gml" };
}

// ─── Regla 7: rechazo de una asignación ───

export type RechazoAsignacion = {
  motivo: MotivoNoPermitidoGml;
  status: 404 | 409;
  mensaje: string;
  /** Texto corto para la columna de detalle (a quién cuenta, qué padre está inactivo). */
  detalle?: string;
};

/**
 * Regla 7. Marca `undefined` → `marca_no_encontrada` (404); `!activo` →
 * `marca_inactiva` (409); miembro de un conjunto efectivo → `marca_en_conjunto`
 * (409, "ALFA JEANS cuenta como ALFA: hazlo relevante en ALFA"); nodo
 * `undefined` → `nodo_no_encontrado` (404); nodo no vigente → `nodo_no_vigente`
 * (409, con el padre inactivo); si no, `null`. Una marca sin casilla, al barrer
 * o sin modalidad NO se rechaza (se marcará, ver `cambioMarca`) y una agrupación
 * inactiva tampoco (la asignación nace ignorada `marca_no_vigente`).
 */
export function motivoRechazoAsignacion(
  marca: MarcaGml | undefined,
  nodo: NodoInfo | undefined,
  marcas: readonly MarcaGml[]
): RechazoAsignacion | null {
  if (!marca) return { motivo: "marca_no_encontrada", status: 404, mensaje: "Marca no encontrada." };
  if (!marca.activo) {
    return {
      motivo: "marca_inactiva",
      status: 409,
      mensaje: `La marca ${marca.nombre} está inactiva: reactívala antes de hacerla relevante en un GML.`,
    };
  }
  const unidad = unidadDeMarca(marca, marcas);
  if (unidad.en_conjunto) {
    const cabeza = marcasPorId(marcas).get(unidad.unidad_marca_id);
    const nombreCabeza = cabeza?.nombre ?? "su cabeza";
    return {
      motivo: "marca_en_conjunto",
      status: 409,
      mensaje: `${marca.nombre} cuenta como ${nombreCabeza}: hazlo relevante en ${nombreCabeza}.`,
      detalle: `cuenta como ${nombreCabeza}`,
    };
  }
  if (!nodo) {
    return { motivo: "nodo_no_encontrado", status: 404, mensaje: "Nodo género-mundo-línea no encontrado." };
  }
  if (!nodo.vigente) {
    const padre = nodo.motivo_no_vigente ?? "no está vigente";
    return {
      motivo: "nodo_no_vigente",
      status: 409,
      mensaje: `${nodo.ruta} no está vigente (${padre}): reactívalo antes de hacer relevante una marca.`,
      detalle: padre,
    };
  }
  return null;
}

// ─── Regla 10: vigencia de una asignación ───

export type IgnoradaInfo = { motivo: MotivoIgnorada; detalle?: string };

/**
 * Por qué una asignación se ignora, con la prioridad `en_conjunto >
 * marca_sin_tratamiento > marca_no_vigente > marca_en_barrido >
 * gml_no_vigente`; `null` si cuenta. Nada se borra: al revertir la causa
 * (volver a marcar, reactivar la línea, salir del conjunto) la asignación
 * vuelve sola.
 */
export function motivoIgnorada(
  marca: MarcaGml,
  agrupacion: AgrupacionGml | undefined,
  unidad: UnidadDeMarca,
  nodo: NodoInfo | undefined,
  nombreCabeza?: string
): IgnoradaInfo | null {
  if (unidad.en_conjunto) {
    return { motivo: "en_conjunto", detalle: `cuenta como ${nombreCabeza ?? "su cabeza"}` };
  }
  if (!marca.tratamiento_especial) return { motivo: "marca_sin_tratamiento" };
  if (!marcaVigenteGml(marca, agrupacion)) return { motivo: "marca_no_vigente" };
  if (modalidadEfectiva(marca) === "barrido") return { motivo: "marca_en_barrido" };
  if (!nodo || !nodo.vigente) return { motivo: "gml_no_vigente", detalle: nodo?.motivo_no_vigente ?? undefined };
  return null;
}

/**
 * Regla 9. Una marca marcada y vigente, `por_gml` y con 0 asignaciones
 * vigentes → `sin_gml`; marcada con modalidad nula → `sin_modalidad`; marcada
 * no vigente → `marca_no_vigente`; `barrido` nunca es pendiente; sin casilla
 * tampoco. Un miembro de un conjunto efectivo no es pendiente (cuenta su
 * cabeza).
 */
export function motivoPendiente(
  marca: MarcaGml,
  agrupacion: AgrupacionGml | undefined,
  gmlVigentes: number,
  enConjunto = false
): MotivoPendiente | null {
  if (!marca.tratamiento_especial || enConjunto) return null;
  if (!marcaVigenteGml(marca, agrupacion)) return "marca_no_vigente";
  if (marca.modalidad_tratamiento === null) return "sin_modalidad";
  if (marca.modalidad_tratamiento === "por_gml" && gmlVigentes === 0) return "sin_gml";
  return null;
}
