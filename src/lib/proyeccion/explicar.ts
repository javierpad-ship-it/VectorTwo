import { formatearDecimal, formatearNumero } from "@/lib/formato";
import type { Metodo, OrigenComposicion } from "./tipos-api";

/**
 * La frase de cada cifra (ficha 07, regla 27). Pura: recibe las entradas del cálculo y devuelve el texto con el
 * formato numérico `es-PE` de `src/lib/formato.ts` (el mismo del servidor y de la pantalla). Nombra el método, las
 * cifras de entrada, la curva y su versión, el Niño si aplica y, con `plan_anterior`, el nombre de la cerrada usada.
 */

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

const u = (n: number) => formatearNumero(Math.round(n));
const pct = (fraccion: number) => `${formatearDecimal(fraccion * 100, 1)} %`;

/** "ene–set" para los primeros `k` meses; "ene" si `k = 1`. */
export function rangoMeses(desde: number, hasta: number): string {
  if (hasta < desde) return "";
  return desde === hasta ? MES_CORTO[desde - 1] : `${MES_CORTO[desde - 1]}–${MES_CORTO[hasta - 1]}`;
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
  baseTotal?: number | null;
  baseNormalizada?: number | null;
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
      const nino = e.phi && tramosNino(e.phi, 1, 12).length > 0 ? ` Normalizada por el Niño de ${e.anioEnCurso}: ${u(e.baseTotal ?? 0)} → ${u(e.baseNormalizada ?? 0)}.` : "";
      const objetivo =
        e.phiObjetivo && tramosNino(e.phiObjetivo, 1, 12).length > 0 ? ` ${e.anio} se espera atípico: la curva se pondera por el factor del Niño.` : "";
      return (
        `${e.anio} → base = vigente ${e.anioEnCurso} de las mismas tiendas ${e.baseVigente === null || e.baseVigente === undefined ? "—" : u(e.baseVigente)}` +
        `${aportes ? ` ${aportes}` : ""} = ${e.baseTotal === null || e.baseTotal === undefined ? "—" : u(e.baseTotal)}.${nino}` +
        ` × (1 + ${formatearDecimal(e.crecimiento ?? 0, 1)} %) = ${e.propuesto === null ? "sin cifra" : u(e.propuesto)}, repartido con ${curva}.${objetivo}`
      );
    }
    case "apertura": {
      const tienda = e.tienda ? `${e.tienda.codigo} ${e.tienda.nombre}` : "La tienda";
      const esperada = e.ventaEsperada === null || e.ventaEsperada === undefined ? "sin venta esperada" : `venta esperada S/ ${u(e.ventaEsperada)} al mes (sin IGV, madura)`;
      const rampa = e.rampa && e.rampa.some((r) => r !== 1) ? `rampa ${e.rampa.map((r) => formatearDecimal(r, 2)).join(" · ")}` : "sin rampa";
      const abre = e.apertura ? ` abre ${e.apertura}` : "";
      const real = e.k > 0 && e.vendido > 0 ? ` Vendido ${rangoMeses(1, e.k)} ${u(e.vendido)}; menos de tres meses completos: el resto va por venta esperada.` : "";
      const alt = e.referenciaAlternativa !== null && e.referenciaAlternativa !== undefined ? ` Por avance propio saldrían ${u(e.referenciaAlternativa)}.` : "";
      return (
        `${tienda}${abre}: ${esperada}, ${textoOrigen(e.origenComposicion, e.referente)}, ${rampa} (${curva}) → ` +
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
      return (
        `${tienda}: abrió en ${e.anioEnCurso}; ${maduro} × (1 + ${formatearDecimal(e.crecimiento ?? 0, 1)} %) ` +
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
