import type { Mes } from "@/lib/compras/tipos";
import type { ParticipacionFilaCerrada } from "@/lib/intercompany/tipos-api";
import { MAX_MESES_HORIZONTE } from "./tipos";
import type { AvisoFila } from "./tipos-api";

/**
 * Filas del flujo de M8 (ficha 08, regla 1, §0.2 #2, §0.10 y §0.15). Funciones PURAS, sin reloj: `k'` entra como parámetro.
 *
 * Una fila es una unidad de planificación `g` (GML o GMLE) × agrupación de marca `a`: la misma fila GML-AM de M7, SUMANDO sus bloques
 * (mismas, nuevas, cierres; base y de tienda). Su universo son las filas de la cerrada más las `fila_sin_proyeccion`: un stock o un
 * ingreso que no tiene fila en la cerrada (demanda 0, para que nada se pierda).
 */

// ─── Meses (`aaaa-mm`; el orden alfabético es el cronológico) ───

/** `aaaa-mm` desplazado `n` meses (negativo hacia atrás). */
export function sumarMes(mes: Mes, n: number): Mes {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const indice = a * 12 + (m - 1) + n;
  return `${String(Math.floor(indice / 12)).padStart(4, "0")}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** Los meses de `desde` a `hasta`, ambos incluidos; vacío si `hasta < desde`. */
export function mesesEntre(desde: Mes, hasta: Mes): Mes[] {
  const salida: Mes[] = [];
  for (let m = desde; m <= hasta && salida.length < 1200; m = sumarMes(m, 1)) salida.push(m);
  return salida;
}

/** Cantidad de meses de `desde` a `hasta` (negativo si `hasta < desde`). */
export function diferenciaMeses(desde: Mes, hasta: Mes): number {
  return (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + (Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7)));
}

/** El `aaaa-mm` de una fecha `aaaa-mm-dd` (o de un mes). */
export const mesDeFecha = (fecha: string): Mes => fecha.slice(0, 7);

// ─── Clave de fila ───

export type ClaveFila = { gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string };

/** Texto estable de una fila `(g, a)`: nodo, equivalencia (vacía en un GML) y agrupación de marca. */
export const claveDeFila = (c: ClaveFila): string => `${c.gml_id}|${c.equivalencia_id ?? ""}|${c.agrupacion_marca_id}`;

// ─── Entrada: la cerrada ───

/** Lo que `filasFlujo` necesita de una fila de la cerrada (`FilaCerradaApi` de M7 lo cumple). */
export type FilaCerradaFlujo = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  /** `null` en las filas base; con valor, una fila de tienda nueva o de cierre. */
  tienda_id: string | null;
  anio: number;
  total: number;
  /** Doce valores, enero a diciembre de `anio`; `null` si la fila no tiene curva. */
  meses: readonly number[] | null;
  participaciones_historicas?: ParticipacionesFlujo | null;
};

/** Participaciones de la fila base (`participaciones_historicas` de M7): lo mínimo que usa el flujo. */
export type ParticipacionesFlujo = {
  por_clave_flujo: { clave_flujo?: string; marca_id: string | null; participacion: number }[];
  por_marca: { marca_id: string; participacion: number }[] | null;
};

/** Una fila de M8 antes de proyectar: demanda mensual, avisos de curva y participaciones. */
export type FilaBase = ClaveFila & {
  clave: string;
  /** `D_m` de cada mes que la cerrada cubre (suma de todas las filas con curva: base y de tienda). */
  demanda: Map<Mes, number>;
  /** Existe en la cerrada (si no, es una `fila_sin_proyeccion`). */
  en_cerrada: boolean;
  /** Todas sus filas con `total > 0` vienen sin `meses` (§0.10): se proyecta sin demanda, con IMI nulo. */
  sin_curva: boolean;
  /** Unidades (`total`) de las filas con `total > 0` y sin `meses`; con `sin_curva = false` y > 0, la fila avisa `demanda_parcial_sin_curva`. */
  unidades_sin_curva: number;
  /** `Σ total` de las filas con `total > 0` del año `anio_base` (la venta anual proyectada que `filas_sin_curva` informa). */
  venta_anual: number;
  /** De la primera fila base que las trae; `null` si no hay fila base con participaciones (`sin_participaciones`). */
  participaciones: ParticipacionesFlujo | null;
};

/** Cuerpo común de `ParticipacionFilaCerrada` para `parteDeMarca` y `aplicable` de M13. */
export function comoParticipacionFila(fila: FilaBase): ParticipacionFilaCerrada | null {
  if (!fila.participaciones) return null;
  return {
    gml_id: fila.gml_id,
    por_clave_flujo: fila.participaciones.por_clave_flujo.map((p) => ({ marca_id: p.marca_id, participacion: p.participacion })),
    por_marca: fila.participaciones.por_marca,
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Regla 1. Una fila por `(g, a)` de la cerrada sumando bloques y tiendas, más una `fila_sin_proyeccion` por cada clave de `actividad`
 * (stock o ingreso) que no esté en la cerrada. Orden estable (por clave).
 *
 *  - `D_m` de la fila = suma de los `meses` de TODAS sus filas del año de `m`. Una fila con `total` 0 o nulo y sin `meses` aporta 0 y
 *    no avisa (§0.10 a).
 *  - `sin_curva` ⇔ hay filas con `total > 0` y NINGUNA trae `meses`. Si unas traen `meses` y otras no, suma las que traen y deja las
 *    unidades que no se pudieron mensualizar en `unidades_sin_curva` (`demanda_parcial_sin_curva`).
 *  - Las participaciones son las de la primera fila base (`tienda_id` nulo) que las trae, por año ascendente.
 *
 * `anioBase` es el año de `k'+1`: el año cuya venta anual se informa en `filas_sin_curva`.
 */
export function filasFlujo(cerrada: readonly FilaCerradaFlujo[], actividad: readonly ClaveFila[], anioBase: number): FilaBase[] {
  const porClave = new Map<string, FilaCerradaFlujo[]>();
  for (const f of cerrada) {
    const clave = claveDeFila(f);
    const lista = porClave.get(clave);
    if (lista) lista.push(f);
    else porClave.set(clave, [f]);
  }

  const filas: FilaBase[] = [];
  for (const [clave, grupo] of porClave) {
    const demanda = new Map<Mes, number>();
    let conTotalConMeses = 0;
    let unidadesSinCurva = 0;
    let ventaAnual = 0;
    let participaciones: ParticipacionesFlujo | null = null;
    let anioPartic = Number.POSITIVE_INFINITY;

    for (const f of grupo) {
      const total = num(f.total);
      if (total > 0 && f.anio === anioBase) ventaAnual += total;
      if (f.meses) {
        for (let i = 0; i < 12; i++) {
          const mes = `${String(f.anio).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
          const v = num(f.meses[i]);
          if (v !== 0) demanda.set(mes, (demanda.get(mes) ?? 0) + v);
        }
        if (total > 0) conTotalConMeses += 1;
      } else if (total > 0) {
        unidadesSinCurva += total;
      }
      if (f.tienda_id === null && f.participaciones_historicas && f.anio < anioPartic) {
        participaciones = f.participaciones_historicas;
        anioPartic = f.anio;
      }
    }

    const [gml_id, eq, agr] = clave.split("|");
    filas.push({
      clave,
      gml_id,
      equivalencia_id: eq === "" ? null : eq,
      agrupacion_marca_id: agr,
      demanda,
      en_cerrada: true,
      sin_curva: unidadesSinCurva > 0 && conTotalConMeses === 0,
      unidades_sin_curva: unidadesSinCurva,
      venta_anual: ventaAnual,
      participaciones,
    });
  }

  for (const c of actividad) {
    const clave = claveDeFila(c);
    if (porClave.has(clave)) continue;
    porClave.set(clave, []);
    filas.push({
      clave,
      gml_id: c.gml_id,
      equivalencia_id: c.equivalencia_id,
      agrupacion_marca_id: c.agrupacion_marca_id,
      demanda: new Map(),
      en_cerrada: false,
      sin_curva: false,
      unidades_sin_curva: 0,
      venta_anual: 0,
      participaciones: null,
    });
  }

  return filas.sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
}

/** La demanda de la fila en cada mes de `periodos` (0 donde la cerrada no trae). */
export const demandaDeFila = (fila: Pick<FilaBase, "demanda">, periodos: readonly Mes[]): number[] => periodos.map((m) => fila.demanda.get(m) ?? 0);

/** Avisos de la fila que salen solo de su demanda (los demás los agregan el stock, los ingresos y el subflujo). */
export function avisosDeDemanda(fila: FilaBase): AvisoFila[] {
  const avisos: AvisoFila[] = [];
  if (!fila.en_cerrada) avisos.push("fila_sin_proyeccion");
  if (fila.sin_curva) avisos.push("sin_curva");
  else if (fila.unidades_sin_curva > 0) avisos.push("demanda_parcial_sin_curva");
  return avisos;
}

// ─── Horizonte (§0.15 y regla 33) ───

export type PlanHorizonte = {
  /** Año de `k'+1`. */
  anio: number;
  /** `en_curso`: la cerrada del año (hasta dic de `anio + 1`); `siguiente`: la del año anterior (hasta dic de `anio`, con `horizonte_corto`). */
  cubre: "en_curso" | "siguiente";
  /** `anio_en_curso` de la cerrada que se usa. */
  anio_cerrada: number;
  horizonte: { desde: Mes; hasta: Mes };
  /** Años de filas que se piden a `leerCerradaParaFlujo`: `[Y, Y+1]` con `en_curso`; solo el año cubierto con `siguiente`. */
  anios_a_leer: number[];
  horizonte_corto: boolean;
};

/**
 * Regla 33: `anio` = año de `k'+1`. Con una cerrada de ese año (`anio_en_curso = anio`) → `en_curso`, horizonte hasta diciembre de
 * `anio + 1`; si no, con la del año anterior → `siguiente`, hasta diciembre de `anio` (aviso `horizonte_corto`); sin ninguna → `null`
 * (`404 sin_cerrada`). El horizonte nunca pasa de `MAX_MESES_HORIZONTE` meses.
 */
export function planHorizonte(kPrima: Mes, aniosEnCurso: readonly number[]): PlanHorizonte | null {
  const desde = sumarMes(kPrima, 1);
  const anio = Number(desde.slice(0, 4));
  const tiene = new Set(aniosEnCurso);
  if (tiene.has(anio)) {
    return { anio, cubre: "en_curso", anio_cerrada: anio, horizonte: { desde, hasta: tope(desde, `${anio + 1}-12`) }, anios_a_leer: [anio, anio + 1], horizonte_corto: false };
  }
  if (tiene.has(anio - 1)) {
    return { anio, cubre: "siguiente", anio_cerrada: anio - 1, horizonte: { desde, hasta: tope(desde, `${anio}-12`) }, anios_a_leer: [anio], horizonte_corto: true };
  }
  return null;
}

function tope(desde: Mes, hasta: Mes): Mes {
  const maximo = sumarMes(desde, MAX_MESES_HORIZONTE - 1);
  return hasta < maximo ? hasta : maximo;
}
