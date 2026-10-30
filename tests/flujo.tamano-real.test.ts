import { VERSION_METODO_MIN_M8 } from "@/lib/proyeccion/tipos-api";
import { describe, expect, it } from "vitest";
import { aFilaListaApi, aTotalesApi, armarHuecosApi, calcularFlujo, type EntradaCalculoFlujo, type NombresFlujo } from "@/lib/flujo/modelo";
import { totalesDeFilas } from "@/lib/flujo/servicio";
import { claveDeFila, mesesEntre, sumarMes } from "@/lib/flujo/filas";
import type { FilaCerradaFlujo } from "@/lib/flujo/filas";
import type { StockFila, StockMes } from "@/lib/flujo/stock";
import { TAMANO_FLUJO_TIPICO, TAMANO_HUECOS_MAXIMO } from "@/lib/flujo/tipos";
import { construirFlujo } from "./flujo.fixture";

/**
 * Tamaño REAL (hallazgo del QA de M8): `calcularFlujo` con 1 600 filas y los serializadores de producción (`armarHuecosApi`,
 * `aFilaListaApi`, `aTotalesApi`), no los de `construirFlujo`. Tope de `GET /api/flujo/huecos`: 0,4 MB; de `GET /api/flujo` con el
 * horizonte típico (15 meses): 1,5 MB (la lista ya no lleva repartos ni reglas: los usa nadie en la pantalla).
 * Datos inventados; los números varían de fila en fila para que la serie y las señales no sean todas iguales.
 */

const K_PRIMA = "2026-09";
const uuid = (bloque: string, n: number) => `00000000-0000-4000-${bloque}-${String(n).padStart(12, "0")}`;

