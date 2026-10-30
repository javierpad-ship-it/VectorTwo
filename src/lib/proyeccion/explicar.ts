import { formatearDecimal, formatearNumero } from "@/lib/formato";
import type { Metodo, OrigenComposicion, SobreBase } from "./tipos-api";

/**
 * La frase de cada cifra (ficha 07, regla 27). Pura: recibe las entradas del cálculo y devuelve el texto con el
 * formato numérico `es-PE` de `src/lib/formato.ts` (el mismo del servidor y de la pantalla). Nombra el método, las
 * cifras de entrada, la curva y su versión, el Niño si aplica y, con `plan_anterior`, el nombre de la cerrada usada.
 */

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

const u = (n: number) => formatearNumero(Math.round(n));
const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"] as const;
/** «15 de marzo» de `aaaa-mm-dd`; «su fecha de apertura» si no hay fecha. */
const fechaCorta = (fecha: string | null | undefined): string => {
  const m = fecha ? /^\d{4}-(\d{2})-(\d{2})/.exec(fecha) : null;
  return m ? `el ${Number(m[2])} de ${MES_LARGO[Number(m[1]) - 1]}` : "en su fecha de apertura";
};
const pct = (fraccion: number) => `${formatearDecimal(fraccion * 100, 1)} %`;

/** "ene–set" para los primeros `k` meses; "ene" si `k = 1`. */
export function rangoMeses(desde: number, hasta: number): string {
  if (hasta < desde) return "";
  return desde === hasta ? MES_CORTO[desde - 1] : `${MES_CORTO[desde - 1]}–${MES_CORTO[hasta - 1]}`;
}

/**
 * El % de crecimiento tal como se lee en una explicación: un decimal como mínimo y dos como máximo (7.5, 7.25). Se muestra el % y no el
 * factor redondeado para que la cuenta de la frase se reproduzca: «1,860 × (1 + 7.5 %)» da 2,000, y «× 1.08» (de 1.075) daría 2,009.
 */
function textoPctCrecimiento(g: number): string {
  return g.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Los meses con `φ ≠ 1` agrupados en tramos consecutivos del mismo valor: "set ÷ 1.24" o "oct–dic × 1.24". */
function tramosNino(phi: readonly number[], desde: number, hasta: number): { desde: number; hasta: number; factor: number }[] {
  const tramos: { desde: number; hasta: number; factor: number }[] = [];
  for (let m = desde; m <= hasta; m++) {
    const f = phi[m - 1] ?? 1;
    if (Math.abs(f - 1) < 1e-9) continue;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.hasta === m - 1 && Math.abs(ultimo.factor - f) < 1e-9) ultimo.hasta = m;
    else tramos.push({ desde: m, hasta: m, factor: f });
  }
  return tramos;
}


/**
 * Cómo se corrigió la base por el Niño de `Y`: «÷ 0,80, relativo» con `φ` constante (el invierno completo) o «set–dic ÷ 1,50» por tramos (el
 * verano). «Relativo» solo en invierno: es la temporada cuyo factor sale de la fórmula relativa (el de verano lo escribe el planner).
 */
function textoFactorBase(phi: readonly number[] | undefined, temporada: string | null | undefined): string {
  if (!phi || phi.every((f) => Math.abs(f - 1) < 1e-9)) return "";
  const relativo = temporada === "invierno" ? ", relativo" : "";
  const constante = phi.every((f) => Math.abs(f - phi[0]) < 1e-9);
  if (constante) return `÷ ${formatearDecimal(phi[0], 2)}${relativo}`;
  return `${tramosNino(phi, 1, 12).map((t) => `${rangoMeses(t.desde, t.hasta)} ÷ ${formatearDecimal(t.factor, 2)}`).join(", ")}${relativo}`;
}

/** «8 % de HOMBRE · URBANO v2, sobre 2026 corregido»: el % aplicado, su origen y sobre qué base se escribió. */
function textoPctAplicado(g: number, o: EntradaExplicar["crecimientoOrigen"], sobre: SobreBase, anioEnCurso: number): string {
  const gTexto = textoPctCrecimiento(g);
  const version = (v: number | null | undefined) => (v === null || v === undefined ? "" : ` v${v}`);
  const origen = !o
    ? ""
    : o.origen === "celda"
      ? o.celda
        ? ` de ${o.celda}${version(o.version)}`
        : " de sus celdas"
      : o.origen === "fila"
        ? " propio de la fila"
        : o.provisional
          ? " del Resto provisional"
          : ` del Resto${version(o.version)}`;
  const base = sobre === "corregida" ? `sobre ${anioEnCurso} corregido` : `sobre ${anioEnCurso} real, aprobado antes de 0.14.0`;
  return `${gTexto} %${origen}, ${base}`;
}

