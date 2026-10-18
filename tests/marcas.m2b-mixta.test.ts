import { describe, expect, it } from "vitest";
import {
  cambioMarcaDe,
  confirmacionCambioModalidad,
  columnaModalidad,
  cuerpoModalidad,
  ETIQUETA_MODALIDAD,
  marcasQueRequierenDestino,
  motivoPendienteMarca,
  resumenTratamiento,
  sinModalidadGuardada,
  textoCambioMarca,
  textoConfirmarModalidad,
  TEXTO_PENDIENTE,
} from "../src/components/marcas/comunes-m2b";
import type { MarcaConGml, ModalidadEfectiva } from "../src/components/marcas/tipos-m2b";

/** M2 con la modalidad `mixta` (ficha 12, 6.1 y paso 2): estados, resúmenes, pregunta «¿Por GML o Mixta?» y textos de confirmación. */

type Entrada = { tratamiento: boolean; columna: "por_gml" | "barrido" | null; efectiva: ModalidadEfectiva | null; vigentes?: number; asignados?: number };

function marca(nombre: string, e: Entrada): MarcaConGml {
  return {
    id: nombre,
    codigo: nombre,
    nombre,
    agrupacion_marca_id: "ag",
    tratamiento_especial: e.tratamiento,
    nota_tratamiento: null,
    activo: true,
    created_at: "",
    updated_at: "",
    agrupacion_marca: { id: "ag", codigo: "AG", nombre: "AG", orden: 1, activo: true },
    vigente: true,
    modalidad_tratamiento: e.columna,
    modalidad_efectiva: e.efectiva,
    gml_asignados: e.asignados ?? e.vigentes ?? 0,
    gml_vigentes: e.vigentes ?? 0,
    conjunto_marca_id: null,
    conjunto: null,
    unidad_marca_id: nombre,
    miembros: 0,
    avisos_conjunto: [],
  };
}

const ALFA = marca("ALFA", { tratamiento: true, columna: "por_gml", efectiva: "por_gml", vigentes: 2 });
const ALFA_SIN_GML = marca("ALFA2", { tratamiento: true, columna: "por_gml", efectiva: "por_gml", vigentes: 0 });
const BETA = marca("BETA", { tratamiento: true, columna: "barrido", efectiva: "barrido", asignados: 3 });
const GAMMA = marca("GAMMA", { tratamiento: true, columna: "por_gml", efectiva: "mixta", vigentes: 2 });
const GAMMA_SIN_GML = marca("GAMMA2", { tratamiento: true, columna: "por_gml", efectiva: "mixta", vigentes: 0 });
const HEREDADA = marca("HEREDADA", { tratamiento: true, columna: null, efectiva: "barrido" });
const SIN = marca("DELTA", { tratamiento: false, columna: null, efectiva: null });

describe("estado de una marca con la modalidad mixta", () => {
  it("la etiqueta de la modalidad tiene los tres valores", () => {
    expect(ETIQUETA_MODALIDAD).toEqual({ por_gml: "Por GML", barrido: "Al barrer", mixta: "Mixta" });
  });

  it("pendiente: por GML sin GML → sin_gml; mixta sin GML → mixta_sin_gml; al barrer nunca; sin modalidad guardada → sin_modalidad", () => {
    expect(motivoPendienteMarca(ALFA)).toBeNull();
    expect(motivoPendienteMarca(ALFA_SIN_GML)).toBe("sin_gml");
    expect(motivoPendienteMarca(GAMMA)).toBeNull();
    expect(motivoPendienteMarca(GAMMA_SIN_GML)).toBe("mixta_sin_gml");
    expect(motivoPendienteMarca(BETA)).toBeNull();
    expect(motivoPendienteMarca(HEREDADA)).toBe("sin_modalidad");
    expect(motivoPendienteMarca(SIN)).toBeNull();
    expect(TEXTO_PENDIENTE.mixta_sin_gml).toBe("Pendiente: mixta sin GML");
  });

  it("sin modalidad guardada solo si tiene la casilla y la columna vacía", () => {
    expect(sinModalidadGuardada(HEREDADA)).toBe(true);
    expect(sinModalidadGuardada(BETA)).toBe(false);
    expect(sinModalidadGuardada(SIN)).toBe(false);
  });

  it("el resumen cuenta las mixtas aparte: marcadas = por GML + al barrer + mixtas + sin modalidad", () => {
    const r = resumenTratamiento([ALFA, ALFA_SIN_GML, BETA, GAMMA, GAMMA_SIN_GML, HEREDADA, SIN]);
    expect(r).toEqual({ marcadas: 6, porGml: 2, barrido: 1, mixta: 2, sinModalidad: 1, pendientes: 2 });
    expect(r.marcadas).toBe(r.porGml + r.barrido + r.mixta + r.sinModalidad);
  });

  it("los pendientes del resumen cuentan por GML sin GML y mixta sin GML, como la fila", () => {
    expect(resumenTratamiento([ALFA_SIN_GML]).pendientes).toBe(1);
    expect(resumenTratamiento([GAMMA_SIN_GML]).pendientes).toBe(1);
    expect(resumenTratamiento([ALFA, GAMMA, BETA, HEREDADA]).pendientes).toBe(0);
  });

  it("los miembros de un conjunto efectivo no cuentan (su cabeza manda)", () => {
    const miembro = { ...GAMMA, conjunto: { id: "c", nombre: "CABEZA", activo: true } };
    expect(resumenTratamiento([miembro]).marcadas).toBe(0);
  });
});

