import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { avanceAcumulado } from "./cierre";
import type { FilaPlana } from "./matriz";
import {
  vigenteDe,
  type AnioFilaApi,
  type AvisoFila,
  type CurvaOrigen,
  type DecisionPrevia,
  type DecisionTiendaPrevia,
  type FilaApi,
  type FilaModelo,
  type HistoricoFila,
  type Metodo,
  type OrigenComposicion,
  type OrigenDecision,
  type OrigenMes,
  type Participaciones,
  type PreviasCalculo,
  type RegistroModelo,
  type Subbloque,
  type TiendaModelo,
} from "./tipos";

/**
 * Del modelo a las filas de la base y de vuelta (ficha 07, sección 6). Puro: sin cliente de Supabase; solo los tipos de las
 * tablas. Es el único lugar donde se afirma la forma de los `jsonb` (`como…`), porque los escribe este mismo código.
 */

export type FilaDb = Tables<"proyeccion_filas">;
export type AnioDb = Tables<"proyeccion_fila_anios">;
export type TiendaPyDb = Tables<"proyeccion_tiendas">;
export type FilaConAnios = FilaDb & { proyeccion_fila_anios: AnioDb[] };

export const comoJson = (v: unknown): Json => v as Json;
const comoLista = <T>(json: Json | null | undefined): T[] => (Array.isArray(json) ? (json as unknown as T[]) : []);

const METODOS: readonly Metodo[] = ["avance", "plan_anterior", "crecimiento", "apertura", "avance_propio", "maduro_propio", "cierre", "sin_propuesta"];
const metodoDe = (v: string): Metodo => ((METODOS as readonly string[]).includes(v) ? (v as Metodo) : "sin_propuesta");
const origenDe = (v: string | null): OrigenDecision | null => (v === "propuesta" || v === "manual" || v === "escalada" ? v : null);
const subbloqueDe = (v: string | null): Subbloque | null => (v === "nuevas_anterior" || v === "aperturas" ? v : null);
const bloqueDe = (v: string): "mismas" | "nuevas" | "cierres" => (v === "nuevas" || v === "cierres" ? v : "mismas");
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

// ─── Registro por año ───

/** `proyeccion_fila_anios` → registro (con `vigente` y `avance` derivados). `k` es el último mes cerrado de la proyección. */
export function aRegistro(a: AnioDb, curva: readonly number[] | null, k: number, anioEnCurso: number): RegistroModelo {
  const decidido = a.decidido;
  const vigente = vigenteDe(decidido, a.propuesto);
  const avance = a.bloque === "mismas" && a.anio === anioEnCurso && curva ? avanceAcumulado(curva, k) : null;
  return {
    anio: a.anio,
    bloque: bloqueDe(a.bloque),
    subbloque: subbloqueDe(a.subbloque),
    vendido: a.vendido,
    propuesto: a.propuesto,
    metodo: metodoDe(a.metodo),
    referencia_alternativa: a.referencia_alternativa,
    referencia_tres_meses: a.referencia_tres_meses,
    explicacion: a.explicacion,
    crecimiento_pct: num(a.crecimiento_pct),
    decidido,
    origen: origenDe(a.origen),
    propuesta_al_decidir: a.propuesta_al_decidir,
    vigente,
    nota: a.nota,
    decidido_por_nombre: a.decidido_por_nombre,
    decidido_at: a.decidido_at,
    meses: a.meses,
    meses_propuestos: a.meses_propuestos,
    origen_meses: a.origen_meses === null ? null : a.origen_meses.map((o): OrigenMes => (o === "real" ? "real" : "proyectado")),
    avance,
    avisos: comoLista<AvisoFila>(a.avisos),
    id: a.id,
    curva_origen_usada: comoLista<CurvaOrigen>(a.curva_origen_usada),
    curva_origen_propuesta: a.curva_origen_propuesta === null ? null : comoLista<CurvaOrigen>(a.curva_origen_propuesta),
  };
}

