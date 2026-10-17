// Lógica de vista de la pestaña Crecimientos de M7 (ficha 07c, 0.10.8). Pura, sin React: la prueban vitest con datos sintéticos.
// Aquí viven el borrador de la matriz (lo que el planner escribe), la lectura y validación de cada %, el cuerpo del
// `PUT`, «Calcular promedio» (la cuenta es `calcularPromedio` de `@/lib/proyeccion/crecimientos`, en el navegador con los agregados del `GET`), las insignias de cada celda, los textos
// del Modal «Pisar / Conservar / Cancelar» y los textos de «Por línea» que explican el % bruto efectivo de una fila.
// El servidor es el dueño de las cifras; esto solo pondera lo que ya viene calculado.

import { formatearDecimal, formatearNumero, plural } from "@/lib/formato";
import { calcularPromedio as calcularPromedioLib } from "@/lib/proyeccion/crecimientos";
import {
  CRECIMIENTO_EXTREMO_PCT,
  type AgregadoCrecimientoApi,
  type AnioFilaApi,
  type BloquesApi,
  type CeldaCrecimientoApi,
  type CeldaParaPromedio,
  type ConflictoFilasManualesApi,
  type CrecimientoEfectivoApi,
  type GuardarCrecimientosCuerpoApi,
  type ResultadoGuardarCrecimientosApi,
  type RespuestaCrecimientosApi,
} from "@/lib/proyeccion/tipos-api";
import { formatearPct, leerPorcentaje, resumenBloquesAnio, unidades } from "./vista";

// ─── Borrador de la matriz ───

export type CampoBorrador = { pct: string; nota: string };
export type Borrador = {
  /** Una por género × mundo mostrado (clave `genero_id|mundo_id`), también las «sin filas» que tengan un % guardado. */
  celdas: Record<string, CampoBorrador>;
  resto: CampoBorrador;
  /** Objetivo global (%), opcional; vacío = sin objetivo. */
  objetivo: string;
};

export const claveCelda = (generoId: string, mundoId: string): string => `${generoId}|${mundoId}`;

const textoNumero = (n: number | null | undefined): string => (n === null || n === undefined ? "" : String(n));

/** El borrador inicial: exactamente lo que está guardado. Una celda sin definir queda vacía (sigue al Resto). */
export function borradorDesde(r: Pick<RespuestaCrecimientosApi, "celdas" | "resto" | "objetivo_pct">): Borrador {
  const celdas: Record<string, CampoBorrador> = {};
  for (const c of r.celdas) celdas[claveCelda(c.genero_id, c.mundo_id)] = { pct: textoNumero(c.pct), nota: c.nota ?? "" };
  return { celdas, resto: { pct: textoNumero(r.resto.pct), nota: r.resto.nota ?? "" }, objetivo: textoNumero(r.objetivo_pct) };
}

export const campoVacio: CampoBorrador = { pct: "", nota: "" };

/** Una celda se escribe solo si ese género tiene filas en ese mundo. */
export const celdaEditable = (c: Pick<CeldaCrecimientoApi, "sin_filas">): boolean => !c.sin_filas;

export function nombreCelda(r: Pick<RespuestaCrecimientosApi, "generos" | "mundos">, c: Pick<CeldaCrecimientoApi, "genero_id" | "mundo_id">): string {
  const g = r.generos.find((x) => x.id === c.genero_id)?.nombre ?? "Género";
  const m = r.mundos.find((x) => x.id === c.mundo_id)?.nombre ?? "Mundo";
  return `${g} · ${m}`;
}

export function celdaDe(r: Pick<RespuestaCrecimientosApi, "celdas">, generoId: string, mundoId: string): CeldaCrecimientoApi | undefined {
  return r.celdas.find((c) => c.genero_id === generoId && c.mundo_id === mundoId);
}

/** Lectura del texto de un % de la matriz: vacío es «falta», un texto raro es «inválido». */
export type LecturaPct = { estado: "vacio" } | { estado: "ok"; valor: number } | { estado: "invalido"; motivo: string };

export function leerPctMatriz(texto: string): LecturaPct {
  if (texto.trim() === "") return { estado: "vacio" };
  const l = leerPorcentaje(texto);
  return l.ok ? { estado: "ok", valor: l.valor } : { estado: "invalido", motivo: l.motivo };
}

