import { esMarcaGenerica, marcasPorId, unidadDeMarca, type MarcaConjunto } from "@/lib/marcas/conjuntos/reglas";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import {
  GENERO_AMBITO,
  IMI_MAX_DEFECTO,
  IMI_MIN_DEFECTO,
  MARCAS_SUGERIDAS,
  MUNDOS_AMBITO,
  type CodigoRechazoRegla,
  type MotivoNoAplicable,
  type ParticipacionFilaCerrada,
  type PctDirectoObservado,
} from "./tipos-api";

/**
 * Reglas de negocio de M13 (ficha 13, secciones 5 y 8). Funciones PURAS, sin reloj (reciben el `mes`) y sin acceso a datos: los
 * handlers las llaman y no las reimplementan. Los meses son `aaaa-mm` y se comparan como texto (correcto para ese formato).
 */

/** Lo mínimo de una regla para resolver vigencias; una fila de `intercompany_reglas` ya traducida lo cumple. */
export type ReglaBase = {
  id: string;
  marca_id: string;
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  /** `aaaa-mm`. */
  vigente_desde: string;
  /** `false` solo desde el SQL Editor: se lee como regla inexistente. */
  activo?: boolean;
};

export type ClaveRegla = { marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null };

const SIN_EQUIVALENCIA = "";

/** Texto estable de una clave `(marca, nodo, equivalencia|nula)`. */
export const textoClave = (c: ClaveRegla): string => `${c.marca_id}|${c.genero_mundo_linea_id}|${c.equivalencia_id ?? SIN_EQUIVALENCIA}`;

const porVigencia = (a: ReglaBase, b: ReglaBase) => (a.vigente_desde < b.vigente_desde ? -1 : a.vigente_desde > b.vigente_desde ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const esActiva = (r: ReglaBase) => r.activo !== false;

/** Mes anterior a `mes` (`2026-01` → `2025-12`). */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const idx = a * 12 + (m - 1) - 1;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Regla 7: las reglas ACTIVAS agrupadas por clave exacta y ordenadas por `vigente_desde` (el mes nunca se repite por el único de la base). */
export function secuenciaPorClave<T extends ReglaBase>(reglas: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of reglas) {
    if (!esActiva(r)) continue;
    const k = textoClave(r);
    const l = m.get(k) ?? [];
    l.push(r);
    m.set(k, l);
  }
  for (const l of m.values()) l.sort(porVigencia);
  return m;
}

/** Regla 1: entre las reglas activas de la clave, la de mayor `vigente_desde ≤ mes`; ninguna → `null`. */
export function reglaVigente<T extends ReglaBase>(reglas: readonly T[], clave: ClaveRegla, mes: string): T | null {
  const k = textoClave(clave);
  let mejor: T | null = null;
  for (const r of reglas) {
    if (!esActiva(r) || textoClave(r) !== k || r.vigente_desde > mes) continue;
    if (mejor === null || porVigencia(mejor, r) < 0) mejor = r;
  }
  return mejor;
}

/** Regla 2: manda la regla vigente de `(marca, nodo, equivalencia)`; si no hay, la de `(marca, nodo, null)`; si no, `null`. */
export function reglaIntercompany<T extends ReglaBase>(
  reglas: readonly T[],
  marcaId: string,
  gmlId: string,
  equivalenciaId: string | null,
  mes: string
): T | null {
  if (equivalenciaId !== null) {
    const especifica = reglaVigente(reglas, { marca_id: marcaId, genero_mundo_linea_id: gmlId, equivalencia_id: equivalenciaId }, mes);
    if (especifica) return especifica;
  }
  return reglaVigente(reglas, { marca_id: marcaId, genero_mundo_linea_id: gmlId, equivalencia_id: null }, mes);
}

/**
 * Regla 3: el mes anterior al `vigente_desde` de la regla siguiente de la MISMA clave exacta, o `null` (abierta). Una regla de la
 * equivalencia no cierra la del GML.
 */
export function hastaDerivado<T extends ReglaBase>(reglas: readonly T[], regla: ReglaBase): string | null {
  let siguiente: string | null = null;
  const k = textoClave(regla);
  for (const r of reglas) {
    if (!esActiva(r) || r.id === regla.id || textoClave(r) !== k || r.vigente_desde <= regla.vigente_desde) continue;
    if (siguiente === null || r.vigente_desde < siguiente) siguiente = r.vigente_desde;
  }
  return siguiente === null ? null : mesAnterior(siguiente);
}

/** La regla anterior de la misma clave exacta (la que vuelve a regir al eliminar `regla`), o `null`. */
export function reglaAnterior<T extends ReglaBase>(reglas: readonly T[], regla: ReglaBase): T | null {
  const k = textoClave(regla);
  let previa: T | null = null;
  for (const r of reglas) {
    if (!esActiva(r) || r.id === regla.id || textoClave(r) !== k || r.vigente_desde >= regla.vigente_desde) continue;
    if (previa === null || porVigencia(previa, r) < 0) previa = r;
  }
  return previa;
}