/** `proyeccion_filas` + sus años → fila del modelo. */
export function aFilaModelo(f: FilaConAnios, k: number, anioEnCurso: number): FilaModelo {
  const curva = f.curva === null ? null : comoLista<number>(f.curva).map(Number);
  return {
    clave: f.clave,
    tienda_id: f.tienda_id,
    gml_id: f.gml_id,
    equivalencia_id: f.equivalencia_id,
    agrupacion_marca_id: f.agrupacion_marca_id,
    nivel: f.nivel_proyectado === "GMLE" ? "GMLE" : "GML",
    agrupacion_estacionalidad_id: f.agrupacion_estacionalidad_id,
    temporada: f.temporada,
    curva,
    curva_origen: comoLista<CurvaOrigen>(f.curva_origen),
    factores_mes: f.factores_mes === null ? null : (f.factores_mes as unknown as Record<number, number[]>),
    historico: f.historico === null || typeof f.historico !== "object" ? null : (f.historico as unknown as HistoricoFila),
    participaciones: f.participaciones === null ? null : (f.participaciones as unknown as Participaciones),
    composicion: f.composicion === null ? null : (f.composicion as unknown as { origen: OrigenComposicion; s: number; p: number; unidades_maduras: number }),
    avisos: comoLista<AvisoFila>(f.avisos),
    activo: f.activo,
    registros: [...f.proyeccion_fila_anios]
      .sort((x, y) => x.anio - y.anio)
      .map((a) => aRegistro(a, curva, k, anioEnCurso)),
  };
}

/** Fila nueva o actualizada del cálculo (sin tocar nada de las decisiones: viven en `proyeccion_fila_anios`). */
export function payloadFila(proyeccionId: string, f: FilaModelo): TablesInsert<"proyeccion_filas"> {
  return {
    proyeccion_id: proyeccionId,
    clave: f.clave,
    tienda_id: f.tienda_id,
    gml_id: f.gml_id,
    equivalencia_id: f.equivalencia_id,
    agrupacion_marca_id: f.agrupacion_marca_id,
    nivel_proyectado: f.nivel,
    agrupacion_estacionalidad_id: f.agrupacion_estacionalidad_id,
    temporada: f.temporada,
    curva: f.curva === null ? null : comoJson(f.curva),
    curva_origen: comoJson(f.curva_origen),
    factores_mes: f.factores_mes === null ? null : comoJson(f.factores_mes),
    historico: comoJson(f.historico ?? {}),
    participaciones: f.participaciones === null ? null : comoJson(f.participaciones),
    composicion: f.composicion === null ? null : comoJson(f.composicion),
    avisos: comoJson(f.avisos),
    activo: true,
  };
}

/**
 * Registro del cálculo para `upsert`: NUNCA incluye `decidido`, `origen`, `nota`, `propuesta_al_decidir`, `decidido_*` ni
 * `crecimiento_pct` (lo decidido por el planner sobrevive a cualquier recálculo; el `upsert` solo escribe las columnas que
 * recibe). Sí lleva `meses`, `meses_propuestos` y las versiones de curva, que `armarRegistro` ya dejó conciliadas.
 */
export function payloadAnioCalculo(filaId: string, r: RegistroModelo, avisosExtra: AvisoFila[] = []): TablesInsert<"proyeccion_fila_anios"> {
  const avisos = [...new Set([...r.avisos, ...avisosExtra])];
  return {
    fila_id: filaId,
    anio: r.anio,
    bloque: r.bloque,
    subbloque: r.subbloque,
    vendido: r.vendido,
    propuesto: r.propuesto,
    metodo: r.metodo,
    referencia_alternativa: r.referencia_alternativa,
    referencia_tres_meses: r.referencia_tres_meses,
    explicacion: r.explicacion,
    meses: r.meses,
    origen_meses: r.origen_meses,
    curva_origen_usada: comoJson(r.curva_origen_usada),
    meses_propuestos: r.meses_propuestos,
    curva_origen_propuesta: r.curva_origen_propuesta === null ? null : comoJson(r.curva_origen_propuesta),
    avisos: comoJson(avisos),
    activo: true,
  };
}

/** Registro completo (con decisión) para las decisiones en vivo. */
export function payloadAnioDecision(filaId: string, r: RegistroModelo, decididoPorId: string | null | undefined): TablesInsert<"proyeccion_fila_anios"> {
  return {
    ...payloadAnioCalculo(filaId, r),
    crecimiento_pct: r.crecimiento_pct,
    decidido: r.decidido,
    origen: r.origen,
    propuesta_al_decidir: r.propuesta_al_decidir,
    nota: r.nota,
    decidido_at: r.decidido_at,
    // `undefined` deja la columna como está (el registro lo decidió otra persona antes).
    ...(r.decidido === null ? { decidido_por_id: null } : decididoPorId === undefined ? {} : { decidido_por_id: decididoPorId }),
    decidido_por_nombre: r.decidido_por_nombre,
  };
}

// ─── Tiendas ───