describe("«¿Por GML o Mixta?» al asignar el primer GML (I3)", () => {
  it("el cambio de una marca: sin casilla se marca; al barrer y sin modalidad piden destino; por GML y mixta no cambian", () => {
    expect(cambioMarcaDe(SIN)).toBe("sin_tratamiento");
    expect(cambioMarcaDe(BETA)).toBe("barrido");
    expect(cambioMarcaDe(HEREDADA)).toBe("sin_modalidad");
    expect(cambioMarcaDe(ALFA)).toBeNull();
    expect(cambioMarcaDe(GAMMA)).toBeNull();
  });

  it("solo las marcas al barrer (o sin modalidad) requieren pregunta; sin casilla no", () => {
    expect(marcasQueRequierenDestino([SIN, BETA, ALFA, GAMMA, HEREDADA]).map((m) => m.nombre)).toEqual(["BETA", "HEREDADA"]);
    expect(marcasQueRequierenDestino([ALFA, GAMMA, SIN])).toEqual([]);
  });

  it("el texto del cambio nombra el destino elegido", () => {
    expect(textoCambioMarca("BETA", "barrido", "mixta")).toBe("BETA pasará de Al barrer a Mixta");
    expect(textoCambioMarca("BETA", "barrido")).toBe("BETA pasará de Al barrer a Por GML");
    expect(textoCambioMarca("X", "sin_modalidad", "mixta")).toBe("X (sin modalidad) pasará a Mixta");
    expect(textoCambioMarca("X", "sin_tratamiento")).toBe("X se marcará con tratamiento especial (Por GML)");
  });
});

