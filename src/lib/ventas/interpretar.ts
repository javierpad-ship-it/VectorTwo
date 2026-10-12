import { esEquivalenciaGenerica, esEquivalenciaIgualALinea, normalizarNombre } from "@/lib/arbol/normalizar";
import { EQUIVALENCIA_GENERICA } from "@/lib/arbol/normalizar";
import { PERIODO_INVALIDO, leerPeriodoDetallado, recortarPeriodo } from "./periodo";
import { NUMERO_INVALIDO, aCentimos, aEntero, esComaDecimal, leerNumero, medidasEnCero, tieneCentavos } from "./numeros";
import { mapearTalla } from "./talla";
import {
  CAMPOS_VENTA,
  COMODINES_MARCA,
  ETIQUETAS_MEDIDA,
  MARCA_SIN_MARCA,
  type CampoVenta,
  type CategoriaTalla,
  type ExtrasFila,
  type FilaCruda,
  type FilaInterpretada,
  type LecturaFila,
  type MedidasC,
  type MedidaVenta,
} from "./tipos";

/**
 * Interpretación de una fila del archivo (docs/modulos/05-venta-stock.md,
 * reglas 12–16). Pura: mira solo la fila, nunca el estado de la base. La
 * resolución contra los maestros (tienda, combinación, marca) ocurre después,
 * con los valores distintos, en la previsualización.
 *
 * Precedencia de motivos (el primero que aplique gana y cada fila cuenta en
 * uno solo): `fila_total` → `mes_invalido` → `numero_invalido` →
 * `fila_en_cero` → `sin_clasificar` → tienda (`tienda_vacia`; inactiva y
 * desconocida se deciden al resolver) → `talla_desconocida` → combinación
 * (incluida `clasificacion_incompleta`, mejora M5b) → `marca_inactiva`. Las
 * tres últimas dependen de la base: la fila sale como `cargable` (o
 * `talla_desconocida`, que debe ceder ante un error de tienda) y se decide al
 * resolver. Una fila con uno o dos de género, mundo y línea en blanco ya NO se
 * excluye aquí: entra al diccionario de combinaciones con esos campos como `""`
 * y el resolutor decide `clasificacion_incompleta` (que un mapeo puede
 * reasignar). Con los tres en blanco sigue siendo `sin_clasificar`.
 */

// ─── Normalización con caché ───
// Los valores se repiten masivamente (15 tiendas, 300 marcas en 1,5 millones de
// filas): cachear evita millones de `toLocaleUpperCase`.

const MAX_CACHE = 200_000;
const cache = new Map<string, string>();

export function normalizarCacheado(valor: string): string {
  const previo = cache.get(valor);
  if (previo !== undefined) return previo;
  const n = normalizarNombre(valor);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(valor, n);
  return n;
}

// ─── Marca ───

/** `VARIOS`, `OTROS` y `SIN MARCA` (comodines: van siempre a MID VALUE). */
export function esComodin(nombreNormalizado: string): boolean {
  return COMODINES_MARCA.includes(nombreNormalizado);
}

/** Regla 13: marca vacía o `-` → `SIN MARCA`; el resto, normalizada. */
export function normalizarMarca(valor: string): string {
  const n = normalizarCacheado(valor);
  return n === "" || n === "-" ? MARCA_SIN_MARCA : n;
}

/**
 * Regla 12: `-` → nombre de la línea; vacío o `SIN EQUIVALENCIA` → `SIN EQUIVALENCIA`; otro → el valor normalizado.
 * Si la línea está en blanco (fila `clasificacion_incompleta`), `-` no tiene nombre
 * al que sustituirse: cae en `SIN EQUIVALENCIA` para que el origen de un mapeo
 * nunca tenga la equivalencia vacía.
 */
export function normalizarEquivalencia(valor: string, lineaNormalizada: string): string {
  const n = normalizarCacheado(valor);
  if (esEquivalenciaGenerica(n)) return EQUIVALENCIA_GENERICA.nombre;
  if (esEquivalenciaIgualALinea(n)) return lineaNormalizada === "" ? EQUIVALENCIA_GENERICA.nombre : lineaNormalizada;
  return n;
}

