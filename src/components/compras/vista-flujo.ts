import type { AvisoFila, CatalogoFlujoApi, ConciliacionFilaApi, FilaFlujoListaApi, FiltrosConciliacion, FiltrosFlujo, SoloConciliacion, SoloFlujo } from "@/lib/flujo/tipos-api";
import { SOLO_CONCILIACION, SOLO_FLUJO } from "@/lib/flujo/tipos-api";
import type { ClaveFila } from "@/lib/flujo/use-flujo";
import type { ArbolRespuesta } from "@/lib/arbol/tipos-api";
import type { FiltroExcelFlujo } from "@/lib/flujo/excel";
import { OPCIONES_HISTORIA, type MesesHistoria } from "./matriz";
import { sumarMes, unidades } from "./formato";

/**
 * Lógica de la pantalla Flujo mensual (`/compras/flujo`, ficha 08 §4.3 y §4.3b): parámetros de la URL, filtros que viajan al servidor,
 * filas de la lista y textos de la conciliación. Pura. La pestaña, los filtros, la fila abierta y el mes conciliado viven en la URL:
 * recargar o compartir el enlace reabre lo mismo.
 */

export type Pestana = "flujo" | "conciliacion";

export type ParametrosFlujo = {
  pestana: Pestana;
  /** Ids del árbol y de la agrupación de marca (los filtros viajan al servidor, así los totales siguen al filtro). */
  genero: string | null;
  mundo: string | null;
  linea: string | null;
  agrupacion: string | null;
  solo: SoloFlujo | null;
  soloConciliacion: SoloConciliacion | null;
  mio: boolean;
  /** La fila abierta (detalle), o `null` para la lista. */
  fila: ClaveFila | null;
  historia: MesesHistoria;
  /** Mes conciliado; `null` = el último publicado. */
  periodo: string | null;
};

