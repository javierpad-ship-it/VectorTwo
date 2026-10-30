/**
 * Alias de marcas, tiendas y términos privados y control final de salida (ficha 07e, §3.5; decisión 3 de Javier; R11 y ejemplo J). Puro.
 *
 * Los términos prohibidos se arman en tiempo de ejecución (marcas, tiendas y `terminos_extra`) y nunca se escriben en el repo. Cada
 * coincidencia, por palabra o secuencia de palabras completas, se reemplaza por un alias neutro (`MARCA_A`, `TIENDA_A`, `TERMINO_A`) estable
 * dentro de la corrida. El diccionario guarda alias → tipo e id, nunca el nombre. Antes de enviar, `controlFinal` recorre el JSON entero.
 */

export type TipoTermino = "marca" | "tienda" | "termino";
export type TerminoPrivado = { texto: string; tipo: TipoTermino; id: string | null };
export type EntradaDiccionarioAlias = { tipo: TipoTermino; id: string | null };
export type HallazgoPrivacidad = "termino" | "uuid" | "anio" | "clave";

const PREFIJO: Record<TipoTermino, string> = { marca: "MARCA", tienda: "TIENDA", termino: "TERMINO" };
const PRIORIDAD: Record<TipoTermino, number> = { marca: 0, tienda: 1, termino: 2 };
const FORMATO = /[\p{Cf}]/gu;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const PALABRA = /[\p{L}\p{N}]+/gu;
/** Los alias que produce este módulo (para quitarlos antes de buscar términos y para restituirlos). */
const PATRON_ALIAS = /\b(?:MARCA|TIENDA|TERMINO)_[A-Z]+\b/giu;
const REGEX_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const REGEX_ANIO = /\b(?:19|20)\d{2}\b/u;

/** Mayúsculas, sin tildes ni compatibilidad Unicode, sin caracteres de formato (ancho cero, LRM, RLM) y con espacios colapsados. */
export function normalizarParaComparar(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(FORMATO, "")
    .replace(CONTROL, " ")
    .toUpperCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/** Quita caracteres de formato y de control (sin tocar mayúsculas ni tildes) y colapsa espacios: el texto que viaja. */
export function limpiarTexto(texto: string): string {
  return texto.replace(FORMATO, "").replace(CONTROL, " ").replace(/\s+/gu, " ").trim();
}

const palabrasNormalizadas = (texto: string): string[] => (normalizarParaComparar(texto).match(PALABRA) ?? []);

type TerminoCompilado = { palabras: string[]; tipo: TipoTermino; id: string | null; clave: string };

/** Etiqueta `A`, `B` … `Z`, `AA` … de una posición. */
function letras(n: number): string {
  let s = "";
  let i = n;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

function compilar(terminos: readonly TerminoPrivado[]): TerminoCompilado[] {
  const vistos = new Map<string, TerminoCompilado>();
  const ordenados = [...terminos].sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]);
  for (const t of ordenados) {
    const palabras = palabrasNormalizadas(t.texto);
    // Solo se ignoran los términos de un carácter: por palabra completa, uno de dos letras no toca otras palabras.
    if (palabras.join("").length < 2) continue;
    const clave = palabras.join(" ");
    if (!vistos.has(clave)) vistos.set(clave, { palabras, tipo: t.tipo, id: t.id, clave });
  }
  return [...vistos.values()];
}

type Coincidencia = { desde: number; hasta: number; termino: TerminoCompilado };

/** Coincidencias de izquierda a derecha, la más larga primero. `texto` ya está limpio de formato. */
function buscar(texto: string, terminos: readonly TerminoCompilado[]): Coincidencia[] {
  const tokens = [...texto.matchAll(PALABRA)].map((m) => ({ norm: palabrasNormalizadas(m[0]).join(""), desde: m.index ?? 0, hasta: (m.index ?? 0) + m[0].length }));
  const porPrimera = new Map<string, TerminoCompilado[]>();
  for (const t of terminos) {
    const lista = porPrimera.get(t.palabras[0]) ?? [];
    lista.push(t);
    porPrimera.set(t.palabras[0], lista);
  }
  for (const lista of porPrimera.values()) lista.sort((a, b) => b.palabras.length - a.palabras.length);
  const salida: Coincidencia[] = [];
  let i = 0;
  while (i < tokens.length) {
    const candidatos = porPrimera.get(tokens[i].norm) ?? [];
    const hallado = candidatos.find((t) => t.palabras.every((p, j) => tokens[i + j]?.norm === p));
    if (hallado) {
      salida.push({ desde: tokens[i].desde, hasta: tokens[i + hallado.palabras.length - 1].hasta, termino: hallado });
      i += hallado.palabras.length;
    } else i += 1;
  }
  return salida;
}

