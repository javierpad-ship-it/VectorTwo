import { claveGM, type MatrizCrecimientos } from "@/lib/proyeccion/crecimientos";
import type { RestoUsadoApi } from "@/lib/proyeccion/tipos-api";

/**
 * Crecimientos aprobados vigentes y su lectura desde M7 (ficha 06d §3.1). Lógica PURA, sin I/O: la lectura de la base es
 * `consultas-vigentes.ts`. Todas las funciones aceptan un `anio` opcional que filtra por `anio_aplicacion`; sin él, los `vigentes`
 * deben ser de un solo año (lo normal: `leerVigentes(db, [Y + 1])`).
 *
 * Precedencia (sin cambio de fórmula, la aplica `crearCrecimientoDe`): fila con % propio > GM aprobado vigente (solo géneros
 * detallados) > Resto aprobado vigente > `crecimiento_pct_defecto` (Resto provisional de la proyección).
 */

/** Una versión vigente (`crecimientos_genero_mundo.estado = 'vigente'`), con lo que M7 necesita. */
export type VigenteCrecimiento = {
  id: string;
  anio_aplicacion: number;
  /** `gm` o `resto`; cualquier otro valor se ignora. */
  alcance: string;
  genero_id: string | null;
  mundo_id: string | null;
  version: number;
  pct: number;
  usuario_nombre: string | null;
  /** ISO. */
  aprobada_at: string;
};

/** La `MatrizCrecimientos` del método con los ids, versiones y el Resto aprobado (los tres últimos campos son opcionales en el tipo base). */
export type MatrizDeVigentes = MatrizCrecimientos & {
  ids: ReadonlyMap<string, string>;
  versiones: ReadonlyMap<string, number>;
  resto: { id: string | null; version: number | null };
};

export type RestoUsado = RestoUsadoApi;

/** Lo que se exige aprobar para cerrar: las claves `genero_id|mundo_id` de HOMBRE y MUJER y si hace falta el Resto. */
export type ExigidosCierre = { gm: string[]; resto: boolean };

const orden = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const delAnio = (vigentes: readonly VigenteCrecimiento[], anio: number | undefined) =>
  anio === undefined ? vigentes : vigentes.filter((v) => v.anio_aplicacion === anio);

/** Entre dos versiones de la misma clave (no debería haberlas: hay un único vigente por GM y año) manda la mayor. */
const conMayorVersion = (a: VigenteCrecimiento | undefined, b: VigenteCrecimiento): VigenteCrecimiento => (a === undefined || b.version > a.version ? b : a);

function restoVigente(vigentes: readonly VigenteCrecimiento[]): VigenteCrecimiento | undefined {
  return vigentes.filter((v) => v.alcance === "resto").reduce<VigenteCrecimiento | undefined>(conMayorVersion, undefined);
}

function gmVigentes(vigentes: readonly VigenteCrecimiento[], generos: ReadonlySet<string>): Map<string, VigenteCrecimiento> {
  const porClave = new Map<string, VigenteCrecimiento>();
  for (const v of vigentes) {
    if (v.alcance !== "gm" || v.genero_id === null || v.mundo_id === null || !generos.has(v.genero_id)) continue;
    const clave = claveGM(v.genero_id, v.mundo_id);
    porClave.set(clave, conMayorVersion(porClave.get(clave), v));
  }
  return porClave;
}

/**
 * Arma la matriz del método con los GM aprobados de los géneros detallados (una versión de otro género no se aplica), sus ids y
 * versiones y el id y versión del Resto aprobado (`null` si no hay: el Resto es el provisional de la proyección).
 */
export function matrizDeVigentes(vigentes: readonly VigenteCrecimiento[], generosDetallados: Iterable<string>, anio?: number): MatrizDeVigentes {
  const generos = new Set(generosDetallados);
  const delAnioDado = delAnio(vigentes, anio);
  const celdas = new Map<string, number>();
  const ids = new Map<string, string>();
  const versiones = new Map<string, number>();
  for (const [clave, v] of gmVigentes(delAnioDado, generos)) {
    celdas.set(clave, Number(v.pct));
    ids.set(clave, v.id);
    versiones.set(clave, v.version);
  }
  const resto = restoVigente(delAnioDado);
  return { celdas, generos, ids, versiones, resto: { id: resto?.id ?? null, version: resto?.version ?? null } };
}

/** El Resto que se aplica: el aprobado vigente o, sin él, el provisional (`crecimiento_pct_defecto`, que nunca se sobrescribe). */
export function restoEfectivo(vigentes: readonly VigenteCrecimiento[], pctDefecto: number, anio?: number): RestoUsado {
  const v = restoVigente(delAnio(vigentes, anio));
  if (!v) return { pct: pctDefecto, crecimiento_id: null, version: null, por_nombre: null, at: null };
  return { pct: Number(v.pct), crecimiento_id: v.id, version: v.version, por_nombre: v.usuario_nombre, at: v.aprobada_at };
}

/**
 * Qué exige aprobar el cierre (I4): los GM distintos de `gm_gml` (`gml_id → "genero_id|mundo_id"`, los nodos con filas base) cuyo
 * género es detallado, más el Resto si algún valor es de otro género. Un GM con venta pero sin filas base no se exige.
 */
export function gmExigidos(gmGml: Readonly<Record<string, string>>, generosDetallados: Iterable<string>): ExigidosCierre {
  const generos = new Set(generosDetallados);
  const gm = new Set<string>();
  let resto = false;
  for (const clave of new Set(Object.values(gmGml))) {
    const [genero = "", mundo = ""] = clave.split("|");
    if (generos.has(genero) && mundo !== "") gm.add(clave);
    else resto = true;
  }
  return { gm: [...gm].sort(orden), resto };
}

/**
 * Lo que falta aprobar de lo exigido: los GM sin versión vigente y, si se exige el Resto, `resto_provisional = true` cuando no hay un
 * Resto aprobado (el provisional no basta). Sin faltantes: `{ gm: [], resto_provisional: false }`.
 */
export function faltantesDeCierre(exigidos: ExigidosCierre, vigentes: readonly VigenteCrecimiento[], anio?: number): { gm: string[]; resto_provisional: boolean } {
  const delAnioDado = delAnio(vigentes, anio);
  const aprobados = new Set<string>();
  for (const v of delAnioDado) if (v.alcance === "gm" && v.genero_id !== null && v.mundo_id !== null) aprobados.add(claveGM(v.genero_id, v.mundo_id));
  return {
    gm: exigidos.gm.filter((clave) => !aprobados.has(clave)),
    resto_provisional: exigidos.resto && restoVigente(delAnioDado) === undefined,
  };
}
