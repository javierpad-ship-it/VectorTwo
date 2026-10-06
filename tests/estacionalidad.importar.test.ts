import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REASIGNACIONES_MAX,
  aplicarPlanEstacionalidad,
  buscarAgrupacion,
  planificarImportacionEstacionalidad,
  type EstadoImportacionEstacionalidad,
} from "@/lib/estacionalidad/importar";
import { aplicarPlan, planificarImportacion, type EstadoImportacion } from "@/lib/arbol/importar";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type {
  FilaImportacionEstacionalidad,
  FilaOmitidaEstacionalidad,
  MotivoOmisionEstacionalidad,
} from "@/lib/estacionalidad/tipos";
import { agrupacionFx, estadoFx } from "./estacionalidad.fixture";

const fila = (
  genero: string,
  mundo: string,
  linea: string,
  equivalencia: string,
  agrupacion: string
): FilaImportacionEstacionalidad => ({ genero, mundo, linea, equivalencia, agrupacion });

/** Fila de HOMBRE / URBANO / PANTALON (nodo n1), la más usada. */
const hup = (equivalencia: string, agrupacion: string) => fila("HOMBRE", "URBANO", "PANTALON", equivalencia, agrupacion);

const planificar = (filas: FilaImportacionEstacionalidad[], estado: EstadoImportacionEstacionalidad = estadoFx()) =>
  planificarImportacionEstacionalidad(filas, estado);

const motivos = (omitidas: FilaOmitidaEstacionalidad[]) => omitidas.map((o) => o.motivo);

describe("regla 11: resolución de nodo y equivalencia igual que el árbol", () => {
  it("'', 'SIN EQUIVALENCIA' y 'sin equivalencia' caen en la genérica del nodo", () => {
    const plan = planificar([hup("", "CURVA A"), hup("SIN EQUIVALENCIA", "CURVA A"), hup(" sin   equivalencia ", "CURVA A")]);
    expect(plan.asignaciones.map((a) => a.equivalencia_id)).toEqual(["e1"]);
    expect(motivos(plan.reporte.omitidas)).toEqual(["duplicada_en_archivo", "duplicada_en_archivo"]);
    expect(plan.reporte.omitidas.map((o) => o.fila_original)).toEqual([1, 1]);
  });
  it("'-' y el nombre literal de la línea son la misma equivalencia real", () => {
    const plan = planificar([
      fila("MUJER", "URBANO", "PANTALON", "-", "CURVA A"),
      fila("mujer", "urbano", "pantalon", "Pantalon", "CURVA A"),
    ]);
    expect(plan.asignaciones.map((a) => a.equivalencia_id)).toEqual(["e5"]);
    expect(plan.reporte.omitidas).toEqual([
      {
        fila: 2,
        motivo: "duplicada_en_archivo",
        fila_original: 1,
        genero: "MUJER",
        mundo: "URBANO",
        linea: "PANTALON",
        equivalencia: "PANTALON",
        agrupacion: "CURVA A",
      },
    ]);
  });
  it("cada omitida lleva la fila completa normalizada y, cuando aplica, detalle", () => {
    const plan = planificar([fila(" hombre ", "urbano", "pantalon", "joger", " curva  a ")]);
    expect(plan.reporte.omitidas).toEqual([
      {
        fila: 1,
        motivo: "equivalencia_desconocida",
        detalle: "JOGER",
        genero: "HOMBRE",
        mundo: "URBANO",
        linea: "PANTALON",
        equivalencia: "JOGER",
        agrupacion: "CURVA A",
      },
    ]);
  });
  it("los 18 motivos, cada uno con su detalle", () => {
    const filas: Array<[FilaImportacionEstacionalidad, MotivoOmisionEstacionalidad, string | undefined]> = [
      [fila("HOMBRE", "URBANO", "", "X", "A"), "linea_vacia", undefined],
      [fila("TOTAL", "", "PANTALON", "", "A"), "fila_total", undefined],
      [hup("JOGGER", "  "), "agrupacion_vacia", undefined],
      [fila("MARTE", "URBANO", "PANTALON", "", "A"), "genero_desconocido", "MARTE"],
      [fila("OTROS", "URBANO", "PANTALON", "VARIOS", "A"), "genero_inactivo", "OTROS"],
      [fila("HOMBRE", "", "PANTALON", "", "A"), "mundo_vacio", undefined],
      [fila("HOMBRE", "ESPACIAL", "PANTALON", "", "A"), "mundo_desconocido", "ESPACIAL"],
      [fila("HOMBRE", "FORMAL", "PANTALON", "VARIOS", "A"), "mundo_inactivo", "FORMAL"],
      [fila("HOMBRE", "URBANO", "FALDA", "", "A"), "linea_desconocida", "FALDA"],
      [fila("HOMBRE", "URBANO", "BLUSA", "", "A"), "nodo_desconocido", "HOMBRE / URBANO / BLUSA"],
      [fila("HOMBRE", "CASUAL", "BLUSA", "VARIOS", "A"), "nodo_inactivo", "HOMBRE / CASUAL / BLUSA"],
      [fila("MUJER", "URBANO", "ABRIGO", "VARIOS", "A"), "nodo_inactivo", "MUJER / URBANO / ABRIGO"],
      [hup("JOGER", "A"), "equivalencia_desconocida", "JOGER"],
      [hup("CHINO", "A"), "equivalencia_inactiva", "CHINO"],
      [hup("JOGGER", "vieja"), "agrupacion_inactiva", "VIEJA"],
      [fila("MUJER", "URBANO", "PANTALON", "", "solo hombre"), "genero_no_incluido", "MUJER"],
      [hup("JOGGER", "sin genero"), "agrupacion_sin_genero", "SIN GENERO"],
      [hup("CARGO", "A"), "duplicada_en_archivo", undefined], // ver abajo: se duplica contra la fila 18
    ];
    const entrada = [...filas.map(([f]) => f), hup("CARGO", "A"), hup("CARGO", "B")];
    const estado = estadoFx();
    estado.agrupaciones.push(agrupacionFx("a-h", "SOLO HOMBRE", ["g-h"]), agrupacionFx("a-sin", "SIN GENERO", []));
    const plan = planificar(entrada, estado);
    const porFila = new Map(plan.reporte.omitidas.map((o) => [o.fila, o]));
    filas.forEach(([, motivo, detalle], i) => {
      if (motivo === "duplicada_en_archivo") return;
      expect(porFila.get(i + 1), `fila ${i + 1}`).toMatchObject({ motivo, ...(detalle ? { detalle } : {}) });
      expect(porFila.get(i + 1)?.detalle).toBe(detalle);
    });
    // Fila 18 CARGO→A procesada; 19 repite A → duplicada; 20 trae B → contradictoria con detalle A.
    expect(porFila.get(18)).toBeUndefined();
    expect(porFila.get(19)).toMatchObject({ motivo: "duplicada_en_archivo", fila_original: 18 });
    expect(porFila.get(20)).toMatchObject({ motivo: "contradictoria_en_archivo", fila_original: 18, detalle: "A" });
    const todosLosMotivos = new Set(motivos(plan.reporte.omitidas));
    expect(todosLosMotivos.size).toBe(18);
    expect(plan.reporte.totales).toEqual({ recibidas: 20, procesadas: 1, omitidas: 19 });
  });
});

