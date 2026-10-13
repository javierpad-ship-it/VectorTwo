import { describe, expect, it } from "vitest";
import { construirInforme } from "@/lib/ventas/informe";
import { crearPeticionPrevisualizar } from "@/lib/ventas/previsualizar";
import { marcarIgnorada } from "@/lib/ventas/resolver";
import { recalcularConIgnorada } from "@/lib/ventas/recalcular";
import {
  ETIQUETAS_MOTIVO,
  MEDIDAS_VENTA,
  MOTIVOS_DECISION,
  MOTIVOS_NO_COMPARABLES,
  esMotivoError,
  type FilaCruda,
  type InformeCarga,
  type InformeMes,
  type MotivoExclusion,
} from "@/lib/ventas/tipos";
import type { Acumulador } from "@/lib/ventas/acumulador";
import type { PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";
import { acumular, informe as armar, resoluciones } from "./ventas.fixture";

/** Lo que devolvería `previsualizar` completo, con las resoluciones del fixture. */
function respuestaBase(acum: Acumulador): PrevisualizarRespuesta {
  const r = resoluciones(acum);
  return {
    ...r,
    mes_actual: "2026-10",
    agrupaciones_talla: { CENTRALES: "ag-c", EXTREMAS: "ag-e" },
    agrupaciones_marca: [],
    agrupacion_defecto_id: null,
    mapeos_no_aplicables: r.mapeos_no_aplicables ?? [],
  };
}

/** Todo SINTÉTICO. `CENTRAL EJEMPLO` y `OFICINA EJEMPLO` no son tiendas. */
const IGNORADAS = new Map([
  ["CENTRAL EJEMPLO", { id: "u-1", nota: "Central de ejemplo" }],
  ["OFICINA EJEMPLO", { id: "u-2", nota: null }],
]);

const mes = (r: { informe: InformeCarga }, periodo = "2026-09"): InformeMes => {
  const m = r.informe.meses.find((x) => x.periodo === periodo);
  if (!m) throw new Error(`falta el mes ${periodo}`);
  return m;
};
const excl = (m: InformeMes, motivo: MotivoExclusion) => m.exclusiones.filter((e) => e.motivo === motivo);
const sumaExclusiones = (m: InformeMes, motivos: readonly MotivoExclusion[], campo: "unidades" | "venta_soles" | "costo_vendido" | "stock_unidades" | "stock_valorizado" | "filas") =>
  m.exclusiones.filter((e) => motivos.includes(e.motivo)).reduce((s, e) => s + e[campo], 0);

describe("M5c regla 4 · decisión, no error", () => {
  it("`ubicacion_ignorada` es una decisión con etiqueta propia; `tienda_excluida` ya no existe", () => {
    expect((MOTIVOS_DECISION as readonly string[]).includes("ubicacion_ignorada")).toBe(true);
    expect((MOTIVOS_DECISION as readonly string[]).includes("tienda_excluida")).toBe(false);
    expect(esMotivoError("ubicacion_ignorada")).toBe(false);
    expect(ETIQUETAS_MOTIVO.ubicacion_ignorada).toBe("Ubicación ignorada (no es tienda)");
  });

  it("un mes cuyo único problema son 5 000 filas de una ubicación ignorada no tiene errores ni bloquea", () => {
    const solo = Array.from({ length: 5000 }, (_, i) => ({
      tienda: "central ejemplo",
      marca: `M${i % 7}`,
      unidades: "0",
      venta_soles: "0",
      costo_vendido: "0",
      stock_unidades: "3",
      stock_valorizado: "100",
    }));
    const r = armar([...solo, { tienda: "LUKERS UNO", stock_valorizado: "50" }], { ignoradas: IGNORADAS });
    const m = mes(r);
    expect(m.errores.maximo).toBe(0);
    expect(m.bloqueado).toBe(false);
    const linea = m.resumen_exclusiones.find((x) => x.motivo === "ubicacion_ignorada");
    expect(linea).toMatchObject({ tipo: "decision", filas: 5000, grupos: 1 });
    // pesa más del 2 % del stock: se resalta como cualquier decisión
    expect(linea?.resaltada).toBe(true);
    expect(m.resumen_exclusiones.some((x) => x.tipo === "error")).toBe(false);
    expect(excl(m, "ubicacion_ignorada")[0]).toMatchObject({ valor: "CENTRAL EJEMPLO", tipo: "decision", filas: 5000, stock_unidades: 15_000 });
    expect(excl(m, "tienda_desconocida")).toEqual([]);
  });

  it("si pesa menos del 2 % no se resalta", () => {
    const filas = [
      ...Array.from({ length: 99 }, (_, i) => ({ marca: `M${i}` })),
      { tienda: "OFICINA EJEMPLO", unidades: "1", venta_soles: "1", costo_vendido: "1", stock_unidades: "1", stock_valorizado: "1" },
    ];
    const m = mes(armar(filas, { ignoradas: IGNORADAS }));
    expect(m.resumen_exclusiones.find((x) => x.motivo === "ubicacion_ignorada")?.resaltada).toBe(false);
  });

  it("sin la lista, la misma ubicación es una tienda desconocida (error) y bloquea", () => {
    const filas = [{ tienda: "CENTRAL EJEMPLO" }, { tienda: "LUKERS UNO", marca: "BETA" }];
    expect(mes(armar(filas)).bloqueado).toBe(true);
    expect(mes(armar(filas, { ignoradas: IGNORADAS })).bloqueado).toBe(false);
  });
});

describe("M5c regla 5 · precedencia", () => {
  const ig = (extra: Partial<FilaCruda>) => mes(armar([{ tienda: "CENTRAL EJEMPLO", ...extra }], { ignoradas: IGNORADAS }));

  it("género, mundo y línea en blanco con tienda ignorada → sin_clasificar", () => {
    const m = ig({ genero: "", mundo: "", linea: "" });
    expect(excl(m, "sin_clasificar")).toHaveLength(1);
    expect(excl(m, "ubicacion_ignorada")).toEqual([]);
  });

  it("combinación inexistente con tienda ignorada → ubicacion_ignorada (la tienda se decide antes)", () => {
    const m = ig({ genero: "MUJER", mundo: "URBANO", linea: "POLO" });
    expect(excl(m, "ubicacion_ignorada")).toHaveLength(1);
    expect(excl(m, "nodo_inexistente")).toEqual([]);
  });

  it("talla desconocida con tienda ignorada → ubicacion_ignorada", () => {
    const m = ig({ talla: "XL" });
    expect(excl(m, "ubicacion_ignorada")).toHaveLength(1);
    expect(excl(m, "talla_desconocida")).toEqual([]);
  });
});

describe("M5c regla 6 · identidad con ubicaciones ignoradas (semilla fija)", () => {
  function aleatorio(semilla: number) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("archivo = cargado + Σ exclusiones en las cinco medidas y en filas, con el motivo nuevo mezclado", () => {
    const rng = aleatorio(805);
    const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length)];
    const filas: Partial<FilaCruda>[] = Array.from({ length: 3000 }, () => ({
      mes: pick(["Ago", "Set", "Set", "Set", "xx"]),
      tienda: pick(["LUKERS UNO", "LUKERS DOS", "CENTRAL EJEMPLO", "central  ejemplo", "OFICINA EJEMPLO", "OFICINA CENTRAL", "LOCAL X", "", "TOTAL"]),
      genero: pick(["HOMBRE", "MUJER", "NIÑOS", "OTRO", ""]),
      mundo: pick(["CASUAL", "URBANO", "RI", "ZZ", ""]),
      linea: pick(["DENIM", "POLO", "BERMUDA", "QQ", ""]),
      equivalencia: pick(["", "-", "PANTALON VARIOS", "NO EXISTE"]),
      marca: pick(["ALFA", "BETA", "VIEJA", "NUEVA UNO", "-"]),
      talla: pick(["Central", "Extrema", "Revisar", "XL"]),
      unidades: pick(["0", "5", "-2", "7.4"]),
      venta_soles: pick(["0", "100", "250.55", "-30"]),
      costo_vendido: pick(["0", "40", "100.1"]),
      stock_unidades: pick(["0", "9", "-1"]),
      stock_valorizado: pick(["0", "300", "50.25", "-10"]),
    }));
    const r = armar(filas, { ignoradas: IGNORADAS });
    let ignoradasVistas = 0;
    for (const m of r.informe.meses) {
      expect(m.identidad_ok, `mes ${m.periodo}`).toBe(true);
      expect(m.archivo.filas).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
      for (const c of m.conciliacion) {
        expect(c.descuadre, `${m.periodo} ${c.medida}`).toBe(0);
        // comparable = archivo - no comparable, también con el motivo nuevo en juego
        expect(Math.abs(c.comparable - (c.archivo - c.no_comparable)), `${m.periodo} ${c.medida}`).toBeLessThan(0.005);
      }
      ignoradasVistas += sumaExclusiones(m, ["ubicacion_ignorada"], "filas");
    }
    expect(ignoradasVistas).toBeGreaterThan(0);
  });
});

