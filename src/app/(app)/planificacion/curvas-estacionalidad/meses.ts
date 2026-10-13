import { esPeriodoValido, listarMeses, mesSiguiente, recortarPeriodo } from "@/lib/ventas/periodo";

/** Utilidades de meses (`aaaa-mm`) para la pantalla de periodos atípicos. Puras, sin React. */

const CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/** `2023-03-01` o `2023-03` → `2023-03`. */
export function mesCorto(valor: string): string {
  return recortarPeriodo(valor);
}

function partes(periodo: string): { anio: string; mes: number } {
  const [anio, mes] = recortarPeriodo(periodo).split("-");
  return { anio, mes: Number(mes) };
}

function abreviatura(periodo: string): string {
  const { mes } = partes(periodo);
  return CORTO[mes - 1] ?? "?";
}

/** `2023-03`, `2023-05` → `mar–may 2023`; mismo mes → `mar 2023`; otro año → `dic 2023–feb 2024`. */
export function textoRango(desde: string, hasta: string, conAnio = true): string {
  const d = partes(desde);
  const h = partes(hasta);
  const anio = conAnio ? ` ${d.anio}` : "";
  if (recortarPeriodo(desde) === recortarPeriodo(hasta)) return `${abreviatura(desde)}${anio}`;
  if (d.anio === h.anio) return `${abreviatura(desde)}–${abreviatura(hasta)}${anio}`;
  return `${abreviatura(desde)} ${d.anio}–${abreviatura(hasta)} ${h.anio}`;
}

/**
 * Agrupa meses consecutivos: `["2023-03","2023-04","2023-05","2023-08"]` → `mar–may 2023, ago 2023`
 * (con `conAnio = false`, `mar–may, ago`: para meses de un solo año que ya se nombró).
 */
export function resumirMeses(meses: readonly string[], conAnio = true): string {
  const ordenados = [...new Set(meses.map(recortarPeriodo))].sort();
  const tramos: string[] = [];
  let i = 0;
  while (i < ordenados.length) {
    let j = i;
    while (j + 1 < ordenados.length && mesSiguiente(ordenados[j]) === ordenados[j + 1]) j++;
    tramos.push(textoRango(ordenados[i], ordenados[j], conAnio));
    i = j + 1;
  }
  return tramos.join(", ");
}

/** Cuántos meses abarca el rango; `null` si algún extremo no es un mes válido. */
export function contarMeses(desde: string, hasta: string): number | null {
  if (!esPeriodoValido(desde) || !esPeriodoValido(hasta) || hasta < desde) return null;
  return listarMeses(desde, hasta).length;
}

/** Mensaje de validación del rango (vacío = todavía incompleto, sin error), o `null` si es válido. */
export function validarRango(desde: string, hasta: string): string | null {
  if (desde === "" || hasta === "") return "Indica el mes inicial y el mes final.";
  if (!esPeriodoValido(desde) || !esPeriodoValido(hasta)) return "Los meses deben tener la forma aaaa-mm (por ejemplo 2023-03).";
  if (hasta < desde) return "El mes final no puede ser anterior al inicial.";
  return null;
}

/** Meses del rango posteriores al último cargado en M5 (`ultimoCargado` `null` = no se sabe: ninguno). */
export function mesesSinCargar(desde: string, hasta: string, ultimoCargado: string | null): string[] {
  if (ultimoCargado === null || contarMeses(desde, hasta) === null) return [];
  return listarMeses(desde, hasta).filter((m) => m > recortarPeriodo(ultimoCargado));
}
