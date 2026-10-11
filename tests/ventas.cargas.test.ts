import { describe, expect, it } from "vitest";
import {
  TRANSICIONES,
  archivoPosiblementeTruncado,
  armarTanda,
  cargaCaducada,
  destinoDescarte,
  diferenciasMedidas,
  esIdentico,
  esReintentable,
  esperadoDeMes,
  exigirTransicion,
  filasCargablesDeMes,
  horaLima,
  mensajeCargaEnCurso,
  mensajeNoConcilia,
  mesBloqueado,
  mesesASaltar,
  motivoRechazoAbrir,
  partirEnMeses,
  partirEnTandas,
  tandasDeMes,
  transicionPermitida,
} from "@/lib/ventas/cargas";
import { sustituirMarcasNuevas, marcasSinId } from "@/lib/ventas/informe";
import type { EstadoCarga } from "@/lib/ventas/tipos-api";
import { TANDA_CLIENTE, TANDA_IN, type FilaCargable } from "@/lib/ventas/tipos";
import { argumentosPublicar } from "@/lib/ventas/http";
import { publicarSchema } from "@/lib/ventas/esquemas";
import { aCentimos } from "@/lib/ventas/numeros";
import { informe } from "./ventas.fixture";

describe("transiciones de estado (regla 31)", () => {
  it("solo las seis válidas", () => {
    const validas: [EstadoCarga, EstadoCarga][] = [
      ["en_curso", "publicada"],
      ["en_curso", "abandonada"],
      ["en_curso", "fallida"],
      ["publicada", "reemplazada"],
      ["publicada", "retirada"],
    ];
    for (const [de, a] of validas) expect(transicionPermitida(de, a)).toBe(true);
    const total = Object.values(TRANSICIONES).reduce((s, l) => s + l.length, 0);
    expect(total).toBe(5 /* las cinco de la ficha */);
  });

  it("cualquier otra lanza error", () => {
    expect(() => exigirTransicion("en_curso", "reemplazada")).toThrow();
    expect(() => exigirTransicion("publicada", "abandonada")).toThrow();
    expect(() => exigirTransicion("abandonada", "en_curso")).toThrow();
    expect(() => exigirTransicion("fallida", "publicada")).toThrow();
    expect(() => exigirTransicion("retirada", "publicada")).toThrow();
    expect(() => exigirTransicion("en_curso", "publicada")).not.toThrow();
  });
});

describe("caducidad y rechazos al abrir (regla 31)", () => {
  const ahora = new Date("2026-10-11T15:00:00Z");
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();

  it("29 minutos no, 31 sí; 30 exactos todavía no", () => {
    expect(cargaCaducada(hace(29), ahora)).toBe(false);
    expect(cargaCaducada(hace(30), ahora)).toBe(false);
    expect(cargaCaducada(hace(31), ahora)).toBe(true);
    expect(cargaCaducada(new Date(hace(31)), ahora)).toBe(true);
  });

  it("reemplazar una publicada exige `reemplazar`; un mes no cerrado exige `mes_abierto`", () => {
    const base = { hayPublicada: false, reemplazar: false, periodo: "2026-09", mesAbierto: false, hoyLima: "2026-10-11" };
    expect(motivoRechazoAbrir(base)).toBeNull();
    expect(motivoRechazoAbrir({ ...base, hayPublicada: true })?.codigo).toBe("mes_ya_cargado");
    expect(motivoRechazoAbrir({ ...base, hayPublicada: true, reemplazar: true })).toBeNull();
    expect(motivoRechazoAbrir({ ...base, periodo: "2026-10" })?.codigo).toBe("mes_abierto");
    expect(motivoRechazoAbrir({ ...base, periodo: "2026-10", mesAbierto: true })).toBeNull();
    expect(motivoRechazoAbrir({ ...base, periodo: "2026-10", hayPublicada: true })?.codigo).toBe("mes_ya_cargado");
  });

  it("el mensaje de carga en curso lleva quién y desde qué hora de Lima", () => {
    expect(horaLima("2026-10-11T15:42:00Z")).toBe("10:42");
    expect(mensajeCargaEnCurso("Ana", "2026-10-11T15:42:00Z")).toBe("Carga en curso de ese mes por Ana desde las 10:42.");
  });
});