export function aTiendaModelo(t: TiendaPyDb): TiendaModelo {
  return {
    tienda_id: t.tienda_id,
    anio: t.anio,
    bloque: t.bloque === "cierres" ? "cierres" : "nuevas",
    subbloque: subbloqueDe(t.subbloque),
    fecha_usada: t.fecha_usada,
    venta_esperada_usada: num(t.venta_esperada_usada),
    referente_id_usado: t.referente_id_usado,
    origen_composicion: t.origen_composicion === "referente" || t.origen_composicion === "propia" ? t.origen_composicion : "red",
    rampa: comoLista<number>(t.rampa).map(Number),
    unidades_maduras: t.unidades_maduras,
    vendido: t.vendido,
    propuesto: t.propuesto,
    metodo: metodoDe(t.metodo),
    decidido: t.decidido,
    origen: t.origen === "propuesta" || t.origen === "manual" ? t.origen : null,
    propuesta_al_decidir: t.propuesta_al_decidir,
    nota: t.nota,
    decidido_por_nombre: t.decidido_por_nombre,
    decidido_at: t.decidido_at,
    explicacion: t.explicacion,
    referencia_alternativa: t.referencia_alternativa,
    referencia_tres_meses: t.referencia_tres_meses,
    avisos: comoLista<AvisoFila>(t.avisos),
  };
}

/** Para `upsert` del cálculo: sin las columnas de decisión (sobreviven). */
export function payloadTiendaCalculo(proyeccionId: string, t: TiendaModelo, soloRampaPrevia: boolean): TablesInsert<"proyeccion_tiendas"> {
  return {
    proyeccion_id: proyeccionId,
    tienda_id: t.tienda_id,
    anio: t.anio,
    bloque: t.bloque,
    subbloque: t.subbloque,
    fecha_usada: t.fecha_usada,
    venta_esperada_usada: t.venta_esperada_usada,
    referente_id_usado: t.referente_id_usado,
    origen_composicion: t.origen_composicion,
    ...(soloRampaPrevia ? {} : { rampa: comoJson(t.rampa) }),
    unidades_maduras: t.unidades_maduras,
    vendido: t.vendido,
    propuesto: t.propuesto,
    metodo: t.metodo,
    explicacion: t.explicacion,
    referencia_alternativa: t.referencia_alternativa,
    referencia_tres_meses: t.referencia_tres_meses,
    avisos: comoJson(t.avisos),
    activo: true,
  };
}

/** Tienda con su decisión y su rampa (al copiar las decisiones de otra proyección). */
export function payloadTiendaDecision(proyeccionId: string, t: TiendaModelo): TablesInsert<"proyeccion_tiendas"> {
  return {
    ...payloadTiendaCalculo(proyeccionId, t, false),
    decidido: t.decidido,
    origen: t.origen,
    propuesta_al_decidir: t.propuesta_al_decidir,
    nota: t.nota,
    decidido_at: t.decidido_at,
    decidido_por_nombre: t.decidido_por_nombre,
  };
}

// ─── Decisiones previas ───

/**
 * Las decisiones guardadas, listas para `calcularProyeccion`: de las filas base cualquier registro con decisión o con
 * crecimiento propio; de las filas de tienda, las cifras fijadas a mano; de las tiendas, el total decidido y la rampa.
 */
export function aPrevias(filas: readonly FilaConAnios[], tiendas: readonly TiendaPyDb[]): PreviasCalculo {
  const f = new Map<string, DecisionPrevia>();
  for (const fila of filas) {
    for (const a of fila.proyeccion_fila_anios) {
      const decidido = a.decidido !== null;
      const crecimiento = num(a.crecimiento_pct);
      if (!decidido && crecimiento === null) continue;
      if (fila.tienda_id !== null && !(decidido && a.origen === "manual")) continue;
      f.set(`${fila.clave}#${a.anio}`, {
        decidido: a.decidido,
        origen: origenDe(a.origen),
        nota: a.nota,
        propuesta_al_decidir: a.propuesta_al_decidir,
        crecimiento_pct: crecimiento,
        decidido_por_nombre: a.decidido_por_nombre,
        decidido_at: a.decidido_at,
        meses: a.meses,
        curva_origen_usada: comoLista<CurvaOrigen>(a.curva_origen_usada),
      });
    }
  }
  const t = new Map<string, DecisionTiendaPrevia>();
  for (const x of tiendas) {
    t.set(`${x.tienda_id}#${x.anio}`, {
      decidido: x.decidido,
      origen: x.origen === "propuesta" || x.origen === "manual" ? x.origen : null,
      nota: x.nota,
      propuesta_al_decidir: x.propuesta_al_decidir,
      rampa: comoLista<number>(x.rampa).map(Number),
      decidido_por_nombre: x.decidido_por_nombre,
      decidido_at: x.decidido_at,
    });
  }
  return { filas: f, tiendas: t };
}

// ─── A la API ───

