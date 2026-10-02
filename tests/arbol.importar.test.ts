import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aplicarPlan,
  buscarEnCatalogo,
  codigoUnico,
  enTandas,
  planificarImportacion,
  resolverCatalogo,
  type EstadoImportacion,
} from "@/lib/arbol/importar";
import { EQUIVALENCIA_GENERICA, aCodigo, esEquivalenciaGenerica, normalizarNombre } from "@/lib/arbol/normalizar";
import type { FilaImportacion, FilaOmitida, MotivoOmision } from "@/lib/arbol/tipos";

// ─── Estado de seed (8 géneros, 5 mundos, sin líneas) ───

const SEED_GENEROS = [
  ["H", "HOMBRE"],
  ["M", "MUJER"],
  ["JOVENCITOS", "JOVENCITOS"],
  ["JOVENCITAS", "JOVENCITAS"],
  ["NINOS", "NIÑOS"],
  ["NINAS", "NIÑAS"],
  ["BEBE", "BEBE"],
  ["OTROS", "OTROS"],
] as const;

const SEED_MUNDOS = [
  ["CASUAL", "CASUAL"],
  ["URBANO", "URBANO"],
  ["DEPORTIVO", "DEPORTIVO"],
  ["FORMAL", "FORMAL"],
  ["RI", "RI"],
] as const;

function estadoSeed(): EstadoImportacion {
  return {
    generos: SEED_GENEROS.map(([codigo, nombre]) => ({ id: `g-${codigo}`, codigo, nombre, activo: true })),
    mundos: SEED_MUNDOS.map(([codigo, nombre]) => ({ id: `m-${codigo}`, codigo, nombre, activo: true })),
    lineas: [],
    nodos: [],
    equivalencias: [],
  };
}

const fila = (genero: string, mundo: string, linea: string, equivalencia: string): FilaImportacion => ({
  genero,
  mundo,
  linea,
  equivalencia,
});

/** Entrada esperada en `omitidas`: la fila normalizada completa más motivo, detalle y fila_original. */
const omitida = (
  f: FilaImportacion,
  numero: number,
  motivo: MotivoOmision,
  extra: Pick<FilaOmitida, "detalle" | "fila_original"> = {}
): FilaOmitida => ({
  fila: numero,
  motivo,
  ...extra,
  genero: normalizarNombre(f.genero),
  mundo: normalizarNombre(f.mundo),
  linea: normalizarNombre(f.linea),
  equivalencia: normalizarNombre(f.equivalencia),
});

// ─── Reglas 5–11 y 19 ───

describe("planificarImportacion · omisiones (regla 5)", () => {
  it("omite línea vacía, fila TOTAL, género desconocido y mundo desconocido, sin generar nada", () => {
    const filas = [
      fila("H", "URBANO", "", "X"),
      fila("TOTAL", "", "PANTALON", ""),
      fila("MARCIANOS", "URBANO", "PANTALON", "VARIOS"),
      fila("H", "ESPACIAL", "PANTALON", "VARIOS"),
    ];
    const plan = planificarImportacion(filas, estadoSeed());
    expect(plan.reporte.omitidas).toEqual([
      omitida(filas[0], 1, "linea_vacia"),
      omitida(filas[1], 2, "fila_total"),
      omitida(filas[2], 3, "genero_desconocido", { detalle: "MARCIANOS" }),
      omitida(filas[3], 4, "mundo_desconocido", { detalle: "ESPACIAL" }),
    ]);
    expect(plan.reporte.totales).toEqual({ recibidas: 4, procesadas: 0, omitidas: 4 });
    expect(plan.reporte.crear).toEqual({ lineas: 0, nodos: 0, equivalencias: 0, equivalencias_genericas: 0 });
    expect(plan.lineas).toEqual([]);
    expect(plan.nodos).toEqual([]);
    expect(plan.equivalencias).toEqual([]);
  });
  it("resuelve géneros y mundos por código o por nombre, con cualquier caja y acentos", () => {
    const plan = planificarImportacion(
      [fila("niñas", "urbano", "BLUSA", "A"), fila("HOMBRE", "Deportivo", "BLUSA", "A"), fila("ninas", "URBANO", "BLUSA", "B")],
      estadoSeed()
    );
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.nodos).toEqual([
      { genero_id: "g-NINAS", mundo_id: "m-URBANO", linea_nombre: "BLUSA" },
      { genero_id: "g-H", mundo_id: "m-DEPORTIVO", linea_nombre: "BLUSA" },
    ]);
  });
});