/** Explicación del Niño de un año para el cierre: qué meses se dividen y cuáles se multiplican. */
export function textoNinoCierre(phi: readonly number[] | undefined, k: number): string | null {
  if (!phi || phi.every((f) => Math.abs(f - 1) < 1e-9)) return null;
  const constante = phi.every((f) => Math.abs(f - phi[0]) < 1e-9);
  if (constante) {
    return `Año Niño completo (factor ${formatearDecimal(phi[0], 2)}): el factor se cancela y el cierre es el vendido ÷ avance.`;
  }
  const reales = tramosNino(phi, 1, k).map((t) => `${rangoMeses(t.desde, t.hasta)} ÷ ${formatearDecimal(t.factor, 2)}`);
  const resto = tramosNino(phi, k + 1, 12).map((t) => `${rangoMeses(t.desde, t.hasta)} × ${formatearDecimal(t.factor, 2)}`);
  const partes: string[] = [];
  if (reales.length > 0) partes.push(`${reales.join(", ")} antes de dividir por el avance`);
  if (resto.length > 0) partes.push(resto.join(", "));
  return `Meses del Niño: ${partes.join("; ")}.`;
}

export type EntradaExplicar = {
  metodo: Metodo;
  anio: number;
  anioEnCurso: number;
  /** Último mes cerrado (1 a 12); 0 en el año siguiente. */
  k: number;
  vendido: number;
  propuesto: number | null;
  /** "DENIM HO v1" (o la mezcla "A v1 (80 %) + B v2 (20 %)"); `null` sin curva. */
  curvaTexto: string | null;
  tiendas?: number;
  /** `C_k`. */
  avance?: number | null;
  /** `φ` del año explicado. */
  phi?: readonly number[];
  /** `φ` del año siguiente (explicación de `crecimiento`). */
  phiObjetivo?: readonly number[];
  restoMeses?: readonly number[] | null;
  planAnterior?: { nombre: string; total: number } | null;
  referenciaAlternativa?: number | null;
  referenciaTresMeses?: number | null;
  // Año siguiente (método `crecimiento`).
  baseVigente?: number | null;
  /** `B`: base de las mismas tiendas de `Y+1`, real (sin corregir por el Niño). */
  baseTotal?: number | null;
  /** `B'` (método 5): `B` corregida del Niño de `Y`; es la base del % cuando `sobreBase` es `corregida`. */
  baseCorregida?: number | null;
  /** `0.14.0`: sobre qué base se escribió el % que se aplicó. Sin dato, `corregida` (método 5). */
  sobreBase?: SobreBase;
  /** Temporada de la unidad («invierno», «verano»…) para decir en qué temporada fue Niño. */
  temporada?: string | null;
  /** Cuántas tiendas son las mismas de `Y+1` («de las 10 tiendas de 2027»). */
  tiendasSiguiente?: number;
  /**
   * `0.10.8` (07c): de dónde sale el % que se aplicó y, si es de una celda, su nombre. `0.14.0`: la `version` aprobada del GM o del Resto y si el
   * Resto es el provisional de la proyección.
   */
  crecimientoOrigen?: { origen: "fila" | "celda" | "resto"; celda: string | null; version?: number | null; provisional?: boolean };
  /** `0.10.8`: el % de una tienda `maduro_propio` es el ponderado de sus combinaciones (no un único % con origen). */
  crecimientoPonderado?: boolean;
  crecimiento?: number;
  aportes?: readonly { tienda: string; total: number; signo: 1 | -1 }[];
  // Tiendas.
  tienda?: { codigo: string; nombre: string };
  referente?: string | null;
  origenComposicion?: OrigenComposicion;
  ventaEsperada?: number | null;
  unidadesMaduras?: number | null;
  rampa?: readonly number[];
  apertura?: string | null;
  fechaCierre?: string | null;
  mesesCompletos?: number;
  /** `A`: el total maduro de la tienda (suma de sus filas). */
  totalMaduro?: number | null;
  /** `V'`: lo vendido de `1..k` llevado a nivel normal por el Niño (`avance_propio`). */
  vendidoNormalizado?: number | null;
  /** `F`: la fracción de un año maduro que la tienda alcanza en su año de apertura (`apertura`). */
  fraccionAnioApertura?: number | null;
  /** `S = 12 V`: el año maduro en soles (`apertura`, `0.10.8`). */
  anioMaduroSoles?: number | null;
  /** `E = 12 V F`: los soles del año de apertura (`apertura`, `0.10.8`). */
  ventaAnioApertura?: number | null;
  /**
   * Fila de cola larga PARA REVISIÓN (`avance`, `0.10.1`): la propuesta es la demanda corregida por disponibilidad y la cifra de
   * avance normal (`referenciaAlternativa`) va al lado.
   */
  /** Año siguiente (`crecimiento`) de una fila para revisión sin decidir en `Y`: la base de `Y` es la venta corregida `A_f`. */
  baseColaLarga?: number | null;
  colaLarga?: { demandaCorregida: number; disponibilidad: number; tiendaMesesConStock: number; tiendaMeses: number; umbral: number } | null;
};

