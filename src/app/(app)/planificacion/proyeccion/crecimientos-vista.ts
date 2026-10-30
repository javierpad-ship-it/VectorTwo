// Lógica de vista de la pestaña Crecimientos de M7 (fichas 06d y 06e). Pura, sin React: la prueban vitest con datos sintéticos.
// Desde 0.12.1 el crecimiento del año siguiente es GLOBAL y versionado (se aprueba en Curvas de estacionalidad → Crecimiento por género ×
// mundo): esta pestaña es de solo lectura y muestra la foto de lo que aplicó el último cálculo frente a lo aprobado hoy. Desde 0.14.0 (método 5,
// 06e) el % se escribe sobre `Y` CORREGIDO del Niño (`B'`) y la pantalla muestra siempre los dos: «sobre Y corregido» (el que se aprueba) y
// «sobre Y real» (el que compara con lo vendido), con las dos bases en unidades. Aquí viven las filas de la tabla, los avisos, el puente y el
// objetivo, y los textos de «Por línea» que explican el % efectivo de una fila («8 % · HOMBRE · URBANO v2», «15 % bruto · HOMBRE · URBANO v1»).
// El servidor es el dueño de las cifras; aquí solo se cruzan sumas y se redondea al mostrar.

import { formatearDecimal, formatearNumero, plural } from "@/lib/formato";
import {
  UMBRAL_CORRECCION_NINO,
  VERSION_METODO,
  type AnioFilaApi,
  type CrecimientoEfectivoApi,
  type FilaApi,
  type FilaResumenCrecimientoApi,
  type ProyeccionApi,
  type ResultadoPromedio,
  type ResumenCrecimientosProyeccionApi,
  type SobreBase,
} from "@/lib/proyeccion/tipos-api";
import { formatearMomento, formatearPct, unidades } from "./vista";

const pctCorto = (n: number): string => `${formatearDecimal(n, n % 1 === 0 ? 0 : 1)} %`;