describe("M5c regla 7 · marcar ignorada y recalcular sin releer", () => {
  const filas = [
    { tienda: "CENTRAL EJEMPLO", unidades: "0", venta_soles: "0", costo_vendido: "0", stock_unidades: "40", stock_valorizado: "900" },
    { tienda: "CENTRAL EJEMPLO", marca: "BETA", unidades: "2", venta_soles: "70", costo_vendido: "30", stock_unidades: "1", stock_valorizado: "20" },
    { tienda: "LUKERS UNO" },
    { tienda: "LOCAL X", marca: "BETA" },
  ];

  it("cambia solo la posición de ese valor; el informe pierde el grupo de desconocida y gana el de ignorada con las mismas cifras", () => {
    const acumulador = acumular(filas);
    const antes = respuestaBase(acumulador);
    const posicion = acumulador.diccionarios.tiendas.indexOf("CENTRAL EJEMPLO");
    expect(antes.tiendas[posicion].resultado).toBe("desconocida");

    const despues = marcarIgnorada(antes, "central  ejemplo", "u-1", "Central de ejemplo");
    despues.tiendas.forEach((t, i) => {
      if (i === posicion) expect(t).toEqual({ valor: "CENTRAL EJEMPLO", resultado: "ignorada", id: "u-1", nota: "Central de ejemplo" });
      else expect(t).toEqual(antes.tiendas[i]);
    });
    // la respuesta original no se muta
    expect(antes.tiendas[posicion].resultado).toBe("desconocida");

    const informeAntes = construirInforme({ acumulador, resoluciones: antes });
    const informeDespues = construirInforme({ acumulador, resoluciones: despues });
    const ma = mes(informeAntes);
    const md = mes(informeDespues);

    expect(md.archivo).toEqual(ma.archivo);
    const desconocidaAntes = excl(ma, "tienda_desconocida").find((e) => e.valor === "CENTRAL EJEMPLO");
    expect(desconocidaAntes).toBeDefined();
    expect(excl(md, "tienda_desconocida").some((e) => e.valor === "CENTRAL EJEMPLO")).toBe(false);
    const ignorada = excl(md, "ubicacion_ignorada").find((e) => e.valor === "CENTRAL EJEMPLO");
    expect(ignorada).toBeDefined();
    // mismas filas, mismas cifras y misma primera fila: solo cambian motivo y tipo
    expect({ ...ignorada!, motivo: desconocidaAntes!.motivo, tipo: desconocidaAntes!.tipo }).toEqual(desconocidaAntes);
    expect(ignorada).toMatchObject({ tipo: "decision", filas: 2 });
    expect(desconocidaAntes).toMatchObject({ tipo: "error" });
    // LOCAL X sigue siendo error
    expect(excl(md, "tienda_desconocida").map((e) => e.valor)).toEqual(["LOCAL X"]);
    // lo que se cargará no cambia
    expect(informeDespues.consolidado.meses.get("2026-09")).toEqual(informeAntes.consolidado.meses.get("2026-09"));
    expect(md.cargado).toEqual(ma.cargado);
    expect(md.identidad_ok).toBe(true);
    // Los errores bajan
    expect(md.errores.maximo).toBeLessThan(ma.errores.maximo);
  });

  it("recalcularConIgnorada: idempotente, igual a resolver con la lista, y conserva los totales de QlikView", () => {
    const acumulador = acumular(filas);
    const base = respuestaBase(acumulador);
    const totalesQlik = { "2026-09": { unidades: 12, venta_soles: 1000 } };
    const una = recalcularConIgnorada(acumulador, base, "CENTRAL EJEMPLO", "u-1", "x", { totalesQlik });
    const dos = recalcularConIgnorada(acumulador, una.respuesta, "central ejemplo", "u-1", "x", { totalesQlik });
    expect(dos.respuesta).toEqual(una.respuesta);
    expect(dos.resultado.informe).toEqual(una.resultado.informe);

    const conLista = construirInforme({
      acumulador,
      resoluciones: resoluciones(acumulador, { ignoradas: new Map([["CENTRAL EJEMPLO", { id: "u-1", nota: "x" }]]) }),
      totalesQlik,
    });
    expect(una.resultado.informe).toEqual(conLista.informe);
    const c = una.resultado.informe.meses[0].conciliacion.find((x) => x.medida === "unidades");
    expect(c?.qlik).toBe(12);

    // un valor ok o inactivo no se toca (la tienda manda)
    const sobreTienda = marcarIgnorada(base, "LUKERS UNO", "u-9", null);
    expect(sobreTienda.tiendas).toEqual(base.tiendas);
  });

  it("la petición a previsualizar no cambia: sigue siendo solo valores distintos", () => {
    const peticion = crearPeticionPrevisualizar(acumular(filas));
    expect(Object.keys(peticion).sort()).toEqual(["combinaciones", "marcas", "periodos", "tiendas"]);
  });
});

