import { formatearDecimal } from "@/lib/formato";
import { renormalizarResto as renormalizarValores, requiereNota } from "@/lib/marcas-barrer/reparto";
import { repartirProporcional } from "@/lib/marcas-barrer/resto";
import { MAX_NOTA_REPARTO, TOLERANCIA_SUMA, VENTANA_DEFECTO, type AlcanceCuerpo, type AnalisisMarcaApi, type FilaRepartoApi, type FilaRestoApi, type FuenteReparto, type Temporada } from "@/lib/marcas-barrer/tipos-api";

export type { FuenteReparto };

/**
 * Lógica pura del bloque 1 de M12 (ficha 12, regla 10 y «Reglas de la pantalla»): qué filas se pueden ajustar, cómo se
 * edita y se renormaliza un reparto, cuándo se puede aprobar y cómo se arma el cuerpo del `POST …/repartos` (las filas
 * de resto llegan EXPANDIDAS por GML, ficha 12 sección 7). Sin React ni I/O: todo se prueba en `tests/marcas-barrer.*`.
 *
 * Unidades: los porcentajes de la pantalla van de 0 a 100 con UN decimal; el cuerpo de la API lleva fracciones de 0 a 1
 * con cuatro decimales (`numeric(7,4)`). Un vector (una temporada, o el anual) suma 100,0 con una tolerancia de 0,05 pp
 * (`TOLERANCIA_SUMA = 0.0005` de la ficha).
 */

export type ClaveTemporada = "verano" | "invierno" | "anual";

/** Tolerancia de la suma de un vector, en puntos porcentuales (ficha 12: 0,0005 en fracción). */
export const TOLERANCIA_SUMA_PP = TOLERANCIA_SUMA * 100;
/** Ventana por defecto: salirse de ella exige nota (criterio 06b). */
export const VENTANA_POR_DEFECTO: number = VENTANA_DEFECTO;
export const MAX_NOTA = MAX_NOTA_REPARTO;

export const claveTemporada = (t: Temporada | null | undefined): ClaveTemporada => t ?? "anual";
export const temporadaDeClave = (c: ClaveTemporada): Temporada | null => (c === "anual" ? null : c);
export const ETIQUETA_CLAVE_TEMPORADA: Record<ClaveTemporada, string> = { verano: "Verano", invierno: "Invierno", anual: "Anual" };
const ORDEN_TEMPORADA: ClaveTemporada[] = ["verano", "invierno", "anual"];

/** Identidad de una fila de GML (el grano del reparto: nodo, y equivalencia solo en los nodos GMLE). */
export const claveGml = (f: Pick<FilaRepartoApi, "clave">) => f.clave;
export const claveResto = (grupo: string) => `resto:${grupo}`;

export const redondear1 = (x: number) => Math.round(x * 10) / 10;

export type FilaAjustable = {
  clave: string;
  tipo: "gml" | "resto";
  etiqueta: string;
  nivel: "GML" | "GMLE" | null;
  unidades: number;
  /** Porcentaje calculado con la fuente elegida, por temporada (0..100). */
  calculado: Partial<Record<ClaveTemporada, number>>;
  /** Los dos candidatos tal como los calcula el sistema (0..100), para mostrarlos lado a lado. */
  historico: Partial<Record<ClaveTemporada, number>>;
  cerrada: Partial<Record<ClaveTemporada, number | null>>;
  /** Solo en un resto: los GML pequeños que lo forman. */
  miembros: FilaRepartoApi[];
  /** El gml de la fila (una fila de GML) para buscarla en `analisis.filas`. */
  fila: FilaRepartoApi | null;
  resto: FilaRestoApi | null;
};

type P2 = FilaRepartoApi["p2"];

function mapaP2(p2: P2, valor: (x: P2[number]) => number | null): Partial<Record<ClaveTemporada, number | null>> {
  const r: Partial<Record<ClaveTemporada, number | null>> = {};
  for (const x of p2) r[claveTemporada(x.temporada)] = valor(x);
  return r;
}

const aPorcentaje = (m: Partial<Record<ClaveTemporada, number | null>>): Partial<Record<ClaveTemporada, number>> => {
  const r: Partial<Record<ClaveTemporada, number>> = {};
  for (const [k, v] of Object.entries(m)) r[k as ClaveTemporada] = (v ?? 0) * 100;
  return r;
};

/** ¿La fila de GML forma parte del vector? En alcance, no específica, con venta al barrer y no agrupada en un resto. */
export function entraEnReparto(f: FilaRepartoApi): boolean {
  return f.en_alcance && !f.es_especifico && !f.pequena && f.grupo_resto === null && f.unidades_ventana > 0;
}

