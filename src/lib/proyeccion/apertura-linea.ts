import { repartirEntero } from "./reparto";
import type { AnioFilaApi, FilaApi, FilaTiendaLineaApi, MarcasDeFilaApi, Participaciones } from "./tipos-api";

/**
 * Apertura editable en el detalle de la línea y marcas representativas (ficha 07b, `0.10.7`). Puro: sin base ni React.
 * El servidor arma con esto `filas_tienda`, `marcas` y la respuesta del `PUT` de una fila de tienda; la pantalla puede
 * reutilizar `repartoPorMarca` y `totalLinea`.
 */

/** Igual que `MAX_NOTA_DECISION` de `esquemas.ts` (no se importa para no arrastrar zod a la pantalla; un test las compara). */
export const MAX_NOTA_AJUSTE = 300;
const TOP_MARCAS = 3;
const EPS = 1e-12;

// ─── Marcas de más peso (reglas 1 y 2 de la ficha 07b, sección 8) ───

type PorMarca = NonNullable<Participaciones["por_marca"]>;

/** `por_marca` sin los elementos sin `marca_id` o sin participación numérica (dato viejo o dañado): se descartan, no lanzan. */
const validas = (lista: Participaciones["por_marca"] | undefined): PorMarca =>
  (lista ?? []).filter((m) => m !== null && typeof m === "object" && typeof m.marca_id === "string" && m.marca_id !== "" && typeof m.participacion === "number" && Number.isFinite(m.participacion));

const porPesoYId = (a: PorMarca[number], b: PorMarca[number]) => b.participacion - a.participacion || a.marca_id.localeCompare(b.marca_id);

/**
 * Ids de marca cuyo nombre hace falta para decidir el top 3: las tres de mayor participación y las empatadas con la tercera (el empate
 * se desempata por nombre). Sirve para pedir los nombres a la base sin leer los de todas las marcas.
 */
export function marcasQueNecesitanNombre(participaciones: Participaciones | null): string[] {
  const lista = validas(participaciones?.por_marca);
  if (lista.length === 0) return [];
  const ordenadas = [...lista].sort(porPesoYId);
  if (ordenadas.length <= TOP_MARCAS) return ordenadas.map((m) => m.marca_id);
  const corte = ordenadas[TOP_MARCAS - 1].participacion;
  return ordenadas.filter((m, i) => i < TOP_MARCAS || Math.abs(m.participacion - corte) <= EPS).map((m) => m.marca_id);
}

/**
 * Regla 1. Las 3 marcas de más peso de `por_marca` (de mayor a menor; empate: por nombre) y el resto en `otras`, de modo que
 * `Σ top + otras = 1`. `null` si la fila no trae `por_marca` (calculada antes de `0.10.1` o sin venta en `W12`). Una marca sin
 * nombre en `nombres` se rotula «Marca sin nombre».
 */
export function marcasDeFila(
  participaciones: Participaciones | null,
  nombres: ReadonlyMap<string, string>
): Pick<MarcasDeFilaApi, "top" | "otras"> | null {
  const lista = validas(participaciones?.por_marca);
  if (lista.length === 0) return null;
  const nombreDe = (id: string) => nombres.get(id) ?? "Marca sin nombre";
  const ordenadas = [...lista].sort((a, b) => b.participacion - a.participacion || nombreDe(a.marca_id).localeCompare(nombreDe(b.marca_id), "es") || a.marca_id.localeCompare(b.marca_id));
  const top = ordenadas.slice(0, TOP_MARCAS).map((m) => ({ marca_id: m.marca_id, marca: nombreDe(m.marca_id), participacion: m.participacion }));
  const resto = ordenadas.slice(TOP_MARCAS);
  const otras = resto.length === 0 ? null : { marcas: resto.length, participacion: resto.reduce((s, m) => s + m.participacion, 0) };
  return { top, otras };
}