// ─── Fila ───

// Los meses y las tallas también se repiten sin fin: se resuelven una sola vez por valor.
const cachePeriodo = new Map<string, ReturnType<typeof leerPeriodoDetallado>>();
function periodoCacheado(anio: string, mes: string) {
  const clave = `${anio}\u0000${mes}`;
  let r = cachePeriodo.get(clave);
  if (r === undefined) {
    r = leerPeriodoDetallado(anio, mes);
    if (cachePeriodo.size >= MAX_CACHE) cachePeriodo.clear();
    cachePeriodo.set(clave, r);
  }
  return r;
}

const cacheTalla = new Map<string, ReturnType<typeof mapearTalla>>();
function tallaCacheada(valor: string) {
  let r = cacheTalla.get(valor);
  if (r === undefined) {
    r = mapearTalla(valor);
    if (cacheTalla.size >= MAX_CACHE) cacheTalla.clear();
    cacheTalla.set(valor, r);
  }
  return r;
}

const INDICE_CAMPO = new Map<CampoVenta, number>(CAMPOS_VENTA.map((c, i) => [c, i]));
const bit = (c: CampoVenta) => 2 ** (INDICE_CAMPO.get(c) as number);

/** Campos cuya columna entera en blanco es un error de mapeo (`equivalencia` y `anio` pueden venir vacíos). */
export const CAMPOS_EXIGIBLES: readonly CampoVenta[] = CAMPOS_VENTA.filter((c) => c !== "anio" && c !== "equivalencia");

const EXIGIBLES: readonly (readonly [CampoVenta, number])[] = CAMPOS_EXIGIBLES.map((c) => [c, bit(c)] as const);

/** Decodifica la máscara `vacios` de `LecturaFila`. */
export function camposDeMascara(mascara: number): CampoVenta[] {
  return CAMPOS_VENTA.filter((c) => (mascara & bit(c)) !== 0);
}

const MEDIDAS_ORDEN: readonly MedidaVenta[] = ["unidades", "venta_soles", "costo_vendido", "stock_unidades", "stock_valorizado"];

const vacioLegible = (v: string) => (v === "" ? "(vacío)" : v);

type MedidasLeidas = {
  medidas: MedidasC;
  extras: Pick<ExtrasFila, "decimales_unidades" | "centavos">;
  invalido: string | null;
  celdas_numericas: number;
  celdas_coma: number;
};

function leerMedidas(fila: FilaCruda): MedidasLeidas {
  let invalido: string | null = null;
  let numericas = 0;
  let coma = 0;
  let decimalesUnidades = false;

  const leer = (campo: MedidaVenta): number => {
    const texto = fila[campo];
    const n = leerNumero(texto);
    if (n === NUMERO_INVALIDO) {
      if (esComaDecimal(texto)) {
        numericas += 1;
        coma += 1;
      }
      if (invalido === null) invalido = `${ETIQUETAS_MEDIDA[campo]}: ${texto.trim() === "" ? "(vacío)" : texto.trim()}`;
      return 0;
    }
    numericas += 1;
    return n;
  };

  const unidades = aEntero(leer("unidades"));
  const stockUnidades = aEntero(leer("stock_unidades"));
  decimalesUnidades = unidades.tuvoDecimales || stockUnidades.tuvoDecimales;

  const medidas: MedidasC = {
    unidades: unidades.valor,
    venta: aCentimos(leer("venta_soles")),
    costo: aCentimos(leer("costo_vendido")),
    stock_unidades: stockUnidades.valor,
    stock_valorizado: aCentimos(leer("stock_valorizado")),
  };

  return {
    medidas,
    extras: { decimales_unidades: decimalesUnidades, centavos: tieneCentavos(medidas) },
    invalido,
    celdas_numericas: numericas,
    celdas_coma: coma,
  };
}

