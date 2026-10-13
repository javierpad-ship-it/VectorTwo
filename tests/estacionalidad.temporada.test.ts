import { describe, expect, it } from "vitest";
import {
  TEMPORADA_NO_RECONOCIDA,
  aplicarPlanEstacionalidad,
  leerTemporadaImportada,
  planificarImportacionEstacionalidad,
  type EstadoImportacionEstacionalidad,
} from "@/lib/estacionalidad/importar";
import { aplanarEquivalencias } from "@/lib/estacionalidad/aplanar";
import { temporadasDeLineasPorAgrupacion } from "@/lib/estacionalidad/reglas";
import { crearAgrupacionSchema, editarAgrupacionSchema, importarEstacionalidadSchema } from "@/lib/estacionalidad/esquemas";
import type { FilaImportacionEstacionalidad } from "@/lib/estacionalidad/tipos";
import { estadoFx } from "./estacionalidad.fixture";

/**
 * M6 paso 1 sobre M3: temporada de la agrupación (esquemas, sugerida desde las
 * líneas de M1 y sexta columna opcional del importador). Todo sintético.
 */

const UUID = "123e4567-e89b-42d3-a456-426614174000";

const hup = (equivalencia: string, agrupacion: string, temporada?: string | null): FilaImportacionEstacionalidad => ({
  genero: "HOMBRE",
  mundo: "URBANO",
  linea: "PANTALON",
  equivalencia,
  agrupacion,
  ...(temporada === undefined ? {} : { temporada }),
});
const planificar = (filas: FilaImportacionEstacionalidad[], estado: EstadoImportacionEstacionalidad = estadoFx()) =>
  planificarImportacionEstacionalidad(filas, estado);

describe("esquemas de agrupación: temporada", () => {
  it("crear: sin temporada nace todo_el_ano; acepta las tres; rechaza otras", () => {
    expect(crearAgrupacionSchema.parse({ nombre: "A", genero_ids: [UUID] }).temporada).toBe("todo_el_ano");
    for (const t of ["invierno", "verano", "todo_el_ano"]) {
      expect(crearAgrupacionSchema.parse({ nombre: "A", genero_ids: [UUID], temporada: t }).temporada).toBe(t);
    }
    expect(crearAgrupacionSchema.safeParse({ nombre: "A", genero_ids: [UUID], temporada: "otono" }).success).toBe(false);
    expect(crearAgrupacionSchema.safeParse({ nombre: "A", genero_ids: [UUID], temporada: "Invierno" }).success).toBe(false);
  });
  it("editar: temporada sola es un cambio válido; otra cosa se rechaza; ausente sigue ausente", () => {
    expect(editarAgrupacionSchema.parse({ temporada: "invierno" })).toEqual({ temporada: "invierno" });
    expect(editarAgrupacionSchema.safeParse({ temporada: "otono" }).success).toBe(false);
    expect(editarAgrupacionSchema.parse({ nombre: "x" })).not.toHaveProperty("temporada");
  });
  it("el importador acepta filas de cinco columnas y de seis", () => {
    const base = { genero: "H", mundo: "U", linea: "P", equivalencia: "J", agrupacion: "A" };
    const r5 = importarEstacionalidadSchema.parse({ modo: "previsualizar", filas: [base] });
    expect(r5.filas[0]).not.toHaveProperty("temporada");
    const r6 = importarEstacionalidadSchema.parse({ modo: "previsualizar", filas: [{ ...base, temporada: "Invierno" }, { ...base, temporada: null }] });
    expect(r6.filas.map((f) => f.temporada)).toEqual(["Invierno", null]);
    expect(importarEstacionalidadSchema.safeParse({ modo: "previsualizar", filas: [{ ...base, temporada: 3 }] }).success).toBe(false);
  });
});