describe("planificarImportacion · mundo vacío (regla 6: no existen líneas sin mundo)", () => {
  it("omite la fila con motivo mundo_vacio y no crea nada con ella", () => {
    const filas = [fila("H", "URBANO", "PANTALON", "VARIOS"), fila("bebe", "  ", " body ", ""), fila("NIÑAS", "", "BLUSA", "A")];
    const plan = planificarImportacion(filas, estadoSeed());
    // La fila viaja completa y normalizada para poder corregir el archivo.
    expect(plan.reporte.omitidas).toEqual([
      { fila: 2, motivo: "mundo_vacio", genero: "BEBE", mundo: "", linea: "BODY", equivalencia: "" },
      omitida(filas[2], 3, "mundo_vacio"),
    ]);
    expect(plan.reporte.totales).toEqual({ recibidas: 3, procesadas: 1, omitidas: 2 });
    expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 1, equivalencias: 1, equivalencias_genericas: 0 });
    expect(plan.lineas.map((l) => l.nombre)).toEqual(["PANTALON"]);
    expect(plan.nodos).toEqual([{ genero_id: "g-H", mundo_id: "m-URBANO", linea_nombre: "PANTALON" }]);
  });
  it("el reporte ya no trae sin_mundo y el género se valida antes que el mundo", () => {
    const f = fila("MARCIANOS", "", "PANTALON", "");
    const plan = planificarImportacion([f], estadoSeed());
    expect(plan.reporte).not.toHaveProperty("sin_mundo");
    expect(plan.reporte.omitidas).toEqual([omitida(f, 1, "genero_desconocido", { detalle: "MARCIANOS" })]);
  });
  it("una fila con mundo vacío no cuenta como duplicada de otra igual", () => {
    const plan = planificarImportacion([fila("H", "", "PANTALON", "A"), fila("H", "", "PANTALON", "A")], estadoSeed());
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["mundo_vacio", "mundo_vacio"]);
  });
});

describe("planificarImportacion · genérica (regla 7)", () => {
  it("'' y '-' en el mismo nodo producen una sola genérica", () => {
    const plan = planificarImportacion(
      [fila("H", "URBANO", "PANTALON", ""), fila("H", "URBANO", "PANTALON", "-"), fila("H", "URBANO", "PANTALON", "  ")],
      estadoSeed()
    );
    expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 1, equivalencias: 0, equivalencias_genericas: 1 });
    expect(plan.equivalencias).toEqual([
      {
        genero_id: "g-H",
        mundo_id: "m-URBANO",
        linea_nombre: "PANTALON",
        nombre: "SIN EQUIVALENCIA",
        codigo: "SIN_EQUIVALENCIA",
        es_generica: true,
      },
    ]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["duplicada_en_archivo", "duplicada_en_archivo"]);
  });
  it("un nodo con reales y genéricas crea las reales más una genérica", () => {
    const plan = planificarImportacion(
      [
        fila("H", "URBANO", "PANTALON", "JOGGER"),
        fila("H", "URBANO", "PANTALON", "-"),
        fila("H", "URBANO", "PANTALON", "CARGO"),
        fila("H", "URBANO", "PANTALON", ""),
      ],
      estadoSeed()
    );
    expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 1, equivalencias: 2, equivalencias_genericas: 1 });
    expect(plan.equivalencias.map((e) => e.codigo)).toEqual(["JOGGER", "SIN_EQUIVALENCIA", "CARGO"]);
  });
  it("una equivalencia escrita 'SIN EQUIVALENCIA' también es la genérica", () => {
    const plan = planificarImportacion([fila("H", "URBANO", "PANTALON", "sin equivalencia")], estadoSeed());
    expect(plan.reporte.crear.equivalencias_genericas).toBe(1);
    expect(plan.reporte.crear.equivalencias).toBe(0);
  });
  it("una real 'SIN-EQUIVALENCIA' (código derivado SIN_EQUIVALENCIA) más un vacío en el mismo nodo no repiten código", () => {
    // "SIN-EQUIVALENCIA" no es la genérica (solo lo son '', '-' y 'SIN EQUIVALENCIA'),
    // pero aCodigo() la lleva a SIN_EQUIVALENCIA: el código de la genérica queda
    // reservado y la real recibe el sufijo, en cualquier orden de llegada.
    for (const filas of [
      [fila("H", "URBANO", "PANTALON", "SIN-EQUIVALENCIA"), fila("H", "URBANO", "PANTALON", "")],
      [fila("H", "URBANO", "PANTALON", ""), fila("H", "URBANO", "PANTALON", "SIN-EQUIVALENCIA")],
    ]) {
      const plan = planificarImportacion(filas, estadoSeed());
      expect(plan.reporte.omitidas).toEqual([]);
      expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 1, equivalencias: 1, equivalencias_genericas: 1 });
      const generica = plan.equivalencias.find((e) => e.es_generica);
      const real = plan.equivalencias.find((e) => !e.es_generica);
      expect(generica?.codigo).toBe("SIN_EQUIVALENCIA");
      expect(real?.nombre).toBe("SIN-EQUIVALENCIA");
      expect(real?.codigo).toBe("SIN_EQUIVALENCIA_2");
      expect(new Set(plan.equivalencias.map((e) => e.codigo)).size).toBe(plan.equivalencias.length);
    }
  });
  it("si la base ya tiene una real con código SIN_EQUIVALENCIA en el nodo, la genérica nueva lleva sufijo", () => {
    const estado = estadoSeed();
    estado.lineas = [{ id: "l-pant", codigo: "PANTALON", nombre: "PANTALON", activo: true }];
    estado.nodos = [{ id: "n1", genero_id: "g-H", mundo_id: "m-URBANO", linea_id: "l-pant", activo: true }];
    estado.equivalencias = [
      { id: "e1", genero_mundo_linea_id: "n1", nombre: "SIN-EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: false, activo: true },
    ];
    const plan = planificarImportacion([fila("H", "URBANO", "PANTALON", "")], estado);
    expect(plan.equivalencias).toEqual([
      { genero_id: "g-H", mundo_id: "m-URBANO", linea_nombre: "PANTALON", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA_2", es_generica: true },
    ]);
  });
});

