import { describe, expect, it } from "vitest";
import { aprobarCurvaSchema, calcularAgrupacionSchema } from "../src/lib/curvas/esquemas";
import { PARAMETROS_POR_DEFECTO, type ParametrosCurvas, type TrabajoAgrupacionApi } from "../src/lib/curvas/tipos-api";
import {
  CUERPO_APERTURA,
  ORDEN_409_APROBAR,
  alternarAnioExcluido,
  alternarTiendaExcluida,
  cuerpoAprobar,
  cuerpoCalcular,
  enlaceDePrerrequisito,
  errorDeAprobar,
  mensajeNotaRequerida,
  mesesParaHasta,
  motivoNoSePuedeAprobar,
  motivosNotaRequerida,
  parametrosDistintos,
  parametrosPorDefecto,
  soloParametros,
  textoCalculado,
  textoRedPorAnio,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/trabajo-vista";
import { vigente } from "./curvas.pantalla.fixture";

/** Lógica pura de la vista de trabajo de una agrupación (06b), con datos sintéticos. */

const T1 = "0b8b6f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const T2 = "1b8b6f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const HUELLA = "0123456789abcdef0123456789abcdef";

const trabajo = (extra: Partial<TrabajoAgrupacionApi> = {}) =>
  ({
    agrupacion: { id: "a1", nombre: "ABRIGO SINTÉTICO", codigo: "ABRIGO", activo: true, temporada: "invierno", temporada_sugerida: null, generos: [], equivalencias_activas: 3 },
    datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], hasta_periodo: "2026-09", hasta_fue_por_defecto: true, ultimo_mes_cerrado: "2026-09", meses_posteriores: [], cargas_huella: HUELLA },
    parametros: parametrosPorDefecto(),
    prerrequisitos: { bloquea: [], avisa: [] },
    huella_calculo: HUELLA,
    huella_temporada: HUELLA,
    version_modelo: 1,
    calculo: null,
    vigente: null,
    obsoleta: null,
    avisos_vigente: [],
    comparador: null,
    versiones: 0,
    ...extra,
  }) as TrabajoAgrupacionApi;

describe("parámetros de la agrupación", () => {
  it("los valores por defecto no son «distintos» y no comparten las listas del objeto congelado", () => {
    expect(parametrosDistintos(parametrosPorDefecto())).toEqual([]);
    const p = parametrosPorDefecto();
    p.anios_excluidos.push(2023);
    expect(PARAMETROS_POR_DEFECTO.anios_excluidos).toEqual([]);
  });

  it("lista lo que se movió, con el código de las tiendas si se conoce", () => {
    const p: ParametrosCurvas = { ...parametrosPorDefecto(), anios_excluidos: [2024, 2023], tiendas_excluidas: [T1], tratamiento_atipicos: "descartar", umbral_forma: 5 };
    expect(parametrosDistintos(p, new Map([[T1, "T10"]]))).toEqual([
      "años excluidos: 2023, 2024",
      "tiendas excluidas: T10",
      "tratamiento del Niño: descartar",
      "piso de forma: 5",
    ]);
    expect(parametrosDistintos({ ...p, tiendas_excluidas: [T1, T2] })[1]).toBe("2 tiendas excluidas");
    expect(parametrosDistintos({ ...parametrosPorDefecto(), sin_periodos_confirmado: true })).toEqual(["confirmado: esta temporada no tiene años atípicos"]);
  });

  it("el cuerpo de calcular lleva solo las claves del contrato y hasta_periodo solo si se eligió", () => {
    const sucio = { ...parametrosPorDefecto(), hasta_periodo: "2026-01", intruso: 1 } as unknown as ParametrosCurvas;
    expect(Object.keys(soloParametros(sucio)).sort()).toEqual(Object.keys(PARAMETROS_POR_DEFECTO).sort());
    expect(cuerpoCalcular(parametrosPorDefecto(), "")).not.toHaveProperty("hasta_periodo");
    expect(cuerpoCalcular(parametrosPorDefecto(), "2026-07").hasta_periodo).toBe("2026-07");
    // el servidor es estricto: el cuerpo tiene que pasar su esquema
    expect(calcularAgrupacionSchema.safeParse(cuerpoCalcular({ ...parametrosPorDefecto(), anios_excluidos: [2023], tiendas_excluidas: [T1] }, "2026-07")).success).toBe(true);
    expect(calcularAgrupacionSchema.safeParse(CUERPO_APERTURA).success).toBe(true);
    expect(CUERPO_APERTURA).toEqual({ partir_de_vigente: true });
  });

  it("excluir y volver a incluir años y tiendas: ordenados y sin repetidos", () => {
    let p = parametrosPorDefecto();
    p = alternarAnioExcluido(p, 2024, true);
    p = alternarAnioExcluido(p, 2023, true);
    p = alternarAnioExcluido(p, 2023, true);
    expect(p.anios_excluidos).toEqual([2023, 2024]);
    expect(alternarAnioExcluido(p, 2023, false).anios_excluidos).toEqual([2024]);
    p = alternarTiendaExcluida(p, T1, true);
    p = alternarTiendaExcluida(p, T1, true);
    expect(p.tiendas_excluidas).toEqual([T1]);
    expect(alternarTiendaExcluida(p, T1, false).tiendas_excluidas).toEqual([]);
  });
});