/** Las temporadas (o el vector anual) que tiene el análisis, en el orden verano, invierno, anual. */
export function temporadasDe(analisis: Pick<AnalisisMarcaApi, "filas" | "restos">): ClaveTemporada[] {
  const set = new Set<ClaveTemporada>();
  for (const f of analisis.filas) for (const x of f.p2) set.add(claveTemporada(x.temporada));
  for (const r of analisis.restos) for (const x of r.p2) set.add(claveTemporada(x.temporada));
  return ORDEN_TEMPORADA.filter((t) => set.has(t));
}

/**
 * Las filas editables del bloque 1 con la fuente elegida: una por GML con venta al barrer dentro del alcance y una por
 * cada «Resto de GÉNERO · MUNDO» (los GML pequeños no se editan solos). Las que la API entrega ya van en orden de
 * unidades; los restos van al final.
 */
export function filasAjustables(analisis: Pick<AnalisisMarcaApi, "filas" | "restos">, fuente: FuenteReparto): FilaAjustable[] {
  const calc = (hist: Partial<Record<ClaveTemporada, number | null>>, cerr: Partial<Record<ClaveTemporada, number | null>>) => aPorcentaje(fuente === "cerrada" ? cerr : hist);
  const gml: FilaAjustable[] = analisis.filas.filter(entraEnReparto).map((f) => {
    const hist = mapaP2(f.p2, (x) => x.historico);
    const cerr = mapaP2(f.p2, (x) => x.cerrada);
    return {
      clave: claveGml(f),
      tipo: "gml",
      etiqueta: f.ruta,
      nivel: f.nivel,
      unidades: f.unidades_ventana,
      calculado: calc(hist, cerr),
      historico: aPorcentaje(hist),
      cerrada: Object.fromEntries(Object.entries(cerr).map(([k, v]) => [k, v === null ? null : (v as number) * 100])),
      miembros: [],
      fila: f,
      resto: null,
    };
  });
  const restos: FilaAjustable[] = analisis.restos.map((r) => {
    const hist = mapaP2(r.p2, (x) => x.historico);
    const cerr = mapaP2(r.p2, (x) => x.cerrada);
    return {
      clave: claveResto(r.grupo_resto),
      tipo: "resto",
      etiqueta: r.etiqueta,
      nivel: null,
      unidades: r.unidades_ventana,
      calculado: calc(hist, cerr),
      historico: aPorcentaje(hist),
      cerrada: Object.fromEntries(Object.entries(cerr).map(([k, v]) => [k, v === null ? null : (v as number) * 100])),
      miembros: analisis.filas.filter((f) => f.grupo_resto === r.grupo_resto),
      fila: null,
      resto: r,
    };
  });
  return [...gml, ...restos];
}

// ─── Edición ───

/** `editadas`: lo que el planner escribió a mano. `escaladas`: lo que dejó «Renormalizar el resto» en las demás filas. */
export type EstadoAjuste = {
  editadas: Partial<Record<ClaveTemporada, Record<string, number>>>;
  escaladas: Partial<Record<ClaveTemporada, Record<string, number>>>;
};

export const SIN_AJUSTES: EstadoAjuste = { editadas: {}, escaladas: {} };

/** El valor que cuenta de una celda: lo escrito, si no lo escalado, si no lo calculado (0..100). */
export function valorEfectivo(f: FilaAjustable, t: ClaveTemporada, e: EstadoAjuste): number {
  return e.editadas[t]?.[f.clave] ?? e.escaladas[t]?.[f.clave] ?? f.calculado[t] ?? 0;
}

export const estaEditada = (f: FilaAjustable, t: ClaveTemporada, e: EstadoAjuste) => e.editadas[t]?.[f.clave] !== undefined;

/** Lo que el planner escribió se acota a 0..100 con un decimal; vacío o no numérico → `null`. */
export function leerPorcentaje(texto: string): number | null {
  const limpio = texto.trim().replace("%", "").replace(",", ".");
  if (limpio === "") return null;
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return redondear1(Math.min(100, Math.max(0, n)));
}

/** ¿Se puede escribir en esta celda? Solo si el cálculo le da algo de peso en esa temporada. */
export const sePuedeAjustar = (f: FilaAjustable, t: ClaveTemporada): boolean => (f.calculado[t] ?? 0) > 0;

/**
 * Escribe (o deshace, con `null` o con el mismo valor que ya muestra el cálculo) la edición de una celda. Cualquier edición
 * invalida lo escalado de esa temporada: la suma deja de ser 100 hasta volver a renormalizar.
 */
