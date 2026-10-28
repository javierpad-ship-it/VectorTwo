import { NextResponse } from "next/server";
import { indexarNodos } from "@/lib/arbol/nivel/indice";
import { aplicarCancelacion } from "@/lib/compras/cancelar";
import { aplicarQuitarRecepcion, aplicarRecepciones } from "@/lib/compras/recepciones";
import { recalcularModelo, type ModeloCompra } from "@/lib/compras/reglas";
import type { EstadoCompra, RecepcionNueva } from "@/lib/compras/tipos";
import type { StockFlujoJson } from "@/lib/flujo/tipos";
import { construirConfigFlujo } from "@/lib/marcas/gml/flujo";
import { huellaFlujo } from "@/lib/marcas-barrer/huellas";
import type { RepartosVigentesApi } from "@/lib/marcas-barrer/tipos-api";
import type { Rol } from "@/lib/auth/roles";
import {
  AGR_M8,
  COMPRA,
  K_PRIMA,
  LINEA,
  MARCA_M8,
  NODO_M8,
  PERFIL,
  PROVEEDOR,
  registrosC09,
  registrosC12,
  registrosC20Lote,
  type RegistrosCompra,
} from "./compras.fixture";
import { BETA_V2, EQ_M8, GAMMA_V1, TIENDA_M8, estadoImportacionBase } from "./compras.estado.fixture";
import { cerradaDeFila, DEMANDA_CASO1 } from "./flujo.soporte";

/**
 * Doble de base de las pruebas de los handlers de M8 (T3b): una base en memoria con las tablas de compras, `flujo_parametros` y las
 * funciones `rpc` de `0025` (`flujo_huella_base`, `stock_flujo` y las cuatro de escritura, que usan los espejos puros de
 * `src/lib/compras/*` para validar, recalcular y armar el evento). Más el guard falso y las fuentes que el flujo lee de M7, M12, M13 y
 * 02b (se simulan en el módulo de cada servicio). Todo inventado: cifras de la ficha 08 (casos 1, 4, 9b y 13).
 *
 * El escenario: DENIM × RECONOCIDO (stock set 700, venta set 1 410, ago 1 990 → ingreso inferido 120) y POLO × PREMIUM (stock set 940,
 * venta set 820, ago 960 → ingreso inferido 800, con C-000008 recibida por 300 y la entrega de set de C-000009 por 500 vencida: la
 * sugerencia de «Aceptar sugerencia»). `k' = 2026-09`, «hoy» 2026-10-15; doce meses publicados de set-2025 a set-2026 (13 con ago).
 */

export type Fila = Record<string, unknown>;
type ErrorRpc = { code: string; message: string; details: null; hint: null };

export const EQ_URBANO = "e0000000-0000-4000-8000-000000000a01";
export const EQ_POLO = "e0000000-0000-4000-8000-000000000a02";
export const CERRADA_ID = "c1000000-0000-4000-8000-000000000001";

export const PERFILES = {
  planner: { id: PERFIL.planner, email: "planner@ejemplo.pe", nombre: "Planner Uno", rol: "planner" as Rol },
  comprador1: { id: PERFIL.comprador1, email: "c1@ejemplo.pe", nombre: "Comprador Uno", rol: "comprador" as Rol },
  comprador2: { id: PERFIL.comprador2, email: "c2@ejemplo.pe", nombre: "Comprador Dos", rol: "comprador" as Rol },
};

const uuid = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** C-000008 (Proveedor Norte): POLO por agrupación PREMIUM · 300, entrega y ingreso de set-2026 ya confirmados (las `recepciones` de POLO en set). */
export function registrosC08(): RegistrosCompra {
  const compra = uuid("4", 8);
  const linea = uuid("3", 8);
  return {
    compras: [{ id: compra, numero: "C-000008", proveedor_id: PROVEEDOR.norte, proveedor_nombre: "Proveedor Norte", origen: "comprador", estado: "recibida", fecha_compra: "2026-08-05", moneda: "PEN", cancelada_at: null, revision: 2 }],
    lineas: [
      {
        id: linea,
        compra_id: compra,
        tipo: "especifica",
        genero_mundo_linea_id: NODO_M8.polo,
        equivalencia_id: null,
        marca_id: null,
        agrupacion_marca_id: AGR_M8.premium,
        tallas: "ambas",
        unidades: 300,
        unidades_recibidas: 300,
        unidades_canceladas: 0,
        costo_unitario: 20,
        destino: "cd",
        tienda_id: null,
        alcance: {},
        activo: true,
      },
    ],
    entregas: [{ id: uuid("e", 800), linea_id: linea, periodo: "2026-09", unidades: 300, origen: "manual" }],
    repartos: [],
    recepciones: [{ id: uuid("a", 800), linea_id: linea, recibida_periodo: "2026-09", unidades: 300, fecha_recepcion: "2026-09-15", origen: "manual" }],
  };
}

