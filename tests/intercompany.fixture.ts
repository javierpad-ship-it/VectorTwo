import type { ParticipacionFilaCerrada } from "@/lib/intercompany/tipos-api";

/**
 * Casos sintéticos de M13 (ficha 13, sección 9). Todo inventado: marcas, nodos, porcentajes y participaciones. Los ids son UUID
 * válidos (v4) para pasar el `z.uuid()` de los esquemas.
 */

const uuid = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const GEN = { hombre: uuid("a", 1), mujer: uuid("a", 2) };
export const MUN = { formal: uuid("b", 1), casual: uuid("b", 2), ri: uuid("b", 3), urbano: uuid("b", 4) };
export const LIN = { camisa: uuid("c", 1), terno: uuid("c", 2), polo: uuid("c", 3), casaca: uuid("c", 4), denim: uuid("c", 5), vieja: uuid("c", 6) };
/** Nodos género · mundo · línea. */
export const NODO = {
  camisa: uuid("d", 1), // HOMBRE · FORMAL · CAMISA (GMLE)
  terno: uuid("d", 2), // HOMBRE · FORMAL · TERNO (GML)
  polo: uuid("d", 3), // HOMBRE · CASUAL · POLO (GML)
  casaca: uuid("d", 4), // HOMBRE · RI · CASACA (GML)
  muPolo: uuid("d", 5), // MUJER · CASUAL · POLO (GML): fuera de ámbito
  urbano: uuid("d", 6), // HOMBRE · URBANO · DENIM (GML): fuera de ámbito
  inactivo: uuid("d", 7), // HOMBRE · FORMAL · VIEJA (nodo inactivo)
};
export const EQ = {
  larga: uuid("e", 1),
  corta: uuid("e", 2),
  ternoX: uuid("e", 3), // equivalencia del TERNO (otro nodo)
};
export const MARCA = {
  jh: uuid("f", 1), // JOHN HOLDEN (cabeza del conjunto JH)
  john: uuid("f", 2), // JOHN (miembro)
  donatelli: uuid("f", 3),
  vh: uuid("f", 4), // VAN HEUSEN (sin tratamiento)
  beta: uuid("f", 5), // al barrer
  underwear: uuid("f", 6), // JOHN HOLDEN UNDERWEAR: marca aparte
  varios: uuid("f", 7),
  inactiva: uuid("f", 8),
  alfa: uuid("f", 9), // otra marca de la cerrada, sin reglas
};
export const AGR = uuid("9", 1);
const SELLO = "2026-01-01T00:00:00.000Z";

type Fila = Record<string, unknown>;

