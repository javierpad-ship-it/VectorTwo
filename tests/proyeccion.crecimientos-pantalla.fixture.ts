import type { AgregadoCrecimientoApi, CeldaCrecimientoApi, ConflictoFilasManualesApi, RespuestaCrecimientosApi, RespuestaGuardarCrecimientosApi } from "../src/lib/proyeccion/tipos-api";

/**
 * Datos sintéticos de la pestaña Crecimientos (ficha 07c, §5.2 y §5.3). Las cifras son las del ejemplo de la ficha:
 * HOMBRE · FORMAL 20 % (base 17 800 con una fila con % propio de 4 500 → 4 725 y una decidida de 10 000 → 10 800),
 * HOMBRE · URBANO 10 % (50 000 libres), MUJER · CASUAL 15 % (30 000), MUJER · FORMAL 0 % (2 200) y el Resto 5 % (20 000).
 * HOMBRE · CASUAL y MUJER · URBANO no tienen filas. Σ B = 120 000. Nada real de Lukers.
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

export function celda(genero_id: string, mundo_id: string, pct: number | null, a: AgregadoCrecimientoApi | null, extra: Partial<CeldaCrecimientoApi> = {}): CeldaCrecimientoApi {
  return { genero_id, mundo_id, pct, nota: null, actualizado_por: null, actualizado_at: null, sin_filas: a === null, agregado: a ?? agregado(0, { filas: 0 }), ...extra };
}

/** HOMBRE · FORMAL del ejemplo de §5.3: 3 filas, una con % propio, una decidida y una libre con meses del Niño. */
export const agregadoHombreFormal = agregado(17800, {
  filas: 3,
  base_libre: 3300,
  pct_propio: { filas: 1, base: 4500, siguiente: 4725 },
  decididas: { filas: 1, base: 10000, siguiente: 10800 },
  base_normalizada: 19500,
  rebote_nino_pct: 9.6,
  siguiente_vigente: 19485,
});

export function respuestaCrecimientos(extra: Partial<RespuestaCrecimientosApi> = {}): RespuestaCrecimientosApi {
  return {
    editable: true,
    anio_en_curso: 2026,
    anio_siguiente: 2027,
    huella: "huella-1",
    al_dia: true,
    metodo_viejo: false,
    generos: [
      { id: G_H, nombre: "HOMBRE" },
      { id: G_M, nombre: "MUJER" },
    ],
    generos_faltantes: [],
    mundos: [
      { id: M_F, nombre: "FORMAL", orden: 1 },
      { id: M_U, nombre: "URBANO", orden: 2 },
      { id: M_C, nombre: "CASUAL", orden: 3 },
    ],
    celdas: [
      celda(G_H, M_F, 20, agregadoHombreFormal),
      celda(G_M, M_F, 0, agregado(2200)),
      celda(G_H, M_U, 10, agregado(50000)),
      celda(G_M, M_U, null, null),
      celda(G_H, M_C, null, null),
      celda(G_M, M_C, 15, agregado(30000)),
    ],
    resto: {
      pct: 5,
      nota: null,
      actualizado_por: null,
      actualizado_at: null,
      agregado: agregado(20000),
      por_genero: [
        { genero: "JOVENCITOS", base: 8200 },
        { genero: "NIÑOS", base: 6100 },
        { genero: "ACCESORIOS", base: 5700 },
      ],
    },
    objetivo_pct: 12,
    puente: { total_en_curso: 118000, nuevas_anterior: 0, aperturas: 914, cierres: 0, cierres_sin_decidir: 0 },
    ...extra,
  };
}

/** Una respuesta sin ninguna celda escrita (proyección nueva): todo sigue el Resto. */
export function respuestaCrecimientosVacia(): RespuestaCrecimientosApi {
  const r = respuestaCrecimientos({ objetivo_pct: null });
  return { ...r, celdas: r.celdas.map((c) => ({ ...c, pct: null })) };
}

export function conflicto(extra: Partial<ConflictoFilasManualesApi> = {}): ConflictoFilasManualesApi {
  const base = { genero: "HOMBRE", mundo: "FORMAL", linea: "TERNO", equivalencia: null, agrupacion_marca: "PREMIUM" };
  return {
    error: "Este cambio choca con filas fijadas a mano.",
    codigo: "filas_manuales",
    huella_choque: "choque-1",
    pct_propio: { total: 12, filas: [{ ...base, fila_id: "fila-pantalon", linea: "PANTALON", agrupacion_marca: "VALOR", pct_fila: 5, pct_nuevo: 12 }] },
    decididas: { total: 5, filas: [{ ...base, fila_id: "fila-camisa", linea: "CAMISA", equivalencia: "CLASICA", agrupacion_marca: "RECONOCIDO", decidido: 10800, propuesta_nueva_estimada: 11500 }] },
    ...extra,
  };
}

export function resultadoGuardado(extra: Partial<RespuestaGuardarCrecimientosApi> = {}): RespuestaGuardarCrecimientosApi {
  return { ...respuestaCrecimientos(), pisadas: [], conservadas: 0, revertidas: [], celdas_descartadas: [], recalculo: { ok: true }, ...extra };
}
