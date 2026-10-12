import { describe, expect, it } from "vitest";
import { construirIndiceOrigenes, origenesDeGrupo } from "@/app/(app)/planificacion/venta-stock/origenes-mapeo";
import { valorGrupoCombinacion } from "@/lib/ventas/informe";
import { esMotivoMapeable } from "@/lib/ventas/mapeos";
import type { FilaCruda } from "@/lib/ventas/tipos";
import { acumular, informe as armar, mapeo, resoluciones } from "./ventas.fixture";

/**
 * La pantalla deriva los orígenes de cada grupo de error recorriendo el
 * acumulador; el informe agrupa por `valor`. Si las dos cuentas se separan, un
 * grupo del reporte quedaría sin orígenes asignables (o con filas de menos).
 * Este test las ata con un archivo sintético que mezcla motivos mapeables y no.
 */

const FILAS: Partial<FilaCruda>[] = [
  // equivalencia inexistente (dos grupos, uno con dos marcas)
  { equivalencia: "JEAN", venta_soles: "100" },
  { equivalencia: "JEAN", marca: "BETA", venta_soles: "50" },
  { genero: "MUJER", equivalencia: "FOO", venta_soles: "70" },
  // línea desconocida: `-` y otra equivalencia caen en el mismo grupo (dos orígenes)
  { linea: "QQ", equivalencia: "-", venta_soles: "30" },
  { linea: "QQ", equivalencia: "X", venta_soles: "40" },
  // género que no existe: «HOMBRES» con dos orígenes, y «XX»
  { genero: "HOMBRES", equivalencia: "JEAN", venta_soles: "60" },
  { genero: "HOMBRES", mundo: "URBANO", linea: "POLO", equivalencia: "-", venta_soles: "20" },
  { genero: "XX", venta_soles: "10" },
  // clasificación incompleta (género vacío; género y mundo con solo la línea)
  { genero: "", equivalencia: "-", venta_soles: "80" },
  { mundo: "", linea: "", venta_soles: "5" },
  // nodo inexistente, línea inactiva
  { genero: "MUJER", mundo: "URBANO", linea: "DENIM", equivalencia: "", venta_soles: "90" },
  { linea: "BERMUDA", equivalencia: "-", venta_soles: "15" },
  // mismo error en otro mes
  { mes: "Ago", equivalencia: "JEAN", venta_soles: "25" },
  { mes: "Ago", genero: "HOMBRES", equivalencia: "JEAN", venta_soles: "35" },
  // no mapeables
  { tienda: "", venta_soles: "11" }, // tienda_vacia (gana a la combinación)
  { tienda: "", genero: "XX", venta_soles: "12" }, // tienda_vacia con combinación desconocida: no cuenta como origen
  { tienda: "LOCAL X", genero: "XX", venta_soles: "13" }, // tienda_desconocida
  { talla: "XL", genero: "XX", venta_soles: "14" }, // talla_desconocida
  { marca: "VIEJA", venta_soles: "16" }, // marca_inactiva
  { genero: "", mundo: "", linea: "", venta_soles: "17" }, // sin_clasificar
  { unidades: "0", venta_soles: "0", costo_vendido: "0", stock_unidades: "0", stock_valorizado: "0" }, // fila_en_cero
  // y filas buenas
  {},
  { equivalencia: "-", linea: "DENIM" },
];