describe("regla 12: idempotencia", () => {
  const filas = [
    hup("", "CURVA NUEVA"), // e1 nueva
    hup("JOGGER", "PANTALONES VERANO"), // e2 reasignada (de INVIERNO)
    hup("CARGO", "pantalones_invierno"), // e3 reasignada (de VIEJA), agrupación resuelta por código
    fila("MUJER", "URBANO", "PANTALON", "", "PANTALONES VERANO"), // e6 sin cambio
    fila("MUJER", "URBANO", "BLUSA", "MANGA LARGA", "CURVA NUEVA"), // e7 nueva
  ];
  it("la segunda pasada no crea ni asigna nada y todo queda en sin_cambio", () => {
    const estado = estadoFx();
    const plan1 = planificar(filas, estado);
    expect(plan1.reporte.crear).toEqual({ agrupaciones: 1 });
    expect(plan1.reporte.asignar).toEqual({ nuevas: 2, reasignadas: 2, sin_cambio: 1 });

    const estado2 = aplicarPlanEstacionalidad(estado, plan1);
    const plan2 = planificar(filas, estado2);
    expect(plan2.reporte.crear).toEqual({ agrupaciones: 0 });
    expect(plan2.reporte.asignar).toEqual({ nuevas: 0, reasignadas: 0, sin_cambio: plan1.reporte.totales.procesadas });
    expect(plan2.reporte.reasignaciones).toEqual([]);
    expect(plan2.reporte.muestra.agrupaciones).toEqual([]);
    expect(plan2.asignaciones).toEqual([]);
    expect(plan2.agrupaciones_nuevas).toEqual([]);
  });
  it("aplicar dos veces el mismo plan produce el mismo estado y no muta el original", () => {
    const estado = estadoFx();
    const copia = JSON.parse(JSON.stringify(estado));
    const plan = planificar(filas, estado);
    const una = aplicarPlanEstacionalidad(estado, plan);
    const dos = aplicarPlanEstacionalidad(una, plan);
    expect(dos).toEqual(una);
    expect(estado).toEqual(copia);
    expect(una.agrupaciones).toHaveLength(4);
    expect(una.equivalencias.find((e) => e.id === "e1")?.agrupacion_estacionalidad_id).toBe("plan-agrupacion-1");
    expect(una.equivalencias.find((e) => e.id === "e2")?.agrupacion_estacionalidad_id).toBe("a-ver");
    expect(una.equivalencias.find((e) => e.id === "e3")?.agrupacion_estacionalidad_id).toBe("a-inv");
  });
});

