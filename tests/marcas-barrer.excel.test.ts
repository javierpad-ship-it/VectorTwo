import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { construirHojaLibro, nombreHojaValido } from "../src/app/(app)/planificacion/proyeccion/descarga-libro";
import { hojasLista, hojasMarca, nombreArchivoMarca } from "../src/app/(app)/planificacion/marcas-barrer/excel-vista";
import { FILTROS_VACIOS, filtrarLista } from "../src/app/(app)/planificacion/marcas-barrer/vista";
import { analisisBeta, GEN_H, listaEjemplo } from "./marcas-barrer.pantalla.fixture";

/** El Excel es lo que se ve: las filas visibles con los filtros y los números de la pantalla (ficha 12, regla 16). */

const opciones = { agrupaciones: [{ id: "ag-valor", nombre: "VALOR" }], generos: [{ id: GEN_H, nombre: "HOMBRE" }], mundos: [], lineas: [] };

describe("Excel de la lista", () => {
  const lista = listaEjemplo();

  it("RESUMEN tiene una fila por marca visible, con quién aprobó el reparto y su estado", () => {
    const h = hojasLista(lista.datos, lista.marcas, FILTROS_VACIOS, opciones);
    expect(Object.keys(h)).toEqual(["RESUMEN", "FILTROS"]);
    expect(h.RESUMEN).toHaveLength(1 + 3);
    const cab = h.RESUMEN[0] as string[];
    expect(cab).toContain("ERROR DEL REPARTO (PP)");
    const beta = h.RESUMEN[1];
    expect(beta[0]).toBe("BETA");
    expect(beta[cab.indexOf("REPARTO VIGENTE")]).toBe("v2");
    expect(beta[cab.indexOf("APROBADO POR")]).toBe("Planner Uno");
    expect(beta[cab.indexOf("APROBADO EL")]).toBe("2026-09-30");
    expect(beta[cab.indexOf("ESTADO")]).toBe("Al día (difiere 1.2 pp)");
    const gamma = h.RESUMEN[2];
    expect(gamma[cab.indexOf("MODALIDAD")]).toBe("Mixta");
    expect(gamma[cab.indexOf("% AL BARRER")]).toBe(61);
    expect(gamma[cab.indexOf("ESTADO")]).toBe("Obsoleto: config. cambiada");
    const delta = h.RESUMEN[3];
    expect(delta[cab.indexOf("REPARTO VIGENTE")]).toBeNull();
    expect(delta[cab.indexOf("ESTADO")]).toBe("Sin reparto");
  });

  it("con filtros la hoja trae solo lo visible y FILTROS dice cuáles eran", () => {
    const filtros = { ...FILTROS_VACIOS, modalidad: "mixta" as const, genero: GEN_H, solo: ["inestables" as const] };
    const visibles = filtrarLista(lista.marcas, filtros);
    const h = hojasLista(lista.datos, visibles, filtros, opciones);
    expect(h.RESUMEN.slice(1).map((f) => f[0])).toEqual(["GAMMA"]);
    const f = Object.fromEntries(h.FILTROS.slice(1).map((r) => [r[0] as string, r[1]]));
    expect(f["Modalidad"]).toBe("Mixta");
    expect(f["Género"]).toBe("HOMBRE");
    expect(f["Solo"]).toBe("Inestables");
    expect(f["Ventana (meses)"]).toBe(24);
    expect(f["Datos hasta"]).toBe("set-2026");
    expect(f["Marcas en la hoja"]).toBe(1);
  });
});

