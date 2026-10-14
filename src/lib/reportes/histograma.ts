// Histograma de unidades vendidas por mes y año (M11 · pestaña Resumen).
// Funciones puras: armado de la matriz mes × año, variaciones, escala "bonita"
// del eje Y, geometría de las barras agrupadas y formatos. Sin React ni
// dependencias de servidor: las usa el panel del navegador y las prueba vitest.

import type { MesUnidades } from "./tipos-unidades";

export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"] as const;
export const MESES_LARGOS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Setiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** Máximo de `equivalencia_ids` que acepta el endpoint. */
export const MAX_EQUIVALENCIAS_PETICION = 5000;

// ─── Petición ───

/**
 * Ids a enviar al endpoint. Sin ningún filtro activo devuelve `null` (= todas
 * las equivalencias, no se manda cuerpo con ids); con filtros, los ids únicos
 * de las filas que pasan (puede ser `[]`).
 */
export function idsParaPeticion(ids: readonly string[], hayFiltros: boolean): string[] | null {
  if (!hayFiltros) return null;
  return [...new Set(ids)];
}

export type TipoPeticion = "todas" | "ids" | "vacia" | "excede";

/** Qué hacer con los ids: pedir todas, pedir esos ids, no llamar (ninguna) o no llamar (más de las que admite la API). */
export function clasificarPeticion(ids: readonly string[] | null): TipoPeticion {
  if (ids === null) return "todas";
  if (ids.length === 0) return "vacia";
  if (ids.length > MAX_EQUIVALENCIAS_PETICION) return "excede";
  return "ids";
}

// ─── Matriz mes × año ───

/** "2025-03" → `{ anio: 2025, mes: 2 }` (mes 0-11). `null` si el texto no es un periodo válido. */
export function parsearPeriodo(periodo: string): { anio: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return null;
  const mes = Number(m[2]) - 1;
  if (mes < 0 || mes > 11) return null;
  return { anio: Number(m[1]), mes };
}

export type MatrizMensual = {
  /** Años en orden ascendente, **continuos** entre el primero y el último con datos (un año intermedio sin datos queda como columna vacía). */
  anios: number[];
  /** `valores[iAnio][mes]` (mes 0-11); `null` = el mes no tiene datos (no es cero). */
  valores: (number | null)[][];
  /** `ventas[iAnio][mes]`, mismo criterio que `valores`. */
  ventas: (number | null)[][];
  /** Suma por año; `null` si el año no tiene ningún mes. */
  totalesAnio: (number | null)[];
  /** Suma por mes del año calendario (todos los años); `null` si ningún año tiene ese mes. */
  totalesMes: (number | null)[];
  /** Suma de todas las celdas. */
  total: number;
  /** Cantidad de celdas con dato. */
  mesesConDatos: number;
};

function sumaONulo(valores: readonly (number | null)[]): number | null {
  let suma = 0;
  let hay = false;
  for (const v of valores) {
    if (v === null) continue;
    suma += v;
    hay = true;
  }
  return hay ? suma : null;
}

/**
 * Arma la matriz mes × año. Periodos repetidos se suman, los que no son
 * "YYYY-MM" o traen un número no finito se ignoran. Sin datos válidos devuelve
 * una matriz vacía (`anios: []`).
 */
export function armarMatriz(meses: readonly MesUnidades[]): MatrizMensual {
  const porPeriodo = new Map<string, { anio: number; mes: number; unidades: number; venta: number }>();
  for (const m of meses) {
    const p = parsearPeriodo(m.periodo);
    if (!p || !Number.isFinite(m.unidades)) continue;
    const venta = Number.isFinite(m.venta_soles) ? m.venta_soles : 0;
    const clave = `${p.anio}-${p.mes}`;
    const previo = porPeriodo.get(clave);
    if (previo) {
      previo.unidades += m.unidades;
      previo.venta += venta;
    } else {
      porPeriodo.set(clave, { anio: p.anio, mes: p.mes, unidades: m.unidades, venta });
    }
  }

  if (porPeriodo.size === 0) {
    return { anios: [], valores: [], ventas: [], totalesAnio: [], totalesMes: Array(12).fill(null), total: 0, mesesConDatos: 0 };
  }

  const aniosConDatos = [...porPeriodo.values()].map((p) => p.anio);
  const primero = Math.min(...aniosConDatos);
  const ultimo = Math.max(...aniosConDatos);
  const anios: number[] = [];
  for (let a = primero; a <= ultimo; a++) anios.push(a);

  const valores = anios.map(() => Array<number | null>(12).fill(null));
  const ventas = anios.map(() => Array<number | null>(12).fill(null));
  for (const p of porPeriodo.values()) {
    valores[p.anio - primero][p.mes] = p.unidades;
    ventas[p.anio - primero][p.mes] = p.venta;
  }

  const totalesAnio = valores.map((fila) => sumaONulo(fila));
  const totalesMes = Array.from({ length: 12 }, (_, mes) => sumaONulo(valores.map((fila) => fila[mes])));
  return {
    anios,
    valores,
    ventas,
    totalesAnio,
    totalesMes,
    total: totalesAnio.reduce<number>((s, t) => s + (t ?? 0), 0),
    mesesConDatos: porPeriodo.size,
  };
}