export const IDS = { compraC08: uuid("4", 8), lineaC08: uuid("3", 8), entregaC09: uuid("e", 900), entregaC12: uuid("e", 1200), entregaC20: uuid("e", 2000), recepcionC08: uuid("a", 800) };

// ─── Estado mutable del escenario ───

type Escenario = {
  tablas: Record<string, Fila[]>;
  usuario: { rol: Rol | "sin_sesion"; perfil: typeof PERFILES.planner };
  /** Llamadas a `rpc`, en orden. */
  llamadas: { nombre: string; args: Record<string, unknown> }[];
  /** Lecturas reales de M7 (`leerCerradaParaFlujo`), M12 (`leerRepartosVigentes`) y M13 (`leerVigentes`). */
  lecturas: { cerrada: number; repartos: number; reglas: number; configuracion: number };
  /** `[n, max(updated_at)]` de cada tabla de configuración en `flujo_huella_base()`. */
  config: Record<string, [number, string | null]>;
  /** Cambia la modalidad de BETA: la configuración de marcas de HOY deja de coincidir con la de la cerrada. */
  betaMixta: boolean;
  /** Asignaciones género × mundo (M1b). */
  asignaciones: { genero_id: string; mundo_id: string; perfil_id: string; activo: boolean }[];
  /** Hace fallar la N-ésima llamada a `importar_compra` (1-based) con un error de la base. */
  fallarImportacion: number | null;
  /** Devuelve `true` para que `importar_compra` de esa compra responda `clave_existente` (carrera con otra importación). */
  claveExistente: ((referencia: string) => boolean) | null;
  contadorId: number;
  contadorNumero: number;
  reloj: number;
  /** Meses publicados (`aaaa-mm`). */
  publicados: string[];
  /** `true`: `flujo_huella_base()` no trae ninguna proyección cerrada (el flujo responde `404 sin_cerrada`). */
  sinCerrada: boolean;
  /** `true`: `stock_flujo` devuelve stock y venta de tiendas desactivadas en `excluido` (lo que hace la base tras desactivar una tienda). */
  tiendasInactivas: boolean;
};

export const escenario: Escenario = {
  tablas: {},
  usuario: { rol: "planner", perfil: PERFILES.planner },
  llamadas: [],
  lecturas: { cerrada: 0, repartos: 0, reglas: 0, configuracion: 0 },
  config: {},
  betaMixta: false,
  asignaciones: [],
  fallarImportacion: null,
  claveExistente: null,
  contadorId: 1,
  contadorNumero: 100,
  reloj: 0,
  publicados: [],
  sinCerrada: false,
  tiendasInactivas: false,
};

const mesesDe = (desde: string, hasta: string): string[] => {
  const salida: string[] = [];
  let [a, m] = desde.split("-").map(Number);
  for (;;) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    salida.push(mes);
    if (mes === hasta) return salida;
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
};

const sello = () => new Date(Date.UTC(2026, 9, 15, 12, 0, 0) + escenario.reloj++ * 1000).toISOString();
const nuevoId = () => uuid("b", escenario.contadorId++);
const tabla = (nombre: string): Fila[] => (escenario.tablas[nombre] ??= []);

export const idCarga = (mes: string) => uuid("5", Number(mes.replace("-", "")));

/** Publica un mes en la base falsa (`cargas_venta_stock`). */
export function publicarMes(mes: string): void {
  if (escenario.publicados.includes(mes)) return;
  escenario.publicados.push(mes);
  tabla("cargas_venta_stock").push({ id: idCarga(mes), periodo: `${mes}-01`, estado: "publicada", publicada_at: `${mes}-28T10:00:00.000Z` });
}

// ─── Filas de la base a partir de los registros de los fixtures ───

