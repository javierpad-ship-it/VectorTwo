import { MESES_ANIO, normalizarCurva, redondear, sumar } from "./anios";
import { errorMax, eat as calcularEat, validacionParcial } from "./backtesting";
import { TOLERANCIA_IGUAL } from "./candidatas";
import {
  TOLERANCIA_SUMA_USUARIO,
  type AgrupacionResultado,
  type CurvaManualApi,
  type ModeloCurva,
  type PartidaCurvaUsuario,
  type TemporadaResultado,
  type VigenteResumenApi,
} from "./tipos-api";

/**
 * La curva del usuario `U` (docs/modulos/06c-curvas-composicion-y-curva-usuario.md, "Curva del usuario").
 * Funciones puras que usan igual el servidor (al aprobar) y la pantalla (en vivo): sin React, sin
 * `@supabase/*`. Doce participaciones en PORCENTAJE (de 0 a 100) escritas por el planner. Se mide con la
 * misma vara que las candidatas (EAT, error máximo, EAT parcial del año en curso y el mismo ruido), pero
 * EN MUESTRA: la curva es fija y se escribió viendo esos años.
 */

// ─── Validación y normalización ───

/**
 * Por qué una curva no sirve (`null` si sirve): doce valores finitos de 0 a 100 que suman 100 ± `TOLERANCIA_SUMA_USUARIO`
 * y no son todos cero. Los mismos mensajes que `curvaUsuarioSchema`.
 */
export function motivoCurvaUsuarioInvalida(valores: readonly number[]): string | null {
  if (valores.length !== MESES_ANIO) return "La curva debe tener doce meses.";
  for (const v of valores) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "Cada mes debe ser un número.";
    if (v < 0) return "Un mes no puede ser negativo.";
    if (v > 100) return "Un mes no puede pasar de 100 %.";
  }
  if (Math.abs(sumar(valores) - 100) > TOLERANCIA_SUMA_USUARIO) return "Los doce meses deben sumar 100 % (± 0.05).";
  if (!valores.some((v) => v > 0)) return "La curva no puede ser toda ceros.";
  return null;
}

/** Reparto proporcional a 100 (`v × 100 ÷ suma`); con suma ≤ 0 no cambia nada. */
export function normalizarA100(valores: readonly number[]): number[] {
  const total = sumar(valores);
  if (!(total > 0)) return [...valores];
  return valores.map((v) => (v * 100) / total);
}

/** Los doce porcentajes → la curva que se guarda: fracciones a seis decimales con suma exactamente 1 (`normalizarCurva`). */
export function curvaDeUsuario(valoresPorcentaje: readonly number[]): number[] {
  return normalizarCurva(valoresPorcentaje.map((v) => v / 100));
}

// ─── Pegar desde Excel ───

export type PegadoLeido =
  | {
      ok: true;
      /** Doce porcentajes. */
      valores: number[];
      /** `porcentaje`: sumaban ≈ 100; `fraccion`: sumaban ≈ 1 (× 100); `unidades`: otra cosa (se normalizaron a 100). */
      origen: "porcentaje" | "fraccion" | "unidades";
      /** Suma de lo pegado, antes de convertir. */
      suma: number;
      /** Texto para mostrar cuando se convirtió (`unidades`); `null` en el resto. */
      aviso: string | null;
    }
  | { ok: false; error: string };

const NUMERO = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/** Los tokens como números, o `null` si alguno no lo es. Con `comaDecimal` la coma es el separador decimal. */
function tokensANumeros(tokens: readonly string[], comaDecimal: boolean): number[] | null {
  const salida: number[] = [];
  for (const t of tokens) {
    const limpio = t.trim();
    if (limpio === "") continue;
    if (!NUMERO.test(limpio)) return null;
    const n = Number(comaDecimal ? limpio.replace(",", ".") : limpio);
    if (!Number.isFinite(n)) return null;
    salida.push(n);
  }
  return salida;
}

