import { atribuirBase } from "@/lib/proyeccion/venta-por-tienda";
import { IPF_MAX_ITERACIONES, IPF_TOLERANCIA } from "./tipos-api";

/**
 * Atribución por tienda del tablero de dirección (ficha 14, §3.4). Puro: sin base de datos ni reloj.
 *
 * Tres piezas:
 *   A y B. `atribuirAnual`: el total anual de cada tienda. El año en curso es EXACTAMENTE la regla 111 de 07f (`atribuirBase`, importada tal cual, con las
 *          mismas entradas que arma `armarVentaPorTienda`); lo que la base resta por las tiendas que salen se les atribuye a ellas; el año siguiente es la
 *          base atribuida por el crecimiento del recorte.
 *   C.     `atribuirMensual`: reparto mensual genérico (ajuste biproporcional y redondeo por pisos con dos pasadas deterministas; sin mes absorbente ni
 *          arrastre). Ninguna celda sale negativa; filas y columnas cuadran exactas.
 *   D.     `atribuirTiendas`: junta las dos y arma, por tienda, sus doce meses de cada año.
 *
 * «Sin atribuir» nunca se asigna a una tienda. Por mes puede ser negativo (lo atribuido a las tiendas supera lo que el bloque proyecta ese mes).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Reparto en enteros por mayor resto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reparte `total` (entero ≥ 0) en proporción a `pesos` (los negativos pesan 0), en enteros por mayor resto; empate: la posición. Si todos pesan 0,
 * todo queda sin repartir (ceros). La suma es `total` salvo en ese caso.
 */
