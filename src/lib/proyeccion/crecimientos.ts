import { GENEROS_MATRIZ, UMBRAL_CORRECCION_NINO, type SobreBase } from "./tipos-api";
import type { AgregadoCrecimientoApi, CeldaParaPromedio, FilaResultadoPromedio, OrigenCrecimiento, RespuestaCrecimientosApi, ResultadoPromedio } from "./tipos-api";

/**
 * Crecimientos del año siguiente por género × mundo (ficha 07c). Lógica PURA, sin I/O y sin `node:crypto`: la importan el cálculo, el
 * servicio y también la pantalla (`calcularPromedio` corre en el navegador). Las huellas (que sí usan `node:crypto`) viven en
 * `huellas-crecimientos.ts`.
 *
 * Método 4 (06e: sigue vigente con `sobre_base = 'bruta'`): el % es BRUTO, `P = round(B × (1 + g/100))`, con `B` = vigente de `Y` de las mismas tiendas de `Y+1`, sin normalizar por el
 * Niño. Vale igual para el % propio de una fila, para una celda género × mundo y para el Resto (`crecimiento_pct_defecto`).
 * Precedencia: fila con % propio > celda GM > Resto.
 */

export { UMBRAL_CORRECCION_NINO };
export type { SobreBase };

/** Clave de una celda de la matriz: `genero_id|mundo_id`. */
export const claveGM = (generoId: string, mundoId: string): string => `${generoId}|${mundoId}`;

/**
 * La matriz que usa el método: las celdas con su % (solo de los géneros de la matriz) y los ids de esos géneros.
 *
 * `0.12.1` (06d §3.1): las tres claves opcionales llevan de qué versión aprobada sale cada %. `ids` y `versiones` van por `claveGM`; `resto`
 * es el Resto aprobado (`id = null`: no hay, el Resto es el provisional). Sin ellas (los literales de las pruebas), todo sigue igual.
 */
export type MatrizCrecimientos = {
  /** `claveGM → pct`. */
  celdas: ReadonlyMap<string, number>;
  /** Ids de los géneros que son columna de la matriz (HOMBRE, MUJER). Una celda de otro género no se aplica. */
  generos: ReadonlySet<string>;
  /** `claveGM → id` de la versión aprobada (`crecimientos_genero_mundo.id`) de la que sale la celda. */
  ids?: ReadonlyMap<string, string>;
  /** `claveGM → versión` de esa versión aprobada. */
  versiones?: ReadonlyMap<string, number>;
  /** El Resto aprobado que se aplica (`id = null` = el Resto provisional). `sobre_base` (06e): sin él, `bruta`. */
  resto?: { id: string | null; version: number | null; sobre_base?: SobreBase };
  /** 06e: `claveGM → sobre_base` de la versión aprobada. Una celda sin entrada se lee `bruta` (versión de antes de `0.14.0`). */
  sobre?: ReadonlyMap<string, SobreBase>;
};

export const MATRIZ_SIN_CELDAS: MatrizCrecimientos = { celdas: new Map(), generos: new Set() };

/** Arma la matriz del método a partir de las filas guardadas; descarta las celdas de géneros que no son columna de la matriz. */
export function matrizDeCeldas(celdas: readonly { genero_id: string; mundo_id: string; pct: number }[], generosMatriz: Iterable<string>): MatrizCrecimientos {
  const generos = new Set(generosMatriz);
  const mapa = new Map<string, number>();
  for (const c of celdas) if (generos.has(c.genero_id)) mapa.set(claveGM(c.genero_id, c.mundo_id), Number(c.pct));
  return { celdas: mapa, generos };
}

/**
 * Los géneros que son columna de la matriz, en el orden de `GENEROS_MATRIZ` (HOMBRE, MUJER): se resuelven contra `upper(trim(nombre))` de
 * los géneros ACTIVOS. Si uno no se encuentra, no aparece (sus filas siguen el Resto).
 */
export function generosDeMatriz<T extends { nombre: string; activo?: boolean }>(generos: readonly T[]): T[] {
  const salida: T[] = [];
  for (const nombre of GENEROS_MATRIZ) {
    const g = generos.find((x) => x.activo !== false && x.nombre.trim().toUpperCase() === nombre);
    if (g) salida.push(g);
  }
  return salida;
}

// ─── Precedencia ───

export type CrecimientoEfectivo = { pct: number; origen: OrigenCrecimiento };