function filasDeRegistros(reg: RegistrosCompra): void {
  for (const c of reg.compras) {
    tabla("compras").push({
      id: c.id,
      numero: c.numero,
      proveedor_id: c.proveedor_id,
      origen: c.origen,
      estado: c.estado,
      fecha_compra: c.fecha_compra,
      referencia: c.numero === "C-000012" ? "PO-2211" : null,
      moneda: c.moneda,
      nota: null,
      confirmada_at: c.estado === "borrador" ? null : `${c.fecha_compra}T10:05:00.000Z`,
      confirmada_por_id: PERFIL.planner,
      confirmada_por_nombre: "Planner Uno",
      cancelada_at: c.cancelada_at,
      cancelada_por_id: null,
      cancelada_por_nombre: c.cancelada_at ? "Planner Uno" : null,
      motivo_cancelacion: c.cancelada_at ? "El proveedor no entrega el saldo" : null,
      justificacion_exceso: null,
      excede_tope_al_confirmar: [],
      perfil_id: PERFIL.planner,
      usuario_nombre: "Planner Uno",
      revision: c.revision,
      updated_by_id: null,
      updated_by_nombre: "Planner Uno",
      activo: true,
      created_at: `${c.fecha_compra}T10:02:00.000Z`,
      updated_at: `${c.fecha_compra}T11:40:00.000Z`,
    });
  }
  for (const l of reg.lineas) {
    const primera = reg.entregas.filter((e) => e.linea_id === l.id).map((e) => e.periodo).sort()[0] ?? "2026-09";
    tabla("compra_lineas").push({
      ...l,
      llegada_periodo: `${primera}-01`,
      clave_importacion: null,
      huella_importacion: null,
      nota: null,
      avisos: [],
      created_at: "2026-10-14T10:02:00.000Z",
      updated_at: "2026-10-14T10:02:00.000Z",
    });
  }
  for (const e of reg.entregas) tabla("compra_linea_entregas").push({ ...e, periodo: `${e.periodo}-01`, activo: true, created_at: "2026-10-14T10:02:00.000Z", updated_at: "2026-10-14T10:02:00.000Z" });
  for (const r of reg.repartos) tabla("compra_linea_repartos").push({ id: nuevoId(), ...r, activo: true, created_at: "2026-10-14T10:02:00.000Z", updated_at: "2026-10-14T10:02:00.000Z" });
  for (const r of reg.recepciones) {
    tabla("compra_linea_recepciones").push({
      ...r,
      recibida_periodo: `${r.recibida_periodo}-01`,
      nota: null,
      perfil_id: PERFIL.planner,
      usuario_nombre: "Planner Uno",
      activo: true,
      created_at: "2026-10-14T10:03:00.000Z",
      updated_at: "2026-10-14T10:03:00.000Z",
    });
  }
}

/** Siembra las compras de los fixtures en la base falsa (sin historial: los eventos de las pruebas nacen de las funciones). */
export function sembrar(...partes: RegistrosCompra[]): void {
  for (const p of partes) filasDeRegistros(p);
}

export function reiniciarEscenario(opciones: { sembrar?: boolean } = {}): void {
  escenario.tablas = {};
  escenario.usuario = { rol: "planner", perfil: PERFILES.planner };
  escenario.llamadas = [];
  escenario.lecturas = { cerrada: 0, repartos: 0, reglas: 0, configuracion: 0 };
  escenario.config = {
    marcas: [9, "2026-01-01T00:00:00.000Z"],
    marca_gml_especial: [0, null],
    agrupaciones_marca: [3, "2026-01-01T00:00:00.000Z"],
    genero_mundo_linea: [6, "2026-01-01T00:00:00.000Z"],
    equivalencias: [7, "2026-01-01T00:00:00.000Z"],
    tiendas: [4, "2026-01-01T00:00:00.000Z"],
    responsables_genero_mundo: [2, "2026-01-01T00:00:00.000Z"],
  };
  escenario.betaMixta = false;
  escenario.tiendasInactivas = false;
  escenario.asignaciones = [{ genero_id: estadoImportacionBase().nodos[0].genero_id, mundo_id: estadoImportacionBase().nodos[0].mundo_id, perfil_id: PERFIL.comprador1, activo: true }];
  escenario.fallarImportacion = null;
  escenario.claveExistente = null;
  escenario.contadorId = 1;
  escenario.contadorNumero = 100;
  escenario.reloj = 0;
  escenario.publicados = [];
  escenario.sinCerrada = false;
  for (const mes of mesesDe("2025-09", K_PRIMA)) publicarMes(mes);
  tabla("proveedores").push(
    { id: PROVEEDOR.norte, codigo: "PN", nombre: "Proveedor Norte", pais: "Perú", ciudad: "Lima", identificacion: null, es_intercompany: false, nota: null, activo: true, perfil_id: null, usuario_nombre: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    { id: PROVEEDOR.feria, codigo: null, nombre: "Feria Sur", pais: null, ciudad: null, identificacion: null, es_intercompany: false, nota: null, activo: true, perfil_id: null, usuario_nombre: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }
  );
  if (opciones.sembrar !== false) sembrar(registrosC12(), registrosC09(), registrosC08(), registrosC20Lote());
}

// ─── Guard falso ───

export function guardFalso() {
  const rechazo = (mensaje: string, status: number) => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: mensaje }, { status }) });
  const requireUser = async () => {
    if (escenario.usuario.rol === "sin_sesion") return rechazo("No autenticado.", 401);
    return { user: {}, perfil: escenario.usuario.perfil, rol: escenario.usuario.rol, response: null };
  };
  return {
    requireUser,
    requirePlanner: async () => {
      const r = await requireUser();
      if (r.response) return r;
      if (r.rol === "comprador") return rechazo("Tu rol es de solo lectura.", 403);
      return r;
    },
  };
}

// ─── Fuentes de M7, M12, M13 y 02b ───

