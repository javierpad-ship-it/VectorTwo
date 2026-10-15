/**
 * Composición de una tienda o de un bloque de tiendas (ficha 07, paso 4 y reglas 17 y 18). Puro.
 *
 * Participación `s_f` de cada fila en los SOLES y precio medio `p_f` (soles ÷ unidades) por fila,
 * sobre los doce meses cerrados hasta `k` (`W12`), con los meses del Niño normalizados por el
 * factor de su unidad (en soles y en unidades por igual).
 */

/** Un hecho mensual de una tienda en una fila (GML × agrupación de marca). */
export type HechoTiendaFila = {
  /** Clave de la fila base (`gml|equivalencia|agrupacion_marca`, sin tienda). */
  fila: string;
  /** `aaaa-mm`. */
  periodo: string;
  unidades: number;
  venta_soles: number;
};

export type ComposicionFila = {
  fila: string;
  /** `S_f`: soles normalizados de la ventana. */
  S: number;
  /** `U_f`: unidades normalizadas de la ventana. */
  U: number;
  /** Participación en los soles; `Σ s = 1`. */
  s: number;
  /** Precio medio. */
  p: number;
};

export type ComposicionTienda = {
  filas: ComposicionFila[];
  /** `Σ S ÷ Σ U`: precio medio de la tienda (lo toma una fila sin unidades). */
  precio_medio: number;
  /** `Σ S`. */
  total_S: number;
  /** Meses de la ventana con unidades positivas en el total de la tienda. */
  meses_con_venta: number;
};

/** `φ` de la fila en un mes (`aaaa-mm`): lo pone el modelo desde los factores de la unidad. */
export type FactorDeFila = (fila: string, periodo: string) => number;

/** Regla 17. Composición de UNA tienda sobre la ventana `W12`. */
export function composicionTienda(
  hechos: readonly HechoTiendaFila[],
  ventana: readonly string[],
  factor: FactorDeFila
): ComposicionTienda {
  const dentro = new Set(ventana);
  const porFila = new Map<string, { S: number; U: number }>();
  const unidadesPorMes = new Map<string, number>();
  for (const h of hechos) {
    if (!dentro.has(h.periodo)) continue;
    const phi = factor(h.fila, h.periodo);
    const f = phi > 0 ? phi : 1;
    const acum = porFila.get(h.fila) ?? { S: 0, U: 0 };
    acum.S += h.venta_soles / f;
    acum.U += h.unidades / f;
    porFila.set(h.fila, acum);
    unidadesPorMes.set(h.periodo, (unidadesPorMes.get(h.periodo) ?? 0) + h.unidades);
  }
  const meses_con_venta = [...unidadesPorMes.values()].filter((u) => u > 0).length;

  // Una fila con soles netos negativos no aporta composición.
  const filas = [...porFila].map(([fila, v]) => ({ fila, S: Math.max(0, v.S), U: Math.max(0, v.U) }));
  const totalS = filas.reduce((a, f) => a + f.S, 0);
  const totalU = filas.reduce((a, f) => a + f.U, 0);
  const precioMedio = totalU > 0 ? totalS / totalU : 0;
  if (!(totalS > 0)) return { filas: [], precio_medio: precioMedio, total_S: 0, meses_con_venta };

  return {
    filas: filas
      .filter((f) => f.S > 0)
      .map((f) => ({ ...f, s: f.S / totalS, p: f.U > 0 ? f.S / f.U : precioMedio }))
      .sort((a, b) => a.fila.localeCompare(b.fila)),
    precio_medio: precioMedio,
    total_S: totalS,
    meses_con_venta,
  };
}

/**
 * Regla 18, sin referente. Promedio de las composiciones de las tiendas con IGUAL peso
 * (`s_f = (1 ÷ |M|) Σ_t s_{t,f}`: una tienda llega al 38 % del volumen de la red y un promedio
 * ponderado sería su composición) y precio agregado (`p_f = Σ_t S_{t,f} ÷ Σ_t U_{t,f}`).
 */
export function composicionPromedio(composiciones: readonly ComposicionTienda[]): ComposicionTienda {
  const validas = composiciones.filter((c) => c.total_S > 0);
  if (validas.length === 0) return { filas: [], precio_medio: 0, total_S: 0, meses_con_venta: 0 };

  const s = new Map<string, number>();
  const S = new Map<string, number>();
  const U = new Map<string, number>();
  for (const c of validas) {
    for (const f of c.filas) {
      s.set(f.fila, (s.get(f.fila) ?? 0) + f.s / validas.length);
      S.set(f.fila, (S.get(f.fila) ?? 0) + f.S);
      U.set(f.fila, (U.get(f.fila) ?? 0) + f.U);
    }
  }
  const totalS = [...S.values()].reduce((a, b) => a + b, 0);
  const totalU = [...U.values()].reduce((a, b) => a + b, 0);
  const precioMedio = totalU > 0 ? totalS / totalU : 0;
  const filas: ComposicionFila[] = [...s]
    .map(([fila, sf]) => {
      const u = U.get(fila) ?? 0;
      const sumaS = S.get(fila) ?? 0;
      return { fila, S: sumaS, U: u, s: sf, p: u > 0 ? sumaS / u : precioMedio };
    })
    .sort((a, b) => a.fila.localeCompare(b.fila));
  return {
    filas,
    precio_medio: precioMedio,
    total_S: totalS,
    meses_con_venta: Math.min(...validas.map((c) => c.meses_con_venta)),
  };
}

/** ¿El referente tiene doce meses cerrados de venta en la ventana? (si no: `referente_sin_historia`). */
export function tieneHistoria(c: ComposicionTienda, mesesVentana = 12): boolean {
  return c.total_S > 0 && c.meses_con_venta >= mesesVentana;
}