describe("nota obligatoria y cuerpo del PUT", () => {
  it("la nota se pide en los tres casos (y solo en ellos)", () => {
    const base = parametrosPorDefecto();
    expect(motivosNotaRequerida(base, "A", "A")).toEqual([]);
    expect(motivosNotaRequerida(base, null, null)).toEqual([]);
    expect(motivosNotaRequerida(base, "B", "A")).toEqual(["elegiste B y el sistema recomienda A"]);
    expect(motivosNotaRequerida({ ...base, anios_excluidos: [2023] }, "A", "A")).toEqual(["excluiste el año 2023"]);
    expect(motivosNotaRequerida({ ...base, anios_excluidos: [2023, 2024] }, "A", "A")).toEqual(["excluiste los años 2023, 2024"]);
    expect(motivosNotaRequerida({ ...base, tiendas_excluidas: [T1] }, "A", "A")).toEqual(["excluiste una tienda"]);
    expect(motivosNotaRequerida({ ...base, tiendas_excluidas: [T1, T2] }, "A", "A")).toEqual(["excluiste 2 tiendas"]);
    expect(motivosNotaRequerida({ ...base, tratamiento_atipicos: "descartar" }, "A", "A")).toEqual(["fijaste el tratamiento del Niño en «descartar»"]);
    const todos = motivosNotaRequerida({ ...base, anios_excluidos: [2023], tratamiento_atipicos: "imputar" }, "B", "A");
    expect(todos).toHaveLength(3);
    expect(mensajeNotaRequerida(todos)).toMatch(/^Escribe la nota \/ motivo antes de aprobar: .*\.$/);
  });

  it("el cuerpo lleva hasta_periodo explícito, la huella del cálculo y la versión vigente que vio, y pasa el esquema del servidor", () => {
    const sinVigente = cuerpoAprobar(trabajo(), "A", "  ")!;
    expect(sinVigente.parametros.hasta_periodo).toBe("2026-09");
    expect(sinVigente.huella_calculo).toBe(HUELLA);
    expect(sinVigente.version_vigente).toBeNull();
    expect(sinVigente).not.toHaveProperty("nota");
    expect(aprobarCurvaSchema.safeParse(sinVigente).success).toBe(true);

    const conVigente = cuerpoAprobar(trabajo({ vigente: vigente({ version: 3 }) }), "B", "  porque sí ")!;
    expect(conVigente.version_vigente).toBe(3);
    expect(conVigente.nota).toBe("porque sí");
    expect(conVigente.modelo).toBe("B");
    expect(aprobarCurvaSchema.safeParse(conVigente).success).toBe(true);
  });

  it("sin mes hasta el que calcular no hay nada que aprobar", () => {
    expect(cuerpoAprobar(trabajo({ datos: { ...trabajo().datos, hasta_periodo: null } }), "A", "")).toBeNull();
  });

  it("cuándo se puede aprobar: no mientras recalcula, bloquea, está inactiva o la candidata no tiene curva; la nota no deshabilita", () => {
    const ok = { datos: trabajo(), recalculando: false, desactualizado: false, tieneCandidata: true };
    expect(motivoNoSePuedeAprobar(ok)).toBeNull();
    expect(motivoNoSePuedeAprobar({ ...ok, datos: null })).toMatch(/Todavía no/);
    expect(motivoNoSePuedeAprobar({ ...ok, recalculando: true })).toMatch(/Recalculando/);
    expect(motivoNoSePuedeAprobar({ ...ok, desactualizado: true })).toMatch(/no es lo que hay/);
    expect(motivoNoSePuedeAprobar({ ...ok, desactualizado: true, fallo: true })).toMatch(/falló/);
    expect(motivoNoSePuedeAprobar({ ...ok, datos: trabajo({ prerrequisitos: { bloquea: [{ codigo: "sin_venta", nivel: "bloquea", detalle: "x", enlace: null }], avisa: [] } }) })).toMatch(/prerrequisitos/);
    expect(motivoNoSePuedeAprobar({ ...ok, datos: trabajo({ agrupacion: { ...trabajo().agrupacion, activo: false } }) })).toMatch(/inactiva/);
    expect(motivoNoSePuedeAprobar({ ...ok, tieneCandidata: false })).toMatch(/no tiene curva/);
  });
});