describe("M5c regla 8 · comparable", () => {
  const FILAS_MIXTAS: Partial<FilaCruda>[] = [
    { unidades: "10", venta_soles: "1000", costo_vendido: "400", stock_unidades: "20", stock_valorizado: "800" },
    { tienda: "LUKERS DOS", marca: "BETA", unidades: "3", venta_soles: "300", costo_vendido: "100", stock_unidades: "4", stock_valorizado: "50" },
    // sin_clasificar
    { genero: "", mundo: "", linea: "", unidades: "100", venta_soles: "7000", costo_vendido: "10", stock_unidades: "11", stock_valorizado: "22" },
    // fila de totales
    { tienda: "TOTAL", unidades: "1000", venta_soles: "9000", costo_vendido: "8", stock_unidades: "5", stock_valorizado: "6" },
    // NO se restan:
    { tienda: "CENTRAL EJEMPLO", unidades: "0", venta_soles: "0", costo_vendido: "0", stock_unidades: "60", stock_valorizado: "700" },
    { tienda: "OFICINA CENTRAL", unidades: "7", venta_soles: "70", costo_vendido: "7", stock_unidades: "7", stock_valorizado: "7" },
    { genero: "ZZZ", unidades: "9", venta_soles: "90", costo_vendido: "9", stock_unidades: "9", stock_valorizado: "9" },
    { tienda: "LOCAL X", unidades: "11", venta_soles: "110", costo_vendido: "11", stock_unidades: "11", stock_valorizado: "11" },
  ];

  it("comparable = archivo − Σ exclusiones con motivo no comparable, en las cinco medidas", () => {
    const m = mes(armar(FILAS_MIXTAS, { ignoradas: IGNORADAS }));
    const noComp = (campo: Parameters<typeof sumaExclusiones>[2]) => sumaExclusiones(m, MOTIVOS_NO_COMPARABLES, campo);
    const campo: Record<(typeof MEDIDAS_VENTA)[number], Parameters<typeof sumaExclusiones>[2]> = {
      unidades: "unidades",
      venta_soles: "venta_soles",
      costo_vendido: "costo_vendido",
      stock_unidades: "stock_unidades",
      stock_valorizado: "stock_valorizado",
    };
    const c = Object.fromEntries(m.conciliacion.map((x) => [x.medida, x]));
    for (const medida of MEDIDAS_VENTA) {
      expect(c[medida].no_comparable, medida).toBe(noComp(campo[medida]));
      expect(c[medida].comparable, medida).toBe(c[medida].archivo - c[medida].no_comparable);
    }
    expect(c.unidades).toMatchObject({ archivo: 1140, no_comparable: 1100, comparable: 40 });
    expect(c.venta_soles).toMatchObject({ archivo: 17_570, no_comparable: 16_000, comparable: 1570 });
    expect(c.stock_unidades).toMatchObject({ no_comparable: 16, comparable: 111 });
    // sí hay exclusiones que no se restaron
    expect(c.unidades.excluido).toBeGreaterThan(c.unidades.no_comparable);
  });

  it("ubicacion_ignorada, tienda_inactiva, genero_desconocido y el resto NO se restan", () => {
    const m = mes(armar(FILAS_MIXTAS, { ignoradas: IGNORADAS }));
    const motivos = new Set(m.exclusiones.map((e) => e.motivo));
    for (const esperado of ["ubicacion_ignorada", "tienda_inactiva", "genero_desconocido", "tienda_desconocida"] as const) {
      expect(motivos.has(esperado), esperado).toBe(true);
      expect((MOTIVOS_NO_COMPARABLES as readonly string[]).includes(esperado)).toBe(false);
    }
    const stock = m.conciliacion.find((x) => x.medida === "stock_unidades");
    // 60 de CENTRAL EJEMPLO siguen dentro del comparable
    expect(stock?.comparable).toBeGreaterThanOrEqual(60);
  });

  it("sin exclusiones no comparables, comparable = archivo", () => {
    const m = mes(armar([{}, { tienda: "OFICINA CENTRAL" }, { tienda: "LOCAL X" }]));
    for (const c of m.conciliacion) {
      expect(c.no_comparable).toBe(0);
      expect(c.comparable).toBe(c.archivo);
    }
  });

  it("MOTIVOS_NO_COMPARABLES ⊆ MOTIVOS_DECISION (test estático)", () => {
    expect([...MOTIVOS_NO_COMPARABLES].sort()).toEqual(["fila_total", "sin_clasificar"]);
    for (const m of MOTIVOS_NO_COMPARABLES) expect((MOTIVOS_DECISION as readonly string[]).includes(m), m).toBe(true);
  });
});
