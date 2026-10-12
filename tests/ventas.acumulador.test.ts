import { describe, expect, it } from "vitest";
import { Acumulador, TablaClaves, empaquetarClave } from "@/lib/ventas/acumulador";
import { interpretarFila } from "@/lib/ventas/interpretar";
import { acumular, fila } from "./ventas.fixture";

/** Pseudoaleatorio con semilla fija (mulberry32), para que la prueba sea reproducible. */
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

describe("TablaClaves y empaquetado", () => {
  it("guarda y encuentra claves de 47 bits sin colisiones, también al crecer", () => {
    const t = new TablaClaves(16);
    const claves: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const k = empaquetarClave(i % 120, i % 500, (i * 7) % 20_000, (i * 13) % 5_000, i % 5);
      if (t.encontrarOInsertar(k, i) === -1) claves.push(k);
    }
    expect(t.tamano).toBe(claves.length);
    for (const k of claves) expect(t.buscar(k)).toBeGreaterThanOrEqual(0);
    expect(t.buscar(123)).toBe(-1);
    expect(empaquetarClave(119, 499, 19_999, 4_999, 4)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("Acumulador (regla 17)", () => {
  it("agrega N filas y devuelve los mismos totales que una suma directa", () => {
    const rng = aleatorio(7);
    const filas = Array.from({ length: 500 }, (_, i) => ({
      tienda: i % 2 === 0 ? "LUKERS UNO" : "LUKERS DOS",
      marca: ["ALFA", "BETA", "GAMA"][i % 3],
      equivalencia: ["PANTALON VARIOS", "DENIM", ""][i % 3],
      talla: i % 4 === 0 ? "Extrema" : "Central",
      unidades: String(Math.floor(rng() * 50)),
      venta_soles: (rng() * 1000).toFixed(2),
      costo_vendido: (rng() * 500).toFixed(2),
      stock_unidades: String(Math.floor(rng() * 80)),
      stock_valorizado: (rng() * 900).toFixed(2),
    }));
    const acum = acumular(filas);
    const directa = filas.reduce(
      (s, f) => ({
        unidades: s.unidades + Number(f.unidades),
        venta: s.venta + Math.round(Number(f.venta_soles) * 100),
        stock: s.stock + Number(f.stock_unidades),
      }),
      { unidades: 0, venta: 0, stock: 0 }
    );
    const st = acum.stats[0].archivo;
    expect(st.filas).toBe(500);
    expect(st.unidades).toBe(directa.unidades);
    expect(st.venta).toBe(directa.venta);
    expect(st.stock_unidades).toBe(directa.stock);
    // y lo mismo sumando las entradas columnares
    const e = acum.entradas;
    let venta = 0;
    let n = 0;
    for (let i = 0; i < e.n; i++) {
      venta += e.venta[i];
      n += e.filas[i];
    }
    expect(venta).toBe(directa.venta);
    expect(n).toBe(500);
  });

  it("las claves repetidas tras normalizar se suman, todas las medidas incluido el stock", () => {
    const acum = acumular([
      { equivalencia: "PANTALON  VARIOS", unidades: "10", venta_soles: "100", costo_vendido: "40", stock_unidades: "5", stock_valorizado: "50" },
      { equivalencia: "pantalon varios", unidades: "1", venta_soles: "10", costo_vendido: "4", stock_unidades: "2", stock_valorizado: "20" },
    ]);
    expect(acum.entradasUnicas).toBe(1);
    const e = acum.entradas;
    expect(e.filas[0]).toBe(2);
    expect(e.primera[0]).toBe(1);
    expect([e.unidades[0], e.venta[0], e.costo[0], e.stockUnidades[0], e.stockValorizado[0]]).toEqual([11, 11000, 4400, 7, 7000]);
  });

  it("la clave distingue talla de origen (Central y Revisar se fusionan después, al resolver)", () => {
    const acum = acumular([{ talla: "Central" }, { talla: "Revisar" }]);
    expect(acum.entradasUnicas).toBe(2);
  });

  it("separa por mes y cuenta cada mes por su cuenta", () => {
    const acum = acumular([{ mes: "Ago" }, { mes: "Set" }, { mes: "Set", marca: "BETA" }]);
    expect(acum.diccionarios.periodos).toEqual(["2026-08", "2026-09"]);
    expect(acum.stats.map((s) => s.archivo.filas)).toEqual([1, 2]);
  });

  it("las filas excluidas por regla propia se cuentan por motivo, mes y valor con su primera fila", () => {
    const acum = acumular([{}, { venta_soles: "12,5" }, { venta_soles: "12,5" }, { tienda: "TOTAL" }, { mes: "xx" }]);
    const grupos = [...acum.exclusiones.values()];
    const num = grupos.find((g) => g.motivo === "numero_invalido");
    expect(num).toMatchObject({ filas: 2, primera_fila: 2, valor: "Venta (S/): 12,5" });
    expect(grupos.find((g) => g.motivo === "fila_total")?.filas).toBe(1);
    expect(grupos.find((g) => g.motivo === "mes_invalido")?.periodo).toBe(-1);
    expect(acum.sinMes.filas).toBe(1);
    expect(acum.filas).toBe(5);
  });

  it("las tallas desconocidas se cuentan aparte (ceden ante un error de tienda)", () => {
    const acum = acumular([{ talla: "XL" }, { talla: "XL" }, { talla: "XXL", tienda: "OTRA" }]);
    expect([...acum.tallasDesconocidas.values()].map((g) => [g.talla, g.filas])).toEqual([
      ["XL", 2],
      ["XXL", 1],
    ]);
    expect(acum.entradasUnicas).toBe(0);
  });
});

describe("Acumulador: sumas exactas (regla 18)", () => {
  it("100 000 filas con montos de 2 decimales suman lo mismo en cualquier orden", () => {
    const rng = aleatorio(42);
    const montos = Array.from({ length: 100_000 }, () => (Math.floor(rng() * 1_000_000) / 100).toFixed(2));
    const total = (orden: string[]) => {
      const acum = new Acumulador();
      orden.forEach((m, i) => {
        acum.agregar(interpretarFila(fila({ venta_soles: m, marca: `M${i % 7}` })), i + 1);
      });
      return acum.stats[0].archivo.venta;
    };
    const directo = montos.reduce((s, m) => s + Math.round(Number(m) * 100), 0);
    const invertido = [...montos].reverse();
    // mezcla determinista
    const mezclado = [...montos].sort((a, b) => (Number(a) * 7919) % 10007 - (Number(b) * 7919) % 10007);
    expect(total(montos)).toBe(directo);
    expect(total(invertido)).toBe(directo);
    expect(total(mezclado)).toBe(directo);
  }, 60_000);
});

describe("Acumulador: volumen (regla 19)", () => {
  it("400 000 filas sintéticas se acumulan en menos de 10 s (holgura por carga) sin guardar objetos por fila", () => {
    const rng = aleatorio(99);
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
    const tiendas = ["LUKERS UNO", "LUKERS DOS", "CD LUKERS"];
    const equivalencias = Array.from({ length: 400 }, (_, i) => `EQ ${i}`);
    const marcas = Array.from({ length: 150 }, (_, i) => `MARCA ${i}`);
    const acum = new Acumulador();
    const inicio = performance.now();
    for (let i = 0; i < 400_000; i++) {
      acum.agregar(
        interpretarFila(
          fila({
            mes: meses[i % 12],
            tienda: tiendas[i % 3],
            equivalencia: equivalencias[Math.floor(rng() * 400)],
            marca: marcas[Math.floor(rng() * 150)],
            talla: rng() < 0.2 ? "Extrema" : "Central",
            unidades: String(Math.floor(rng() * 20)),
            venta_soles: String(Math.floor(rng() * 1000)),
          })
        ),
        i + 1
      );
    }
    const ms = performance.now() - inicio;
    expect(ms).toBeLessThan(10_000);
    expect(acum.filas).toBe(400_000);
    // Las entradas son claves únicas (muchas filas se fusionan), no un objeto por fila.
    expect(acum.entradasUnicas).toBeLessThanOrEqual(400_000);
    // Memoria: se mide con los tamaños de los arreglos tipados, no con el proceso.
    expect(acum.bytesArreglos / acum.filas).toBeLessThan(300);
    expect(acum.diccionarios.marcas).toHaveLength(150);
    expect(acum.diccionarios.combinaciones).toHaveLength(400);
  }, 60_000);
});
