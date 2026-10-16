import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearDecimal, formatearNumero, formatearPp } from "@/lib/formato";
import type { ComposicionAgrupacionApi, GmlComposicionApi, GmlAnioComposicionApi } from "@/lib/curvas/tipos-api";

/**
 * Presentación pura de la tarjeta «Composición de la agrupación» (06c): nombres, resumen, búsqueda, motivo de «se aparta»,
 * «también en otras agrupaciones», y el CSV con TODOS los GML y equivalencias. Sin React ni acceso a la API.
 */

/** `HOMBRE · URBANO · CASACA`. */
export function nombreGml(g: Pick<GmlComposicionApi, "genero" | "mundo" | "linea">): string {
  return [g.genero, g.mundo, g.linea].join(" · ");
}

/** El último año de ajuste de la composición (el que ordena a los principales); `null` sin años de ajuste. */
export function ultimoAnioAjuste(c: Pick<ComposicionAgrupacionApi, "anios">): number | null {
  const anios = c.anios.filter((a) => a.en_ajuste).map((a) => a.anio);
  return anios.length > 0 ? Math.max(...anios) : null;
}

/** El peso del GML en el último año de ajuste (con signo); 0 si no hay. */
export function pesoUltimoAnio(g: Pick<GmlComposicionApi, "por_anio">, anio: number | null): number {
  if (anio === null) return 0;
  return g.por_anio.find((a) => a.anio === anio)?.peso ?? 0;
}

/** Los principales primero, por unidades del último año de ajuste (desc.); los otros, igual. */
export function ordenarGml(gml: readonly GmlComposicionApi[], anio: number | null): GmlComposicionApi[] {
  const unidades = (g: GmlComposicionApi) => (anio === null ? 0 : (g.por_anio.find((a) => a.anio === anio)?.unidades ?? 0));
  return [...gml].sort((a, b) => unidades(b) - unidades(a) || nombreGml(a).localeCompare(nombreGml(b), "es"));
}

/** «166 GML · 450 equivalencias activas · 3 se apartan». */
export function resumenComposicion(c: Pick<ComposicionAgrupacionApi, "gml" | "equivalencias_activas" | "con_calculo">): string {
  const apartan = c.gml.filter((g) => g.se_aparta === true).length;
  const partes = [
    `${formatearNumero(c.gml.length)} ${c.gml.length === 1 ? "GML" : "GML"}`,
    `${formatearNumero(c.equivalencias_activas)} ${c.equivalencias_activas === 1 ? "equivalencia activa" : "equivalencias activas"}`,
  ];
  if (!c.con_calculo) partes.push("«se aparta» no se evalúa todavía");
  else partes.push(apartan === 0 ? "ninguno se aparta" : `${formatearNumero(apartan)} ${apartan === 1 ? "se aparta" : "se apartan"}`);
  return partes.join(" · ");
}

/** Filtra por nombre (también de sus equivalencias y códigos), sin mayúsculas ni tildes; vacío = todos. */
export function buscarGml(gml: readonly GmlComposicionApi[], busqueda: string): GmlComposicionApi[] {
  const q = normalizarNombre(busqueda);
  if (q === "") return [...gml];
  return gml.filter((g) => normalizarNombre(nombreGml(g)).includes(q) || g.equivalencias.some((e) => normalizarNombre(e.nombre).includes(q) || normalizarNombre(e.codigo).includes(q)));
}

const anioValido = (a: GmlAnioComposicionApi) => a.valido;

/**
 * Por qué «se aparta» (o por qué no se evalúa): «56.0 pp en 2024 y 60.0 pp en 2025 frente al resto de la agrupación; umbral 3.5 pp».
 * Cadena vacía si el GML no se aparta y sí se evaluó.
 */
export function motivoSeAparta(g: Pick<GmlComposicionApi, "se_aparta" | "por_anio" | "umbral">, minUnidades: number): string {
  if (g.se_aparta === null) return "no se evalúa hasta que se pueda calcular la agrupación (por ejemplo, hasta cargar los periodos del Niño)";
  const validos = g.por_anio.filter(anioValido);
  if (validos.length === 0) return `no se evalúa: menos de ${formatearNumero(minUnidades)} unidades en cada año de ajuste`;
  if (!g.se_aparta) return "";
  const eats = validos.filter((a) => a.eat_vs_resto !== null).map((a) => `${formatearPp(a.eat_vs_resto as number)} en ${a.anio}`);
  const umbral = g.umbral === null ? "" : `; umbral ${formatearPp(g.umbral)}`;
  return `su forma se aparta del resto de la agrupación: ${eats.join(" y ")}${umbral}`;
}

