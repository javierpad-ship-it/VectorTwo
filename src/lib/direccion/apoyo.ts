import type { ApoyoApi, Exactitud, ParProyectadoSql, PrecioParSql } from "./tipos-api";

/**
 * Datos de apoyo del tablero: soles y cobertura (ficha 14, D2, §4.8 y R11). Puro. Los soles de lo proyectado NO se guardan ni salen del tablero: se
 * calculan al mostrar, valorizando cada línea × agrupación de marca a su precio medio de los últimos 12 meses, y van siempre rotulados «estimado».
 */

export type PreciosRecorte = { gml: readonly string[]; am: readonly string[]; filas: readonly PrecioParSql[] };
export type ParesRecorte = { gml: readonly string[]; am: readonly string[]; filas: readonly ParProyectadoSql[] };

export type Valorizacion = {
  /** Soles de lo proyectado de `k+1` a 12 del año en curso y de todo el año siguiente. */
  enCursoResto: number;
  siguiente: number;
  /** `Σ soles ÷ Σ unidades` de los últimos 12 meses del recorte; `null` si no vendió. */
  precio_medio: number | null;
  /** Unidades proyectadas (resto del año en curso + año siguiente) valorizadas al precio medio del recorte porque su par no vendió. */
  u_sin_precio: number;
};

const redondearSoles = (x: number): number => Math.round(x * 100) / 100;

/**
 * Valoriza lo proyectado: `Σ pares (u proyectadas × precio medio de 12 meses del par)`; un par sin venta en la ventana usa el precio medio del
 * recorte y sus unidades se cuentan en `u_sin_precio`. Sin ninguna venta en la ventana no hay precio: los soles estimados son 0 y todas las
 * unidades proyectadas cuentan como «sin precio».
 */
export function valorizar(pares: ParesRecorte, precios: PreciosRecorte): Valorizacion {
  const precioDe = new Map<string, number>();
  let u12 = 0;
  let s12 = 0;
  for (const [iGml, iAm, u, s] of precios.filas) {
    u12 += u;
    s12 += s;
    if (u > 0 && s > 0) precioDe.set(`${precios.gml[iGml]}|${precios.am[iAm]}`, s / u);
  }
  const medio = u12 > 0 && s12 > 0 ? s12 / u12 : null;
  let enCursoResto = 0;
  let siguiente = 0;
  let sinPrecio = 0;
  for (const [iGml, iAm, yResto, y1] of pares.filas) {
    const propio = precioDe.get(`${pares.gml[iGml]}|${pares.am[iAm]}`);
    const precio = propio ?? medio ?? 0;
    if (propio === undefined) sinPrecio += yResto + y1;
    enCursoResto += yResto * precio;
    siguiente += y1 * precio;
  }
  return { enCursoResto: redondearSoles(enCursoResto), siguiente: redondearSoles(siguiente), precio_medio: medio === null ? null : redondearSoles(medio), u_sin_precio: sinPrecio };
}

export type EntradaApoyo = {
  /** `Y`. */
  anio: number;
  k: number;
  kPrima: number;
  /** `aaaa-mm` de `k'`. */
  ultimoPublicado: string;
  /** Soles reales por año (de `Y−3` a `Y`), del conjunto de tiendas mostrado: año completo publicado para los anteriores y enero a `k'` para `Y`. */
  solesAnio: ReadonlyMap<number, number>;
  /** Soles reales de enero a `k` de `Y` (lo que entra en el cierre estimado). */
  solesEnCursoHastaK: number;
  pares: ParesRecorte;
  precios: PreciosRecorte;
  /**
   * Con tiendas o bloque elegidos: unidades proyectadas del conjunto mostrado (resto del año en curso y año siguiente). Los soles estimados son esas
   * unidades al precio medio que resulta de valorizar el recorte con los precios de esas tiendas. `null` = sin recorte de tienda (se valoriza par a par).
   */
  unidadesConjunto: { enCursoResto: number; siguiente: number } | null;
  stock: { por_tienda: readonly (readonly [number, number])[]; cd: number | null };
  /** Unidades proyectadas de los 12 meses que siguen a `k'` y unidades reales de los 12 meses que terminan en `k'`, del conjunto mostrado. */
  proyectado12: number | null;
  real12: number | null;
  exactitud: Exactitud;
};

const mesAnterior = (periodo: string, meses: number): string => {
  const total = Number(periodo.slice(0, 4)) * 12 + (Number(periodo.slice(5, 7)) - 1) - meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

/** Meses de cobertura (definición de M8): stock ÷ venta media mensual de 12 meses. `null` si no hay venta. */
export const mesesDeCobertura = (stock: number, unidades12: number | null): number | null => (unidades12 !== null && unidades12 > 0 ? stock / (unidades12 / 12) : null);

export function armarApoyo(e: EntradaApoyo): ApoyoApi {
  const v = valorizar(e.pares, e.precios);
  let enCursoResto = v.enCursoResto;
  let siguiente = v.siguiente;
  if (e.unidadesConjunto) {
    // Precio medio efectivo de lo proyectado en el recorte (mezcla de pares) con los precios de las tiendas elegidas.
    const uResto = e.pares.filas.reduce((a, f) => a + f[2], 0);
    const uSig = e.pares.filas.reduce((a, f) => a + f[3], 0);
    const precioResto = uResto > 0 ? v.enCursoResto / uResto : (v.precio_medio ?? 0);
    const precioSig = uSig > 0 ? v.siguiente / uSig : (v.precio_medio ?? 0);
    enCursoResto = redondearSoles(e.unidadesConjunto.enCursoResto * precioResto);
    siguiente = redondearSoles(e.unidadesConjunto.siguiente * precioSig);
  }

  const anios: ApoyoApi["soles"]["anios"] = [];
  for (let z = e.anio - 3; z <= e.anio - 1; z++) anios.push({ anio: z, s: redondearSoles(e.solesAnio.get(z) ?? 0), tipo: "real" });
  anios.push({ anio: e.anio, s: redondearSoles(e.solesAnio.get(e.anio) ?? 0), tipo: "real_parcial" });
  anios.push({ anio: e.anio, s: redondearSoles(e.solesEnCursoHastaK + enCursoResto), tipo: "estimado" });
  anios.push({ anio: e.anio + 1, s: siguiente, tipo: "estimado" });

  const stockTiendas = e.stock.por_tienda.reduce((a, t) => a + t[1], 0);
  const stockTotal = stockTiendas + (e.stock.cd ?? 0);
  return {
    soles: { anios, precio_medio: v.precio_medio, ventana: { desde: mesAnterior(e.ultimoPublicado, 11), hasta: e.ultimoPublicado }, u_sin_precio: v.u_sin_precio },
    cobertura: {
      periodo: e.ultimoPublicado,
      stock_tiendas: stockTiendas,
      stock_cd: e.stock.cd,
      imi_proyectado: mesesDeCobertura(stockTotal, e.proyectado12),
      imi_real: mesesDeCobertura(stockTotal, e.real12),
      exactitud: e.exactitud,
    },
  };
}