/** Congruencial lineal: números repetibles. */
function azarDe(semilla: number) {
  let x = semilla;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

function construir(nFilas: number, nAgrupaciones: number, hasta: string) {
  const azar = azarDe(11);
  const nodos = new Map<string, { genero_id: string; mundo_id: string; linea_id: string }>();
  const nombres: NombresFlujo = { nodos: {}, agrupaciones: {}, responsables: {}, marcas: {} };
  const cerrada: FilaCerradaFlujo[] = [];
  const claves: { gml: string; agr: string }[] = [];
  const nGml = Math.ceil(nFilas / nAgrupaciones);
  const generos = ["HOMBRE", "MUJER", "NIÑO"];
  const mundos = ["URBANO", "CASUAL", "FORMAL", "RI", "DEPORTE", "ACCESORIOS"];
  for (let a = 0; a < nAgrupaciones; a++) nombres.agrupaciones[uuid("9000", a)] = `AGRUPACION ${a}`;
  for (let g = 0; g < nGml; g++) {
    const gml = uuid("8000", g);
    const generoId = uuid("a000", g % 3);
    const mundoId = uuid("b000", g % 6);
    const lineaId = uuid("c000", g);
    nodos.set(gml, { genero_id: generoId, mundo_id: mundoId, linea_id: lineaId });
    nombres.nodos[gml] = { genero_id: generoId, mundo_id: mundoId, linea_id: lineaId, genero: generos[g % 3], mundo: mundos[g % 6], linea: `LINEA NUMERO ${g}`, equivalencia: null, nivel: "GML" };
    nombres.responsables[`${generoId}|${mundoId}`] = { perfil_id: uuid("d000", g % 6), nombre: `Comprador ${g % 6}` };
    for (let a = 0; a < nAgrupaciones; a++) {
      if (claves.length >= nFilas) break;
      const agr = uuid("9000", a);
      claves.push({ gml, agr });
      const base = 40 + Math.floor(azar() ** 3 * 600);
      for (const anio of [2026, 2027]) {
        const meses = Array.from({ length: 12 }, (_, i) => Math.round(base * (1 + 0.35 * Math.sin((i / 12) * 2 * Math.PI))));
        cerrada.push({ gml_id: gml, equivalencia_id: null, agrupacion_marca_id: agr, tienda_id: null, anio, total: meses.reduce((x, y) => x + y, 0), meses, participaciones_historicas: null });
      }
    }
  }
  const stock = new Map<string, StockMes>();
  const baseDeFila = new Map(claves.map((c, i) => [`${c.gml}|${c.agr}`, 20 + ((i * 37) % 500)]));
  for (const mes of mesesEntre(sumarMes(K_PRIMA, -12), K_PRIMA)) {
    const filas = new Map<string, StockFila>();
    for (const c of claves) {
      const clave = claveDeFila({ gml_id: c.gml, equivalencia_id: null, agrupacion_marca_id: c.agr });
      const b = baseDeFila.get(`${c.gml}|${c.agr}`) as number;
      const cd = Math.round(b * 3 * azar());
      const tiendas = Math.round(b * 9 * azar());
      const mk = { cd, tiendas, inactivas: 0, unidades: b, unidades_inactivas: 0, cadena: cd + tiendas, negativo: false };
      filas.set(clave, { clave, gml_id: c.gml, equivalencia_id: null, agrupacion_marca_id: c.agr, ...mk, por_marca: new Map([["m1", mk]]) });
    }
    stock.set(mes, { periodo: mes, carga_id: `c-${mes}`, publicada: true, filas, excluido: { stock: 0, unidades: 0 }, sin_clave: { stock: 0, unidades: 0 } });
  }
  const entrada: EntradaCalculoFlujo = {
    reloj: { k_prima: K_PRIMA, k: K_PRIMA, hoy_lima: "2026-10" },
    horizonte: { desde: "2026-10", hasta },
    cubre: "en_curso",
    parametros: { imi_min: 4, imi_max: 8, meses_tarjeta: 6, extender_horizonte: true, umbral_conciliacion_u: 10, umbral_conciliacion_pct: 20 },
    cerrada: { filas: cerrada, version_metodo: VERSION_METODO_MIN_M8, huella_flujo: "h", periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
    huella_flujo_hoy: "h",
    stock,
    compras: { compras: [], lineas: [], entregas: [], repartos: [], recepciones: [] },
    reglas: [],
    resolver: { unidadDeMarca: (x) => x, agrupacionDeMarca: () => null },
    nodos,
    mis_combinaciones: [],
  };
  return { entrada, nombres };
}

const bytes = (valor: unknown) => Buffer.byteLength(JSON.stringify({ data: valor }), "utf8");

describe("tamaño real con 1 600 filas (serializadores de producción)", () => {
  // 400 nodos × 4 agrupaciones (como el QA) y, de peor caso, 800 nodos × 2.
  for (const [nAgr, etiqueta] of [[4, "400 nodos × 4 agrupaciones"], [2, "800 nodos × 2 agrupaciones"]] as const) {
    describe(etiqueta, () => {
      const { entrada, nombres } = construir(1600, nAgr, "2027-12");
      const resultado = calcularFlujo(entrada);
      // «Mis líneas» y una cuarta parte con compras por confirmar, para que haya campos opcionales presentes
      const filas = resultado.filas.map((f, i) => ({ ...f, mia: i % 7 === 0 }));

      it("1 600 tarjetas de Huecos ≤ 0,4 MB con la cabecera de datos", () => {
        expect(filas).toHaveLength(1600);
        const { catalogo, tarjetas } = armarHuecosApi(filas, nombres, 6);
        const datos = construirFlujo({ filas: 2, horizonte: 15 }).datos;
        const cuerpo = { datos, meses: 6, catalogo, tarjetas, mis_combinaciones: [] };
        const total = bytes(cuerpo);
        console.log(`huecos (${etiqueta}): ${(total / 1024).toFixed(0)} KB; tarjetas ${(bytes(tarjetas) / 1600).toFixed(0)} B c/u; catálogo ${(bytes(catalogo) / 1024).toFixed(0)} KB`);
        expect(tarjetas).toHaveLength(1600);
        expect(total).toBeLessThanOrEqual(TAMANO_HUECOS_MAXIMO);
      });

      it("la tarjeta no repite nombres ni ids largos: solo índices al catálogo", () => {
        const { catalogo, tarjetas } = armarHuecosApi(filas, nombres, 6);
        for (const t of tarjetas) {
          expect(Object.keys(t)).not.toEqual(expect.arrayContaining(["gml_id"]));
          expect(catalogo.nodos[t.nodo]).toBeDefined();
          expect(catalogo.agrupaciones[t.agrupacion]).toBeDefined();
        }
        // sin repetidos en el catálogo
        const llaves = catalogo.nodos.map((n) => `${n.gml_id}|${n.equivalencia_id ?? ""}`);
        expect(new Set(llaves).size).toBe(llaves.length);
        expect(new Set(catalogo.lineas).size).toBe(catalogo.lineas.length);
      });

      it("GET /api/flujo (lista + totales + catálogo, sin repartos ni reglas) ≤ 1,5 MB con 16 periodos", () => {
        const n = resultado.periodos.length - 1;
        const lista = {
          filas: filas.map((f) => aFilaListaApi(f, nombres, 6)),
          totales: aTotalesApi(totalesDeFilas(filas, n, resultado.parametros)),
          catalogo: { nodos: nombres.nodos, agrupaciones: nombres.agrupaciones, responsables: nombres.responsables },
          datos: construirFlujo({ filas: 2, horizonte: 15 }).datos,
          mis_combinaciones: [],
        };
        const total = bytes(lista);
        console.log(`flujo (${etiqueta}): ${(total / 1024 / 1024).toFixed(2)} MB`);
        expect(resultado.periodos).toHaveLength(16);
        expect(total).toBeLessThanOrEqual(TAMANO_FLUJO_TIPICO);
      });
    });
  }
});
