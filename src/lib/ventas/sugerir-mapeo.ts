import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import type { EstadoImportacion } from "@/lib/arbol/importar";
import type { OrigenMapeo, SugerenciaMapeo } from "./tipos-mapeo";

/**
 * Sugerencia automática de destino para un mapeo (mejora M5b, docs/modulos/
 * 05b-mapeo-combinaciones.md, "Sugerencia automática"). TypeScript puro y
 * determinista (sin azar ni fecha): nunca se aplica sola, es una ayuda para
 * quien elige el destino. No importa nada de la base ni de componentes.
 *
 * Similitud: coeficiente de Dice sobre bigramas de `aCodigo` (multiconjuntos),
 * a dos decimales. Se listan candidatas con puntuación >= 0,50 y es `fuerte`
 * la de 0,80 o más; hasta 3 por origen. La venta o el stock NO entran en la
 * puntuación (sería sesgo hacia lo grande).
 */

export const UMBRAL_SUGERENCIA = 0.5;
export const UMBRAL_FUERTE = 0.8;
export const MAX_SUGERENCIAS = 3;
/** Similitud mínima para tomar otro género, mundo o línea como sustituto del escrito en el archivo. */
export const UMBRAL_SUSTITUTO = 0.8;

const redondear2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
/** `0,86` (coma decimal, para pantalla). */
const fmt = (x: number) => x.toFixed(2).replace(".", ",");

// ─── Similitud ───

const MAX_CACHE_BIGRAMAS = 20_000;
const cacheBigramas = new Map<string, Map<string, number>>();

function bigramas(codigo: string): Map<string, number> {
  const previo = cacheBigramas.get(codigo);
  if (previo) return previo;
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < codigo.length; i++) {
    const b = codigo.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  if (cacheBigramas.size >= MAX_CACHE_BIGRAMAS) cacheBigramas.clear();
  cacheBigramas.set(codigo, m);
  return m;
}

/** Dice sobre bigramas de dos códigos ya calculados (`aCodigo`), a 2 decimales. Iguales → 1; alguno de menos de 2 caracteres → 0. */
function diceCodigos(ca: string, cb: string): number {
  if (ca === cb) return 1;
  if (ca.length < 2 || cb.length < 2) return 0;
  const a = bigramas(ca);
  const b = bigramas(cb);
  let comunes = 0;
  for (const [bg, n] of a) comunes += Math.min(n, b.get(bg) ?? 0);
  return redondear2((2 * comunes) / (ca.length - 1 + (cb.length - 1)));
}

/**
 * Similitud entre dos textos (0 a 1, dos decimales). `1` si coinciden sin
 * tildes ni signos (`aCodigo`); `0` si alguno tiene menos de 2 caracteres; si
 * no, Dice sobre bigramas: `2·|A∩B| / (|A|+|B|)`. Tolera reordenar y recortar
 * palabras (`PANTALON DENIM` ~ `DENIM PANTALON`).
 */
export function similitud(a: string, b: string): number {
  return diceCodigos(aCodigo(a), aCodigo(b));
}

const razonSimilitud = (a: string, b: string, puntuacion: number): string =>
  aCodigo(a) === aCodigo(b) ? "mismo nombre sin tildes ni signos" : `similar ${fmt(puntuacion)}`;

// ─── Piezas vigentes del árbol ───

type EqVig = { id: string; nombre: string; norm: string; cod: string; esGenerica: boolean };
type NodoVig = {
  genero: string;
  mundo: string;
  linea: string;
  /** Normalizados (`normalizarNombre`) y sus códigos, para comparar sin recalcular. */
  generoNorm: string;
  mundoNorm: string;
  lineaNorm: string;
  generoCod: string;
  mundoCod: string;
  lineaCod: string;
  generoId: string;
  mundoId: string;
  eqs: EqVig[];
  generica: EqVig | null;
};
type Pieza = { id: string; nombre: string; norm: string; cod: string; codigo: string };

type Candidata = { eq: EqVig; nodo: NodoVig; puntuacion: number; razon: string };

