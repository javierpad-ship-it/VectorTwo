import { colorAnio, escalaBonita, formatearUnidades, MESES_CORTOS, type EscalaY, type Margen } from "@/lib/reportes/histograma";

/**
 * Geometría del gráfico de curvas superpuestas (docs/modulos/06-curvas-estacionalidad.md,
 * "Detalle de una agrupación", punto 3). Pura: calcula posiciones y trazados
 * SVG; no dibuja, no importa nada de `@supabase/*` ni de React. Reutiliza la
 * escala, los meses cortos, el color por año y el formato de unidades del
 * histograma de M11.
 *
 * Una línea por serie (año, propuesta, vigente, `T`); los valores `null` cortan
 * el trazo (un año en curso no llega a diciembre). El eje X va de enero a
 * diciembre (puntos en el centro de cada mes). Las series de participación
 * llevan FRACCIONES (0 a 1); las de unidades, unidades. Los meses de
 * `imputados`, `mesesAtipicos` y `liquidacion[].mes` van de 1 a 12.
 */

export { colorAnio, escalaBonita, formatearUnidades, MESES_CORTOS };
export type { EscalaY, Margen };

export type EstiloTrazo = "continuo" | "discontinuo" | "punteado";

export type SerieGrafico = {
  /** Identificador estable (por ejemplo `anio-2024`, `propuesta`, `vigente`, `temporada`). */
  clave: string;
  etiqueta: string;
  /** Doce valores; `null` donde no hay dato. */
  valores: readonly (number | null)[];
  color: string;
  trazo?: EstiloTrazo;
  grosor?: number;
  opacidad?: number;
  /** Meses (1 a 12) imputados: se dibujan punteados aunque el resto sea continuo. */
  imputados?: readonly number[];
};

export type EntradaGrafico = {
  series: readonly SerieGrafico[];
  /** Banda mínimo-máximo por mes (doce y doce), p. ej. `banda` del resultado. */
  banda?: { min: readonly number[]; max: readonly number[] } | null;
  /** Meses 1 a 12 con banda vertical (atípicos). */
  mesesAtipicos?: readonly number[];
  /** Puntos ámbar de liquidación: `{ clave de serie, mes 1 a 12 }`. */
  liquidacion?: readonly { clave: string; mes: number }[];
  /** `participacion` formatea el eje como porcentaje; `unidades` con separador de miles. */
  modo: "participacion" | "unidades";
};

export type OpcionesGrafico = { ancho?: number; alto?: number };

export type PuntoGrafico = { mes: number; x: number; y: number; valor: number };

export type LineaGeom = {
  clave: string;
  etiqueta: string;
  color: string;
  trazo: EstiloTrazo;
  grosor: number;
  opacidad: number;
  /** Un `path` por tramo continuo (los `null` cortan la línea). */
  tramos: string[];
  /** `path` de los tramos imputados (punteados), si hay. */
  tramosImputados: string[];
  puntos: PuntoGrafico[];
  /** `aria-label` de la polilínea. */
  aria: string;
};

export type GeometriaGrafico = {
  ancho: number;
  alto: number;
  margen: Margen;
  area: { x: number; y: number; ancho: number; alto: number };
  escala: EscalaY;
  ticksY: { valor: number; y: number; etiqueta: string }[];
  ticksX: { mes: number; x: number; etiqueta: string }[];
  lineas: LineaGeom[];
  /** Polígono (`path`) de la banda mínimo-máximo; `null` sin banda. */
  banda: string | null;
  bandasAtipicas: { mes: number; x: number; ancho: number }[];
  puntosLiquidacion: { clave: string; mes: number; x: number; y: number }[];
};

const ANCHO_CARACTER = 6.4;

