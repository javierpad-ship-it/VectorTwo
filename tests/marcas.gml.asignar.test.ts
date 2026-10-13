import { describe, expect, it } from "vitest";
import { aplicarPlanAsignacion, paresDelCuerpo, planificarAsignacionBloque, type CuerpoAsignacion } from "@/lib/marcas/gml/asignar";
import { estadoFixture } from "./marcas.gml.fixture";

/** Regla 8 y casos 8 y 9 de 02b: asignación en bloque. */

const estado = () => {
  const e = estadoFixture();
  return { marcas: e.marcas, nodos: e.nodos, asignaciones: e.asignaciones };
};
const cartesiano = (accion: "asignar" | "quitar", marca_ids: string[], nodo_ids: string[], nota: string | null = null): CuerpoAsignacion => ({
  forma: "cartesiano",
  accion,
  marca_ids,
  nodo_ids,
  nota,
});

describe("caso 8: bloque cartesiano [ALFA, BETA, GAMMA, OMEGA] × [N1, N2]", () => {
  const cuerpo = cartesiano("asignar", ["m-alfa", "m-beta", "m-gamma", "m-omega"], ["n1", "n2"]);
  const plan = planificarAsignacionBloque(cuerpo, estado());

  it("8 pares: ALFA sin_cambio, BETA y GAMMA asignadas, OMEGA no permitida (marca_inactiva)", () => {
    const r = plan.reporte;
    expect(r.pares).toBe(8);
    expect(r.asignadas).toBe(4);
    expect(r.sin_cambio).toBe(2);
    expect(r.quitadas).toBe(0);
    expect(r.no_permitidas.map((n) => `${n.marca}:${n.nodo_id}:${n.motivo}`)).toEqual([
      "OMEGA:n1:marca_inactiva",
      "OMEGA:n2:marca_inactiva",
    ]);
    expect(r.no_permitidas[0].ruta).toBe("HOMBRE · URBANO · DENIM");
    expect(plan.insertar.map((p) => `${p.marca_id}|${p.genero_mundo_linea_id}`)).toEqual([
      "m-beta|n1",
      "m-beta|n2",
      "m-gamma|n1",
      "m-gamma|n2",
    ]);
  });
  it("cambios_marca = [BETA barrido→por_gml, GAMMA sin_tratamiento→por_gml]", () => {
    expect(plan.reporte.cambios_marca).toEqual([
      { marca_id: "m-beta", marca: "BETA", de: "barrido", a: "por_gml" },
      { marca_id: "m-gamma", marca: "GAMMA", de: "sin_tratamiento", a: "por_gml" },
    ]);
    expect(plan.marcar_ids).toEqual(["m-beta", "m-gamma"]);
  });
  it("invariante: pares = asignadas + sin_cambio + quitadas + no_permitidas (2 + 4 + 0 + 2 = 8)", () => {
    const r = plan.reporte;
    expect(r.asignadas + r.sin_cambio + r.quitadas + r.no_permitidas.length).toBe(r.pares);
  });
  it("repetir tras aplicar da asignadas = 0 y cambios_marca = []", () => {
    const despues = aplicarPlanAsignacion(estado(), plan);
    const otra = planificarAsignacionBloque(cuerpo, despues);
    expect(otra.reporte.asignadas).toBe(0);
    expect(otra.reporte.cambios_marca).toEqual([]);
    expect(otra.reporte.sin_cambio).toBe(6);
    expect(otra.reporte.no_permitidas).toHaveLength(2);
  });
  it("la nota del cuerpo se aplica solo a los pares nuevos y '' o espacios cuentan como null", () => {
    const conNota = planificarAsignacionBloque(cartesiano("asignar", ["m-gamma"], ["n1"], "  Jeans  "), estado());
    expect(conNota.insertar).toEqual([{ marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: "Jeans" }]);
    const vacia = planificarAsignacionBloque(cartesiano("asignar", ["m-gamma"], ["n1"], "   "), estado());
    expect(vacia.insertar[0].nota).toBeNull();
  });
});