export type NombresNodo = { genero_id: string; mundo_id: string; linea_id: string; genero: string; mundo: string; linea: string; equivalencias: Map<string, string> };

export type Catalogo = {
  nodos: ReadonlyMap<string, NombresNodo>;
  agrupacionesMarca: ReadonlyMap<string, string>;
  agrupacionesEstacionalidad: ReadonlyMap<string, { nombre: string; temporada: string }>;
};

export const aAnioApi = (r: RegistroModelo): AnioFilaApi => {
  const { curva_origen_usada: _usada, curva_origen_propuesta: _propuesta, ...api } = r;
  void _usada;
  void _propuesta;
  return api;
};

function agrupacionDeFila(f: Pick<FilaDb, "agrupacion_estacionalidad_id">, c: Catalogo) {
  if (!f.agrupacion_estacionalidad_id) return null;
  const a = c.agrupacionesEstacionalidad.get(f.agrupacion_estacionalidad_id);
  return a ? { id: f.agrupacion_estacionalidad_id, nombre: a.nombre, temporada: a.temporada } : null;
}

type DatosNodo = NombresNodo & { nivel: "GML" | "GMLE" };

function nombresDe(f: Pick<FilaDb, "gml_id" | "equivalencia_id" | "agrupacion_marca_id" | "nivel_proyectado">, c: Catalogo): (DatosNodo & { equivalencia: string | null; agrupacion_marca: string }) | null {
  const n = c.nodos.get(f.gml_id);
  if (!n) return null;
  return {
    ...n,
    nivel: f.nivel_proyectado === "GMLE" ? "GMLE" : "GML",
    equivalencia: f.equivalencia_id ? (n.equivalencias.get(f.equivalencia_id) ?? null) : null,
    agrupacion_marca: c.agrupacionesMarca.get(f.agrupacion_marca_id) ?? "—",
  };
}

/** Fila aplanada para la matriz, la mensual y el contrato de M8 (sin `historico`). */
export function aFilaPlana(f: FilaConAnios, c: Catalogo, k: number, anioEnCurso: number, conParticipaciones = false): FilaPlana | null {
  const n = nombresDe(f, c);
  if (!n) return null;
  return {
    id: f.id,
    tienda_id: f.tienda_id,
    gml_id: f.gml_id,
    equivalencia_id: f.equivalencia_id,
    agrupacion_marca_id: f.agrupacion_marca_id,
    nivel: n.nivel,
    genero: n.genero,
    mundo: n.mundo,
    linea: n.linea,
    genero_id: n.genero_id,
    mundo_id: n.mundo_id,
    linea_id: n.linea_id,
    equivalencia: n.equivalencia,
    agrupacion_marca: n.agrupacion_marca,
    agrupacion_estacionalidad: agrupacionDeFila(f, c),
    avisos: comoLista<AvisoFila>(f.avisos),
    activo: f.activo,
    participaciones: conParticipaciones && f.participaciones !== null ? (f.participaciones as unknown as Participaciones) : null,
    anios: f.proyeccion_fila_anios
      .filter((a) => a.activo)
      .sort((x, y) => x.anio - y.anio)
      .map((a) => {
        const r = aRegistro(a, null, k, anioEnCurso);
        return { ...aAnioApi(r), curva_origen_usada: r.curva_origen_usada };
      }),
  };
}

/** Fila de la API con sus años (`historico_anual` solo si se pide con `historico`). */
export function aFilaApi(f: FilaConAnios, c: Catalogo, k: number, anioEnCurso: number): FilaApi | null {
  const n = nombresDe(f, c);
  if (!n) return null;
  const modelo = aFilaModelo(f, k, anioEnCurso);
  return {
    id: f.id,
    tienda_id: f.tienda_id,
    gml_id: f.gml_id,
    equivalencia_id: f.equivalencia_id,
    agrupacion_marca_id: f.agrupacion_marca_id,
    nivel: n.nivel,
    genero: n.genero,
    mundo: n.mundo,
    linea: n.linea,
    equivalencia: n.equivalencia,
    agrupacion_marca: n.agrupacion_marca,
    agrupacion_estacionalidad: agrupacionDeFila(f, c),
    historico_anual: (modelo.historico?.anios ?? []).map((a) => ({
      anio: a.anio,
      unidades: a.total,
      clase: a.clase,
      completo: a.anio < anioEnCurso || k === 12,
      tiendas: a.tiendas.length,
    })),
    anios: modelo.registros.filter((r) => f.proyeccion_fila_anios.find((a) => a.anio === r.anio)?.activo !== false).map(aAnioApi),
    avisos: modelo.avisos,
    activo: f.activo,
  };
}