describe("partir en meses y tandas (regla 32)", () => {
  it("partirEnMeses no pierde ni duplica filas y la suma por mes es la total", () => {
    const filas = Array.from({ length: 1000 }, (_, i) => ({ periodo: `2026-0${(i % 3) + 1}`, v: i }));
    const meses = partirEnMeses(filas);
    expect([...meses.keys()]).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect([...meses.values()].reduce((s, l) => s + l.length, 0)).toBe(1000);
    const suma = [...meses.values()].reduce((s, l) => s + l.reduce((x, f) => x + f.v, 0), 0);
    expect(suma).toBe(filas.reduce((s, f) => s + f.v, 0));
    expect(meses.get("2026-02")?.map((f) => f.v).slice(0, 3)).toEqual([1, 4, 7]);
  });

  it("partirEnTandas conserva el orden y el total", () => {
    const filas = Array.from({ length: 25_001 }, (_, i) => i);
    const tandas = partirEnTandas(filas, TANDA_CLIENTE);
    expect(tandas.map((t) => t.length)).toEqual([10_000, 10_000, 5_001]);
    expect(tandas.flat()).toEqual(filas);
    expect(partirEnTandas([], 10)).toEqual([]);
    expect(partirEnTandas([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("el diccionario de cada tanda solo trae los ids que usa", () => {
    const fila = (t: string, e: string, m: string): FilaCargable => ({
      tienda_id: t,
      equivalencia_id: e,
      marca_id: m,
      talla: 0,
      unidades: 1,
      venta_soles: 10.5,
      costo_vendido: 4,
      stock_unidades: 2,
      stock_valorizado: 8,
    });
    const tanda = armarTanda([fila("t1", "e1", "m1"), fila("t1", "e2", "m1"), fila("t2", "e1", "m1")], 3);
    expect(tanda.tanda).toBe(3);
    expect(tanda.diccionario).toEqual({ tiendas: ["t1", "t2"], equivalencias: ["e1", "e2"], marcas: ["m1"] });
    expect(tanda.filas.map((f) => f.slice(0, 4))).toEqual([
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [1, 0, 0, 0],
    ]);
  });

  it("de un informe real salen tandas que suman exactamente lo que se espera publicar", () => {
    const filas = Array.from({ length: 50 }, (_, i) => ({
      marca: `M${i % 9}`,
      equivalencia: i % 2 ? "DENIM" : "PANTALON VARIOS",
      talla: i % 3 === 0 ? "Extrema" : i % 3 === 1 ? "Central" : "Revisar",
      unidades: String(i),
      venta_soles: `${i * 10}.35`,
      costo_vendido: `${i * 4}.1`,
      stock_unidades: String(i * 2),
      stock_valorizado: `${i}.99`,
    }));
    const r = informe(filas);
    const periodo = "2026-09";
    const esperado = esperadoDeMes(r.consolidado, periodo);
    expect(esperado.filas).toBe(r.informe.meses[0].cargado.filas);
    const tandas = tandasDeMes(r.consolidado, periodo, 7);
    expect(tandas.map((t) => t.tanda)).toEqual(tandas.map((_, i) => i + 1));
    let u = 0;
    let n = 0;
    let venta = 0;
    for (const t of tandas) {
      n += t.filas.length;
      for (const f of t.filas) {
        u += f[4];
        venta += Math.round(f[5] * 100);
      }
    }
    expect(n).toBe(esperado.filas);
    expect(u).toBe(esperado.unidades);
    expect(venta / 100).toBe(esperado.venta_soles);
    // las claves finales son únicas por (tienda, equivalencia, marca, talla)
    const claves = new Set(tandas.flatMap((t) => t.filas.map((f) => `${t.diccionario.tiendas[f[0]]}|${t.diccionario.equivalencias[f[1]]}|${t.diccionario.marcas[f[2]]}|${f[3]}`)));
    expect(claves.size).toBe(esperado.filas);
    expect(filasCargablesDeMes(r.consolidado, periodo)).toHaveLength(esperado.filas);
    expect(filasCargablesDeMes(r.consolidado, "2000-01")).toEqual([]);
  });

  it("las marcas nuevas viajan como `nueva:NOMBRE` hasta que `marcas-nuevas` devuelve sus ids", () => {
    const r = informe([{ marca: "NUEVA UNO" }, { marca: "ALFA" }]);
    expect(marcasSinId(r.consolidado)).toEqual(["NUEVA UNO"]);
    const c = sustituirMarcasNuevas(r.consolidado, { "NUEVA UNO": "mk-nueva" });
    expect(marcasSinId(c)).toEqual([]);
    expect(filasCargablesDeMes(c, "2026-09").map((f) => f.marca_id).sort()).toEqual(["mk-alfa", "mk-nueva"]);
  });
});

describe("meses a saltar, bloqueo y reintentos (regla 32)", () => {
  const medidas = { filas: 10, unidades: 5, venta_soles: 100.25, costo_vendido: 40, stock_unidades: 7, stock_valorizado: 70.5 };
  const huella = { filas_con_stock: 8, stock_unidades: 7, stock_valorizado: 70.5 };

  it("idéntico solo si coinciden filas, las cinco medidas y la huella", () => {
    expect(esIdentico(medidas, huella, medidas, huella)).toBe(true);
    expect(esIdentico(medidas, huella, { ...medidas, filas: 11 }, huella)).toBe(false);
    expect(esIdentico(medidas, huella, { ...medidas, costo_vendido: 40.01 }, huella)).toBe(false);
    expect(esIdentico(medidas, huella, { ...medidas, stock_unidades: 8 }, huella)).toBe(false);
    expect(esIdentico(medidas, huella, medidas, { ...huella, filas_con_stock: 7 })).toBe(false);
    expect(esIdentico(medidas, huella, medidas, null)).toBe(false);
  });

  it("mesesASaltar devuelve los periodos idénticos", () => {
    expect(
      mesesASaltar([
        { periodo: "2026-07", estado: "identico" },
        { periodo: "2026-08", estado: "reemplaza" },
        { periodo: "2026-09", estado: "nuevo" },
      ])
    ).toEqual(["2026-07"]);
  });

  it("mesBloqueado aplica el 2 % por mes y `forzar_incompleto` lo levanta", () => {
    expect(mesBloqueado({ bloqueado: true }, false)).toBe(true);
    expect(mesBloqueado({ bloqueado: true }, true)).toBe(false);
    expect(mesBloqueado({ bloqueado: false }, false)).toBe(false);
  });

  it("esReintentable: red y 5xx sí (hasta 3), 4xx no", () => {
    expect(esReintentable(new TypeError("Failed to fetch"))).toBe(true);
    expect(esReintentable({ status: 0 })).toBe(true);
    expect(esReintentable({ status: 500 })).toBe(true);
    expect(esReintentable({ status: 503 })).toBe(true);
    expect(esReintentable({ status: 400 })).toBe(false);
    expect(esReintentable({ status: 404 })).toBe(false);
    expect(esReintentable({ status: 409 })).toBe(false);
  });

  it("TANDA_IN es 150", () => {
    expect(TANDA_IN).toBe(150);
  });
});

describe("conciliación de la publicación", () => {
  const esperado = { filas: 32_558, unidades: 100, venta_soles: 5000.5, costo_vendido: 2000, stock_unidades: 300, stock_valorizado: 9000 };

  it("diferencias y mensaje de tanda perdida", () => {
    const medido = { ...esperado, filas: 30_558, venta_soles: 4000.5 };
    expect(diferenciasMedidas(esperado, medido)).toEqual([
      { medida: "filas", esperado: 32_558, medido: 30_558, diferencia: -2000 },
      { medida: "venta_soles", esperado: 5000.5, medido: 4000.5, diferencia: -1000 },
    ]);
    expect(mensajeNoConcilia(esperado, medido)).toContain("Faltan 2 000 filas: se perdió una tanda");
    expect(mensajeNoConcilia(esperado, { ...esperado, filas: 34_558 })).toContain("Sobran 2 000 filas");
    expect(mensajeNoConcilia(esperado, { ...esperado, unidades: 99 })).toContain("las cifras no");
    expect(diferenciasMedidas(esperado, { ...esperado })).toEqual([]);
  });
});

describe("archivo posiblemente truncado (regla 25)", () => {
  it("solo una hoja .xls de exactamente 65 536 filas", () => {
    expect(archivoPosiblementeTruncado("ventas.xls", 65_536)).toBe(true);
    expect(archivoPosiblementeTruncado("VENTAS.XLS", 65_536)).toBe(true);
    expect(archivoPosiblementeTruncado("ventas.xls", 65_535)).toBe(false);
    expect(archivoPosiblementeTruncado("ventas.xlsx", 65_536)).toBe(false);
    expect(archivoPosiblementeTruncado("ventas.csv", 65_536)).toBe(false);
    expect(archivoPosiblementeTruncado("ventas.csv", null)).toBe(false);
  });
});

describe("descartar una carga", () => {
  it("en_curso se abandona y publicada se retira (acción manual)", () => {
    expect(destinoDescarte("en_curso", false)).toEqual({ a: "abandonada" });
    expect(destinoDescarte("publicada", false)).toEqual({ a: "retirada" });
    expect(destinoDescarte("en_curso", true)).toEqual({ a: "abandonada" });
  });

  it("con `solo en curso` (flujo de carga) una publicada no se toca", () => {
    expect(destinoDescarte("publicada", true)).toMatchObject({ mensaje: expect.stringContaining("no se descarta desde la carga") });
  });

  it("los demás estados responden 409", () => {
    for (const e of ["reemplazada", "retirada", "abandonada", "fallida", "rara"]) {
      expect(destinoDescarte(e, false)).toHaveProperty("mensaje");
      expect(destinoDescarte(e, true)).toHaveProperty("mensaje");
    }
  });
});

describe("extremo a extremo con totales grandes: esperadoDeMes → publicar", () => {
  const ventas = ["30000000.03", "5000000", "123456789.01", "0.07", "999999.99", "-1500000.01"];

  it("lo que se envía suma exactamente lo que se espera y llega sin re-redondear a la función SQL", () => {
    const r = informe(
      ventas.map((v, i) => ({
        marca: `M${i}`,
        venta_soles: v,
        costo_vendido: String(Number(v) / 2 > 0 ? (Math.round(Number(v) * 50) / 100).toFixed(2) : "0"),
        stock_valorizado: v,
      }))
    );
    const periodo = "2026-09";
    const esperado = esperadoDeMes(r.consolidado, periodo);

    // La base suma numerics exactos: aquí, céntimos enteros de lo que viaja en las tandas.
    const tandas = tandasDeMes(r.consolidado, periodo, 2);
    const enCentimos = (campo: 5 | 6 | 8) => tandas.reduce((s, t) => s + t.filas.reduce((x, f) => x + aCentimos(f[campo]), 0), 0);
    const sumaVenta = ventas.reduce((s, v) => s + aCentimos(Number(v)), 0);
    expect(enCentimos(5)).toBe(sumaVenta);
    expect(aCentimos(esperado.venta_soles)).toBe(sumaVenta);
    expect(aCentimos(esperado.stock_valorizado)).toBe(enCentimos(8));
    expect(aCentimos(esperado.costo_vendido)).toBe(enCentimos(6));
    expect(esperado.venta_soles).toBe(sumaVenta / 100);

    // El esquema de publicar lo acepta tal cual y la ruta lo pasa sin tocar.
    const parseado = publicarSchema.parse({ esperado });
    expect(parseado.esperado).toEqual(esperado);
    const args = argumentosPublicar("carga-1", parseado.esperado);
    expect(args).toEqual({
      p_carga: "carga-1",
      p_filas: esperado.filas,
      p_unidades: esperado.unidades,
      p_venta: esperado.venta_soles,
      p_costo: esperado.costo_vendido,
      p_stock_unidades: esperado.stock_unidades,
      p_stock_valorizado: esperado.stock_valorizado,
    });
    expect(JSON.stringify(args.p_venta)).toBe(String(sumaVenta / 100)); // lo que ve PostgREST

    // Lo medido por la base (mismos céntimos) concilia sin diferencias y el mes sería idéntico.
    expect(diferenciasMedidas(esperado, { ...esperado })).toEqual([]);
    expect(esIdentico(esperado, { filas_con_stock: 6, stock_unidades: 0, stock_valorizado: esperado.stock_valorizado }, esperado, { filas_con_stock: 6, stock_unidades: 0, stock_valorizado: esperado.stock_valorizado })).toBe(true);
    // y una diferencia de un céntimo en un total grande SÍ se ve.
    const dif = diferenciasMedidas(esperado, { ...esperado, venta_soles: (sumaVenta + 1) / 100 });
    expect(dif).toHaveLength(1);
    expect(dif[0]).toMatchObject({ medida: "venta_soles", diferencia: 0.01 });
  });

  it("publicarSchema rechaza más de 2 decimales (no hay nada que re-redondear)", () => {
    const m = { filas: 1, unidades: 1, venta_soles: 10, costo_vendido: 5, stock_unidades: 1, stock_valorizado: 3 };
    expect(publicarSchema.safeParse({ esperado: m }).success).toBe(true);
    expect(publicarSchema.safeParse({ esperado: { ...m, venta_soles: 10.005 } }).success).toBe(false);
    expect(publicarSchema.safeParse({ esperado: { ...m, venta_soles: 123_456_789.01 } }).success).toBe(true);
    expect(publicarSchema.safeParse({ esperado: { ...m, costo_vendido: 30_000_000.03 } }).success).toBe(true);
  });
});
