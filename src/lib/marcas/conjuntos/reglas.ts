import { normalizarNombre } from "@/lib/arbol/normalizar";
import type {
  AvisoConjunto,
  CambiadaDeConjunto,
  ConjuntoFila,
  MiembrosRespuesta,
  MotivoRechazoConjunto,
  ResumenConjuntos,
} from "../tipos-api";

/**
 * Reglas de los conjuntos de marcas (docs/modulos/02b-marcas-tratamiento-gml.md,
 * reglas 20 a 23). Funciones puras. Un conjunto es una marca CABEZA más sus
 * miembros (`marcas.conjunto_marca_id → marcas(id)`); la unidad de marca que
 * M7 y M8 tratan como "una marca" es la cabeza si la marca es miembro de un
 * conjunto efectivo (cabeza activa) y la marca misma si no.
 */

/** Lo mínimo de una marca para razonar sobre conjuntos; una fila de `marcas` lo cumple. */
export type MarcaConjunto = {
  id: string;
  nombre: string;
  activo: boolean;
  agrupacion_marca_id: string;
  conjunto_marca_id: string | null;
};

/** Los tres nombres que M5 fija en MID VALUE: no son marcas que se agrupen ni se planifiquen aparte. */
export const NOMBRES_MARCA_GENERICA = ["VARIOS", "OTROS", "SIN MARCA"] as const;

export function esMarcaGenerica(nombre: string): boolean {
  return (NOMBRES_MARCA_GENERICA as readonly string[]).includes(normalizarNombre(nombre));
}

// ─── Índices ───

const cachePorId = new WeakMap<readonly MarcaConjunto[], Map<string, MarcaConjunto>>();

/** `id → marca`, con caché por arreglo (las reglas se llaman miles de veces con el mismo arreglo). */
export function marcasPorId<T extends MarcaConjunto>(marcas: readonly T[]): Map<string, T> {
  let m = cachePorId.get(marcas);
  if (!m) {
    m = new Map(marcas.map((x) => [x.id, x]));
    cachePorId.set(marcas, m);
  }
  return m as Map<string, T>;
}

const cacheMiembros = new WeakMap<readonly MarcaConjunto[], Map<string, MarcaConjunto[]>>();

/** `cabeza_id → miembros` (marcas con `conjunto_marca_id` = esa cabeza), con caché por arreglo. */
export function miembrosPorCabeza<T extends MarcaConjunto>(marcas: readonly T[]): Map<string, T[]> {
  let m = cacheMiembros.get(marcas);
  if (!m) {
    m = new Map();
    for (const x of marcas) {
      if (!x.conjunto_marca_id) continue;
      const lista = m.get(x.conjunto_marca_id) ?? [];
      lista.push(x);
      m.set(x.conjunto_marca_id, lista);
    }
    cacheMiembros.set(marcas, m);
  }
  return m as Map<string, T[]>;
}

// ─── Regla 20: unidad de marca ───

export type UnidadDeMarca = {
  unidad_marca_id: string;
  /** La marca es miembro de un conjunto efectivo (cabeza activa): cuenta como su cabeza. */
  en_conjunto: boolean;
  /** Tiene cabeza pero está inactiva: la marca vuelve a contar como ella misma. */
  cabeza_inactiva: boolean;
  /** Su cabeza es a su vez miembro de otro conjunto (solo posible desde el SQL Editor): se resuelve un nivel. */
  cadena: boolean;
};

/**
 * Regla 20. Sin `conjunto_marca_id` → ella misma; con cabeza activa → la
 * cabeza; con cabeza inactiva → ella misma y `cabeza_inactiva`; cabeza con
 * cabeza propia → UN nivel (la cabeza directa) y `cadena`. Es la misma
 * definición que la vista SQL de unidades de marca. La membresía de una marca
 * desactivada sigue valiendo: solo mira `activo` de la cabeza.
 */
export function unidadDeMarca(marca: MarcaConjunto, marcas: readonly MarcaConjunto[]): UnidadDeMarca {
  const propia: UnidadDeMarca = { unidad_marca_id: marca.id, en_conjunto: false, cabeza_inactiva: false, cadena: false };
  if (!marca.conjunto_marca_id) return propia;
  const cabeza = marcasPorId(marcas).get(marca.conjunto_marca_id);
  if (!cabeza) return propia;
  const cadena = cabeza.conjunto_marca_id !== null;
  if (!cabeza.activo) return { ...propia, cabeza_inactiva: true, cadena };
  return { unidad_marca_id: cabeza.id, en_conjunto: true, cabeza_inactiva: false, cadena };
}

/** Regla 20: una cabeza es una marca con al menos un miembro (no hay bandera `es_cabeza`). */
export function esCabeza(marca: Pick<MarcaConjunto, "id">, marcas: readonly MarcaConjunto[]): boolean {
  return (miembrosPorCabeza(marcas).get(marca.id)?.length ?? 0) > 0;
}