describe("planificarImportacion · géneros y mundos inactivos", () => {
  it("omite con genero_inactivo / mundo_inactivo y no crea nada bajo ellos", () => {
    const estado = estadoSeed();
    estado.generos = estado.generos.map((g) => (g.codigo === "OTROS" ? { ...g, activo: false } : g));
    estado.mundos = estado.mundos.map((m) => (m.codigo === "RI" ? { ...m, activo: false } : m));
    const filas = [
      fila("OTROS", "URBANO", "PANTALON", "A"),
      fila("otros", "URBANO", "PANTALON", "B"),
      fila("H", "RI", "PANTALON", "A"),
      fila("H", "ri", "PANTALON", "B"),
      fila("H", "URBANO", "PANTALON", "A"),
      fila("MARCIANOS", "URBANO", "PANTALON", "A"),
    ];
    const plan = planificarImportacion(filas, estado);
    expect(plan.reporte.omitidas).toEqual([
      omitida(filas[0], 1, "genero_inactivo", { detalle: "OTROS" }),
      omitida(filas[1], 2, "genero_inactivo", { detalle: "OTROS" }),
      omitida(filas[2], 3, "mundo_inactivo", { detalle: "RI" }),
      omitida(filas[3], 4, "mundo_inactivo", { detalle: "RI" }),
      omitida(filas[5], 6, "genero_desconocido", { detalle: "MARCIANOS" }),
    ]);
    expect(plan.reporte.totales).toEqual({ recibidas: 6, procesadas: 1, omitidas: 5 });
    expect(plan.nodos).toEqual([{ genero_id: "g-H", mundo_id: "m-URBANO", linea_nombre: "PANTALON" }]);
    expect(plan.nodos.some((n) => n.genero_id === "g-OTROS" || n.mundo_id === "m-RI")).toBe(false);
  });
});

