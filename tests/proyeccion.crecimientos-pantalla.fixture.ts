import { calcularPromedio } from "../src/lib/proyeccion/crecimientos";
import type { AgregadoCrecimientoApi, FilaResumenCrecimientoApi, ResumenCrecimientosProyeccionApi, SobreBase } from "../src/lib/proyeccion/tipos-api";
import { VERSION_METODO } from "../src/lib/proyeccion/tipos-api";

/**
 * Datos sintéticos de la pestaña Crecimientos de solo lectura (fichas 06d y 06e, §4.2). Las cifras parten de las de 07c §5.3 y ganan la base
 * corregida del Niño (método 5):
 * HOMBRE · FORMAL 20 % v1 sobre corregido (base real 17 800 y corregida 19 500: una fila con % propio de 4 500 → 4 900 → 5 250, una decidida de
 * 10 000 → 10 800 y una libre de 3 300 → 4 600 × 1,20 = 5 520; resultado 21 570), HOMBRE · URBANO aplicado 10 % v1 pero hoy aprobado 15 % v2
 * (50 000 reales y 53 400 corregidos, todo libre: «cambió»; 58 740), MUJER · CASUAL sin aprobar (aplicó el Resto provisional, 30 000),
 * MUJER · FORMAL 0 % v1 (2 200) y el Resto provisional 5 % (20 000). Σ B real = 120 000, Σ B' = 125 100. Nada real de Lukers.
 */

export const G_H = "g-hombre";
export const G_M = "g-mujer";
export const M_F = "m-formal";
export const M_U = "m-urbano";
export const M_C = "m-casual";

export function agregado(base: number, extra: Partial<AgregadoCrecimientoApi> = {}): AgregadoCrecimientoApi {
  return {
    filas: base > 0 ? 3 : 0,
    filas_sin_base: 0,
    base,
    base_libre: base,
    pct_propio: { filas: 0, base: 0, siguiente: 0 },
    decididas: { filas: 0, base: 0, siguiente: 0 },
    base_normalizada: base,
    rebote_nino_pct: null,
    siguiente_vigente: base,
    ...extra,
  };
}

/** HOMBRE · FORMAL: 3 filas, una con % propio, una decidida y una libre con meses del Niño. */
export const agregadoHombreFormal = agregado(17800, {
  filas: 3,
  base_libre: 3300,
  base_libre_corregida: 4600,
  pct_propio: { filas: 1, base: 4500, siguiente: 5250, base_corregida: 4900 },
  decididas: { filas: 1, base: 10000, siguiente: 10800, base_corregida: 10000 },
  base_normalizada: 19500,
  rebote_nino_pct: 9.6,
  siguiente_vigente: 21570,
});

const ANIO = 2027;
export const ID_PROY = "proy-1";
const enlace = (g: string, m: string) => `/planificacion/curvas-estacionalidad?gm=${g}.${m}&anio=${ANIO}&proyeccion=${ID_PROY}`;
const APROBADA = "2026-10-20T15:30:00Z";

type Aplicado = FilaResumenCrecimientoApi["aplicado"] & { sobre_base?: SobreBase };
type Vigente = FilaResumenCrecimientoApi["vigente_hoy"];

const aprobado = (pct: number, version: number, por = "Javier", sobre?: SobreBase): Aplicado => ({ pct, version, provisional: false, por_nombre: por, at: APROBADA, ...(sobre ? { sobre_base: sobre } : {}) });
const provisional = (pct: number): Aplicado => ({ pct, version: null, provisional: true, por_nombre: null, at: null });
const vigente = (pct: number, version: number, por = "Javier"): NonNullable<Vigente> => ({ pct, version, por_nombre: por, aprobada_at: "2026-10-25T12:00:00Z" });

export function filaResumen(g: string | null, m: string | null, aplicado: Aplicado, vigenteHoy: Vigente, a: AgregadoCrecimientoApi, extra: Partial<FilaResumenCrecimientoApi> = {}): FilaResumenCrecimientoApi {
  // Método 5: el % se aplica sobre la base libre CORREGIDA; una versión `bruta` (antes de 0.14.0) sobre la real.
  const libre = aplicado.sobre_base === "bruta" ? a.base_libre : (a.base_libre_corregida ?? a.base_libre);
  const siguiente = a.pct_propio.siguiente + a.decididas.siguiente + libre * (1 + aplicado.pct / 100);
  return {
    clave: g && m ? `${g}.${m}` : "resto",
    genero: g ? (g === G_H ? "HOMBRE" : "MUJER") : null,
    mundo: m ? (m === M_F ? "FORMAL" : m === M_U ? "URBANO" : "CASUAL") : null,
    aplicado,
    vigente_hoy: vigenteHoy,
    agregado: { ...a, siguiente_vigente: Math.round(siguiente) },
    resultante_pct: a.base > 0 ? (siguiente / a.base - 1) * 100 : null,
    enlace: g && m ? enlace(g, m) : `/planificacion/curvas-estacionalidad?gm=resto&anio=${ANIO}&proyeccion=${ID_PROY}`,
    ...extra,
  };
}