// ─── Variación porcentual ───

/** `(actual − anterior) / |anterior| × 100`. `null` si falta alguno de los dos o el anterior es 0 (no hay base). */
export function variacionPct(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null) return null;
  if (!Number.isFinite(actual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Variación de cada mes contra el mismo mes del año anterior: `[iAnio][mes]`,
 * `null` en el primer año, donde alguno de los dos meses no existe o no hay base.
 */
export function variacionesMatriz(matriz: MatrizMensual): (number | null)[][] {
  return matriz.valores.map((fila, i) => fila.map((v, mes) => (i === 0 ? null : variacionPct(v, matriz.valores[i - 1][mes]))));
}

/**
 * Variación del total de un año contra el anterior **comparando solo los
 * meses que existen en ambos** (un 2026 con 9 meses contra un 2025 de 12 no
 * es "−25 %"). `null` en el primer año o sin meses en común.
 */
export function variacionAnual(matriz: MatrizMensual, iAnio: number): number | null {
  if (iAnio <= 0 || iAnio >= matriz.anios.length) return null;
  let actual = 0;
  let anterior = 0;
  let comunes = 0;
  for (let mes = 0; mes < 12; mes++) {
    const a = matriz.valores[iAnio][mes];
    const b = matriz.valores[iAnio - 1][mes];
    if (a === null || b === null) continue;
    actual += a;
    anterior += b;
    comunes++;
  }
  return comunes === 0 ? null : variacionPct(actual, anterior);
}

// ─── Formatos ───

/** Unidades con separador de miles es-PE y sin decimales: `12,345`. */
export function formatearUnidades(n: number): string {
  return Math.round(n).toLocaleString("es-PE", { maximumFractionDigits: 0 });
}

/** Soles sin decimales: `S/ 1,234,568`. */
export function formatearSoles(n: number): string {
  return `S/ ${Math.round(n).toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
}

/** `+12.5 %`, `-3.0 %`, `0.0 %`; `—` si no hay variación. */
export function formatearVariacion(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const redondeado = Math.round(pct * 10) / 10;
  const texto = Math.abs(redondeado).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (redondeado === 0) return `${texto} %`;
  return `${redondeado > 0 ? "+" : "-"}${texto} %`;
}

// ─── Paleta de años ───

/**
 * Tonos medios pensados para fondo claro (no hay modo oscuro todavía). El color depende
 * del **año** (no de su posición), así 2025 conserva el suyo aunque un filtro
 * deje fuera 2023. Los índices de 2023-2026 son los más distintos entre sí.
 */
export const PALETA_ANIOS: readonly string[] = [
  "#14b8a6", // 2024 · verde azulado
  "#f59e0b", // 2025 · ámbar
  "#008cff", // 2026 · azul de marca
  "#ec4899", // 2027 · rosa
  "#8b5cf6", // 2028 · violeta
  "#84cc16", // 2029 · lima
  "#ef4444", // 2030 · rojo
  "#64748b", // 2023 · pizarra
];

export function colorAnio(anio: number): string {
  const n = PALETA_ANIOS.length;
  return PALETA_ANIOS[((anio % n) + n) % n];
}

// ─── Escala del eje Y ───

export type EscalaY = {
  min: number;
  max: number;
  paso: number;
  /** De `min` a `max`, ambos incluidos, cada `paso`. */
  ticks: number[];
};

/** Menor paso "bonito" (1, 2, 2.5, 5 × 10^k) que sea ≥ `crudo`; con `entero`, el 2.5 de las unidades se salta (queda 5). */
function pasoBonito(crudo: number, entero: boolean): number {
  const exp = Math.floor(Math.log10(crudo));
  const base = 10 ** exp;
  const f = crudo / base;
  let bonito = f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 2.5 + 1e-9 ? 2.5 : f <= 5 + 1e-9 ? 5 : 10;
  if (entero && bonito === 2.5 && exp <= 0) bonito = 5;
  return bonito * base;
}

/**
 * Escala "bonita" para el eje Y: incluye siempre el cero, redondea el máximo
 * (y el mínimo si hay valores negativos, p. ej. un mes de devoluciones) a
 * múltiplos de un paso 1/2/2.5/5 × 10^k y apunta a ~`objetivo` marcas. Con
 * `entero` el paso nunca baja de 1 (unidades sueltas, sin marcas fraccionarias).
 */
export function escalaBonita(minimo: number, maximo: number, objetivo = 5, entero = true): EscalaY {
  const bajo = Number.isFinite(minimo) ? Math.min(0, minimo) : 0;
  let alto = Number.isFinite(maximo) ? Math.max(0, maximo) : 0;
  if (alto === bajo) alto = bajo + 1;

  let paso = pasoBonito((alto - bajo) / Math.max(1, objetivo), entero);
  if (entero && paso < 1) paso = 1;

  const iMin = Math.floor(bajo / paso + 1e-9);
  const iMax = Math.ceil(alto / paso - 1e-9);
  const ticks: number[] = [];
  for (let i = iMin; i <= iMax; i++) ticks.push(Math.round(i * paso * 1e9) / 1e9);
  return { min: ticks[0], max: ticks[ticks.length - 1], paso, ticks };
}

// ─── Geometría ───

export type Margen = { sup: number; der: number; inf: number; izq: number };

export type BarraGeom = {
  /** Índice en `matriz.anios`. */
  iAnio: number;
  anio: number;
  /** 0-11. */
  mes: number;
  valor: number;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  color: string;
};

export type GeometriaHistograma = {
  ancho: number;
  alto: number;
  margen: Margen;
  /** Rectángulo de dibujo (dentro de los márgenes). */
  area: { x: number; y: number; ancho: number; alto: number };
  escala: EscalaY;
  /** Y del valor cero. */
  yCero: number;
  ticks: { valor: number; y: number; etiqueta: string }[];
  grupos: { mes: number; etiqueta: string; x: number; ancho: number; centro: number }[];
  /** Solo las celdas con dato (las vacías no tienen barra). */
  barras: BarraGeom[];
};

export type OpcionesGeometria = {
  alto?: number;
  /** Ancho mínimo del viewBox: por debajo el gráfico hace scroll horizontal en vez de comprimirse. */
  anchoMinimo?: number;
  /** Ancho que se desea por barra al calcular el ancho natural. */
  anchoBarra?: number;
  /** Separación entre barras de un mismo mes. */
  hueco?: number;
};

const ANCHO_CARACTER = 6.4;

/**
 * Posiciona las barras agrupadas: 12 grupos (uno por mes) con una barra por
 * año. Las celdas sin dato no generan barra. El ancho total crece con la
 * cantidad de años para que las barras no queden más finas que ~`anchoBarra`
 * px; el contenedor hace scroll horizontal cuando no cabe.
 */
export function calcularGeometria(matriz: MatrizMensual, opciones: OpcionesGeometria = {}): GeometriaHistograma {
  const { alto = 320, anchoMinimo = 640, anchoBarra = 10, hueco = 2 } = opciones;
  const n = Math.max(1, matriz.anios.length);

  const datos = matriz.valores.flat().filter((v): v is number => v !== null);
  const escala = escalaBonita(datos.length ? Math.min(...datos) : 0, datos.length ? Math.max(...datos) : 0);
  const etiquetas = escala.ticks.map((t) => formatearUnidades(t));

  const margen: Margen = {
    sup: 12,
    der: 12,
    inf: 28,
    izq: Math.max(...etiquetas.map((e) => e.length)) * ANCHO_CARACTER + 14,
  };
  const natural = margen.izq + margen.der + 12 * (n * anchoBarra + (n - 1) * hueco + 16);
  const ancho = Math.max(anchoMinimo, Math.ceil(natural));

  const area = { x: margen.izq, y: margen.sup, ancho: ancho - margen.izq - margen.der, alto: alto - margen.sup - margen.inf };
  const rango = escala.max - escala.min;
  const yDe = (v: number) => area.y + area.alto * ((escala.max - v) / rango);
  const yCero = yDe(0);

  const anchoGrupo = area.ancho / 12;
  const anchoUtil = anchoGrupo * 0.8;
  const barra = Math.min(28, Math.max(2, (anchoUtil - hueco * (n - 1)) / n));
  const anchoBloque = n * barra + (n - 1) * hueco;

  const grupos = MESES_CORTOS.map((etiqueta, mes) => {
    const x = area.x + mes * anchoGrupo;
    return { mes, etiqueta, x, ancho: anchoGrupo, centro: x + anchoGrupo / 2 };
  });

  const barras: BarraGeom[] = [];
  for (let mes = 0; mes < 12; mes++) {
    const x0 = grupos[mes].centro - anchoBloque / 2;
    for (let i = 0; i < matriz.anios.length; i++) {
      const valor = matriz.valores[i][mes];
      if (valor === null) continue;
      const yValor = yDe(valor);
      const alturaReal = Math.abs(yValor - yCero);
      // Un valor distinto de cero nunca desaparece: mínimo 1 px.
      const altura = valor !== 0 && alturaReal < 1 ? 1 : alturaReal;
      barras.push({
        iAnio: i,
        anio: matriz.anios[i],
        mes,
        valor,
        x: x0 + i * (barra + hueco),
        y: valor >= 0 ? yCero - altura : yCero,
        ancho: barra,
        alto: altura,
        color: colorAnio(matriz.anios[i]),
      });
    }
  }

  return {
    ancho,
    alto,
    margen,
    area,
    escala,
    yCero,
    ticks: escala.ticks.map((valor, i) => ({ valor, y: yDe(valor), etiqueta: etiquetas[i] })),
    grupos,
    barras,
  };
}

/** Texto accesible de una barra: `Marzo 2025: 12,345 unidades (+4.5 % vs 2024)`. */
export function etiquetaBarra(anio: number, mes: number, valor: number, variacion: number | null): string {
  const base = `${MESES_LARGOS[mes]} ${anio}: ${formatearUnidades(valor)} unidades`;
  return variacion === null ? base : `${base} (${formatearVariacion(variacion)} vs ${anio - 1})`;
}