describe("planificarImportacion · duplicados (regla 8)", () => {
  it("filas iguales tras normalizar cuentan una vez y el duplicado señala su primera aparición", () => {
    const filas = [
      fila("H", "URBANO", "Pantalón", "jogger"),
      fila(" h ", "urbano", "PANTALÓN", "JOGGER "),
      fila("H", "URBANO", "PANTALÓN", "CARGO"),
    ];
    const plan = planificarImportacion(filas, estadoSeed());
    expect(plan.reporte.omitidas).toEqual([
      { fila: 2, motivo: "duplicada_en_archivo", fila_original: 1, genero: "H", mundo: "URBANO", linea: "PANTALÓN", equivalencia: "JOGGER" },
    ]);
    expect(plan.reporte.totales).toEqual({ recibidas: 3, procesadas: 2, omitidas: 1 });
    expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 1, equivalencias: 2, equivalencias_genericas: 0 });
  });
  it("fila_original apunta siempre a la primera aparición, también para '' y '-' (misma genérica)", () => {
    const filas = [
      fila("H", "URBANO", "PANTALON", "A"),
      fila("H", "URBANO", "PANTALON", ""),
      fila("H", "URBANO", "PANTALON", "-"),
      fila("H", "URBANO", "PANTALON", "A"),
      fila("H", "URBANO", "PANTALON", "A"),
      fila("H", "URBANO", "PANTALON", "sin equivalencia"),
    ];
    const plan = planificarImportacion(filas, estadoSeed());
    expect(plan.reporte.omitidas).toEqual([
      omitida(filas[2], 3, "duplicada_en_archivo", { fila_original: 2 }),
      omitida(filas[3], 4, "duplicada_en_archivo", { fila_original: 1 }),
      omitida(filas[4], 5, "duplicada_en_archivo", { fila_original: 1 }),
      omitida(filas[5], 6, "duplicada_en_archivo", { fila_original: 2 }),
    ]);
    // La equivalencia se muestra como vino ('-'), no como la genérica a la que cae.
    expect(plan.reporte.omitidas[0].equivalencia).toBe("-");
    expect(plan.reporte.omitidas[3].equivalencia).toBe(EQUIVALENCIA_GENERICA.nombre);
    // Las omisiones que no son duplicados no llevan fila_original.
    const otra = planificarImportacion([fila("H", "", "PANTALON", "A")], estadoSeed());
    expect(otra.reporte.omitidas[0]).not.toHaveProperty("fila_original");
  });
  it("la misma línea en dos mundos es un catálogo y dos nodos", () => {
    const plan = planificarImportacion([fila("H", "URBANO", "PANTALON", "A"), fila("M", "CASUAL", "PANTALON", "A")], estadoSeed());
    expect(plan.reporte.crear).toEqual({ lineas: 1, nodos: 2, equivalencias: 2, equivalencias_genericas: 0 });
  });
});

const ARCHIVO_CHICO: FilaImportacion[] = [
  fila("H", "URBANO", "PANTALON", "JOGGER"),
  fila("H", "URBANO", "PANTALON", "-"),
  fila("H", "URBANO", "PANTALON", "VARIOS"),
  fila("M", "URBANO", "PANTALON", "VARIOS"),
  fila("M", "CASUAL", "BLUSA", ""),
  fila("BEBE", "", "BODY", "VARIOS"), // mundo vacío: se omite
  fila("H", "URBANO", "PANTALON", "JOGGER"), // duplicada
  fila("TOTAL", "", "", ""), // línea vacía
];

describe("planificarImportacion · idempotencia (regla 9)", () => {
  it("tras aplicarPlan, el mismo archivo no crea nada y lo cuenta como existente", () => {
    const estado = estadoSeed();
    const plan1 = planificarImportacion(ARCHIVO_CHICO, estado);
    expect(plan1.reporte.crear).toEqual({ lineas: 2, nodos: 3, equivalencias: 3, equivalencias_genericas: 2 });
    expect(plan1.reporte.omitidas).toEqual([
      omitida(ARCHIVO_CHICO[5], 6, "mundo_vacio"),
      omitida(ARCHIVO_CHICO[6], 7, "duplicada_en_archivo", { fila_original: 1 }),
      omitida(ARCHIVO_CHICO[7], 8, "linea_vacia"),
    ]);

    const estado2 = aplicarPlan(estado, plan1);
    expect(estado2.lineas).toHaveLength(2);
    expect(estado2.nodos).toHaveLength(3);
    expect(estado2.equivalencias).toHaveLength(5);

    const plan2 = planificarImportacion(ARCHIVO_CHICO, estado2);
    expect(plan2.reporte.crear).toEqual({ lineas: 0, nodos: 0, equivalencias: 0, equivalencias_genericas: 0 });
    expect(plan2.reporte.existentes).toEqual({
      lineas: plan1.reporte.crear.lineas,
      nodos: plan1.reporte.crear.nodos,
      equivalencias: plan1.reporte.crear.equivalencias + plan1.reporte.crear.equivalencias_genericas,
    });
    expect(plan2.reporte.totales).toEqual(plan1.reporte.totales);
    expect(plan2.reporte.omitidas).toEqual(plan1.reporte.omitidas);
    expect(plan2.lineas).toEqual([]);
    expect(plan2.nodos).toEqual([]);
    expect(plan2.equivalencias).toEqual([]);
  });
  it("aplicar dos veces el mismo plan produce el mismo estado y no muta el original", () => {
    const estado = estadoSeed();
    const copia = JSON.parse(JSON.stringify(estado));
    const plan = planificarImportacion(ARCHIVO_CHICO, estado);
    const una = aplicarPlan(estado, plan);
    const dos = aplicarPlan(una, plan);
    expect(dos).toEqual(una);
    expect(estado).toEqual(copia);
  });
});