/**
 * `crecimientoEfectivo({ pctFila, genero_id, mundo_id }, celdas, resto)`: el % que aplica a una fila base de `Y+1`.
 *   1. `pctFila` (el % escrito en la fila, `crecimiento_pct`) manda sobre todo;
 *   2. si no, la celda de su género × mundo (solo si el género es columna de la matriz, cuando se pasa `generosMatriz`);
 *   3. si no, el Resto (`crecimiento_pct_defecto`).
 * Una celda de otro GM, una celda borrada o una celda de un género fuera de la matriz no se aplican.
 */
export function crecimientoEfectivo(
  fila: { pctFila?: number | null; genero_id?: string | null; mundo_id?: string | null },
  celdas: ReadonlyMap<string, number>,
  resto: number,
  generosMatriz?: ReadonlySet<string>
): CrecimientoEfectivo {
  if (fila.pctFila !== null && fila.pctFila !== undefined) return { pct: Number(fila.pctFila), origen: "fila" };
  if (fila.genero_id && fila.mundo_id && (generosMatriz === undefined || generosMatriz.has(fila.genero_id))) {
    const celda = celdas.get(claveGM(fila.genero_id, fila.mundo_id));
    if (celda !== undefined) return { pct: celda, origen: "celda" };
  }
  return { pct: resto, origen: "resto" };
}

/** Nodo → su GM y su nombre legible («HOMBRE · URBANO»). */
export type GMDeNodo = (gmlId: string) => { genero_id: string; mundo_id: string; nombre: string } | undefined;

/**
 * El % efectivo de una fila con su GM (`gm` = `claveGM`, `celda` = nombre del GM). `version` (`0.12.1`): versión aprobada del GM o del Resto
 * que dio el %; `null` en el % propio de la fila y en el Resto provisional. `provisional`: el % es el Resto provisional.
 */
export type CrecimientoDeFila = CrecimientoEfectivo & {
  gm: string | null;
  celda: string | null;
  version?: number | null;
  provisional?: boolean;
  /** 06e: sobre qué base se aplica el %. % propio de la fila y Resto provisional: `corregida`; GM y Resto aprobados: el de su versión (sin dato, `bruta`). Opcional en el tipo (los literales de `decision.ts` aún no lo traen), siempre presente en lo que arma `crearCrecimientoDe`. */
  sobre_base?: SobreBase;
};

/** `gml_id` de una clave base (`|gml|equivalencia|agrupacion_marca`) o de una clave de fila (`tienda|gml|…`). */
export const gmlDeClave = (clave: string): string => clave.split("|")[1] ?? "";

/**
 * Arma `crecimientoDe(claveBase, pctFila?)` de un cálculo o de una decisión en vivo. El nodo da el paso de la clave base al GM. Sin
 * `pctFila` explícito, usa `pctFilaDe(claveBase)` (el % propio guardado de la fila de `Y+1`). Reemplaza a las lambdas del cálculo y del
 * contexto en vivo.
 */
export function crearCrecimientoDe(args: {
  matriz: MatrizCrecimientos;
  resto: number;
  gmDe: GMDeNodo;
  pctFilaDe?: (claveBase: string) => number | null | undefined;
}): (claveBase: string, pctFila?: number | null) => CrecimientoDeFila {
  return (claveBase, pctFila) => {
    const gm = args.gmDe(gmlDeClave(claveBase));
    const propio = pctFila === undefined ? (args.pctFilaDe?.(claveBase) ?? null) : pctFila;
    const e = crecimientoEfectivo({ pctFila: propio, genero_id: gm?.genero_id, mundo_id: gm?.mundo_id }, args.matriz.celdas, args.resto, args.matriz.generos);
    const clave = gm ? claveGM(gm.genero_id, gm.mundo_id) : null;
    const resto = args.matriz.resto;
    const version = e.origen === "celda" && clave !== null ? (args.matriz.versiones?.get(clave) ?? null) : e.origen === "resto" ? (resto?.version ?? null) : null;
    const provisional = e.origen === "resto" && (resto === undefined || resto.id === null);
    const sobre_base: SobreBase =
      e.origen === "fila" || provisional ? "corregida" : e.origen === "celda" ? ((clave !== null ? args.matriz.sobre?.get(clave) : undefined) ?? "bruta") : (resto?.sobre_base ?? "bruta");
    return { ...e, gm: clave, celda: gm?.nombre ?? null, version, provisional, sobre_base };
  };
}