/** Etiqueta del eje Y: `12,3 %` en participación (valor fracción), miles en unidades. */
export function etiquetaEjeY(valor: number, modo: "participacion" | "unidades"): string {
  if (modo === "unidades") return formatearUnidades(valor);
  const pct = Math.round(valor * 1000) / 10;
  return `${pct.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}

const redondea = (n: number) => Math.round(n * 100) / 100;

/** `M x y L x y …` de una lista de puntos. */
function trazar(puntos: readonly PuntoGrafico[]): string {
  return puntos.map((p, i) => `${i === 0 ? "M" : "L"}${redondea(p.x)} ${redondea(p.y)}`).join(" ");
}

/**
 * Posiciona todas las series en un viewBox. En modo `participacion` la escala
 * se calcula sobre porcentajes (valor × 100) para que los pasos sean 1, 2, 5 %…
 * y se vuelve a fracción para las etiquetas y los trazos.
 */
export function calcularGeometriaCurvas(entrada: EntradaGrafico, opciones: OpcionesGrafico = {}): GeometriaGrafico {
  const { ancho = 720, alto = 320 } = opciones;
  const escalaDe = entrada.modo === "participacion" ? 100 : 1;

  const valores: number[] = [];
  for (const s of entrada.series) for (const v of s.valores) if (v !== null && Number.isFinite(v)) valores.push(v);
  if (entrada.banda) for (const v of [...entrada.banda.min, ...entrada.banda.max]) if (Number.isFinite(v)) valores.push(v);

  const base = escalaBonita(
    valores.length ? Math.min(...valores) * escalaDe : 0,
    valores.length ? Math.max(...valores) * escalaDe : 0,
    5,
    entrada.modo === "unidades"
  );
  const escala: EscalaY = {
    min: base.min / escalaDe,
    max: base.max / escalaDe,
    paso: base.paso / escalaDe,
    ticks: base.ticks.map((t) => t / escalaDe),
  };
  const etiquetas = escala.ticks.map((t) => etiquetaEjeY(t, entrada.modo));

  const margen: Margen = {
    sup: 12,
    der: 12,
    inf: 28,
    izq: Math.max(...etiquetas.map((e) => e.length)) * ANCHO_CARACTER + 14,
  };
  const area = { x: margen.izq, y: margen.sup, ancho: ancho - margen.izq - margen.der, alto: alto - margen.sup - margen.inf };
  const rango = escala.max - escala.min || 1;
  const yDe = (v: number) => area.y + area.alto * ((escala.max - v) / rango);
  const anchoMes = area.ancho / 12;
  const xDe = (mes: number) => area.x + (mes - 0.5) * anchoMes;

  const lineas: LineaGeom[] = entrada.series.map((s) => {
    const puntos: PuntoGrafico[] = [];
    const tramos: string[] = [];
    const tramosImputados: string[] = [];
    let actual: PuntoGrafico[] = [];
    const cerrar = () => {
      if (actual.length > 1) tramos.push(trazar(actual));
      else if (actual.length === 1) tramos.push(`M${redondea(actual[0].x)} ${redondea(actual[0].y)}`);
      actual = [];
    };
    s.valores.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        cerrar();
        return;
      }
      const p: PuntoGrafico = { mes: i + 1, x: xDe(i + 1), y: yDe(v), valor: v };
      puntos.push(p);
      actual.push(p);
    });
    cerrar();

    // Tramos imputados: segmentos entre meses consecutivos donde alguno de los dos extremos está imputado.
    const imputados = new Set(s.imputados ?? []);
    for (let i = 1; i < puntos.length; i++) {
      const a = puntos[i - 1];
      const b = puntos[i];
      if (b.mes === a.mes + 1 && (imputados.has(a.mes) || imputados.has(b.mes))) tramosImputados.push(trazar([a, b]));
    }
    return {
      clave: s.clave,
      etiqueta: s.etiqueta,
      color: s.color,
      trazo: s.trazo ?? "continuo",
      grosor: s.grosor ?? 2,
      opacidad: s.opacidad ?? 1,
      tramos,
      tramosImputados,
      puntos,
      aria: `${s.etiqueta}: ${puntos.map((p) => `${MESES_CORTOS[p.mes - 1]} ${etiquetaEjeY(p.valor, entrada.modo)}`).join(", ")}`,
    };
  });

  let banda: string | null = null;
  if (entrada.banda && entrada.banda.min.length === 12 && entrada.banda.max.length === 12) {
    const arriba = entrada.banda.max.map((v, i) => `${redondea(xDe(i + 1))} ${redondea(yDe(v))}`);
    const abajo = entrada.banda.min.map((v, i) => `${redondea(xDe(i + 1))} ${redondea(yDe(v))}`).reverse();
    banda = `M${arriba.join(" L")} L${abajo.join(" L")} Z`;
  }

  const puntosLiquidacion: GeometriaGrafico["puntosLiquidacion"] = [];
  for (const l of entrada.liquidacion ?? []) {
    const linea = lineas.find((x) => x.clave === l.clave);
    const punto = linea?.puntos.find((p) => p.mes === l.mes);
    if (punto) puntosLiquidacion.push({ clave: l.clave, mes: l.mes, x: punto.x, y: punto.y });
  }

  return {
    ancho,
    alto,
    margen,
    area,
    escala,
    ticksY: escala.ticks.map((valor, i) => ({ valor, y: yDe(valor), etiqueta: etiquetas[i] })),
    ticksX: MESES_CORTOS.map((etiqueta, i) => ({ mes: i + 1, x: xDe(i + 1), etiqueta })),
    lineas,
    banda,
    bandasAtipicas: [...new Set(entrada.mesesAtipicos ?? [])]
      .filter((m) => m >= 1 && m <= 12)
      .sort((a, b) => a - b)
      .map((mes) => ({ mes, x: area.x + (mes - 1) * anchoMes, ancho: anchoMes })),
    puntosLiquidacion,
  };
}

/** Texto de lectura de un mes al pasar el cursor: `Mar · 2024: 12,0 % · 2025: 11,5 %`. */
export function lecturaMes(mes: number, series: readonly SerieGrafico[], modo: "participacion" | "unidades"): string {
  const partes = series
    .map((s) => ({ s, v: s.valores[mes - 1] }))
    .filter((x): x is { s: SerieGrafico; v: number } => x.v !== null && x.v !== undefined && Number.isFinite(x.v))
    .map((x) => `${x.s.etiqueta}: ${etiquetaEjeY(x.v, modo)}`);
  return `${MESES_CORTOS[mes - 1]} · ${partes.join(" · ")}`;
}

// ─── Mini curvas ───

/** El mayor valor de las curvas dadas (ignora las nulas); 0 si no hay ninguno. Sirve para dibujar varias a la misma escala. */
export function maximoComun(...curvas: ReadonlyArray<readonly number[] | null | undefined>): number {
  let max = 0;
  for (const c of curvas) if (c) for (const v of c) if (Number.isFinite(v) && v > max) max = v;
  return max;
}

/**
 * `path` de una mini curva de doce puntos en un recuadro `ancho × alto` (con 2 px
 * de borde horizontal y la base en `alto − 2`). `maximo` ≤ 0 deja la línea en la base.
 */
export function trazoMiniCurva(valores: readonly number[], ancho: number, alto: number, maximo: number): string {
  const x0 = 2;
  const x1 = ancho - 2;
  const base = alto - 2;
  const util = alto - 4;
  return valores
    .map((v, m) => {
      const x = x0 + ((x1 - x0) * m) / Math.max(1, valores.length - 1);
      const y = maximo > 0 ? base - Math.max(0, v / maximo) * util : base;
      return `${m === 0 ? "M" : "L"}${redondea(x)} ${redondea(y)}`;
    })
    .join(" ");
}