describe("cambiar la modalidad", () => {
  it("el cuerpo del PATCH lleva la modalidad tal cual (la API normaliza mixta al par por_gml + resto_al_barrer)", () => {
    expect(cuerpoModalidad("mixta")).toEqual({ modalidad_tratamiento: "mixta" });
    expect(cuerpoModalidad("barrido")).toEqual({ modalidad_tratamiento: "barrido" });
    expect(columnaModalidad(HEREDADA)).toEqual({ modalidad_tratamiento: null });
  });

  it("barrido → mixta enumera los GML asignados (hoy ignorados) y avisa del reparto y de M7", () => {
    const t = textoConfirmarModalidad({ nombre: "BETA", de: "barrido", a: "mixta", gml: ["HOMBRE · URBANO · DENIM", "HOMBRE · CASUAL · POLO"], tieneReparto: true });
    expect(t).toContain("¿Pasar BETA de Al barrer a Mixta?");
    expect(t).toContain("Sus 2 GML asignados (hoy ignorados) pasarán a ser sus GML específicos");
    expect(t).toContain("· HOMBRE · URBANO · DENIM");
    expect(t).toContain("El reparto vigente quedará obsoleto (configuración cambiada)");
    expect(t).toContain("proyecciones de M7 en trabajo quedarán marcadas como desactualizadas");
  });

  it("barrido → mixta sin GML asignados: queda pendiente y se comporta como al barrer", () => {
    const t = textoConfirmarModalidad({ nombre: "BETA", de: "barrido", a: "mixta", gml: [], tieneReparto: false });
    expect(t).toContain("quedará pendiente (mixta sin GML)");
    expect(t).not.toContain("reparto vigente quedará obsoleto");
  });

  it("por GML → mixta: lo de fuera de sus GML deja de ser «otras» y pasa al barrer", () => {
    expect(textoConfirmarModalidad({ nombre: "ALFA", de: "por_gml", a: "mixta", gml: 2, tieneReparto: null })).toContain("dejará de contar como «otras» y pasará al flujo al barrer");
  });

  it("mixta → barrido: los específicos quedan ignorados, no se borran; con solo un conteo, igual avisa", () => {
    const t = textoConfirmarModalidad({ nombre: "GAMMA", de: "mixta", a: "barrido", gml: 2, tieneReparto: null });
    expect(t).toContain("Sus 2 GML quedarán ignorados (no se borran)");
    expect(t).toContain("Si tiene un reparto aprobado en Marcas al barrer, quedará obsoleto");
  });

  it("→ por GML: dejará de analizarse en Marcas al barrer", () => {
    expect(textoConfirmarModalidad({ nombre: "GAMMA", de: "mixta", a: "por_gml", gml: 2, tieneReparto: true })).toContain("Dejará de analizarse en Marcas al barrer");
  });
});

describe("confirmación al cambiar la modalidad desde la tabla de Marcas", () => {
  const con = { gml_asignados: 3, gml_vigentes: 2 };
  const sin = { gml_asignados: 0, gml_vigentes: 0 };

  it("Por GML → Al barrer con GML asignados confirma y cuenta los asignados", () => {
    expect(confirmacionCambioModalidad(con, "por_gml", "barrido")).toEqual({ pide: true, gml: 3 });
  });

  it("Por GML → Al barrer sin GML también confirma (reparto y proyecciones de M7)", () => {
    expect(confirmacionCambioModalidad(sin, "por_gml", "barrido")).toEqual({ pide: true, gml: 0 });
  });

  it("Mixta → Al barrer confirma con o sin GML; con GML cuenta los vigentes", () => {
    expect(confirmacionCambioModalidad(con, "mixta", "barrido")).toEqual({ pide: true, gml: 2 });
    expect(confirmacionCambioModalidad(sin, "mixta", "barrido")).toEqual({ pide: true, gml: 0 });
  });

  it("Al barrer → Por GML y Al barrer → Mixta confirman; a Mixta cuenta los asignados que dejan de ignorarse", () => {
    expect(confirmacionCambioModalidad(con, "barrido", "por_gml")).toEqual({ pide: true, gml: 0 });
    expect(confirmacionCambioModalidad(con, "barrido", "mixta")).toEqual({ pide: true, gml: 3 });
    expect(confirmacionCambioModalidad(sin, "barrido", "mixta")).toEqual({ pide: true, gml: 0 });
  });

  it("Por GML ↔ Mixta confirma", () => {
    expect(confirmacionCambioModalidad(con, "por_gml", "mixta")).toEqual({ pide: true, gml: 0 });
    expect(confirmacionCambioModalidad(con, "mixta", "por_gml")).toEqual({ pide: true, gml: 0 });
  });

  it("sin cambio de modalidad no pide confirmación", () => {
    for (const m of ["por_gml", "barrido", "mixta"] as const) expect(confirmacionCambioModalidad(con, m, m)).toEqual({ pide: false, gml: 0 });
  });

  it("el texto de Por GML → Al barrer enumera los GML ignorados y el aviso de M7", () => {
    const t = textoConfirmarModalidad({ nombre: "ALFA", de: "por_gml", a: "barrido", gml: ["A · B · C", "D · E · F"], tieneReparto: null });
    expect(t).toContain("Sus 2 GML quedarán ignorados");
    expect(t).toContain("· A · B · C");
    expect(t).toContain("proyecciones de M7");
  });
});