export const PARAMETROS_FLUJO_VACIOS: ParametrosFlujo = {
  pestana: "flujo",
  genero: null,
  mundo: null,
  linea: null,
  agrupacion: null,
  solo: null,
  soloConciliacion: null,
  mio: false,
  fila: null,
  historia: 3,
  periodo: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (v: string | null): v is string => v !== null && UUID.test(v);
const esMes = (v: string | null): v is string => v !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function leerParametrosFlujo(get: (clave: string) => string | null): ParametrosFlujo {
  const solo = get("solo");
  const historia = Number(get("historia"));
  const gml = get("gml");
  const agr = get("agr");
  const eq = get("eq");
  const uuidONulo = (k: string) => {
    const v = get(k);
    return esUuid(v) ? v : null;
  };
  // El mismo `solo` sirve a las dos pestañas: se interpreta según el catálogo de cada una.
  const pestana: Pestana = get("pestana") === "conciliacion" ? "conciliacion" : "flujo";
  return {
    pestana,
    genero: uuidONulo("genero"),
    mundo: uuidONulo("mundo"),
    linea: uuidONulo("linea"),
    agrupacion: uuidONulo("agrupacion"),
    solo: pestana === "flujo" && (SOLO_FLUJO as readonly string[]).includes(solo ?? "") ? (solo as SoloFlujo) : null,
    soloConciliacion: pestana === "conciliacion" && (SOLO_CONCILIACION as readonly string[]).includes(solo ?? "") ? (solo as SoloConciliacion) : null,
    mio: get("mio") === "1",
    fila: esUuid(gml) && esUuid(agr) ? { gml_id: gml, equivalencia_id: esUuid(eq) ? eq : null, agrupacion_marca_id: agr } : null,
    historia: (OPCIONES_HISTORIA as readonly number[]).includes(historia) ? (historia as MesesHistoria) : 3,
    periodo: esMes(get("periodo")) ? get("periodo") : null,
  };
}

export function consultaFlujo(p: ParametrosFlujo): string {
  const q = new URLSearchParams();
  if (p.pestana !== "flujo") q.set("pestana", p.pestana);
  if (p.genero) q.set("genero", p.genero);
  if (p.mundo) q.set("mundo", p.mundo);
  if (p.linea) q.set("linea", p.linea);
  if (p.agrupacion && p.pestana === "flujo") q.set("agrupacion", p.agrupacion);
  const solo = p.pestana === "flujo" ? p.solo : p.soloConciliacion;
  if (solo) q.set("solo", solo);
  if (p.mio) q.set("mio", "1");
  if (p.fila && p.pestana === "flujo") {
    q.set("gml", p.fila.gml_id);
    q.set("agr", p.fila.agrupacion_marca_id);
    if (p.fila.equivalencia_id) q.set("eq", p.fila.equivalencia_id);
  }
  if (p.historia !== 3) q.set("historia", String(p.historia));
  if (p.periodo && p.pestana === "conciliacion") q.set("periodo", p.periodo);
  return q.toString();
}

export function filtrosFlujo(p: ParametrosFlujo): FiltrosFlujo {
  return {
    genero_id: p.genero ?? undefined,
    mundo_id: p.mundo ?? undefined,
    linea_id: p.linea ?? undefined,
    agrupacion_marca_id: p.agrupacion ?? undefined,
    solo: p.solo ?? undefined,
    mio: p.mio || undefined,
  };
}

export function filtrosConciliacion(p: ParametrosFlujo): FiltrosConciliacion {
  return {
    periodo: p.periodo ?? undefined,
    genero_id: p.genero ?? undefined,
    mundo_id: p.mundo ?? undefined,
    linea_id: p.linea ?? undefined,
    solo: p.soloConciliacion ?? undefined,
    mio: p.mio || undefined,
  };
}

/**
 * Los filtros que reciben las hojas de Excel. El servidor ya filtró la lista, así que esto solo rotula la hoja `FILTROS` y es inocuo
 * al volver a filtrar, salvo en «Falta»: en el servidor incluye el quiebre y en la hoja no, de modo que ese chip no se manda.
 */
export function filtroExcelFlujo(p: ParametrosFlujo): FiltroExcelFlujo {
  return {
    genero_id: p.genero ?? undefined,
    mundo_id: p.mundo ?? undefined,
    agrupacion_marca_id: p.agrupacion ?? undefined,
    solo: p.solo === "falta" ? undefined : (p.solo ?? undefined),
    mio: p.mio || undefined,
  };
}

/** Códigos de error de «Aceptar sugerencia» que significan «lo que mirabas ya cambió»: la pantalla relee sola. */
export const CODIGOS_QUE_PIDEN_RECARGA: ReadonlySet<string> = new Set(["sugerencia_vencida", "compra_cambio", "excede_pendiente", "no_pertenece", "tipo_no_disponible", "fila_no_encontrada"]);

export const hayFiltros = (p: ParametrosFlujo): boolean =>
  p.genero !== null || p.mundo !== null || p.linea !== null || (p.pestana === "flujo" ? p.agrupacion !== null || p.solo !== null : p.soloConciliacion !== null) || p.mio;

export const ETIQUETA_SOLO_FLUJO: Record<SoloFlujo, string> = { falta: "Falta", exceso: "Exceso", quiebre: "Quiebre", por_confirmar: "Por confirmar" };
export const ETIQUETA_SOLO_CONCILIACION: Record<SoloConciliacion, string> = {
  sin_registrar: "Sin registrar",
  sin_respaldo: "Sin respaldo",
  entregas_vencidas: "Entregas vencidas",
  por_confirmar: "Por confirmar",
};

// ─── Opciones de los selectores (árbol de M1 y agrupaciones de marca) ───

export type NodoArbolSimple = { generoId: string; genero: string; mundoId: string; mundo: string; lineaId: string; linea: string };

export type OpcionId = { id: string; nombre: string };

/** Los nodos del árbol de M1 (género → mundo → línea) con sus ids, para los selectores. Un nodo con varias equivalencias es una sola línea. */
export function nodosDeArbol(arbol: ArbolRespuesta | null): NodoArbolSimple[] {
  if (!arbol) return [];
  return arbol.generos.flatMap((g) => g.mundos.flatMap((m) => m.lineas.map((l) => ({ generoId: g.id, genero: g.nombre, mundoId: m.id, mundo: m.nombre, lineaId: l.linea_id, linea: l.nombre }))));
}

const ordenar = (xs: OpcionId[]) => xs.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
const unicos = (pares: [string, string][]): OpcionId[] => ordenar([...new Map(pares).entries()].map(([id, nombre]) => ({ id, nombre })));

/** Género → mundo → línea en cascada: los mundos del género elegido y las líneas de ese género y mundo. */
export function opcionesArbol(nodos: readonly NodoArbolSimple[], p: Pick<ParametrosFlujo, "genero" | "mundo">) {
  const porGenero = nodos.filter((n) => p.genero === null || n.generoId === p.genero);
  const porMundo = porGenero.filter((n) => p.mundo === null || n.mundoId === p.mundo);
  return {
    generos: unicos(nodos.map((n) => [n.generoId, n.genero])),
    mundos: unicos(porGenero.map((n) => [n.mundoId, n.mundo])),
    lineas: unicos(porMundo.map((n) => [n.lineaId, n.linea])),
  };
}

// ─── Lista de filas ───

export type FilaDeLista = {
  clave: string;
  fila: FilaFlujoListaApi;
  genero: string;
  mundo: string;
  linea: string;
  /** Ids del nodo (el catálogo trae `linea_id` desde T3b); `null` si el catálogo no los trae. */
  generoId: string | null;
  mundoId: string | null;
  lineaId: string | null;
  equivalencia: string | null;
  agrupacion: string;
  /** Texto de ordenar y buscar. */
  ruta: string;
};

export const claveDeFila = (f: Pick<FilaFlujoListaApi, "gml_id" | "equivalencia_id" | "agrupacion_marca_id">): string => `${f.gml_id}|${f.equivalencia_id ?? ""}|${f.agrupacion_marca_id}`;

export function filasDeLista(filas: readonly FilaFlujoListaApi[], catalogo: CatalogoFlujoApi): FilaDeLista[] {
  return filas.map((fila) => {
    const nodo = catalogo.nodos[fila.equivalencia_id ?? fila.gml_id] ?? catalogo.nodos[fila.gml_id];
    const genero = nodo?.genero ?? "—";
    const mundo = nodo?.mundo ?? "—";
    const linea = nodo?.linea ?? "—";
    const equivalencia = nodo?.equivalencia ?? null;
    const agrupacion = catalogo.agrupaciones[fila.agrupacion_marca_id] ?? "—";
    return {
      clave: claveDeFila(fila),
      fila,
      genero,
      mundo,
      linea,
      generoId: nodo?.genero_id ?? null,
      mundoId: nodo?.mundo_id ?? null,
      lineaId: nodo?.linea_id ?? null,
      equivalencia,
      agrupacion,
      ruta: `${genero} · ${mundo} · ${linea}${equivalencia ? ` › ${equivalencia}` : ""}`,
    };
  });
}

// ─── Totales por género, mundo y línea (ficha 08 §4.3) ───

export type NivelGrupo = "genero" | "mundo" | "linea";
export const NIVELES_GRUPO: readonly NivelGrupo[] = ["genero", "mundo", "linea"];
export const ETIQUETA_NIVEL_GRUPO: Record<NivelGrupo, string> = { genero: "Por género", mundo: "Por mundo", linea: "Por línea" };

export type GrupoTotales = {
  clave: string;
  nombre: string;
  filas: number;
  /** Stock de la cadena al cierre de `k'` y, de él, el del CD. */
  stock: number;
  stockCd: number;
  /** IMI del grupo = stock ÷ suma de las ventas promedio de sus filas con curva; `null` si no hay venta. */
  imi: number | null;
  /** `Σ` del saldo de los próximos `N` meses y de lo que viene en camino. */
  saldo: number;
  enCamino: number;
  /** Filas en falta (con el quiebre) y en exceso, y filas sin curva (fuera del IMI, como en el total general). */
  enFalta: number;
  enExceso: number;
  sinCurva: number;
  porConfirmar: number;
};

/**
 * Totales por género, mundo o línea de las filas de la lista, sin pedir nada más a la API: salen de `resumen` y `stock_k` de cada fila.
 * Las filas sin curva no entran al IMI (igual que en el total general, §0.10); su stock sí cuenta en «Stock». El IMI usa la venta
 * promedio de cada fila (`vpm_k`, con un decimal), así que puede diferir en décimas del que daría el servidor para ese grupo.
 * Ordenados por saldo, de mayor a menor.
 */
export function totalesPorGrupo(filas: readonly FilaDeLista[], nivel: NivelGrupo): GrupoTotales[] {
  const grupos = new Map<string, GrupoTotales & { stockImi: number; vpm: number }>();
  for (const f of filas) {
    const g = nivel === "genero" ? { clave: f.generoId ?? f.genero, nombre: f.genero } : nivel === "mundo" ? { clave: `${f.generoId ?? f.genero}|${f.mundoId ?? f.mundo}`, nombre: `${f.genero} · ${f.mundo}` } : { clave: f.lineaId ?? `${f.generoId ?? f.genero}|${f.mundoId ?? f.mundo}|${f.linea}`, nombre: `${f.genero} · ${f.mundo} · ${f.linea}` };
    const t = grupos.get(g.clave) ?? { ...g, filas: 0, stock: 0, stockCd: 0, imi: null, saldo: 0, enCamino: 0, enFalta: 0, enExceso: 0, sinCurva: 0, porConfirmar: 0, stockImi: 0, vpm: 0 };
    const r = f.fila.resumen;
    t.filas += 1;
    t.stock += f.fila.stock_k.total;
    t.stockCd += f.fila.stock_k.cd;
    t.saldo += r.saldo_n_meses;
    t.enCamino += r.en_camino;
    t.porConfirmar += r.por_confirmar;
    if (r.senal === "falta" || r.senal === "quiebre") t.enFalta += 1;
    if (r.senal === "exceso") t.enExceso += 1;
    if (r.senal === "sin_curva") t.sinCurva += 1;
    else {
      t.stockImi += f.fila.stock_k.total;
      t.vpm += r.vpm_k ?? 0;
    }
    grupos.set(g.clave, t);
  }
  return [...grupos.values()]
    .map(({ stockImi, vpm, ...t }) => ({ ...t, imi: vpm > 0 ? stockImi / vpm : null }))
    .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, "es"));
}