// ─── Agregados de una celda o del Resto ───

/** Una fila base activa de `Y+1`, con lo que hace falta para agregar. */
export type FilaCrecimiento = {
  fila_id: string;
  genero_id: string;
  mundo_id: string;
  /** `crecimiento_pct` guardado en la fila de `Y+1` (% propio) o `null`. */
  crecimiento_pct: number | null;
  decidido: number | null;
  propuesto: number | null;
  /** `B`. `null` = sin base. */
  base_siguiente: number | null;
  /** `B''` (método 5: `B'`, la base corregida del Niño). */
  base_normalizada: number | null;
  /** 06e: con qué base se aplica el % propio de la fila. Sin él, `bruta` (método 4). El cálculo del método 5 pasa `corregida`. */
  sobre_base?: SobreBase;
};

const vigenteDe = (f: Pick<FilaCrecimiento, "decidido" | "propuesto">): number => f.decidido ?? f.propuesto ?? 0;
export const redondearUnidades = (x: number): number => Math.max(0, Math.round(x));
const conCrecimiento = (b: number, pct: number): number => redondearUnidades(b * (1 + pct / 100));

export function agregadoVacio(): AgregadoCrecimientoApi {
  return {
    filas: 0,
    filas_sin_base: 0,
    base: 0,
    base_libre: 0,
    base_libre_corregida: 0,
    pct_propio: { filas: 0, base: 0, siguiente: 0, base_corregida: 0 },
    decididas: { filas: 0, base: 0, siguiente: 0, base_corregida: 0 },
    base_normalizada: 0,
    rebote_nino_pct: null,
    siguiente_vigente: 0,
  };
}

/**
 * Agrega las filas base de `Y+1` de un conjunto (una celda o el Resto). Una fila con total decidido cuenta en `decididas` (también si
 * tiene % propio); una con % propio y sin total, en `pct_propio`; el resto sigue la celda (`base_libre`).
 */
export function agregarFilas(filas: readonly FilaCrecimiento[]): AgregadoCrecimientoApi {
  const a = agregadoVacio();
  let hayNino = false;
  for (const f of filas) {
    a.filas += 1;
    a.siguiente_vigente += vigenteDe(f);
    const b = f.base_siguiente;
    if (b === null) a.filas_sin_base += 1;
    const base = b ?? 0;
    const baseCorregida = b === null ? 0 : (f.base_normalizada ?? b);
    a.base += base;
    if (f.decidido !== null) {
      a.decididas.filas += 1;
      a.decididas.base += base;
      a.decididas.base_corregida = (a.decididas.base_corregida ?? 0) + baseCorregida;
      a.decididas.siguiente += f.decidido;
    } else if (f.crecimiento_pct !== null) {
      a.pct_propio.filas += 1;
      a.pct_propio.base += base;
      a.pct_propio.base_corregida = (a.pct_propio.base_corregida ?? 0) + baseCorregida;
      a.pct_propio.siguiente += b === null ? 0 : conCrecimiento(f.sobre_base === "corregida" ? baseCorregida : b, f.crecimiento_pct);
    } else {
      a.base_libre += base;
      a.base_libre_corregida = (a.base_libre_corregida ?? 0) + baseCorregida;
    }
    if (b !== null) {
      a.base_normalizada += baseCorregida;
      if (Math.abs(baseCorregida - b) > 0.005) hayNino = true;
    }
  }
  a.rebote_nino_pct = hayNino && a.base > 0 ? (a.base_normalizada / a.base - 1) * 100 : null;
  return a;
}

// ─── Celdas obligatorias ───

/**
 * Las celdas género × mundo que deben venir en un guardado: todo par de los géneros de la matriz × mundo con al menos una fila base activa
 * de `Y+1` (una celda «sin filas» no es obligatoria). Devuelve las que faltan, en el orden de `pares`.
 */
export function celdasFaltantes<T extends { genero_id: string; mundo_id: string }>(pares: readonly T[], enviadas: ReadonlySet<string>): T[] {
  return pares.filter((p) => !enviadas.has(claveGM(p.genero_id, p.mundo_id)));
}

// ─── «Calcular promedio» (puro, en el navegador) ───

