import type { FilaAgrupador } from "@/lib/compras/agrupadores/esquemas";
import type {
  AsignacionApi,
  EmbarqueApi,
  EmbarqueDetalleApi,
  PaqueteApi,
  PlanMovimientoApi,
  ReporteImportacionAgrupadoresApi,
  SinAgrupadorApi,
  ViajeApi,
} from "@/lib/compras/agrupadores/tipos-api";
import type {
  ActorAgrupador,
  AsignacionRegistro,
  EmbarqueRegistro,
  PaqueteRegistro,
  PerfilRegistro,
  ViajeRegistro,
} from "@/lib/compras/agrupadores/tipos";
import type { CompraRegistro, EntregaRegistro, LineaRegistro, RepartoRegistro } from "@/lib/compras/tipos";
import { EQ, MARCA_M8, NODO_M8, PROVEEDOR, REPARTO_BETA_V2, type RegistrosCompra } from "./compras.fixture";

/**
 * Casos sintéticos de los agrupadores de compras (ficha 08b, sección 5; casos 1 a 19c). Todo inventado: proveedores «Proveedor Norte»,
 * «Feria Sur» y «Taller Lima Centro»; compradores C1, C2 (activos) y C3 (inactivo); admin A; un planner PL para el caso 9; cifras redondas.
 * `k' = 2026-09` y temporadas por defecto (verano: oct-mar; invierno: abr-sep). Los ids son UUID válidos (v4) y no chocan con los de
 * `compras.fixture.ts`, cuyas marcas, nodos y proveedores se reutilizan.
 *
 * Dos formas de lo mismo, como en `compras.fixture.ts`: REGISTROS planos (lo que leería `consultas.ts` y consumen las funciones puras
 * de T2) y objetos de API (lo que muestra la pantalla). Los de API se arman a mano con las cifras de los registros; la prueba de
 * esquemas comprueba que cuadran.
 */

const uuid = (grupo: string, n: number) => `b0${grupo}0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Último mes publicado de los casos (`k'`). */
export const K_PRIMA_AGRUPADORES = "2026-09";

export const PERFIL_AGR = {
  c1: uuid("a1", 1), // comprador activo; responsable del viaje 261001
  c2: uuid("a1", 2), // comprador activo; responsable del paquete 261101
  c3: uuid("a1", 3), // comprador INACTIVO; responsable del embarque local 261102 (faltante)
  a: uuid("a1", 4), // admin activo: asignable
  pl: uuid("a1", 5), // planner activo: NO asignable (R26)
};
export const PROVEEDOR_AGR = { feria: PROVEEDOR.feria, norte: PROVEEDOR.norte, taller: uuid("a2", 3) };
export const VIAJE_AGR = { v261001: uuid("a3", 1) };
export const EMBARQUE_AGR = {
  e261101: uuid("a4", 1),
  e261201: uuid("a4", 2),
  e270301: uuid("a4", 3),
  /** Local, escrito a mano. */
  l261102: uuid("a4", 4),
};
export const PAQUETE_AGR = { p261101: uuid("a5", 1), p261102: uuid("a5", 2) };
export const COMPRA_AGR = { c101: uuid("a6", 101), c102: uuid("a6", 102), c103: uuid("a6", 103) };
export const LINEA_AGR = { l1: uuid("a7", 1), l2: uuid("a7", 2), l102: uuid("a7", 102), l103: uuid("a7", 103) };
export const ENTREGA_AGR = {
  l1Nov: uuid("a8", 11),
  l1Dic: uuid("a8", 12),
  l2Mar: uuid("a8", 21),
  l2Abr: uuid("a8", 22),
  c102Nov: uuid("a8", 102),
  c103Nov: uuid("a8", 103),
};
export const ASIGNACION_AGR = { l1NovP261101: uuid("a9", 1), l1Dic261201: uuid("a9", 2) };

/** Mes `aaaa-mm` de una fecha `aaaa-mm-dd`: la misma regla que `periodo_llegada` (`periodoLlegada` de T2 la implementa). */
const mesDe = (fecha: string) => fecha.slice(0, 7);

// ─── Perfiles y actores ───