export type ClaveOrden = "fila" | "estado" | "imi" | "saldo" | "stock" | "camino";
export type OrdenLista = { clave: ClaveOrden; dir: "asc" | "desc" };
export const ORDEN_INICIAL: OrdenLista = { clave: "saldo", dir: "desc" };

const PESO_ESTADO = { quiebre: 0, falta: 1, exceso: 2, al_dia: 3, sin_demanda: 4, sin_curva: 5 } as const;

export function ordenarLista(filas: readonly FilaDeLista[], orden: OrdenLista): FilaDeLista[] {
  const signo = orden.dir === "asc" ? 1 : -1;
  const valor = (f: FilaDeLista): number | string => {
    switch (orden.clave) {
      case "estado":
        return PESO_ESTADO[f.fila.resumen.senal];
      case "imi":
        return f.fila.resumen.imi_k ?? 0;
      case "saldo":
        return f.fila.resumen.saldo_n_meses;
      case "stock":
        return f.fila.stock_k.total;
      case "camino":
        return f.fila.resumen.en_camino;
      default:
        return f.ruta;
    }
  };
  // Sin IMI (sin demanda o sin curva) va siempre al final, sea cual sea el sentido.
  const sinImi = (f: FilaDeLista) => orden.clave === "imi" && f.fila.resumen.imi_k === null;
  return [...filas].sort((a, b) => {
    if (sinImi(a) !== sinImi(b)) return sinImi(a) ? 1 : -1;
    const va = valor(a);
    const vb = valor(b);
    const c = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb, "es") : Number(va) - Number(vb);
    return c * signo || a.ruta.localeCompare(b.ruta, "es") || a.agrupacion.localeCompare(b.agrupacion, "es");
  });
}

