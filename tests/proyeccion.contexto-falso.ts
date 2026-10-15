import type { ContextoCalculo } from "@/lib/proyeccion/contexto";
import type { Catalogo } from "@/lib/proyeccion/persistencia";
import type { NodoProy } from "@/lib/proyeccion/tipos";
import { AM, agrupaciones, configFlujo, factores, hechosBase, meses, nodos, periodos, tiendas, vigentes, type Hecho } from "./proyeccion.fixture";

/**
 * El contexto que `servicio.ts` lee de M1 a M6, fabricado con el fixture sintético. Es mutable para que cada caso cambie lo que
 * necesite (una curva nueva, un factor, más nodos para forzar varias tandas).
 */

export const contexto = {
  hechos: [] as Hecho[],
  vigentes: vigentes(),
  factores: factores(),
  /** Nodos de relleno (sin venta) para que la lectura de venta salga en varias tandas. */
  nodosExtra: 0,
  publicadaAt: "2026-09-28T10:00:00.000Z",
  mesesPublicados: meses("2023-01", "2026-09"),
  obsoletas: 0,
  /** Lo que devuelve `calcularEfectoNino` (`null` = sin datos). */
  efectoNino: null as unknown,
};

export function reiniciarContexto() {
  contexto.hechos = hechosBase();
  contexto.vigentes = vigentes();
  contexto.factores = factores();
  contexto.nodosExtra = 0;
  contexto.publicadaAt = "2026-09-28T10:00:00.000Z";
  contexto.mesesPublicados = meses("2023-01", "2026-09");
  contexto.obsoletas = 0;
  contexto.efectoNino = efectoNinoFalso();
}

/** El efecto del Niño por temporada y año, con las cifras del fixture (invierno 0,66 / verano 1,24 en 2026; 0,63 / 0,73 en 2023). */
export function efectoNinoFalso() {
  const fila = (anio: number, temporada: string, ratio: number) => ({
    anio,
    temporada,
    ratio_volumen: ratio,
    ratio_control: 1,
    ratio_relativo: ratio,
    crecimiento_normal: 0.02,
    anio_referencia: anio - 1,
    tiendas_comunes: 8,
    meses_comparados: anio === 2026 && temporada === "verano" ? 1 : 12,
    agrupaciones: 5,
  });
  return {
    entrada: null,
    salida: {
      efecto_atipico: {
        por_temporada: [fila(2023, "invierno", 0.6321), fila(2023, "verano", 0.7298), fila(2026, "invierno", 0.6612), fila(2026, "verano", 1.2441)],
      },
      resultado: { agrupaciones: [], temporadas: [] },
    },
    venta: { meses_publicados: meses("2023-01", "2026-09") },
    periodos: periodos().map((p) => ({ ...p, descripcion: null, temporadas: p.temporadas ?? [], created_at: "", updated_at: "" })),
    activas: [],
    hasta_periodo: "2026-09",
    huella_cargas: "huella-de-prueba",
    cacheada: false,
  };
}
reiniciarContexto();

const NOMBRE_AM: Record<string, string> = { [AM.rec]: "RECONOCIDO", [AM.pre]: "PREMIUM", [AM.val]: "VALOR" };

export function catalogoFalso(): Catalogo {
  const todos = nodos();
  return {
    nodos: new Map(
      todos.map((n) => [
        n.gml_id,
        { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id, genero: n.genero, mundo: n.mundo, linea: n.linea, equivalencias: new Map(n.equivalencias.map((e) => [e.id, e.nombre])) },
      ])
    ),
    agrupacionesMarca: new Map(Object.entries(NOMBRE_AM)),
    agrupacionesEstacionalidad: new Map(agrupaciones().map((a) => [a.id, { nombre: a.nombre, temporada: a.temporada }])),
  };
}

export function contextoFalso(): ContextoCalculo {
  const nodosCalc: NodoProy[] = [
    ...nodos(),
    ...Array.from({ length: contexto.nodosExtra }, (_, i): NodoProy => ({
      gml_id: `relleno-${i}`,
      nivel: "GML",
      genero_id: "g-x",
      mundo_id: "m-x",
      linea_id: "l-x",
      genero: "X",
      mundo: "X",
      linea: `X${i}`,
      equivalencias: [],
    })),
  ];
  const publicados = [...contexto.mesesPublicados];
  const periodosApi = periodos().map((p) => ({ ...p, descripcion: null, temporadas: p.temporadas ?? [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-01T00:00:00.000Z" }));
  return {
    tiendasDb: [],
    tiendas: tiendas(),
    cargas: Object.fromEntries(publicados.map((m) => [m, `carga-${m}`])),
    cargasLista: publicados.map((m) => ({ id: `carga-${m}`, periodo: m, publicada_at: contexto.publicadaAt })),
    publicados,
    catalogo: catalogoFalso(),
    nodos: nodosCalc,
    agrupaciones: agrupaciones(),
    vigentesFilas: [],
    vigentes: contexto.vigentes,
    periodos: periodosApi as never,
    periodosClase: periodos(),
    factoresDb: contexto.factores.map((f) => ({
      id: `f-${f.anio}-${f.temporada}`,
      anio: f.anio,
      temporada: f.temporada,
      ratio_calculado: f.ratio_calculado,
      ratio_aplicado: f.ratio_aplicado,
      huella_cargas: null,
      calculado_at: null,
      tiendas_comunes: null,
      meses_comparados: null,
      parcial: false,
      nota: null,
      perfil_id: null,
      usuario_nombre: null,
      activo: true,
      created_at: "",
      updated_at: "",
    })),
    factores: contexto.factores,
    configFlujo: configFlujo(),
    hoy: "2026-10-15",
    ultimoCerrado: "2026-09",
    hastaDefecto: publicados[publicados.length - 1] ?? null,
  };
}

/** Venta mensual por tienda (lo que lee M6 para la red por datos). */
export function ventaTiendaFalsa() {
  const acum = new Map<string, number>();
  for (const h of contexto.hechos) {
    if (h.tienda === "CD") continue;
    const k = `${h.tienda}|${h.periodo}`;
    acum.set(k, (acum.get(k) ?? 0) + h.unidades);
  }
  return [...acum].map(([k, unidades]) => {
    const [tienda_id, periodo] = k.split("|");
    return { tienda_id, periodo, unidades };
  });
}
