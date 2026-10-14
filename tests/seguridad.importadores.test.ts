import { describe, expect, it } from "vitest";
import { MAX_CELDA, MAX_CELDA_NOTA } from "@/lib/api/celdas";
import { importarSchema } from "@/lib/arbol/esquemas";
import { importarNivelSchema } from "@/lib/arbol/nivel/esquemas";
import { importarMarcasSchema } from "@/lib/marcas/esquemas";
import { importarConjuntosSchema } from "@/lib/marcas/conjuntos/esquemas";
import { importarGmlSchema } from "@/lib/marcas/gml/esquemas";
import { importarTiendasSchema } from "@/lib/tiendas/esquemas";
import {
  MAX_CELDA_GENEROS,
  importarAgrupacionesSchema,
  importarEstacionalidadSchema,
} from "@/lib/estacionalidad/esquemas";
import { planificarImportacionAgrupaciones, separarGeneros } from "@/lib/estacionalidad/importar-agrupaciones";

const largo = (n: number) => "A".repeat(n);

/** Casos sintéticos: una fila válida por esquema y el campo que se infla. */
const CASOS = [
  { nombre: "árbol", esquema: importarSchema, fila: { genero: "G", mundo: "M", linea: "L", equivalencia: "E" } },
  { nombre: "nivel", esquema: importarNivelSchema, fila: { genero: "G", mundo: "M", linea: "L", nivel: "N" } },
  { nombre: "marcas", esquema: importarMarcasSchema, fila: { marca: "M", agrupacion: "A", tratamiento_especial: "", conjunto: "" } },
  { nombre: "conjuntos", esquema: importarConjuntosSchema, fila: { marca: "M", conjunto: "C" } },
  { nombre: "GML", esquema: importarGmlSchema, fila: { marca: "M", genero: "G", mundo: "U", linea: "L", nota: "" } },
  { nombre: "tiendas", esquema: importarTiendasSchema, fila: { codigo: "R1", nombre: "T", tipo: "", zona: "", razon_social: "" } },
  {
    nombre: "asignación de agrupaciones",
    esquema: importarEstacionalidadSchema,
    fila: { genero: "G", mundo: "M", linea: "L", equivalencia: "E", agrupacion: "A", temporada: "" },
  },
  { nombre: "agrupaciones", esquema: importarAgrupacionesSchema, fila: { nombre: "N", generos: "HOMBRE" } },
] as const;

describe("importadores: tope por celda", () => {
  for (const caso of CASOS) {
    it(`${caso.nombre}: la fila normal pasa y cada celda de texto rechaza más de ${MAX_CELDA} caracteres`, () => {
      const valida = caso.esquema.safeParse({ modo: "previsualizar", filas: [caso.fila] });
      expect(valida.success).toBe(true);

      for (const campo of Object.keys(caso.fila)) {
        const tope = campo === "nota" ? MAX_CELDA_NOTA : campo === "generos" ? MAX_CELDA_GENEROS : MAX_CELDA;
        const justo = caso.esquema.safeParse({ modo: "previsualizar", filas: [{ ...caso.fila, [campo]: largo(tope) }] });
        expect(justo.success, `${campo} con ${tope}`).toBe(true);
        const pasado = caso.esquema.safeParse({ modo: "previsualizar", filas: [{ ...caso.fila, [campo]: largo(tope + 1) }] });
        expect(pasado.success, `${campo} con ${tope + 1}`).toBe(false);
        if (!pasado.success) expect(pasado.error.issues[0].path).toEqual(["filas", 0, campo]);
      }
    });
  }

  it("agrupaciones: descripción hasta 1 000, orden y código hasta 300", () => {
    const base = { nombre: "N", generos: "HOMBRE" };
    const prueba = (extra: object) => importarAgrupacionesSchema.safeParse({ modo: "aplicar", filas: [{ ...base, ...extra }] }).success;
    expect(prueba({ descripcion: largo(MAX_CELDA_NOTA) })).toBe(true);
    expect(prueba({ descripcion: largo(MAX_CELDA_NOTA + 1) })).toBe(false);
    expect(prueba({ orden: largo(MAX_CELDA + 1) })).toBe(false);
    expect(prueba({ orden: 30 })).toBe(true);
    expect(prueba({ codigo: largo(MAX_CELDA + 1) })).toBe(false);
  });

  it("el mensaje dice qué celda y cuánto", () => {
    const r = importarConjuntosSchema.safeParse({ modo: "aplicar", filas: [{ marca: largo(MAX_CELDA + 1), conjunto: "C" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("marca no puede superar los 300 caracteres.");
  });

  it("un valor que no es texto sigue dando el mensaje de siempre", () => {
    const r = importarSchema.safeParse({ modo: "aplicar", filas: [{ genero: 5, mundo: "M", linea: "L", equivalencia: "E" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("genero debe ser texto.");
  });
});

describe("separarGeneros: no crece al cubo con el largo de la celda", () => {
  const catalogo = [{ nombre: "HOMBRE/MUJER" }, { nombre: "NIÑOS" }];

  it("una celda de 10 000 piezas termina en milisegundos (con y sin géneros con barra en el catálogo)", () => {
    const celda = Array.from({ length: 10_000 }, (_, i) => `G${i}`).join("/");
    for (const cat of [[], catalogo]) {
      const t0 = performance.now();
      const partes = separarGeneros(celda, cat);
      const ms = performance.now() - t0;
      expect(partes).toHaveLength(10_000);
      expect(ms).toBeLessThan(500);
    }
  });

  it("10 000 piezas repetidas (el peor caso del bucle de partición) también es rápido", () => {
    const celda = Array.from({ length: 10_000 }, () => "HOMBRE").join("/");
    const t0 = performance.now();
    expect(separarGeneros(celda, catalogo)).toEqual(["HOMBRE"]);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("sigue uniendo los nombres con barra del catálogo, también en celdas largas", () => {
    expect(separarGeneros("HOMBRE/MUJER/NIÑOS, M", catalogo)).toEqual(["HOMBRE/MUJER", "NIÑOS", "M"]);
    const relleno = Array.from({ length: 2_000 }, (_, i) => `X${i}`).join("/");
    const partes = separarGeneros(`${relleno}/HOMBRE/MUJER`, catalogo);
    expect(partes.at(-1)).toBe("HOMBRE/MUJER");
    expect(partes).toHaveLength(2_001);
  });

  it("el planificador no se cuelga con una celda de géneros gigante (la omite como género desconocido)", () => {
    const celda = Array.from({ length: 10_000 }, (_, i) => `G${i}`).join("/");
    const estado = {
      generos: [{ id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true }],
      agrupaciones: [],
    };
    const t0 = performance.now();
    const plan = planificarImportacionAgrupaciones([{ nombre: "ALGO", generos: celda }], estado);
    expect(performance.now() - t0).toBeLessThan(1_000);
    expect(plan.crear).toEqual([]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["genero_desconocido"]);
  });
});