/** `imi_min = 4` e `imi_max = 8`: el rango general de M8, sin editar. */
export const esRangoDefecto = (min: number, max: number): boolean => min === IMI_MIN_DEFECTO && max === IMI_MAX_DEFECTO;

/** `100 − pct` redondeado a dos decimales (evita `19.999999999999993`). */
export const pctCd = (pct: number): number => Math.round((100 - pct) * 100) / 100;

/**
 * `pctDirectoObservado` (subflujo.ts, regla 7 y ficha 8) devuelve FRACCIÓN 0–1; el contrato de M13 (`PctDirectoObservado.valor`,
 * como `pct_directo` y `pct_cd`) va en PUNTOS PORCENTUALES 0–100. Esta es la ÚNICA conversión: redondea a dos decimales para no
 * arrastrar ruido de coma flotante.
 */
export const fraccionAPuntos = (fraccion: number): number => Math.round(fraccion * 100 * 100) / 100;

/** El `pct_directo_observado` de una regla para el contrato: `null` si no hay dato (`V = 0` o sin conciliación); si no, `valor` en puntos 0–100. */
export function armarPctDirectoObservado(periodo: string, fraccion: number | null): PctDirectoObservado | null {
  return fraccion === null ? null : { periodo, valor: fraccionAPuntos(fraccion) };
}

// ─── Aplicabilidad ───

/**
 * Regla 4. `part_B(g)` = la participación de `B` en `por_marca` de las filas de `g` de la cerrada; si una fila no trae `por_marca`
 * (cerrada de `0.10.0`), la suma de las participaciones de `por_clave_flujo` con `marca_id = B`, sea cual sea el tipo de clave
 * (`unidad` o `barrido`). `> 0` en alguna fila del nodo → aplicable; si no, `marca_sin_clave`. Sin cerrada (`filas = null`) →
 * `aplicable = null` con `sin_cerrada`. No exige reparto de M12 ni que la marca esté marcada relevante.
 */
export function aplicable(
  regla: Pick<ReglaBase, "marca_id" | "genero_mundo_linea_id">,
  filas: readonly ParticipacionFilaCerrada[] | null
): { aplicable: boolean | null; motivo: MotivoNoAplicable | null } {
  if (filas === null) return { aplicable: null, motivo: "sin_cerrada" };
  for (const f of filas) {
    if (f.gml_id !== regla.genero_mundo_linea_id) continue;
    if (parteDeMarca(f, regla.marca_id) > 0) return { aplicable: true, motivo: null };
  }
  return { aplicable: false, motivo: "marca_sin_clave" };
}

/**
 * `part_B` de una fila de la cerrada: la participación de la marca en `por_marca` si la fila la trae; si no (cerrada de `0.10.0`), la
 * suma de las participaciones de `por_clave_flujo` con esa `marca_id`, sea cual sea el tipo de clave (`unidad` o `barrido`). La usan
 * `aplicable` y el subflujo de M8 (ficha 08, §0.2 #13): una sola definición.
 */
export function parteDeMarca(fila: Pick<ParticipacionFilaCerrada, "por_clave_flujo" | "por_marca">, marcaId: string): number {
  return fila.por_marca !== null
    ? (fila.por_marca.find((x) => x.marca_id === marcaId)?.participacion ?? 0)
    : fila.por_clave_flujo.filter((x) => x.marca_id === marcaId).reduce((a, x) => a + x.participacion, 0);
}

// ─── Ámbito ───

type PiezaNodo = { codigo?: string | null; nombre: string };

const coincide = (p: PiezaNodo, esperado: string) => normalizarNombre(p.nombre) === esperado || normalizarNombre(p.codigo ?? "") === esperado;

/**
 * Regla 6: `true` si el género no es HOMBRE o el mundo no es FORMAL, CASUAL ni RI (se compara por nombre o por código de M1: el
 * código del género HOMBRE es `H`). Informativo: la regla se guarda igual.
 */
export function fueraDeAmbito(nodo: { genero: PiezaNodo; mundo: PiezaNodo }): boolean {
  const generoOk = coincide(nodo.genero, GENERO_AMBITO) || normalizarNombre(nodo.genero.codigo ?? "") === "H";
  const mundoOk = MUNDOS_AMBITO.some((m) => coincide(nodo.mundo, m));
  return !(generoOk && mundoOk);
}

/** `true` si la marca es una de las intercompany de hoy (por nombre). Fuera de ellas se avisa, no se rechaza. */
export const esMarcaSugerida = (nombre: string): boolean => (MARCAS_SUGERIDAS as readonly string[]).includes(normalizarNombre(nombre));

// ─── Rechazos al crear ───

export type RechazoRegla = { codigo: CodigoRechazoRegla | "marca_no_encontrada" | "nodo_no_encontrado" | "equivalencia_no_encontrada"; status: 404 | 409; mensaje: string };

