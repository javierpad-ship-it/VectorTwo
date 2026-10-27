// Lógica de vista de la pestaña Crecimientos de M7 (ficha 06d, 0.12.1). Pura, sin React: la prueban vitest con datos sintéticos.
// Desde 0.12.1 el crecimiento del año siguiente es GLOBAL y versionado (se aprueba en Curvas de estacionalidad → Crecimiento por
// género × mundo): esta pestaña es de solo lectura y muestra la foto de lo que aplicó el último cálculo frente a lo aprobado hoy.
// Aquí viven las filas de esa tabla, los avisos, el puente y el objetivo, y los textos de «Por línea» que explican el % bruto efectivo
// de una fila («20 % · HOMBRE · URBANO v2», «5 % · Resto v1», «5 % · Resto provisional»). El servidor es el dueño de las cifras.

import { formatearDecimal, formatearNumero, plural } from "@/lib/formato";
import type {
  AnioFilaApi,
  CrecimientoEfectivoApi,
  FilaResumenCrecimientoApi,
  ProyeccionApi,
  ResultadoPromedio,
  ResumenCrecimientosProyeccionApi,
} from "@/lib/proyeccion/tipos-api";
import { formatearMomento, formatearPct, unidades } from "./vista";

/** Desde este método el resumen de crecimientos tiene base y foto (06d §5.1). Por debajo, solo se pide recalcular. */
export const VERSION_METODO_CRECIMIENTOS = 4;

const pctCorto = (n: number): string => `${formatearDecimal(n, n % 1 === 0 ? 0 : 1)} %`;