// ─── Regla 21: rechazo al entrar en un conjunto ───

export type RechazoConjunto = { motivo: MotivoRechazoConjunto; status: 404 | 409; mensaje: string };

const STATUS_RECHAZO: Record<MotivoRechazoConjunto, 404 | 409> = {
  cabeza_no_encontrada: 404,
  marca_no_encontrada: 404,
  conjunto_propio: 409,
  cabeza_inactiva: 409,
  cabeza_es_miembro: 409,
  marca_es_cabeza: 409,
  marca_generica: 409,
};

/**
 * Regla 21. Por orden: cabeza inexistente (404) · la marca es su propia cabeza ·
 * cabeza inactiva · la cabeza es miembro de otro conjunto (sin cadenas) · la
 * marca tiene miembros (quita primero los suyos) · la marca o la cabeza es
 * VARIOS, OTROS o SIN MARCA. Todo `409` salvo la primera. Quitar
 * (`conjunto_marca_id: null`) siempre se permite, y una marca DESACTIVADA sí
 * puede entrar o seguir (su histórico cuenta). La agrupación distinta no rechaza
 * (es un aviso).
 */
export function motivoRechazoConjunto(
  marca: MarcaConjunto,
  cabeza: MarcaConjunto | null | undefined,
  marcas: readonly MarcaConjunto[]
): RechazoConjunto | null {
  const rechazo = (motivo: MotivoRechazoConjunto, mensaje: string): RechazoConjunto => ({
    motivo,
    status: STATUS_RECHAZO[motivo],
    mensaje,
  });
  if (!cabeza) return rechazo("cabeza_no_encontrada", "Marca cabeza no encontrada.");
  if (cabeza.id === marca.id) return rechazo("conjunto_propio", "Una marca no puede ser su propio conjunto.");
  if (!cabeza.activo) {
    return rechazo(
      "cabeza_inactiva",
      `La marca ${cabeza.nombre} está inactiva: reactívala antes de usarla como cabeza de un conjunto.`
    );
  }
  if (cabeza.conjunto_marca_id) {
    const otra = marcasPorId(marcas).get(cabeza.conjunto_marca_id);
    return rechazo(
      "cabeza_es_miembro",
      `${cabeza.nombre} ya es miembro del conjunto de ${otra?.nombre ?? "otra marca"}: no se admiten conjuntos dentro de conjuntos.`
    );
  }
  const miembros = miembrosPorCabeza(marcas).get(marca.id)?.length ?? 0;
  if (miembros > 0) {
    return rechazo(
      "marca_es_cabeza",
      `${marca.nombre} es cabeza de un conjunto con ${miembros === 1 ? "1 marca" : `${miembros} marcas`}: quita primero sus miembros.`
    );
  }
  if (esMarcaGenerica(marca.nombre) || esMarcaGenerica(cabeza.nombre)) {
    const quien = esMarcaGenerica(marca.nombre) ? marca.nombre : cabeza.nombre;
    return rechazo(
      "marca_generica",
      `${quien} no puede formar parte de un conjunto: VARIOS, OTROS y SIN MARCA se tratan aparte.`
    );
  }
  return null;
}

// ─── Regla 22: avisos ───

/** Un miembro con lo propio que importa para los avisos. */
export type MiembroParaAvisos = MarcaConjunto & {
  tratamiento_especial: boolean;
  modalidad_tratamiento: string | null;
  /** Asignaciones por GML propias (`activo = true`), vigentes o no. */
  gml_asignados: number;
};

export type AvisosDeConjunto = {
  /** Avisos del conjunto: `agrupacion_distinta`, `cabeza_inactiva` y `cadena` (sin `config_propia_ignorada`, que es de cada miembro). */
  conjunto: AvisoConjunto[];
  por_miembro: Map<string, AvisoConjunto[]>;
};

/**
 * Regla 22. Por miembro: `agrupacion_distinta` si su agrupación difiere de la
 * de la cabeza, `cabeza_inactiva`, `config_propia_ignorada` (casilla,
 * modalidad o asignaciones propias, mientras el conjunto sea efectivo) y
 * `cadena` (su cabeza es a su vez miembro). El conjunto suma los suyos sin
 * repetir.
 */
export function avisosConjunto(
  cabeza: Pick<MarcaConjunto, "agrupacion_marca_id" | "activo" | "conjunto_marca_id">,
  miembros: readonly MiembroParaAvisos[]
): AvisosDeConjunto {
  const por_miembro = new Map<string, AvisoConjunto[]>();
  const conjunto = new Set<AvisoConjunto>();
  const efectivo = cabeza.activo;

  for (const m of miembros) {
    const avisos: AvisoConjunto[] = [];
    if (m.agrupacion_marca_id !== cabeza.agrupacion_marca_id) avisos.push("agrupacion_distinta");
    if (!efectivo) avisos.push("cabeza_inactiva");
    if (efectivo && (m.tratamiento_especial || m.modalidad_tratamiento !== null || m.gml_asignados > 0)) {
      avisos.push("config_propia_ignorada");
    }
    if (cabeza.conjunto_marca_id !== null) avisos.push("cadena");
    por_miembro.set(m.id, avisos);
    for (const a of avisos) if (a !== "config_propia_ignorada") conjunto.add(a);
  }
  const orden: AvisoConjunto[] = ["agrupacion_distinta", "cabeza_inactiva", "cadena"];
  return { conjunto: orden.filter((a) => conjunto.has(a)), por_miembro };
}