describe("errores 409 del PUT: mensaje claro y acción sugerida", () => {
  it("el orden de la lista es el del servidor", () => {
    expect([...ORDEN_409_APROBAR]).toEqual([
      "hasta_periodo_sin_cargar",
      "agrupacion_inactiva",
      "prerrequisitos",
      "sin_curva_posible",
      "candidata_no_disponible",
      "datos_cambiados",
      "vigente_cambiada",
      "sin_cambio",
      "nota_requerida",
    ]);
  });

  it("cada código conserva el mensaje del servidor y añade la acción que corresponde", () => {
    const acciones = Object.fromEntries(ORDEN_409_APROBAR.map((c) => [c, errorDeAprobar(c, "Mensaje del servidor.")]));
    for (const e of Object.values(acciones)) expect(e.mensaje).toContain("Mensaje del servidor.");
    expect(acciones.hasta_periodo_sin_cargar.accion).toMatchObject({ tipo: "enlace", href: "/planificacion/venta-stock" });
    expect(acciones.agrupacion_inactiva.accion).toMatchObject({ tipo: "enlace", href: "/maestros/estacionalidad" });
    expect(acciones.prerrequisitos.accion).toMatchObject({ tipo: "recargar" });
    expect(acciones.sin_curva_posible.accion).toMatchObject({ tipo: "enlace" });
    expect(acciones.candidata_no_disponible.accion).toMatchObject({ tipo: "candidata" });
    expect(acciones.datos_cambiados.accion).toMatchObject({ tipo: "recargar" });
    expect(acciones.datos_cambiados.mensaje).toMatch(/una carga/);
    expect(acciones.datos_cambiados.mensaje).not.toMatch(/vuelve a (cargar|calcular)/i);
    expect(acciones.vigente_cambiada.accion).toMatchObject({ tipo: "recargar" });
    expect(acciones.vigente_cambiada.mensaje).toBe("Mensaje del servidor.");
    expect(acciones.sin_cambio.accion).toBeNull();
    expect(acciones.nota_requerida.accion).toMatchObject({ tipo: "nota" });
    expect(acciones.nota_requerida.mensaje).toBe("Mensaje del servidor.");
  });

  it("un código desconocido o sin código muestra el mensaje tal cual, sin acción", () => {
    expect(errorDeAprobar(null, "Error 500")).toEqual({ mensaje: "Error 500", accion: null });
    expect(errorDeAprobar("otro", "Otro")).toEqual({ mensaje: "Otro", accion: null });
  });
});

describe("prerrequisitos y cabecera", () => {
  it("los enlaces: Periodos es una pestaña de esta pantalla; el resto, otra ruta", () => {
    expect(enlaceDePrerrequisito({ enlace: null })).toBeNull();
    expect(enlaceDePrerrequisito({ enlace: { pantalla: "periodos" } })).toEqual({ tipo: "pestana", pestana: "periodos", etiqueta: "Periodos atípicos" });
    expect(enlaceDePrerrequisito({ enlace: { pantalla: "tiendas", id: T1 } })).toMatchObject({ tipo: "ruta", href: "/maestros/tiendas" });
    expect(enlaceDePrerrequisito({ enlace: { pantalla: "venta_stock" } })).toMatchObject({ href: "/planificacion/venta-stock" });
    expect(enlaceDePrerrequisito({ enlace: { pantalla: "agrupaciones" } })).toMatchObject({ href: "/maestros/estacionalidad" });
  });

  it("«Calculado en 1.8 s (datos hasta 2026-09 · la vigente usó datos hasta 2026-08)»", () => {
    expect(textoCalculado(1840, "2026-09", "2026-08")).toBe("Calculado en 1.8 s (datos hasta 2026-09 · la vigente usó datos hasta 2026-08)");
    expect(textoCalculado(450, "2026-09", "2026-09")).toBe("Calculado en 0.5 s (datos hasta 2026-09)");
    expect(textoCalculado(null, "2026-09", null)).toBe("(datos hasta 2026-09)");
  });

  it("red por año y meses para «Calcular hasta»", () => {
    const red = [{ tiendas: [{ entra: true }, { entra: true }, { entra: false }] }, { tiendas: [{ entra: true }] }];
    expect(textoRedPorAnio(red)).toBe("Red: 2 · 1 tiendas");
    expect(textoRedPorAnio([])).toBe("");
    expect(mesesParaHasta("2024-11", "2025-02", ["2024-12"])).toEqual(["2024-11", "2025-01", "2025-02"]);
    expect(mesesParaHasta(null, "2025-02", [])).toEqual([]);
  });
});