export function filtrarPorTexto(filas: readonly FilaDeLista[], texto: string): FilaDeLista[] {
  const t = texto.trim().toLocaleLowerCase("es");
  if (t === "") return [...filas];
  return filas.filter((f) => `${f.ruta} ${f.agrupacion}`.toLocaleLowerCase("es").includes(t));
}

// ─── Conciliación ───

/** Los meses que se pueden conciliar: `k'−11 … k'` (de reciente a antiguo). */
export function mesesConciliables(kPrima: string, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => sumarMes(kPrima, -i));
}

export const ETIQUETA_AVISO_MES: Record<string, string> = {
  sin_mes_anterior: "sin el stock del mes anterior (no se concilian)",
  salida_neta: "con salida neta (ajuste o devolución a proveedor)",
  ingreso_sin_registrar: "con ingreso sin registrar",
  recepcion_sin_respaldo: "con recepción sin respaldo",
  reclasificacion_probable: "con reclasificación probable",
};

// ─── Avisos de una fila (en castellano llano) ───

export const TEXTO_AVISO_FILA: Record<AvisoFila, string> = {
  intercompany_no_aplicable: "Hay una regla de intercompany que no aplica a esta fila.",
  sin_participaciones: "No hay participaciones de marca para separar el subflujo intercompany.",
  stock_negativo: "Hay tiendas con stock negativo: se suman y se truncan en cero por fila.",
  sin_curva: "Tiene venta anual proyectada pero sin curva de estacionalidad: no se calcula el IMI mes a mes y queda fuera del IMI total.",
  fila_sin_proyeccion: "Hay stock o compras en esta fila pero la proyección cerrada no tiene venta para ella (demanda 0).",
  entregas_vencidas: "Tiene entregas vencidas sin confirmar: el flujo las sigue esperando.",
  posible_doble_conteo: "El inventario publicado ya muestra un ingreso que puede ser de una entrega sin confirmar: posible doble conteo.",
  demanda_parcial_sin_curva: "Parte de su venta proyectada no tiene curva y no está mensualizada.",
  regla_cambia_en_horizonte: "Otra regla de intercompany entra antes del final del horizonte: el subflujo usa la vigente al empezar.",
  regla_futura: "La regla de intercompany empieza después del primer mes del horizonte: todavía no hay subflujo.",
};