export type EntradaRechazo = {
  marca: MarcaConjunto | undefined;
  /** Todas las marcas (para resolver la cabeza de un conjunto). */
  marcas: readonly MarcaConjunto[];
  /** El nodo con su vigencia y su nivel (`indexarNodos`), o `undefined` si no existe. */
  nodo: { id: string; ruta: string; vigente: boolean; motivo_no_vigente: string | null; nivel_planificacion: string } | undefined;
  /** La equivalencia pedida (`null` si la regla es del GML entero). */
  equivalencia_id: string | null;
  /** La fila de la equivalencia pedida, o `undefined` si no existe. */
  equivalencia: { id: string; genero_mundo_linea_id: string; /** `false` = inactiva (el diálogo ya no la ofrece: se rechaza al crear). */ activo?: boolean } | undefined;
};

export type EstadoRechazo = {
  /** Las reglas activas que ya existen (para el único clave + mes). */
  existentes: readonly ReglaBase[];
  vigente_desde: string;
};

/**
 * Regla 9, por orden: marca inexistente (404) · VARIOS, OTROS o SIN MARCA (`marca_generica`) · miembro de un conjunto
 * (`marca_en_conjunto`, "usa JOHN HOLDEN (cabeza)") · marca inactiva · nodo inexistente (404) · nodo no vigente · equivalencia
 * inexistente (404) · equivalencia de otro nodo · equivalencia inactiva · nodo que no se planifica por equivalencia · clave y mes repetidos. Todo `409`
 * salvo los `404`. `null` si la regla se puede crear.
 */
export function motivoRechazoRegla(entrada: EntradaRechazo, estado: EstadoRechazo): RechazoRegla | null {
  const { marca, marcas, nodo } = entrada;
  if (!marca) return { codigo: "marca_no_encontrada", status: 404, mensaje: "Marca no encontrada." };
  if (esMarcaGenerica(marca.nombre)) {
    return { codigo: "marca_generica", status: 409, mensaje: `${marca.nombre} es una marca genérica (VARIOS, OTROS, SIN MARCA) y no lleva reglas de intercompany.` };
  }
  const unidad = unidadDeMarca(marca, marcas);
  if (unidad.en_conjunto) {
    const cabeza = marcasPorId(marcas).get(unidad.unidad_marca_id)?.nombre ?? "su cabeza";
    return { codigo: "marca_en_conjunto", status: 409, mensaje: `${marca.nombre} cuenta como ${cabeza}: usa ${cabeza} (cabeza).` };
  }
  if (!marca.activo) {
    return { codigo: "marca_inactiva", status: 409, mensaje: `La marca ${marca.nombre} está inactiva: reactívala antes de crearle una regla.` };
  }
  if (!nodo) return { codigo: "nodo_no_encontrado", status: 404, mensaje: "Nodo género-mundo-línea no encontrado." };
  if (!nodo.vigente) {
    const padre = nodo.motivo_no_vigente ?? "no está vigente";
    return { codigo: "nodo_no_vigente", status: 409, mensaje: `${nodo.ruta} no está vigente (${padre}): reactívalo antes de crearle una regla.` };
  }
  if (entrada.equivalencia_id !== null) {
    if (!entrada.equivalencia) return { codigo: "equivalencia_no_encontrada", status: 404, mensaje: "Equivalencia no encontrada." };
    if (entrada.equivalencia.genero_mundo_linea_id !== nodo.id) {
      return { codigo: "equivalencia_de_otro_nodo", status: 409, mensaje: `Esa equivalencia no pertenece a ${nodo.ruta}.` };
    }
    if (entrada.equivalencia.activo === false) {
      return { codigo: "equivalencia_inactiva", status: 409, mensaje: `La equivalencia de ${nodo.ruta} está inactiva: reactívala antes de crearle una regla.` };
    }
    if (nodo.nivel_planificacion !== "GMLE") {
      return { codigo: "nodo_no_gmle", status: 409, mensaje: `${nodo.ruta} se planifica por línea, no por equivalencia: la regla es del nodo entero, sin equivalencia.` };
    }
  }
  const clave: ClaveRegla = { marca_id: marca.id, genero_mundo_linea_id: nodo.id, equivalencia_id: entrada.equivalencia_id };
  if (reglaExacta(estado.existentes, clave, estado.vigente_desde)) {
    return { codigo: "clave_mes_repetido", status: 409, mensaje: "Ya hay una regla de esa clave desde ese mes: edítala." };
  }
  return null;
}

/** La regla activa de esa clave exacta con ese `vigente_desde`, o `null`. */
export function reglaExacta<T extends ReglaBase>(reglas: readonly T[], clave: ClaveRegla, vigenteDesde: string): T | null {
  const k = textoClave(clave);
  return reglas.find((r) => esActiva(r) && textoClave(r) === k && r.vigente_desde === vigenteDesde) ?? null;
}

/** Valida tope ≥ mínimo con los valores RESULTANTES de una edición. */
export const rangoValido = (min: number, max: number): boolean => max >= min;