/**
 * Lee lo que se pegó desde Excel. Quita los `%`, prueba los separadores en este orden: tabulador, salto de
 * línea, `;`, espacio y `,` (el primero que deja exactamente doce números gana; con los cuatro primeros la
 * coma es decimal, con `,` como separador el decimal es el punto). Si la suma es ≈ 100 (± 0,5) son
 * porcentajes; si es ≈ 1 (± 0,005) son fracciones y se multiplican por 100; otra cosa se toma como unidades
 * y se normaliza a 100 con un aviso. Sin doce números: error con cuántos llegaron.
 */
export function parsearPegado(texto: string): PegadoLeido {
  const limpio = texto.replace(/%/g, "").replace(/\r/g, "").trim();
  if (limpio === "") return { ok: false, error: "No hay nada que pegar: copia los doce meses desde Excel." };

  const intentos: { dividir: (t: string) => string[]; comaDecimal: boolean }[] = [
    { dividir: (t) => t.split("\t"), comaDecimal: true },
    { dividir: (t) => t.split("\n"), comaDecimal: true },
    { dividir: (t) => t.split(";"), comaDecimal: true },
    { dividir: (t) => t.split(/\s+/), comaDecimal: true },
    { dividir: (t) => t.split(","), comaDecimal: false },
  ];
  let mejorConteo = 0;
  let doce: number[] | null = null;
  for (const intento of intentos) {
    const numeros = tokensANumeros(intento.dividir(limpio), intento.comaDecimal);
    if (!numeros) continue;
    if (numeros.length === MESES_ANIO) {
      doce = numeros;
      break;
    }
    mejorConteo = Math.max(mejorConteo, numeros.length);
  }
  if (!doce) {
    if (mejorConteo === 0) return { ok: false, error: "No encontré doce números en lo que pegaste: separa los meses con tabulador, salto de línea, punto y coma, espacio o coma." };
    return { ok: false, error: `Se esperaban 12 valores y llegaron ${mejorConteo}.` };
  }
  if (doce.some((n) => n < 0)) return { ok: false, error: "Un mes no puede ser negativo." };

  const suma = sumar(doce);
  if (!(suma > 0)) return { ok: false, error: "Los doce valores son cero: no hay curva que leer." };
  if (Math.abs(suma - 100) <= 0.5) return { ok: true, valores: doce, origen: "porcentaje", suma, aviso: null };
  if (Math.abs(suma - 1) <= 0.005) return { ok: true, valores: doce.map((n) => redondear(n * 100, 6)), origen: "fraccion", suma, aviso: null };
  const normalizados = normalizarA100(doce).map((n) => redondear(n, 4));
  return {
    ok: true,
    valores: normalizados,
    origen: "unidades",
    suma,
    aviso: `Los valores sumaban ${redondear(suma, 4)} y no 100: se tomaron como unidades y se normalizaron a 100 %.`,
  };
}

// ─── Punto de partida ───

const aPorcentaje = (curva: readonly number[]) => curva.map((p) => redondear(p * 100, 4));

/**
 * Los doce porcentajes (cuatro decimales) del punto de partida elegido, o `null` si no existe: una candidata
 * (`A`…`F`, `T`), un año (`participacion_real ?? participacion`) o la vigente (solo si su versión es la pedida).
 * `pegado` y `en_blanco` no tienen curva de la que partir.
 */
export function curvaDesde(
  partida: PartidaCurvaUsuario,
  resultado: Pick<AgrupacionResultado, "candidatas" | "anios"> | null,
  vigente: Pick<VigenteResumenApi, "version" | "curva"> | null
): number[] | null {
  switch (partida.tipo) {
    case "candidata": {
      const curva = resultado?.candidatas.find((c) => c.modelo === partida.referencia)?.curva ?? null;
      return curva ? aPorcentaje(curva) : null;
    }
    case "anio": {
      const anio = resultado?.anios.find((a) => String(a.anio) === partida.referencia);
      const curva = anio?.participacion_real ?? anio?.participacion ?? null;
      return curva ? aPorcentaje(curva) : null;
    }
    case "vigente": {
      if (!vigente || `v${vigente.version}` !== partida.referencia) return null;
      return aPorcentaje(vigente.curva);
    }
    default:
      return null;
  }
}

// ─── Medida en muestra ───