describe("planificarImportacion · inactivos (regla 10)", () => {
  it("lo existente pero inactivo va a existentes_inactivos y el plan no lo toca", () => {
    const estado = estadoSeed();
    estado.lineas = [{ id: "l-pant", codigo: "PANTALON", nombre: "PANTALON", activo: false }];
    estado.nodos = [{ id: "n1", genero_id: "g-H", mundo_id: "m-URBANO", linea_id: "l-pant", activo: false }];
    estado.equivalencias = [
      { id: "e1", genero_mundo_linea_id: "n1", nombre: "JOGGER", codigo: "JOGGER", es_generica: false, activo: false },
      { id: "e2", genero_mundo_linea_id: "n1", nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA", es_generica: true, activo: true },
    ];
    const plan = planificarImportacion(
      [fila("H", "URBANO", "PANTALON", "JOGGER"), fila("H", "URBANO", "PANTALON", "-"), fila("H", "URBANO", "PANTALON", "CARGO")],
      estado
    );
    expect(plan.reporte.existentes_inactivos).toEqual({ lineas: 1, nodos: 1, equivalencias: 1 });
    expect(plan.reporte.existentes).toEqual({ lineas: 0, nodos: 0, equivalencias: 1 });
    expect(plan.reporte.crear).toEqual({ lineas: 0, nodos: 0, equivalencias: 1, equivalencias_genericas: 0 });
    expect(plan.equivalencias).toEqual([
      { genero_id: "g-H", mundo_id: "m-URBANO", linea_nombre: "PANTALON", nombre: "CARGO", codigo: "CARGO", es_generica: false },
    ]);

    const despues = aplicarPlan(estado, plan);
    expect(despues.lineas[0].activo).toBe(false);
    expect(despues.nodos[0].activo).toBe(false);
    expect(despues.equivalencias.find((e) => e.id === "e1")?.activo).toBe(false);
  });
});

describe("planificarImportacion · consistencia (regla 11)", () => {
  it("recibidas = procesadas + omitidas y cada fila procesada es una equivalencia", () => {
    const { reporte } = planificarImportacion(ARCHIVO_CHICO, estadoSeed());
    expect(reporte.totales.recibidas).toBe(ARCHIVO_CHICO.length);
    expect(reporte.totales.recibidas).toBe(reporte.totales.procesadas + reporte.totales.omitidas);
    expect(reporte.totales.procesadas).toBe(
      reporte.crear.equivalencias +
        reporte.crear.equivalencias_genericas +
        reporte.existentes.equivalencias +
        reporte.existentes_inactivos.equivalencias
    );
  });
  it("la muestra trae a lo sumo 20 líneas y 20 nodos con el formato 'CODIGO / MUNDO / LINEA'", () => {
    const muchas = Array.from({ length: 30 }, (_, i) => fila("H", "URBANO", `LINEA ${i}`, "X"));
    const { reporte } = planificarImportacion(muchas, estadoSeed());
    expect(reporte.muestra.lineas).toHaveLength(20);
    expect(reporte.muestra.nodos).toHaveLength(20);
    expect(reporte.muestra.nodos[0]).toBe("H / URBANO / LINEA 0");
    expect(reporte.crear.lineas).toBe(30);
  });
});

describe("planificarImportacion · nunca toca géneros, mundos ni activo (regla 19)", () => {
  it("plan.crear no tiene claves generos/mundos y el plan solo trae líneas, nodos y equivalencias", () => {
    const plan = planificarImportacion(ARCHIVO_CHICO, estadoSeed());
    expect(plan.reporte.crear).not.toHaveProperty("generos");
    expect(plan.reporte.crear).not.toHaveProperty("mundos");
    expect(Object.keys(plan.reporte.crear).sort()).toEqual(["equivalencias", "equivalencias_genericas", "lineas", "nodos"]);
    expect(Object.keys(plan).sort()).toEqual(["equivalencias", "lineas", "nodos", "reporte"]);
  });
  it("aplicarPlan conserva géneros y mundos idénticos y todo lo creado nace activo", () => {
    const estado = estadoSeed();
    const despues = aplicarPlan(estado, planificarImportacion(ARCHIVO_CHICO, estado));
    expect(despues.generos).toBe(estado.generos);
    expect(despues.mundos).toBe(estado.mundos);
    expect(despues.lineas.every((l) => l.activo)).toBe(true);
    expect(despues.nodos.every((n) => n.activo)).toBe(true);
    expect(despues.equivalencias.every((e) => e.activo)).toBe(true);
  });
});

describe("utilidades", () => {
  it("resolverCatalogo acepta código o nombre y rechaza vacío", () => {
    const { generos } = estadoSeed();
    expect(resolverCatalogo(generos, "niñas")?.id).toBe("g-NINAS");
    expect(resolverCatalogo(generos, "NIÑAS")?.id).toBe("g-NINAS");
    expect(resolverCatalogo(generos, "hombre")?.id).toBe("g-H");
    expect(resolverCatalogo(generos, "")).toBeUndefined();
    expect(resolverCatalogo(generos, "ZZZ")).toBeUndefined();
  });
  it("resolverCatalogo ignora los inactivos; buscarEnCatalogo los encuentra igual", () => {
    const generos = estadoSeed().generos.map((g) => (g.codigo === "BEBE" ? { ...g, activo: false } : g));
    expect(resolverCatalogo(generos, "BEBE")).toBeUndefined();
    expect(buscarEnCatalogo(generos, "BEBE")?.id).toBe("g-BEBE");
    expect(resolverCatalogo(generos, "H")?.id).toBe("g-H");
  });
  it("codigoUnico agrega sufijo sin pasar de 40 caracteres", () => {
    const usados = new Set(["POLO_M_C"]);
    expect(codigoUnico("POLO_M_C", usados)).toBe("POLO_M_C_2");
    usados.add("POLO_M_C_2");
    expect(codigoUnico("POLO_M_C", usados)).toBe("POLO_M_C_3");
    expect(codigoUnico("", usados, "LINEA")).toBe("LINEA");
    const largo = "A".repeat(40);
    expect(codigoUnico(largo, new Set([largo]))).toHaveLength(40);
  });
  it("enTandas parte en bloques de 500", () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    const tandas = enTandas(items);
    expect(tandas.map((t) => t.length)).toEqual([500, 500, 201]);
    expect(enTandas([])).toEqual([]);
  });
});

