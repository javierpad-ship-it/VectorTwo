import { calcularPromedio } from "../src/lib/proyeccion/crecimientos";
import type { AgregadoCrecimientoApi, FilaResumenCrecimientoApi, ResumenCrecimientosProyeccionApi } from "../src/lib/proyeccion/tipos-api";

/**
 * Datos sintéticos de la pestaña Crecimientos de solo lectura (ficha 06d, §4.2). Las cifras son las del ejemplo de 07c §5.3:
 * HOMBRE · FORMAL 20 % v1 (base 17 800 con una fila con % propio de 4 500 → 4 725 y una decidida de 10 000 → 10 800),
 * HOMBRE · URBANO aplicado 10 % v1 pero hoy aprobado 15 % v2 (50 000 libres: «cambió»), MUJER · CASUAL sin aprobar (aplicó el Resto
 * provisional, 30 000), MUJER · FORMAL 0 % v1 (2 200) y el Resto provisional 5 % (20 000). Σ B = 120 000. Nada real de Lukers.
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
  pct_propio: { filas: 1, base: 4500, siguiente: 4725 },
  decididas: { filas: 1, base: 10000, siguiente: 10800 },
  base_normalizada: 19500,
  rebote_nino_pct: 9.6,
  siguiente_vigente: 19485,
});

const ANIO = 2027;
export const ID_PROY = "proy-1";
const enlace = (g: string, m: string) => `/planificacion/curvas-estacionalidad?gm=${g}.${m}&anio=${ANIO}&proyeccion=${ID_PROY}`;
const APROBADA = "2026-10-20T15:30:00Z";

type Aplicado = FilaResumenCrecimientoApi["aplicado"];
type Vigente = FilaResumenCrecimientoApi["vigente_hoy"];

const aprobado = (pct: number, version: number, por = "Javier"): Aplicado => ({ pct, version, provisional: false, por_nombre: por, at: APROBADA });
const provisional = (pct: number): Aplicado => ({ pct, version: null, provisional: true, por_nombre: null, at: null });
const vigente = (pct: number, version: number, por = "Javier"): NonNullable<Vigente> => ({ pct, version, por_nombre: por, aprobada_at: "2026-10-25T12:00:00Z" });

export function filaResumen(g: string | null, m: string | null, aplicado: Aplicado, vigenteHoy: Vigente, a: AgregadoCrecimientoApi, extra: Partial<FilaResumenCrecimientoApi> = {}): FilaResumenCrecimientoApi {
  const siguiente = a.pct_propio.siguiente + a.decididas.siguiente + a.base_libre * (1 + aplicado.pct / 100);
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
    filaResumen(G_H, M_F, aprobado(20, 1), vigente(20, 1), agregadoHombreFormal),
    filaResumen(G_H, M_U, aprobado(10, 1), vigente(15, 2), agregado(50000)),
    filaResumen(G_M, M_F, aprobado(0, 1), vigente(0, 1), agregado(2200)),
    filaResumen(G_M, M_C, provisional(5), null, agregado(30000)),
  ];
  const resto = { ...filaResumen(null, null, provisional(5), null, agregado(20000)), por_genero: POR_GENERO };
  const { resultado } = calcularPromedio(
    [...filas].map((f) => ({ genero: f.genero ?? "", mundo: f.mundo ?? "", pct: f.aplicado.pct, sin_filas: false, agregado: f.agregado })),
    { pct: resto.aplicado.pct, agregado: resto.agregado },
    12,
    PUENTE
  );
  return {
    anio_siguiente: ANIO,
    version_metodo: 4,
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
    return { ...f, aplicado: aprobado(v.pct, v.version), vigente_hoy: v };
  };
  return { ...r, filas: r.filas.map(alDia), resto: alDia(r.resto), cambiados: [], sin_aprobar: null };
}
