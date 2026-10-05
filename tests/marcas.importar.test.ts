import { describe, expect, it } from "vitest";
import {
  aplicarPlanMarcas,
  enTandas,
  leerSiNo,
  planificarImportacionMarcas,
  sinPrefijoNumerico,
  type EstadoImportacionMarcas,
} from "@/lib/marcas/importar";
import { SEED_AGRUPACIONES_MARCA } from "@/lib/marcas/seed";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { FilaImportacionMarca, FilaOmitidaMarca, MotivoOmisionMarca } from "@/lib/marcas/tipos";

// ─── Estado de seed (5 agrupaciones, sin marcas) ───

function estadoSeed(extra: Partial<EstadoImportacionMarcas> = {}): EstadoImportacionMarcas {
  return {
    agrupaciones: SEED_AGRUPACIONES_MARCA.map((a) => ({ id: `a-${a.codigo}`, codigo: a.codigo, nombre: a.nombre, activo: true })),
    marcas: [],
    ...extra,
  };
}

const fila = (marca: string, agrupacion: string, tratamiento_especial = ""): FilaImportacionMarca => ({
  marca,
  agrupacion,
  tratamiento_especial,
});

/** Entrada esperada en `omitidas`: la fila normalizada completa (tratamiento tal como vino) más motivo y extras. */
const omitida = (
  f: FilaImportacionMarca,
  numero: number,
  motivo: MotivoOmisionMarca,
  extra: Pick<FilaOmitidaMarca, "detalle" | "fila_original"> = {}
): FilaOmitidaMarca => ({
  fila: numero,
  motivo,
  ...extra,
  marca: normalizarNombre(f.marca),
  agrupacion: normalizarNombre(f.agrupacion),
  tratamiento_especial: f.tratamiento_especial,
});

// ─── Regla 7 ───

describe("leerSiNo (regla 7)", () => {
  it("verdaderos sin distinguir caja ni acentos", () => {
    for (const v of ["sí", "SI", " s ", "x", "1", "true", "verdadero", "yes", "Y", "Sí", "TRUE"]) {
      expect(leerSiNo(v), v).toBe(true);
    }
  });
  it("falsos, incluida la columna sin mapear", () => {
    for (const v of ["", "  ", "no", "N", "0", "false", "falso", "FALSE"]) expect(leerSiNo(v), v).toBe(false);
  });
  it("cualquier otra cosa → null", () => {
    for (const v of ["tal vez", "2", "si no", "nunca", "-"]) expect(leerSiNo(v), v).toBeNull();
    expect(leerSiNo(undefined)).toBe(false); // no string → como vacío
  });
});

// ─── Regla 8 ───

describe("sinPrefijoNumerico (regla 8)", () => {
  it("quita el número con que Javier prefija las agrupaciones", () => {
    expect(sinPrefijoNumerico("1 ULTRA LOW")).toBe("ULTRA LOW");
    expect(sinPrefijoNumerico("3 - VALOR")).toBe("VALOR");
    expect(sinPrefijoNumerico("5.PREMIUM")).toBe("PREMIUM");
    expect(sinPrefijoNumerico("2) mid value")).toBe("MID VALUE");
    expect(sinPrefijoNumerico("4: Reconocido")).toBe("RECONOCIDO");
  });
  it("sin prefijo no toca nada; un número solo no es un nombre", () => {
    expect(sinPrefijoNumerico("PREMIUM")).toBe("PREMIUM");
    expect(sinPrefijoNumerico("1")).toBe("");
    expect(sinPrefijoNumerico("  12  ")).toBe("");
    expect(sinPrefijoNumerico("7UP")).toBe("7UP");
    expect(sinPrefijoNumerico("")).toBe("");
  });
});

// ─── Regla 9 ───