export const generosDb = (): Fila[] => [
  { id: GEN.hombre, codigo: "H", nombre: "HOMBRE", orden: 10, activo: true },
  { id: GEN.mujer, codigo: "M", nombre: "MUJER", orden: 20, activo: true },
];
export const mundosDb = (): Fila[] => [
  { id: MUN.casual, codigo: "CASUAL", nombre: "CASUAL", orden: 10, activo: true },
  { id: MUN.formal, codigo: "FORMAL", nombre: "FORMAL", orden: 40, activo: true },
  { id: MUN.ri, codigo: "RI", nombre: "RI", orden: 50, activo: true },
  { id: MUN.urbano, codigo: "URBANO", nombre: "URBANO", orden: 60, activo: true },
];
export const lineasDb = (): Fila[] => [
  { id: LIN.camisa, codigo: "CAMISA", nombre: "CAMISA", activo: true },
  { id: LIN.terno, codigo: "TERNO", nombre: "TERNO", activo: true },
  { id: LIN.polo, codigo: "POLO", nombre: "POLO", activo: true },
  { id: LIN.casaca, codigo: "CASACA", nombre: "CASACA", activo: true },
  { id: LIN.denim, codigo: "DENIM", nombre: "DENIM", activo: true },
  { id: LIN.vieja, codigo: "VIEJA", nombre: "VIEJA", activo: true },
];
export const nodosDb = (): Fila[] => [
  { id: NODO.camisa, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.camisa, activo: true, nivel_planificacion: "GMLE" },
  { id: NODO.terno, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.terno, activo: true, nivel_planificacion: "GML" },
  { id: NODO.polo, genero_id: GEN.hombre, mundo_id: MUN.casual, linea_id: LIN.polo, activo: true, nivel_planificacion: "GML" },
  { id: NODO.casaca, genero_id: GEN.hombre, mundo_id: MUN.ri, linea_id: LIN.casaca, activo: true, nivel_planificacion: "GML" },
  { id: NODO.muPolo, genero_id: GEN.mujer, mundo_id: MUN.casual, linea_id: LIN.polo, activo: true, nivel_planificacion: "GML" },
  { id: NODO.urbano, genero_id: GEN.hombre, mundo_id: MUN.urbano, linea_id: LIN.denim, activo: true, nivel_planificacion: "GML" },
  { id: NODO.inactivo, genero_id: GEN.hombre, mundo_id: MUN.formal, linea_id: LIN.vieja, activo: false, nivel_planificacion: "GML" },
];
export const equivalenciasDb = (): Fila[] => [
  { id: EQ.larga, genero_mundo_linea_id: NODO.camisa, codigo: "MANGA_LARGA", nombre: "MANGA LARGA", es_generica: false, activo: true },
  { id: EQ.corta, genero_mundo_linea_id: NODO.camisa, codigo: "MANGA_CORTA", nombre: "M. CORTA", es_generica: false, activo: true },
  { id: EQ.ternoX, genero_mundo_linea_id: NODO.terno, codigo: "SACO", nombre: "SACO", es_generica: false, activo: true },
];

const marca = (id: string, codigo: string, nombre: string, extra: Fila = {}): Fila => ({
  id,
  codigo,
  nombre,
  activo: true,
  agrupacion_marca_id: AGR,
  conjunto_marca_id: null,
  tratamiento_especial: false,
  modalidad_tratamiento: null,
  nota_tratamiento: null,
  resto_al_barrer: false,
  created_at: SELLO,
  updated_at: SELLO,
  ...extra,
});
export const marcasDb = (): Fila[] => [
  marca(MARCA.jh, "JH", "JOHN HOLDEN", { tratamiento_especial: true, modalidad_tratamiento: "por_gml" }),
  marca(MARCA.john, "JOHN", "JOHN", { conjunto_marca_id: MARCA.jh }),
  marca(MARCA.donatelli, "DONATELLI", "DONATELLI", { tratamiento_especial: true, modalidad_tratamiento: "por_gml" }),
  marca(MARCA.vh, "VH", "VAN HEUSEN"),
  marca(MARCA.beta, "BETA", "BETA", { tratamiento_especial: true, modalidad_tratamiento: "barrido" }),
  marca(MARCA.underwear, "JHU", "JOHN HOLDEN UNDERWEAR"),
  marca(MARCA.varios, "VARIOS", "VARIOS"),
  marca(MARCA.inactiva, "VIEJA", "MARCA VIEJA", { activo: false }),
  marca(MARCA.alfa, "ALFA", "ALFA"),
];

export const REGLA = {
  jhCamisa: uuid("1", 1),
  jhCorta: uuid("1", 2),
  donaTerno: uuid("1", 3),
  vhPolo: uuid("1", 4),
  vhCasaca: uuid("1", 5),
  betaTerno: uuid("1", 6),
};