export type EvaluacionCurvaUsuario = CurvaManualApi & {
  /** La curva normalizada que se guardaría (seis decimales, suma 1). */
  curva: number[];
  /** Suma de lo escrito, en porcentaje. */
  suma_ingresada: number;
  /** El mismo ruido entre años normales con el que se miden las candidatas; `null` si no es medible. */
  ruido_normal: number | null;
};

/**
 * Mide la curva del usuario con la misma vara que las candidatas, pero EN MUESTRA: `eat` y `errorMax` contra
 * la participación usada de cada año de ajuste (`anios[].participacion`, la imputada si el año se imputó),
 * su promedio, la validación parcial del año en curso (también en muestra) y `igual_a` contra todas las
 * candidatas (`A`…`F`) y `T` (primera coincidencia dentro de `TOLERANCIA_IGUAL`). Sin años de ajuste, `eat_en_muestra = null`.
 * `partida` solo la copia (`en_blanco` por defecto). `eat` y `error_max` de la fila guardada NO salen de aquí: son `null`.
 */
export function evaluarCurvaUsuario(
  valores: readonly number[],
  resultado: Pick<AgrupacionResultado, "anios" | "candidatas" | "ruido_normal">,
  temporada: Pick<TemporadaResultado, "curva_T"> | null,
  partida: PartidaCurvaUsuario = { tipo: "en_blanco", referencia: null }
): EvaluacionCurvaUsuario {
  const curva = curvaDeUsuario(valores);
  const porAnio = resultado.anios
    .filter((a) => a.en_ajuste && a.participacion)
    .map((a) => ({
      anio: a.anio,
      eat: calcularEat(curva, a.participacion as number[]),
      error_max: errorMax(curva, a.participacion as number[]),
    }));
  const enCurso = resultado.anios.find((a) => a.clase === "en_curso");
  const parcial = enCurso
    ? validacionParcial(
        curva,
        { anio: enCurso.anio, meses: enCurso.meses, publicados: Array.from({ length: MESES_ANIO }, (_, m) => m < enCurso.meses_cargados) },
        enCurso.atipicos
      )
    : null;

  let igual: ModeloCurva | null = null;
  const candidatas: { modelo: ModeloCurva; curva: readonly number[] | null }[] = resultado.candidatas.filter((c) => c.modelo !== "T").map((c) => ({ modelo: c.modelo, curva: c.curva }));
  candidatas.push({ modelo: "T", curva: temporada?.curva_T ?? resultado.candidatas.find((c) => c.modelo === "T")?.curva ?? null });
  for (const c of candidatas) {
    if (!c.curva) continue;
    let max = 0;
    for (let m = 0; m < MESES_ANIO; m++) max = Math.max(max, Math.abs(curva[m] - c.curva[m]));
    if (max < TOLERANCIA_IGUAL) {
      igual = c.modelo;
      break;
    }
  }

  return {
    valores_ingresados: [...valores],
    partida,
    en_muestra: true,
    eat_en_muestra: porAnio.length > 0 ? sumar(porAnio.map((x) => x.eat)) / porAnio.length : null,
    error_max_en_muestra: porAnio.length > 0 ? sumar(porAnio.map((x) => x.error_max)) / porAnio.length : null,
    eat_en_muestra_por_anio: porAnio,
    eat_parcial_en_muestra: parcial,
    igual_a: igual,
    curva,
    suma_ingresada: sumar(valores),
    ruido_normal: resultado.ruido_normal,
  };
}

/** Lo que se guarda en `curvas_estacionalidad.curva_manual` a partir de la evaluación (sin la curva ni el ruido, que viven en otras columnas). */
export function curvaManualDe(e: EvaluacionCurvaUsuario): CurvaManualApi {
  return {
    valores_ingresados: e.valores_ingresados,
    partida: e.partida,
    en_muestra: true,
    eat_en_muestra: e.eat_en_muestra,
    error_max_en_muestra: e.error_max_en_muestra,
    eat_en_muestra_por_anio: e.eat_en_muestra_por_anio,
    eat_parcial_en_muestra: e.eat_parcial_en_muestra,
    igual_a: e.igual_a,
  };
}