export const perfilesAgrupadores = (): PerfilRegistro[] => [
  { id: PERFIL_AGR.c1, nombre: "Comprador C1", rol: "comprador", activo: true },
  { id: PERFIL_AGR.c2, nombre: "Comprador C2", rol: "comprador", activo: true },
  { id: PERFIL_AGR.c3, nombre: "Comprador C3", rol: "comprador", activo: false },
  { id: PERFIL_AGR.a, nombre: "Admin A", rol: "admin", activo: true },
  { id: PERFIL_AGR.pl, nombre: "Planner PL", rol: "planner", activo: true },
];

/** Correos sintéticos de los perfiles (columna `RESPONSABLE` del importador). */
export const CORREO_PERFIL_AGR = {
  c1: "c1@ejemplo.test",
  c2: "c2@ejemplo.test",
  c3: "c3@ejemplo.test",
  a: "a@ejemplo.test",
  pl: "pl@ejemplo.test",
};

export const ACTOR_C1: ActorAgrupador = { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1" };
export const ACTOR_C2: ActorAgrupador = { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2" };
export const ACTOR_ADMIN: ActorAgrupador = { perfil_id: PERFIL_AGR.a, nombre: "Admin A" };

// ─── Agrupadores ───

/** Viaje 261001, «Feria Sur · oct-2026», de C1, abierto. */
export const viaje261001 = (op: Partial<ViajeRegistro> = {}): ViajeRegistro => ({
  id: VIAJE_AGR.v261001,
  codigo: "261001",
  nombre: "Feria Sur · oct-2026",
  destino: "Ciudad Sur",
  fecha_inicio: "2026-10-05",
  fecha_fin: "2026-10-12",
  responsable_id: PERFIL_AGR.c1,
  estado: "abierto",
  nota: null,
  revision: 2,
  ...op,
});

const embarqueBase = (p: Partial<EmbarqueRegistro> & Pick<EmbarqueRegistro, "id" | "codigo" | "nombre" | "fecha_llegada_estimada">): EmbarqueRegistro => ({
  tipo: "importacion",
  viaje_id: VIAJE_AGR.v261001,
  responsable_id: null,
  referencia_logistica: null,
  puerto_embarque: null,
  fecha_salida_estimada: null,
  fecha_llegada_real: null,
  periodo_llegada: mesDe(p.fecha_llegada_real ?? p.fecha_llegada_estimada),
  estado: "planificado",
  nota: null,
  revision: 1,
  ...p,
});

/** Los cuatro embarques de la ficha: 261101 y 261201 (viaje 261001), 270301 (sin viaje) y 261102 (local, de C3). */
export const embarquesAgrupadores = (): EmbarqueRegistro[] => [
  embarqueBase({ id: EMBARQUE_AGR.e261101, codigo: "261101", nombre: "Nov-26 · Feria Sur", puerto_embarque: "Puerto Sur", fecha_salida_estimada: "2026-10-25", fecha_llegada_estimada: "2026-11-20" }),
  embarqueBase({ id: EMBARQUE_AGR.e261201, codigo: "261201", nombre: "Dic-26 · Feria Sur", fecha_salida_estimada: "2026-11-12", fecha_llegada_estimada: "2026-12-10" }),
  embarqueBase({ id: EMBARQUE_AGR.e270301, codigo: "270301", nombre: "Mar-27 · lote BETA", viaje_id: null, fecha_llegada_estimada: "2027-03-15" }),
  embarqueBase({ id: EMBARQUE_AGR.l261102, codigo: "261102", nombre: "Local nov-26", tipo: "local", viaje_id: null, responsable_id: PERFIL_AGR.c3, fecha_llegada_estimada: "2026-11-05" }),
];

/** Paquetes 261101 (C2) y 261102 (sin responsable: hereda), ambos del embarque 261101. */
export const paquetesAgrupadores = (): PaqueteRegistro[] => [
  { id: PAQUETE_AGR.p261101, embarque_id: EMBARQUE_AGR.e261101, codigo: "261101", nombre: "Paquete denim", responsable_id: PERFIL_AGR.c2, estado: "abierto", nota: null },
  { id: PAQUETE_AGR.p261102, embarque_id: EMBARQUE_AGR.e261101, codigo: "261102", nombre: "Paquete resto", responsable_id: null, estado: "abierto", nota: null },
];

// ─── Compras (caso: C-000101, C-000102 y C-000103) ───

const lineaBase = (p: Partial<LineaRegistro> & Pick<LineaRegistro, "id" | "compra_id" | "unidades">): LineaRegistro => ({
  tipo: "especifica",
  genero_mundo_linea_id: null,
  equivalencia_id: null,
  marca_id: null,
  agrupacion_marca_id: null,
  tallas: "ambas",
  unidades_recibidas: 0,
  unidades_canceladas: 0,
  costo_unitario: null,
  destino: "cd",
  tienda_id: null,
  alcance: {},
  activo: true,
  ...p,
});

const entrega = (id: string, linea_id: string, periodo: string, unidades: number): EntregaRegistro => ({ id, linea_id, periodo, unidades, origen: "manual" });

/** Vectores de la versión 2 del reparto de BETA por temporada (DENIM · POLO · SANDALIA, en %; suman 100). Sin `invierno`: caso 5, `reparto_sin_vector`. */
export const VECTOR_REPARTO_V2: Record<"verano" | "invierno", [number, number, number]> = { verano: [50, 30, 20], invierno: [30, 40, 30] };

const repartoDeEntrega = (e: EntregaConUnidades, temporada: "verano" | "invierno"): RepartoRegistro[] => {
  const [d, p, s] = VECTOR_REPARTO_V2[temporada].map((pct) => Math.round((e.unidades * pct) / 100));
  const fila = (gml: string, unidades: number): RepartoRegistro => ({
    linea_id: LINEA_AGR.l2,
    entrega_id: e.id,
    marca_id: MARCA_M8.beta,
    genero_mundo_linea_id: gml,
    equivalencia_id: null,
    unidades,
    reparto_id: REPARTO_BETA_V2,
    reparto_version: 2,
    temporada,
    error_reparto_pp: 8,
  });
  return [fila(NODO_M8.urbano, d), fila(NODO_M8.polo, p), fila(NODO_M8.sandalia, s)];
};
type EntregaConUnidades = { id: string; unidades: number };

/**
 * C-000101 (Feria Sur, viaje 261001, USD): l1 específica DENIM × ALFA de 500 u (nov 300 · dic 200) a US$ 38 y l2 lote BETA de 1 000 u
 * (mar-27 600 · abr-27 400) a US$ 22,5, con el reparto v2 de cada entrega guardado (verano en mar-27, invierno en abr-27).
 */
export function registrosC101(): RegistrosCompra {
  const l2Mar = entrega(ENTREGA_AGR.l2Mar, LINEA_AGR.l2, "2027-03", 600);
  const l2Abr = entrega(ENTREGA_AGR.l2Abr, LINEA_AGR.l2, "2027-04", 400);
  return {
    compras: [compra({ id: COMPRA_AGR.c101, numero: "C-000101", proveedor_id: PROVEEDOR_AGR.feria, proveedor_nombre: "Feria Sur", moneda: "USD", fecha_compra: "2026-10-08", revision: 3 })],
    lineas: [
      lineaBase({ id: LINEA_AGR.l1, compra_id: COMPRA_AGR.c101, genero_mundo_linea_id: NODO_M8.urbano, marca_id: MARCA_M8.alfa, unidades: 500, costo_unitario: 38 }),
      lineaBase({ id: LINEA_AGR.l2, compra_id: COMPRA_AGR.c101, tipo: "barrer_marca", marca_id: MARCA_M8.beta, unidades: 1000, costo_unitario: 22.5 }),
    ],
    entregas: [entrega(ENTREGA_AGR.l1Nov, LINEA_AGR.l1, "2026-11", 300), entrega(ENTREGA_AGR.l1Dic, LINEA_AGR.l1, "2026-12", 200), l2Mar, l2Abr],
    repartos: [...repartoDeEntrega(l2Mar, "verano"), ...repartoDeEntrega(l2Abr, "invierno")],
    recepciones: [],
  };
}

const compra = (p: Partial<CompraRegistro> & Pick<CompraRegistro, "id" | "numero">): CompraRegistro => ({
  proveedor_id: PROVEEDOR_AGR.norte,
  proveedor_nombre: "Proveedor Norte",
  origen: "comprador",
  estado: "confirmada",
  fecha_compra: "2026-10-15",
  moneda: "PEN",
  cancelada_at: null,
  revision: 1,
  ...p,
});

/** C-000102 (Proveedor Norte, sin viaje, PEN): POLO 400 u en nov-26 a S/ 22,5. */
export function registrosC102(op: { estado?: CompraRegistro["estado"] } = {}): RegistrosCompra {
  return {
    compras: [compra({ id: COMPRA_AGR.c102, numero: "C-000102", estado: op.estado ?? "confirmada" })],
    lineas: [lineaBase({ id: LINEA_AGR.l102, compra_id: COMPRA_AGR.c102, genero_mundo_linea_id: NODO_M8.polo, marca_id: MARCA_M8.alfa, unidades: 400, costo_unitario: 22.5 })],
    entregas: [entrega(ENTREGA_AGR.c102Nov, LINEA_AGR.l102, "2026-11", 400)],
    repartos: [],
    recepciones: [],
  };
}

/** C-000103 (Taller Lima Centro, en borrador, PEN): CAMISA 120 u en nov-26 a S/ 41. */
export function registrosC103(): RegistrosCompra {
  return {
    compras: [compra({ id: COMPRA_AGR.c103, numero: "C-000103", proveedor_id: PROVEEDOR_AGR.taller, proveedor_nombre: "Taller Lima Centro", estado: "borrador", fecha_compra: "2026-10-20" })],
    lineas: [lineaBase({ id: LINEA_AGR.l103, compra_id: COMPRA_AGR.c103, genero_mundo_linea_id: NODO_M8.camisa, equivalencia_id: EQ.corta, marca_id: MARCA_M8.gamma, unidades: 120, costo_unitario: 41 })],
    entregas: [entrega(ENTREGA_AGR.c103Nov, LINEA_AGR.l103, "2026-11", 120)],
    repartos: [],
    recepciones: [],
  };
}

/** Las tres compras juntas, sin asignaciones (lo que hay antes del caso 1) salvo el viaje de C-000101. */
export function registrosAgrupadores(): RegistrosCompra & {
  perfiles: PerfilRegistro[];
  viajes: ViajeRegistro[];
  embarques: EmbarqueRegistro[];
  paquetes: PaqueteRegistro[];
  asignaciones: AsignacionRegistro[];
  /** `compras.viaje_id` por compra (solo C-000101 tiene viaje). */
  viaje_de_compra: Record<string, string | null>;
} {
  const partes = [registrosC101(), registrosC102(), registrosC103()];
  return {
    compras: partes.flatMap((p) => p.compras),
    lineas: partes.flatMap((p) => p.lineas),
    entregas: partes.flatMap((p) => p.entregas),
    repartos: partes.flatMap((p) => p.repartos),
    recepciones: partes.flatMap((p) => p.recepciones),
    perfiles: perfilesAgrupadores(),
    viajes: [viaje261001()],
    embarques: embarquesAgrupadores(),
    paquetes: paquetesAgrupadores(),
    asignaciones: [],
    viaje_de_compra: { [COMPRA_AGR.c101]: VIAJE_AGR.v261001, [COMPRA_AGR.c102]: null, [COMPRA_AGR.c103]: null },
  };
}

/** Caso 1: l1 nov 300 → 261101 / paquete 261101 y dic 200 → 261201. Nada se mueve (ya están alineadas). */
export const asignacionesCaso1 = (): AsignacionRegistro[] => [
  { id: ASIGNACION_AGR.l1NovP261101, entrega_id: ENTREGA_AGR.l1Nov, embarque_id: EMBARQUE_AGR.e261101, paquete_id: PAQUETE_AGR.p261101, unidades: 300 },
  { id: ASIGNACION_AGR.l1Dic261201, entrega_id: ENTREGA_AGR.l1Dic, embarque_id: EMBARQUE_AGR.e261201, paquete_id: null, unidades: 200 },
];

// ─── Objetos de API ───

const sello = "2026-10-08T10:02:00.000Z";
const creadoPorC1 = { nombre: "Comprador C1", at: sello };

export const costoCero = { PEN: 0, USD: 0 };

/** Viaje 261001 con las asignaciones del caso 1: C-000101 (1 500 u, US$ 41 500), 2 embarques y 1 000 u del lote sin embarque. */
export const viajeApi261001 = (): ViajeApi => ({
  id: VIAJE_AGR.v261001,
  codigo: "261001",
  nombre: "Feria Sur · oct-2026",
  destino: "Ciudad Sur",
  fecha_inicio: "2026-10-05",
  fecha_fin: "2026-10-12",
  estado: "abierto",
  revision: 2,
  nota: null,
  responsable: { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1" },
  responsable_valido: true,
  totales: { compras: 1, unidades: 1500, costo: { PEN: 0, USD: 41500 }, embarques: 2, unidades_sin_embarque: 1000 },
  avisos: [],
  creado_por: creadoPorC1,
  modificado_por: null,
});

/** Paquete 261101 (de C2) con la asignación de 300 u de l1. */
export const paqueteApi261101 = (): PaqueteApi => ({
  id: PAQUETE_AGR.p261101,
  embarque_id: EMBARQUE_AGR.e261101,
  codigo: "261101",
  nombre: "Paquete denim",
  estado: "abierto",
  nota: null,
  responsable_efectivo: { perfil_id: PERFIL_AGR.c2, nombre: "Comprador C2", origen: "propio" },
  totales: { asignaciones: 1, compras: 1, lineas: 1, unidades: 300, recibidas: 0, pendientes: 300, historicas: 0 },
  avisos: [],
});

/** Paquete 261102, sin responsable propio: hereda a C1 del viaje a través del embarque (caso 9). */
export const paqueteApi261102 = (): PaqueteApi => ({
  id: PAQUETE_AGR.p261102,
  embarque_id: EMBARQUE_AGR.e261101,
  codigo: "261102",
  nombre: "Paquete resto",
  estado: "abierto",
  nota: null,
  responsable_efectivo: { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", origen: "viaje" },
  totales: { asignaciones: 0, compras: 0, lineas: 0, unidades: 0, recibidas: 0, pendientes: 0, historicas: 0 },
  avisos: [],
});

/** Embarque 261101 con la asignación del caso 1 (sin responsable propio: hereda a C1). */
export const embarqueApi261101 = (): EmbarqueApi => ({
  id: EMBARQUE_AGR.e261101,
  codigo: "261101",
  nombre: "Nov-26 · Feria Sur",
  tipo: "importacion",
  viaje: { id: VIAJE_AGR.v261001, codigo: "261001", nombre: "Feria Sur · oct-2026", estado: "abierto" },
  referencia_logistica: null,
  puerto_embarque: "Puerto Sur",
  puertos_habituales: [],
  fecha_salida_estimada: "2026-10-25",
  fecha_llegada_estimada: "2026-11-20",
  fecha_llegada_real: null,
  periodo_llegada: "2026-11",
  estado: "planificado",
  recepcion: "sin_recibir",
  revision: 1,
  nota: null,
  responsable_efectivo: { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1", origen: "viaje" },
  totales: { paquetes: 2, compras: 1, lineas: 1, unidades: 300, recibidas: 0, pendientes: 300, historicas: 0, costo: { PEN: 0, USD: 11400 } },
  proveedores: [{ id: PROVEEDOR_AGR.feria, nombre: "Feria Sur" }],
  avisos: [],
  creado_por: creadoPorC1,
  modificado_por: null,
});

/** La asignación de l1 nov 300 → 261101 / paquete 261101, tal como la muestra el detalle. */
export const asignacionApiL1Nov = (): AsignacionApi => ({
  id: ASIGNACION_AGR.l1NovP261101,
  entrega_id: ENTREGA_AGR.l1Nov,
  periodo: "2026-11",
  paquete_id: PAQUETE_AGR.p261101,
  unidades: 300,
  recibidas: 0,
  recibidas_estimadas: true,
  pendiente: 300,
  historica: false,
  compra: { id: COMPRA_AGR.c101, numero: "C-000101", revision: 3, estado: "confirmada", proveedor: { id: PROVEEDOR_AGR.feria, nombre: "Feria Sur" }, viaje_id: VIAJE_AGR.v261001, fecha_compra: "2026-10-08" },
  linea: { id: LINEA_AGR.l1, tipo: "especifica", gml: "HOMBRE · URBANO · DENIM", marca: "ALFA", agrupacion_marca: null, tallas: "ambas", costo_unitario: 38, moneda: "USD" },
});

export const embarqueDetalleApi261101 = (): EmbarqueDetalleApi => ({
  ...embarqueApi261101(),
  paquetes: [paqueteApi261101(), paqueteApi261102()],
  asignaciones: [asignacionApiL1Nov()],
});

/** Caso 3: C1 cambia la llegada de 261101 al 03-dic: l1 queda en dic 500 con dos asignaciones y el aviso `entregas_fusionadas`. */
export const planCaso3 = (): PlanMovimientoApi => ({
  operacion: "cambiar_fecha",
  huella_plan: "0".repeat(63) + "1",
  compras_afectadas: 1,
  lineas: 1,
  unidades_movidas: 300,
  movimientos: [
    {
      compra_numero: "C-000101",
      linea: "DENIM · ALFA",
      de: { periodo: "2026-11", embarque: { id: EMBARQUE_AGR.e261101, codigo: "261101" }, paquete: { id: PAQUETE_AGR.p261101, codigo: "261101" } },
      a: { periodo: "2026-12", embarque: { id: EMBARQUE_AGR.e261101, codigo: "261101" }, paquete: { id: PAQUETE_AGR.p261101, codigo: "261101" } },
      unidades: 300,
    },
  ],
  avisos: [{ aviso: "entregas_fusionadas", detalle: "En dic-26, C-000101 queda con una sola entrega de 500 u." }],
});

/** Pestaña Sin agrupador antes del caso 1: la entrega de C-000102 (borrador no) y las compras sin viaje. */
export const sinAgrupadorApi = (): SinAgrupadorApi => ({
  entregas: [
    {
      entrega_id: ENTREGA_AGR.c102Nov,
      periodo: "2026-11",
      unidades: 400,
      sin_asignar: 400,
      compra: { id: COMPRA_AGR.c102, numero: "C-000102", revision: 1, estado: "confirmada", proveedor: { id: PROVEEDOR_AGR.norte, nombre: "Proveedor Norte" }, viaje_id: null, fecha_compra: "2026-10-15" },
      linea: { id: LINEA_AGR.l102, tipo: "especifica", gml: "HOMBRE · CASUAL · POLO", marca: "ALFA", agrupacion_marca: null, tallas: "ambas", costo_unitario: 22.5, moneda: "PEN" },
    },
  ],
  compras_sin_viaje: [
    { id: COMPRA_AGR.c102, numero: "C-000102", revision: 1, estado: "confirmada", proveedor: { id: PROVEEDOR_AGR.norte, nombre: "Proveedor Norte" }, fecha_compra: "2026-10-15", unidades: 400, costo: { PEN: 9000, USD: 0 }, unidades_sin_embarque: 400, origen: "comprador" },
  ],
});

// ─── Importador de agrupadores (casos 19b y 19c) ───

const fila = (n: number, p: Omit<FilaAgrupador, "fila">): FilaAgrupador => ({ fila: n, ...p });

/**
 * Caso 19b: 2 viajes (uno con código `261201`, otro sin código), 3 embarques (261301 apunta al viaje `261201` DEL ARCHIVO, 261302 al
 * viaje existente 261001 y 261303 es local) y 4 paquetes (dos del embarque 261301, uno sin código; uno de 261302 y uno del local).
 * Previsualizar: 9 nuevas (la del viaje sin código «se numera al aplicar»); reimportar tras aplicar: 9 `igual`.
 */
export const archivoAgrupadores19b = (): FilaAgrupador[] => [
  fila(1, { tipo: "VIAJE", codigo: "261201", nombre: "Taller Lima · dic-2026", destino: "Lima", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05", responsable: CORREO_PERFIL_AGR.c2, nota: "Viaje del taller" }),
  fila(2, { tipo: "VIAJE", codigo: "", nombre: "Proveedor Norte · ene-2027", destino: "", fecha_inicio: "2027-01-10", fecha_fin: "", responsable: CORREO_PERFIL_AGR.a }),
  fila(3, { tipo: "EMBARQUE", codigo: "261301", nombre: "Ene-27 · Taller Lima", viaje: "261201", tipo_embarque: "IMPORTACION", fecha_salida: "2026-12-20", fecha_llegada: "2027-01-15", puerto: "Puerto Norte", referencia_logistica: "REF-0001", responsable: CORREO_PERFIL_AGR.c1 }),
  fila(4, { tipo: "EMBARQUE", codigo: "261302", nombre: "Ene-27 · Feria Sur", viaje: "261001", fecha_llegada: "2027-01-25", responsable: "" }), // hereda a C1 del viaje
  fila(5, { tipo: "EMBARQUE", codigo: "261303", nombre: "Local dic-26", tipo_embarque: "LOCAL", fecha_llegada: "2026-12-05", responsable: CORREO_PERFIL_AGR.c2 }),
  fila(6, { tipo: "PAQUETE", codigo: "261301", nombre: "Paquete A", embarque: "261301", responsable: CORREO_PERFIL_AGR.c2 }),
  fila(7, { tipo: "PAQUETE", codigo: "", nombre: "Paquete B", embarque: "261301" }),
  fila(8, { tipo: "PAQUETE", codigo: "261302", nombre: "Paquete C", embarque: "261302" }),
  fila(9, { tipo: "PAQUETE", codigo: "261303", nombre: "Paquete local", embarque: "261303", nota: "Sin responsable propio" }),
];

/**
 * Caso 19c: el mismo archivo con (a) la fecha de llegada de 261302 cambiada → `cambiada_requiere_edicion` con la diferencia; (b) un
 * paquete cuyo embarque del archivo no trae código → `referencia_sin_codigo`; (c) un responsable planner → `responsable_no_asignable`.
 * Lo demás, `igual` (tras haber aplicado 19b).
 */
export const archivoAgrupadores19c = (): FilaAgrupador[] => {
  const base = archivoAgrupadores19b().map((f) => {
    if (f.fila === 4) return { ...f, fecha_llegada: "2027-01-30" };
    if (f.fila === 5) return { ...f, responsable: CORREO_PERFIL_AGR.pl };
    return f;
  });
  return [
    ...base,
    fila(10, { tipo: "EMBARQUE", codigo: "", nombre: "Embarque sin código", fecha_llegada: "2027-02-10" }),
    fila(11, { tipo: "PAQUETE", codigo: "", nombre: "Paquete D", embarque: "Embarque sin código" }),
  ];
};

/** Reporte de previsualizar el caso 19b: 9 nuevas; el viaje sin código «se numera al aplicar» (`codigo_final` nulo). */
export const reporteCaso19bPrevisualizar = (): ReporteImportacionAgrupadoresApi => {
  const archivo = archivoAgrupadores19b();
  const tipos = ["viaje", "viaje", "embarque", "embarque", "embarque", "paquete", "paquete", "paquete", "paquete"] as const;
  return {
    modo: "previsualizar",
    resumen: {
      nuevas: 9,
      iguales: 0,
      cambiadas: 0,
      omitidas: 0,
      por_tipo: {
        viaje: { nuevas: 2, iguales: 0, cambiadas: 0, omitidas: 0 },
        embarque: { nuevas: 3, iguales: 0, cambiadas: 0, omitidas: 0 },
        paquete: { nuevas: 4, iguales: 0, cambiadas: 0, omitidas: 0 },
      },
    },
    filas: archivo.map((f, i) => ({
      fila: f.fila,
      tipo: tipos[i],
      clave: f.codigo ? `${tipos[i]}|${f.codigo}` : `${tipos[i]}|${(f.nombre ?? "").toUpperCase()}`,
      clasificacion: "nueva" as const,
      codigo_final: f.codigo ? f.codigo : null,
      avisos: [],
    })),
  };
};