describe("planificarImportacionMarcas · agrupación (regla 9)", () => {
  it("resuelve por código, por nombre y sin prefijo numérico", () => {
    const filas = [
      fila("A", "PREMIUM"),
      fila("B", "ultra_low"),
      fila("C", "1 Ultra Low"),
      fila("D", "3 - valor"),
      fila("E", "5.PREMIUM"),
      fila("F", "mid value"),
    ];
    const { reporte, marcas } = planificarImportacionMarcas(filas, estadoSeed());
    expect(reporte.omitidas).toEqual([]);
    expect(marcas.map((m) => m.agrupacion_marca_id)).toEqual([
      "a-PREMIUM",
      "a-ULTRA_LOW",
      "a-ULTRA_LOW",
      "a-VALOR",
      "a-PREMIUM",
      "a-MID_VALUE",
    ]);
    expect(reporte.muestra.marcas[2]).toBe("C → ULTRA LOW");
  });

  it("vacía, desconocida o inactiva → omitida con motivo y detalle; no crea agrupaciones", () => {
    const estado = estadoSeed();
    estado.agrupaciones[2] = { ...estado.agrupaciones[2], activo: false }; // VALOR inactiva
    const filas = [
      fila("A", ""),
      fila("B", "ULTRA LOWW"),
      fila("C", "VALOR"),
      fila("D", "3 - VALOR"),
      fila("E", "1"),
      fila("F", "PREMIUM"),
    ];
    const { reporte, marcas } = planificarImportacionMarcas(filas, estado);
    expect(reporte.omitidas).toEqual([
      omitida(filas[0], 1, "agrupacion_vacia"),
      omitida(filas[1], 2, "agrupacion_desconocida", { detalle: "ULTRA LOWW" }),
      omitida(filas[2], 3, "agrupacion_inactiva", { detalle: "VALOR" }),
      omitida(filas[3], 4, "agrupacion_inactiva", { detalle: "3 - VALOR" }),
      omitida(filas[4], 5, "agrupacion_desconocida", { detalle: "1" }),
    ]);
    expect(marcas).toHaveLength(1);
    expect(reporte.crear).toEqual({ marcas: 1, con_tratamiento_especial: 0 });
    expect(reporte.crear).not.toHaveProperty("agrupaciones");
  });
});

// ─── Regla 10 ───

describe("planificarImportacionMarcas · tratamiento especial (regla 10)", () => {
  it("inválido → omitida aunque marca y agrupación sean válidas; '' → false y se procesa", () => {
    const filas = [fila("ZARA", "VALOR", "tal vez"), fila("ACME", "VALOR"), fila("ADIDAS", "PREMIUM", "SI")];
    const { reporte, marcas } = planificarImportacionMarcas(filas, estadoSeed());
    expect(reporte.omitidas).toEqual([omitida(filas[0], 1, "tratamiento_invalido", { detalle: "tal vez" })]);
    expect(marcas.map((m) => m.tratamiento_especial)).toEqual([false, true]);
    expect(reporte.crear).toEqual({ marcas: 2, con_tratamiento_especial: 1 });
  });
});

// ─── Regla 11 ───

describe("planificarImportacionMarcas · duplicadas (regla 11)", () => {
  it("cuentan una vez, fila_original apunta a la primera y detalle informa la agrupación distinta", () => {
    const filas = [
      fila("Adidas", "PREMIUM", "SI"),
      fila("NIKE", "PREMIUM"),
      fila(" adidas ", "PREMIUM", "SI"),
      fila("ADIDAS", "VALOR", "SI"),
    ];
    const { reporte, marcas } = planificarImportacionMarcas(filas, estadoSeed());
    expect(marcas.map((m) => m.nombre)).toEqual(["ADIDAS", "NIKE"]);
    expect(reporte.omitidas).toEqual([
      omitida(filas[2], 3, "duplicada_en_archivo", { fila_original: 1 }),
      omitida(filas[3], 4, "duplicada_en_archivo", { fila_original: 1, detalle: "agrupación distinta: VALOR" }),
    ]);
    expect(reporte.totales).toEqual({ recibidas: 4, procesadas: 2, omitidas: 2 });
  });

  it("marca_vacia y fila_total se omiten antes de la comprobación de duplicados", () => {
    const filas = [fila("", "PREMIUM"), fila("  ", "PREMIUM"), fila("TOTAL", "PREMIUM"), fila("total", ""), fila("X", "PREMIUM")];
    const { reporte } = planificarImportacionMarcas(filas, estadoSeed());
    expect(reporte.omitidas.map((o) => o.motivo)).toEqual(["marca_vacia", "marca_vacia", "fila_total", "fila_total"]);
    expect(reporte.omitidas.every((o) => o.fila_original === undefined)).toBe(true);
    expect(reporte.crear.marcas).toBe(1);
  });
});