/** `1 y 2`, `A, B y C`: la lista en palabras. */
export function listaEnPalabras(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

// ─── Pestaña: textos generales ───

/** La proyección es de un método anterior al 4: el resumen no tiene base ni foto y solo se pide recalcular. */
export const esMetodoAnterior = (r: Pick<ResumenCrecimientosProyeccionApi, "version_metodo">): boolean => r.version_metodo === null || r.version_metodo < VERSION_METODO_CRECIMIENTOS;

/** El aviso de método anterior: en trabajo manda recalcular; cerrada o archivada no se recalcula. */
export function textoMetodoAnterior(enTrabajo: boolean): string {
  return enTrabajo
    ? "Esta proyección se calculó con un método anterior: recalcúlala para ver sus crecimientos."
    : "Esta proyección se calculó con un método anterior y es de solo lectura: no muestra sus crecimientos.";
}

/** La frase de la cabecera de la pestaña. */
export function textoCabeceraCrecimientos(anioEnCurso: number, anioSiguiente: number): string {
  return `Crecimiento bruto ${anioSiguiente} frente a ${anioEnCurso} de las mismas tiendas de ${anioSiguiente}, sin corregir por el Niño. Se aprueba una sola vez para todas las proyecciones en Curvas de estacionalidad; aquí se ve lo que aplicó el último cálculo.`;
}


// ─── Foto (aplicado) frente a lo aprobado hoy ───

type Aplicado = FilaResumenCrecimientoApi["aplicado"];
type VigenteHoy = FilaResumenCrecimientoApi["vigente_hoy"];

/** «v2», «provisional» (el Resto sin aprobar) o «sin versión» (una celda escrita antes de 0.12.1). */
export function textoVersion(a: Pick<Aplicado, "version" | "provisional">): string {
  if (a.version !== null) return `v${a.version}`;
  return a.provisional ? "provisional" : "sin versión";
}

/** «15 % · v1» o «5 % · provisional». */
export const textoAplicadoPrincipal = (a: Aplicado): string => `${pctCorto(a.pct)} · ${textoVersion(a)}`;

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

/** «rebote del Niño +9.6 %» o `null` si ninguna fila tiene meses del Niño. */
export function textoRebote(a: { rebote_nino_pct: number | null }): { texto: string; titulo: string } | null {
  if (a.rebote_nino_pct === null) return null;
  const v = formatearPct(a.rebote_nino_pct);
  return { texto: `rebote del Niño ${v}`, titulo: `Solo por volver a un año normal, este grupo crecería ${v} bruto. Es referencia: no se aplica.` };
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
  ponderado: number | null;
  vigenteHoy: VigenteHoy;
  /** Lo aprobado hoy difiere de lo aplicado: badge «cambió». */
  cambio: boolean;
  /** `Σ B`: unidades de `Y` de las mismas tiendas de `Y+1`. */
  base: number;
  /** `Y+1` resultante de las mismas tiendas, en unidades (`Σ vigente`). */
  siguiente: number;
  resultantePct: number | null;
  rebote: { texto: string; titulo: string } | null;
  insignias: InsigniaCelda[];
  enlace: string | null;
};

function nombreDeFila(f: Pick<FilaResumenCrecimientoApi, "genero" | "mundo">): string {
  return f.genero === null && f.mundo === null ? "Resto" : [f.genero, f.mundo].filter(Boolean).join(" · ");
}

function deFila(f: FilaResumenCrecimientoApi, tipo: "gm" | "resto", desglose: string | null): FilaTablaCrecimiento {
  return {
    clave: f.clave,
    tipo,
    nombre: tipo === "resto" ? "Resto" : nombreDeFila(f),
    desglose,
    aplicado: f.aplicado,
    ponderado: null,
    vigenteHoy: f.vigente_hoy,
    cambio: filaCambio(f),
    base: f.agregado.base,
    siguiente: f.agregado.siguiente_vigente,
    resultantePct: f.resultante_pct,
    rebote: textoRebote(f.agregado),
    insignias: insigniasDeFijadas(f.agregado),
    enlace: f.enlace,
  };
}

/** El rebote del conjunto: `Σ B'' ÷ Σ B − 1`, o `null` si ninguna fila lo tiene. */
function reboteTotal(filas: readonly FilaResumenCrecimientoApi[]): { texto: string; titulo: string } | null {
  if (filas.every((f) => f.agregado.rebote_nino_pct === null)) return null;
  const base = filas.reduce((s, f) => s + f.agregado.base, 0);
  if (base <= 0) return null;
  const normalizada = filas.reduce((s, f) => s + f.agregado.base_normalizada, 0);
  return textoRebote({ rebote_nino_pct: (normalizada / base - 1) * 100 });
}

/**
 * Las filas de la tabla: los GM de HOMBRE y MUJER, el Resto y, al final, el Total (`calcularPromedio` de 07c sobre la foto, que trae el
 * servidor). Sin `total` (método anterior) no hay fila Total.
 */
export function filasDeResumen(r: Pick<ResumenCrecimientosProyeccionApi, "filas" | "resto" | "total">): FilaTablaCrecimiento[] {
  const filas = r.filas.map((f) => deFila(f, "gm", null));
  const resto = deFila(r.resto, "resto", textoDesgloseResto(r.resto.por_genero));
  const out = [...filas, resto];
  if (r.total) {
    const todas = [...r.filas, r.resto];
    out.push({
      clave: "total",
      tipo: "total",
      nombre: "Total (mismas tiendas)",
      desglose: null,
      aplicado: null,
      ponderado: r.total.ponderado_escrito_pct,
      vigenteHoy: null,
      cambio: false,
      base: r.total.base_total,
      siguiente: r.total.siguiente_total,
      resultantePct: r.total.resultante_pct,
      rebote: reboteTotal(todas),
      insignias: insigniasDeFijadas({
        pct_propio: { filas: r.total.filas_con_pct_propio, base: 0, siguiente: 0 },
        decididas: { filas: r.total.filas_decididas, base: 0, siguiente: 0 },
      }),
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

/** Las líneas del puente al Total de `Y+1` de la Matriz (07c §5.2), sobre la foto. */
export function lineasPuente(total: ResultadoPromedio, anioEnCurso: number, anioSiguiente: number): LineaPuente[] {
  const y = anioEnCurso;
  const s = anioSiguiente;
  const p = total.puente;
  return [
    { clave: "base", texto: `Base ${y} de las mismas tiendas de ${s}`, valor: `${unidades(p.base)} u` },
    { clave: "mismas", texto: `× crecimiento resultante ${formatearPct(total.resultante_pct)} = ${s} de las mismas tiendas`, valor: `${unidades(p.mismas_siguiente)} u` },
    { clave: "nuevas", texto: `+ nuevas del año anterior (${s})`, valor: `${unidades(p.nuevas_anterior)} u` },
    { clave: "aperturas", texto: `+ aperturas de ${s}`, valor: `${unidades(p.aperturas)} u` },
    { clave: "cierres", texto: `+ cierres de ${s} (su venta parcial suma: su ${y} ya salió de la base)`, valor: textoCierresPuente(p) },
    { clave: "total", texto: `= Total ${s}`, valor: `${unidades(p.total_siguiente)} u`, negrita: true },
    { clave: "comparado", texto: `Total ${y} de la Matriz ${unidades(p.total_en_curso)} u → Var. de la Matriz`, valor: formatearPct(p.var_pct) },
  ];
}

// ─── Nueva proyección y parámetros: el Resto ───

type RestoDeFoto = { pct: number; version: number | null; aprobado: boolean };

/** El Resto de la foto de una proyección: el usado en el último cálculo o, sin la clave (antes de 0.12.1), el provisional. */
export function restoDeFoto(p: Pick<ProyeccionApi, "parametros">): RestoDeFoto {
  const u = p.parametros.crecimiento_resto_usado;
  if (u) return { pct: u.pct, version: u.version, aprobado: u.crecimiento_id !== null };
  return { pct: p.parametros.crecimiento_pct_defecto, version: null, aprobado: false };
}

/** «5 % · Resto v1 (aprobado)» o «5 % · Resto provisional». */
export function textoRestoDeFoto(r: RestoDeFoto): string {
  return `${pctCorto(r.pct)} · Resto ${r.aprobado && r.version !== null ? `v${r.version} (aprobado)` : "provisional"}`;
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

// ─── Por línea: el % bruto efectivo de una fila ───

/** «HOMBRE · URBANO v2», «Resto v1», «Resto provisional», «esta fila». Sin versión (datos de antes de 0.12.1): «HOMBRE · URBANO», «Resto». */
function nombreOrigen(c: CrecimientoEfectivoApi): string {
  if (c.origen === "fila") return "esta fila";
  if (c.origen === "resto") return `Resto${c.provisional ? " provisional" : c.version != null ? ` v${c.version}` : ""}`;
  return `${c.celda ?? "celda"}${c.version != null ? ` v${c.version}` : ""}`;
}

/** «20 % · HOMBRE · URBANO v2», «5 % · Resto v1», «5 % · Resto provisional» o «8 % · esta fila». */
export function textoOrigenCrecimiento(c: CrecimientoEfectivoApi | null | undefined): string | null {
  if (!c) return null;
  return `${pctCorto(c.pct)} · ${nombreOrigen(c)}`;
}

/** Ayuda del campo «Crec.»: «% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el aprobado de HOMBRE · URBANO (20 %).» */
export function ayudaCrecimientoFila(c: CrecimientoEfectivoApi | null | undefined, anio: number, anioEnCurso: number): string {
  const base = `% bruto ${anio} ÷ ${anioEnCurso} de esta fila, sin corregir por el Niño.`;
  if (!c || c.origen === "fila") return `${base} Vacío = el aprobado de la combinación género · mundo (o el Resto).`;
  const pct = formatearDecimal(c.pct, c.pct % 1 === 0 ? 0 : 1);
  if (c.origen === "resto") return `${base} Vacío = el Resto ${c.provisional ? "provisional" : "aprobado"} (${pct} %).`;
  return `${base} Vacío = el aprobado de ${c.celda ?? "la combinación"} (${pct} %).`;
}

/** Marcador del campo «Crec.» de una fila de `Y+1`. `null` si la fila no trae el % efectivo (proyección anterior al método 4). */
export function marcadorCrecimiento(r: Pick<AnioFilaApi, "crecimiento_efectivo"> | undefined): string | null {
  return textoOrigenCrecimiento(r?.crecimiento_efectivo);
}

/**
 * El detalle de una fila de `Y+1`: «Crecimiento bruto efectivo +20,0 % (HOMBRE · URBANO v2) · base 2026 de las mismas tiendas de
 * 2027: 19,424 u». Con meses del Niño añade lo que equivale sobre la base normalizada, y una fila decidida muestra su % bruto.
 */
export function textosDetalleBruto(r: Pick<AnioFilaApi, "crecimiento_efectivo" | "base_siguiente" | "base_normalizada" | "pct_bruto" | "pct_sobre_normalizada" | "decidido">, anio: number, anioEnCurso: number): string[] {
  const out: string[] = [];
  const ce = r.crecimiento_efectivo;
  if (ce) {
    const donde = ce.origen === "fila" ? "% propio de la fila" : nombreOrigen(ce);
    const base = r.base_siguiente !== null && r.base_siguiente !== undefined ? ` · base ${anioEnCurso} de las mismas tiendas de ${anio}: ${unidades(r.base_siguiente)} u` : "";
    out.push(`Crecimiento bruto efectivo ${formatearPct(ce.pct)} (${donde})${base}`);
  }
  const conNino = r.base_siguiente != null && r.base_normalizada != null && Math.round(r.base_normalizada) !== Math.round(r.base_siguiente);
  if (conNino && r.pct_sobre_normalizada != null) out.push(`Sobre la base normalizada por el Niño equivale a ${formatearPct(r.pct_sobre_normalizada)}.`);
  if (r.decidido !== null && r.pct_bruto != null) out.push(`Tu decisión: ${formatearPct(r.pct_bruto)} bruto.`);
  return out;
}

/** El pie de «Línea (mismas)» de `Y+1`: «+20,0 % bruto sobre la base 2026 de las mismas tiendas de 2027 (60,002 ÷ 50,001)». `null` sin base. */
export function textoPieCrecimientoLinea(vigente: number, baseSiguiente: number | undefined, anio: number, anioEnCurso: number): string | null {
  if (baseSiguiente === undefined || baseSiguiente <= 0) return null;
  return `${formatearPct((vigente / baseSiguiente - 1) * 100)} bruto sobre la base ${anioEnCurso} de las mismas tiendas de ${anio} (${unidades(vigente)} ÷ ${unidades(baseSiguiente)})`;
}
