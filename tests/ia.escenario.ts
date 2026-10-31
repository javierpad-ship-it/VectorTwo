import type { Catalogo } from "@/lib/proyeccion/persistencia";
import { sembrar, sembrarIa, type Fila } from "./ia.fake-db";

/**
 * Escenario sintético de la propuesta con IA (ficha 07e, ejemplo A de §5.6): HOMBRE · URBANO con `g = 8 %` sobre corregido, umbral de cola larga 100 y
 * cinco filas. Todo inventado: ni una marca, tienda ni cifra reales. `sembrarGM` también arma GM grandes (para el modo jerárquico).
 */

export const ANIO = 2026;
export const CALCULADO_AT = "2026-10-15T15:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const GEN_H = uuid(0xa001);
export const GEN_M = uuid(0xa002);
export const MUN_U = uuid(0xb001);
export const MUN_C = uuid(0xb002);
export const CLAVE_GM = `${GEN_H}.${MUN_U}`;
export const AM = { rec: uuid(0xe001), val: uuid(0xe002), mid: uuid(0xe003) } as const;
export const NOMBRE_AM: Record<string, string> = { [AM.rec]: "RECONOCIDO", [AM.val]: "VALOR", [AM.mid]: "MID VALUE" };

export type FilaSemilla = {
  linea: string;
  am: string;
  /** `B` y `B'`. */
  B: number;
  Bc: number;
  /** `propuesto` de `Y+1` (`round(B' × 1,08)` en el ejemplo A). */
  P: number;
  decidido?: number | null;
  /** Cierre de `Y` (por defecto 9 600). */
  cierreY?: number;
  decididoY?: number | null;
  avisos?: string[];
  crecimiento_pct?: number | null;
};

export const FILAS_A: FilaSemilla[] = [
  { linea: "DENIM", am: AM.rec, B: 10000, Bc: 10000, P: 10800 },
  { linea: "POLO", am: AM.val, B: 6000, Bc: 6000, P: 6480 },
  { linea: "CASACA", am: AM.rec, B: 4000, Bc: 5000, P: 5400 },
  { linea: "BUZO", am: AM.mid, B: 3000, Bc: 3000, P: 3240, decidido: 3300 },
  { linea: "GORRO", am: AM.val, B: 80, Bc: 80, P: 86 },
];

const mes = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;

function historico(total: number) {
  const anios = [2023, 2024, 2025, 2026].map((anio, i) => {
    const hasta = anio === ANIO ? 9 : 12;
    const t = Math.round(total * (0.85 + 0.05 * i));
    return {
      anio,
      clase: anio === ANIO ? "en_curso" : "normal",
      meses_atipicos: [],
      total: t,
      total_normalizado: t,
      tiendas: [],
      meses: Array.from({ length: hasta }, (_, j) => ({ periodo: mes(anio, j + 1), unidades: Math.round(t / 12), venta_soles: 0, stock_fin: 0, cobertura: null, quiebre: false, atipico: false })),
    };
  });
  return { anios, tendencia: 3, prueba_anterior: null, pesos_equivalencias: [], salientes: [] };
}

export type EscenarioSembrado = { proyeccionId: string; gmlIds: string[]; filaIds: string[]; claves: string[]; catalogo: Catalogo };