// ─── Regla 12 ───

describe("planificarImportacionMarcas · existentes y diferencias (regla 12)", () => {
  const estado = estadoSeed({
    marcas: [
      {
        id: "m1",
        nombre: "LEVI'S",
        codigo: "LEVI_S",
        agrupacion_marca_id: "a-RECONOCIDO",
        tratamiento_especial: true,
        activo: true,
      },
      { id: "m2", nombre: "ZARA", codigo: "ZARA", agrupacion_marca_id: "a-VALOR", tratamiento_especial: false, activo: false },
      { id: "m3", nombre: "NIKE", codigo: "NIKE", agrupacion_marca_id: "a-PREMIUM", tratamiento_especial: false, activo: true },
    ],
  });

  it("nunca entran en crear; se cuentan en existentes o existentes_inactivos", () => {
    const filas = [fila("levi's", "RECONOCIDO", "si"), fila("ZARA", "VALOR"), fila("NIKE", "PREMIUM", "no")];
    const { reporte, marcas } = planificarImportacionMarcas(filas, estado);
    expect(marcas).toEqual([]);
    expect(reporte.crear.marcas).toBe(0);
    expect(reporte.existentes.marcas).toBe(2);
    expect(reporte.existentes_inactivos.marcas).toBe(1);
    expect(reporte.diferencias).toEqual([]);
  });

  it("si difieren agrupación o tratamiento, aparecen en diferencias con valores legibles", () => {
    const filas = [fila("LEVI'S", "PREMIUM", "NO"), fila("ZARA", "1 ULTRA LOW"), fila("NIKE", "PREMIUM", "X")];
    const { reporte } = planificarImportacionMarcas(filas, estado);
    expect(reporte.diferencias).toEqual([
      { fila: 1, marca: "LEVI'S", campo: "agrupacion", en_base: "RECONOCIDO", en_archivo: "PREMIUM" },
      { fila: 1, marca: "LEVI'S", campo: "tratamiento_especial", en_base: "SI", en_archivo: "NO" },
      { fila: 2, marca: "ZARA", campo: "agrupacion", en_base: "VALOR", en_archivo: "ULTRA LOW" },
      { fila: 3, marca: "NIKE", campo: "tratamiento_especial", en_base: "NO", en_archivo: "SI" },
    ]);
    // Informativo: el plan no modifica ni reactiva nada.
    const despues = aplicarPlanMarcas(estado, planificarImportacionMarcas(filas, estado));
    expect(despues.marcas).toEqual(estado.marcas);
  });
});

// ─── Regla 13 ───

describe("planificarImportacionMarcas · códigos (regla 13)", () => {
  it("codigoUnico sobre los de la base más los del archivo", () => {
    const estado = estadoSeed({
      marcas: [{ id: "m1", nombre: "H&M", codigo: "H_M", agrupacion_marca_id: "a-VALOR", tratamiento_especial: false, activo: true }],
    });
    const filas = [fila("LEVI'S", "PREMIUM"), fila("LEVI-S", "PREMIUM"), fila("H M", "VALOR"), fila("---", "VALOR")];
    const { marcas } = planificarImportacionMarcas(filas, estado);
    expect(marcas.map((m) => [m.nombre, m.codigo])).toEqual([
      ["LEVI'S", "LEVI_S"],
      ["LEVI-S", "LEVI_S_2"],
      ["H M", "H_M_2"],
      ["---", "MARCA"],
    ]);
  });
});

// ─── Regla 14 ───