export function editarCelda(e: EstadoAjuste, f: FilaAjustable, t: ClaveTemporada, valor: number | null): EstadoAjuste {
  // Una fila sin reparto calculado en esta temporada no se puede ajustar: el servidor solo reparte entre las filas con p2 > 0
  // («Agregar GML» es de la segunda entrega) y ese valor se perdería.
  if (!sePuedeAjustar(f, t)) return e;
  const editadas = { ...e.editadas, [t]: { ...(e.editadas[t] ?? {}) } };
  const mismoQueElCalculo = valor !== null && Math.abs(valor - redondear1(f.calculado[t] ?? 0)) < 1e-9;
  if (valor === null || mismoQueElCalculo) delete editadas[t]?.[f.clave];
  else (editadas[t] as Record<string, number>)[f.clave] = valor;
  const escaladas = { ...e.escaladas };
  delete escaladas[t];
  return { editadas, escaladas };
}

/** Suma de un vector (0..100). */
export function sumaVector(filas: readonly FilaAjustable[], t: ClaveTemporada, e: EstadoAjuste): number {
  return filas.reduce((s, f) => s + valorEfectivo(f, t, e), 0);
}

export type ResultadoRenormalizar = { estado: EstadoAjuste; ok: true } | { estado: EstadoAjuste; ok: false; motivo: string };

/**
 * «Renormalizar el resto»: las filas que el planner NO escribió se escalan en proporción a su valor calculado para que el
 * vector sume 100,0 (décimas exactas por mayor resto: la cuenta es `renormalizarResto` de `src/lib/marcas-barrer/reparto.ts`,
 * la misma que valida el servidor). Ejemplo de la ficha: `[41, 30, 17, 12]` con la primera en 50 → `[50, 25.4, 14.4, 10.2]`. Sin
 * filas por escalar, con lo escrito pasado de 100 o sin base proporcional no hay nada que hacer y se explica por qué: una fila
 * sin reparto calculado no recibe peso si no lo escribe el planner.
 */
export function renormalizarResto(filas: readonly FilaAjustable[], t: ClaveTemporada, e: EstadoAjuste): ResultadoRenormalizar {
  const editadas = e.editadas[t] ?? {};
  const esEditada = filas.map((f) => editadas[f.clave] !== undefined);
  const hayBase = filas.some((f, i) => !esEditada[i] && (f.calculado[t] ?? 0) > 0);
  const sumaEditadas = filas.reduce((s, f, i) => s + (esEditada[i] ? (editadas[f.clave] as number) : 0), 0);
  if (!hayBase) return { estado: e, ok: false, motivo: "No hay otras filas con reparto calculado que escalar: corrige las cifras a mano." };
  if (sumaEditadas > 100 + 1e-9) return { estado: e, ok: false, motivo: "Lo escrito a mano ya pasa de 100 %: baja alguna cifra." };
  const valores = filas.map((f, i) => (esEditada[i] ? (editadas[f.clave] as number) : (f.calculado[t] ?? 0)));
  const nuevos = renormalizarValores(valores, esEditada);
  const escaladas: Record<string, number> = {};
  filas.forEach((f, i) => {
    if (!esEditada[i]) escaladas[f.clave] = nuevos[i];
  });
  return { ok: true, estado: { editadas: e.editadas, escaladas: { ...e.escaladas, [t]: escaladas } } };
}

/** ¿Hay alguna celda distinta de lo calculado (por escrito o por renormalizar)? */
export function hayAjustes(filas: readonly FilaAjustable[], temporadas: readonly ClaveTemporada[], e: EstadoAjuste): boolean {
  return filas.some((f) => temporadas.some((t) => Math.abs(valorEfectivo(f, t, e) - (f.calculado[t] ?? 0)) > 0.005));
}

/** ¿El planner ha tocado algo (aunque todavía no difiera)? Sirve para avisar antes de descartar con un cambio de parámetros. */
export function hayEdiciones(e: EstadoAjuste): boolean {
  return Object.values(e.editadas).some((m) => m && Object.keys(m).length > 0) || Object.values(e.escaladas).some((m) => m && Object.keys(m).length > 0);
}

// ─── Aprobación ───

export type ParametrosAprobacion = { ventana_meses: number; alcance: { generos: readonly string[]; mundos: readonly string[]; lineas: readonly string[] }; fuente: FuenteReparto };

export type EstadoAprobacion = {
  /** Suma de cada vector (0..100). */
  sumas: Partial<Record<ClaveTemporada, number>>;
  /** Vectores cuya suma no es 100,0 ± 0,05. */
  sumaInvalida: ClaveTemporada[];
  /** La nota es obligatoria (criterio 06b) y por qué. */
  notaRequerida: boolean;
  razonesNota: string[];
  /** Por qué no se puede aprobar todavía (vacío = se puede). */
  bloqueos: string[];
};

