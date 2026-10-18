import type { ArbolRespuesta } from "../src/lib/arbol/tipos-api";
import type { ReglaIntercompanyApi } from "../src/lib/intercompany/tipos-api";

/**
 * Datos SINTÉTICOS de la pantalla de intercompany (M13): marcas y nodos de la ficha 13 sección 9 con ids inventados. Nada de datos
 * reales de Lukers ni códigos reales de tienda.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  jh: id(1),
  donatelli: id(2),
  vanHeusen: id(3),
  hombre: id(10),
  mujer: id(11),
  formal: id(20),
  casual: id(21),
  ri: id(22),
  urbano: id(23),
  nodoCamisa: id(30),
  nodoTerno: id(31),
  nodoPoloHombre: id(32),
  nodoCasaca: id(33),
  nodoPoloMujer: id(34),
  nodoDenim: id(35),
  lineaCamisa: id(40),
  lineaTerno: id(41),
  lineaPolo: id(42),
  lineaCasaca: id(43),
  lineaDenim: id(44),
  mangaLarga: id(50),
  mangaCorta: id(51),
};

const linea = (nodo: string, lineaId: string, nombre: string, nivel: "GML" | "GMLE" = "GML", equivalencias: { id: string; nombre: string }[] = []) => ({
  nodo_id: nodo,
  linea_id: lineaId,
  codigo: nombre,
  nombre,
  temporada: "TODO_ANIO" as never,
  activo_linea: true,
  activo_nodo: true,
  vigente: true,
  nivel_planificacion: nivel,
  equivalencias: equivalencias.map((e) => ({ id: e.id, codigo: e.nombre, nombre: e.nombre, es_generica: false, activo: true, agrupacion_estacionalidad: null })),
});

export function arbolEjemplo(): ArbolRespuesta {
  const mundo = (mid: string, nombre: string, lineas: ReturnType<typeof linea>[]) => ({ id: mid, codigo: nombre, nombre, orden: 1, activo: true, lineas });
  return {
    generos: [
      {
        id: IDS.hombre,
        codigo: "HOMBRE",
        nombre: "HOMBRE",
        orden: 1,
        activo: true,
        mundos: [
          mundo(IDS.formal, "FORMAL", [linea(IDS.nodoCamisa, IDS.lineaCamisa, "CAMISA", "GMLE", [{ id: IDS.mangaLarga, nombre: "MANGA LARGA" }, { id: IDS.mangaCorta, nombre: "MANGA CORTA" }]), linea(IDS.nodoTerno, IDS.lineaTerno, "TERNO")]),
          mundo(IDS.casual, "CASUAL", [linea(IDS.nodoPoloHombre, IDS.lineaPolo, "POLO")]),
          mundo(IDS.ri, "RI", [linea(IDS.nodoCasaca, IDS.lineaCasaca, "CASACA")]),
          mundo(IDS.urbano, "URBANO", [linea(IDS.nodoDenim, IDS.lineaDenim, "DENIM")]),
        ],
      },
      { id: IDS.mujer, codigo: "MUJER", nombre: "MUJER", orden: 2, activo: true, mundos: [mundo(IDS.casual, "CASUAL", [linea(IDS.nodoPoloMujer, IDS.lineaPolo, "POLO")])] },
    ],
    resumen: { generos: 2, mundos: 4, lineas: 5, nodos: 6, equivalencias: 2, equivalencias_sin_agrupacion: 2, nodos_gmle: 1, equivalencias_en_gmle: 2 },
  };
}

export function regla(extra: Partial<ReglaIntercompanyApi> & Pick<ReglaIntercompanyApi, "id">): ReglaIntercompanyApi {
  return {
    marca_id: IDS.jh,
    marca: "JH",
    genero_mundo_linea_id: IDS.nodoCamisa,
    equivalencia_id: null,
    ruta: "HOMBRE · FORMAL · CAMISA",
    nivel: "GMLE",
    vigente_desde: "2026-01",
    hasta_derivado: null,
    imi_min: 4,
    imi_max: 8,
    es_rango_defecto: true,
    pct_directo: 80,
    pct_cd: 20,
    pct_directo_observado: null,
    nota: null,
    usuario_nombre: "Planner de prueba",
    updated_at: "2026-10-01T12:00:00Z",
    aplicable: true,
    motivo_no_aplicable: null,
    fuera_de_ambito: false,
    avisos: [],
    ...extra,
  };
}

/** Las seis reglas de la ficha (sección 9), con una segunda vigencia de JH en CAMISA para el historial. */
export function reglasEjemplo(): ReglaIntercompanyApi[] {
  return [
    regla({ id: "r1", hasta_derivado: "2026-05" }),
    regla({ id: "r1b", vigente_desde: "2026-06", hasta_derivado: null, imi_min: 3, imi_max: 6, es_rango_defecto: false, pct_directo: 60, pct_cd: 40, nota: "acuerdo nuevo" }),
    regla({ id: "r2", equivalencia_id: IDS.mangaCorta, ruta: "HOMBRE · FORMAL · CAMISA › MANGA CORTA", vigente_desde: "2026-06", imi_min: 3, imi_max: 6, es_rango_defecto: false, pct_directo: 50, pct_cd: 50, nota: "verano" }),
    regla({ id: "r3", marca_id: IDS.donatelli, marca: "DONATELLI", genero_mundo_linea_id: IDS.nodoTerno, ruta: "HOMBRE · FORMAL · TERNO", nivel: "GML", vigente_desde: "2025-03", pct_directo: 60, pct_cd: 40 }),
    regla({ id: "r4", marca_id: IDS.vanHeusen, marca: "VAN HEUSEN", genero_mundo_linea_id: IDS.nodoPoloHombre, ruta: "HOMBRE · CASUAL · POLO", nivel: "GML", pct_directo: 70, pct_cd: 30, aplicable: false, motivo_no_aplicable: "marca_sin_clave" }),
    regla({ id: "r5", marca_id: IDS.vanHeusen, marca: "VAN HEUSEN", genero_mundo_linea_id: IDS.nodoCasaca, ruta: "HOMBRE · RI · CASACA", nivel: "GML", imi_min: 3, imi_max: 6, es_rango_defecto: false, pct_directo: 40, pct_cd: 60, aplicable: null, motivo_no_aplicable: "sin_cerrada" }),
    regla({ id: "r6", marca_id: IDS.jh, marca: "JH", genero_mundo_linea_id: IDS.nodoPoloMujer, ruta: "MUJER · CASUAL · POLO", nivel: "GML", pct_directo: 10, pct_cd: 90, fuera_de_ambito: true }),
  ];
}