/** Etiqueta corta para la lista. */
export const ETIQUETA_CORTA_AVISO_FILA: Record<AvisoFila, string> = {
  intercompany_no_aplicable: "Intercompany no aplica",
  sin_participaciones: "Sin participaciones",
  stock_negativo: "Stock negativo",
  sin_curva: "Sin curva",
  fila_sin_proyeccion: "Sin proyección",
  entregas_vencidas: "Entregas vencidas",
  posible_doble_conteo: "Posible doble conteo",
  demanda_parcial_sin_curva: "Venta sin curva (parcial)",
  regla_cambia_en_horizonte: "Regla cambia",
  regla_futura: "Regla futura",
};

/** La columna «Diferencia» de la conciliación: lo que llegó y no se registró, lo registrado que no llegó, o que cuadra. */
export function diferenciaConciliacion(f: Pick<ConciliacionFilaApi, "ingreso_inferido" | "salida_inferida" | "sin_registrar" | "sin_respaldo" | "avisos">): { texto: string; tono: "alerta" | "exito" | "suave" } {
  if (f.ingreso_inferido === null) return { texto: "—", tono: "suave" };
  if ((f.salida_inferida ?? 0) > 0) return { texto: `−${unidades(f.salida_inferida ?? 0)} salida neta`, tono: "alerta" };
  if (f.sin_registrar > 0) return { texto: `+${unidades(f.sin_registrar)} sin registrar`, tono: f.avisos.includes("ingreso_sin_registrar") ? "alerta" : "suave" };
  if (f.sin_respaldo > 0) return { texto: `−${unidades(f.sin_respaldo)} sin respaldo`, tono: f.avisos.includes("recepcion_sin_respaldo") ? "alerta" : "suave" };
  return { texto: "cuadra", tono: "exito" };
}

/** Qué tan lejos queda lo observado de lo que dice la regla de intercompany (en puntos): hasta 10 se considera cerca. */
export const TOLERANCIA_PCT_DIRECTO = 10;