export const TEXTO_RAZON_NOTA = {
  ajuste: "ajustaste algún porcentaje",
  ventana: "la ventana no es la de 24 meses",
  fuente: "la fuente es la cerrada",
  alcance: "el reparto tiene alcance",
} as const;

/**
 * Cuándo se puede aprobar: cada vector suma 100,0 ± 0,05, hay al menos una fila con más de 0 y, si hay ajuste, ventana
 * distinta de la de defecto, fuente `cerrada` o alcance, la nota (≤ 300) no está vacía. El servidor repite las tres
 * comprobaciones (`409 suma_invalida`, `409 nota_requerida`).
 */
export function estadoAprobacion(filas: readonly FilaAjustable[], temporadas: readonly ClaveTemporada[], e: EstadoAjuste, p: ParametrosAprobacion, nota: string): EstadoAprobacion {
  const sumas: Partial<Record<ClaveTemporada, number>> = {};
  const sumaInvalida: ClaveTemporada[] = [];
  for (const t of temporadas) {
    const s = sumaVector(filas, t, e);
    sumas[t] = s;
    if (Math.abs(s - 100) > TOLERANCIA_SUMA_PP) sumaInvalida.push(t);
  }
  const razonesNota: string[] = [];
  if (hayAjustes(filas, temporadas, e)) razonesNota.push(TEXTO_RAZON_NOTA.ajuste);
  if (p.ventana_meses !== VENTANA_POR_DEFECTO) razonesNota.push(TEXTO_RAZON_NOTA.ventana);
  if (p.fuente === "cerrada") razonesNota.push(TEXTO_RAZON_NOTA.fuente);
  if (p.alcance.generos.length + p.alcance.mundos.length + p.alcance.lineas.length > 0) razonesNota.push(TEXTO_RAZON_NOTA.alcance);
  // La regla de la nota es la del servidor (`requiereNota`); las razones solo la explican en palabras.
  const notaRequerida = requiereNota({ hay_ajuste: hayAjustes(filas, temporadas, e), ventana_meses: p.ventana_meses, fuente: p.fuente, alcance_vacio: p.alcance.generos.length + p.alcance.mundos.length + p.alcance.lineas.length === 0 });
  const bloqueos: string[] = [];
  if (filas.length === 0 || temporadas.length === 0) bloqueos.push("No hay reparto que aprobar: la marca no tiene venta al barrer en la ventana.");
  for (const t of sumaInvalida) bloqueos.push(`${ETIQUETA_CLAVE_TEMPORADA[t]} suma ${formatearDecimal(sumas[t] ?? 0, 1)} %: usa «Renormalizar el resto» o corrige a mano hasta 100.0.`);
  if (temporadas.some((t) => !filas.some((f) => valorEfectivo(f, t, e) > 0))) bloqueos.push("Cada vector necesita al menos una fila con más de 0 %.");
  const largo = nota.trim().length;
  if (notaRequerida && largo === 0) bloqueos.push(`Escribe una nota: ${razonesNota.join(", ")}.`);
  if (largo > MAX_NOTA) bloqueos.push(`La nota pasa de ${MAX_NOTA} caracteres.`);
  return { sumas, sumaInvalida, notaRequerida, razonesNota, bloqueos };
}

// ─── Cuerpo del POST (filas expandidas por GML) ───

export type FilaCuerpo = { genero_mundo_linea_id: string; equivalencia_id: string | null; temporada: Temporada | null; participacion_ajustada: number | null };

const aFraccion = (diezmilesimas: number) => diezmilesimas / 10000;

/**
 * Reparte el valor de una fila de resto entre sus miembros en proporción a su peso en esa temporada (la parte normalizada
 * por el Niño, que es la de `p2.historico`; si todas valen 0, por unidades). Devuelve fracciones con cuatro decimales cuya
 * suma es exactamente el valor del resto (`repartirProporcional` de `src/lib/marcas-barrer/resto.ts`, la misma de `expandirResto`).
 *
 * Por qué no usa `expandirResto` directamente: `expandirResto` recibe UN peso por miembro (la suma de sus unidades normalizadas
 * en toda la ventana, que es lo que usa el servidor al calcular el reparto), mientras que aquí el valor editado es de UNA
 * temporada y los pesos salen de la parte normalizada de esa temporada (`p2.historico`). Solo el algoritmo de reparto
 * (`repartirProporcional`) es común; los pesos difieren a propósito y no deben unificarse sin revisar con `backend`.
 */