/** Siembra generos, mundos, la proyección en trabajo (método 5), su foto de crecimientos y las filas base de HOMBRE · URBANO. */
export function sembrarGM(filas: FilaSemilla[] = FILAS_A, opciones: { pct?: number; sobre?: "corregida" | "bruta"; gm?: { genero: string; mundo: string } } = {}): EscenarioSembrado {
  sembrar("generos", [
    { id: GEN_H, nombre: "HOMBRE", orden: 1, activo: true },
    { id: GEN_M, nombre: "MUJER", orden: 2, activo: true },
  ]);
  sembrar("mundos", [
    { id: MUN_U, nombre: "URBANO", orden: 1, activo: true },
    { id: MUN_C, nombre: "CASUAL", orden: 2, activo: true },
  ]);
  const [p] = sembrar("proyecciones", [
    {
      anio_en_curso: ANIO,
      nombre: "Proyección de prueba",
      estado: "en_trabajo",
      hasta_periodo: "2026-09",
      calculado_at: CALCULADO_AT,
      calculando_desde: null,
      parametros: {
        crecimiento_pct_defecto: 5,
        umbral_cola_larga: 100,
        crecimiento_resto_usado: { pct: 5, crecimiento_id: null, version: null, por_nombre: null, at: null, sobre_base: "corregida" },
        factores_usados: [],
        bloques: { [ANIO]: { mismas: [{ tienda_id: "t-1", codigo: "T1", nombre: "Tienda uno", fecha_apertura: "2020-01-01", fecha_cierre: null, motivo: "misma", clave: "11111" }], nuevas: [], cierres: [], fuera: [] } },
      },
      resumen: { version_metodo: 5, temporadas_filas: [], curvas_usadas: [], filas: filas.length },
      huella_flujo: null,
    },
  ]);
  const proyeccionId = p.id as string;
  sembrar("proyeccion_crecimientos", [{ proyeccion_id: proyeccionId, genero_id: GEN_H, mundo_id: MUN_U, pct: opciones.pct ?? 8, sobre_base: opciones.sobre ?? "corregida", crecimiento_id: uuid(0xc001), version: 1, nota: null, perfil_id: null, usuario_nombre: null }]);

  const lineas = [...new Set(filas.map((f) => f.linea))];
  const gmlDe = (linea: string) => uuid(0xd000 + lineas.indexOf(linea));
  const nodos = new Map<string, { genero_id: string; mundo_id: string; linea_id: string; genero: string; mundo: string; linea: string; equivalencias: Map<string, string> }>();
  for (const l of lineas) nodos.set(gmlDe(l), { genero_id: GEN_H, mundo_id: MUN_U, linea_id: uuid(0xf000 + lineas.indexOf(l)), genero: "HOMBRE", mundo: "URBANO", linea: l, equivalencias: new Map() });

  const filaIds: string[] = [];
  const claves: string[] = [];
  filas.forEach((s, i) => {
    const gml = gmlDe(s.linea);
    const clave = `|${gml}||${s.am}-${String(i).padStart(4, "0")}`;
    claves.push(clave);
    const [f] = sembrar("proyeccion_filas", [
      { proyeccion_id: proyeccionId, tienda_id: null, gml_id: gml, equivalencia_id: null, agrupacion_marca_id: s.am, clave, nivel_proyectado: "GML", agrupacion_estacionalidad_id: null, temporada: "todo_el_ano", curva: null, curva_origen: [], factores_mes: null, historico: historico(s.B * 1.2), participaciones: null, composicion: null, avisos: [], activo: true },
    ]);
    filaIds.push(f.id as string);
    const cierre = s.cierreY ?? 9600;
    const y: Fila = { fila_id: f.id, anio: ANIO, bloque: "mismas", subbloque: null, vendido: 7200, propuesto: cierre, metodo: "avance", explicacion: "", decidido: s.decididoY ?? null, origen: s.decididoY == null ? null : "manual", avisos: [], activo: true };
    const sig: Fila = {
      fila_id: f.id,
      anio: ANIO + 1,
      bloque: "mismas",
      subbloque: null,
      vendido: 0,
      propuesto: s.P,
      metodo: "crecimiento",
      explicacion: "",
      crecimiento_pct: s.crecimiento_pct ?? null,
      base_siguiente: s.B,
      base_normalizada: s.Bc,
      decidido: s.decidido ?? null,
      origen: s.decidido == null ? null : "manual",
      avisos: s.avisos ?? [],
      activo: true,
    };
    sembrar("proyeccion_fila_anios", [y, sig]);
  });

  return {
    proyeccionId,
    gmlIds: lineas.map(gmlDe),
    filaIds,
    claves,
    catalogo: { nodos, agrupacionesMarca: new Map(Object.entries(NOMBRE_AM)), ordenAgrupacionesMarca: new Map(Object.keys(NOMBRE_AM).map((k, i) => [k, i])), agrupacionesEstacionalidad: new Map() } as unknown as Catalogo,
  };
}

/** `n` filas libres sintéticas repartidas en `lineas` líneas (para el modo jerárquico): `B' = 1000 + 10 i`, `P = round(B' × 1,08)`. */
export function filasGrandes(n: number, lineas: number): FilaSemilla[] {
  return Array.from({ length: n }, (_, i) => {
    const Bc = 1000 + 10 * i;
    return { linea: `LINEA ${String.fromCharCode(65 + (i % lineas))}`, am: i % 2 === 0 ? AM.rec : AM.val, B: Bc, Bc, P: Math.round(Bc * 1.08) };
  });
}

/** Una configuración vigente con la capacidad encendida (los números son los de la `0030`; los precios, sintéticos y sin proveedor real). */
export function sembrarConfig(extra: Fila = {}): Fila {
  const [c] = sembrarIa("ia_configuraciones", [
    {
      version: 1,
      estado: "vigente",
      proveedor: "openai",
      modelo: "modelo-a",
      version_prompt: "v1",
      capacidades: ["distribucion_y1"],
      evaluacion_id: null,
      precios: { entrada: 2, entrada_cache: 0.5, salida: 8 },
      terminos_extra: [],
      usuario_nombre: "Javier",
      ...extra,
    },
  ]);
  return c;
}