describe("derivación de orígenes de la pantalla frente al informe", () => {
  const r = armar(FILAS);
  const res = resoluciones(r.acumulador);
  const indice = construirIndiceOrigenes(r.acumulador, res);

  it("el escenario cubre más de seis grupos mapeables y también no mapeables", () => {
    const todos = r.informe.meses.flatMap((m) => m.exclusiones);
    const mapeables = todos.filter((e) => esMotivoMapeable(e.motivo));
    expect(mapeables.length).toBeGreaterThan(6);
    expect(new Set(mapeables.map((e) => e.motivo))).toEqual(
      new Set(["equivalencia_inexistente", "linea_desconocida", "genero_desconocido", "clasificacion_incompleta", "nodo_inexistente", "linea_inactiva"])
    );
    const no = new Set(todos.filter((e) => !esMotivoMapeable(e.motivo)).map((e) => e.motivo));
    for (const m of ["tienda_vacia", "tienda_desconocida", "talla_desconocida", "marca_inactiva", "sin_clasificar", "fila_en_cero"] as const) {
      expect(no.has(m), m).toBe(true);
    }
  });

  it("cada exclusión mapeable tiene orígenes con exactamente sus filas y medidas; las no mapeables, ninguno", () => {
    for (const m of r.informe.meses) {
      for (const e of m.exclusiones) {
        const origenes = origenesDeGrupo(indice, m.periodo, e);
        if (!esMotivoMapeable(e.motivo)) {
          expect(origenes, `${m.periodo} ${e.motivo} ${e.valor}`).toEqual([]);
          continue;
        }
        const clave = `${m.periodo} ${e.motivo} «${e.valor}»`;
        expect(origenes.length, clave).toBeGreaterThan(0);
        expect(origenes.reduce((s, o) => s + o.filas, 0), clave).toBe(e.filas);
        expect(origenes.reduce((s, o) => s + o.venta_soles, 0), clave).toBeCloseTo(e.venta_soles, 2);
        expect(origenes.reduce((s, o) => s + o.stock_valorizado, 0), clave).toBeCloseTo(e.stock_valorizado, 2);
        for (const o of origenes) {
          expect(o.motivo, clave).toBe(e.motivo);
          expect(o.origen.equivalencia, clave).not.toBe("");
        }
      }
    }
  });

  it("un grupo con varios orígenes los lista todos (línea QQ: `-` y X; género HOMBRES: dos combinaciones)", () => {
    const set = r.informe.meses.find((m) => m.periodo === "2026-09");
    const qq = set?.exclusiones.find((e) => e.motivo === "linea_desconocida");
    expect(origenesDeGrupo(indice, "2026-09", qq!).map((o) => o.origen.equivalencia).sort()).toEqual(["QQ", "X"]);
    const hombres = set?.exclusiones.find((e) => e.motivo === "genero_desconocido" && e.valor === "HOMBRES");
    expect(origenesDeGrupo(indice, "2026-09", hombres!)).toHaveLength(2);
  });

  it("los orígenes derivados son los que, una vez mapeados, vacían el grupo de errores (ida y vuelta con el informe)", () => {
    const mapeos = [...indice.values()].flat().map((o, i) =>
      mapeo(`m${i}`, [o.origen.genero, o.origen.mundo, o.origen.linea, o.origen.equivalencia], "e1s")
    );
    const despues = armar(FILAS, { mapeos });
    const quedan = despues.informe.meses.flatMap((m) => m.exclusiones).filter((e) => esMotivoMapeable(e.motivo));
    expect(quedan).toEqual([]);
    expect(despues.informe.meses.every((m) => m.identidad_ok)).toBe(true);
  });

  it("`valorGrupoCombinacion` es la expresión del informe: el detalle del resolutor, la combinación completa o la terna", () => {
    const k = { genero: "HOMBRE", mundo: "", linea: "PANTALON", equivalencia: "SIN EQUIVALENCIA" };
    expect(valorGrupoCombinacion(k, { resultado: "clasificacion_incompleta", detalle: "HOMBRE / (vacío) / PANTALON" })).toBe("HOMBRE / (vacío) / PANTALON");
    expect(valorGrupoCombinacion(k, { resultado: "equivalencia_inexistente" })).toBe("HOMBRE /  / PANTALON / SIN EQUIVALENCIA");
    expect(valorGrupoCombinacion(k, { resultado: "ok", equivalencia_id: "x" })).toBe("HOMBRE /  / PANTALON / SIN EQUIVALENCIA");
    expect(valorGrupoCombinacion(k, undefined)).toBe("HOMBRE /  / PANTALON");
  });

  it("las resoluciones y el acumulador del escenario no se alteraron al derivar (misma lectura dos veces)", () => {
    const otra = construirIndiceOrigenes(acumular(FILAS), resoluciones(acumular(FILAS)));
    expect([...otra.keys()].sort()).toEqual([...indice.keys()].sort());
  });
});