/** Las filas de la cerrada del escenario: DENIM × RECONOCIDO (caso 1) y POLO × PREMIUM (100 por mes). */
export function filasCerrada() {
  return [
    ...cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: DEMANDA_CASO1 }),
    ...cerradaDeFila({ gml: NODO_M8.polo, agr: AGR_M8.premium, demanda: Array.from({ length: 15 }, () => 100) }),
  ];
}

const marcasLeidas = () => {
  const e = estadoImportacionBase();
  return e.marcas.map((m) => {
    const mixta = m.id === MARCA_M8.beta && escenario.betaMixta;
    const efectiva = mixta ? "mixta" : m.modalidad_efectiva;
    return {
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      activo: m.activo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      conjunto_marca_id: m.conjunto_marca_id,
      tratamiento_especial: efectiva !== null,
      modalidad_tratamiento: efectiva === null ? null : efectiva === "barrido" ? "barrido" : "por_gml",
      resto_al_barrer: efectiva === "mixta",
      nota_tratamiento: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      agrupacion_marca: null,
    };
  });
}

export const equivalenciasDelEscenario = () => [
  ...estadoImportacionBase().equivalencias.map((e) => ({ ...e, agrupacion_estacionalidad_id: null })),
  { id: EQ_URBANO, genero_mundo_linea_id: NODO_M8.urbano, codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true, activo: true, agrupacion_estacionalidad_id: null },
  { id: EQ_POLO, genero_mundo_linea_id: NODO_M8.polo, codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true, activo: true, agrupacion_estacionalidad_id: null },
];

/** Lo que devuelve `cargarEstadoGml`: marcas, agrupaciones y árbol del escenario. */
export function estadoGmlFalso() {
  const e = estadoImportacionBase();
  const arbol = { generos: e.generos, mundos: e.mundos, lineas: e.lineas, nodos: e.nodos.map((n) => ({ ...n })) };
  const marcas = marcasLeidas();
  return {
    estado: {
      marcas,
      agrupaciones: e.agrupaciones.map((a) => ({ id: a.id, nombre: a.nombre, activo: a.activo })),
      asignaciones: [],
      nodos: indexarNodos({ generos: arbol.generos, mundos: arbol.mundos, lineas: arbol.lineas, nodos: arbol.nodos }),
    },
    marcas,
    arbol,
  };
}

/** `huella_flujo` con que se «cerró» la proyección: la configuración de marcas de siempre (BETA al barrer). */
export function huellaFlujoDeCierre(): string {
  const base = escenario.betaMixta;
  escenario.betaMixta = false;
  try {
    const g = estadoGmlFalso();
    return huellaFlujo(construirConfigFlujo(g.estado as never, equivalenciasDelEscenario().map((q) => ({ id: q.id, genero_mundo_linea_id: q.genero_mundo_linea_id }))));
  } finally {
    escenario.betaMixta = base;
  }
}

export function cerradaFalsa(anio: number) {
  escenario.lecturas.cerrada += 1;
  return {
    proyeccion: { id: CERRADA_ID, nombre: "Proyección 2026–2027", hasta_periodo: "2026-09", anio_en_curso: 2026 },
    anio_pedido: anio,
    cubre: "en_curso" as const,
    anios: [anio, anio + 1],
    huella_flujo: huellaFlujoDeCierre(),
    version_metodo: 4,
    periodo_referencia: { desde: "2025-10", hasta: "2026-09" },
    filas: filasCerrada(),
  };
}

export function repartosVigentesFalsos(): RepartosVigentesApi {
  escenario.lecturas.repartos += 1;
  return {
    repartos: [BETA_V2, GAMMA_V1].map((r) => ({
      marca_id: r.marca_id,
      reparto_id: r.reparto_id,
      version: r.version,
      modo: r.modo,
      fuente: "historico" as const,
      alcance: { generos: [], mundos: [], lineas: [] },
      hasta_periodo: "2026-09",
      error_reparto_pp: r.error_reparto_pp,
      temporadas_usadas: r.temporadas_usadas,
      aprobada_at: "2026-10-01T10:00:00.000Z",
      filas: r.filas,
    })),
    sin_reparto: [],
  } as RepartosVigentesApi;
}

export function tiendasFalsas(): Fila[] {
  return estadoImportacionBase().tiendas.map((t) => ({ ...t, estado: "activa" }));
}

// ─── La base: consultas ───

type Resultado = { data: unknown; error: ErrorRpc | null };
const err = (code: string, message: string): ErrorRpc => ({ code, message, details: null, hint: null });

