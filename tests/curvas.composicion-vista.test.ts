import { describe, expect, it } from "vitest";
import {
  buscarGml,
  filasCsvComposicion,
  motivoSeAparta,
  nombreGml,
  ordenarGml,
  pesoDeOtros,
  pesoUltimoAnio,
  resumenComposicion,
  textoEatVsResto,
  textoOtrasAgrupaciones,
  textoOtros,
  ultimoAnioAjuste,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/composicion-vista";
import { composicion, gml } from "./curvas.pantalla.fixture";

/** Presentación pura de la composición de la agrupación (06c), con datos sintéticos. */

describe("composición: nombres, resumen y orden", () => {
  const c = composicion();
  it("el nombre del GML es género · mundo · línea", () => {
    expect(nombreGml(gml("g1", "CASACA"))).toBe("HOMBRE · URBANO · CASACA");
  });
  it("el último año de ajuste es el que ordena a los principales", () => {
    expect(ultimoAnioAjuste(c)).toBe(2025);
    expect(ultimoAnioAjuste({ anios: [{ anio: 2026, clase: "en_curso", en_ajuste: false, unidades: 1 }] })).toBeNull();
    expect(pesoUltimoAnio(c.gml[0], 2025)).toBe(0.3);
    expect(pesoUltimoAnio(c.gml[0], null)).toBe(0);
  });
  it("orden por unidades del último año de ajuste, desempate por nombre", () => {
    const orden = ordenarGml(c.gml, 2025).map((g) => g.gml_id);
    expect(orden).toEqual(["g1", "g2", "g3", "g9"]);
  });
  it("resumen: GML, equivalencias activas y cuántos se apartan", () => {
    expect(resumenComposicion(c)).toBe("4 GML · 4 equivalencias activas · 1 se aparta");
    expect(resumenComposicion({ ...c, gml: c.gml.map((g) => ({ ...g, se_aparta: false })) })).toContain("ninguno se aparta");
    expect(resumenComposicion({ ...c, con_calculo: false })).toContain("no se evalúa todavía");
    expect(resumenComposicion({ ...c, equivalencias_activas: 1, gml: [c.gml[0]] })).toBe("1 GML · 1 equivalencia activa · ninguno se aparta");
  });
});

describe("composición: buscador y «otros»", () => {
  const c = composicion();
  it("el buscador mira todos los GML (también los de «otros»), sin tildes ni mayúsculas, y por equivalencia o código", () => {
    expect(buscarGml(c.gml, "gorro").map((g) => g.gml_id)).toEqual(["g9"]);
    expect(buscarGml(c.gml, "  ").length).toBe(4);
    expect(buscarGml(c.gml, "equivalencia casaca").map((g) => g.gml_id)).toEqual(["g1"]);
    expect(buscarGml(c.gml, "CAS001").map((g) => g.gml_id)).toEqual(["g1"]);
    expect(buscarGml(c.gml, "inexistente")).toEqual([]);
  });
  it("«Otros N GML (x %)»: el peso y la lista con su peso", () => {
    expect(pesoDeOtros(c, 2025)).toBeCloseTo(0.005, 9);
    expect(textoOtros(c, 2025)).toBe("HOMBRE · URBANO · GORRO 0.5 %");
  });
});

describe("composición: «se aparta» y «también en otras agrupaciones»", () => {
  const c = composicion();
  const abrigo = c.gml[2];
  it("motivo cuando se aparta: los EAT por año y el umbral", () => {
    expect(motivoSeAparta(abrigo, 120)).toBe("su forma se aparta del resto de la agrupación: 56.0 pp en 2024 y 60.0 pp en 2025; umbral 3.5 pp");
  });
  it("sin cálculo no se evalúa; sin años válidos no se evalúa; si no se aparta, sin motivo", () => {
    expect(motivoSeAparta({ ...abrigo, se_aparta: null, umbral: null }, 120)).toContain("no se evalúa hasta que se pueda calcular");
    expect(motivoSeAparta(c.gml[3], 120)).toBe("no se evalúa: menos de 120 unidades en cada año de ajuste");
    expect(motivoSeAparta(c.gml[0], 120)).toBe("");
  });
  it("EAT frente al resto de los años de ajuste", () => {
    expect(textoEatVsResto(abrigo)).toBe("56.0 · 60.0");
    expect(textoEatVsResto(c.gml[3])).toBe("— · —");
  });
  it("también en otras agrupaciones: en singular y plural, con la suma de lo que pesan fuera", () => {
    expect(textoOtrasAgrupaciones(abrigo, 2025)).toBe("también en otra agrupación (23 % de su venta en 2025)");
    const dos = { otras_agrupaciones: [{ agrupacion_id: "a", nombre: "A", unidades: 1, pct_de_su_venta: 0.2 }, { agrupacion_id: "b", nombre: "B", unidades: 1, pct_de_su_venta: 0.11 }] };
    expect(textoOtrasAgrupaciones(dos, 2025)).toBe("también en otras 2 agrupaciones (31 % de su venta en 2025)");
    expect(textoOtrasAgrupaciones(c.gml[0], 2025)).toBeNull();
  });
});

describe("composición: CSV con TODOS los GML y equivalencias", () => {
  const c = composicion();
  it("una fila por GML y una por equivalencia; columnas por año; los de «otros» también", () => {
    const { campos, datos } = filasCsvComposicion(c);
    expect(campos.slice(0, 7)).toEqual(["GML", "NIVEL", "PRINCIPAL", "EQUIVALENCIA", "CODIGO", "GENERICA", "ACTIVA"]);
    expect(campos).toContain("2025 (peso %)");
    expect(campos).toContain("2024 (EAT vs resto)");
    expect(campos[campos.length - 1]).toBe("SE APARTA");
    expect(datos.every((f) => f.length === campos.length)).toBe(true);
    const nombres = datos.map((f) => f[0]);
    expect(nombres).toContain("HOMBRE · URBANO · GORRO");
    // 4 GML + las equivalencias de los tres que las traen
    expect(datos).toHaveLength(4 + 3);
    const abrigo = datos.find((f) => f[0] === "HOMBRE · FORMAL · ABRIGO" && f[3] === "");
    expect(abrigo?.[campos.length - 1]).toBe("sí");
    expect(datos.find((f) => f[3] === "EQUIVALENCIA CASACA 1")?.[4]).toBe("CAS001");
  });
});