function textoResto(restoMeses: readonly number[] | null | undefined, k: number): string {
  if (!restoMeses) return "";
  const meses = restoMeses.slice(k);
  if (meses.length === 0) return "";
  const total = meses.reduce((a, b) => a + b, 0);
  return `; resto ${rangoMeses(k + 1, 12)} ${u(total)} (${meses.map((m) => u(m)).join(" · ")})`;
}

function textoOrigen(o: OrigenComposicion | undefined, referente: string | null | undefined): string {
  if (o === "referente" && referente) return `composición de ${referente}`;
  if (o === "propia") return "composición propia";
  return "composición promedio de las mismas tiendas";
}

/**
 * `A = V' ÷ Σ c·r = 12,000 ÷ 25.0 % = 48,000 (…)`: el total maduro con sus dos entradas. `Σ c·r` es el denominador efectivo
 * (`V' ÷ A`: con varias filas es el promedio ponderado de las suyas). Sin `A` (la frase rehecha tras cambiar una rampa) no inventa cifras: nombra el método con palabras.
 */
function textoTotalMaduro(e: EntradaExplicar, curva: string): string {
  const A = e.totalMaduro;
  const v = e.vendidoNormalizado;
  if (A === null || A === undefined) return `total maduro por avance propio (vendido normalizado ÷ Σ curva × rampa; curvas: ${curva}) → `;
  if (v === null || v === undefined || !(A > 0)) return `total maduro A = ${u(A)} (vendido normalizado ÷ Σ curva × rampa; curvas: ${curva}) → `;
  return `total maduro A = V' ÷ Σ c·r = ${u(v)} ÷ ${pct(v / A)} = ${u(A)} (V' vendido normalizado por el Niño; c·r curva × rampa; curvas: ${curva}) → `;
}