/**
 * `calcularPromedio(celdas, resto, objetivo, puente)` (ficha 07c §5.2). Requiere la matriz completa: con alguna celda vacía (con filas)
 * devuelve `resultado = null` y la lista de las que faltan. Es una estimación: puede diferir del recálculo en ±0,5 u por fila por el
 * redondeo.
 *
 * 06e: con `opciones.sobre = 'corregida'` el % de cada conjunto se aplica sobre `Σ B'` (los GM libres siguen `base_libre_corregida`), se
 * pondera por `Σ B'` y `pct_resultante` es «sobre 2026 corregido» (`pct_resultante_real`, sobre `Σ B`). Sin la opción, método 4 (`Σ B`).
 */
export function calcularPromedio(
  celdas: readonly CeldaParaPromedio[],
  resto: { pct: number; agregado: AgregadoCrecimientoApi },
  objetivoPct: number | null,
  puente: RespuestaCrecimientosApi["puente"],
  opciones: { sobre?: SobreBase } = {}
): { resultado: ResultadoPromedio | null; faltan: { genero: string; mundo: string }[] } {
  const faltan = celdas.filter((c) => !c.sin_filas && c.pct === null).map((c) => ({ genero: c.genero, mundo: c.mundo }));
  if (faltan.length > 0) return { resultado: null, faltan };

  const conjuntos: { genero: string | null; mundo: string | null; pct: number; agregado: AgregadoCrecimientoApi }[] = [
    ...celdas.filter((c) => !c.sin_filas && c.pct !== null).map((c) => ({ genero: c.genero, mundo: c.mundo, pct: c.pct as number, agregado: c.agregado })),
    { genero: null, mundo: null, pct: resto.pct, agregado: resto.agregado },
  ];
  const corregida = opciones.sobre === "corregida";
  let baseTotal = 0;
  let escrito = 0;
  let siguienteTotal = 0;
  let propias = 0;
  let decididas = 0;
  const filas: FilaResultadoPromedio[] = conjuntos.map((c) => {
    const a = c.agregado;
    const base = corregida ? a.base_normalizada : a.base;
    const baseLibre = corregida ? (a.base_libre_corregida ?? a.base_libre) : a.base_libre;
    const s = a.pct_propio.siguiente + a.decididas.siguiente + baseLibre * (1 + c.pct / 100);
    baseTotal += base;
    escrito += base * c.pct;
    siguienteTotal += s;
    propias += a.pct_propio.filas;
    decididas += a.decididas.filas;
    return {
      genero: c.genero,
      mundo: c.mundo,
      base,
      pct_escrito: c.pct,
      siguiente: s,
      pct_resultante: base > 0 ? (s / base - 1) * 100 : null,
      ...(corregida ? { pct_resultante_real: a.base > 0 ? (s / a.base - 1) * 100 : null } : {}),
    };
  });
  const sinBase = !(baseTotal > 0);
  const ponderado = sinBase ? null : escrito / baseTotal;
  const resultante = sinBase ? null : (siguienteTotal / baseTotal - 1) * 100;
  const objetivo =
    objetivoPct === null
      ? null
      : {
          pct: objetivoPct,
          faltan_pp_escrito: ponderado === null ? null : objetivoPct - ponderado,
          faltan_pp_resultado: resultante === null ? null : objetivoPct - resultante,
          faltan_unidades: sinBase ? null : baseTotal * (1 + objetivoPct / 100) - siguienteTotal,
        };
  const totalSiguiente = siguienteTotal + puente.nuevas_anterior + puente.aperturas + puente.cierres;
  return {
    resultado: {
      ponderado_escrito_pct: ponderado,
      filas,
      base_total: baseTotal,
      siguiente_total: siguienteTotal,
      resultante_pct: resultante,
      filas_con_pct_propio: propias,
      filas_decididas: decididas,
      objetivo,
      puente: {
        base: baseTotal,
        mismas_siguiente: siguienteTotal,
        nuevas_anterior: puente.nuevas_anterior,
        aperturas: puente.aperturas,
        cierres: puente.cierres,
        cierres_sin_decidir: puente.cierres_sin_decidir,
        total_siguiente: totalSiguiente,
        total_en_curso: puente.total_en_curso,
        var_pct: puente.total_en_curso > 0 ? (totalSiguiente / puente.total_en_curso - 1) * 100 : null,
      },
      sin_base: sinBase,
    },
    faltan: [],
  };
}
