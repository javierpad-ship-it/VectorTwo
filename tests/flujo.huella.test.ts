import { describe, expect, it } from "vitest";
import { clavesCache, huellaCalculoFlujo, jsonCanonico } from "@/lib/flujo/huella";
import type { HuellaBaseJson } from "@/lib/flujo/tipos";

/** Regla 8 (huella) y 24 (caché) de la ficha 08: la huella cambia con cada insumo del flujo y solo con ellos. */

const base = (): HuellaBaseJson => ({
  cargas: [
    { periodo: "2026-08-01", carga_id: "c-ago", publicada_at: "2026-09-02T10:00:00Z" },
    { periodo: "2026-09-01", carga_id: "c-set", publicada_at: "2026-10-02T10:00:00Z" },
  ],
  cerradas: [{ id: "p-1", anio_en_curso: 2026, updated_at: "2026-10-05T10:00:00Z" }],
  compras: { eventos: 12, ultimo: "2026-10-20T10:00:00Z", revision: 30, actualizada: "2026-10-20T10:00:00Z" },
  parametros: "2026-10-01T09:00:00Z",
  repartos: { vigentes: 2, ultima: "2026-10-10T10:00:00Z" },
  reglas: { n: 3, ultima: "2026-10-11T10:00:00Z" },
  config: {
    marcas: [10, "2026-10-01T00:00:00Z"],
    marca_gml_especial: [4, "2026-10-01T00:00:00Z"],
    agrupaciones_marca: [3, "2026-09-01T00:00:00Z"],
    genero_mundo_linea: [20, "2026-09-01T00:00:00Z"],
    equivalencias: [8, "2026-09-01T00:00:00Z"],
    tiendas: [12, "2026-09-01T00:00:00Z"],
    responsables_genero_mundo: [6, "2026-09-01T00:00:00Z"],
  },
});

const huella = (b: HuellaBaseJson, mes = "2026-10") => huellaCalculoFlujo(b, mes);

describe("huellaCalculoFlujo (regla 8)", () => {
  it("es estable: el mismo insumo da la misma huella, aunque cambie el orden de las claves", () => {
    const b = base();
    const reordenada = JSON.parse(JSON.stringify({ config: b.config, reglas: b.reglas, repartos: b.repartos, parametros: b.parametros, compras: b.compras, cerradas: b.cerradas, cargas: b.cargas })) as HuellaBaseJson;
    expect(huella(b)).toBe(huella(base()));
    expect(huella(reordenada)).toBe(huella(b));
    expect(huella(b)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia si cambia la cerrada, una carga publicada del rango, cualquier compra (evento o revisión), un reparto vigente, una regla o los parámetros", () => {
    const original = huella(base());
    const cambios: ((b: HuellaBaseJson) => void)[] = [
      (b) => (b.cerradas[0].updated_at = "2026-10-06T00:00:00Z"),
      (b) => (b.cerradas = [...b.cerradas, { id: "p-2", anio_en_curso: 2027, updated_at: "2026-10-06T00:00:00Z" }]),
      (b) => (b.cargas[1].carga_id = "c-set-2"),
      (b) => b.cargas.push({ periodo: "2026-10-01", carga_id: "c-oct", publicada_at: "2026-11-02T00:00:00Z" }),
      (b) => (b.compras.eventos += 1),
      (b) => (b.compras.revision += 1),
      (b) => (b.compras.actualizada = "2026-10-21T00:00:00Z"),
      (b) => (b.repartos.vigentes += 1),
      (b) => (b.repartos.ultima = "2026-10-12T00:00:00Z"),
      (b) => (b.reglas.n += 1),
      (b) => (b.reglas.ultima = "2026-10-12T00:00:00Z"),
      (b) => (b.parametros = "2026-10-02T00:00:00Z"),
      (b) => (b.config.marcas = [10, "2026-10-09T00:00:00Z"]),
    ];
    const vistas = new Set<string>([original]);
    for (const cambiar of cambios) {
      const b = base();
      cambiar(b);
      const h = huella(b);
      expect(h).not.toBe(original);
      vistas.add(h);
    }
    expect(vistas.size).toBe(cambios.length + 1);
  });

  it("cambia con el mes de hoy en Lima y no cambia si no cambió nada", () => {
    expect(huella(base(), "2026-11")).not.toBe(huella(base(), "2026-10"));
    expect(huella(base(), "2026-10")).toBe(huella(base(), "2026-10"));
  });
});

describe("clavesCache (regla 24)", () => {
  it("una escritura de compras cambia solo la parte de compras: no hay que releer la cerrada ni el stock", () => {
    const a = clavesCache(base());
    const b0 = base();
    b0.compras.eventos += 1;
    b0.compras.revision += 1;
    const b = clavesCache(b0);
    expect(b.compras).not.toBe(a.compras);
    expect(b.cerradas).toBe(a.cerradas);
    expect(b.cargas).toBe(a.cargas);
    expect(b.config).toBe(a.config);
    expect(b.reglas).toBe(a.reglas);
    expect(b.repartos).toBe(a.repartos);
    expect(b.parametros).toBe(a.parametros);
  });

  it("publicar un mes cambia solo la parte de cargas; cambiar una marca a mixta, solo la de config", () => {
    const a = clavesCache(base());
    const p = base();
    p.cargas.push({ periodo: "2026-10-01", carga_id: "c-oct", publicada_at: "2026-11-02T00:00:00Z" });
    const publicado = clavesCache(p);
    expect(publicado.cargas).not.toBe(a.cargas);
    expect(publicado.compras).toBe(a.compras);
    const c = base();
    c.config.marca_gml_especial = [4, "2026-10-15T00:00:00Z"];
    const configurado = clavesCache(c);
    expect(configurado.config).not.toBe(a.config);
    expect(configurado.cargas).toBe(a.cargas);
  });
});

describe("jsonCanonico", () => {
  it("ordena las claves y respeta los arreglos", () => {
    expect(jsonCanonico({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(jsonCanonico(null)).toBe("null");
    expect(jsonCanonico({ x: undefined, y: 1 })).toBe('{"y":1}');
  });
});