describe("regla 13: el importador solo crea agrupaciones y asigna", () => {
  it("el plan tiene solo agrupaciones_nuevas y asignaciones, ninguna con destino nulo", () => {
    const plan = planificar([hup("", "CURVA NUEVA"), hup("JOGGER", "PANTALONES VERANO"), hup("JOGER", "X")]);
    expect(Object.keys(plan).sort()).toEqual(["agrupaciones_nuevas", "asignaciones", "reporte"]);
    expect(plan.asignaciones.length).toBeGreaterThan(0);
    for (const a of plan.asignaciones) {
      expect(a.agrupacion_nombre).not.toBe("");
      expect(a.agrupacion_nombre).not.toBeNull();
    }
  });
  it("aplicar no toca líneas, nodos, equivalencias ni activo de nada, y nunca pone null", () => {
    const estado = estadoFx();
    const plan = planificar([hup("", "CURVA NUEVA"), hup("JOGGER", "PANTALONES VERANO")], estado);
    const despues = aplicarPlanEstacionalidad(estado, plan);
    expect(despues.lineas).toEqual(estado.lineas);
    expect(despues.nodos).toEqual(estado.nodos);
    expect(despues.generos).toEqual(estado.generos);
    expect(despues.mundos).toEqual(estado.mundos);
    expect(despues.equivalencias.map((e) => [e.id, e.nombre, e.activo])).toEqual(
      estado.equivalencias.map((e) => [e.id, e.nombre, e.activo])
    );
    for (const antes of estado.equivalencias) {
      const ahora = despues.equivalencias.find((e) => e.id === antes.id);
      if (antes.agrupacion_estacionalidad_id !== null) expect(ahora?.agrupacion_estacionalidad_id).not.toBeNull();
    }
    expect(despues.agrupaciones.slice(0, estado.agrupaciones.length)).toEqual(estado.agrupaciones);
  });
});