type ReglaSemilla = { id: string; marca_id: string; gml: string; eq: string | null; desde: string; min: number; max: number; pct: number; nota?: string };
export const SEMILLAS: ReglaSemilla[] = [
  { id: REGLA.jhCamisa, marca_id: MARCA.jh, gml: NODO.camisa, eq: null, desde: "2026-01", min: 4, max: 8, pct: 80, nota: "acuerdo 2026" },
  { id: REGLA.jhCorta, marca_id: MARCA.jh, gml: NODO.camisa, eq: EQ.corta, desde: "2026-06", min: 3, max: 6, pct: 50, nota: "verano" },
  { id: REGLA.donaTerno, marca_id: MARCA.donatelli, gml: NODO.terno, eq: null, desde: "2025-03", min: 4, max: 8, pct: 60 },
  { id: REGLA.vhPolo, marca_id: MARCA.vh, gml: NODO.polo, eq: null, desde: "2026-01", min: 4, max: 8, pct: 70 },
  { id: REGLA.vhCasaca, marca_id: MARCA.vh, gml: NODO.casaca, eq: null, desde: "2026-01", min: 3, max: 6, pct: 40 },
  { id: REGLA.betaTerno, marca_id: MARCA.beta, gml: NODO.terno, eq: null, desde: "2026-01", min: 4, max: 8, pct: 20 },
];

/** Una fila de `intercompany_reglas` tal como la devuelve la base (columnas de la migración 0020). */
export const reglaDb = (s: ReglaSemilla): Fila => ({
  id: s.id,
  marca_id: s.marca_id,
  genero_mundo_linea_id: s.gml,
  equivalencia_id: s.eq,
  vigente_desde: `${s.desde}-01`,
  cobertura_min_meses: s.min,
  cobertura_max_meses: s.max,
  pct_directo: s.pct,
  nota: s.nota ?? null,
  perfil_id: null,
  usuario_nombre: "Planner Uno",
  activo: true,
  created_at: SELLO,
  updated_at: SELLO,
});
export const reglasDb = (): Fila[] => SEMILLAS.map(reglaDb);

// ─── Cerradas de M7 (solo lo que lee M13: participaciones de las filas base) ───

const parte = (gml: string, marcas: [string, number][], claves: [string | null, number][], conPorMarca: boolean): ParticipacionFilaCerrada => ({
  gml_id: gml,
  por_clave_flujo: claves.map(([marca_id, participacion]) => ({ marca_id, participacion })),
  por_marca: conPorMarca ? marcas.map(([marca_id, participacion]) => ({ marca_id, participacion })) : null,
});

/** Cerrada `0.10.1`: trae `por_marca`; VAN HEUSEN sin tratamiento sale en POLO y CASACA. */
export const filasCerrada0101 = (): ParticipacionFilaCerrada[] => [
  parte(NODO.camisa, [[MARCA.jh, 0.4], [MARCA.alfa, 0.35], [uuid("f", 99), 0.25]], [[MARCA.jh, 0.4], [null, 0.6]], true),
  parte(NODO.terno, [[MARCA.donatelli, 0.3], [MARCA.beta, 0.5], [uuid("f", 99), 0.2]], [[MARCA.donatelli, 0.3], [MARCA.beta, 0.5], [null, 0.2]], true),
  parte(NODO.polo, [[MARCA.vh, 0.25], [MARCA.alfa, 0.75]], [[null, 1]], true),
  parte(NODO.casaca, [[MARCA.vh, 0.1], [MARCA.alfa, 0.9]], [[null, 1]], true),
];

/** Cerrada `0.10.0`: sin `por_marca`; VAN HEUSEN (sin tratamiento) cae en "otras". */
export const filasCerrada0100 = (): ParticipacionFilaCerrada[] => [
  parte(NODO.camisa, [], [[MARCA.jh, 0.4], [null, 0.6]], false),
  parte(NODO.terno, [], [[MARCA.donatelli, 0.3], [MARCA.beta, 0.5], [null, 0.2]], false),
  parte(NODO.polo, [], [[null, 1]], false),
  parte(NODO.casaca, [], [[null, 1]], false),
];

/** La respuesta de `leerParticipacionesDeCerrada` (la lectura ligera que usa M13: solo filas base con sus participaciones). */
export function respuestaCerrada(filas: readonly ParticipacionFilaCerrada[], anio: number) {
  return {
    anio_pedido: anio,
    cubre: "en_curso" as const,
    filas: filas.map((f) => ({
      gml_id: f.gml_id,
      participaciones: { periodo_referencia: null, por_clave_flujo: f.por_clave_flujo, por_marca: f.por_marca, por_talla: [] },
    })),
  };
}