// ─── Archivo real (solo si existe en datos/, que está fuera del repo) ───

const RUTA_CSV = path.resolve(__dirname, "../datos/arbol-lineas.csv");
const hayCsv = fs.existsSync(RUTA_CSV);

/** Parser CSV mínimo: coma, comillas dobles con escape "" y CRLF/LF. */
function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => !(f.length === 1 && f[0] === ""));
}

const COLUMNAS: Record<keyof FilaImportacion, string[]> = {
  genero: ["GENERO_LK", "GENERO", "GÉNERO"],
  mundo: ["MUNDO", "GRUPO_PRODUCTO"],
  linea: ["LINEA", "LÍNEA"],
  equivalencia: ["EQUIVALENCIA"],
};

function leerFilasCsv(): FilaImportacion[] {
  const texto = fs.readFileSync(RUTA_CSV, "utf8").replace(/^﻿/, "");
  const [cabecera, ...cuerpo] = parsearCsv(texto);
  const indice = (campo: keyof FilaImportacion) => {
    const i = cabecera.findIndex((h) => COLUMNAS[campo].includes(normalizarNombre(h)));
    if (i < 0) throw new Error(`No se encontró la columna ${campo} en ${cabecera.join(",")}`);
    return i;
  };
  const ig = indice("genero");
  const im = indice("mundo");
  const il = indice("linea");
  const ie = indice("equivalencia");
  return cuerpo.map((f) => fila(f[ig] ?? "", f[im] ?? "", f[il] ?? "", f[ie] ?? ""));
}