export type Aliasador = {
  /** Reemplaza cada término por su alias y lo anota en `usados` (alias → tipo e id). */
  aplicar(texto: string, usados?: Record<string, EntradaDiccionarioAlias>): string;
  /** Pone el nombre real donde la respuesta cite un alias de esta corrida. Un alias desconocido queda tal cual. */
  restituir(texto: string): string;
  /** ¿Queda algún término prohibido en el texto? (los alias propios no cuentan). */
  contiene(texto: string): boolean;
};

/**
 * Alias estables: se asignan por orden alfabético de los términos de cada tipo, así que no dependen del orden de aparición ni de qué
 * GM se procese primero. Un término repetido entre tipos se alias como el de mayor prioridad (marca, tienda, extra).
 */
export function crearAliasador(terminos: readonly TerminoPrivado[]): Aliasador {
  const compilados = compilar(terminos);
  const porAlias = new Map<string, { nombre: string; tipo: TipoTermino; id: string | null }>();
  const aliasDe = new Map<string, string>();
  const contador: Record<TipoTermino, number> = { marca: 0, tienda: 0, termino: 0 };
  const nombreReal = new Map<string, string>();
  for (const t of terminos) {
    const clave = palabrasNormalizadas(t.texto).join(" ");
    if (!nombreReal.has(clave)) nombreReal.set(clave, limpiarTexto(t.texto));
  }
  for (const t of [...compilados].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))) {
    const alias = `${PREFIJO[t.tipo]}_${letras(contador[t.tipo]++)}`;
    aliasDe.set(t.clave, alias);
    porAlias.set(alias, { nombre: nombreReal.get(t.clave) ?? t.clave, tipo: t.tipo, id: t.id });
  }

  return {
    aplicar(texto, usados) {
      const limpio = limpiarTexto(texto);
      const coincidencias = buscar(limpio, compilados);
      let salida = "";
      let cursor = 0;
      for (const c of coincidencias) {
        const alias = aliasDe.get(c.termino.clave);
        if (alias === undefined) continue;
        salida += limpio.slice(cursor, c.desde) + alias;
        cursor = c.hasta;
        if (usados) usados[alias] = { tipo: c.termino.tipo, id: c.termino.id };
      }
      return salida + limpio.slice(cursor);
    },
    restituir(texto) {
      return texto.replace(PATRON_ALIAS, (a) => porAlias.get(a.toUpperCase())?.nombre ?? a);
    },
    contiene(texto) {
      return buscar(limpiarTexto(texto).replace(PATRON_ALIAS, " "), compilados).length > 0;
    },
  };
}

function recorrer(valor: unknown, visita: (texto: string, esClave: boolean) => void): void {
  if (typeof valor === "string") visita(valor, false);
  else if (Array.isArray(valor)) for (const v of valor) recorrer(v, visita);
  else if (valor !== null && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      visita(k, true);
      recorrer(v, visita);
    }
  }
}

export type ResultadoControl = { ok: boolean; hallazgos: HallazgoPrivacidad[] };

/**
 * Control final (§3.5, punto 4): recorre el JSON ya armado. Si queda un término prohibido, un uuid, un año real (`/\b(19|20)\d{2}\b/` en
 * claves o textos) o una clave fuera de la lista blanca, el GM no se envía. Los números no se revisan (2 026 unidades no es un año).
 */
export function controlFinal(json: unknown, terminos: readonly TerminoPrivado[], clavesPermitidas?: ReadonlySet<string>): ResultadoControl {
  const compilados = compilar(terminos);
  const hallazgos = new Set<HallazgoPrivacidad>();
  recorrer(json, (texto, esClave) => {
    if (esClave) {
      if (clavesPermitidas && !clavesPermitidas.has(texto)) hallazgos.add("clave");
    } else if (buscar(limpiarTexto(texto).replace(PATRON_ALIAS, " "), compilados).length > 0) hallazgos.add("termino");
    if (REGEX_UUID.test(texto)) hallazgos.add("uuid");
    if (REGEX_ANIO.test(texto)) hallazgos.add("anio");
  });
  return { ok: hallazgos.size === 0, hallazgos: [...hallazgos] };
}