export function repartirMayorResto(total: number, pesos: readonly number[]): number[] {
  const w = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const suma = w.reduce((a, b) => a + b, 0);
  const t = Math.round(total);
  if (t <= 0 || suma <= 0) return w.map(() => 0);
  const exactos = w.map((p) => (t * p) / suma);
  const pisos = exactos.map((x) => Math.floor(x));
  let sobran = t - pisos.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => ({ i, f: x - pisos[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of orden) {
    if (sobran <= 0) break;
    // Un peso 0 nunca recibe (su fracción es 0 y va al final); con `sobran` < número de pesos positivos no se llega a él.
    if (w[o.i] === 0) continue;
    pisos[o.i] += 1;
    sobran -= 1;
  }
  return pisos;
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Reparto mensual (§3.4 C)
// ─────────────────────────────────────────────────────────────────────────────

export type FilaMensual = {
  id: string;
  /** Desempata el redondeo (menor primero). Dos filas con el mismo `orden` se desempatan por `id`. */
  orden: number;
  /** Entero ≥ 0. */
  total: number;
  /** Una semilla por columna; los negativos y los no numéricos valen 0. */
  semilla: readonly number[];
};

export type SalidaMensual = {
  /** `id → celdas` (una por columna), todas enteras y ≥ 0; `Σ celdas = total` de la fila. */
  celdas: Map<string, number[]>;
  /** `columnas_m − Σ filas`: puede ser negativo. Si `Σ total = Σ columnas`, todo ceros. */
  sinAtribuir: number[];
  /** Vueltas del ajuste biproporcional (0 si no hizo falta). */
  iteraciones: number;
  /** `false` si se agotaron las vueltas sin llegar a la tolerancia (el resultado sigue cumpliendo todos los invariantes). */
  convergio: boolean;
};

const entero = (x: number, que: string): number => {
  if (!Number.isInteger(x) || x < 0) throw new RangeError(`atribuirMensual: ${que} debe ser un entero mayor o igual que 0 (llegó ${x}).`);
  return x;
};

const semillaDe = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Reparte el total de cada fila entre las columnas de modo que cada columna reciba `columnas_m × T ÷ C` (su parte del total repartido), siguiendo la forma
 * de las semillas. Determinista: no depende del orden en que lleguen las filas (se ordenan por `orden` e `id`).
 *
 * Invariantes (prueba de propiedad en `tests/direccion.atribucion.test.ts`): ninguna celda negativa; `Σ_m fila_i = total_i`;
 * `Σ_filas + sinAtribuir_m = columnas_m`; si `T = C`, `sinAtribuir ≡ 0`.
 */
export function atribuirMensual(e: { filas: readonly FilaMensual[]; columnas: readonly number[] }): SalidaMensual {
  const n = e.columnas.length;
  const columnas = e.columnas.map((c) => entero(c, "cada columna"));
  const filas = [...e.filas].sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totales = filas.map((f) => entero(f.total, `el total de la fila ${f.id}`));
  const celdas = filas.map(() => new Array<number>(n).fill(0));

  const T = totales.reduce((a, b) => a + b, 0);
  const C = columnas.reduce((a, b) => a + b, 0);
  let iteraciones = 0;
  let convergio = true;

  if (T > 0 && C === 0) {
    // Paso 1, sin columnas: cada fila se reparte sola por su semilla (uniforme si no tiene), por mayor resto y empate por mes.
    filas.forEach((f, i) => {
      const pesos = Array.from({ length: n }, (_, m) => semillaDe(f.semilla[m]));
      const reparto = repartirMayorResto(totales[i], pesos.some((p) => p > 0) ? pesos : pesos.map(() => 1));
      for (let m = 0; m < n; m++) celdas[i][m] = reparto[m];
    });
  } else if (T > 0) {
    // Paso 2: las filas sin total y las columnas en 0 quedan fuera del ajuste (sus celdas son 0).
    const fi = totales.map((t, i) => (t > 0 ? i : -1)).filter((i) => i >= 0);
    const cj = columnas.map((c, j) => (c > 0 ? j : -1)).filter((j) => j >= 0);

    // Paso 3: objetivo real de cada columna, `o_m = columnas_m × T ÷ C`.
    const objetivo = cj.map((j) => (columnas[j] * T) / C);

    // Paso 4: ajuste biproporcional. Cada vuelta escala filas y DESPUÉS columnas: al terminar, las columnas cuadran en reales.
    const x = fi.map((i) => cj.map((j) => semillaDe(filas[i].semilla[j]) + 1e-9));
    convergio = false;
    for (let it = 1; it <= IPF_MAX_ITERACIONES; it++) {
      iteraciones = it;
      for (let a = 0; a < fi.length; a++) {
        let s = 0;
        for (let b = 0; b < cj.length; b++) s += x[a][b];
        const factor = totales[fi[a]] / s;
        for (let b = 0; b < cj.length; b++) x[a][b] *= factor;
      }
      for (let b = 0; b < cj.length; b++) {
        let s = 0;
        for (let a = 0; a < fi.length; a++) s += x[a][b];
        const factor = objetivo[b] / s;
        for (let a = 0; a < fi.length; a++) x[a][b] *= factor;
      }
      let desvio = 0;
      for (let a = 0; a < fi.length; a++) {
        let s = 0;
        for (let b = 0; b < cj.length; b++) s += x[a][b];
        desvio = Math.max(desvio, Math.abs(s - totales[fi[a]]));
      }
      if (desvio <= IPF_TOLERANCIA) {
        convergio = true;
        break;
      }
    }

    // Paso 5: columnas enteras por redondeo acumulado, `c_m = round(Σ_{j≤m} o_j) − round(Σ_{j<m} o_j)`, mitades hacia arriba. Con aritmética entera
    // exacta (`⌊(2·acum·T + C) ÷ 2C⌋`): `Σ c_m = T` sin depender de la coma flotante.
    const cEnteras: number[] = [];
    let acumulado = 0;
    let previo = 0;
    for (const j of cj) {
      acumulado += columnas[j];
      const redondeado = Math.floor((2 * acumulado * T + C) / (2 * C));
      cEnteras.push(redondeado - previo);
      previo = redondeado;
    }

    // Paso 6: pisos y faltantes por fila (`r`) y por columna (`s`). El piso se acota a lo que queda de su fila y de su columna: con el ajuste
    // convergido no cambia nada (los faltantes ya son ≥ 0); si no convergió, garantiza que ningún faltante sea negativo.
    const r = fi.map((i) => totales[i]);
    const s = [...cEnteras];
    const p = fi.map(() => new Array<number>(cj.length).fill(0));
    for (let a = 0; a < fi.length; a++) {
      for (let b = 0; b < cj.length; b++) {
        const piso = Math.max(0, Math.min(Math.floor(x[a][b]), r[a], s[b]));
        p[a][b] = piso;
        r[a] -= piso;
        s[b] -= piso;
      }
    }

    // Paso 7, primera pasada: por fracción descendente (empate: orden de la fila, luego mes), +1 donde a la fila y a la columna les falta.
    const porFraccion: { a: number; b: number; f: number }[] = [];
    for (let a = 0; a < fi.length; a++) for (let b = 0; b < cj.length; b++) porFraccion.push({ a, b, f: x[a][b] - Math.floor(x[a][b]) });
    porFraccion.sort((u, v) => v.f - u.f || u.a - v.a || u.b - v.b);
    for (const c of porFraccion) {
      if (r[c.a] > 0 && s[c.b] > 0) {
        p[c.a][c.b] += 1;
        r[c.a] -= 1;
        s[c.b] -= 1;
      }
    }

    // Paso 8, segunda pasada: en orden fijo (filas por orden, meses de enero a diciembre) se completa lo que quedó. Termina con todo en 0 porque
    // los faltantes de filas y de columnas suman lo mismo.
    for (let a = 0; a < fi.length; a++) {
      for (let b = 0; b < cj.length && r[a] > 0; b++) {
        const q = Math.min(r[a], s[b]);
        if (q > 0) {
          p[a][b] += q;
          r[a] -= q;
          s[b] -= q;
        }
      }
    }

    for (let a = 0; a < fi.length; a++) for (let b = 0; b < cj.length; b++) celdas[fi[a]][cj[b]] = p[a][b];
  }

  // Paso 9 (y el caso `T = 0`): lo que cada columna no recibió.
  const sinAtribuir = columnas.map((c, m) => c - celdas.reduce((a, fila) => a + fila[m], 0));
  return { celdas: new Map(filas.map((f, i) => [f.id, celdas[i]])), sinAtribuir, iteraciones, convergio };
}

// ─────────────────────────────────────────────────────────────────────────────
// A y B. Total anual por tienda (§3.4 A y B)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Situación de una tienda para la atribución, según los `bloques` guardados (la misma lectura que `clasificarTiendasVenta` de 07f):
 *   - `misma`: está en `bloques[Y+1].mismas` y no es una nueva de `Y`;
 *   - `entra`: está en `bloques[Y+1].mismas` y en `bloques[Y].nuevas` (su `Y` es exacto: sus filas de tienda);
 *   - `sale`: está en `bloques[Y].mismas` y en `bloques[Y+1].cierres`;
 *   - `otra`: cualquier otra (no recibe atribución; si tiene filas de tienda, van exactas).
 */
export type ClaseTienda = "misma" | "entra" | "sale" | "otra";

export type TiendaAtribuible = {
  id: string;
  codigo: string;
  clase: ClaseTienda;
  /** Venta de enero a `k` de `Y` en el recorte (`real_t`; `k` de la proyección, como 07f). */
  real: number;
};

export type EntradaAnual = {
  tiendas: readonly TiendaAtribuible[];
  /** `base(Y).vigente` del recorte. */
  baseEnCurso: number;
  /** `base(Y+1).B` del recorte; `null` si ningún registro tiene base (método anterior). */
  B: number | null;
  /** `base(Y+1).vigente` del recorte. */
  baseSiguiente: number;
  /** `base(Y+1).vigente_sin_B`: si es > 0, lo que no forma la base de `Y+1` no se reparte entre las tiendas que salen (M-D). */
  vigenteSinB: number;
  /** `para_base` de cada tienda que entra (vigente de sus filas de tienda cuya fila base tiene `B`). */
  paraBase: ReadonlyMap<string, number>;
};

export type SalidaAnual = {
  /** `A_t` del año en curso: las `misma` (reparto de 07f), las `entra` (su `para_base`, exacto) y las `sale` (reparto de `L`). */
  enCurso: Map<string, number>;
  /** Lo que 07f no pudo repartir entre las `misma` (puede ser negativo). */
  sinAtribuir07f: number;
  /** Lo que queda de `L` sin repartir entre las `sale` (todo `L` si es ≤ 0, si no hay `sale`, si todas pesan 0 o si hay filas sin `B`). */
  sinAtribuirSale: number;
  /** `L = base(Y).vigente − (B − Σ para_base de las que entran)`. */
  L: number;
  /** Hay registros base de `Y+1` sin `B`: `L` fue entero a «sin atribuir». */
  filasSinB: boolean;
  /** Total de `Y+1` de cada tienda de `M(Y+1)` (`misma` y `entra`). */
  siguiente: Map<string, number>;
  /** Lo de `Y+1` que no se asigna a ninguna tienda (≥ 0). */
  sinAtribuirSiguiente: number;
};

/** Identificador de la fila «sin atribuir» dentro de los repartos (no es una tienda). */
export const ID_SIN_ATRIBUIR = "~sin_atribuir";

const idCodigo = (t: TiendaAtribuible) => ({ tienda_id: t.id, codigo: t.codigo });

/**
 * Total anual por tienda (§3.4 A y B). Invariantes exactos en enteros:
 *   `Σ_{misma} A_t + sinAtribuir07f + Σ_{sale} A_t + sinAtribuirSale = baseEnCurso`
 *   `Σ siguiente + sinAtribuirSiguiente = baseSiguiente`
 * Para un GM (o el Resto) sin más filtros, `A_t` de cada `misma` es idéntico al «cierre vigente» de 07f: misma función, mismas entradas (R3).
 */
export function atribuirAnual(e: EntradaAnual): SalidaAnual {
  const mismas = e.tiendas.filter((t) => t.clase === "misma");
  const entran = e.tiendas.filter((t) => t.clase === "entra");
  const salen = e.tiendas.filter((t) => t.clase === "sale");

  // A.1: la regla 111, con `atribuirBase` de 07f tal cual.
  const paraBaseEntran = new Map(entran.map((t) => [t.id, e.paraBase.get(t.id) ?? 0]));
  const sumaEntran = [...paraBaseEntran.values()].reduce((a, v) => a + Math.round(v), 0);
  const total07f = e.B ?? sumaEntran;
  const de07f = atribuirBase({ total: total07f, entran: paraBaseEntran, mismas: mismas.map((t) => ({ ...idCodigo(t), real: t.real })) });
  const enCurso = new Map(de07f.porTienda);

  // A.2: lo que queda de la base de `Y` va a las tiendas que salen, salvo que haya filas sin `B` (no son suyas).
  const L = Math.round(e.baseEnCurso) - (Math.round(total07f) - sumaEntran);
  const filasSinB = e.vigenteSinB > 0 || e.B === null;
  let sinAtribuirSale = L;
  if (filasSinB) {
    for (const t of salen) enCurso.set(t.id, 0);
  } else {
    const deSale = atribuirBase({ total: L, entran: new Map(), mismas: salen.map((t) => ({ ...idCodigo(t), real: t.real })) });
    for (const [id, v] of deSale.porTienda) enCurso.set(id, v);
    sinAtribuirSale = deSale.sinAtribuir;
  }

  // B: el año siguiente de cada tienda es su base atribuida por el crecimiento del recorte; lo que 07f dejó sin atribuir entra como una fila más.
  const pesos = [...mismas, ...entran].map((t) => ({ ...idCodigo(t), real: enCurso.get(t.id) ?? 0 }));
  if (de07f.sinAtribuir > 0) pesos.push({ tienda_id: ID_SIN_ATRIBUIR, codigo: ID_SIN_ATRIBUIR, real: de07f.sinAtribuir });
  const deSiguiente = atribuirBase({ total: e.baseSiguiente, entran: new Map(), mismas: pesos });
  const filaSin = deSiguiente.porTienda.get(ID_SIN_ATRIBUIR) ?? 0;
  const siguiente = new Map([...deSiguiente.porTienda].filter(([id]) => id !== ID_SIN_ATRIBUIR));

  return {
    enCurso,
    sinAtribuir07f: de07f.sinAtribuir,
    sinAtribuirSale,
    L,
    filasSinB,
    siguiente,
    sinAtribuirSiguiente: filaSin + deSiguiente.sinAtribuir,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Semillas del reparto mensual (§3.4 C, «Semillas»)
// ─────────────────────────────────────────────────────────────────────────────

export type HistoriaVenta = {
  /** Venta del recorte de la tienda en ese mes (`mes` de 1 a 12); 0 si no vendió. */
  venta: (tiendaId: string, anio: number, mes: number) => number;
  /** ¿Hay carga publicada de ese mes? */
  publicado: (anio: number, mes: number) => boolean;
  /** ¿La tienda estuvo abierta los doce meses de ese año? */
  completa: (tiendaId: string, anio: number) => boolean;
};

/**
 * Semilla de cada fila en cada mes: su participación en la venta de ESE mes calendario del último año completo (`anioReferencia = Y−1`; un mes sin
 * carga se toma de `Y−2`), entre las tiendas de la llamada con historia completa ese año. Reserva (`total_t ÷ T`, la forma de la red): la tienda sin
 * historia completa en el año de referencia, en TODOS los meses; y, mes a mes, la que no vendió (si tampoco sirve el mismo mes del año previo). La
 * fila «sin atribuir» usa siempre la reserva.
 */
type EntradaSemillas = {
  filas: readonly { id: string; total: number }[];
  /** Meses calendario (1 a 12) de las columnas, en orden. */
  meses: readonly number[];
  anioReferencia: number;
  historia: HistoriaVenta;
};

/** Semillas con su origen: `propia[m] = true` si salió de la venta de ese mes (y no de la reserva `total_t ÷ T`). */
function semillasConOrigen(e: EntradaSemillas): Map<string, { semilla: number[]; propia: boolean[] }> {
  const T = e.filas.reduce((a, f) => a + Math.max(0, f.total), 0);
  const tiendas = e.filas.filter((f) => f.id !== ID_SIN_ATRIBUIR);
  const completas = (anio: number) => tiendas.filter((f) => e.historia.completa(f.id, anio));
  const denominador = new Map<string, number>();
  const den = (anio: number, mes: number): number => {
    const clave = `${anio}-${mes}`;
    let v = denominador.get(clave);
    if (v === undefined) {
      v = completas(anio).reduce((a, f) => a + Math.max(0, e.historia.venta(f.id, anio, mes)), 0);
      denominador.set(clave, v);
    }
    return v;
  };
  /** Participación de la tienda en el mes de ese año, o `null` si no sirve (sin carga, sin historia completa o sin venta). */
  const parte = (id: string, anio: number, mes: number): number | null => {
    if (!e.historia.publicado(anio, mes) || !e.historia.completa(id, anio)) return null;
    const v = e.historia.venta(id, anio, mes);
    const d = den(anio, mes);
    return v > 0 && d > 0 ? v / d : null;
  };

  const salida = new Map<string, { semilla: number[]; propia: boolean[] }>();
  for (const f of e.filas) {
    const reserva = T > 0 ? Math.max(0, f.total) / T : 0;
    if (f.id === ID_SIN_ATRIBUIR || !e.historia.completa(f.id, e.anioReferencia)) {
      salida.set(f.id, { semilla: e.meses.map(() => reserva), propia: e.meses.map(() => false) });
      continue;
    }
    const partes = e.meses.map((mes) => parte(f.id, e.anioReferencia, mes) ?? parte(f.id, e.anioReferencia - 1, mes));
    salida.set(f.id, { semilla: partes.map((x) => x ?? reserva), propia: partes.map((x) => x !== null) });
  }
  return salida;
}

export function semillasMensuales(e: EntradaSemillas): Map<string, number[]> {
  return new Map([...semillasConOrigen(e)].map(([id, x]) => [id, x.semilla]));
}

const MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const doce = (v: readonly number[]): number[] => MESES.map((m) => Math.round(v[m - 1] ?? 0));

// ─────────────────────────────────────────────────────────────────────────────
// Enero a `k` con una unidad de marca (T3d, B1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Con una unidad de marca, la base del recorte trae lo vendido GUARDADO de enero a `k` por la participación de la marca en cada fila (`base(Y).meses`),
 * no la venta real de la marca. Para que el cierre de cada tienda sume lo mismo que el del recorte (y su total anual `A_t`, que sale de esa misma base,
 * no quede por debajo de su enero a `k`), esos meses se reparten entre las tiendas atribuidas (*misma* y *sale*) mes a mes, en proporción a su venta
 * real de ese mes en el recorte (su participación del mes, como las semillas de §3.4 C), en enteros por mayor resto (empate: el orden de `ids`). Un
 * mes en que ninguna vendió (o con base ≤ 0) no se reparte: queda en «sin atribuir» de ese mes. Puro.
 *
 * Devuelve, por tienda, 12 enteros ≥ 0 (de `k+1` a diciembre, 0). Invariante: en cada mes `m ≤ k` con venta, `Σ tiendas = max(0, round(mesesBase_m))`.
 */
export function repartirVendidoGuardado(o: { ids: readonly string[]; k: number; mesesBase: readonly number[]; venta: (tiendaId: string, mes: number) => number }): Map<string, number[]> {
  const salida = new Map<string, number[]>(o.ids.map((id) => [id, MESES.map(() => 0)]));
  const k = Math.max(0, Math.min(12, Math.round(o.k)));
  for (let m = 1; m <= k; m++) {
    const reparto = repartirMayorResto(Math.max(0, Math.round(o.mesesBase[m - 1] ?? 0)), o.ids.map((id) => o.venta(id, m)));
    o.ids.forEach((id, i) => {
      const fila = salida.get(id);
      if (fila) fila[m - 1] = reparto[i];
    });
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Doce meses por tienda (§3.4 D)
// ─────────────────────────────────────────────────────────────────────────────

export type MesesTienda = {
  /** Total anual (`A_t` o el de `Y+1`). */
  anual: number;
  /** 12 celdas; `null` = sin reparto mensual en ese mes (§3.4 D). */
  meses: (number | null)[];
};

export type EntradaTiendas = EntradaAnual & {
  /**
   * T3d (B1): los meses de enero a `k` de cada tienda cuando NO son su venta real (con una unidad de marca: lo vendido guardado × participación,
   * repartido con `repartirVendidoGuardado`). Ausente = la venta real de `historia` (sin marca). Una tienda que no está en el mapa vale 0.
   */
  eneK?: ReadonlyMap<string, readonly number[]>;
  /** `Y`. */
  anio: number;
  /** Mes de `hasta_periodo` de la proyección (1 a 12). */
  k: number;
  /** `base(Y).meses` y `base(Y+1).meses` del recorte (12 enteros cada uno). */
  mesesBaseEnCurso: readonly number[];
  mesesBaseSiguiente: readonly number[];
  historia: HistoriaVenta;
};

export type SalidaTiendas = {
  anual: SalidaAnual;
  enCurso: {
    /** Las `misma` y las `sale`: enero a `k` real exacto, de `k+1` a diciembre atribuido (o `null` si no hay reparto mensual). */
    porTienda: Map<string, MesesTienda>;
    /** `sinAtribuir07f + sinAtribuirSale` (puede ser negativo). */
    sinAtribuir: number;
    /** `base(Y).meses_m − Σ tiendas`; `null` de `k+1` a diciembre si no hay reparto mensual. Puede ser negativo. */
    sinAtribuirMes: (number | null)[];
    /** `false`: alguna tienda tiene `A_t − real_t < 0` y los meses `k+1..12` no se reparten (`atribucion_sin_mensual`). */
    mensual: boolean;
  };
  siguiente: {
    /** Las tiendas de `M(Y+1)` (`misma` y `entra`). */
    porTienda: Map<string, MesesTienda>;
    sinAtribuir: number;
    /** `base(Y+1).meses_m − Σ tiendas`. Puede ser negativo. */
    sinAtribuirMes: number[];
    /**
     * La participación con que se sembró cada mes (la del mismo mes calendario del último año completo, entre las tiendas con historia completa);
     * `null` en los meses en que la tienda usó su participación anual (sin historia completa o sin venta ese mes).
     */
    participacionMes: Map<string, (number | null)[]>;
  };
};


/**
 * Atribución completa de un recorte: total anual (A y B) y reparto mensual (C y D). Se calcula SIEMPRE con todas las tiendas del recorte; quien llama
 * suma después las que le interesan. Invariantes (R8): por tienda, `Σ meses = anual` (si hay reparto mensual); por mes,
 * `Σ tiendas + sinAtribuirMes = meses` de la base; enero a `k` del año en curso es el real exacto (con `eneK`, lo que traiga: T3d).
 */
export function atribuirTiendas(e: EntradaTiendas): SalidaTiendas {
  const anual = atribuirAnual(e);
  const porCodigo = [...e.tiendas].sort((a, b) => a.codigo.localeCompare(b.codigo, "es") || a.id.localeCompare(b.id));
  const orden = new Map(porCodigo.map((t, i) => [t.id, i]));
  const ordenDe = (id: string) => (id === ID_SIN_ATRIBUIR ? porCodigo.length : (orden.get(id) ?? porCodigo.length));
  const k = Math.max(0, Math.min(12, Math.round(e.k)));
  const mesesY = doce(e.mesesBaseEnCurso);
  const mesesY1 = doce(e.mesesBaseSiguiente);

  // ── Año en curso: las `misma` y las `sale`.
  const atribuidas = porCodigo.filter((t) => t.clase === "misma" || t.clase === "sale");
  const sinAtribuirY = anual.sinAtribuir07f + anual.sinAtribuirSale;
  const resto = atribuidas.map((t) => ({ id: t.id, total: (anual.enCurso.get(t.id) ?? 0) - Math.round(t.real) }));
  const mesesResto = MESES.filter((m) => m > k);
  const mensual = mesesResto.length === 0 || resto.every((f) => f.total >= 0);
  let celdasY = new Map<string, number[]>();
  if (mensual && mesesResto.length > 0) {
    // Un «sin atribuir» anual negativo no entra como fila: su efecto aparece en `sinAtribuirMes`.
    const filas = sinAtribuirY > 0 ? [...resto, { id: ID_SIN_ATRIBUIR, total: sinAtribuirY }] : resto;
    const semillas = semillasMensuales({ filas, meses: mesesResto, anioReferencia: e.anio - 1, historia: e.historia });
    celdasY = atribuirMensual({
      filas: filas.map((f) => ({ id: f.id, orden: ordenDe(f.id), total: f.total, semilla: semillas.get(f.id) ?? [] })),
      columnas: mesesResto.map((m) => Math.max(0, mesesY[m - 1])),
    }).celdas;
  }
  const enCursoPorTienda = new Map<string, MesesTienda>();
  for (const t of atribuidas) {
    const celdas = celdasY.get(t.id);
    const meses = MESES.map((m): number | null => {
      if (m <= k) return Math.round(e.eneK ? (e.eneK.get(t.id)?.[m - 1] ?? 0) : e.historia.venta(t.id, e.anio, m));
      return mensual && celdas ? celdas[mesesResto.indexOf(m)] : null;
    });
    enCursoPorTienda.set(t.id, { anual: anual.enCurso.get(t.id) ?? 0, meses });
  }
  const sinAtribuirMesY = MESES.map((m): number | null => {
    if (m > k && !mensual) return null;
    let suma = 0;
    for (const t of enCursoPorTienda.values()) suma += t.meses[m - 1] ?? 0;
    return mesesY[m - 1] - suma;
  });

  // ── Año siguiente: las tiendas de `M(Y+1)`.
  const deBase = porCodigo.filter((t) => t.clase === "misma" || t.clase === "entra");
  const filasY1 = deBase.map((t) => ({ id: t.id, total: anual.siguiente.get(t.id) ?? 0 }));
  if (anual.sinAtribuirSiguiente > 0) filasY1.push({ id: ID_SIN_ATRIBUIR, total: anual.sinAtribuirSiguiente });
  const semillasY1 = semillasConOrigen({ filas: filasY1, meses: MESES, anioReferencia: e.anio - 1, historia: e.historia });
  const celdasY1 = atribuirMensual({
    filas: filasY1.map((f) => ({ id: f.id, orden: ordenDe(f.id), total: f.total, semilla: semillasY1.get(f.id)?.semilla ?? [] })),
    columnas: mesesY1.map((c) => Math.max(0, c)),
  }).celdas;
  const siguientePorTienda = new Map<string, MesesTienda>();
  for (const t of deBase) siguientePorTienda.set(t.id, { anual: anual.siguiente.get(t.id) ?? 0, meses: celdasY1.get(t.id) ?? MESES.map(() => 0) });
  const sinAtribuirMesY1 = MESES.map((m) => {
    let suma = 0;
    for (const t of siguientePorTienda.values()) suma += t.meses[m - 1] ?? 0;
    return mesesY1[m - 1] - suma;
  });

  return {
    anual,
    enCurso: { porTienda: enCursoPorTienda, sinAtribuir: sinAtribuirY, sinAtribuirMes: sinAtribuirMesY, mensual },
    siguiente: {
      porTienda: siguientePorTienda,
      sinAtribuir: anual.sinAtribuirSiguiente,
      sinAtribuirMes: sinAtribuirMesY1,
      participacionMes: new Map(deBase.map((t) => [t.id, MESES.map((m) => (semillasY1.get(t.id)?.propia[m - 1] ? (semillasY1.get(t.id)?.semilla[m - 1] ?? null) : null))])),
    },
  };
}