describe("leerTemporadaImportada", () => {
  it("reconoce etiquetas y códigos sin importar caja, acentos ni separadores", () => {
    expect(leerTemporadaImportada("Invierno")).toBe("invierno");
    expect(leerTemporadaImportada(" invierno ")).toBe("invierno");
    expect(leerTemporadaImportada("VERANO")).toBe("verano");
    expect(leerTemporadaImportada("Todo el año")).toBe("todo_el_ano");
    expect(leerTemporadaImportada("todo el ano")).toBe("todo_el_ano");
    expect(leerTemporadaImportada("todo_el_ano")).toBe("todo_el_ano");
    expect(leerTemporadaImportada("Toda temporada")).toBe("todo_el_ano");
  });
  it("vacío, espacios, null y undefined → null (sin dato)", () => {
    for (const v of ["", "   ", null, undefined]) expect(leerTemporadaImportada(v)).toBeNull();
  });
  it("cualquier otro texto no se reconoce", () => {
    for (const v of ["otoño", "primavera", "invierno verano", "TODO"]) expect(leerTemporadaImportada(v)).toBe(TEMPORADA_NO_RECONOCIDA);
  });
});

describe("importador: sexta columna temporada (M6)", () => {
  it("una agrupación nueva se crea con la temporada del archivo y la muestra la trae", () => {
    const plan = planificar([hup("", "CURVA ABRIGO", "Invierno"), hup("JOGGER", "CURVA ABRIGO", "invierno")]);
    expect(plan.agrupaciones_nuevas).toEqual([
      { nombre: "CURVA ABRIGO", codigo: "CURVA_ABRIGO", genero_ids: ["g-h"], temporada: "invierno" },
    ]);
    expect(plan.reporte.muestra.agrupaciones[0].temporada).toBe("invierno");
    expect(plan.reporte.omitidas).toEqual([]);
  });
  it("sin la columna (archivo de cinco) o vacía: todo_el_ano", () => {
    const plan = planificar([hup("", "SIN COLUMNA"), hup("JOGGER", "VACIA", ""), hup("CARGO", "NULA", null)]);
    expect(plan.agrupaciones_nuevas.map((a) => a.temporada)).toEqual(["todo_el_ano", "todo_el_ano", "todo_el_ano"]);
  });
  it("la primera fila que la fije manda; las vacías no cuentan como contradicción", () => {
    const plan = planificar([hup("", "MIXTA", ""), hup("JOGGER", "MIXTA", "Verano"), hup("CARGO", "MIXTA", "")]);
    expect(plan.agrupaciones_nuevas[0].temporada).toBe("verano");
    expect(plan.reporte.omitidas).toEqual([]);
  });
  it("una temporada no reconocida omite la fila con temporada_invalida y no crea la agrupación", () => {
    const plan = planificar([hup("", "RARA", "otoño")]);
    expect(plan.reporte.omitidas).toEqual([
      expect.objectContaining({ fila: 1, motivo: "temporada_invalida", detalle: "OTOÑO", temporada: "OTOÑO", agrupacion: "RARA" }),
    ]);
    expect(plan.agrupaciones_nuevas).toEqual([]);
    expect(plan.asignaciones).toEqual([]);
    expect(plan.reporte.totales).toEqual({ recibidas: 1, procesadas: 0, omitidas: 1 });
  });
  it("dos filas de la misma agrupación nueva con temporadas distintas: la segunda sale como contradictoria", () => {
    const plan = planificar([hup("", "DOBLE", "Invierno"), hup("JOGGER", "DOBLE", "Verano")]);
    expect(plan.reporte.omitidas).toEqual([
      expect.objectContaining({ fila: 2, motivo: "temporada_contradictoria_en_archivo", detalle: "Invierno" }),
    ]);
    expect(plan.agrupaciones_nuevas[0].temporada).toBe("invierno");
    expect(plan.asignaciones.map((a) => a.equivalencia_id)).toEqual(["e1"]);
  });
  it("una fila duplicada no se reporta como contradictoria de temporada (gana el duplicado)", () => {
    const plan = planificar([hup("JOGGER", "DOBLE", "Invierno"), hup("JOGGER", "DOBLE", "Verano")]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["duplicada_en_archivo"]);
    expect(plan.agrupaciones_nuevas[0].temporada).toBe("invierno");
  });
  it("NUNCA cambia la temporada de una agrupación existente (ni la lee para nada)", () => {
    const estado = estadoFx();
    const antes = JSON.stringify(estado.agrupaciones);
    const plan = planificar([hup("", "PANTALONES VERANO", "Invierno")], estado);
    expect(plan.agrupaciones_nuevas).toEqual([]);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.asignaciones[0]).toMatchObject({ equivalencia_id: "e1", agrupacion_id: "a-ver" });
    const despues = aplicarPlanEstacionalidad(estado, plan);
    expect(JSON.stringify(despues.agrupaciones)).toBe(antes);
  });
  it("un valor inválido se rechaza también en una fila de agrupación existente", () => {
    const plan = planificar([hup("", "PANTALONES VERANO", "primavera")]);
    expect(plan.reporte.omitidas.map((o) => o.motivo)).toEqual(["temporada_invalida"]);
    expect(plan.asignaciones).toEqual([]);
  });
  it("aplicar en memoria deja la nueva con su temporada y reimportar es idempotente", () => {
    const estado = estadoFx();
    const filas = [hup("", "CURVA ABRIGO", "Invierno")];
    const plan1 = planificar(filas, estado);
    const despues = aplicarPlanEstacionalidad(estado, plan1);
    expect(despues.agrupaciones.find((a) => a.nombre === "CURVA ABRIGO")?.temporada).toBe("invierno");
    const plan2 = planificar(filas, despues);
    expect(plan2.agrupaciones_nuevas).toEqual([]);
    expect(plan2.asignaciones).toEqual([]);
    expect(plan2.reporte.asignar).toEqual({ nuevas: 0, reasignadas: 0, sin_cambio: 1 });
  });
  it("las omitidas por otros motivos no llevan la clave temporada si la fila no la traía", () => {
    const plan = planificar([hup("INEXISTENTE", "A")]);
    expect(plan.reporte.omitidas[0].motivo).toBe("equivalencia_desconocida");
    expect(plan.reporte.omitidas[0]).not.toHaveProperty("temporada");
  });
});