describe("caso 9: bloque quitar [ALFA] × [N1, N2, N3]", () => {
  const cuerpo = cartesiano("quitar", ["m-alfa"], ["n1", "n2", "n3"]);
  it("quitadas = 3 y ALFA queda por_gml pendiente sin_gml", () => {
    const plan = planificarAsignacionBloque(cuerpo, estado());
    expect(plan.reporte).toMatchObject({ accion: "quitar", pares: 3, quitadas: 3, asignadas: 0, sin_cambio: 0 });
    expect(plan.borrar_ids.sort()).toEqual(["a1", "a2", "a3"]);
    expect(plan.marcar_ids).toEqual([]); // la modalidad no cambia al quitar
    const despues = aplicarPlanAsignacion(estado(), plan);
    expect(despues.marcas.find((m) => m.id === "m-alfa")?.modalidad_tratamiento).toBe("por_gml");
    expect(despues.asignaciones.filter((a) => a.marca_id === "m-alfa")).toHaveLength(0);
  });
  it("quitar lo que no existe es sin_cambio y es idempotente", () => {
    const despues = aplicarPlanAsignacion(estado(), planificarAsignacionBloque(cuerpo, estado()));
    const otra = planificarAsignacionBloque(cuerpo, despues);
    expect(otra.reporte).toMatchObject({ quitadas: 0, sin_cambio: 3, pares: 3 });
  });
  it("quitar nunca se rechaza por vigencia ni por marca inactiva, pero sí avisa de ids que no existen", () => {
    const e = estado();
    const conOmega = { ...e, asignaciones: [...e.asignaciones, { id: "a9", marca_id: "m-omega", genero_mundo_linea_id: "n1", activo: true }] };
    const plan = planificarAsignacionBloque(cartesiano("quitar", ["m-omega", "no-existe"], ["n1"]), conOmega);
    expect(plan.reporte.quitadas).toBe(1);
    expect(plan.reporte.no_permitidas).toEqual([
      { marca_id: "no-existe", marca: "", nodo_id: "n1", ruta: "HOMBRE · URBANO · DENIM", motivo: "marca_no_encontrada" },
    ]);
  });
});

describe("regla 8: formas del cuerpo, deduplicación y rechazos", () => {
  it("la forma de pares y la cartesiana se reducen a pares únicos", () => {
    const pares = paresDelCuerpo({
      forma: "pares",
      accion: "asignar",
      pares: [
        { marca_id: "m-alfa", nodo_id: "n1" },
        { marca_id: "m-alfa", nodo_id: "n1" },
        { marca_id: "m-beta", nodo_id: "n2" },
      ],
    });
    expect(pares).toEqual([
      { marca_id: "m-alfa", nodo_id: "n1" },
      { marca_id: "m-beta", nodo_id: "n2" },
    ]);
    expect(paresDelCuerpo(cartesiano("asignar", ["a", "a", "b"], ["x", "y", "x"]))).toHaveLength(4);
  });
  it("marca o nodo inexistentes no abortan: vuelven en no_permitidas", () => {
    const plan = planificarAsignacionBloque(
      { forma: "pares", accion: "asignar", pares: [{ marca_id: "m-gamma", nodo_id: "n1" }, { marca_id: "fantasma", nodo_id: "n1" }, { marca_id: "m-gamma", nodo_id: "fantasma" }] },
      estado()
    );
    expect(plan.reporte.asignadas).toBe(1);
    expect(plan.reporte.no_permitidas.map((n) => n.motivo)).toEqual(["marca_no_encontrada", "nodo_no_encontrado"]);
  });
  it("un miembro de un conjunto se rechaza con marca_en_conjunto y el nodo no vigente con nodo_no_vigente", () => {
    const e = estado();
    const nodos = new Map(e.nodos);
    nodos.set("n3", { ...e.nodos.get("n3")!, vigente: false, motivo_no_vigente: "línea TERNO inactiva" });
    const plan = planificarAsignacionBloque(
      { forma: "pares", accion: "asignar", pares: [{ marca_id: "m-alfa-jeans", nodo_id: "n1" }, { marca_id: "m-gamma", nodo_id: "n3" }] },
      { ...e, nodos }
    );
    expect(plan.reporte.no_permitidas.map((n) => n.motivo)).toEqual(["marca_en_conjunto", "nodo_no_vigente"]);
    expect(plan.reporte.no_permitidas[0].detalle).toBe("cuenta como ALFA");
    expect(plan.reporte.asignadas).toBe(0);
  });
  it("no muta el estado recibido", () => {
    const e = estado();
    const copia = JSON.stringify(e.asignaciones) + JSON.stringify(e.marcas);
    aplicarPlanAsignacion(e, planificarAsignacionBloque(cartesiano("asignar", ["m-gamma", "m-beta"], ["n1"]), e));
    expect(JSON.stringify(e.asignaciones) + JSON.stringify(e.marcas)).toBe(copia);
  });
});
