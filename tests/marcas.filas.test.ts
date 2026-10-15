import { describe, expect, it } from "vitest";
import { armarFilasMarcas, sinConfiguracionDePlanificacion, type MarcaLeida } from "@/lib/marcas/filas";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { AGRUPACIONES, marcasFixture } from "./marcas.gml.fixture";

/** M2b: filas de /api/marcas y lo que ve quien no edita maestros (comprador). */

const leidas = (): MarcaLeida[] =>
  marcasFixture().map((m) => {
    const a = AGRUPACIONES.find((g) => g.id === m.agrupacion_marca_id)!;
    return {
      id: m.id,
      codigo: m.codigo ?? "",
      nombre: m.nombre,
      agrupacion_marca_id: m.agrupacion_marca_id,
      tratamiento_especial: m.tratamiento_especial,
      nota_tratamiento: m.nota_tratamiento ?? null,
      modalidad_tratamiento: m.modalidad_tratamiento,
      resto_al_barrer: false,
      conjunto_marca_id: m.conjunto_marca_id,
      activo: m.activo,
      created_at: "",
      updated_at: "",
      agrupacion_marca: { id: a.id, codigo: a.nombre, nombre: a.nombre, orden: a.orden ?? 0, activo: a.activo },
    };
  });

describe("armarFilasMarcas", () => {
  const todas = leidas();
  const conteos = new Map([["m-alfa", { asignados: 3, vigentes: 3 }], ["m-alfa-kids", { asignados: 1, vigentes: 0 }]]);
  const filas = armarFilasMarcas(todas, todas, conteos);
  const fila = (id: string) => filas.find((f) => f.id === id)!;

  it("trae modalidad, conteos, conjunto, unidad, miembros y avisos", () => {
    expect(fila("m-alfa")).toMatchObject({
      modalidad_efectiva: "por_gml",
      gml_asignados: 3,
      gml_vigentes: 3,
      conjunto: null,
      unidad_marca_id: "m-alfa",
      miembros: 2,
      avisos_conjunto: ["agrupacion_distinta"],
    });
    expect(fila("m-alfa-jeans")).toMatchObject({
      conjunto_marca_id: "m-alfa",
      conjunto: { id: "m-alfa", nombre: "ALFA", activo: true },
      unidad_marca_id: "m-alfa",
      avisos_conjunto: ["agrupacion_distinta"],
    });
    expect(fila("m-alfa-kids").avisos_conjunto).toEqual(["config_propia_ignorada"]);
    expect(fila("m-epsilon")).toMatchObject({ modalidad_tratamiento: null, modalidad_efectiva: "barrido" });
    expect(fila("m-gamma")).toMatchObject({ modalidad_efectiva: null, avisos_conjunto: [], miembros: 0 });
  });
  it("las filas devueltas pueden ser menos que las marcas: la unidad se calcula sobre todas", () => {
    const una = armarFilasMarcas(todas.filter((m) => m.id === "m-alfa-jeans"), todas, conteos);
    expect(una).toHaveLength(1);
    expect(una[0].unidad_marca_id).toBe("m-alfa");
  });
});

describe("sinConfiguracionDePlanificacion (comprador)", () => {
  const todas = leidas();
  const filas = armarFilasMarcas(todas, todas, new Map([["m-alfa", { asignados: 3, vigentes: 3 }]]));

  it("deja valores neutros (0, null, []) sin romper el contrato", () => {
    for (const f of filas) {
      expect(sinConfiguracionDePlanificacion(f)).toMatchObject({
        modalidad_tratamiento: null,
        modalidad_efectiva: null,
        gml_asignados: 0,
        gml_vigentes: 0,
        conjunto_marca_id: null,
        conjunto: null,
        unidad_marca_id: f.id,
        miembros: 0,
        avisos_conjunto: [],
      });
    }
  });
  it("conserva lo de M2 (nombre, agrupación, tratamiento, nota) y no muta la fila original", () => {
    const alfa = filas.find((f) => f.id === "m-alfa")!;
    const copia = JSON.stringify(alfa);
    const n = sinConfiguracionDePlanificacion(alfa);
    expect(n).toMatchObject({ nombre: "ALFA", tratamiento_especial: true, nota_tratamiento: "Licencia de denim", vigente: true });
    expect(n.agrupacion_marca).toEqual(alfa.agrupacion_marca);
    expect(JSON.stringify(alfa)).toBe(copia);
  });
  it("solo admin y planner ven la configuración", () => {
    expect(puedeEditarMaestros("admin")).toBe(true);
    expect(puedeEditarMaestros("planner")).toBe(true);
    expect(puedeEditarMaestros("comprador")).toBe(false);
  });
});
