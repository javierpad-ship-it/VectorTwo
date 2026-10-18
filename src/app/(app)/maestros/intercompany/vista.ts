import type { ArbolRespuesta } from "@/lib/arbol/tipos-api";
import { formatearDecimal, plural } from "@/lib/formato";
import {
  AVISO_REGLA_TEXTO,
  GENERO_AMBITO,
  IMI_LIMITE_MAX,
  IMI_LIMITE_MIN,
  IMI_MAX_DEFECTO,
  IMI_MIN_DEFECTO,
  MAX_NOTA_REGLA,
  MUNDOS_AMBITO,
  type AplicabilidadApi,
  type AvisoRegla,
  type ReglaIntercompanyApi,
} from "@/lib/intercompany/tipos-api";

/**
 * Presentación pura de /maestros/intercompany (M13, ficha 13 sección 4): estado de la vista en la URL, filtros, orden,
 * resumen, formularios con sus validaciones y avisos. Sin React ni I/O; las pruebas viven en `tests/intercompany.vista.test.ts`.
 * Ninguna recomendación reemplaza la decisión del planner: aquí solo se muestran y se validan los números que él escribe.
 */

// ─── Constantes del método (la ficha manda; la API vuelve a validar todo con zod) ───

/** Las constantes del método viven en el contrato de la API (`tipos-api.ts`); aquí solo se nombran para la pantalla. */
export const IMI_PERMITIDO_MIN = IMI_LIMITE_MIN;
export const IMI_PERMITIDO_MAX = IMI_LIMITE_MAX;
export const MAX_NOTA = MAX_NOTA_REGLA;
const MUNDOS_DEL_AMBITO: readonly string[] = MUNDOS_AMBITO;

export const TODOS = "todos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string | null | undefined): v is string => typeof v === "string" && UUID.test(v);
export const esMes = (v: string | null | undefined): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// ─── Meses (`aaaa-mm`) ───

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

const FORMATO_MES_LIMA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" });

/**
 * El mes de una fecha en la zona America/Lima (el mismo criterio que `hoyLima()` del servidor, que corre en UTC), no en la hora
 * local del navegador: `2026-10`.
 */