describe("planificarImportacionMarcas · idempotencia (regla 14)", () => {
  const filas = [
    fila("Adidas", "PREMIUM", "SI"),
    fila("NIKE", "1 ULTRA LOW"),
    fila("ZARA", "VALOR", "tal vez"),
    fila("ADIDAS", "VALOR"),
    fila("ACME", "ULTRA LOWW"),
    fila("TOTAL", ""),
    fila("PUMA", "MID VALUE", "no"),
  ];

  it("reimportar tras aplicar no crea nada, cuenta las mismas existentes y no tiene diferencias", () => {
    const estado = estadoSeed();
    const plan1 = planificarImportacionMarcas(filas, estado);
    expect(plan1.reporte.crear).toEqual({ marcas: 3, con_tratamiento_especial: 1 });

    const estado2 = aplicarPlanMarcas(estado, plan1);
    expect(estado2.marcas).toHaveLength(3);
    expect(estado.marcas).toHaveLength(0); // no muta

    const plan2 = planificarImportacionMarcas(filas, estado2);
    expect(plan2.reporte.crear).toEqual({ marcas: 0, con_tratamiento_especial: 0 });
    expect(plan2.reporte.existentes.marcas).toBe(3);
    expect(plan2.reporte.existentes_inactivos.marcas).toBe(0);
    expect(plan2.reporte.diferencias).toEqual([]);
    expect(plan2.reporte.omitidas).toEqual(plan1.reporte.omitidas);
    expect(plan2.marcas).toEqual([]);

    // Aplicar dos veces el mismo plan produce el mismo estado.
    expect(aplicarPlanMarcas(estado2, plan1)).toEqual(estado2);
    expect(aplicarPlanMarcas(estado2, plan2)).toEqual(estado2);
  });
});

// ─── Regla 15 ───

describe("planificarImportacionMarcas · conteos consistentes (regla 15)", () => {
  it("recibidas = procesadas + omitidas; procesadas = crear + existentes + existentes_inactivos", () => {
    const estado = estadoSeed({
      marcas: [
        { id: "m1", nombre: "NIKE", codigo: "NIKE", agrupacion_marca_id: "a-PREMIUM", tratamiento_especial: false, activo: true },
        { id: "m2", nombre: "ZARA", codigo: "ZARA", agrupacion_marca_id: "a-VALOR", tratamiento_especial: true, activo: false },
      ],
    });
    const filas = [
      fila("Adidas", "PREMIUM", "SI"),
      fila("NIKE", "PREMIUM"),
      fila("ZARA", "VALOR", "si"),
      fila("ADIDAS", "VALOR"),
      fila("ACME", "ULTRA LOWW"),
      fila("", "PREMIUM"),
      fila("PUMA", "MID VALUE", "x"),
      fila("REEBOK", "RECONOCIDO", "quizás"),
    ];
    const { reporte } = planificarImportacionMarcas(filas, estado);
    const { totales, crear, existentes, existentes_inactivos } = reporte;
    expect(totales.recibidas).toBe(filas.length);
    expect(totales.recibidas).toBe(totales.procesadas + totales.omitidas);
    expect(totales.procesadas).toBe(crear.marcas + existentes.marcas + existentes_inactivos.marcas);
    expect(crear.con_tratamiento_especial).toBeLessThanOrEqual(crear.marcas);
    expect(crear).toEqual({ marcas: 2, con_tratamiento_especial: 2 });
    expect(totales.omitidas).toBe(reporte.omitidas.length);
  });

  it("la muestra lista como mucho 20 marcas con su agrupación", () => {
    const filas = Array.from({ length: 25 }, (_, i) => fila(`MARCA ${i + 1}`, "PREMIUM"));
    const { reporte } = planificarImportacionMarcas(filas, estadoSeed());
    expect(reporte.muestra.marcas).toHaveLength(20);
    expect(reporte.muestra.marcas[0]).toBe("MARCA 1 → PREMIUM");
    expect(reporte.crear.marcas).toBe(25);
  });

  it("enTandas parte en 500 para el upsert", () => {
    const tandas = enTandas(Array.from({ length: 1201 }, (_, i) => i));
    expect(tandas.map((t) => t.length)).toEqual([500, 500, 201]);
  });
});