/** `1 y 2`, `A, B y C`: la lista en palabras. */
export function listaEnPalabras(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

export type Diagnostico = {
  /** Nombres de las celdas editables (y del Resto) sin % escrito. */
  faltan: string[];
  /** Celdas con un % que no es un número válido o está fuera de rango. */
  invalidas: { nombre: string; motivo: string }[];
  /** Motivo si el objetivo global escrito no es válido. */
  objetivoInvalido: string | null;
};

/** Qué impide guardar o calcular: celdas vacías, % inválidos y objetivo inválido. */
export function diagnostico(r: Pick<RespuestaCrecimientosApi, "celdas" | "generos" | "mundos">, b: Borrador): Diagnostico {
  const faltan: string[] = [];
  const invalidas: Diagnostico["invalidas"] = [];
  for (const c of r.celdas) {
    if (!celdaEditable(c)) continue;
    const nombre = nombreCelda(r, c);
    const l = leerPctMatriz((b.celdas[claveCelda(c.genero_id, c.mundo_id)] ?? campoVacio).pct);
    if (l.estado === "vacio") faltan.push(nombre);
    else if (l.estado === "invalido") invalidas.push({ nombre, motivo: l.motivo });
  }
  const resto = leerPctMatriz(b.resto.pct);
  if (resto.estado === "vacio") faltan.push("Resto");
  else if (resto.estado === "invalido") invalidas.push({ nombre: "Resto", motivo: resto.motivo });
  let objetivoInvalido: string | null = null;
  if (b.objetivo.trim() !== "") {
    const o = leerPorcentaje(b.objetivo);
    if (!o.ok) objetivoInvalido = o.motivo;
  }
  return { faltan, invalidas, objetivoInvalido };
}

/** «Faltan 3 celdas: A, B y C. Escribe un % en cada una (puede ser el mismo del Resto).» `null` si no falta ninguna. */
export function textoFaltan(faltan: readonly string[]): string | null {
  if (faltan.length === 0) return null;
  const celdas = faltan.length === 1 ? "1 celda" : `${formatearNumero(faltan.length)} celdas`;
  return `${faltan.length === 1 ? "Falta" : "Faltan"} ${celdas}: ${listaEnPalabras(faltan)}. Escribe un % en cada una (puede ser el mismo del Resto).`;
}

/** El motivo por el que no se puede guardar ni calcular todavía, o `null` si la matriz está completa y válida. */
export function motivoIncompleta(d: Diagnostico): string | null {
  const falta = textoFaltan(d.faltan);
  if (falta) return falta;
  if (d.invalidas.length > 0) return `Corrige el % de ${listaEnPalabras(d.invalidas.map((i) => i.nombre))}: debe ser un número entre -95 y 500.`;
  if (d.objetivoInvalido) return `Objetivo global: ${d.objetivoInvalido}`;
  return null;
}

export type ExtrasGuardar = Pick<GuardarCrecimientosCuerpoApi, "resolucion" | "incluir_decididas" | "huella_choque">;

/**
 * El cuerpo del `PUT` (reemplazo completo: lo que no viene se borra). Lleva todas las celdas escritas y también las «sin filas» que
 * tenían un % guardado, para conservarlas. `resolucion` y `huella_choque` solo salen de lo que Javier pulsó en el Modal.
 */
export function cuerpoGuardar(r: RespuestaCrecimientosApi, b: Borrador, extras: ExtrasGuardar = {}): { ok: true; cuerpo: GuardarCrecimientosCuerpoApi } | { ok: false; motivo: string } {
  const motivo = motivoIncompleta(diagnostico(r, b));
  if (motivo) return { ok: false, motivo };
  const nota = (t: string) => (t.trim() === "" ? null : t.trim());
  const celdas: GuardarCrecimientosCuerpoApi["celdas"] = [];
  for (const c of r.celdas) {
    const campo = b.celdas[claveCelda(c.genero_id, c.mundo_id)] ?? campoVacio;
    const l = leerPctMatriz(campo.pct);
    if (l.estado !== "ok") continue; // solo puede ser una celda «sin filas» sin % guardado
    celdas.push({ genero_id: c.genero_id, mundo_id: c.mundo_id, pct: l.valor, nota: nota(campo.nota) });
  }
  const resto = leerPctMatriz(b.resto.pct);
  if (resto.estado !== "ok") return { ok: false, motivo: "Escribe el % del Resto." };
  const objetivo = b.objetivo.trim() === "" ? null : leerPorcentaje(b.objetivo);
  const cuerpo: GuardarCrecimientosCuerpoApi = {
    huella: r.huella,
    resto: { pct: resto.valor, nota: nota(b.resto.nota) },
    objetivo_pct: objetivo && objetivo.ok ? objetivo.valor : null,
    celdas,
  };
  if (extras.resolucion) {
    cuerpo.resolucion = extras.resolucion;
    if (extras.huella_choque) cuerpo.huella_choque = extras.huella_choque;
    if (extras.resolucion === "pisar" && extras.incluir_decididas) cuerpo.incluir_decididas = true;
  }
  return { ok: true, cuerpo };
}

const igualPct = (texto: string, guardado: number | null): boolean => {
  const l = leerPctMatriz(texto);
  if (guardado === null) return l.estado === "vacio";
  return l.estado === "ok" && l.valor === guardado;
};

/** ¿Hay algo escrito distinto de lo guardado? (habilita «Descartar cambios»). */
export function hayCambios(r: Pick<RespuestaCrecimientosApi, "celdas" | "resto" | "objetivo_pct">, b: Borrador): boolean {
  for (const c of r.celdas) {
    const campo = b.celdas[claveCelda(c.genero_id, c.mundo_id)] ?? campoVacio;
    if (!igualPct(campo.pct, c.pct) || campo.nota.trim() !== (c.nota ?? "")) return true;
  }
  if (!igualPct(b.resto.pct, r.resto.pct) || b.resto.nota.trim() !== (r.resto.nota ?? "")) return true;
  return !igualPct(b.objetivo, r.objetivo_pct);
}

// ─── Calcular promedio (en el navegador) ───

/** Un conjunto de la matriz con su % escrito: una celda con filas o el Resto. */
export type EntradaPromedio = { clave: string; nombre: string; pct: number; agregado: AgregadoCrecimientoApi };

/** Las entradas de «Calcular promedio»: las celdas editables y el Resto. Con `vaciasComoResto`, una celda vacía sigue al Resto (vista de solo lectura). */
export function entradasPromedio(
  r: Pick<RespuestaCrecimientosApi, "celdas" | "resto" | "generos" | "mundos">,
  b: Borrador,
  opciones: { vaciasComoResto?: boolean } = {}
): { ok: true; entradas: EntradaPromedio[]; resto: EntradaPromedio } | { ok: false; faltan: string[] } {
  const faltan: string[] = [];
  const entradas: EntradaPromedio[] = [];
  const resto = leerPctMatriz(b.resto.pct);
  const pctResto = resto.estado === "ok" ? resto.valor : null;
  if (pctResto === null) faltan.push("Resto");
  for (const c of r.celdas) {
    if (!celdaEditable(c)) continue;
    const nombre = nombreCelda(r, c);
    const l = leerPctMatriz((b.celdas[claveCelda(c.genero_id, c.mundo_id)] ?? campoVacio).pct);
    if (l.estado === "ok") entradas.push({ clave: claveCelda(c.genero_id, c.mundo_id), nombre, pct: l.valor, agregado: c.agregado });
    else if (opciones.vaciasComoResto && l.estado === "vacio" && pctResto !== null) entradas.push({ clave: claveCelda(c.genero_id, c.mundo_id), nombre, pct: pctResto, agregado: c.agregado });
    else faltan.push(nombre);
  }
  if (faltan.length > 0 || pctResto === null) return { ok: false, faltan };
  return { ok: true, entradas, resto: { clave: "resto", nombre: "Resto", pct: pctResto, agregado: r.resto.agregado } };
}

export type FilaPromedio = {
  clave: string;
  nombre: string;
  tipo: "celda" | "resto" | "total";
  /** `Σ B`: unidades de `Y` de las mismas tiendas de `Y+1`. */
  base: number;
  /** % escrito (en el total, el ponderado de lo escrito). `null` si el peso es 0. */
  escrito: number | null;
  /** `Y+1` resultante: `pct_propio.siguiente + decididas.siguiente + base_libre × (1 + g)`. */
  siguiente: number;
  /** `siguiente ÷ base − 1`, en %. `null` sin base. */
  resultante: number | null;
};

export type PuenteTotal = {
  /** Total `Y+1` de las mismas tiendas (= `Σ siguiente`). */
  mismas: number;
  nuevas_anterior: number;
  aperturas: number;
  cierres: number;
  cierres_sin_decidir: number;
  total: number;
  /** Total `Y` de la Matriz (todas las columnas). */
  total_en_curso: number;
  /** `total ÷ total_en_curso − 1`, en %: la «Var.» de la Matriz. `null` si el total de `Y` es 0. */
  variacion_pct: number | null;
};

export type ResultadoPromedio = {
  filas: FilaPromedio[];
  base: number;
  /** `ḡ = Σ B g ÷ Σ B`, en %. `null` si `Σ B = 0`. */
  ponderado_escrito: number | null;
  siguiente: number;
  /** `Σ S ÷ Σ B − 1`, en %. `null` si `Σ B = 0`. */
  resultante: number | null;
  /** Filas fijadas a mano que desvían el resultado de lo escrito. */
  filas_con_pct_propio: number;
  filas_decididas: number;
  objetivo: {
    pct: number;
    /** Puntos que faltan (positivo) o sobran (negativo) frente a lo escrito y frente al resultado. */
    faltan_pp_escrito: number | null;
    faltan_pp_resultado: number | null;
    /** `Σ B (1 + objetivo) − Σ S`: unidades que faltan (positivo) o sobran (negativo). `null` sin base. */
    faltan_unidades: number | null;
  } | null;
  puente: PuenteTotal;
};

/**
 * «Calcular promedio» en la pantalla (ficha 07c, §5.2). NO calcula: la cuenta vive en UN solo sitio, `calcularPromedio` de
 * `@/lib/proyeccion/crecimientos` (pura, importable desde el cliente). Esto solo le entrega las entradas ya leídas del borrador y
 * reordena su resultado a las filas que pinta el panel (nombre de cada celda, fila de Total, puente con los nombres de la pantalla).
 * Es una estimación: puede diferir del recálculo en ±0,5 u por fila por el redondeo.
 */
export function promedioParaPantalla(
  entradas: readonly EntradaPromedio[],
  resto: EntradaPromedio,
  objetivoPct: number | null,
  puente: Pick<RespuestaCrecimientosApi["puente"], "total_en_curso" | "nuevas_anterior" | "aperturas" | "cierres" | "cierres_sin_decidir">
): ResultadoPromedio {
  // Las entradas ya son celdas con filas y con % escrito: el servidor las devuelve en el mismo orden, más el Resto al final.
  const celdas: CeldaParaPromedio[] = entradas.map((e) => ({ genero: e.nombre, mundo: "", pct: e.pct, sin_filas: false, agregado: e.agregado }));
  const { resultado: r } = calcularPromedioLib(celdas, { pct: resto.pct, agregado: resto.agregado }, objetivoPct, puente);
  if (!r) throw new Error("promedioParaPantalla: las entradas llegan completas");
  const conjuntos = [...entradas, resto];
  const filas: FilaPromedio[] = r.filas.map((f, i) => ({
    clave: conjuntos[i].clave,
    nombre: conjuntos[i].nombre,
    tipo: i === entradas.length ? "resto" : "celda",
    base: f.base,
    escrito: f.pct_escrito,
    siguiente: f.siguiente,
    resultante: f.pct_resultante,
  }));
  const total: FilaPromedio = { clave: "total", nombre: "Total (mismas tiendas)", tipo: "total", base: r.base_total, escrito: r.ponderado_escrito_pct, siguiente: r.siguiente_total, resultante: r.resultante_pct };
  return {
    filas: [...filas, total],
    base: r.base_total,
    ponderado_escrito: r.ponderado_escrito_pct,
    siguiente: r.siguiente_total,
    resultante: r.resultante_pct,
    filas_con_pct_propio: r.filas_con_pct_propio,
    filas_decididas: r.filas_decididas,
    objetivo: r.objetivo,
    puente: {
      mismas: r.puente.mismas_siguiente,
      nuevas_anterior: r.puente.nuevas_anterior,
      aperturas: r.puente.aperturas,
      cierres: r.puente.cierres,
      cierres_sin_decidir: r.puente.cierres_sin_decidir,
      total: r.puente.total_siguiente,
      total_en_curso: r.puente.total_en_curso,
      variacion_pct: r.puente.var_pct,
    },
  };
}

/** Una cadena que cambia cuando cambia cualquier % o el objetivo: dice si el panel de resultado quedó viejo. */
export function firmaBorrador(b: Borrador): string {
  return JSON.stringify([Object.entries(b.celdas).map(([k, c]) => [k, c.pct.trim()]).sort(([a], [z]) => String(a).localeCompare(String(z))), b.resto.pct.trim(), b.objetivo.trim()]);
}

/**
 * Por qué «Calcular promedio» no sirve todavía aunque la matriz esté completa (proyección de antes de 0.10.8 o sin base), o `null`.
 * Una proyección cerrada o archivada no se recalcula: ahí el motivo manda a crear una nueva, no a recalcular.
 */
export function motivoSinBase(r: Pick<RespuestaCrecimientosApi, "metodo_viejo" | "celdas" | "resto">, enTrabajo = true): string | null {
  if (r.metodo_viejo) {
    return enTrabajo
      ? "Recalcula: método nuevo. La proyección es de una versión anterior y todavía no tiene la base de cada celda."
      : "Proyección cerrada con el método anterior: solo lectura; crea una nueva.";
  }
  const base = r.celdas.reduce((s, c) => s + c.agregado.base, 0) + r.resto.agregado.base;
  if (base > 0) return null;
  return enTrabajo ? "Sin base: recalcula la proyección." : "Sin base en esta proyección cerrada: es de solo lectura; crea una nueva.";
}

const pp = (n: number): string => `${formatearDecimal(Math.abs(n), 1)} pp`;
const faltaOSobra = (n: number | null): string => (n === null ? "—" : n >= 0 ? `te faltan ${pp(n)}` : `te pasas por ${pp(n)}`);

/** «Objetivo +12.0 % → con lo escrito te faltan 0.3 pp; con el resultado, te faltan 1.8 pp ≈ 2,215 u». Con el objetivo superado dice «te pasas». */
export function textoObjetivo(o: NonNullable<ResultadoPromedio["objetivo"]>): string {
  const u = o.faltan_unidades === null ? null : Math.round(o.faltan_unidades);
  const unidadesTexto = u === null ? "" : ` ≈ ${u >= 0 ? `${formatearNumero(u)} u` : `${formatearNumero(-u)} u de más`}`;
  return `Objetivo ${formatearPct(o.pct)} → con lo escrito ${faltaOSobra(o.faltan_pp_escrito)}; con el resultado, ${faltaOSobra(o.faltan_pp_resultado)}${unidadesTexto}.`;
}

/** «3 filas con % propio y 5 decididas llevan el total de +11.7 % a +10.2 %», o que coinciden si no hay filas fijadas. */
export function textoDesvioPorFijadas(r: Pick<ResultadoPromedio, "filas_con_pct_propio" | "filas_decididas" | "ponderado_escrito" | "resultante">): string {
  const propias = r.filas_con_pct_propio;
  const decididas = r.filas_decididas;
  if (propias === 0 && decididas === 0) return "No hay filas fijadas a mano: el resultado coincide con lo escrito.";
  const quienes = [propias > 0 ? plural(propias, "fila con % propio", "filas con % propio") : null, decididas > 0 ? plural(decididas, "decidida", "decididas") : null].filter(Boolean).join(" y ");
  return `${quienes} llevan el total de ${formatearPct(r.ponderado_escrito)} a ${formatearPct(r.resultante)}.`;
}

/** El título de «Cierres» del puente: «0 u (1 tienda sin decidir)» si hay cierres sin decidir. */
export function textoCierresPuente(p: Pick<PuenteTotal, "cierres" | "cierres_sin_decidir">): string {
  const base = `${unidades(p.cierres)} u`;
  return p.cierres_sin_decidir > 0 ? `${base} (${plural(p.cierres_sin_decidir, "tienda sin decidir", "tiendas sin decidir")})` : base;
}

// ─── Insignias y textos de cada celda ───

export type InsigniaCelda = { clave: string; texto: string; tono: "neutro" | "alerta" | "marca"; titulo?: string };

/** `|pct| > 50` avisa («extremo») y no bloquea. */
export const esExtremo = (pct: number | null): boolean => pct !== null && Math.abs(pct) > CRECIMIENTO_EXTREMO_PCT;

/** Las insignias de una celda o del Resto: «N con % propio», «N decididas», «extremo» y «sin base». Se calculan con el % escrito. */
export function insigniasDeConjunto(agregado: AgregadoCrecimientoApi, pct: number | null): InsigniaCelda[] {
  const out: InsigniaCelda[] = [];
  if (agregado.pct_propio.filas > 0) {
    out.push({ clave: "propio", texto: `${agregado.pct_propio.filas} con % propio`, tono: "neutro", titulo: "Estas filas tienen su propio % (escrito en Por línea): no siguen esta celda." });
  }
  if (agregado.decididas.filas > 0) {
    out.push({
      clave: "decididas",
      texto: agregado.decididas.filas === 1 ? "1 decidida" : `${agregado.decididas.filas} decididas`,
      tono: "neutro",
      titulo: "Estas filas tienen su total de 2027 decidido: conservan su cifra.",
    });
  }
  if (esExtremo(pct)) out.push({ clave: "extremo", texto: "extremo", tono: "alerta", titulo: `Un % fuera de ±${CRECIMIENTO_EXTREMO_PCT} %: avisa, no bloquea.` });
  if (agregado.filas > 0 && agregado.base === 0) out.push({ clave: "sin_base", texto: "sin base", tono: "alerta", titulo: "Ninguna fila tiene base de este año: el % se aplicará cuando la haya y no pesa en el promedio." });
  return out;
}

/** «base 17,800 u · hoy 2027: 19,485 u». */
export function textoBaseCelda(a: Pick<AgregadoCrecimientoApi, "base" | "siguiente_vigente">, anioSiguiente: number): string {
  return `base ${unidades(a.base)} u · hoy ${anioSiguiente}: ${unidades(a.siguiente_vigente)} u`;
}

/** «rebote del Niño +9.6 %» o `null` si ninguna fila tiene meses del Niño. */
export function textoRebote(a: Pick<AgregadoCrecimientoApi, "rebote_nino_pct">): { texto: string; titulo: string } | null {
  if (a.rebote_nino_pct === null) return null;
  const v = formatearPct(a.rebote_nino_pct);
  return { texto: `rebote del Niño ${v}`, titulo: `Solo por volver a un año normal, este grupo crecería ${v} bruto. Es referencia: no se aplica.` };
}

/** «sigue al Resto (5 %)» en una celda vacía. */
export const textoSigueResto = (pctResto: number | null): string => `sigue al Resto${pctResto === null ? "" : ` (${formatearDecimal(pctResto, pctResto % 1 === 0 ? 0 : 1)} %)`}`;

/** El desglose de la base del Resto: «JOVENCITOS 8,200 · NIÑOS 6,100». */
export function textoDesgloseResto(porGenero: readonly { genero: string; base: number }[]): string | null {
  const partes = porGenero.filter((g) => g.base > 0).map((g) => `${g.genero} ${unidades(g.base)}`);
  return partes.length === 0 ? null : partes.join(" · ");
}

/** Las tiendas de mismas tiendas del año siguiente: las mismas más las nuevas del año anterior (entran por `B`). */
export function tiendasMismasSiguiente(bloques: BloquesApi, anioSiguiente: number): number {
  const r = resumenBloquesAnio(bloques[anioSiguiente]);
  return r.mismas.length + r.anterior.length;
}

/** La frase de la cabecera de la pestaña. */
export function textoCabeceraCrecimientos(anioEnCurso: number, anioSiguiente: number, tiendas: number): string {
  const n = tiendas > 0 ? ` (${plural(tiendas, "tienda", "tiendas")})` : "";
  return `Crecimiento bruto ${anioSiguiente} frente a ${anioEnCurso} de las mismas tiendas de ${anioSiguiente}${n}. No se corrige por el Niño: si ${anioEnCurso} fue Niño en un mundo, inclúyelo en tu %.`;
}

/** La alerta de «no aplicado» de la cabecera, o `null` si está al día. */
export function textoCrecimientosSinAplicar(r: Pick<RespuestaCrecimientosApi, "al_dia" | "metodo_viejo">): string | null {
  if (r.al_dia) return null;
  return r.metodo_viejo ? "Calculada con el método anterior: recalcula." : "Los crecimientos guardados no están aplicados (falló el recálculo o un nodo cambió de mundo).";
}

/** El aviso de un género de la matriz que no está en el catálogo. */
export const textoGeneroFaltante = (genero: string): string => `No se encontró el género ${genero} en el catálogo: sus filas siguen el Resto.`;

// ─── Resultado de guardar y Modal del choque ───

/**
 * Antes de guardar: cuántas celdas con filas fijadas a mano (con % propio o con el total decidido) cambió el planner. Es un aviso
 * previo y aproximado (la lista exacta la calcula el servidor y llega en el Modal): si hay, al guardar se le preguntará qué hacer con ellas.
 */
export function resumenChoquePrevisto(
  r: Pick<RespuestaCrecimientosApi, "celdas" | "resto">,
  b: Borrador
): { conjuntos: number; con_pct_propio: number; decididas: number } {
  let conjuntos = 0;
  let propias = 0;
  let decididas = 0;
  const sumar = (a: AgregadoCrecimientoApi, texto: string, guardado: number | null) => {
    if (igualPct(texto, guardado)) return;
    if (a.pct_propio.filas === 0 && a.decididas.filas === 0) return;
    conjuntos += 1;
    propias += a.pct_propio.filas;
    decididas += a.decididas.filas;
  };
  for (const c of r.celdas) if (celdaEditable(c)) sumar(c.agregado, (b.celdas[claveCelda(c.genero_id, c.mundo_id)] ?? campoVacio).pct, c.pct);
  sumar(r.resto.agregado, b.resto.pct, r.resto.pct);
  return { conjuntos, con_pct_propio: propias, decididas };
}

/** «Cambiaste 2 celdas con filas fijadas a mano (3 con % propio y 1 decidida): al guardar te preguntaré qué hacer con ellas.» o `null`. */
export function textoChoquePrevisto(c: ReturnType<typeof resumenChoquePrevisto>): string | null {
  if (c.conjuntos === 0) return null;
  const que = [c.con_pct_propio > 0 ? `${plural(c.con_pct_propio, "con % propio", "con % propio")}` : null, c.decididas > 0 ? plural(c.decididas, "decidida", "decididas") : null].filter(Boolean).join(" y ");
  return `Cambiaste ${plural(c.conjuntos, "celda", "celdas")} con filas fijadas a mano (${que}): al guardar se te preguntará qué hacer con ellas (pisar, conservar o cancelar). Nada se pisa sin tu respuesta.`;
}

/** El `400 celdas_incompletas` del servidor en palabras (apareció un grupo nuevo mientras escribías): lista lo que falta. */
export function textoCeldasIncompletas(detalle: Record<string, unknown> | null | undefined): string | null {
  const faltan = detalle?.faltan;
  if (detalle?.codigo !== "celdas_incompletas" || !Array.isArray(faltan)) return null;
  const nombres = faltan.map((f) => (typeof f === "object" && f !== null ? `${(f as { genero?: string }).genero ?? "?"} · ${(f as { mundo?: string }).mundo ?? "?"}` : "?"));
  const lista = nombres.length > 0 ? `: ${listaEnPalabras(nombres)}` : "";
  return `Faltan celdas por llenar${lista}. Actualiza la pantalla para verlas y escribe un % en cada una.`;
}

/** `409 filas_manuales` leído del cuerpo del error, o `null` si no trae la forma esperada. */
export function leerConflicto(detalle: Record<string, unknown> | null | undefined): ConflictoFilasManualesApi | null {
  if (!detalle || detalle.codigo !== "filas_manuales") return null;
  const lista = (x: unknown): x is { total: number; filas: unknown[] } => typeof x === "object" && x !== null && typeof (x as { total?: unknown }).total === "number" && Array.isArray((x as { filas?: unknown }).filas);
  if (typeof detalle.huella_choque !== "string" || !lista(detalle.pct_propio) || !lista(detalle.decididas)) return null;
  return detalle as unknown as ConflictoFilasManualesApi;
}

/** «12 filas tienen un % propio». */
export const tituloSeccionPctPropio = (total: number): string => `${plural(total, "fila tiene", "filas tienen")} un % propio`;

/** «5 filas tienen el total de 2027 decidido: conservan su cifra y mostrarán "propuesta cambió"». */
export const tituloSeccionDecididas = (total: number, anioSiguiente: number): string =>
  `${plural(total, "fila tiene", "filas tienen")} el total de ${anioSiguiente} decidido: conservan su cifra y mostrarán «propuesta cambió»`;

/** «Pisar también estas 5 decisiones (vuelven a la propuesta nueva)». */
export const textoCasillaPisarDecididas = (total: number): string => `Pisar también ${total === 1 ? "esta decisión" : `estas ${formatearNumero(total)} decisiones`} (${total === 1 ? "vuelve" : "vuelven"} a la propuesta nueva)`;

/** «Se muestran 200 de 350» cuando la lista llega recortada; `null` si está completa. */
export function textoListaRecortada(total: number, mostradas: number): string | null {
  return total > mostradas ? `Se muestran ${formatearNumero(mostradas)} de ${formatearNumero(total)}.` : null;
}

export const textoAvisoListaCambio = "La lista cambió mientras decidías: revisa la lista nueva antes de elegir.";

/** Nombre de una fila en choque: «DENIM · BASICO · RECONOCIDO» (línea · equivalencia · agrupación de marca). */
export function nombreFilaChoque(f: { linea: string; equivalencia: string | null; agrupacion_marca: string }): string {
  return [f.linea, f.equivalencia, f.agrupacion_marca].filter(Boolean).join(" · ");
}

/** «5 % → 12 %» (una fila con % propio y el que tendría con el cambio). */
export const textoCambioPct = (de: number, a: number): string => `${formatearDecimal(de, de % 1 === 0 ? 0 : 1)} % → ${formatearDecimal(a, a % 1 === 0 ? 0 : 1)} %`;

/** «10,800 → 11,500» (el total decidido y la propuesta nueva estimada). */
export const textoCambioDecidido = (decidido: number, propuesta: number | null): string => `${unidades(decidido)} → ${propuesta === null ? "—" : unidades(propuesta)}`;

/** Quién fue pisado y con qué valor anterior, en una línea. */
export function textoPisada(p: ResultadoGuardarCrecimientosApi["pisadas"][number], nombre: string): string {
  const partes = [p.pct_anterior !== null ? `tenía ${formatearPct(p.pct_anterior)} propio` : null, p.decidido_anterior !== null ? `tenía decidido ${unidades(p.decidido_anterior)}` : null].filter(Boolean);
  return `${nombre}: ${partes.length > 0 ? partes.join(" y ") : "sin valor anterior"}`;
}

/** El aviso de las filas que se editaron mientras se guardaba. `null` si no hubo. */
export function textoRevertidas(n: number): string | null {
  if (n === 0) return null;
  return `${plural(n, "fila se editó", "filas se editaron")} mientras guardabas: ${n === 1 ? "conserva" : "conservan"} su % o su total; ${n === 1 ? "revísala" : "revísalas"} y recalcula.`;
}

/** El aviso de las celdas guardadas que el guardado borró (su mundo está desactivado). `null` si no se perdió ninguna. */
export function textoDescartadas(celdas: ResultadoGuardarCrecimientosApi["celdas_descartadas"]): string | null {
  if (celdas.length === 0) return null;
  const nombres = listaEnPalabras(celdas.map((c) => `${c.genero} · ${c.mundo} (${formatearDecimal(c.pct, c.pct % 1 === 0 ? 0 : 1)} %)`));
  return `${plural(celdas.length, "celda guardada se quitó", "celdas guardadas se quitaron")} porque su mundo está desactivado: ${nombres}.`;
}

// ─── Por línea: el % bruto efectivo de una fila ───

/** «20 % · HOMBRE · URBANO», «5 % · Resto» o «8 % · esta fila». */
export function textoOrigenCrecimiento(c: CrecimientoEfectivoApi | null | undefined): string | null {
  if (!c) return null;
  const pct = `${formatearDecimal(c.pct, c.pct % 1 === 0 ? 0 : 1)} %`;
  const origen = c.origen === "fila" ? "esta fila" : c.origen === "resto" ? "Resto" : (c.celda ?? "celda");
  return `${pct} · ${origen}`;
}

/** Ayuda del campo «Crec.»: «% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el de la combinación (20 %).» */
export function ayudaCrecimientoFila(c: CrecimientoEfectivoApi | null | undefined, anio: number, anioEnCurso: number): string {
  const base = `% bruto ${anio} ÷ ${anioEnCurso} de esta fila, sin corregir por el Niño.`;
  if (!c) return `${base} Vacío = el de la combinación (o el Resto).`;
  if (c.origen === "fila") return `${base} Vacío = el de la combinación (o el Resto).`;
  const pct = formatearDecimal(c.pct, c.pct % 1 === 0 ? 0 : 1);
  return `${base} Vacío = ${c.origen === "resto" ? "el del Resto" : "el de la combinación"} (${pct} %).`;
}

/** Marcador del campo «Crec.» de una fila de `Y+1`. `null` si la fila no trae el % efectivo (proyección anterior al método 4). */
export function marcadorCrecimiento(r: Pick<AnioFilaApi, "crecimiento_efectivo"> | undefined): string | null {
  return textoOrigenCrecimiento(r?.crecimiento_efectivo);
}

/**
 * El detalle de una fila de `Y+1`: «Crecimiento bruto efectivo +20,0 % (HOMBRE · URBANO) · base 2026 de las mismas tiendas de
 * 2027: 19,424 u». Con meses del Niño añade lo que equivale sobre la base normalizada, y una fila decidida muestra su % bruto.
 */
export function textosDetalleBruto(r: Pick<AnioFilaApi, "crecimiento_efectivo" | "base_siguiente" | "base_normalizada" | "pct_bruto" | "pct_sobre_normalizada" | "decidido">, anio: number, anioEnCurso: number): string[] {
  const out: string[] = [];
  const ce = r.crecimiento_efectivo;
  if (ce) {
    const donde = ce.origen === "fila" ? "% propio de la fila" : ce.origen === "resto" ? "Resto" : (ce.celda ?? "celda");
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