/** Orden en que se leen las medidas (para quien necesite mostrar la columna de un error). */
export { MEDIDAS_ORDEN };

/**
 * Interpreta una fila ya proyectada a los 14 campos (un campo sin columna
 * viaja como `""`). Reglas 12 a 16.
 */
export function interpretarFila(fila: FilaCruda): FilaInterpretada {
  const tienda = normalizarCacheado(fila.tienda);
  const genero = normalizarCacheado(fila.genero);
  const mundo = normalizarCacheado(fila.mundo);
  const linea = normalizarCacheado(fila.linea);
  const marcaCruda = normalizarCacheado(fila.marca);

  let vacios = 0;
  for (let i = 0; i < EXIGIBLES.length; i++) {
    const [campo, mascara] = EXIGIBLES[i];
    const v = fila[campo];
    if (v === "" || v.trim() === "") vacios |= mascara;
  }

  const leidas = leerMedidas(fila);
  const lectura: LecturaFila = { celdas_numericas: leidas.celdas_numericas, celdas_coma: leidas.celdas_coma, vacios };

  const periodoLeido = periodoCacheado(fila.anio, fila.mes);
  const periodo = periodoLeido === PERIODO_INVALIDO ? null : recortarPeriodo(periodoLeido.periodo);
  const diaDistinto = periodoLeido !== PERIODO_INVALIDO && periodoLeido.dia_distinto_de_1;
  const medidas = leidas.medidas;

  const excluida = (motivo: Extract<FilaInterpretada, { tipo: "excluida" }>["motivo"], valor: string): FilaInterpretada => ({
    tipo: "excluida",
    motivo,
    periodo,
    valor,
    medidas,
    ...lectura,
  });

  // 1. fila_total
  if (tienda === "TOTAL" || marcaCruda === "TOTAL" || genero === "TOTAL") return excluida("fila_total", "TOTAL");

  // 2. mes_invalido
  if (periodo === null) {
    const texto = `${fila.anio.trim()} ${fila.mes.trim()}`.trim();
    return excluida("mes_invalido", texto === "" ? "(vacío)" : texto);
  }

  // 3. numero_invalido
  if (leidas.invalido !== null) return excluida("numero_invalido", leidas.invalido);

  // 4. fila_en_cero (las cinco medidas en cero tras redondear; solo-stock no lo es)
  if (medidasEnCero(medidas)) return excluida("fila_en_cero", "");

  // 5. clasificación: solo los tres en blanco se decide aquí; uno o dos en blanco
  // (`clasificacion_incompleta`) lo decide el resolutor, después de tienda y talla.
  if (genero === "" && mundo === "" && linea === "") return excluida("sin_clasificar", "");

  // 6. tienda en blanco (inactiva y desconocida se deciden al resolver)
  if (tienda === "") return excluida("tienda_vacia", "");

  const extras: ExtrasFila = { ...leidas.extras, dia_distinto_de_1: diaDistinto };

  // 7. talla
  const talla = tallaCacheada(fila.talla);
  if (talla === null) {
    return {
      tipo: "talla_desconocida",
      periodo,
      tienda,
      talla: vacioLegible(normalizarCacheado(fila.talla)),
      medidas,
      extras,
      ...lectura,
    };
  }

  const categoria: CategoriaTalla =
    talla.agrupacion === "EXTREMAS"
      ? 1
      : !talla.revisar
        ? 0
        : talla.original === "REVISAR"
          ? 2
          : talla.original === "-"
            ? 3
            : 4;

  const equivalenciaOriginal = normalizarCacheado(fila.equivalencia);
  return {
    tipo: "cargable",
    periodo,
    tienda,
    combinacion: {
      genero,
      mundo,
      linea,
      equivalencia: normalizarEquivalencia(fila.equivalencia, linea),
      equivalencia_original: equivalenciaOriginal,
    },
    marca: normalizarMarca(fila.marca),
    talla: categoria,
    medidas,
    extras,
    ...lectura,
  };
}