export function expandirRestoPantalla(valorPct: number, miembros: readonly FilaRepartoApi[], t: ClaveTemporada): { fila: FilaRepartoApi; fraccion: number }[] {
  const pesos = miembros.map((m) => m.p2.find((x) => claveTemporada(x.temporada) === t)?.historico ?? 0);
  const usar = pesos.some((p) => p > 0) ? pesos : miembros.map((m) => m.unidades_ventana);
  const partes = repartirProporcional(valorPct / 100, usar, 4);
  return miembros.map((fila, i) => ({ fila, fraccion: partes[i] }));
}

/**
 * Las filas del `POST`: una por GML y temporada. `participacion_ajustada` es `null` mientras el valor que cuenta sea el
 * calculado (el servidor lo calcula con la misma fuente); si cambió, va el valor, y una fila de resto editada se expande
 * entre sus miembros.
 */
export function filasParaAprobar(filas: readonly FilaAjustable[], temporadas: readonly ClaveTemporada[], e: EstadoAjuste): FilaCuerpo[] {
  const salida: FilaCuerpo[] = [];
  for (const t of temporadas) {
    for (const f of filas) {
      const efectivo = valorEfectivo(f, t, e);
      const cambio = Math.abs(efectivo - (f.calculado[t] ?? 0)) > 0.005;
      if (f.tipo === "gml" && f.fila) {
        salida.push({
          genero_mundo_linea_id: f.fila.gml_id,
          equivalencia_id: f.fila.equivalencia_id,
          temporada: temporadaDeClave(t),
          participacion_ajustada: cambio ? aFraccion(Math.round(efectivo * 100)) : null,
        });
      } else if (f.tipo === "resto") {
        const partes = cambio ? expandirRestoPantalla(efectivo, f.miembros, t) : f.miembros.map((fila) => ({ fila, fraccion: null as number | null }));
        for (const { fila, fraccion } of partes) {
          salida.push({ genero_mundo_linea_id: fila.gml_id, equivalencia_id: fila.equivalencia_id, temporada: temporadaDeClave(t), participacion_ajustada: fraccion });
        }
      }
    }
  }
  return salida;
}

// ─── Comparar el reparto vigente con lo calculado hoy ───

export type DiferenciaVigente = { clave: string; etiqueta: string; temporada: ClaveTemporada; vigente: number; hoy: number; difPp: number };

/**
 * Compara, fila a fila, el reparto vigente con lo que se calcularía hoy (con la misma fuente que se aprobó) en puntos
 * porcentuales. Ordenado por la diferencia absoluta; `maximoPp` es el número que usa la ficha para decir «al día (difiere
 * 1,2 pp)». Una fila sin valor vigente no entra (no estaba en esa versión).
 */
export function compararConVigente(analisis: Pick<AnalisisMarcaApi, "filas" | "restos" | "vigente">): { filas: DiferenciaVigente[]; maximoPp: number } {
  const fuente: FuenteReparto = analisis.vigente?.fuente === "cerrada" ? "cerrada" : "historico";
  const filas: DiferenciaVigente[] = [];
  const agregar = (clave: string, etiqueta: string, p2: P2 | FilaRestoApi["p2"]) => {
    for (const x of p2) {
      if (x.vigente === null || x.vigente === undefined) continue;
      const hoy = ((fuente === "cerrada" ? x.cerrada : x.historico) ?? 0) * 100;
      const vigente = x.vigente * 100;
      filas.push({ clave, etiqueta, temporada: claveTemporada(x.temporada), vigente, hoy, difPp: hoy - vigente });
    }
  };
  for (const f of analisis.filas.filter(entraEnReparto)) agregar(claveGml(f), f.ruta, f.p2);
  for (const r of analisis.restos) agregar(claveResto(r.grupo_resto), r.etiqueta, r.p2);
  filas.sort((a, b) => Math.abs(b.difPp) - Math.abs(a.difPp));
  return { filas, maximoPp: filas.length > 0 ? Math.abs(filas[0].difPp) : 0 };
}

// ─── Alcance del cuerpo ───

/** Solo las claves con algo: el cuerpo del `POST` no manda listas vacías. */
export function alcanceParaCuerpo(a: AnalisisMarcaApi["parametros"]["alcance"]): AlcanceCuerpo {
  return {
    ...(a.generos.length > 0 ? { generos: a.generos } : {}),
    ...(a.mundos.length > 0 ? { mundos: a.mundos } : {}),
    ...(a.lineas.length > 0 ? { lineas: a.lineas } : {}),
  };
}