const POR_GENERO = [
  { genero: "JOVENCITOS", base: 8200 },
  { genero: "NIÑOS", base: 6100 },
  { genero: "ACCESORIOS", base: 5700 },
];

const PUENTE = { total_en_curso: 118000, nuevas_anterior: 0, aperturas: 914, cierres: 0, cierres_sin_decidir: 0 };

export function resumenCrecimientos(extra: Partial<ResumenCrecimientosProyeccionApi> = {}): ResumenCrecimientosProyeccionApi {
  const filas = [
    filaResumen(G_H, M_F, aprobado(20, 1, "Javier", "corregida"), vigente(20, 1), agregadoHombreFormal),
    filaResumen(G_H, M_U, aprobado(10, 1, "Javier", "corregida"), vigente(15, 2), agregado(50000, { base_normalizada: 53400, base_libre_corregida: 53400, rebote_nino_pct: 6.8 })),
    filaResumen(G_M, M_F, aprobado(0, 1), vigente(0, 1), agregado(2200)),
    filaResumen(G_M, M_C, provisional(5), null, agregado(30000)),
  ];
  const resto = { ...filaResumen(null, null, provisional(5), null, agregado(20000)), por_genero: POR_GENERO };
  const { resultado } = calcularPromedio(
    [...filas].map((f) => ({ genero: f.genero ?? "", mundo: f.mundo ?? "", pct: f.aplicado.pct, sin_filas: false, agregado: f.agregado })),
    { pct: resto.aplicado.pct, agregado: resto.agregado },
    12,
    PUENTE,
    { sobre: "corregida" }
  );
  return {
    anio_siguiente: ANIO,
    version_metodo: VERSION_METODO,
    filas,
    resto,
    total: resultado,
    puente: PUENTE,
    objetivo_pct: 12,
    cambiados: [{ clave: `${G_H}.${M_U}`, nombre: "HOMBRE · URBANO", aplicado: { pct: 10, version: 1 }, vigente: { pct: 15, version: 2 } }],
    sin_aprobar: { faltan: [{ clave: `${G_M}.${M_C}`, nombre: "MUJER · CASUAL" }], resto_provisional: true },
    ...extra,
  };
}

/** Todo aprobado y aplicado (también el Resto): nada cambió y nada falta. */
export function resumenAlDia(): ResumenCrecimientosProyeccionApi {
  const r = resumenCrecimientos();
  const alDia = <T extends FilaResumenCrecimientoApi>(f: T): T => {
    const v = f.vigente_hoy ?? vigente(f.aplicado.pct, 1);
    return { ...f, aplicado: aprobado(v.pct, v.version, "Javier", "corregida"), vigente_hoy: v };
  };
  return { ...r, filas: r.filas.map(alDia), resto: alDia(r.resto), cambiados: [], sin_aprobar: null };
}

/** HOMBRE · URBANO sigue en su versión de antes de 0.14.0 (15 % v1 `bruta`, ejemplo D de 06e): el GM tuvo Niño material (+6,8 %) y hay que reaprobarla. */
export function resumenConReaprobar(): ResumenCrecimientosProyeccionApi {
  const r = resumenAlDia();
  const filas = r.filas.map((f) =>
    f.clave === `${G_H}.${M_U}` ? { ...f, aplicado: { ...f.aplicado, pct: 15, version: 1, sobre_base: "bruta" as const }, vigente_hoy: vigente(15, 1), agregado: { ...f.agregado, siguiente_vigente: 57500 } } : f
  );
  return { ...r, filas, sin_aprobar: { faltan: [], resto_provisional: false, reaprobar: [{ clave: `${G_H}|${M_U}`, nombre: "HOMBRE · URBANO", version: 1, correccion_pct: 6.8 }] } };
}