/** `MarcasDeFilaApi` de una fila base. Sin composición: `top` vacío y `otras = null` (la pantalla dice «sin datos de marca»). */
export function marcasDeFilaApi(
  fila: Pick<FilaApi, "id" | "equivalencia_id" | "agrupacion_marca_id">,
  participaciones: Participaciones | null,
  nombres: ReadonlyMap<string, string>,
  tiendasMismas: number
): MarcasDeFilaApi {
  const periodo = participaciones?.periodo_referencia ?? null;
  const m = marcasDeFila(participaciones, nombres);
  return {
    fila_id: fila.id,
    equivalencia_id: fila.equivalencia_id,
    agrupacion_marca_id: fila.agrupacion_marca_id,
    periodo: periodo ? { desde: periodo.desde, hasta: periodo.hasta, tiendas: tiendasMismas } : null,
    top: m?.top ?? [],
    otras: m?.otras ?? null,
  };
}

/**
 * Regla 2. Reparte `vigente` (la cifra de una fila de apertura) con la composición de la fila base: enteros que suman `vigente`
 * (`top` en el mismo orden y `otras` al final). Con `vigente = 0` todo es 0. `null` si no hay composición. Solo dato: no se guarda.
 */
export function repartoPorMarca(
  vigente: number,
  composicion: Pick<MarcasDeFilaApi, "top" | "otras"> | null
): { top: number[]; otras: number } | null {
  if (!composicion || composicion.top.length === 0) return null;
  const pesos = [...composicion.top.map((m) => m.participacion), composicion.otras?.participacion ?? 0];
  const reparto = repartirEntero(vigente, pesos) ?? pesos.map(() => 0);
  return { top: reparto.slice(0, composicion.top.length), otras: reparto[composicion.top.length] ?? 0 };
}

// ─── Filas de tienda de la línea (regla 3) ───

export type OpcionesFilasTienda = {
  codigoDe: (tiendaId: string) => string;
  composicionSDe: (filaId: string) => number | null;
  /** Lugar del GML en la línea (como las filas base); sin él, todos empatan. */
  lugarGml?: ReadonlyMap<string, number>;
  /** `orden` de la agrupación de marca en el catálogo (PREMIUM → ULTRA LOW). */
  ordenMarca: (agrupacionMarcaId: string) => number;
};

const esNueva = (a: AnioFilaApi) => a.bloque === "nuevas";

/**
 * Regla 3. De todas las filas de la línea deja solo las de tienda, activas y con algún año en el bloque `nuevas` (aperturas y nuevas del
 * año anterior); `anios` trae solo esos años. Orden: primer año en que es nueva, código de tienda, lugar del GML, equivalencia y orden de
 * la agrupación de marca. Las filas base nunca entran aquí.
 */
export function filasTiendaDeLinea(filas: readonly FilaApi[], o: OpcionesFilasTienda): FilaTiendaLineaApi[] {
  const salida: FilaTiendaLineaApi[] = [];
  for (const f of filas) {
    if (f.tienda_id === null || !f.activo) continue;
    const anios = f.anios.filter(esNueva);
    if (anios.length === 0) continue;
    salida.push({ ...f, anios, tienda_codigo: o.codigoDe(f.tienda_id), composicion_s: o.composicionSDe(f.id) });
  }
  const primerAnio = (f: FilaTiendaLineaApi) => Math.min(...f.anios.map((a) => a.anio));
  return salida.sort(
    (x, y) =>
      primerAnio(x) - primerAnio(y) ||
      x.tienda_codigo.localeCompare(y.tienda_codigo, "es", { numeric: true }) ||
      (o.lugarGml?.get(x.gml_id) ?? 0) - (o.lugarGml?.get(y.gml_id) ?? 0) ||
      (x.equivalencia_id ?? "").localeCompare(y.equivalencia_id ?? "") ||
      o.ordenMarca(x.agrupacion_marca_id) - o.ordenMarca(y.agrupacion_marca_id) ||
      x.id.localeCompare(y.id)
  );
}

// ─── Total de la línea (regla 4) ───

/**
 * Regla 4. `Σ vigente` de las filas base activas del año + `Σ vigente` de las filas de tienda (bloque `nuevas`) del año. Es la cifra de la
 * barra anual (`construirBarras`) y de la Matriz (mismas + nuevas del año anterior + aperturas).
 */
