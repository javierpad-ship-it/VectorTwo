import { describe, expect, it } from "vitest";
import { alternarOrden, ORDEN_MARCA_INICIAL, ordenarMarcas } from "@/lib/marcas/ordenar";
import type { MarcaFila } from "@/lib/marcas/tipos-api";

const AGR = {
  ultra: { id: "a1", codigo: "ULTRA_LOW", nombre: "ULTRA LOW", orden: 10, activo: true },
  mid: { id: "a2", codigo: "MID_VALUE", nombre: "MID VALUE", orden: 20, activo: true },
  valor: { id: "a3", codigo: "VALOR", nombre: "VALOR", orden: 30, activo: true },
  premium: { id: "a5", codigo: "PREMIUM", nombre: "PREMIUM", orden: 50, activo: true },
} as const;

function marca(nombre: string, agr: keyof typeof AGR, extra: Partial<MarcaFila> = {}): MarcaFila {
  return {
    id: nombre,
    codigo: nombre.replace(/ /g, "_"),
    nombre,
    agrupacion_marca_id: AGR[agr].id,
    tratamiento_especial: false,
    nota_tratamiento: null,
    activo: true,
    created_at: "",
    updated_at: "",
    agrupacion_marca: AGR[agr],
    vigente: true,
    ...extra,
  };
}

const MARCAS = [
  marca("ALFA", "premium"),
  marca("BETA", "ultra"),
  marca("GAMMA", "valor"),
  marca("DELTA", "mid"),
  marca("EPSILON", "ultra"),
];

describe("ordenarMarcas", () => {
  it("por nombre ascendente es el orden inicial", () => {
    expect(ordenarMarcas(MARCAS, ORDEN_MARCA_INICIAL).map((m) => m.nombre)).toEqual(["ALFA", "BETA", "DELTA", "EPSILON", "GAMMA"]);
  });

  it("agrupación ordena por valor de marca (orden del catálogo), no alfabéticamente", () => {
    const asc = ordenarMarcas(MARCAS, { clave: "agrupacion", dir: "asc" }).map((m) => m.nombre);
    // ULTRA LOW (BETA, EPSILON) → MID VALUE (DELTA) → VALOR (GAMMA) → PREMIUM (ALFA); empates por nombre.
    expect(asc).toEqual(["BETA", "EPSILON", "DELTA", "GAMMA", "ALFA"]);
  });

  it("agrupación descendente invierte el valor y conserva el desempate por nombre ascendente", () => {
    const desc = ordenarMarcas(MARCAS, { clave: "agrupacion", dir: "desc" }).map((m) => m.nombre);
    expect(desc).toEqual(["ALFA", "GAMMA", "DELTA", "BETA", "EPSILON"]);
  });

  it("tratamiento y estado ordenan por booleano con desempate por nombre", () => {
    const m = [marca("B", "mid", { tratamiento_especial: true }), marca("A", "mid"), marca("C", "mid", { tratamiento_especial: true })];
    expect(ordenarMarcas(m, { clave: "tratamiento", dir: "desc" }).map((x) => x.nombre)).toEqual(["B", "C", "A"]);
    const e = [marca("B", "mid", { activo: false }), marca("A", "mid")];
    expect(ordenarMarcas(e, { clave: "estado", dir: "asc" }).map((x) => x.nombre)).toEqual(["B", "A"]);
  });

  it("no muta la lista original", () => {
    const copia = MARCAS.map((m) => m.nombre);
    ordenarMarcas(MARCAS, { clave: "codigo", dir: "desc" });
    expect(MARCAS.map((m) => m.nombre)).toEqual(copia);
  });
});

describe("alternarOrden", () => {
  it("pulsar otra columna empieza en ascendente y pulsar la misma invierte", () => {
    expect(alternarOrden(ORDEN_MARCA_INICIAL, "agrupacion")).toEqual({ clave: "agrupacion", dir: "asc" });
    expect(alternarOrden({ clave: "agrupacion", dir: "asc" }, "agrupacion")).toEqual({ clave: "agrupacion", dir: "desc" });
    expect(alternarOrden({ clave: "agrupacion", dir: "desc" }, "agrupacion")).toEqual({ clave: "agrupacion", dir: "asc" });
  });
});