describe("Excel de una marca", () => {
  const a = analisisBeta();
  const h = hojasMarca(a);

  it("tres hojas: REPARTO, ESTACIONALIDAD y FILTROS (sin PESO_MENSUAL en la primera entrega)", () => {
    expect(Object.keys(h)).toEqual(["REPARTO", "ESTACIONALIDAD", "FILTROS"]);
  });

  it("REPARTO: una fila por GML y temporada, los pequeños con su resto; lo fuera de alcance sale una vez sin p2", () => {
    const cab = h.REPARTO[0] as string[];
    const filas = h.REPARTO.slice(1);
    // 5 GML en alcance × 2 temporadas + SANDALIA (fuera de alcance, sin p2) × 1.
    expect(filas).toHaveLength(5 * 2 + 1);
    const denimVerano = filas.find((f) => f[2] === "HOMBRE · URBANO · DENIM" && f[1] === "Verano");
    expect(denimVerano?.[cab.indexOf("P2 HISTÓRICO (%)")]).toBe(41);
    expect(denimVerano?.[cab.indexOf("P2 CERRADA (%)")]).toBe(43);
    expect(denimVerano?.[cab.indexOf("P2 VIGENTE (%)")]).toBe(41);
    expect(denimVerano?.[cab.indexOf("VERSIÓN VIGENTE")]).toBe(2);
    const peq = filas.find((f) => f[2] === "HOMBRE · CASUAL · CAMPERA" && f[1] === "Invierno");
    expect(peq?.[cab.indexOf("GRUPO RESTO")]).toBe("Resto de HOMBRE · CASUAL");
    const sandalia = filas.find((f) => f[2] === "MUJER · CASUAL · SANDALIA");
    expect(sandalia?.[1]).toBeNull();
    expect(sandalia?.[cab.indexOf("EN EL ALCANCE")]).toBe("NO");
    expect(sandalia?.[cab.indexOf("P2 HISTÓRICO (%)")]).toBeNull();
  });

  it("cada vector (temporada) del Excel suma 100 sobre las filas en alcance", () => {
    const cab = h.REPARTO[0] as string[];
    for (const t of ["Verano", "Invierno"]) {
      const suma = h.REPARTO.slice(1)
        .filter((f) => f[1] === t)
        .reduce((s, f) => s + (f[cab.indexOf("P2 HISTÓRICO (%)")] as number), 0);
      expect(suma).toBeCloseTo(100, 6);
    }
  });

  it("ESTACIONALIDAD: las dos curvas con doce meses y el EAT; FILTROS: parámetros, alcance y el reparto vigente con quién y cuándo", () => {
    expect(h.ESTACIONALIDAD[0]).toHaveLength(13);
    expect(h.ESTACIONALIDAD[1]).toHaveLength(13);
    expect(h.ESTACIONALIDAD[1][0]).toBe("Propia de BETA (%)");
    expect(h.ESTACIONALIDAD.some((f) => f[0] === "EAT (pp)" && f[1] === 4.8)).toBe(true);
    const f = Object.fromEntries(h.FILTROS.slice(1).map((r) => [r[0] as string, r[1]]));
    expect(f["Alcance"]).toBe("todo");
    expect(f["Modo aplicado"]).toBe("por temporada");
    expect(f["Normaliza el Niño"]).toBe("SÍ");
    expect(f["Reparto vigente"]).toBe("v2");
    expect(f["Aprobado por"]).toBe("Planner Uno");
    expect(f["Aprobado el"]).toBe("2026-09-30");
    expect(f["Obsoleto"]).toBe("NO");
  });

  it("una marca sin estacionalidad ni vigente no rompe las hojas", () => {
    const vacia = analisisBeta({ estacionalidad: { propia: null, gml: null, eat_pp: null, veredicto: null, anios_completos: [] }, vigente: null, filas: [], restos: [] });
    const hh = hojasMarca(vacia);
    expect(hh.REPARTO).toHaveLength(1);
    expect(hh.ESTACIONALIDAD[0]).toHaveLength(13);
    expect(hh.FILTROS.find((r) => r[0] === "Reparto vigente")?.[1]).toBe("—");
  });

  it("las hojas se convierten a un libro válido: nombres de hoja aceptados por Excel y archivo con nombre seguro", () => {
    const libro = XLSX.utils.book_new();
    for (const [nombre, filas] of Object.entries(h)) XLSX.utils.book_append_sheet(libro, construirHojaLibro(XLSX, filas), nombreHojaValido(nombre));
    expect(libro.SheetNames).toEqual(["REPARTO", "ESTACIONALIDAD", "FILTROS"]);
    expect(nombreArchivoMarca("BETA UNO / DOS")).toBe("marca-barrer-beta-uno-dos.xlsx");
    expect(nombreArchivoMarca("***")).toBe("marca-barrer-marca.xlsx");
  });
});