export function totalLinea(anio: number, filasBase: readonly Pick<FilaApi, "tienda_id" | "activo" | "anios">[], filasTienda: readonly Pick<FilaTiendaLineaApi, "anios">[]): number {
  let total = 0;
  for (const f of filasBase) {
    if (f.tienda_id !== null || !f.activo) continue;
    total += f.anios.find((a) => a.anio === anio)?.vigente ?? 0;
  }
  for (const f of filasTienda) total += f.anios.find((a) => a.anio === anio && a.bloque === "nuevas")?.vigente ?? 0;
  return total;
}

// ─── Resumen de las filas de una tienda (GET /tiendas) ───

export type FilaDeTiendaLigera = {
  tienda_id: string | null;
  proyeccion_fila_anios: { anio: number; bloque: string; propuesto: number | null; decidido: number | null; origen: string | null; activo: boolean }[];
};

/** Clave `tienda_id#anio` de los mapas de tienda. */
export const claveTiendaAnio = (tiendaId: string, anio: number) => `${tiendaId}#${anio}`;

/**
 * `suma_filas` (Σ `vigente` de las filas de la tienda en el año; `null` si no tiene ninguna) y `filas_fijadas` (las fijadas a mano: `origen =
 * manual` con cifra), por tienda y año. Solo cuenta registros activos de un bloque distinto de `mismas`.
 */
export function resumenFilasDeTienda(filas: readonly FilaDeTiendaLigera[]): Map<string, { suma_filas: number | null; filas_fijadas: number }> {
  const salida = new Map<string, { suma_filas: number | null; filas_fijadas: number }>();
  for (const f of filas) {
    if (f.tienda_id === null) continue;
    for (const a of f.proyeccion_fila_anios) {
      if (!a.activo || a.bloque === "mismas") continue;
      const clave = claveTiendaAnio(f.tienda_id, a.anio);
      const previo = salida.get(clave) ?? { suma_filas: null, filas_fijadas: 0 };
      previo.suma_filas = (previo.suma_filas ?? 0) + (a.decidido ?? a.propuesto ?? 0);
      if (a.origen === "manual" && a.decidido !== null) previo.filas_fijadas += 1;
      salida.set(clave, previo);
    }
  }
  return salida;
}

// ─── Mover el total de la tienda (decisión de Javier: «solo se mueve lo modificado») ───

/**
 * Al fijar una fila de tienda con el total de la tienda ya decidido `D`, el total pasa a `D + Δ` con `Δ = vigente nuevo − vigente anterior` de la
 * fila: las demás filas no se mueven. Nunca queda por debajo de lo fijado a mano (`sumaFijadas`, con la fila nueva): así `Σ fijadas ≤ D'`
 * aunque la tienda arrastrara un `D` menor que sus fijadas.
 */
export function totalTiendaTrasMover(args: { decidido: number; vigenteAnterior: number | null; vigenteNuevo: number; sumaFijadas: number }): number {
  const delta = args.vigenteNuevo - (args.vigenteAnterior ?? 0);
  return Math.max(0, Math.round(Math.max(args.decidido + delta, args.sumaFijadas)));
}

const SUFIJO_AJUSTE = "ajustado desde la línea";

/** Nota del total movido: la nota que ya tenía + «ajustado desde la línea G · M · L» (sin repetirla y sin pasar del tope de una nota). */
export function notaMoverTotal(notaActual: string | null, linea: string): string {
  const agregado = `${SUFIJO_AJUSTE} ${linea}`;
  const base = (notaActual ?? "").trim();
  if (base.includes(SUFIJO_AJUSTE)) {
    // Ya dice de dónde viene: se cambia la línea citada, no se acumulan frases.
    const antes = base.slice(0, base.indexOf(SUFIJO_AJUSTE)).replace(/[\s·.;,-]+$/, "");
    return recortar(antes === "" ? agregado : `${antes} · ${agregado}`);
  }
  return recortar(base === "" ? agregado : `${base} · ${agregado}`);
}

function recortar(texto: string): string {
  return texto.length <= MAX_NOTA_AJUSTE ? texto : `${texto.slice(0, MAX_NOTA_AJUSTE - 1).trimEnd()}…`;
}