/** `1 y 2`, `A, B y C`: la lista en palabras. */
export function listaEnPalabras(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

// ─── Pestaña: textos generales ───

/**
 * La proyección es de un método anterior al vigente (`VERSION_METODO`, 5 desde 0.14.0): su resumen no trae la base corregida del Niño y solo
 * se pide recalcular. (Hasta 0.13.x el corte era 4: una de método 4 ya tenía base y foto, pero brutas.)
 */
export const esMetodoAnterior = (r: Pick<ResumenCrecimientosProyeccionApi, "version_metodo">): boolean => r.version_metodo === null || r.version_metodo < VERSION_METODO;

/** El aviso de método anterior: en trabajo manda recalcular; cerrada o archivada no se recalcula. */
export function textoMetodoAnterior(enTrabajo: boolean): string {
  return enTrabajo
    ? "Esta proyección se calculó con un método anterior (antes de 0.14.0): recalcúlala para ver sus crecimientos sobre la base corregida del Niño."
    : "Esta proyección se calculó con un método anterior (antes de 0.14.0) y es de solo lectura: no muestra sus crecimientos. Los meses del año siguiente de las líneas con Niño no están corregidos.";
}

/**
 * El aviso de la cabecera de una proyección CERRADA calculada con un método anterior (decisión 4 de Javier, 06e §5.6): sigue sirviendo a M8
 * mientras no se cierre una de `0.14.0`. No bloquea nada; solo dice qué falta. `null` si la versión es la vigente (o no se sabe).
 */
export function textoCerradaMetodoAnterior(version: number | null | undefined): string | null {
  if (version === null || version === undefined || version >= VERSION_METODO) return null;
  if (version === 4) {
    return "Se calculó con el método 4 (antes de 0.14.0): los meses del año siguiente de las líneas con Niño no están corregidos. Sirve para trabajar y M8 la sigue usando con un aviso; cuando cierres una proyección con 0.14.0, la reemplazará.";
  }
  return `Se calculó con el método ${version}, anterior al vigente (${VERSION_METODO}): los meses del año siguiente de las líneas con Niño no están corregidos. M8 la usa con un aviso hasta que cierres una proyección nueva.`;
}

/** La frase de la cabecera de la pestaña. */
export function textoCabeceraCrecimientos(anioEnCurso: number, anioSiguiente: number): string {
  return `Crecimiento de ${anioSiguiente} sobre ${anioEnCurso} corregido del Niño, de las mismas tiendas de ${anioSiguiente}. El Niño se corrige con el factor relativo de cada temporada; sin Niño, corregido = real. Se aprueba una sola vez para todas las proyecciones en Curvas de estacionalidad; aquí se ve lo que aplicó el último cálculo y lo que equivale sobre ${anioEnCurso} real.`;
}

// ─── Foto (aplicado) frente a lo aprobado hoy ───

/** `sobre_base` aún no viaja en la foto (`FilaResumenCrecimientoApi.aplicado`): se lee si el servidor lo entrega y, si no, se deduce (ver `filasDeResumen`). */
type Aplicado = FilaResumenCrecimientoApi["aplicado"] & { sobre_base?: SobreBase };
type VigenteHoy = FilaResumenCrecimientoApi["vigente_hoy"];

/** «v2», «provisional» (el Resto sin aprobar) o «sin versión» (una celda escrita antes de 0.12.1). */
export function textoVersion(a: Pick<Aplicado, "version" | "provisional">): string {
  if (a.version !== null) return `v${a.version}`;
  return a.provisional ? "provisional" : "sin versión";
}

/** «15 % · v1» o «5 % · provisional». */
export const textoAplicadoPrincipal = (a: Aplicado): string => `${pctCorto(a.pct)} · ${textoVersion(a)}`;

/** «sobre 2026 corregido» o «sobre 2026 real · antes de 0.14.0»; `null` si no se sabe. */
export function textoSobreBase(sobre: SobreBase | null | undefined, anioEnCurso: number): string | null {
  if (sobre === "corregida") return `sobre ${anioEnCurso} corregido`;
  if (sobre === "bruta") return `sobre ${anioEnCurso} real · antes de 0.14.0`;
  return null;
}

/** «Javier · 27/10/2026, 10:00» (quién y cuándo, de la foto); `null` si no hay ninguno (el Resto provisional). */
export function textoQuienCuando(por: string | null, cuando: string | null): string | null {
  const partes = [por, cuando ? formatearMomento(cuando) : null].filter((x): x is string => Boolean(x));
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** «15 % · v2» o «sin aprobar». */
export const textoVigenteHoy = (v: VigenteHoy): string => (v ? `${pctCorto(v.pct)} · v${v.version}` : "sin aprobar");

/** ¿Lo aprobado hoy difiere de lo aplicado en el último cálculo? (otra versión u otro %; aprobar un GM que era provisional también cuenta). */
export function filaCambio(f: Pick<FilaResumenCrecimientoApi, "aplicado" | "vigente_hoy">): boolean {
  const { aplicado, vigente_hoy: v } = f;
  if (!v) return aplicado.version !== null; // se aplicó una versión y hoy no hay vigente (o retirada)
  return aplicado.version !== v.version || aplicado.pct !== v.pct;
}

type Cambiado = ResumenCrecimientosProyeccionApi["cambiados"][number];

const lado = (c: Cambiado["aplicado"], vacio: string): { v: string; pct: string } => (c ? { v: c.version === null ? vacio : `v${c.version}`, pct: pctCorto(c.pct) } : { v: vacio, pct: "—" });

/** «HOMBRE · URBANO v1 → v2 (12 % → 15 %)». */
export function textoCambiado(c: Cambiado): string {
  const a = lado(c.aplicado, "provisional");
  const v = lado(c.vigente, "sin aprobar");
  return `${c.nombre} ${a.v} → ${v.v} (${a.pct} → ${v.pct})`;
}

/**
 * La alerta de cabecera cuando lo aprobado cambió después de calcular: «Los crecimientos aprobados cambiaron después de calcular: HOMBRE ·
 * URBANO v1 → v2 (12 % → 15 %). Recalcula». `null` si no hay cambio (ni lista ni el motivo `crecimientos_cambiados`).
 */
export function textoAlertaCambiados(cambiados: readonly Cambiado[], motivoCambiados: boolean): string | null {
  if (cambiados.length === 0) return motivoCambiados ? "Los crecimientos aprobados (o el mundo de un nodo) cambiaron después de calcular. Recalcula." : null;
  const lista = cambiados.length <= 5 ? cambiados.map(textoCambiado).join("; ") : `${cambiados.slice(0, 5).map(textoCambiado).join("; ")}; y ${formatearNumero(cambiados.length - 5)} más`;
  return `Los crecimientos aprobados cambiaron después de calcular: ${lista}. Recalcula.`;
}

/** ¿La proyección tiene el motivo `crecimientos_cambiados`? */
export const tieneMotivoCambiados = (p: Pick<ProyeccionApi, "desactualizada">): boolean => p.desactualizada.some((m) => m.codigo === "crecimientos_cambiados");

// ─── Tabla por GM, Resto y Total ───

export type InsigniaCelda = { clave: string; texto: string; tono: "neutro" | "alerta" | "marca"; titulo?: string };

export const TITULO_FILAS_FIJADAS = "Se cambian fila a fila en Por línea: vacía «Crec.» o usa «Volver a la propuesta»";

/** Las insignias informativas de un GM o del Resto: «N con % propio» y «N decididas». Sin acción: el título dice dónde se cambian. */
export function insigniasDeFijadas(agregado: Pick<FilaResumenCrecimientoApi["agregado"], "pct_propio" | "decididas">): InsigniaCelda[] {
  const out: InsigniaCelda[] = [];
  if (agregado.pct_propio.filas > 0) out.push({ clave: "propio", texto: `${agregado.pct_propio.filas} con % propio`, tono: "neutro", titulo: TITULO_FILAS_FIJADAS });
  if (agregado.decididas.filas > 0) {
    out.push({ clave: "decididas", texto: agregado.decididas.filas === 1 ? "1 decidida" : `${agregado.decididas.filas} decididas`, tono: "neutro", titulo: TITULO_FILAS_FIJADAS });
  }
  return out;
}

export type CorreccionNino = { texto: string; titulo: string; material: boolean; pct: number };

/**
 * «corrección del Niño +9.6 %»: `Σ B' ÷ Σ B − 1` (el valor que antes se llamaba «rebote»). `null` si la base corregida es la real (sin Niño). Con
 * menos de `UMBRAL_CORRECCION_NINO` (0,5 %) lo dice: «(no material)», porque una versión de antes de 0.14.0 vale tal cual (D8).
 */
export function textoCorreccionNino(a: { base: number; base_normalizada: number }): CorreccionNino | null {
  if (!(a.base > 0) || Math.round(a.base_normalizada) === Math.round(a.base)) return null;
  const pct = (a.base_normalizada / a.base - 1) * 100;
  const material = Math.abs(pct) >= UMBRAL_CORRECCION_NINO * 100 - 1e-9;
  const v = formatearPct(pct);
  return {
    texto: `corrección del Niño ${v}${material ? "" : " (no material)"}`,
    titulo: material
      ? `La base corregida del Niño es ${v} frente a lo vendido. Es la base sobre la que se aplica el %.`
      : `La base corregida del Niño es ${v} frente a lo vendido: menos de ${formatearDecimal(UMBRAL_CORRECCION_NINO * 100, 1)} %, no cuenta como Niño y una versión de antes de 0.14.0 vale tal cual.`,
    material,
    pct,
  };
}

/** El desglose de la base del Resto: «JOVENCITOS 8,200 · NIÑOS 6,100». */
export function textoDesgloseResto(porGenero: readonly { genero: string; base: number }[]): string | null {
  const partes = porGenero.filter((g) => g.base > 0).map((g) => `${g.genero} ${unidades(g.base)}`);
  return partes.length === 0 ? null : partes.join(" · ");
}

export type FilaTablaCrecimiento = {
  clave: string;
  tipo: "gm" | "resto" | "total";
  nombre: string;
  /** El desglose por género del Resto («JOVENCITOS 8,200 · …»); `null` en las demás. */
  desglose: string | null;
  /** `null` en el Total: ahí `ponderado` lleva el % ponderado de lo aplicado. */
  aplicado: Aplicado | null;
  /** Sobre qué base se aplicó el %: del servidor si lo trae; si no, `bruta` cuando está en «reaprobar» y `corregida` en el Resto provisional. */
  sobre: SobreBase | null;
  ponderado: number | null;
  vigenteHoy: VigenteHoy;
  /** Lo aprobado hoy difiere de lo aplicado: badge «cambió». */
  cambio: boolean;
  /** `Σ B`: unidades de `Y` (real) de las mismas tiendas de `Y+1`. */
  base: number;
  /** `Σ B'`: la misma base corregida del Niño. */
  baseCorregida: number;
  correccion: CorreccionNino | null;
  /** `Y+1` resultante de las mismas tiendas, en unidades (`Σ vigente`). */
  siguiente: number;
  /** `Σ vigente ÷ Σ B − 1` («sobre Y real»). */
  resultantePct: number | null;
  /** `Σ vigente ÷ Σ B' − 1` («sobre Y corregido»). */
  resultanteCorregidoPct: number | null;
  insignias: InsigniaCelda[];
  /** «reaprobar» y «412 u fuera de la base»: avisos de la fila que van junto al nombre. */
  avisos: InsigniaCelda[];
  /** Está en `reaprobar`: versión de antes de 0.14.0 de un GM con Niño material; hay que reaprobarla para cerrar. */
  reaprobar: { version: number; correccion_pct: number } | null;
  fueraBase: { filas: number; unidades: number } | null;
  enlace: string | null;
};

function nombreDeFila(f: Pick<FilaResumenCrecimientoApi, "genero" | "mundo">): string {
  return f.genero === null && f.mundo === null ? "Resto" : [f.genero, f.mundo].filter(Boolean).join(" · ");
}

/** Las claves de la API vienen como `genero_id|mundo_id` (resumen de M7, `reaprobar`) o `genero_id.mundo_id` (filas del resumen): se comparan igual. */
export const claveComparable = (clave: string): string => clave.replace(".", "|");

export type OpcionesFilasResumen = {
  anioEnCurso?: number;
  /** `proyeccion.resumen.gm_fuera_base`: filas con `B` nulo y su venta de `Y`, por GM (M8). */
  gmFueraBase?: Record<string, { filas: number; unidades: number }>;
  /** `proyeccion.parametros.crecimiento_resto_usado?.sobre_base`. */
  sobreResto?: SobreBase;
};

export const textoFueraDeLaBase = (f: { filas: number; unidades: number }): string => `${formatearNumero(Math.round(f.unidades))} u fuera de la base`;

function deFila(f: FilaResumenCrecimientoApi, tipo: "gm" | "resto", desglose: string | null, rea: ReadonlyMap<string, { version: number; correccion_pct: number }>, op: OpcionesFilasResumen): FilaTablaCrecimiento {
  const clave = claveComparable(f.clave);
  const reaprobar = rea.get(clave) ?? null;
  const aplicado = f.aplicado as Aplicado;
  const sobre: SobreBase | null = aplicado.sobre_base ?? (reaprobar ? "bruta" : tipo === "resto" ? (op.sobreResto ?? (aplicado.provisional ? "corregida" : null)) : aplicado.provisional ? "corregida" : null);
  const fueraBase = op.gmFueraBase?.[clave] ?? null;
  const avisos: InsigniaCelda[] = [];
  if (reaprobar) {
    avisos.push({
      clave: "reaprobar",
      texto: "reaprobar",
      tono: "alerta",
      titulo: `v${reaprobar.version} se aprobó sobre ${op.anioEnCurso ?? "el año en curso"} real antes de 0.14.0 y este grupo tuvo Niño (${formatearPct(reaprobar.correccion_pct)}): hay que reaprobarla para cerrar`,
    });
  }
  if (fueraBase && fueraBase.unidades > 0) {
    avisos.push({ clave: "fuera_base", texto: textoFueraDeLaBase(fueraBase), tono: "neutro", titulo: "Filas con venta sin propuesta de M7 (sin curva o sin propuesta): no entran a la base ni al % de este grupo" });
  }
  return {
    clave: f.clave,
    tipo,
    nombre: tipo === "resto" ? "Resto" : nombreDeFila(f),
    desglose,
    aplicado: f.aplicado,
    sobre,
    ponderado: null,
    vigenteHoy: f.vigente_hoy,
    cambio: filaCambio(f),
    base: f.agregado.base,
    baseCorregida: f.agregado.base_normalizada,
    correccion: textoCorreccionNino(f.agregado),
    siguiente: f.agregado.siguiente_vigente,
    resultantePct: f.resultante_pct,
    resultanteCorregidoPct: f.agregado.base_normalizada > 0 ? (f.agregado.siguiente_vigente / f.agregado.base_normalizada - 1) * 100 : null,
    insignias: insigniasDeFijadas(f.agregado),
    avisos,
    reaprobar,
    fueraBase,
    enlace: f.enlace,
  };
}

/**
 * Las filas de la tabla: los GM de HOMBRE y MUJER, el Resto y, al final, el Total (el de `calcularPromedio` de 07c sobre la foto, que trae el
 * servidor, más las bases sumadas de cada fila). Sin `total` (método anterior) no hay fila Total.
 */
export function filasDeResumen(r: Pick<ResumenCrecimientosProyeccionApi, "filas" | "resto" | "total"> & Partial<Pick<ResumenCrecimientosProyeccionApi, "sin_aprobar">>, opciones: OpcionesFilasResumen = {}): FilaTablaCrecimiento[] {
  const op: OpcionesFilasResumen = { ...opciones, gmFueraBase: opciones.gmFueraBase ? Object.fromEntries(Object.entries(opciones.gmFueraBase).map(([k, v]) => [claveComparable(k), v])) : undefined };
  const rea = new Map((r.sin_aprobar?.reaprobar ?? []).map((x) => [claveComparable(x.clave), { version: x.version, correccion_pct: x.correccion_pct }] as const));
  const filas = r.filas.map((f) => deFila(f, "gm", null, rea, op));
  const resto = deFila(r.resto, "resto", textoDesgloseResto(r.resto.por_genero), rea, op);
  const out = [...filas, resto];
  if (r.total) {
    const todas = [...r.filas, r.resto];
    const base = todas.reduce((s, f) => s + f.agregado.base, 0);
    const baseCorregida = todas.reduce((s, f) => s + f.agregado.base_normalizada, 0);
    const siguiente = r.total.siguiente_total;
    out.push({
      clave: "total",
      tipo: "total",
      nombre: "Total (mismas tiendas)",
      desglose: null,
      aplicado: null,
      sobre: null,
      ponderado: r.total.ponderado_escrito_pct,
      vigenteHoy: null,
      cambio: false,
      base,
      baseCorregida,
      correccion: textoCorreccionNino({ base, base_normalizada: baseCorregida }),
      siguiente,
      resultantePct: base > 0 ? (siguiente / base - 1) * 100 : null,
      resultanteCorregidoPct: baseCorregida > 0 ? (siguiente / baseCorregida - 1) * 100 : null,
      insignias: insigniasDeFijadas({
        pct_propio: { filas: r.total.filas_con_pct_propio, base: 0, siguiente: 0 },
        decididas: { filas: r.total.filas_decididas, base: 0, siguiente: 0 },
      }),
      avisos: [],
      reaprobar: null,
      fueraBase: null,
      enlace: null,
    });
  }
  return out;
}

// ─── Pie: puente y objetivo ───

const pp = (n: number): string => `${formatearDecimal(Math.abs(n), 1)} pp`;
const faltaOSobra = (n: number | null): string => (n === null ? "—" : n >= 0 ? `te faltan ${pp(n)}` : `te pasas por ${pp(n)}`);

/** «Objetivo +12.0 % → con lo aplicado te faltan 0.3 pp; con el resultado, te faltan 1.8 pp ≈ 2,215 u». Con el objetivo superado dice «te pasas». */
export function textoObjetivo(o: NonNullable<ResultadoPromedio["objetivo"]>): string {
  const u = o.faltan_unidades === null ? null : Math.round(o.faltan_unidades);
  const unidadesTexto = u === null ? "" : ` ≈ ${u >= 0 ? `${formatearNumero(u)} u` : `${formatearNumero(-u)} u de más`}`;
  return `Objetivo ${formatearPct(o.pct)} → con lo aplicado ${faltaOSobra(o.faltan_pp_escrito)}; con el resultado, ${faltaOSobra(o.faltan_pp_resultado)}${unidadesTexto}.`;
}

/** «3 filas con % propio y 5 decididas llevan el total de +11.7 % a +10.2 %», o que coinciden si no hay filas fijadas. */
export function textoDesvioPorFijadas(r: Pick<ResultadoPromedio, "filas_con_pct_propio" | "filas_decididas" | "ponderado_escrito_pct" | "resultante_pct">): string {
  const propias = r.filas_con_pct_propio;
  const decididas = r.filas_decididas;
  if (propias === 0 && decididas === 0) return "No hay filas fijadas a mano: el resultado coincide con lo aplicado.";
  const quienes = [propias > 0 ? plural(propias, "fila con % propio", "filas con % propio") : null, decididas > 0 ? plural(decididas, "decidida", "decididas") : null].filter(Boolean).join(" y ");
  return `${quienes} llevan el total de ${formatearPct(r.ponderado_escrito_pct)} a ${formatearPct(r.resultante_pct)}.`;
}

/** El título de «Cierres» del puente: «0 u (1 tienda sin decidir)» si hay cierres sin decidir. */
export function textoCierresPuente(p: { cierres: number; cierres_sin_decidir: number }): string {
  const base = `${unidades(p.cierres)} u`;
  return p.cierres_sin_decidir > 0 ? `${base} (${plural(p.cierres_sin_decidir, "tienda sin decidir", "tiendas sin decidir")})` : base;
}

export type LineaPuente = { clave: string; texto: string; valor: string; negrita?: boolean };

/**
 * Las líneas del puente al Total de `Y+1` de la Matriz (07c §5.2), sobre la foto. Con las bases sumadas de la tabla (`bases`), la base sale
 * partida en real y corregida y el % se dice sobre las dos; sin ellas, como en 06d (una sola base, la que trae el servidor).
 */
export function lineasPuente(total: ResultadoPromedio, anioEnCurso: number, anioSiguiente: number, bases?: { real: number; corregida: number }): LineaPuente[] {
  const y = anioEnCurso;
  const s = anioSiguiente;
  const p = total.puente;
  const conNino = bases !== undefined && bases.corregida > 0 && Math.round(bases.corregida) !== Math.round(bases.real);
  const porReal = bases && bases.real > 0 ? (p.mismas_siguiente / bases.real - 1) * 100 : total.resultante_pct;
  const porCorregido = bases && bases.corregida > 0 ? (p.mismas_siguiente / bases.corregida - 1) * 100 : null;
  const lineas: LineaPuente[] = [{ clave: "base", texto: `Base ${y}${bases ? " real" : ""} de las mismas tiendas de ${s}`, valor: `${unidades(bases ? bases.real : p.base)} u` }];
  if (conNino) lineas.push({ clave: "corregida", texto: `Base ${y} corregida del Niño (a ella se aplica el %)`, valor: `${unidades(bases.corregida)} u` });
  lineas.push({
    clave: "mismas",
    texto: conNino
      ? `× crecimiento ${formatearPct(porCorregido)} sobre ${y} corregido (${formatearPct(porReal)} sobre ${y} real) = ${s} de las mismas tiendas`
      : `× crecimiento resultante ${formatearPct(porReal)} = ${s} de las mismas tiendas`,
    valor: `${unidades(p.mismas_siguiente)} u`,
  });
  lineas.push(
    { clave: "nuevas", texto: `+ nuevas del año anterior (${s})`, valor: `${unidades(p.nuevas_anterior)} u` },
    { clave: "aperturas", texto: `+ aperturas de ${s}`, valor: `${unidades(p.aperturas)} u` },
    { clave: "cierres", texto: `+ cierres de ${s} (su venta parcial suma: su ${y} ya salió de la base)`, valor: textoCierresPuente(p) },
    { clave: "total", texto: `= Total ${s}`, valor: `${unidades(p.total_siguiente)} u`, negrita: true },
    { clave: "comparado", texto: `Total ${y} de la Matriz ${unidades(p.total_en_curso)} u → Var. de la Matriz`, valor: formatearPct(p.var_pct) }
  );
  return lineas;
}

// ─── Nueva proyección y parámetros: el Resto ───

type RestoDeFoto = { pct: number; version: number | null; aprobado: boolean; sobre?: SobreBase };

/** El Resto de la foto de una proyección: el usado en el último cálculo o, sin la clave (antes de 0.12.1), el provisional. */
export function restoDeFoto(p: Pick<ProyeccionApi, "parametros">): RestoDeFoto {
  const u = p.parametros.crecimiento_resto_usado;
  if (u) return { pct: u.pct, version: u.version, aprobado: u.crecimiento_id !== null, ...(u.sobre_base ? { sobre: u.sobre_base } : {}) };
  return { pct: p.parametros.crecimiento_pct_defecto, version: null, aprobado: false };
}

/** «5 % · Resto v1 (aprobado)» o «5 % · Resto provisional»; un Resto aprobado antes de 0.14.0 lo dice («bruto: sobre el año real»). */
export function textoRestoDeFoto(r: RestoDeFoto): string {
  const base = `${pctCorto(r.pct)} · Resto ${r.aprobado && r.version !== null ? `v${r.version} (aprobado)` : "provisional"}`;
  return r.aprobado && r.sobre === "bruta" ? `${base} · bruto (antes de 0.14.0)` : base;
}

/**
 * Un Resto aprobado para el año de la proyección nueva, sacado de la foto de la proyección calculada más reciente de ese año (el formulario
 * no lee el global: eso costaría una lectura de venta). `null` si ninguna aplicó un Resto aprobado.
 */
export function restoAprobadoReciente(
  proyecciones: readonly Pick<ProyeccionApi, "anio_en_curso" | "calculado_at" | "nombre" | "parametros">[],
  anioEnCurso: number
): { pct: number; version: number | null; nombre: string } | null {
  const candidatas = proyecciones
    .filter((p) => p.anio_en_curso === anioEnCurso && p.calculado_at !== null && p.parametros.crecimiento_resto_usado?.crecimiento_id)
    .sort((a, b) => String(b.calculado_at).localeCompare(String(a.calculado_at)));
  const p = candidatas[0];
  const u = p?.parametros.crecimiento_resto_usado;
  return p && u ? { pct: u.pct, version: u.version, nombre: p.nombre } : null;
}

/** Ayuda del campo «Resto provisional (%)» al crear: «Se usa solo mientras no haya un Resto aprobado para 2027» y, si lo hay, el aprobado. */
export function ayudaRestoProvisional(anioSiguiente: number, aprobado: { pct: number; version: number | null; nombre: string } | null): string {
  const base = `Se usa solo mientras no haya un Resto aprobado para ${anioSiguiente}.`;
  if (!aprobado) return base;
  return `${base} Resto aprobado para ${anioSiguiente} en el último cálculo de «${aprobado.nombre}»: ${pctCorto(aprobado.pct)}${aprobado.version !== null ? ` (v${aprobado.version})` : ""}.`;
}

// ─── Por línea: el % efectivo de una fila ───

/** «HOMBRE · URBANO v2», «Resto v1», «Resto provisional», «esta fila». Sin versión (datos de antes de 0.12.1): «HOMBRE · URBANO», «Resto». */
function nombreOrigen(c: CrecimientoEfectivoApi): string {
  if (c.origen === "fila") return "esta fila";
  if (c.origen === "resto") return `Resto${c.provisional ? " provisional" : c.version != null ? ` v${c.version}` : ""}`;
  return `${c.celda ?? "celda"}${c.version != null ? ` v${c.version}` : ""}`;
}

/** ¿El % efectivo es de una versión de antes de 0.14.0 (se aplica sobre `Y` real)? Un % propio de la fila y el Resto provisional nunca lo son. */
export const esBruto = (c: CrecimientoEfectivoApi | null | undefined): boolean => Boolean(c) && c!.sobre_base === "bruta" && c!.origen !== "fila" && !c!.provisional;

/** «8 % · HOMBRE · URBANO v2», «15 % bruto · HOMBRE · URBANO v1», «5 % · Resto provisional» o «8.5 % · esta fila». */
export function textoOrigenCrecimiento(c: CrecimientoEfectivoApi | null | undefined): string | null {
  if (!c) return null;
  return `${pctCorto(c.pct)}${esBruto(c) ? " bruto" : ""} · ${nombreOrigen(c)}`;
}

/**
 * Ayuda del campo «Crec.»: «% de 2027 sobre la venta de 2026 corregida del Niño de esta fila. Vacío = el aprobado de HOMBRE · URBANO (8 %).» Si
 * ese aprobado es de antes de 0.14.0 avisa que se aplica sobre 2026 real hasta reaprobarlo.
 */
export function ayudaCrecimientoFila(c: CrecimientoEfectivoApi | null | undefined, anio: number, anioEnCurso: number): string {
  const base = `% de ${anio} sobre la venta de ${anioEnCurso} corregida del Niño de esta fila.`;
  if (!c || c.origen === "fila") return `${base} Vacío = el aprobado de la combinación género · mundo (o el Resto).`;
  const pct = formatearDecimal(c.pct, c.pct % 1 === 0 ? 0 : 1);
  const bruto = esBruto(c) ? ` Ojo: ese % se aprobó antes de 0.14.0 sobre ${anioEnCurso} real y así se aplica hasta que se reapruebe.` : "";
  if (c.origen === "resto") return `${base} Vacío = el Resto ${c.provisional ? "provisional" : "aprobado"} (${pct} %).${bruto}`;
  return `${base} Vacío = el aprobado de ${c.celda ?? "la combinación"} (${pct} %).${bruto}`;
}

/**
 * Marcador del campo «Crec.» de una fila de `Y+1`. `null` si la fila no trae el % efectivo (proyección anterior al método 4). Con
 * `reaprobar` (el GM está en la lista de «reaprobar» del cierre) y un % bruto agrega «(reaprobar)».
 */
export function marcadorCrecimiento(r: Pick<AnioFilaApi, "crecimiento_efectivo"> | undefined, opciones: { reaprobar?: boolean } = {}): string | null {
  const t = textoOrigenCrecimiento(r?.crecimiento_efectivo);
  if (t === null) return null;
  return opciones.reaprobar && esBruto(r?.crecimiento_efectivo) ? `${t} (reaprobar)` : t;
}

type RegistroConBase = Pick<AnioFilaApi, "crecimiento_efectivo" | "base_siguiente" | "base_normalizada" | "pct_bruto" | "pct_sobre_normalizada" | "decidido">;

/** ¿La base corregida del Niño de la fila difiere de la real? (a unidades enteras) */
export function filaConNino(r: Pick<AnioFilaApi, "base_siguiente" | "base_normalizada">): boolean {
  return r.base_siguiente != null && r.base_normalizada != null && Math.round(r.base_normalizada) !== Math.round(r.base_siguiente);
}

/**
 * El detalle de una fila de `Y+1`, en líneas: el % efectivo con su origen y sobre qué base, las bases real y corregida, lo que equivale el
 * resultado sobre cada una («+8,0 % sobre 2026 corregido (19,125) · +35,0 % sobre 2026 real (15,300)»), el sentido de la corrección del Niño
 * («2026 vendió de más por el Niño») y, si la fila está decidida, su % sobre real.
 */
export function textosDetalleCrecimiento(r: RegistroConBase, anio: number, anioEnCurso: number): string[] {
  const out: string[] = [];
  const y = anioEnCurso;
  const ce = r.crecimiento_efectivo;
  const conNino = filaConNino(r);
  if (ce) {
    const donde = ce.origen === "fila" ? "% propio de la fila" : nombreOrigen(ce);
    out.push(esBruto(ce) ? `Crecimiento ${formatearPct(ce.pct)} sobre ${y} real (${donde}, aprobado antes de 0.14.0)` : `Crecimiento ${formatearPct(ce.pct)} sobre ${y} corregido (${donde})`);
  }
  if (r.base_siguiente != null) {
    const bases =
      conNino && r.base_normalizada != null
        ? `${unidades(r.base_siguiente)} u real · ${unidades(r.base_normalizada)} u corregida del Niño (${formatearPct((r.base_normalizada / r.base_siguiente - 1) * 100)})`
        : `${unidades(r.base_siguiente)} u (sin corrección del Niño)`;
    out.push(`Base ${y} de las mismas tiendas de ${anio}: ${bases}`);
  }
  if (conNino && r.base_normalizada != null && r.base_siguiente != null && r.pct_sobre_normalizada != null && r.pct_bruto != null) {
    out.push(`${formatearPct(r.pct_sobre_normalizada)} sobre ${y} corregido (${unidades(r.base_normalizada)}) · ${formatearPct(r.pct_bruto)} sobre ${y} real (${unidades(r.base_siguiente)})`);
  } else if (r.pct_bruto != null && r.base_siguiente != null) {
    out.push(`${formatearPct(r.pct_bruto)} sobre ${y} (${unidades(r.base_siguiente)})`);
  }
  if (conNino && r.base_normalizada != null && r.base_siguiente != null) {
    out.push(r.base_normalizada < r.base_siguiente ? `${y} vendió de más por el Niño: la base corregida es menor que lo vendido.` : `${y} vendió de menos por el Niño: la base corregida es mayor que lo vendido.`);
  }
  if (r.decidido !== null && r.pct_bruto != null) {
    const corr = conNino && r.pct_sobre_normalizada != null ? ` (${formatearPct(r.pct_sobre_normalizada)} sobre ${y} corregido)` : "";
    out.push(`Tu decisión: ${formatearPct(r.pct_bruto)} sobre ${y} real${corr}.`);
  }
  return out;
}

/**
 * Lo que da un % escrito sobre la base corregida de la fila: `round(B' × (1 + g))` y su % sobre la real. Es la misma aritmética del método 5
 * (`P = round(B' × (1 + g))`) y sirve para decir, mientras se escribe, «= 20,655 u (+35.0 % sobre 2026 real)». `null` sin base corregida.
 */
export function equivalenteDeCrecimiento(base: { real: number | null | undefined; corregida: number | null | undefined }, g: number): { total: number; pctReal: number | null } | null {
  if (base.corregida == null || !(base.corregida > 0) || !Number.isFinite(g)) return null;
  const total = Math.round(base.corregida * (1 + g / 100));
  return { total, pctReal: base.real != null && base.real > 0 ? (total / base.real - 1) * 100 : null };
}

/** «= 20,655 u en 2027 (+35.0 % sobre 2026 real)». */
export function textoEquivalente(eq: { total: number; pctReal: number | null }, anio: number, anioEnCurso: number): string {
  return `= ${unidades(eq.total)} u en ${anio}${eq.pctReal === null ? "" : ` (${formatearPct(eq.pctReal)} sobre ${anioEnCurso} real)`}`;
}

/** Las bases de una línea sumadas de sus filas base de `Y+1` con `B` (lo que no trae `totales_por_anio`). `null` si ninguna trae la base corregida. */
export function basesDeLinea(filas: readonly Pick<FilaApi, "tienda_id" | "activo" | "anios">[], anioEnCurso: number): { real: number; corregida: number; vigente: number } | null {
  let real = 0;
  let corregida = 0;
  let vigente = 0;
  let n = 0;
  for (const f of filas) {
    if (f.tienda_id !== null || !f.activo) continue;
    const r = f.anios.find((a) => a.anio === anioEnCurso + 1);
    if (!r || r.base_siguiente == null || r.base_normalizada == null) continue;
    real += r.base_siguiente;
    corregida += r.base_normalizada;
    vigente += r.vigente ?? r.decidido ?? r.propuesto ?? 0;
    n += 1;
  }
  return n === 0 ? null : { real, corregida, vigente };
}

/**
 * El pie de «Línea (mismas)» de `Y+1`: «+8.0 % sobre 2026 corregido (60,002 ÷ 55,500) · +20.0 % sobre 2026 real (60,002 ÷ 50,001)». Sin
 * Niño o sin la base corregida, un solo %. `null` sin base real.
 */
export function textoPieCrecimientoLinea(vigente: number, baseSiguiente: number | undefined, anioEnCurso: number, baseCorregida?: number | null): string | null {
  if (baseSiguiente === undefined || baseSiguiente <= 0) return null;
  const real = `${formatearPct((vigente / baseSiguiente - 1) * 100)} sobre ${anioEnCurso} real (${unidades(vigente)} ÷ ${unidades(baseSiguiente)})`;
  if (baseCorregida == null || !(baseCorregida > 0)) return real;
  if (Math.round(baseCorregida) === Math.round(baseSiguiente)) return `${real}; sin corrección del Niño`;
  return `${formatearPct((vigente / baseCorregida - 1) * 100)} sobre ${anioEnCurso} corregido (${unidades(vigente)} ÷ ${unidades(baseCorregida)}) · ${real}`;
}