describe("regla 14: agrupaciones nuevas y existentes", () => {
  it("una agrupación nueva se crea una sola vez aunque aparezca en muchas filas", () => {
    const plan = planificar([
      hup("", "Curva Nueva"),
      hup("JOGGER", " curva  nueva "),
      fila("MUJER", "URBANO", "BLUSA", "MANGA LARGA", "CURVA NUEVA"),
    ]);
    expect(plan.agrupaciones_nuevas).toEqual([{ nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", genero_ids: ["g-h", "g-m"] }]);
    expect(plan.reporte.muestra.agrupaciones).toEqual([
      { nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", equivalencias: 3, generos: ["HOMBRE", "MUJER"] },
    ]);
    expect(plan.reporte.crear.agrupaciones).toBe(1);
  });
  it("dos nombres distintos que derivan al mismo código reciben _2", () => {
    const plan = planificar([hup("", "PANTALON INVIERNO"), hup("JOGGER", "PANTALON-INVIERNO")]);
    expect(plan.agrupaciones_nuevas).toEqual([
      { nombre: "PANTALON INVIERNO", codigo: "PANTALON_INVIERNO", genero_ids: ["g-h"] },
      { nombre: "PANTALON-INVIERNO", codigo: "PANTALON_INVIERNO_2", genero_ids: ["g-h"] },
    ]);
  });
  it("el código nuevo no choca con los existentes", () => {
    const plan = planificar([hup("", "Pantalones-Verano")]); // existe PANTALONES_VERANO con nombre PANTALONES VERANO
    // Por código resuelve a la existente: no se crea nada.
    expect(plan.agrupaciones_nuevas).toEqual([]);
    expect(plan.asignaciones[0]).toMatchObject({ equivalencia_id: "e1", agrupacion_id: "a-ver" });
    const estado = estadoFx();
    estado.agrupaciones.push({
      id: "a-z",
      codigo: "CURVA_X",
      nombre: "OTRO NOMBRE",
      orden: 0,
      activo: true,
      genero_ids: ["g-h"],
    });
    const plan2 = planificar([hup("", "curva x!")], estado);
    expect(plan2.agrupaciones_nuevas).toEqual([]);
    expect(plan2.asignaciones[0]?.agrupacion_id).toBe("a-z");
    const plan3 = planificar([hup("", "CURVA X Y")], estado);
    expect(plan3.agrupaciones_nuevas).toEqual([{ nombre: "CURVA X Y", codigo: "CURVA_X_Y", genero_ids: ["g-h"] }]);
  });
  it("existente se resuelve por nombre normalizado o por código; el nombre literal gana", () => {
    const agrupaciones = [
      { id: "1", codigo: "A_B", nombre: "A B", activo: true, genero_ids: [] },
      { id: "2", codigo: "A_B_2", nombre: "A-B", activo: true, genero_ids: [] },
    ];
    expect(buscarAgrupacion(agrupaciones, " a  b ")?.id).toBe("1");
    expect(buscarAgrupacion(agrupaciones, "A-B")?.id).toBe("2");
    expect(buscarAgrupacion(agrupaciones, "a_b_2")?.id).toBe("2");
    expect(buscarAgrupacion(agrupaciones, "a/b")?.id).toBe("1"); // por código
    expect(buscarAgrupacion(agrupaciones, "")).toBeUndefined();
    expect(buscarAgrupacion(agrupaciones, "zzz")).toBeUndefined();
  });
  it("inactiva → agrupacion_inactiva sin crear una homónima", () => {
    const plan = planificar([hup("", "vieja"), hup("JOGGER", "VIEJA")]);
    expect(motivos(plan.reporte.omitidas)).toEqual(["agrupacion_inactiva", "agrupacion_inactiva"]);
    expect(plan.reporte.omitidas[0].detalle).toBe("VIEJA");
    expect(plan.agrupaciones_nuevas).toEqual([]);
    expect(plan.reporte.totales.procesadas).toBe(0);
  });
});

describe("regla 15: la misma equivalencia dos veces", () => {
  it("misma agrupación → duplicada_en_archivo con fila_original", () => {
    const plan = planificar([hup("JOGGER", "A"), hup("JOGGER", "a")]);
    expect(plan.reporte.omitidas).toEqual([
      expect.objectContaining({ fila: 2, motivo: "duplicada_en_archivo", fila_original: 1 }),
    ]);
    expect(plan.reporte.omitidas[0].detalle).toBeUndefined();
    expect(plan.asignaciones).toHaveLength(1);
  });
  it("distinta agrupación → contradictoria_en_archivo con fila_original y detalle = la primera", () => {
    const plan = planificar([hup("JOGGER", "A"), hup("JOGGER", "B"), hup("JOGGER", "A")]);
    expect(plan.reporte.omitidas).toEqual([
      expect.objectContaining({ fila: 2, motivo: "contradictoria_en_archivo", fila_original: 1, detalle: "A" }),
      expect.objectContaining({ fila: 3, motivo: "duplicada_en_archivo", fila_original: 1 }),
    ]);
    expect(plan.asignaciones).toEqual([
      { equivalencia_id: "e2", agrupacion_nombre: "A", agrupacion_id: undefined, tipo: "reasignada" },
    ]);
    // La agrupación B no se crea: ninguna fila procesada la usa.
    expect(plan.agrupaciones_nuevas.map((a) => a.nombre)).toEqual(["A"]);
    expect(plan.reporte.muestra.agrupaciones).toEqual([{ nombre: "A", codigo: "A", equivalencias: 1, generos: ["HOMBRE"] }]);
  });
  it("la agrupación de la primera aparición se compara por nombre resuelto (código o nombre)", () => {
    const plan = planificar([hup("JOGGER", "pantalones_verano"), hup("JOGGER", "Pantalones Verano")]);
    expect(motivos(plan.reporte.omitidas)).toEqual(["duplicada_en_archivo"]);
  });
});

describe("regla 16: nuevas, reasignadas y sin cambio", () => {
  it("clasifica según la asignación actual y anota las reasignaciones con de/a", () => {
    const plan = planificar([
      hup("", "CURVA NUEVA"), // e1: sin agrupación → nueva
      hup("JOGGER", "PANTALONES VERANO"), // e2: INVIERNO → VERANO
      hup("CARGO", "CURVA NUEVA"), // e3: VIEJA → CURVA NUEVA (la actual está inactiva, igual se reasigna)
      fila("MUJER", "URBANO", "PANTALON", "", "PANTALONES VERANO"), // e6: ya la tiene
      hup("FANTASMA", "CURVA NUEVA"), // e12: apunta a un id fuera de la lista → reasignada con `de` = el id
    ]);
    expect(plan.reporte.asignar).toEqual({ nuevas: 1, reasignadas: 3, sin_cambio: 1 });
    expect(plan.reporte.reasignaciones).toEqual([
      { ruta: "HOMBRE / URBANO / PANTALON", equivalencia: "JOGGER", de: "PANTALONES INVIERNO", a: "PANTALONES VERANO" },
      { ruta: "HOMBRE / URBANO / PANTALON", equivalencia: "CARGO", de: "VIEJA", a: "CURVA NUEVA" },
      { ruta: "HOMBRE / URBANO / PANTALON", equivalencia: "FANTASMA", de: "a-no-existe", a: "CURVA NUEVA" },
    ]);
    expect(plan.asignaciones.map((a) => [a.equivalencia_id, a.tipo])).toEqual([
      ["e1", "nueva"],
      ["e2", "reasignada"],
      ["e3", "reasignada"],
      ["e12", "reasignada"],
    ]);
  });
  it("reasignaciones se corta en 500 pero asignar.reasignadas es el total", () => {
    const estado = estadoFx();
    const filas: FilaImportacionEstacionalidad[] = [];
    for (let i = 0; i < 620; i++) {
      estado.equivalencias.push({
        id: `x${i}`,
        genero_mundo_linea_id: "n1",
        codigo: `X${i}`,
        nombre: `X${i}`,
        es_generica: false,
        activo: true,
        agrupacion_estacionalidad_id: "a-ver",
      });
      filas.push(hup(`X${i}`, "CURVA NUEVA"));
    }
    const plan = planificar(filas, estado);
    expect(plan.reporte.asignar).toEqual({ nuevas: 0, reasignadas: 620, sin_cambio: 0 });
    expect(plan.reporte.reasignaciones).toHaveLength(REASIGNACIONES_MAX);
    expect(REASIGNACIONES_MAX).toBe(500);
    expect(plan.asignaciones).toHaveLength(620);
  });
});

describe("regla 17: inactivos y cierre de conteos", () => {
  it("nodo no vigente o equivalencia inactiva → omitida sin asignar", () => {
    const plan = planificar([
      fila("HOMBRE", "CASUAL", "BLUSA", "VARIOS", "A"),
      fila("MUJER", "URBANO", "ABRIGO", "VARIOS", "A"),
      hup("CHINO", "A"),
    ]);
    expect(motivos(plan.reporte.omitidas)).toEqual(["nodo_inactivo", "nodo_inactivo", "equivalencia_inactiva"]);
    expect(plan.asignaciones).toEqual([]);
    expect(plan.agrupaciones_nuevas).toEqual([]);
  });
  it("recibidas = procesadas + omitidas y procesadas = nuevas + reasignadas + sin_cambio", () => {
    const plan = planificar([
      hup("", "CURVA NUEVA"),
      hup("JOGGER", "PANTALONES VERANO"),
      hup("JOGGER", "PANTALONES VERANO"),
      hup("JOGER", "A"),
      fila("MUJER", "URBANO", "PANTALON", "", "PANTALONES VERANO"),
      fila("MUJER", "", "PANTALON", "", "A"),
    ]);
    const { totales, asignar } = plan.reporte;
    expect(totales).toEqual({ recibidas: 6, procesadas: 3, omitidas: 3 });
    expect(asignar.nuevas + asignar.reasignadas + asignar.sin_cambio).toBe(totales.procesadas);
  });
});

describe("géneros de la agrupación (cambio «agrupaciones por género»)", () => {
  const conExtras = () => {
    const estado = estadoFx();
    estado.agrupaciones.push(agrupacionFx("a-h", "SOLO HOMBRE", ["g-h"]), agrupacionFx("a-sin", "SIN GENERO", []));
    return estado;
  };
  const MUJER_PANT = (equivalencia: string, agrupacion: string) =>
    fila("MUJER", "URBANO", "PANTALON", equivalencia, agrupacion);

  describe("agrupación existente: el importador nunca amplía sus géneros", () => {
    it("género de la fila no incluido → genero_no_incluido con el nombre del género en detalle", () => {
      const plan = planificar([MUJER_PANT("", "solo hombre"), hup("JOGGER", "SOLO HOMBRE")], conExtras());
      expect(plan.reporte.omitidas).toEqual([
        {
          fila: 1,
          motivo: "genero_no_incluido",
          detalle: "MUJER",
          genero: "MUJER",
          mundo: "URBANO",
          linea: "PANTALON",
          equivalencia: "",
          agrupacion: "SOLO HOMBRE",
        },
      ]);
      expect(plan.asignaciones.map((a) => a.equivalencia_id)).toEqual(["e2"]);
      expect(plan.reporte.totales).toEqual({ recibidas: 2, procesadas: 1, omitidas: 1 });
    });
    it("se resuelve igual por código y por nombre", () => {
      const plan = planificar([MUJER_PANT("", "solo_hombre")], conExtras());
      expect(motivos(plan.reporte.omitidas)).toEqual(["genero_no_incluido"]);
    });
    it("existente sin géneros → agrupacion_sin_genero con la agrupación en detalle", () => {
      const plan = planificar([hup("JOGGER", "sin genero"), MUJER_PANT("", "SIN GENERO")], conExtras());
      expect(plan.reporte.omitidas.map((o) => [o.fila, o.motivo, o.detalle])).toEqual([
        [1, "agrupacion_sin_genero", "SIN GENERO"],
        [2, "agrupacion_sin_genero", "SIN GENERO"],
      ]);
      expect(plan.asignaciones).toEqual([]);
      expect(plan.agrupaciones_nuevas).toEqual([]);
    });
    it("una inactiva sigue siendo agrupacion_inactiva antes que sin género o no incluido", () => {
      const estado = conExtras();
      estado.agrupaciones.push(agrupacionFx("a-ix", "INACTIVA SIN GENERO", [], false));
      const plan = planificar([hup("JOGGER", "inactiva sin genero"), MUJER_PANT("", "vieja")], estado);
      expect(motivos(plan.reporte.omitidas)).toEqual(["agrupacion_inactiva", "agrupacion_inactiva"]);
    });
    it("la fila omitida por género no registra la equivalencia: otra fila válida de la misma equivalencia se procesa", () => {
      const plan = planificar([MUJER_PANT("", "solo hombre"), MUJER_PANT("", "pantalones invierno")], conExtras());
      expect(motivos(plan.reporte.omitidas)).toEqual(["genero_no_incluido"]);
      expect(plan.asignaciones).toEqual([
        { equivalencia_id: "e6", agrupacion_nombre: "PANTALONES INVIERNO", agrupacion_id: "a-inv", tipo: "reasignada" },
      ]);
    });
    it("los dos motivos son errores (no el informativo duplicada_en_archivo)", () => {
      const plan = planificar([MUJER_PANT("", "solo hombre"), hup("JOGGER", "sin genero")], conExtras());
      const informativos = new Set<MotivoOmisionEstacionalidad>(["duplicada_en_archivo"]);
      expect(plan.reporte.omitidas.every((o) => !informativos.has(o.motivo))).toBe(true);
    });
  });

  describe("agrupación nueva: se crea con los géneros de las filas procesadas", () => {
    it("conjunto de géneros distintos, ordenados por orden del género; muestra con nombres", () => {
      const plan = planificar([
        MUJER_PANT("", "CURVA NUEVA"),
        hup("JOGGER", "CURVA NUEVA"),
        fila("MUJER", "URBANO", "BLUSA", "MANGA LARGA", "CURVA NUEVA"),
      ]);
      expect(plan.agrupaciones_nuevas).toEqual([{ nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", genero_ids: ["g-h", "g-m"] }]);
      expect(plan.reporte.muestra.agrupaciones).toEqual([
        { nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", equivalencias: 3, generos: ["HOMBRE", "MUJER"] },
      ]);
    });
    it("un solo género → una sola entrada, aunque haya muchas filas", () => {
      const plan = planificar([hup("", "SOLO H"), hup("JOGGER", "SOLO H"), hup("CARGO", "SOLO H")]);
      expect(plan.agrupaciones_nuevas[0].genero_ids).toEqual(["g-h"]);
      expect(plan.reporte.muestra.agrupaciones[0].generos).toEqual(["HOMBRE"]);
    });
    it("cada agrupación nueva lleva solo los géneros de SUS filas", () => {
      const plan = planificar([hup("", "CURVA H"), MUJER_PANT("", "CURVA M")]);
      expect(plan.agrupaciones_nuevas).toEqual([
        { nombre: "CURVA H", codigo: "CURVA_H", genero_ids: ["g-h"] },
        { nombre: "CURVA M", codigo: "CURVA_M", genero_ids: ["g-m"] },
      ]);
    });
    it("toda agrupación nueva tiene al menos un género", () => {
      const plan = planificar([hup("", "A"), MUJER_PANT("", "B"), hup("JOGER", "C"), hup("CARGO", "D")]);
      expect(plan.agrupaciones_nuevas.length).toBeGreaterThan(0);
      for (const a of plan.agrupaciones_nuevas) expect(a.genero_ids.length).toBeGreaterThanOrEqual(1);
      // C solo tenía una fila omitida (equivalencia desconocida): no se crea.
      expect(plan.agrupaciones_nuevas.map((a) => a.nombre)).toEqual(["A", "B", "D"]);
    });
    it("una fila duplicada o contradictoria no aporta género a la agrupación nueva", () => {
      const plan = planificar([
        hup("JOGGER", "CURVA NUEVA"), // procesada: HOMBRE
        hup("JOGGER", "CURVA NUEVA"), // duplicada
        MUJER_PANT("", "OTRA"), // procesada: MUJER → OTRA
        MUJER_PANT("", "CURVA NUEVA"), // contradictoria con OTRA: no aporta MUJER a CURVA NUEVA
      ]);
      expect(motivos(plan.reporte.omitidas)).toEqual(["duplicada_en_archivo", "contradictoria_en_archivo"]);
      expect(plan.agrupaciones_nuevas).toEqual([
        { nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", genero_ids: ["g-h"] },
        { nombre: "OTRA", codigo: "OTRA", genero_ids: ["g-m"] },
      ]);
    });
    it("una fila omitida por otro motivo (nodo, equivalencia, género inactivo) tampoco aporta género", () => {
      const plan = planificar([
        hup("", "CURVA NUEVA"),
        fila("MUJER", "URBANO", "ABRIGO", "VARIOS", "CURVA NUEVA"), // nodo inactivo
        MUJER_PANT("JOGER", "CURVA NUEVA"), // equivalencia desconocida
      ]);
      expect(plan.agrupaciones_nuevas).toEqual([{ nombre: "CURVA NUEVA", codigo: "CURVA_NUEVA", genero_ids: ["g-h"] }]);
    });
  });

  describe("aplicar en memoria e idempotencia con géneros", () => {
    const filas = [
      hup("", "CURVA NUEVA"),
      MUJER_PANT("", "CURVA NUEVA"),
      fila("MUJER", "URBANO", "BLUSA", "MANGA LARGA", "OTRA CURVA"),
    ];
    it("aplicar crea la agrupación con sus géneros y no toca los de las existentes", () => {
      const estado = conExtras();
      const plan = planificar(filas, estado);
      const despues = aplicarPlanEstacionalidad(estado, plan);
      const nueva = despues.agrupaciones.find((a) => a.nombre === "CURVA NUEVA");
      expect(nueva?.genero_ids).toEqual(["g-h", "g-m"]);
      expect(despues.agrupaciones.find((a) => a.nombre === "OTRA CURVA")?.genero_ids).toEqual(["g-m"]);
      expect(despues.agrupaciones.slice(0, estado.agrupaciones.length)).toEqual(estado.agrupaciones);
    });
    it("regla 12: reimportar el mismo archivo da cero cambios y ninguna omisión por género", () => {
      const estado = conExtras();
      const plan1 = planificar(filas, estado);
      expect(plan1.reporte.crear.agrupaciones).toBe(2);
      const plan2 = planificar(filas, aplicarPlanEstacionalidad(estado, plan1));
      expect(plan2.reporte.crear).toEqual({ agrupaciones: 0 });
      expect(plan2.reporte.asignar).toEqual({ nuevas: 0, reasignadas: 0, sin_cambio: plan1.reporte.totales.procesadas });
      expect(plan2.reporte.omitidas).toEqual([]);
      expect(plan2.agrupaciones_nuevas).toEqual([]);
      expect(plan2.asignaciones).toEqual([]);
    });
    it("aplicar dos veces el mismo plan produce el mismo estado (los géneros no se duplican)", () => {
      const estado = conExtras();
      const plan = planificar(filas, estado);
      const una = aplicarPlanEstacionalidad(estado, plan);
      expect(aplicarPlanEstacionalidad(una, plan)).toEqual(una);
    });
  });
});

// ─── Archivo real (solo si existe en datos/, que está fuera del repo) ───

const RUTA_CSV = path.resolve(__dirname, "../datos/arbol-lineas.csv");
const hayCsv = fs.existsSync(RUTA_CSV);

/** Parser CSV mínimo: coma, comillas dobles con escape "" y CRLF/LF. */
function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let actual: string[] = [];
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
      actual.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      actual.push(campo);
      filas.push(actual);
      actual = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || actual.length > 0) {
    actual.push(campo);
    filas.push(actual);
  }
  return filas.filter((f) => !(f.length === 1 && f[0] === ""));
}

const COLUMNAS: Record<"genero" | "mundo" | "linea" | "equivalencia", string[]> = {
  genero: ["GENERO_LK", "GENERO", "GÉNERO"],
  mundo: ["MUNDO", "GRUPO_PRODUCTO"],
  linea: ["LINEA", "LÍNEA"],
  equivalencia: ["EQUIVALENCIA"],
};

function leerArbolCsv() {
  const texto = fs.readFileSync(RUTA_CSV, "utf8").replace(/^﻿/, "");
  const [cabecera, ...cuerpo] = parsearCsv(texto);
  const indice = (campo: keyof typeof COLUMNAS) => {
    const i = cabecera.findIndex((h) => COLUMNAS[campo].includes(normalizarNombre(h)));
    if (i < 0) throw new Error(`No se encontró la columna ${campo}`);
    return i;
  };
  const ig = indice("genero");
  const im = indice("mundo");
  const il = indice("linea");
  const ie = indice("equivalencia");
  return cuerpo.map((f) => ({ genero: f[ig] ?? "", mundo: f[im] ?? "", linea: f[il] ?? "", equivalencia: f[ie] ?? "" }));
}

/** El mismo seed que `tests/arbol.importar.test.ts`: el CSV trae los géneros por código (`H`, `M`, …). */
const SEED_GENEROS: ReadonlyArray<readonly [string, string]> = [
  ["H", "HOMBRE"],
  ["M", "MUJER"],
  ["JOVENCITOS", "JOVENCITOS"],
  ["JOVENCITAS", "JOVENCITAS"],
  ["NINOS", "NIÑOS"],
  ["NINAS", "NIÑAS"],
  ["BEBE", "BEBE"],
  ["OTROS", "OTROS"],
];
const SEED_MUNDOS = ["CASUAL", "URBANO", "DEPORTIVO", "FORMAL", "RI"];

describe.skipIf(!hayCsv)("planificarImportacionEstacionalidad · sobre el árbol real de datos/arbol-lineas.csv", () => {
  it("una agrupación por línea: asigna todas las equivalencias, es idempotente y cierra conteos", () => {
    // 1. Árbol real en memoria con el importador de M1 (seed + CSV).
    const seed: EstadoImportacion = {
      generos: SEED_GENEROS.map(([codigo, nombre]) => ({ id: `g-${codigo}`, codigo, nombre, activo: true })),
      mundos: SEED_MUNDOS.map((n) => ({ id: `m-${n}`, codigo: n, nombre: n, activo: true })),
      lineas: [],
      nodos: [],
      equivalencias: [],
    };
    const filasArbol = leerArbolCsv();
    const arbol = aplicarPlan(seed, planificarImportacion(filasArbol, seed));
    const estado: EstadoImportacionEstacionalidad = {
      ...arbol,
      equivalencias: arbol.equivalencias.map((e) => ({ ...e, agrupacion_estacionalidad_id: null })),
      agrupaciones: [],
    };

    // 2. El mismo archivo con AGRUPACION = la línea (una curva por línea).
    const filas = filasArbol.map((f) => ({ ...f, agrupacion: f.linea }));
    const plan = planificarImportacionEstacionalidad(filas, estado);
    const { reporte } = plan;

    const lineasConMundo = new Set(
      filasArbol
        .filter((f) => normalizarNombre(f.linea) && normalizarNombre(f.genero) !== "TOTAL" && normalizarNombre(f.mundo))
        .map((f) => normalizarNombre(f.linea))
    );
    const porMotivo = reporte.omitidas.reduce<Record<string, number>>((acc, o) => {
      acc[o.motivo] = (acc[o.motivo] ?? 0) + 1;
      return acc;
    }, {});
    console.info("[CSV real · estacionalidad] totales:", reporte.totales, "crear:", reporte.crear, "asignar:", reporte.asignar);
    console.info("[CSV real · estacionalidad] omitidas por motivo:", porMotivo);

    expect(reporte.crear.agrupaciones).toBe(lineasConMundo.size);
    expect(reporte.asignar.nuevas).toBe(estado.equivalencias.length);
    expect(reporte.asignar.reasignadas).toBe(0);
    expect(reporte.asignar.sin_cambio).toBe(0);
    expect(reporte.reasignaciones).toEqual([]);
    expect(reporte.totales.recibidas).toBe(reporte.totales.procesadas + reporte.totales.omitidas);
    // Lo que el árbol omitió (mundo vacío, duplicadas) lo omite igual este importador: nunca crea nada del árbol.
    const permitidos = new Set(["mundo_vacio", "duplicada_en_archivo", "linea_vacia", "fila_total"]);
    expect(Object.keys(porMotivo).every((m) => permitidos.has(m))).toBe(true);

    // 3. Idempotencia sobre el árbol real.
    const despues = aplicarPlanEstacionalidad(estado, plan);
    expect(despues.equivalencias.every((e) => e.agrupacion_estacionalidad_id !== null)).toBe(true);
    // Cada agrupación creada lleva los géneros de sus filas (≥ 1) y toda equivalencia cumple la regla de género.
    expect(plan.agrupaciones_nuevas.every((a) => a.genero_ids.length >= 1)).toBe(true);
    const generoDelNodo = new Map(despues.nodos.map((n) => [n.id, n.genero_id]));
    const agrupacionPorId = new Map(despues.agrupaciones.map((a) => [a.id, a]));
    const incumplen = despues.equivalencias.filter((e) => {
      const g = generoDelNodo.get(e.genero_mundo_linea_id);
      const a = e.agrupacion_estacionalidad_id ? agrupacionPorId.get(e.agrupacion_estacionalidad_id) : undefined;
      return !a || !g || !a.genero_ids.includes(g);
    });
    expect(incumplen).toEqual([]);
    const plan2 = planificarImportacionEstacionalidad(filas, despues);
    expect(plan2.reporte.crear.agrupaciones).toBe(0);
    expect(plan2.reporte.asignar).toEqual({ nuevas: 0, reasignadas: 0, sin_cambio: reporte.totales.procesadas });
  });
});