class Consulta implements PromiseLike<Resultado> {
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private carga: Fila | null = null;
  private modo: "select" | "upsert" = "select";
  constructor(private readonly nombre: string) {}
  select() {
    return this;
  }
  upsert(f: Fila, o?: { onConflict?: string }) {
    this.modo = "upsert";
    this.carga = { ...f, __conflicto: o?.onConflict ?? "id" };
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] !== v);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filtros.push((f) => v.includes(f[c]));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.ordenes.push([c, o?.ascending !== false]);
    return this;
  }
  range(d: number, h: number) {
    this.desde = d;
    this.hasta = h;
    return this;
  }
  single() {
    this.una = "single";
    return this;
  }
  maybeSingle() {
    this.una = "maybeSingle";
    return this;
  }
  then<A, B>(ok?: ((v: Resultado) => A | PromiseLike<A>) | null, ko?: ((r: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.ejecutar()).then(ok, ko);
  }
  private ejecutar(): Resultado {
    const filas = tabla(this.nombre);
    if (this.modo === "upsert" && this.carga) {
      const { __conflicto, ...datos } = this.carga as Fila & { __conflicto: string };
      const clave = String(__conflicto);
      const existente = filas.find((f) => f[clave] === datos[clave]);
      const ahora = sello();
      if (existente) Object.assign(existente, datos, { updated_at: ahora });
      else filas.push({ id: nuevoId(), created_at: ahora, updated_at: ahora, ...datos });
      const fila = filas.find((f) => f[clave] === datos[clave]);
      return { data: fila ? { ...fila } : null, error: null };
    }
    let r = filas.filter((f) => this.filtros.every((p) => p(f)));
    for (const [c, asc] of [...this.ordenes].reverse()) {
      r = [...r].sort((a, b) => {
        const x = a[c] as string | number;
        const y = b[c] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    r = r.slice(this.desde, this.hasta === Infinity ? undefined : this.hasta + 1);
    if (this.una) return { data: r[0] ? { ...r[0] } : null, error: null };
    return { data: r.map((f) => ({ ...f })), error: null };
  }
}

// ─── La base: funciones rpc ───

function huellaBase() {
  const cargas = tabla("cargas_venta_stock").filter((c) => c.estado === "publicada");
  const eventos = tabla("compra_eventos");
  const compras = tabla("compras");
  const maximo = (xs: unknown[]) => (xs.length === 0 ? null : (xs as string[]).reduce((a, b) => (a > b ? a : b)));
  const parametros = tabla("flujo_parametros")[0];
  return {
    cargas: cargas.map((c) => ({ periodo: String(c.periodo).slice(0, 7), carga_id: c.id, publicada_at: c.publicada_at })),
    cerradas: escenario.sinCerrada ? [] : [{ id: CERRADA_ID, anio_en_curso: 2026, updated_at: "2026-09-30T10:00:00.000Z" }],
    compras: {
      eventos: eventos.length,
      ultimo: maximo(eventos.map((e) => e.created_at)),
      revision: compras.reduce((a, c) => a + Number(c.revision), 0),
      actualizada: maximo(compras.map((c) => c.updated_at)),
    },
    parametros: parametros ? parametros.updated_at : null,
    repartos: { vigentes: 2, ultima: "2026-10-01T10:00:00.000Z" },
    reglas: { n: 0, ultima: null },
    config: escenario.config,
  };
}

function stockFlujo(cargaId: string): StockFlujoJson {
  const carga = tabla("cargas_venta_stock").find((c) => c.id === cargaId);
  if (!carga || carga.estado !== "publicada") return { carga_id: cargaId, periodo: "", publicada: false, equivalencias: [], marcas: [], filas: [], excluido: { stock: 0, unidades: 0 } };
  const mes = String(carga.periodo).slice(0, 7);
  const set = mes === K_PRIMA;
  // DENIM (ALFA): ago 1 990 → set 700 con venta de set 1 410 (ingreso inferido 120). POLO (BETA, al barrer → PREMIUM): ago 960 → set 940 con venta 820 (ingreso 800).
  return {
    carga_id: cargaId,
    periodo: mes,
    publicada: true,
    equivalencias: [EQ_URBANO, EQ_POLO],
    marcas: [MARCA_M8.alfa, MARCA_M8.beta],
    filas: [
      set ? [0, 0, 300, 400, 1410, 0, 0] : [0, 0, 1000, 990, 0, 0, 0],
      set ? [1, 1, 940, 0, 820, 0, 0] : [1, 1, 960, 0, 0, 0, 0],
    ],
    excluido: escenario.tiendasInactivas ? { stock: 150, unidades: 30 } : { stock: 0, unidades: 0 },
  };
}

const respuesta = (data: unknown): Promise<Resultado> => Promise.resolve({ data, error: null });

function modeloDeTablas(compraId: string): { compra: Fila; modelo: ModeloCompra } | null {
  const compra = tabla("compras").find((c) => c.id === compraId);
  if (!compra) return null;
  const lineas = tabla("compra_lineas").filter((l) => l.compra_id === compraId);
  const ids = new Set(lineas.map((l) => l.id));
  return {
    compra,
    modelo: {
      estado: compra.estado as EstadoCompra,
      revision: Number(compra.revision),
      cancelada_at: (compra.cancelada_at as string | null) ?? null,
      fecha_compra: String(compra.fecha_compra),
      lineas: lineas.map((l) => ({ id: String(l.id), unidades: Number(l.unidades), unidades_recibidas: Number(l.unidades_recibidas), unidades_canceladas: Number(l.unidades_canceladas), activo: l.activo === true })),
      recepciones: tabla("compra_linea_recepciones")
        .filter((r) => ids.has(r.linea_id))
        .map((r) => ({ id: String(r.id), linea_id: String(r.linea_id), recibida_periodo: String(r.recibida_periodo).slice(0, 7), unidades: Number(r.unidades), fecha_recepcion: String(r.fecha_recepcion), origen: r.origen as "manual" | "sugerencia" | "importada" })),
    },
  };
}

type Actor = { perfil_id: string | null; nombre: string };

/** Lo que dejan las funciones de escritura en las tablas tras una operación válida: estado, revisión, líneas, recepciones y evento. */
function aplicarEnTablas(compra: Fila, modelo: ModeloCompra, evento: Fila, actor: Actor, recepcionesNuevas: Fila[] = [], extra: Fila = {}): void {
  const ahora = sello();
  compra.estado = modelo.estado;
  compra.revision = modelo.revision;
  compra.updated_by_id = actor.perfil_id;
  compra.updated_by_nombre = actor.nombre;
  compra.updated_at = ahora;
  Object.assign(compra, extra);
  for (const l of tabla("compra_lineas").filter((x) => x.compra_id === compra.id)) {
    const m = modelo.lineas.find((x) => x.id === l.id);
    if (m) {
      l.unidades_recibidas = m.unidades_recibidas;
      l.unidades_canceladas = m.unidades_canceladas;
    }
  }
  const lineas = new Set(tabla("compra_lineas").filter((x) => x.compra_id === compra.id).map((x) => x.id));
  const vivas = new Set(modelo.recepciones.map((r) => r.id));
  escenario.tablas.compra_linea_recepciones = tabla("compra_linea_recepciones").filter((r) => !lineas.has(r.linea_id) || vivas.has(String(r.id)));
  for (const r of recepcionesNuevas) tabla("compra_linea_recepciones").push(r);
  tabla("compra_eventos").push({ id: nuevoId(), created_at: ahora, ...evento });
}

function rpcRegistrar(a: Record<string, unknown>): unknown {
  const t = modeloDeTablas(String(a.p_compra));
  if (!t) return { ok: false, motivo: "no_encontrada" };
  const actor = a.p_actor as Actor;
  const crudas = a.p_recepciones as { linea_id: string; recibida_periodo: string; unidades: number; fecha_recepcion: string; nota: string | null; origen: RecepcionNueva["origen"] }[];
  const nuevas: RecepcionNueva[] = crudas.map((r) => ({ ...r, recibida_periodo: r.recibida_periodo.slice(0, 7) }));
  const ids = nuevas.map(() => nuevoId());
  const r = aplicarRecepciones(t.modelo, Number(a.p_revision), nuevas, { compra_id: t.compra.id as string, actor, ahora: sello(), motivo: (a.p_motivo as string | null) ?? null, ids });
  if (!r.ok) return { ok: false, motivo: r.rechazo.motivo };
  const filas: Fila[] = nuevas.map((n, i) => ({ id: ids[i], linea_id: n.linea_id, recibida_periodo: `${n.recibida_periodo}-01`, unidades: n.unidades, fecha_recepcion: n.fecha_recepcion, origen: n.origen, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, nota: n.nota, activo: true, created_at: sello(), updated_at: sello() }));
  aplicarEnTablas(t.compra, r.modelo, r.evento as unknown as Fila, actor, filas);
  return { ok: true, compra_id: t.compra.id, revision: r.modelo.revision, estado: r.modelo.estado, recepcion_ids: ids };
}

function rpcQuitar(a: Record<string, unknown>): unknown {
  const t = modeloDeTablas(String(a.p_compra));
  if (!t) return { ok: false, motivo: "no_encontrada" };
  const actor = a.p_actor as Actor;
  const r = aplicarQuitarRecepcion(t.modelo, Number(a.p_revision), String(a.p_recepcion), { compra_id: t.compra.id as string, actor, ahora: sello() });
  if (!r.ok) return { ok: false, motivo: r.rechazo.motivo };
  aplicarEnTablas(t.compra, r.modelo, r.evento as unknown as Fila, actor);
  return { ok: true, compra_id: t.compra.id, revision: r.modelo.revision, estado: r.modelo.estado };
}

function rpcCancelar(a: Record<string, unknown>): unknown {
  const t = modeloDeTablas(String(a.p_compra));
  if (!t) return { ok: false, motivo: "no_encontrada" };
  const actor = a.p_actor as Actor;
  const ahora = sello();
  const r = aplicarCancelacion(t.modelo, Number(a.p_revision), String(a.p_motivo ?? ""), { compra_id: t.compra.id as string, actor, ahora, numero: String(t.compra.numero) });
  if (!r.ok) return { ok: false, motivo: r.motivo };
  aplicarEnTablas(t.compra, r.modelo, r.evento as unknown as Fila, actor, [], { cancelada_at: r.modelo.cancelada_at, cancelada_por_id: actor.perfil_id, cancelada_por_nombre: actor.nombre, motivo_cancelacion: String(a.p_motivo).trim() });
  return { ok: true, compra_id: t.compra.id, revision: r.modelo.revision, estado: r.modelo.estado };
}

type PayloadLinea = {
  clave_importacion: string;
  huella_importacion: string;
  tipo: string;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: string;
  unidades: number;
  costo_unitario: number | null;
  destino: string;
  tienda_id: string | null;
  alcance: Record<string, unknown>;
  nota: string | null;
  avisos: string[];
  entregas: { periodo: string; unidades: number; origen: string }[];
  repartos: { entrega_periodo: string; marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number; reparto_id: string | null; reparto_version: number | null; temporada: string | null; error_reparto_pp: number | null }[];
  recepciones: { recibida_periodo: string; unidades: number; fecha_recepcion: string; nota: string | null }[];
};

type PayloadCompra = {
  proveedor_id?: string;
  proveedor_nombre?: string;
  proveedor_es_intercompany?: boolean;
  referencia: string;
  fecha_compra: string;
  moneda: string;
  nota: string | null;
  origen: string;
  estado: string;
  lineas: PayloadLinea[];
};

/** `importar_compra`: una compra completa (proveedor si falta, cabecera, líneas, entregas, repartos, recepciones y evento) o nada. */
function rpcImportar(a: Record<string, unknown>): { data: unknown; error: ErrorRpc | null } {
  const n = escenario.llamadas.filter((l) => l.nombre === "importar_compra").length;
  if (escenario.fallarImportacion === n) return { data: null, error: err("XX000", "fallo de prueba a mitad de la compra") };
  const p = a.p_compra as PayloadCompra;
  const actor = a.p_actor as Actor;
  if (escenario.claveExistente?.(p.referencia)) return { data: { ok: false, motivo: "clave_existente" }, error: null };
  const claves = new Set(tabla("compra_lineas").filter((l) => tabla("compras").find((c) => c.id === l.compra_id)?.estado !== "cancelada").map((l) => l.clave_importacion));
  if (p.lineas.some((l) => claves.has(l.clave_importacion))) return { data: { ok: false, motivo: "clave_existente" }, error: null };

  let proveedorId = p.proveedor_id ?? null;
  if (!proveedorId) {
    const existente = tabla("proveedores").find((x) => String(x.nombre).toUpperCase() === String(p.proveedor_nombre).toUpperCase());
    if (existente) proveedorId = existente.id as string;
    else {
      proveedorId = nuevoId();
      tabla("proveedores").push({ id: proveedorId, codigo: null, nombre: p.proveedor_nombre, pais: null, ciudad: null, identificacion: null, es_intercompany: false, nota: null, activo: true, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, created_at: sello(), updated_at: sello() });
    }
  }
  let compra = tabla("compras").find((c) => c.proveedor_id === proveedorId && String(c.referencia).toUpperCase() === p.referencia.toUpperCase() && c.estado !== "cancelada");
  const creada = !compra;
  const ahora = sello();
  if (!compra) {
    compra = {
      id: nuevoId(),
      numero: `C-${String(escenario.contadorNumero++).padStart(6, "0")}`,
      proveedor_id: proveedorId,
      origen: p.origen,
      estado: p.estado,
      fecha_compra: p.fecha_compra,
      referencia: p.referencia,
      moneda: p.moneda,
      nota: p.nota,
      confirmada_at: p.estado === "borrador" ? null : ahora,
      confirmada_por_id: actor.perfil_id,
      confirmada_por_nombre: actor.nombre,
      cancelada_at: null,
      cancelada_por_id: null,
      cancelada_por_nombre: null,
      motivo_cancelacion: null,
      justificacion_exceso: null,
      excede_tope_al_confirmar: [],
      perfil_id: actor.perfil_id,
      usuario_nombre: actor.nombre,
      revision: 0,
      updated_by_id: actor.perfil_id,
      updated_by_nombre: actor.nombre,
      activo: true,
      created_at: ahora,
      updated_at: ahora,
    };
    tabla("compras").push(compra);
  }
  const compraId = compra.id as string;
  const lineasNuevas: { clave: string; linea_id: string }[] = [];
  for (const l of p.lineas) {
    const lineaId = nuevoId();
    const periodos = l.entregas.map((e) => e.periodo).sort();
    tabla("compra_lineas").push({
      id: lineaId,
      compra_id: compraId,
      tipo: l.tipo,
      genero_mundo_linea_id: l.genero_mundo_linea_id,
      equivalencia_id: l.equivalencia_id,
      marca_id: l.marca_id,
      agrupacion_marca_id: l.agrupacion_marca_id,
      tallas: l.tallas,
      unidades: l.unidades,
      unidades_recibidas: l.recepciones.reduce((s, r) => s + r.unidades, 0),
      unidades_canceladas: 0,
      costo_unitario: l.costo_unitario,
      llegada_periodo: periodos[0],
      destino: l.destino,
      tienda_id: l.tienda_id,
      alcance: l.alcance,
      clave_importacion: l.clave_importacion,
      huella_importacion: l.huella_importacion,
      nota: l.nota,
      avisos: l.avisos,
      activo: true,
      created_at: ahora,
      updated_at: ahora,
    });
    const idPorPeriodo = new Map<string, string>();
    for (const e of l.entregas) {
      const id = nuevoId();
      idPorPeriodo.set(e.periodo, id);
      tabla("compra_linea_entregas").push({ id, linea_id: lineaId, periodo: e.periodo, unidades: e.unidades, origen: e.origen, activo: true, created_at: ahora, updated_at: ahora });
    }
    for (const r of l.repartos) {
      tabla("compra_linea_repartos").push({ id: nuevoId(), linea_id: lineaId, entrega_id: idPorPeriodo.get(r.entrega_periodo), marca_id: r.marca_id, genero_mundo_linea_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, unidades: r.unidades, reparto_id: r.reparto_id, reparto_version: r.reparto_version, temporada: r.temporada, error_reparto_pp: r.error_reparto_pp, activo: true, created_at: ahora, updated_at: ahora });
    }
    for (const r of l.recepciones) {
      tabla("compra_linea_recepciones").push({ id: nuevoId(), linea_id: lineaId, recibida_periodo: r.recibida_periodo, unidades: r.unidades, fecha_recepcion: r.fecha_recepcion, origen: "importada", perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, nota: r.nota, activo: true, created_at: ahora, updated_at: ahora });
    }
    lineasNuevas.push({ clave: l.clave_importacion, linea_id: lineaId });
  }
  const t = modeloDeTablas(compraId) as NonNullable<ReturnType<typeof modeloDeTablas>>;
  const modelo = recalcularModelo({ ...t.modelo, revision: creada ? 0 : t.modelo.revision + 1 });
  compra.estado = p.estado === "borrador" ? "borrador" : modelo.estado;
  compra.revision = modelo.revision;
  for (const l of tabla("compra_lineas").filter((x) => x.compra_id === compraId)) {
    const m = modelo.lineas.find((x) => x.id === l.id);
    if (m) l.unidades_recibidas = m.unidades_recibidas;
  }
  tabla("compra_eventos").push({ id: nuevoId(), compra_id: compraId, linea_id: null, accion: "importar", antes: null, despues: { estado: compra.estado, lineas: lineasNuevas.length }, motivo: null, resumen: `Importó ${lineasNuevas.length} línea(s) (carga inicial)`, perfil_id: actor.perfil_id, usuario_nombre: actor.nombre, created_at: ahora });
  return { data: { ok: true, compra_id: compraId, numero: compra.numero, revision: modelo.revision, estado: compra.estado, creada, proveedor_id: proveedorId, proveedor_creado: false, lineas: lineasNuevas }, error: null };
}

export function clienteFalso() {
  return {
    from: (nombre: string) => new Consulta(nombre),
    rpc: (nombre: string, args: Record<string, unknown> = {}): Promise<Resultado> => {
      escenario.llamadas.push({ nombre, args });
      switch (nombre) {
        case "flujo_huella_base":
          return respuesta(huellaBase());
        case "stock_flujo":
          return respuesta(stockFlujo(String(args.p_carga_id)));
        case "registrar_recepciones":
          return respuesta(rpcRegistrar(args));
        case "quitar_recepcion":
          return respuesta(rpcQuitar(args));
        case "cancelar_compra":
          return respuesta(rpcCancelar(args));
        case "importar_compra":
          return Promise.resolve(rpcImportar(args));
        default:
          return Promise.resolve({ data: null, error: err("42883", `función desconocida: ${nombre}`) });
      }
    },
  };
}

// ─── Atajos de las pruebas ───

export const llamadasA = (nombre: string) => escenario.llamadas.filter((l) => l.nombre === nombre);
export const eventosDe = (compraId: string) => tabla("compra_eventos").filter((e) => e.compra_id === compraId);
export const filaDe = (nombreTabla: string, id: string) => tabla(nombreTabla).find((f) => f.id === id);
export const tablaDe = tabla;

export { COMPRA, LINEA, MARCA_M8, NODO_M8, PERFIL, PROVEEDOR, TIENDA_M8, EQ_M8, K_PRIMA };