/** Resumen de la lista de conjuntos: `marcas_en_conjunto = Σ miembros`, `conjuntos` = cabezas con al menos un miembro. */
export function resumenConjuntos(conjuntos: readonly ConjuntoFila[]): ResumenConjuntos {
  const miembros = conjuntos.flatMap((c) => c.miembros);
  return {
    conjuntos: conjuntos.length,
    marcas_en_conjunto: miembros.length,
    cabezas_inactivas: conjuntos.filter((c) => !c.efectivo).length,
    con_agrupacion_distinta: conjuntos.filter((c) => c.avisos.includes("agrupacion_distinta")).length,
    miembros_con_config_propia: miembros.filter((m) => m.avisos.includes("config_propia_ignorada")).length,
    cadenas: conjuntos.filter((c) => c.avisos.includes("cadena")).length,
  };
}

// ─── Regla 23: bloque de miembros ───

export type PlanMiembros = {
  reporte: MiembrosRespuesta;
  /** Marcas a las que hay que escribir `conjunto_marca_id = cabeza` (asignar) o `null` (quitar). */
  ids_a_escribir: string[];
};

/**
 * Regla 23. Deduplica los ids. `asignar`: ya en ese conjunto → `sin_cambio`;
 * rechazada por la regla 21 → `no_permitidas`; en otro conjunto → `asignadas`
 * más `cambiadas_de_conjunto`; el resto → `asignadas`. `quitar`: miembro de esa
 * cabeza → `quitadas`; no miembro → `sin_cambio`. Un id que no es marca →
 * `marca_no_encontrada`. Idempotente: `|ids| = asignadas + quitadas +
 * sin_cambio + |no_permitidas|`.
 *
 * Los rechazos de cada marca se evalúan sobre el estado ANTERIOR al bloque (la
 * cabeza no puede pasar a ser miembro dentro del mismo bloque porque la regla
 * `cabeza_es_miembro` ya la mira en la base y `marca_es_cabeza` frena al revés).
 */
export function planificarMiembrosBloque(
  cabezaId: string,
  accion: "asignar" | "quitar",
  marcaIds: readonly string[],
  marcas: readonly MarcaConjunto[]
): PlanMiembros {
  const porId = marcasPorId(marcas);
  const cabeza = porId.get(cabezaId);
  const reporte: MiembrosRespuesta = {
    asignadas: 0,
    quitadas: 0,
    sin_cambio: 0,
    no_permitidas: [],
    cambiadas_de_conjunto: [],
  };
  const ids_a_escribir: string[] = [];

  for (const id of new Set(marcaIds)) {
    const marca = porId.get(id);
    if (!marca) {
      reporte.no_permitidas.push({ marca_id: id, marca: "", motivo: "marca_no_encontrada" });
      continue;
    }
    if (accion === "quitar") {
      if (marca.conjunto_marca_id === cabezaId) {
        reporte.quitadas += 1;
        ids_a_escribir.push(id);
      } else {
        reporte.sin_cambio += 1;
      }
      continue;
    }
    if (marca.conjunto_marca_id === cabezaId) {
      reporte.sin_cambio += 1;
      continue;
    }
    const rechazo = motivoRechazoConjunto(marca, cabeza, marcas);
    if (rechazo) {
      reporte.no_permitidas.push({ marca_id: id, marca: marca.nombre, motivo: rechazo.motivo });
      continue;
    }
    reporte.asignadas += 1;
    ids_a_escribir.push(id);
    if (marca.conjunto_marca_id) {
      const deConjunto = porId.get(marca.conjunto_marca_id);
      const cambio: CambiadaDeConjunto = {
        marca_id: id,
        marca: marca.nombre,
        de_conjunto_id: marca.conjunto_marca_id,
        de: deConjunto?.nombre ?? "",
      };
      reporte.cambiadas_de_conjunto.push(cambio);
    }
  }
  return { reporte, ids_a_escribir };
}

/** Aplica el plan en memoria (para probar idempotencia sin base). No muta el arreglo recibido. */
export function aplicarMiembrosEnMemoria<T extends MarcaConjunto>(
  marcas: readonly T[],
  cabezaId: string,
  accion: "asignar" | "quitar",
  ids: readonly string[]
): T[] {
  const set = new Set(ids);
  return marcas.map((m) => (set.has(m.id) ? { ...m, conjunto_marca_id: accion === "asignar" ? cabezaId : null } : m));
}