export function mesDe(fecha: Date): string {
  const partes = FORMATO_MES_LIMA.formatToParts(fecha);
  const dato = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${dato("year")}-${dato("month")}`;
}

/** Cuántos meses ofrecen los selectores hacia atrás y hacia delante del mes en curso (la API admite cualquier mes). */
export const MESES_ATRAS = 36;
export const MESES_ADELANTE = 24;

/** Suma `n` meses (negativo resta) a `aaaa-mm`. */
export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Los dos formatos que puede traer la API (`2026-01` o `2026-01-01`) se leen como `aaaa-mm`. */
export const mesDeApi = (v: string): string => v.slice(0, 7);

/** `2026-09` → `set-2026`. */
export function periodoCorto(mes: string): string {
  const [a, m] = mesDeApi(mes).split("-");
  const i = Number(m) - 1;
  return a && i >= 0 && i < 12 ? `${MESES_CORTOS[i]}-${a}` : mes;
}

/** Los meses que ofrece un selector: de `atras` meses antes a `adelante` después del centro, más los `extra` que falten. */
export function opcionesMes(centro: string, atras: number, adelante: number, extra: readonly string[] = []): { id: string; nombre: string }[] {
  const ids = new Set<string>();
  for (let i = -atras; i <= adelante; i++) ids.add(sumarMeses(centro, i));
  for (const e of extra) if (esMes(e)) ids.add(e);
  return [...ids].sort().map((id) => ({ id, nombre: periodoCorto(id) }));
}

// ─── Números ───

/** `4`, `4,5`, `4.5` → número; vacío o no numérico → `null`. */
export function leerDecimal(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const decimalesDe = (texto: string): number => {
  const t = texto.trim().replace(",", ".");
  return t.includes(".") ? t.split(".")[1].length : 0;
};

/** El número como texto editable (sin ceros de relleno): `4`, `4.5`. */
export const textoEditable = (n: number): string => String(Math.round(n * 100) / 100);

/** Los meses de inventario con un decimal y coma decimal, como en la ficha: `4,0`. */
export const formatearImi = (n: number): string => formatearDecimal(n, 1).replace(".", ",");
export const formatearPct = (n: number): string => `${formatearDecimal(n, n % 1 === 0 ? 0 : 1)} %`;
/** `100 − % directo`: lo que sale del CD. */
export const pctCd = (pctDirecto: number): number => Math.round((100 - pctDirecto) * 100) / 100;

export const esRangoPorDefecto = (r: Pick<ReglaIntercompanyApi, "es_rango_defecto">): boolean => r.es_rango_defecto;

// ─── Estado de la vista en la URL ───

export type Pestana = "reglas" | "historial";
export const PESTANAS: readonly Pestana[] = ["reglas", "historial"];
export type SoloReglas = "no_aplicables" | "fuera_de_ambito";
export const ORDEN_SOLO: readonly SoloReglas[] = ["no_aplicables", "fuera_de_ambito"];
export const ETIQUETA_SOLO: Record<SoloReglas, string> = { no_aplicables: "No aplicables", fuera_de_ambito: "Fuera de ámbito" };

/** Género y mundo: sin valor en la URL rige el ámbito sugerido; `todos` lo quita; un id lo reemplaza. */
export type FiltroGenero = { tipo: "defecto" } | { tipo: "todos" } | { tipo: "uno"; id: string };
export type FiltroMundo = { tipo: "defecto" } | { tipo: "todos" } | { tipo: "varios"; ids: string[] };

export type ParametrosVista = {
  pestana: Pestana;
  marca: string | null;
  genero: FiltroGenero;
  mundo: FiltroMundo;
  linea: string | null;
  /** `aaaa-mm`; `null` = el mes en curso. */
  mes: string | null;
  solo: SoloReglas[];
};

export const PARAMETROS_VACIOS: ParametrosVista = { pestana: "reglas", marca: null, genero: { tipo: "defecto" }, mundo: { tipo: "defecto" }, linea: null, mes: null, solo: [] };

/** Lee y valida los parámetros: un valor inválido cae al de defecto, nunca rompe la pantalla. */
export function leerParametros(get: (clave: string) => string | null): ParametrosVista {
  const pestana = get("pestana");
  const marca = get("marca");
  const genero = get("genero");
  const mundo = get("mundo");
  const linea = get("linea");
  const mes = get("mes");
  const ids = mundo && mundo !== TODOS ? [...new Set(mundo.split(",").filter(esUuid))] : [];
  return {
    pestana: PESTANAS.includes(pestana as Pestana) ? (pestana as Pestana) : "reglas",
    marca: esUuid(marca) ? marca : null,
    genero: genero === TODOS ? { tipo: "todos" } : esUuid(genero) ? { tipo: "uno", id: genero } : { tipo: "defecto" },
    mundo: mundo === TODOS ? { tipo: "todos" } : ids.length > 0 ? { tipo: "varios", ids } : { tipo: "defecto" },
    linea: esUuid(linea) ? linea : null,
    mes: esMes(mes) ? mes : null,
    solo: ORDEN_SOLO.filter((s) => (get("solo") ?? "").split(",").includes(s)),
  };
}

/** La parte de la URL (`?marca=&genero=&mundo=&linea=&mes=&solo=`): lo que es el defecto no se escribe. */
export function consultaVista(p: ParametrosVista): string {
  const q = new URLSearchParams();
  if (p.pestana !== "reglas") q.set("pestana", p.pestana);
  if (p.marca) q.set("marca", p.marca);
  if (p.genero.tipo === "todos") q.set("genero", TODOS);
  else if (p.genero.tipo === "uno") q.set("genero", p.genero.id);
  if (p.mundo.tipo === "todos") q.set("mundo", TODOS);
  else if (p.mundo.tipo === "varios") q.set("mundo", p.mundo.ids.join(","));
  if (p.linea) q.set("linea", p.linea);
  if (p.mes) q.set("mes", p.mes);
  if (p.solo.length > 0) q.set("solo", p.solo.join(","));
  return q.toString();
}

/** `GET /api/intercompany/reglas?mes=aaaa-mm[&incluir_historial=1]` */
export function urlReglas(mes: string, historial: boolean): string {
  return `/api/intercompany/reglas?mes=${mes}${historial ? "&incluir_historial=1" : ""}`;
}

// ─── Nodos del árbol (para filtrar por género, mundo y línea y para el selector del formulario) ───

export type NodoIntercompany = {
  id: string;
  generoId: string;
  generoCodigo: string;
  genero: string;
  mundoId: string;
  mundoCodigo: string;
  mundo: string;
  lineaId: string;
  linea: string;
  nivel: "GML" | "GMLE";
  vigente: boolean;
  equivalencias: { id: string; nombre: string; activo: boolean }[];
};

export const rutaNodo = (n: Pick<NodoIntercompany, "genero" | "mundo" | "linea">) => `${n.genero} · ${n.mundo} · ${n.linea}`;

export function nodosDelArbol(arbol: ArbolRespuesta | null): NodoIntercompany[] {
  if (!arbol) return [];
  const nodos: NodoIntercompany[] = [];
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        nodos.push({
          id: l.nodo_id,
          generoId: g.id,
          generoCodigo: g.codigo,
          genero: g.nombre,
          mundoId: m.id,
          mundoCodigo: m.codigo,
          mundo: m.nombre,
          lineaId: l.linea_id,
          linea: l.nombre,
          nivel: l.nivel_planificacion === "GMLE" ? "GMLE" : "GML",
          vigente: l.vigente,
          equivalencias: l.equivalencias.map((e) => ({ id: e.id, nombre: e.nombre, activo: e.activo })),
        });
      }
    }
  }
  return nodos;
}

export const indiceNodos = (nodos: readonly NodoIntercompany[]): Map<string, NodoIntercompany> => new Map(nodos.map((n) => [n.id, n]));

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

/** El ámbito sugerido en ids del árbol: HOMBRE y FORMAL, CASUAL y RI (por código de M1). `null` = no se pudo resolver, sin filtro. */
export function ambitoSugerido(nodos: readonly NodoIntercompany[]): { generoId: string | null; mundoIds: string[] } {
  const genero = nodos.find((n) => normalizar(n.generoCodigo) === GENERO_AMBITO || normalizar(n.genero) === GENERO_AMBITO);
  const mundos = new Map<string, string>();
  for (const n of nodos) {
    const cod = normalizar(n.mundoCodigo);
    const nom = normalizar(n.mundo);
    if (MUNDOS_DEL_AMBITO.includes(cod) || MUNDOS_DEL_AMBITO.includes(nom)) mundos.set(n.mundoId, n.mundoId);
  }
  return { generoId: genero?.generoId ?? null, mundoIds: [...mundos.keys()] };
}

export type FiltrosEfectivos = { marcaId: string | null; generoId: string | null; mundoIds: string[] | null; lineaId: string | null; solo: readonly SoloReglas[] };

/**
 * Lo que de verdad se filtra. El ámbito sugerido solo rige mientras el planner no elija género o mundo, y se suspende con
 * `solo = fuera de ámbito` (si no, ese filtro nunca mostraría nada).
 */
export function filtrosEfectivos(p: ParametrosVista, nodos: readonly NodoIntercompany[]): FiltrosEfectivos {
  const sugerido = ambitoSugerido(nodos);
  const sinAmbito = p.solo.includes("fuera_de_ambito");
  const generoId = p.genero.tipo === "uno" ? p.genero.id : p.genero.tipo === "defecto" && !sinAmbito ? sugerido.generoId : null;
  const mundoIds = p.mundo.tipo === "varios" ? p.mundo.ids : p.mundo.tipo === "defecto" && !sinAmbito && sugerido.mundoIds.length > 0 ? sugerido.mundoIds : null;
  return { marcaId: p.marca, generoId, mundoIds, lineaId: p.linea, solo: p.solo };
}

/**
 * El género elegido en el selector. `todos` lo quita; elegir el del ámbito sugerido equivale a no tocarlo (no se escribe en la URL),
 * así recargar o compartir el enlace reabre lo mismo.
 */
export function aplicarGenero(valor: string, nodos: readonly NodoIntercompany[]): FiltroGenero {
  if (valor === TODOS || valor === "") return { tipo: "todos" };
  return ambitoSugerido(nodos).generoId === valor ? { tipo: "defecto" } : { tipo: "uno", id: valor };
}

/** Los mundos marcados: el conjunto sugerido equivale a no tocarlo; ninguno marcado equivale a todos. */
export function aplicarMundos(ids: readonly string[], nodos: readonly NodoIntercompany[]): FiltroMundo {
  if (ids.length === 0) return { tipo: "todos" };
  const sugeridos = ambitoSugerido(nodos).mundoIds;
  const igual = sugeridos.length === ids.length && sugeridos.every((m) => ids.includes(m));
  return igual ? { tipo: "defecto" } : { tipo: "varios", ids: [...ids] };
}

export const hayFiltrosActivos = (p: ParametrosVista): boolean =>
  p.marca !== null || p.genero.tipo !== "defecto" || p.mundo.tipo !== "defecto" || p.linea !== null || p.solo.length > 0;

/** Filtros combinados (Y); `solo` se combina con O entre sus opciones. Un nodo desconocido solo pasa si no se filtra por género, mundo o línea. */
export function filtrarReglas(reglas: readonly ReglaIntercompanyApi[], f: FiltrosEfectivos, indice: ReadonlyMap<string, NodoIntercompany>): ReglaIntercompanyApi[] {
  return reglas.filter((r) => {
    if (f.marcaId && r.marca_id !== f.marcaId) return false;
    if (f.generoId || f.mundoIds || f.lineaId) {
      const n = indice.get(r.genero_mundo_linea_id);
      if (!n) return false;
      if (f.generoId && n.generoId !== f.generoId) return false;
      if (f.mundoIds && !f.mundoIds.includes(n.mundoId)) return false;
      if (f.lineaId && n.lineaId !== f.lineaId) return false;
    }
    if (f.solo.length > 0) {
      const cumple = (f.solo.includes("no_aplicables") && r.aplicable === false) || (f.solo.includes("fuera_de_ambito") && r.fuera_de_ambito);
      if (!cumple) return false;
    }
    return true;
  });
}

// ─── Orden, clave y secuencia ───

/** La clave de la regla (marca, nodo, equivalencia): dos reglas de la misma clave forman una secuencia por mes. */
export const claveDeRegla = (r: Pick<ReglaIntercompanyApi, "marca_id" | "genero_mundo_linea_id" | "equivalencia_id">): string =>
  `${r.marca_id}|${r.genero_mundo_linea_id}|${r.equivalencia_id ?? ""}`;

const comparar = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

/** Marca, ruta y, a igual ruta, la más reciente primero. Sin mutar la entrada. */
export function ordenarReglas(reglas: readonly ReglaIntercompanyApi[]): ReglaIntercompanyApi[] {
  return [...reglas].sort((a, b) => comparar(a.marca, b.marca) || comparar(a.ruta, b.ruta) || b.vigente_desde.localeCompare(a.vigente_desde));
}

export type GrupoHistorial = { clave: string; marca: string; ruta: string; reglas: ReglaIntercompanyApi[] };

/** Las reglas agrupadas por clave, cada secuencia de la más antigua a la más reciente. */
export function agruparPorClave(reglas: readonly ReglaIntercompanyApi[]): GrupoHistorial[] {
  const mapa = new Map<string, GrupoHistorial>();
  for (const r of reglas) {
    const clave = claveDeRegla(r);
    const g = mapa.get(clave) ?? { clave, marca: r.marca, ruta: r.ruta, reglas: [] };
    g.reglas.push(r);
    mapa.set(clave, g);
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) g.reglas.sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde));
  return grupos.sort((a, b) => comparar(a.marca, b.marca) || comparar(a.ruta, b.ruta));
}

/** ¿Esta regla es la que rige en `mes`? Desde su mes (inclusive) hasta el derivado (inclusive); sin "hasta", abierta. */
export function rigeEn(r: Pick<ReglaIntercompanyApi, "vigente_desde" | "hasta_derivado">, mes: string): boolean {
  return mesDeApi(r.vigente_desde) <= mes && (r.hasta_derivado === null || mes <= mesDeApi(r.hasta_derivado));
}

/** La regla anterior de la misma clave exacta (la que vuelve a regir si se elimina esta), o `null`. */
export function reglaAnterior(r: ReglaIntercompanyApi, reglas: readonly ReglaIntercompanyApi[]): ReglaIntercompanyApi | null {
  const clave = claveDeRegla(r);
  const previas = reglas.filter((x) => x.id !== r.id && claveDeRegla(x) === clave && x.vigente_desde < r.vigente_desde);
  return previas.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0] ?? null;
}

// ─── Resumen y textos ───

export type ResumenReglas = { reglas: number; noAplicables: number; fueraDeAmbito: number; rangoEditado: number };

export function resumenReglas(reglas: readonly ReglaIntercompanyApi[]): ResumenReglas {
  return {
    reglas: reglas.length,
    noAplicables: reglas.filter((r) => r.aplicable === false).length,
    fueraDeAmbito: reglas.filter((r) => r.fuera_de_ambito).length,
    rangoEditado: reglas.filter((r) => !esRangoPorDefecto(r)).length,
  };
}

/** `5 reglas vigentes · 0 no aplicables · 0 fuera de ámbito · rango por defecto 4–8 (editado en 2 reglas)` */
export function textoResumen(r: ResumenReglas): string {
  const base = `${plural(r.reglas, "regla vigente", "reglas vigentes")} · ${plural(r.noAplicables, "no aplicable", "no aplicables")} · ${r.fueraDeAmbito} fuera de ámbito`;
  const rango = `rango por defecto ${IMI_MIN_DEFECTO}–${IMI_MAX_DEFECTO}`;
  return `${base} · ${rango}${r.rangoEditado > 0 ? ` (editado en ${plural(r.rangoEditado, "regla", "reglas")})` : ""}`;
}

export type EstadoAplicable = { texto: string; tono: "exito" | "alerta" | "neutro"; detalle: string | null; atajo: boolean };

/** Aplicable según la cerrada de M7: sí / no (sin clave) / se sabrá al cerrar una proyección. */
export function estadoAplicable(r: Pick<ReglaIntercompanyApi, "aplicable" | "motivo_no_aplicable">): EstadoAplicable {
  if (r.aplicable === true) return { texto: "Sí", tono: "exito", detalle: null, atajo: false };
  if (r.aplicable === false) {
    return {
      texto: "No: sin clave",
      tono: "alerta",
      detalle: "La marca no tiene venta propia en este GML en la proyección cerrada. Márcala como relevante en el GML o cierra una proyección con la versión 0.10.1.",
      atajo: true,
    };
  }
  return { texto: "Se sabrá al cerrar", tono: "neutro", detalle: "Todavía no hay una proyección cerrada: se sabrá al cerrar una proyección.", atajo: false };
}

/** La regla es de una equivalencia dentro de un nodo GMLE: manda sobre la del GML entero. */
export const esDeEquivalencia = (r: Pick<ReglaIntercompanyApi, "equivalencia_id" | "nivel">): boolean => r.equivalencia_id !== null && r.nivel === "GMLE";

/** `80 % (set-2026)`; sin dato `—` (hasta construir M8 siempre llega vacío). El valor viaja en puntos porcentuales 0–100, como `pct_directo`. */
export function textoObservado(o: ReglaIntercompanyApi["pct_directo_observado"]): string {
  if (!o) return "—";
  return `${formatearPct(Math.round(o.valor * 10) / 10)} (${periodoCorto(o.periodo)})`;
}

// ─── Formulario de regla (nueva regla, nueva vigencia y edición) ───

export type ValoresRegla = {
  marcaId: string;
  nodoId: string;
  equivalenciaId: string;
  /** `aaaa-mm` */
  mes: string;
  imiMin: string;
  imiMax: string;
  pct: string;
  nota: string;
};

export type CampoRegla = keyof ValoresRegla;
export type ErroresRegla = Partial<Record<CampoRegla, string>>;

export const VALORES_VACIOS = (mes: string): ValoresRegla => ({ marcaId: "", nodoId: "", equivalenciaId: "", mes, imiMin: textoEditable(IMI_MIN_DEFECTO), imiMax: textoEditable(IMI_MAX_DEFECTO), pct: "", nota: "" });

/**
 * Nueva vigencia sobre una clave: marca, nodo y equivalencia quedan fijos y el rango, el porcentaje y la nota arrancan con los de la
 * regla anterior (o con 4–8 si no hay). El mes propuesto es el siguiente a hoy: el planner lo cambia.
 */
export function valoresNuevaVigencia(base: ReglaIntercompanyApi, mesPropuesto: string): ValoresRegla {
  return {
    marcaId: base.marca_id,
    nodoId: base.genero_mundo_linea_id,
    equivalenciaId: base.equivalencia_id ?? "",
    mes: mesPropuesto,
    imiMin: textoEditable(base.imi_min),
    imiMax: textoEditable(base.imi_max),
    pct: textoEditable(base.pct_directo),
    nota: base.nota ?? "",
  };
}

/**
 * El mes que propone el formulario para una regla nueva: el siguiente a hoy y, si ya hay reglas de la clave (nueva vigencia),
 * nunca uno ya ocupado: el siguiente a la última regla de la clave si esa es posterior a hoy. `clave` es `null` si aún no se eligió.
 */
export function mesPropuesto(hoy: string, reglas: readonly ReglaIntercompanyApi[], clave: string | null): string {
  const siguienteAHoy = sumarMeses(hoy, 1);
  if (clave === null) return siguienteAHoy;
  const ultima = reglas.filter((r) => claveDeRegla(r) === clave).reduce<string | null>((max, r) => (max === null || mesDeApi(r.vigente_desde) > max ? mesDeApi(r.vigente_desde) : max), null);
  if (ultima === null) return siguienteAHoy;
  const despuesDeLaUltima = sumarMeses(ultima, 1);
  return despuesDeLaUltima > siguienteAHoy ? despuesDeLaUltima : siguienteAHoy;
}

/** Tras guardar una regla la pantalla pasa a su mes de vigencia (`null` = el mes en curso) para que se vea; el resto de los filtros no cambia. */
export function parametrosTrasGuardar(p: ParametrosVista, vigenteDesde: string, hoy: string): ParametrosVista {
  const mes = mesDeApi(vigenteDesde);
  return { ...p, mes: !esMes(mes) || mes === hoy ? null : mes };
}

/** Mensaje de la tabla de Reglas sin filas: distingue un mes sin reglas vigentes de las que oculta el filtro. */
export function textoTablaVacia(o: { mes: string; filtrosActivos: boolean; vigentesEnMes: number }): string {
  const mes = periodoCorto(o.mes);
  if (o.filtrosActivos) return `Ninguna regla vigente en ${mes} con estos filtros. Prueba otro mes o quita filtros.`;
  if (o.vigentesEnMes > 0) {
    return `Hay ${plural(o.vigentesEnMes, "regla vigente", "reglas vigentes")} en ${mes}, pero ${o.vigentesEnMes === 1 ? "queda oculta" : "quedan ocultas"} por el ámbito sugerido (hombre formal, casual y RI). Elige «Todos» en Género para verlas.`;
  }
  return `Ninguna regla vigente en ${mes}: las que existen empiezan en un mes posterior. Mira el Historial o elige otro mes.`;
}

export const valoresDeRegla = (r: ReglaIntercompanyApi): ValoresRegla => ({ ...valoresNuevaVigencia(r, mesDeApi(r.vigente_desde)) });

/** Entre 0,5 y 24 meses con un decimal; el máximo no puede ser menor que el mínimo. */
function validarRango(v: Pick<ValoresRegla, "imiMin" | "imiMax">): ErroresRegla {
  const e: ErroresRegla = {};
  const min = leerDecimal(v.imiMin);
  const max = leerDecimal(v.imiMax);
  const texto = `Entre ${IMI_PERMITIDO_MIN} y ${IMI_PERMITIDO_MAX} meses, con un decimal.`;
  if (min === null || min < IMI_PERMITIDO_MIN || min > IMI_PERMITIDO_MAX || decimalesDe(v.imiMin) > 1) e.imiMin = texto;
  if (max === null || max < IMI_PERMITIDO_MIN || max > IMI_PERMITIDO_MAX || decimalesDe(v.imiMax) > 1) e.imiMax = texto;
  if (!e.imiMin && !e.imiMax && min !== null && max !== null && max < min) e.imiMax = "El máximo no puede ser menor que el mínimo.";
  return e;
}

function validarPct(texto: string): string | null {
  const n = leerDecimal(texto);
  if (n === null) return "Escribe el porcentaje que llega directo (0 a 100).";
  if (n < 0 || n > 100) return "El porcentaje va de 0 a 100.";
  if (decimalesDe(texto) > 2) return "Como máximo dos decimales.";
  return null;
}

export type ResultadoValidacion = { errores: ErroresRegla; valida: boolean };

/**
 * Valida el formulario. `existentes` son todas las reglas conocidas (historial) para avisar antes de que la API responda
 * `clave_mes_repetido`; `editandoId` excluye a la regla que se está editando. La API vuelve a validar todo.
 */
export function validarRegla(v: ValoresRegla, opciones: { existentes: readonly ReglaIntercompanyApi[]; editandoId?: string | null; soloRangoYPorcentaje?: boolean }): ResultadoValidacion {
  const errores: ErroresRegla = { ...validarRango(v) };
  const ePct = validarPct(v.pct);
  if (ePct) errores.pct = ePct;
  if (v.nota.trim().length > MAX_NOTA) errores.nota = `Máximo ${MAX_NOTA} caracteres.`;
  if (!opciones.soloRangoYPorcentaje) {
    if (!v.marcaId) errores.marcaId = "Elige la marca.";
    if (!v.nodoId) errores.nodoId = "Elige el GML.";
    if (!esMes(v.mes)) errores.mes = "Elige el mes desde el que rige.";
    else if (v.marcaId && v.nodoId) {
      const clave = `${v.marcaId}|${v.nodoId}|${v.equivalenciaId}`;
      const repetida = opciones.existentes.some((r) => r.id !== opciones.editandoId && claveDeRegla(r) === clave && mesDeApi(r.vigente_desde) === v.mes);
      if (repetida) errores.mes = "Ya hay una regla de esa clave desde ese mes: edítala.";
    }
  }
  return { errores, valida: Object.keys(errores).length === 0 };
}

/** Cuerpo de `POST /api/intercompany/reglas`. El rango se manda siempre, tal como lo ve el planner (si es 4–8 la API lo marca "por defecto"). */
export type CuerpoCrearRegla = {
  marca_id: string;
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  vigente_desde: string;
  imi_min: number;
  imi_max: number;
  pct_directo: number;
  nota: string | null;
};

/** La API acepta `aaaa-mm` (y `aaaa-mm-01`) y guarda el primer día del mes. */
export const mesParaApi = (mes: string): string => mes;

export function cuerpoCrear(v: ValoresRegla): CuerpoCrearRegla {
  const nota = v.nota.trim();
  return {
    marca_id: v.marcaId,
    genero_mundo_linea_id: v.nodoId,
    equivalencia_id: v.equivalenciaId === "" ? null : v.equivalenciaId,
    vigente_desde: mesParaApi(v.mes),
    imi_min: leerDecimal(v.imiMin) ?? IMI_MIN_DEFECTO,
    imi_max: leerDecimal(v.imiMax) ?? IMI_MAX_DEFECTO,
    pct_directo: leerDecimal(v.pct) ?? 0,
    nota: nota === "" ? null : nota,
  };
}

/** Cuerpo de `PATCH /api/intercompany/reglas/[id]`: solo lo que cambió respecto de la regla guardada. */
export type CuerpoEditarRegla = Partial<{ imi_min: number; imi_max: number; pct_directo: number; nota: string | null }>;

export function cuerpoEditar(v: ValoresRegla, original: ReglaIntercompanyApi): CuerpoEditarRegla {
  const c: CuerpoEditarRegla = {};
  const min = leerDecimal(v.imiMin);
  const max = leerDecimal(v.imiMax);
  const pct = leerDecimal(v.pct);
  if (min !== null && min !== original.imi_min) c.imi_min = min;
  if (max !== null && max !== original.imi_max) c.imi_max = max;
  if (pct !== null && pct !== original.pct_directo) c.pct_directo = pct;
  const nota = v.nota.trim() === "" ? null : v.nota.trim();
  if (nota !== (original.nota ?? null)) c.nota = nota;
  return c;
}

export const hayCambios = (c: object): boolean => Object.keys(c).length > 0;

/** Opciones de marca del formulario: solo unidades (una cabeza se ofrece por su conjunto), vigentes y no genéricas. */
export type MarcaOpcion = { id: string; nombre: string; unidad_marca_id: string; vigente: boolean; miembros: number };

export function opcionesMarca(marcas: readonly MarcaOpcion[], esGenerica: (nombre: string) => boolean): { id: string; nombre: string }[] {
  return marcas
    .filter((m) => m.vigente && m.unidad_marca_id === m.id && !esGenerica(m.nombre))
    .map((m) => ({ id: m.id, nombre: m.miembros > 0 ? `${m.nombre} (con su conjunto)` : m.nombre }))
    .sort((a, b) => comparar(a.nombre, b.nombre));
}

/** Los nodos que ofrece el selector del formulario: vigentes y, por defecto, solo el ámbito sugerido. */
export function nodosParaSelector(nodos: readonly NodoIntercompany[], soloAmbito: boolean, incluir: string | null = null): NodoIntercompany[] {
  const sugerido = ambitoSugerido(nodos);
  return nodos
    .filter((n) => {
      if (n.id === incluir) return true;
      if (!n.vigente) return false;
      if (!soloAmbito) return true;
      return (sugerido.generoId === null || n.generoId === sugerido.generoId) && (sugerido.mundoIds.length === 0 || sugerido.mundoIds.includes(n.mundoId));
    })
    .sort((a, b) => comparar(rutaNodo(a), rutaNodo(b)));
}

/** El aviso previo (no bloqueante) del formulario: la marca no tendría clave en la cerrada vigente. Sale de `GET /api/intercompany/aplicabilidad`. */
export function avisoMarcaSinClave(ap: Pick<AplicabilidadApi, "aplicable" | "motivo_no_aplicable"> | null | undefined): boolean {
  return ap?.aplicable === false && ap.motivo_no_aplicable === "marca_sin_clave";
}

export const TEXTO_AVISO_SIN_CLAVE =
  "Esta marca no tiene venta propia en ese GML en la proyección cerrada: la regla se guardará como no aplicable hasta que se cierre una proyección con la versión 0.10.1 o la marca sea relevante en ese GML.";

/** `GET /api/intercompany/aplicabilidad?marca_id=&genero_mundo_linea_id=`; `null` mientras falte la marca o el GML (no se lee nada). */
export function urlAplicabilidad(marcaId: string, nodoId: string): string | null {
  return marcaId && nodoId ? `/api/intercompany/aplicabilidad?marca_id=${marcaId}&genero_mundo_linea_id=${nodoId}` : null;
}

/** Los avisos informativos que trae la respuesta de guardar. */
export const textosAvisos = (avisos: readonly AvisoRegla[] | undefined): string[] => (avisos ?? []).map((a) => AVISO_REGLA_TEXTO[a]);

/** Texto de `confirm` al eliminar una regla: dice qué regla vuelve a regir. */
export function textoConfirmarEliminar(r: ReglaIntercompanyApi, anterior: ReglaIntercompanyApi | null): string {
  const que = `la regla de ${r.marca} en ${r.ruta} desde ${periodoCorto(r.vigente_desde)}`;
  const despues = anterior
    ? `Volverá a regir la anterior (desde ${periodoCorto(anterior.vigente_desde)}: IMI ${formatearImi(anterior.imi_min)}–${formatearImi(anterior.imi_max)}, ${formatearPct(anterior.pct_directo)} directo).`
    : "La clave quedará sin reglas: la marca volverá a evaluarse con el rango general, sin reposición directa esperada (si el GML tiene una regla de otra equivalencia o del GML entero, esa vuelve a mandar).";
  return `¿Eliminar ${que}? Se borra de verdad, no se puede deshacer. ${despues}`;
}

/** Los códigos de negocio de la API que el formulario explica con su propio texto. */
export const TEXTO_CODIGO: Record<string, string> = {
  marca_en_conjunto: "Esa marca es miembro de un conjunto: usa la cabeza del conjunto.",
  marca_generica: "VARIOS, OTROS y SIN MARCA no admiten regla de intercompany.",
  nodo_no_vigente: "Ese GML no está vigente en el árbol de producto.",
  equivalencia_de_otro_nodo: "Esa equivalencia no pertenece a ese GML.",
  clave_mes_repetido: "Ya hay una regla de esa clave desde ese mes: edítala.",
};

/** El mensaje de la API ya viene en español; si llegara vacío, el texto propio del código de negocio. */
export function textoErrorAccion(error: { mensaje: string; codigo: string | null }): string {
  if (error.mensaje.trim() !== "") return error.mensaje;
  return (error.codigo && TEXTO_CODIGO[error.codigo]) || "No se pudo guardar la regla.";
}

export const soloFecha = (iso: string) => iso.slice(0, 10);