describe("temporada sugerida desde las líneas (lista plana)", () => {
  it("temporadasDeLineasPorAgrupacion: una entrada por equivalencia activa, con la temporada de su línea", () => {
    const e = estadoFx();
    const r = temporadasDeLineasPorAgrupacion(e.equivalencias, e.nodos, e.lineas);
    // a-inv: e2 (PANTALON, Todo el año). a-ver: e6 (PANTALON). a-old: e3. e12 apunta a una agrupación que no existe, pero igual cuenta para su id.
    expect(r.get("a-inv")).toEqual(["Todo el año"]);
    expect(r.get("a-ver")).toEqual(["Todo el año"]);
    expect(r.get("a-old")).toEqual(["Todo el año"]);
  });
  it("las equivalencias inactivas y las sin agrupación no cuentan", () => {
    const e = estadoFx();
    const r = temporadasDeLineasPorAgrupacion(
      [
        { agrupacion_estacionalidad_id: "x", genero_mundo_linea_id: "n3", activo: false },
        { agrupacion_estacionalidad_id: null, genero_mundo_linea_id: "n3", activo: true },
        { agrupacion_estacionalidad_id: "x", genero_mundo_linea_id: "n-no-existe", activo: true },
      ],
      e.nodos,
      e.lineas
    );
    expect(r.size).toBe(0);
  });
  it("aplanarEquivalencias devuelve temporada y temporada_sugerida en cada agrupación del catálogo", () => {
    const e = estadoFx();
    // Dos equivalencias de BLUSA (Verano, e7 y e10) y una de PANTALON (Todo el año, e2) en a-inv → sugerida verano.
    e.equivalencias = e.equivalencias.map((q) =>
      q.id === "e7" || q.id === "e10" ? { ...q, agrupacion_estacionalidad_id: "a-inv" } : q
    );
    const r = aplanarEquivalencias(e, [{ ...e.agrupaciones[1], temporada: "invierno" }, e.agrupaciones[0]], { incluirInactivos: true });
    const inv = r.agrupaciones.find((a) => a.id === "a-inv");
    expect(inv).toMatchObject({ temporada: "invierno", temporada_sugerida: "verano" });
    expect(r.agrupaciones.find((a) => a.id === "a-ver")).toMatchObject({ temporada: "todo_el_ano", temporada_sugerida: "todo_el_ano" });
  });
});