const compara = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pieza activa del catálogo cuyo nombre o código coincide con el valor (como el resolutor). */
function buscarPieza(piezas: readonly Pieza[], valor: string): Pieza | null {
  const norm = normalizarNombre(valor);
  const cod = aCodigo(valor);
  if (norm === "") return null;
  return piezas.find((p) => (cod !== "" && p.codigo === cod) || p.norm === norm) ?? null;
}

const coincide = (p: { norm: string; codigo: string }, valor: string) => {
  const cod = aCodigo(valor);
  return p.norm === valor || (cod !== "" && p.codigo === cod);
};

/**
 * Sugeridor sobre el árbol dado: arma una vez las piezas activas y los nodos
 * vigentes (nodo, línea, género y mundo activos; equivalencias activas) y
 * devuelve la función que sugiere para un origen.
 */
export function crearSugeridor(estado: EstadoImportacion): (origen: OrigenMapeo) => SugerenciaMapeo[] {
  const aPieza = (c: { id: string; nombre: string; codigo: string }): Pieza => ({
    id: c.id,
    nombre: c.nombre,
    norm: normalizarNombre(c.nombre),
    cod: aCodigo(c.nombre),
    codigo: c.codigo.toUpperCase(),
  });
  const generos = estado.generos.filter((g) => g.activo).map(aPieza);
  const mundos = estado.mundos.filter((m) => m.activo).map(aPieza);
  const generosPorId = new Map(generos.map((g) => [g.id, g]));
  const mundosPorId = new Map(mundos.map((m) => [m.id, m]));
  const lineasPorId = new Map(estado.lineas.filter((l) => l.activo).map((l) => [l.id, aPieza(l)]));

  const eqsPorNodo = new Map<string, EqVig[]>();
  for (const e of estado.equivalencias) {
    if (!e.activo) continue;
    const lista = eqsPorNodo.get(e.genero_mundo_linea_id) ?? [];
    lista.push({ id: e.id, nombre: e.nombre, norm: normalizarNombre(e.nombre), cod: aCodigo(e.nombre), esGenerica: e.es_generica });
    eqsPorNodo.set(e.genero_mundo_linea_id, lista);
  }

  const nodos: NodoVig[] = [];
  for (const n of estado.nodos) {
    if (!n.activo) continue;
    const g = generosPorId.get(n.genero_id);
    const m = mundosPorId.get(n.mundo_id);
    const l = lineasPorId.get(n.linea_id);
    if (!g || !m || !l) continue;
    const eqs = eqsPorNodo.get(n.id) ?? [];
    nodos.push({
      genero: g.nombre,
      mundo: m.nombre,
      linea: l.nombre,
      generoNorm: g.norm,
      mundoNorm: m.norm,
      lineaNorm: l.norm,
      generoCod: g.cod,
      mundoCod: m.cod,
      lineaCod: l.cod,
      generoId: g.id,
      mundoId: m.id,
      eqs,
      generica: eqs.find((e) => e.esGenerica) ?? null,
    });
  }

  /**
   * Mejor equivalencia de un nodo para el origen (`eqOrigen`, `lineaOrigen` ya
   * normalizados): `{ eq, se, razon }` o `null` si el nodo no ofrece ninguna.
   * Venía `-` (equivalencia igual a la línea) → la que se llama como la línea
   * del nodo, o la genérica; si no, la más parecida (≥ 0,5) o la genérica con 0,5.
   */
  const mejorEquivalencia = (nodo: NodoVig, eqOrigen: string, lineaOrigen: string): { eq: EqVig; se: number; razon: string } | null => {
    if (eqOrigen === lineaOrigen) {
      const comoLinea = nodo.eqs.find((e) => !e.esGenerica && e.norm === nodo.lineaNorm);
      if (comoLinea) return { eq: comoLinea, se: 1, razon: "equivalencia igual a la línea" };
      return nodo.generica ? { eq: nodo.generica, se: 1, razon: "equivalencia genérica (venía «-»)" } : null;
    }
    const codOrigen = aCodigo(eqOrigen);
    let mejor: { eq: EqVig; se: number } | null = null;
    for (const e of nodo.eqs) {
      if (e.esGenerica) continue;
      const s = diceCodigos(codOrigen, e.cod);
      if (s < UMBRAL_SUGERENCIA) continue;
      if (!mejor || s > mejor.se || (s === mejor.se && compara(e.nombre, mejor.eq.nombre) < 0)) mejor = { eq: e, se: s };
    }
    if (mejor) return { ...mejor, razon: `equivalencia similar ${fmt(mejor.se)}` };
    return nodo.generica ? { eq: nodo.generica, se: UMBRAL_SUGERENCIA, razon: "equivalencia genérica del nodo" } : null;
  };

  /** Caso 2 (y base del 4) para un nodo: puntuación `sl · (0,5 + 0,5·se)` y su razón. */
  const puntuarNodo = (nodo: NodoVig, lineaOrigen: string, eqOrigen: string, minLinea: number): (Candidata & { sl: number }) | null => {
    const sl = diceCodigos(aCodigo(lineaOrigen), nodo.lineaCod);
    if (sl < minLinea) return null;
    const e = mejorEquivalencia(nodo, eqOrigen, lineaOrigen);
    if (!e) return null;
    const textoLinea = sl === 1 ? "línea igual" : `línea similar ${fmt(sl)}`;
    return { eq: e.eq, nodo, sl, puntuacion: redondear2(sl * (0.5 + 0.5 * e.se)), razon: `${textoLinea} · ${e.razon}` };
  };

  /** Casos 1 y 2 sobre los nodos vigentes de un género y un mundo ya resueltos. */
  const enGeneroMundo = (generoId: string, mundoId: string, lineaOrigen: string, eqOrigen: string): Candidata[] => {
    const delPar = nodos.filter((n) => n.generoId === generoId && n.mundoId === mundoId);
    const exacto = delPar.find((n) => n.lineaNorm === lineaOrigen);
    if (exacto) {
      // Caso 1: terna resuelta, equivalencia no.
      const codOrigen = aCodigo(eqOrigen);
      const lista: Candidata[] = [];
      for (const e of exacto.eqs) {
        if (e.esGenerica) continue;
        const s = diceCodigos(codOrigen, e.cod);
        if (s >= UMBRAL_SUGERENCIA) {
          lista.push({ eq: e, nodo: exacto, puntuacion: s, razon: razonSimilitud(eqOrigen, e.nombre, s) });
        }
      }
      if (lista.length === 0 && exacto.generica) {
        lista.push({ eq: exacto.generica, nodo: exacto, puntuacion: UMBRAL_SUGERENCIA, razon: "única opción: genérica del nodo" });
      }
      return lista;
    }
    // Caso 2: línea no resuelta; nodos vigentes del género y mundo.
    const lista: Candidata[] = [];
    for (const n of delPar) {
      const c = puntuarNodo(n, lineaOrigen, eqOrigen, UMBRAL_SUGERENCIA);
      if (c && c.puntuacion >= UMBRAL_SUGERENCIA) lista.push(c);
    }
    return lista;
  };

  /** Caso 3: género o mundo no resueltos; sustitutos con similitud >= 0,8. */
  const conSustitutos = (o: OrigenMapeo): Candidata[] => {
    type Opcion = { id: string; factor: number; texto: string | null };
    const opciones = (piezas: readonly Pieza[], valor: string, etiqueta: string): Opcion[] => {
      const exacta = buscarPieza(piezas, valor);
      if (exacta) return [{ id: exacta.id, factor: 1, texto: null }];
      const cod = aCodigo(valor);
      const lista: Opcion[] = [];
      for (const p of piezas) {
        const s = diceCodigos(cod, p.cod);
        if (s >= UMBRAL_SUSTITUTO) lista.push({ id: p.id, factor: s, texto: `${etiqueta} ${valor} → ${p.nombre} (${fmt(s)})` });
      }
      return lista;
    };
    const gs = opciones(generos, o.genero, "género");
    const ms = opciones(mundos, o.mundo, "mundo");
    const salida: Candidata[] = [];
    for (const g of gs) {
      for (const m of ms) {
        const factor = redondear2(g.factor * m.factor);
        const prefijo = [g.texto, m.texto].filter((t): t is string => t !== null);
        for (const c of enGeneroMundo(g.id, m.id, o.linea, o.equivalencia)) {
          const puntuacion = redondear2(c.puntuacion * factor);
          if (puntuacion < UMBRAL_SUGERENCIA) continue;
          salida.push({ ...c, puntuacion, razon: prefijo.length > 0 ? `${prefijo.join(" · ")} · ${c.razon}` : c.razon });
        }
      }
    }
    return salida;
  };

  /** Caso 4: `clasificacion_incompleta` con línea conocida. */
  const incompleta = (o: OrigenMapeo): Candidata[] => {
    if (o.linea === "") return [];
    const conocidas = [o.genero, o.mundo, o.linea].filter((v) => v !== "").length;
    const salida: Candidata[] = [];
    for (const n of nodos) {
      if (o.genero !== "" && !coincide({ norm: n.generoNorm, codigo: n.generoCod }, o.genero)) continue;
      if (o.mundo !== "" && !coincide({ norm: n.mundoNorm, codigo: n.mundoCod }, o.mundo)) continue;
      const c = puntuarNodo(n, o.linea, o.equivalencia, UMBRAL_SUSTITUTO);
      if (!c) continue;
      const puntuacion = redondear2((c.puntuacion * conocidas) / 3);
      if (puntuacion < UMBRAL_SUGERENCIA) continue;
      const textoLinea = c.sl === 1 ? "línea igual" : `línea similar ${fmt(c.sl)}`;
      salida.push({
        eq: c.eq,
        nodo: n,
        puntuacion,
        razon: `${textoLinea} · ${conocidas} de 3 piezas conocidas`,
      });
    }
    return salida;
  };

  return (origen: OrigenMapeo): SugerenciaMapeo[] => {
    const o: OrigenMapeo = {
      genero: normalizarNombre(origen.genero),
      mundo: normalizarNombre(origen.mundo),
      linea: normalizarNombre(origen.linea),
      equivalencia: normalizarNombre(origen.equivalencia),
    };
    if (o.genero === "" && o.mundo === "" && o.linea === "") return [];
    // `-` o vacío ya vienen sustituidos; por si acaso, vacío es la genérica y `-` la línea.
    if (o.equivalencia === "") o.equivalencia = "SIN EQUIVALENCIA";
    if (o.equivalencia === "-") o.equivalencia = o.linea === "" ? "SIN EQUIVALENCIA" : o.linea;

    const candidatas = o.genero === "" || o.mundo === "" || o.linea === "" ? incompleta(o) : conSustitutos(o);

    // Una por equivalencia (la de mayor puntuación).
    const porEq = new Map<string, Candidata>();
    for (const c of candidatas) {
      const previa = porEq.get(c.eq.id);
      if (!previa || c.puntuacion > previa.puntuacion) porEq.set(c.eq.id, c);
    }
    return [...porEq.values()]
      .map((c) => ({
        equivalencia_id: c.eq.id,
        genero: c.nodo.genero,
        mundo: c.nodo.mundo,
        linea: c.nodo.linea,
        equivalencia: c.eq.nombre,
        puntuacion: c.puntuacion,
        razon: c.razon,
        fuerte: c.puntuacion >= UMBRAL_FUERTE,
      }))
      .sort(
        (a, b) =>
          b.puntuacion - a.puntuacion ||
          compara(`${a.genero} / ${a.mundo} / ${a.linea} / ${a.equivalencia}`, `${b.genero} / ${b.mundo} / ${b.linea} / ${b.equivalencia}`) ||
          compara(a.equivalencia_id, b.equivalencia_id)
      )
      .slice(0, MAX_SUGERENCIAS);
  };
}

/** Hasta 3 sugerencias para un origen (arma los índices cada vez: para muchos orígenes, usar `crearSugeridor`). */
export function sugerirMapeo(origen: OrigenMapeo, estado: EstadoImportacion): SugerenciaMapeo[] {
  return crearSugeridor(estado)(origen);
}