describe.skipIf(!hayCsv)("planificarImportacion · datos/arbol-lineas.csv (archivo real)", () => {
  it("produce los conteos de referencia del hito y es idempotente", () => {
    const filas = leerFilasCsv();
    const estado = estadoSeed();
    const plan = planificarImportacion(filas, estado);
    const { reporte } = plan;

    // Conteos calculados aquí, independientes del importador, solo sobre las filas
    // con mundo: no existen líneas sin mundo, así que las 14 filas con mundo vacío
    // son errores del archivo y quedan fuera de todo.
    const nodosConGenerica = new Set<string>();
    const nodosDistintos = new Set<string>();
    const lineasDistintas = new Set<string>();
    const lineasSoloSinMundo = new Set<string>();
    const equivalenciasReales = new Set<string>();
    const sinMundoPorGenero: Record<string, number> = {};
    let conMundo = 0;
    for (const f of filas) {
      const linea = normalizarNombre(f.linea);
      const genero = normalizarNombre(f.genero);
      if (!linea || genero === "TOTAL") continue;
      const mundo = normalizarNombre(f.mundo);
      if (!mundo) {
        sinMundoPorGenero[genero] = (sinMundoPorGenero[genero] ?? 0) + 1;
        lineasSoloSinMundo.add(linea);
        continue;
      }
      conMundo += 1;
      const clave = `${aCodigo(genero)}|${mundo}|${linea}`;
      nodosDistintos.add(clave);
      lineasDistintas.add(linea);
      if (esEquivalenciaGenerica(f.equivalencia)) nodosConGenerica.add(clave);
      else equivalenciasReales.add(`${clave}|${normalizarNombre(f.equivalencia)}`);
    }
    for (const l of lineasDistintas) lineasSoloSinMundo.delete(l);
    const filasSinMundo = Object.values(sinMundoPorGenero).reduce((a, b) => a + b, 0);
    const duplicadasEsperadas = conMundo - equivalenciasReales.size - nodosConGenerica.size;

    const porMotivo = reporte.omitidas.reduce<Record<string, number>>((acc, o) => {
      acc[o.motivo] = (acc[o.motivo] ?? 0) + 1;
      return acc;
    }, {});
    const mundoVacioPorGenero = reporte.omitidas
      .filter((o) => o.motivo === "mundo_vacio")
      .reduce<Record<string, number>>((acc, o) => {
        acc[o.genero] = (acc[o.genero] ?? 0) + 1;
        return acc;
      }, {});

    console.info("[CSV real] totales:", reporte.totales);
    console.info("[CSV real] crear:", reporte.crear);
    console.info("[CSV real] existentes:", reporte.existentes, "inactivos:", reporte.existentes_inactivos);
    console.info("[CSV real] omitidas por motivo:", porMotivo);
    console.info("[CSV real] mundo_vacio por género:", mundoVacioPorGenero);
    console.info("[CSV real] líneas que solo aparecían sin mundo:", [...lineasSoloSinMundo]);
    console.info(
      "[CSV real] calculado en el test · filas con mundo:",
      conMundo,
      "líneas:",
      lineasDistintas.size,
      "nodos:",
      nodosDistintos.size,
      "equivalencias reales:",
      equivalenciasReales.size,
      "genéricas:",
      nodosConGenerica.size,
      "duplicadas:",
      duplicadasEsperadas
    );

    expect(porMotivo.genero_desconocido ?? 0).toBe(0);
    expect(porMotivo.genero_inactivo ?? 0).toBe(0);
    expect(porMotivo.mundo_desconocido ?? 0).toBe(0);
    expect(porMotivo.mundo_inactivo ?? 0).toBe(0);
    // El archivo no trae filas de totales: el único "excedente" respecto a la spec es la cabecera.
    expect(porMotivo.fila_total ?? 0).toBe(0);
    expect(porMotivo.linea_vacia ?? 0).toBe(0);
    // Las 14 filas con mundo vacío (BEBE 2, JOVENCITAS 3, NIÑAS 4, NIÑOS 5) se omiten.
    expect(porMotivo.mundo_vacio).toBe(filasSinMundo);
    expect(porMotivo.mundo_vacio).toBe(14);
    expect(mundoVacioPorGenero).toEqual({ BEBE: 2, JOVENCITAS: 3, NIÑAS: 4, NIÑOS: 5 });
    expect(mundoVacioPorGenero).toEqual(sinMundoPorGenero);
    expect(porMotivo.duplicada_en_archivo).toBe(duplicadasEsperadas);
    expect(porMotivo.duplicada_en_archivo).toBe(198);
    expect(reporte.totales).toEqual({ recibidas: 2002, procesadas: 1790, omitidas: 212 });
    // Cada duplicado señala una fila anterior que sí se procesó, con el mismo contenido.
    for (const o of reporte.omitidas) {
      if (o.motivo !== "duplicada_en_archivo") {
        expect(o.fila_original).toBeUndefined();
        continue;
      }
      expect(o.fila_original).toBeGreaterThan(0);
      expect(o.fila_original).toBeLessThan(o.fila);
      const original = filas[(o.fila_original ?? 0) - 1];
      expect(normalizarNombre(original.genero)).toBe(o.genero);
      expect(normalizarNombre(original.mundo)).toBe(o.mundo);
      expect(normalizarNombre(original.linea)).toBe(o.linea);
      expect(reporte.omitidas.some((x) => x.fila === o.fila_original)).toBe(false);
    }
    // Lo que se crea es exactamente lo distinto entre las filas con mundo. El archivo
    // tiene 86 líneas distintas en total; las que solo aparecían en filas sin mundo
    // ya no se crean (ver `lineasSoloSinMundo` en la salida).
    expect(reporte.crear.lineas).toBe(lineasDistintas.size);
    expect(reporte.crear.lineas).toBe(86 - lineasSoloSinMundo.size);
    expect(reporte.crear.nodos).toBe(nodosDistintos.size);
    expect(reporte.crear.nodos).toBe(556);
    expect(reporte.crear.equivalencias).toBe(equivalenciasReales.size);
    expect(reporte.crear.equivalencias).toBe(1414);
    expect(reporte.crear.equivalencias_genericas).toBe(nodosConGenerica.size);
    expect(reporte.crear.equivalencias_genericas).toBe(376);
    expect(reporte.crear.equivalencias + reporte.crear.equivalencias_genericas).toBe(reporte.totales.procesadas);
    expect(reporte.totales.recibidas).toBe(filas.length);
    expect(reporte.totales.recibidas).toBe(reporte.totales.procesadas + reporte.totales.omitidas);
    expect(reporte.existentes).toEqual({ lineas: 0, nodos: 0, equivalencias: 0 });
    expect(reporte.existentes_inactivos).toEqual({ lineas: 0, nodos: 0, equivalencias: 0 });
    expect(reporte.muestra.lineas).toHaveLength(20);
    expect(reporte.muestra.nodos).toHaveLength(20);

    // Ningún choque de códigos dentro de un nodo ni entre líneas (los únicos de la base).
    const codigosLinea = new Set(plan.lineas.map((l) => l.codigo));
    expect(codigosLinea.size).toBe(plan.lineas.length);
    const codigosNodo = new Set(plan.equivalencias.map((e) => `${e.genero_id}|${e.mundo_id}|${e.linea_nombre}|${e.codigo}`));
    expect(codigosNodo.size).toBe(plan.equivalencias.length);

    // Idempotencia con el archivo completo.
    const despues = aplicarPlan(estado, plan);
    expect(despues.lineas).toHaveLength(reporte.crear.lineas);
    expect(despues.nodos).toHaveLength(reporte.crear.nodos);
    expect(despues.equivalencias).toHaveLength(reporte.crear.equivalencias + reporte.crear.equivalencias_genericas);

    const plan2 = planificarImportacion(filas, despues);
    expect(plan2.reporte.crear).toEqual({ lineas: 0, nodos: 0, equivalencias: 0, equivalencias_genericas: 0 });
    expect(plan2.reporte.existentes).toEqual({
      lineas: reporte.crear.lineas,
      nodos: reporte.crear.nodos,
      equivalencias: reporte.crear.equivalencias + reporte.crear.equivalencias_genericas,
    });
    expect(plan2.reporte.totales).toEqual(reporte.totales);
    expect(aplicarPlan(despues, plan)).toEqual(despues);

    // PANTALON está en 25 nodos (hito de prueba): el archivo trae 26 tripletas con
    // PANTALON, pero una tiene el mundo vacío y se omite.
    const pantalon = despues.lineas.find((l) => l.nombre === "PANTALON");
    const nodosPantalon = despues.nodos.filter((n) => n.linea_id === pantalon?.id).length;
    console.info("[CSV real] nodos de PANTALON:", nodosPantalon);
    expect(nodosPantalon).toBe(25);
    expect(reporte.omitidas.some((o) => o.motivo === "mundo_vacio" && o.linea === "PANTALON")).toBe(true);
  });
});