/** Regla 27. La frase de un registro según su método. */
export function explicar(e: EntradaExplicar): string {
  const curva = e.curvaTexto ?? "sin curva vigente";
  switch (e.metodo) {
    case "avance": {
      if (e.colaLarga) {
        const c = e.colaLarga;
        const alt = e.referenciaAlternativa === null || e.referenciaAlternativa === undefined ? "—" : u(e.referenciaAlternativa);
        const poco = e.planAnterior
          ? ` Con poco avance de la curva (${pct(e.avance ?? 0)}) la proyección cerrada «${e.planAnterior.nombre}» tenía ${u(e.planAnterior.total)}, pero la propuesta es la venta corregida.`
          : "";
        const partes = [
          `${e.anio} → cola larga con quiebres de stock: disponibilidad ${pct(c.disponibilidad)} (${formatearNumero(c.tiendaMesesConStock)} de ${formatearNumero(c.tiendaMeses)} tienda-meses con stock al cierre del mes). ` +
            `La propuesta es la venta corregida por disponibilidad y estacionalidad: ${u(c.demandaCorregida)} u (≥ ${u(c.umbral)}: para revisión)` +
            `${e.propuesto !== null && Math.round(e.propuesto) !== Math.round(c.demandaCorregida) ? `, con lo vendido ${rangoMeses(1, e.k)} (${u(e.vendido)}) como mínimo` : ""}` +
            `; por avance normal (vendido ${rangoMeses(1, e.k)} ${u(e.vendido)} ÷ avance ${pct(e.avance ?? 0)}, ${curva}) saldrían ${alt}${textoResto(e.restoMeses, e.k)}.${poco}`,
        ];
        const nino = textoNinoCierre(e.phi, e.k);
        if (nino) partes.push(nino);
        return partes.join(" ");
      }
      const partes = [
        `${e.anio} → vendido ${rangoMeses(1, e.k)} ${u(e.vendido)}${e.tiendas !== undefined ? ` (${formatearNumero(e.tiendas)} ${e.tiendas === 1 ? "tienda" : "tiendas"})` : ""} ÷ avance ${pct(e.avance ?? 0)} (${curva}) = ${e.propuesto === null ? "sin cifra" : u(e.propuesto)}${textoResto(e.restoMeses, e.k)}.`,
      ];
      const nino = textoNinoCierre(e.phi, e.k);
      if (nino) partes.push(nino);
      return partes.join(" ");
    }
    case "plan_anterior": {
      const plan = e.planAnterior;
      const alt = e.referenciaAlternativa;
      return (
        `${e.anio} → con ${formatearNumero(e.k)} ${e.k === 1 ? "mes" : "meses"} la curva (${curva}) solo explica el ${pct(e.avance ?? 0)}: ` +
        `se propone el total de ${e.anio} de la proyección cerrada${plan ? ` «${plan.nombre}» (${u(plan.total)})` : ""}` +
        `, nunca menos de lo vendido (${u(e.vendido)}); por avance saldrían ${alt === null || alt === undefined ? "—" : u(alt)}.`
      );
    }
    case "crecimiento": {
      const aportes = (e.aportes ?? []).map((a) => `${a.signo > 0 ? "+" : "−"} ${a.tienda} ${u(a.total)}`).join(" ");
      const g = e.crecimiento ?? 0;
      const sobre: SobreBase = e.sobreBase ?? "corregida";
      const objetivo =
        e.phiObjetivo && tramosNino(e.phiObjetivo, 1, 12).length > 0
          ? ` ${e.anio} marcado como Niño: por ahora el % no lo incluye (no se aprueba ni se cierra hasta decidirlo); el reparto usa el factor.`
          : "";
      const corregida =
        e.baseColaLarga !== null && e.baseColaLarga !== undefined
          ? ` La cifra de ${e.anioEnCurso} de esta fila es la venta corregida por quiebres de stock (${u(e.baseColaLarga)}), no el avance normal.`
          : "";
      // Una fila con meses del Niño en `Y`: `B'` es lo que habrían vendido sus mismas tiendas en un año normal.
      const B = e.baseTotal ?? null;
      const bc = e.baseCorregida ?? null;
      const conNino = B !== null && bc !== null && bc > 0 && Math.round(bc) !== Math.round(B);
      const factor = conNino ? textoFactorBase(e.phi, e.temporada) : "";
      const temporada = e.temporada === "invierno" || e.temporada === "verano" ? ` de ${e.temporada}` : "";
      const corrigeTexto = conNino ? `, corregida del Niño${temporada}${factor ? ` (${factor})` : ""} = ${u(bc as number)}` : "";
      const sobreReal =
        conNino && sobre === "corregida" && e.propuesto !== null && (B as number) > 0 ? ` (${formatearDecimal(((e.propuesto as number) / (B as number) - 1) * 100, 1)} % sobre ${e.anioEnCurso} real)` : "";
      const equivale =
        conNino && sobre === "bruta" && e.propuesto !== null && (bc as number) > 0
          ? ` ${e.anioEnCurso} fue Niño${temporada}: este % es sobre ${e.anioEnCurso} real y equivale a ${formatearDecimal(((e.propuesto as number) / (bc as number) - 1) * 100, 1)} % sobre ${e.anioEnCurso} corregido (${u(bc as number)}).`
          : "";
      const tiendas = e.tiendasSiguiente !== undefined ? `de las ${formatearNumero(e.tiendasSiguiente)} tiendas de ${e.anio}` : `de las mismas tiendas de ${e.anio}`;
      return (
        `${e.anio} → base ${e.anioEnCurso} ${tiendas} = ${B === null ? "—" : u(B)}` +
        ` (vigente ${e.baseVigente === null || e.baseVigente === undefined ? "—" : u(e.baseVigente)}${aportes ? ` ${aportes}` : ""})` +
        `${sobre === "corregida" ? corrigeTexto : ""}` +
        ` × (1 + ${textoPctAplicado(g, e.crecimientoOrigen, sobre, e.anioEnCurso)}) = ${e.propuesto === null ? "sin cifra" : u(e.propuesto)}${sobreReal}, repartido con ${curva}.${equivale}${objetivo}${corregida}`
      );
    }
    case "apertura": {
      const tienda = e.tienda ? `${e.tienda.codigo} ${e.tienda.nombre}` : "La tienda";
      const fraccion =
        e.fraccionAnioApertura !== null && e.fraccionAnioApertura !== undefined
          ? `; abre ${fechaCorta(e.apertura)}: en ${e.anio} vende el ${pct(e.fraccionAnioApertura)} de un año` +
            `${e.ventaAnioApertura !== null && e.ventaAnioApertura !== undefined ? ` (S/ ${u(e.ventaAnioApertura)})` : ""}`
          : "";
      const esperada =
        e.ventaEsperada === null || e.ventaEsperada === undefined
          ? "sin venta esperada"
          : `venta esperada S/ ${u(e.ventaEsperada)} al mes en régimen (sin IGV) × 12 = año maduro S/ ${u(e.anioMaduroSoles ?? 12 * e.ventaEsperada)}${fraccion}`;
      const rampa = e.rampa && e.rampa.some((r) => r !== 1) ? `rampa ${e.rampa.map((r) => formatearDecimal(r, 2)).join(" · ")}` : "sin rampa";
      const real = e.k > 0 && e.vendido > 0 ? ` Vendido ${rangoMeses(1, e.k)} ${u(e.vendido)}; menos de tres meses completos: el resto va por venta esperada.` : "";
      const alt = e.referenciaAlternativa !== null && e.referenciaAlternativa !== undefined ? ` Por avance propio saldrían ${u(e.referenciaAlternativa)}.` : "";
      return (
        `${tienda}: ${esperada}, ${textoOrigen(e.origenComposicion, e.referente)}, ${rampa} (${curva}) → ` +
        `${e.unidadesMaduras === null || e.unidadesMaduras === undefined ? "sin año maduro" : `año maduro ${u(e.unidadesMaduras)} u`} → ${e.propuesto === null ? "sin cifra" : `${u(e.propuesto)} u en ${e.anio}`}.${real}${alt}`
      );
    }
    case "avance_propio": {
      const tienda = e.tienda ? `${e.tienda.codigo} ${e.tienda.nombre}` : "La tienda";
      const tres = e.referenciaTresMeses !== null && e.referenciaTresMeses !== undefined ? ` · últimos tres meses → ${u(e.referenciaTresMeses)}` : "";
      const alt = e.referenciaAlternativa !== null && e.referenciaAlternativa !== undefined ? ` · por venta esperada → ${u(e.referenciaAlternativa)}` : "";
      return (
        `${tienda}: vendido ${rangoMeses(1, e.k)} ${u(e.vendido)} con ${formatearNumero(e.mesesCompletos ?? 0)} meses completos; ` +
        `${textoTotalMaduro(e, curva)}` +
        `${e.propuesto === null ? "sin cifra" : `${u(e.propuesto)} u en ${e.anio}`}${textoResto(e.restoMeses, e.k)}.${tres}${alt}`
      );
    }
    case "maduro_propio": {
      const tienda = e.tienda ? `${e.tienda.codigo} ${e.tienda.nombre}` : "La tienda";
      const alt = e.referenciaAlternativa !== null && e.referenciaAlternativa !== undefined ? ` Por venta esperada saldrían ${u(e.referenciaAlternativa)}.` : "";
      const maduro = e.totalMaduro === null || e.totalMaduro === undefined ? "su total maduro" : `su total maduro ${u(e.totalMaduro)}`;
      const sobre: SobreBase = e.sobreBase ?? "corregida";
      const crecimiento = e.crecimientoPonderado
        ? `× (1 + crecimiento de sus combinaciones, ponderado ${textoPctCrecimiento(e.crecimiento ?? 0)} %)`
        : `× (1 + ${textoPctAplicado(e.crecimiento ?? 0, e.crecimientoOrigen, sobre, e.anioEnCurso)})`;
      return (
        `${tienda}: abrió en ${e.anioEnCurso}; ${maduro} ${crecimiento} ` +
        `repartido con ${curva} → ${e.propuesto === null ? "sin cifra" : `${u(e.propuesto)} u en ${e.anio}`}.${alt}`
      );
    }
    case "cierre": {
      const tienda = e.tienda ? `${e.tienda.codigo} ${e.tienda.nombre}` : "La tienda";
      return `${tienda}: cierra ${e.fechaCierre ?? "durante el año"}; en esta entrega se muestra lo vendido hasta ${rangoMeses(1, Math.max(1, e.k))} (${u(e.vendido)}) y no se proyectan los meses restantes.`;
    }
    default:
      return `${e.anio} → sin propuesta${e.curvaTexto === null ? ": la unidad no tiene curva vigente" : ""}; escribe el total.`;
  }
}

/** "DENIM HO v1" o la mezcla "HO INVIERNO v2 (80 %) + MU VERANO v1 (20 %)". */
export function textoCurva(origen: readonly { nombre: string; version: number; peso: number }[]): string | null {
  if (origen.length === 0) return null;
  if (origen.length === 1) return `${origen[0].nombre} v${origen[0].version}`;
  return origen.map((o) => `${o.nombre} v${o.version} (${formatearDecimal(o.peso * 100, 0)} %)`).join(" + ");
}
