import { describe, expect, it } from "vitest";
import { hojaFilasPropuestaIa, hojaGMPropuestaIa, hojasPropuestaIa } from "@/lib/ia/excel";
import type { GMIaDetalleApi, GMIaResumenApi } from "@/lib/ia/tipos-api";

/** Hojas de Excel de la pestaña «Propuesta IA» (ficha 07e, §4.1). Sintético. */

const resumen: GMIaResumenApi = {
  gm_clave: "h.u",
  genero: "HOMBRE",
  mundo: "URBANO",
  es_resto: false,
  meta: { pct: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: null, version: 2, meta_gm: 26006, fijas: 3386, fijas_detalle: { decididas: 3300, pct_propio: 0, cola_larga: 86 }, meta_libre: 22620, filas_libres: 3, filas_fijas: 2, fuera_base: { filas: 0, unidades: 0 } },
  estado: "meta_movida",
  motivos: [],
  configuracion_cambiada: false,
  natural_libres: 22000,
  meta_libre: 22620,
  esfuerzo_pct: 2.8181,
  filas_forzadas: 0,
  filas_que_ceden: 0,
  absorcion: { delta_meta_u: 0, desviacion_fijadas_u: 1039, otros_u: 0, absorbido_u: -1039, absorbido_pct: 8.9112 },
  filas_y_sin_decidir: 2,
  propuesta: { id: "p1", created_at: "2026-10-30T15:00:00Z", usuario_nombre: "J. Pérez", modelo: "m", version_prompt: "v1", razon_gm: null, costo_usd: 0.12 },
};

const fila = (linea: string, contra: number): GMIaDetalleApi["filas"][number] => ({
  fila_id: linea,
  propuesta_fila_id: `p-${linea}`,
  estado_meta: "libre",
  estado_gm: "meta_movida",
  motivos: [],
  natural_y1: 10300,
  razon_natural: "crece",
  meta_y1: 10961,
  meta_y1_al_generar: 10961,
  absorbido_u: 0,
  absorbido_pct: 0,
  brecha_u: 661,
  brecha_pct: 6.418,
  contra_metodo_u: contra,
  pct_sobre_corregida: 9.61,
  pct_sobre_real: 9.61,
  razon: "empuja",
  banderas: ["nino"],
  senales: ["quiebres", "nino"],
  confianza: "alta",
  avisos: [],
  aceptable: { y1: true, motivo: null },
  linea,
  equivalencia: null,
  agrupacion_marca: "RECONOCIDO",
  base: 10000,
  base_corregida: 10000,
  aporte_entrantes: 0,
  aporte_salientes: 0,
  metodo_y1: 10800,
  vigente_y1: 10800,
  decidida_y1: false,
  vigente_y: 9600,
  decidida_y: true,
});

const detalle: GMIaDetalleApi = { ...resumen, filas: [fila("POLO", 197), fila("CASACA", -418), fila("DENIM", 161)], contexto: { aperturas_y1: 0, cierres_y1: 0, cola_larga: { filas: 1, unidades: 86 }, vista_previa_curvas: null }, anteriores: [] };

describe("hojas de la propuesta IA", () => {
  it("GM: una fila por género × mundo con la misma cantidad de celdas que cabeceras", () => {
    const h = hojaGMPropuestaIa([resumen]);
    expect(h).toHaveLength(2);
    expect(h[1]).toHaveLength(h[0].length);
    expect(h[1].slice(0, 3)).toEqual(["HOMBRE · URBANO", "HOMBRE", "URBANO"]);
    expect(h[1]).toContain(26006);
    expect(h[1]).toContain(2.8);
    expect(h[1]).toContain(8.9);
    expect(h[1]).toContain("meta_movida");
    expect(h[1]).toContain("2026-10-30");
  });

  it("filas: ordenadas por |IA − método| descendente y con los años de la proyección en las cabeceras", () => {
    const h = hojaFilasPropuestaIa([detalle], 2026);
    expect(h.slice(1).map((f) => f[1])).toEqual(["CASACA", "POLO", "DENIM"]);
    for (const f of h.slice(1)) expect(f).toHaveLength(h[0].length);
    expect(h[0]).toContain("BASE 2027");
    expect(h[0]).toContain("2026 VIGENTE");
    expect(h[1]).toContain("quiebres, nino");
    expect(h[1]).toContain(6.4);
  });

  it("hojasPropuestaIa arma las dos", () => {
    const h = hojasPropuestaIa({ gms: [resumen], detalles: [detalle], anioEnCurso: 2026 });
    expect(Object.keys(h)).toEqual(["GM", "FILAS"]);
  });

  it("sin propuesta ni meta, las celdas quedan vacías", () => {
    const h = hojaGMPropuestaIa([{ ...resumen, meta: null, propuesta: null, absorcion: null, meta_libre: null, esfuerzo_pct: null, natural_libres: null }]);
    expect(h[1].filter((c) => c === null).length).toBeGreaterThan(8);
  });
});