/** Los EAT frente al resto de sus años de ajuste: «2.9 · 3.2» (— si no hay). */
export function textoEatVsResto(g: Pick<GmlComposicionApi, "por_anio">): string {
  const v = g.por_anio.filter((a) => a.en_ajuste).map((a) => (a.eat_vs_resto === null ? "—" : formatearDecimal(a.eat_vs_resto, 1)));
  return v.length === 0 ? "—" : v.join(" · ");
}

/** «también en otra agrupación (23 % de su venta en 2025)» / «…en otras 2 agrupaciones (31 % …)»; `null` si no vende fuera. */
export function textoOtrasAgrupaciones(g: Pick<GmlComposicionApi, "otras_agrupaciones">, anio: number | null): string | null {
  const o = g.otras_agrupaciones;
  if (o.length === 0) return null;
  const pct = o.reduce((s, x) => s + x.pct_de_su_venta, 0) * 100;
  const donde = o.length === 1 ? "otra agrupación" : `otras ${o.length} agrupaciones`;
  return `también en ${donde} (${formatearDecimal(pct, 0)} % de su venta${anio === null ? "" : ` en ${anio}`})`;
}

/** La lista de «Otros N GML (x %)»: «HOMBRE · CASUAL · GORRO 0.9 % · …». */
export function textoOtros(c: Pick<ComposicionAgrupacionApi, "gml">, anio: number | null): string {
  return ordenarGml(
    c.gml.filter((g) => !g.principal),
    anio
  )
    .map((g) => `${nombreGml(g)} ${formatearDecimal(pesoUltimoAnio(g, anio) * 100, 1)} %`)
    .join(" · ");
}

/** Cuánto pesan todos los GML que no son principales en el último año de ajuste (fracción). */
export function pesoDeOtros(c: Pick<ComposicionAgrupacionApi, "gml">, anio: number | null): number {
  return c.gml.filter((g) => !g.principal).reduce((s, g) => s + pesoUltimoAnio(g, anio), 0);
}

/** CSV con TODOS los GML y sus equivalencias: una fila por GML y una por equivalencia, con unidades y peso por año. */
export function filasCsvComposicion(c: Pick<ComposicionAgrupacionApi, "gml" | "anios">): { campos: string[]; datos: (string | number)[][] } {
  const anios = c.anios.map((a) => a.anio);
  const campos = [
    "GML",
    "NIVEL",
    "PRINCIPAL",
    "EQUIVALENCIA",
    "CODIGO",
    "GENERICA",
    "ACTIVA",
    ...anios.flatMap((a) => [`${a} (unidades)`, `${a} (peso %)`]),
    ...anios.map((a) => `${a} (EAT vs resto)`),
    "SE APARTA",
  ];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const datos: (string | number)[][] = [];
  const ordenados = [...c.gml].sort((a, b) => nombreGml(a).localeCompare(nombreGml(b), "es"));
  for (const g of ordenados) {
    datos.push([
      nombreGml(g),
      g.nivel,
      g.principal ? "sí" : "no",
      "",
      "",
      "",
      "",
      ...anios.flatMap((a): (string | number)[] => {
        const x = g.por_anio.find((y) => y.anio === a);
        return x ? [Math.round(x.unidades), r1(x.peso * 100)] : ["", ""];
      }),
      ...anios.map((a) => {
        const x = g.por_anio.find((y) => y.anio === a)?.eat_vs_resto;
        return x === null || x === undefined ? "" : r1(x);
      }),
      g.se_aparta === null ? "" : g.se_aparta ? "sí" : "no",
    ]);
    for (const e of g.equivalencias) {
      datos.push([
        nombreGml(g),
        g.nivel,
        g.principal ? "sí" : "no",
        e.nombre,
        e.codigo,
        e.es_generica ? "sí" : "no",
        e.activo ? "sí" : "no",
        ...anios.flatMap((a): (string | number)[] => {
          const x = e.por_anio.find((y) => y.anio === a);
          return x ? [Math.round(x.unidades), r1(x.peso * 100)] : ["", ""];
        }),
        ...anios.map(() => ""),
        "",
      ]);
    }
  }
  return { campos, datos };
}
