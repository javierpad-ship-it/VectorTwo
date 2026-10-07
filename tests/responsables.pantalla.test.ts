import { describe, expect, it } from "vitest";
import { planificarBloque } from "@/lib/responsables/reglas";
import { filtrarCeldas } from "@/lib/responsables/filtros";
import {
  claveCelda,
  compararNombres,
  conteoEje,
  describirPlan,
  describirResultado,
  desgloseFaltantes,
  etiquetaResponsableNoValido,
  indexarCeldas,
  leerResponsableParam,
  motivoBloqueoBloque,
  motivoCargaNoValida,
  nombreVisible,
  ordenarCompradores,
  planBloque,
  textoLineas,
  textoResponsable,
} from "@/lib/responsables/pantalla";
import type { CeldaResponsable, ResponsableCelda, ResumenResponsables } from "@/lib/responsables/tipos-api";

const ANA: ResponsableCelda = { id: "ana", nombre: "ANA RAMOS", email: "ana@x.pe", rol: "comprador", activo: true };
const LUIS: ResponsableCelda = { id: "luis", nombre: null, email: "luis@x.pe", rol: "comprador", activo: false };
const PEDRO: ResponsableCelda = { id: "pedro", nombre: "PEDRO", email: "pedro@x.pe", rol: "planner", activo: true };

function celda(g: string, m: string, p: Partial<CeldaResponsable> = {}): CeldaResponsable {
  const responsable = p.responsable === undefined ? null : p.responsable;
  let motivo = p.motivo_faltante;
  if (motivo === undefined) {
    motivo = null;
    if ((p.vigente ?? true) && !responsable) motivo = "sin_responsable";
    else if (responsable && !responsable.activo) motivo = "responsable_inactivo";
    else if (responsable && responsable.rol !== "comprador") motivo = "responsable_no_comprador";
  }
  return { genero_id: g, mundo_id: m, vigente: true, lineas: 3, responsable, faltante: motivo !== null && (p.vigente ?? true), motivo_faltante: motivo, ...p };
}

// 2 géneros × 3 mundos (m3 inactivo → celdas no vigentes)
const CELDAS: CeldaResponsable[] = [
  celda("h", "m1", { responsable: ANA }),
  celda("h", "m2", { responsable: ANA }),
  celda("h", "m3", { vigente: false, faltante: false, motivo_faltante: null }),
  celda("d", "m1"),
  celda("d", "m2", { responsable: LUIS, lineas: 0 }),
  celda("d", "m3", { vigente: false, faltante: false, motivo_faltante: null, responsable: ANA }),
];

describe("textos de celda", () => {
  it("nombre o correo", () => {
    expect(nombreVisible(ANA)).toBe("ANA RAMOS");
    expect(nombreVisible(LUIS)).toBe("luis@x.pe");
    expect(nombreVisible({ nombre: "  ", email: "a@b.c" })).toBe("a@b.c");
  });
  it("estado de cada celda en texto", () => {
    expect(textoResponsable(CELDAS[0])).toEqual({ texto: "ANA RAMOS", tono: "normal" });
    expect(textoResponsable(CELDAS[3])).toEqual({ texto: "Sin responsable", tono: "alerta" });
    expect(textoResponsable(CELDAS[4])).toEqual({ texto: "luis@x.pe · desactivado", tono: "alerta" });
    expect(textoResponsable(celda("h", "m1", { responsable: PEDRO }))).toEqual({ texto: "PEDRO · ya no es comprador", tono: "alerta" });
    // una celda no vigente sin responsable no dice nada; null tampoco
    expect(textoResponsable(CELDAS[2])).toBeNull();
    expect(textoResponsable(null)).toBeNull();
  });
  it("líneas: singular, plural y sin líneas", () => {
    expect(textoLineas(0)).toBe("sin líneas");
    expect(textoLineas(1)).toBe("1 línea");
    expect(textoLineas(12)).toBe("12 líneas");
  });
  it("opción deshabilitada del selector solo si el responsable ya no es válido", () => {
    expect(etiquetaResponsableNoValido(CELDAS[0])).toBeNull();
    expect(etiquetaResponsableNoValido(CELDAS[3])).toBeNull();
    expect(etiquetaResponsableNoValido(CELDAS[4])).toBe("luis@x.pe (desactivado)");
    expect(etiquetaResponsableNoValido(celda("h", "m1", { responsable: PEDRO }))).toBe("PEDRO (ya no es comprador)");
  });
});

describe("orden de compradores", () => {
  it("alfabético en español, sin distinguir acentos ni mayúsculas", () => {
    const orden = ordenarCompradores([
      { id: "1", nombre: "Zoila", email: "z@x" },
      { id: "2", nombre: "ÁLVARO", email: "a@x" },
      { id: "3", nombre: null, email: "beto@x" },
      { id: "4", nombre: "alicia", email: "al@x" },
    ]).map((c) => c.id);
    expect(orden).toEqual(["4", "2", "3", "1"]);
    expect(compararNombres("Ñandú", "Zorro")).toBeLessThan(0);
    expect(compararNombres("Comprador 2", "Comprador 10")).toBeLessThan(0);
  });
  it("no muta la lista recibida", () => {
    const entrada = [
      { id: "1", nombre: "B", email: "b@x" },
      { id: "2", nombre: "A", email: "a@x" },
    ];
    ordenarCompradores(entrada);
    expect(entrada.map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("encabezados de fila y columna", () => {
  it("cuenta con responsable sobre vigentes", () => {
    expect(conteoEje(CELDAS, { genero_id: "h" })).toEqual({ con: 2, total: 2 });
    expect(conteoEje(CELDAS, { genero_id: "d" })).toEqual({ con: 0, total: 2 });
    expect(conteoEje(CELDAS, { mundo_id: "m1" })).toEqual({ con: 1, total: 2 });
    expect(conteoEje(CELDAS, { mundo_id: "m3" })).toEqual({ con: 0, total: 0 });
  });
});

describe("resumen", () => {
  const base: ResumenResponsables = {
    combinaciones: 40,
    con_responsable: 37,
    faltantes: 3,
    faltantes_sin_responsable: 1,
    faltantes_responsable_inactivo: 1,
    faltantes_responsable_no_comprador: 1,
    faltantes_sin_lineas: 1,
    por_responsable: [],
  };
  it("desglose en el orden de la ficha", () => {
    expect(desgloseFaltantes(base)).toBe("1 sin responsable · 1 responsable desactivado · 1 responsable ya no es comprador");
  });
  it("omite lo que es cero y pluraliza", () => {
    expect(desgloseFaltantes({ ...base, faltantes_sin_responsable: 0, faltantes_responsable_inactivo: 2, faltantes_responsable_no_comprador: 0 })).toBe(
      "2 responsables desactivados"
    );
    expect(desgloseFaltantes({ ...base, faltantes_sin_responsable: 0, faltantes_responsable_inactivo: 0, faltantes_responsable_no_comprador: 0 })).toBe("");
  });
  it("marca de la carga no válida, deducida de sus celdas", () => {
    expect(motivoCargaNoValida({ perfil_id: "ana", nombre: "A", email: "a", combinaciones: 2, valido: true }, CELDAS)).toBeNull();
    expect(motivoCargaNoValida({ perfil_id: "luis", nombre: null, email: "l", combinaciones: 1, valido: false }, CELDAS)).toBe("desactivado");
    expect(
      motivoCargaNoValida({ perfil_id: "pedro", nombre: "P", email: "p", combinaciones: 1, valido: false }, [celda("h", "m1", { responsable: PEDRO })])
    ).toBe("ya no es comprador");
  });
});

describe("plan de la asignación en bloque", () => {
  const fila5: CeldaResponsable[] = [
    celda("h", "m1", { responsable: ANA }),
    celda("h", "m2", { responsable: ANA }),
    celda("h", "m3"),
    celda("h", "m4"),
    celda("h", "m5", { responsable: LUIS }),
  ];
  it("una fila de 5 con 2 válidas: casilla apagada asigna 3 y respeta 2 (LUIS desactivado sí se reemplaza)", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: "beto", reemplazar: false });
    expect(p).toMatchObject({ total: 5, aplicar: 3, respetadas: 2, reemplazos: 0, sinCambio: 0 });
  });
  it("con la casilla encendida asigna las 5 y avisa de 2 reemplazos", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: "beto", reemplazar: true });
    expect(p).toMatchObject({ aplicar: 5, respetadas: 0, reemplazos: 2 });
  });
  it("las que ya son de ese comprador no cambian", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: "ana", reemplazar: false });
    expect(p).toMatchObject({ aplicar: 3, sinCambio: 2, respetadas: 0 });
  });
  it("quitar: solo las que tienen fila, y todas cuentan como reemplazo si eran válidas", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: null, reemplazar: true });
    expect(p).toMatchObject({ total: 5, aplicar: 3, reemplazos: 2, sinCambio: 2 });
  });
  it("las no vigentes nunca entran, ni en la columna ni en la matriz completa", () => {
    expect(planBloque(CELDAS, { mundo_id: "m3" }, { perfilId: "ana", reemplazar: true }).total).toBe(0);
    expect(planBloque(CELDAS, "todas", { perfilId: "ana", reemplazar: true }).total).toBe(4);
  });
  it("coincide con planificarBloque del backend (misma lista de combinaciones y mismas respetadas)", () => {
    for (const ambito of ["todas", { genero_id: "h" }, { genero_id: "d" }, { mundo_id: "m1" }, { mundo_id: "m3" }] as const) {
      for (const reemplazar of [false, true]) {
        const mio = planBloque(CELDAS, ambito, { perfilId: "beto", reemplazar });
        const suyo = planificarBloque(CELDAS, ambito, { soloFaltantes: !reemplazar });
        expect(mio.combinaciones).toEqual(suyo.combinaciones);
        expect(mio.total).toBe(suyo.combinaciones.length);
        expect(mio.respetadas).toBe(suyo.respetadas);
        expect(mio.aplicar).toBe(suyo.a_asignar);
      }
    }
  });
  it("texto del panel", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: "beto", reemplazar: false });
    expect(describirPlan(p, "de HOMBRE", "BETO")).toBe("Se asignarán 3 de 5 combinaciones de HOMBRE (2 ya tienen responsable y no se tocan).");
    const q = planBloque(fila5, { genero_id: "h" }, { perfilId: null, reemplazar: true });
    expect(describirPlan(q, "de HOMBRE", null)).toBe("Se quitará el responsable a 3 de 5 combinaciones de HOMBRE (2 ya no tienen responsable).");
    const r = planBloque(fila5, { genero_id: "h" }, { perfilId: "beto", reemplazar: true });
    expect(describirPlan(r, "de HOMBRE", "BETO")).toContain("se reemplazarán 2 responsables");
  });
  it("motivos por los que el botón se deshabilita", () => {
    const p = planBloque(fila5, { genero_id: "h" }, { perfilId: null, reemplazar: false });
    expect(motivoBloqueoBloque(p, { elegido: false, quitar: false, reemplazar: false })).toMatch(/Elige un comprador/);
    expect(motivoBloqueoBloque(p, { elegido: true, quitar: true, reemplazar: false })).toBe("No se puede quitar el responsable solo a las faltantes.");
    expect(motivoBloqueoBloque(p, { elegido: true, quitar: true, reemplazar: true })).toBeNull();
    const nada = planBloque(CELDAS, { mundo_id: "m3" }, { perfilId: "ana", reemplazar: false });
    expect(motivoBloqueoBloque(nada, { elegido: true, quitar: false, reemplazar: false })).toMatch(/No hay combinaciones vigentes/);
    const igual = planBloque(CELDAS, { genero_id: "h" }, { perfilId: "ana", reemplazar: false });
    expect(motivoBloqueoBloque(igual, { elegido: true, quitar: false, reemplazar: false })).toBe("No hay nada que cambiar.");
  });
  it("aviso del resultado", () => {
    const vacio = { asignadas: 3, quitadas: 0, sin_cambio: 1, con_responsable: 1, no_encontradas: [], no_vigentes: [] };
    expect(describirResultado(vacio, false)).toBe("3 combinaciones asignadas · 1 sin cambio · 1 con responsable (no se tocaron).");
    expect(describirResultado({ ...vacio, asignadas: 1, sin_cambio: 0, con_responsable: 0 }, false)).toBe("1 combinación asignada.");
    expect(describirResultado({ ...vacio, asignadas: 0, quitadas: 2, sin_cambio: 0, con_responsable: 0 }, true)).toBe("2 combinaciones quedaron sin responsable.");
  });
});

describe("filtros sobre una lectura (filtrarCeldas del backend)", () => {
  it("los conteos de chips coinciden con lo que ve la matriz", () => {
    expect(filtrarCeldas(CELDAS, "todas")).toHaveLength(4);
    expect(filtrarCeldas(CELDAS, "faltantes")).toHaveLength(2);
    expect(filtrarCeldas(CELDAS, { responsable: "ana" })).toHaveLength(2);
    expect(filtrarCeldas(CELDAS, "sin_responsable")).toHaveLength(1);
  });
  it("el índice por género y mundo encuentra la celda", () => {
    const idx = indexarCeldas(CELDAS);
    expect(idx.get(claveCelda("d", "m2"))?.responsable?.id).toBe("luis");
    expect(idx.size).toBe(6);
  });
});

describe("?responsable=", () => {
  it("solo acepta un UUID", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(leerResponsableParam(id)).toBe(id);
    expect(leerResponsableParam([id, "otro"])).toBe(id);
    expect(leerResponsableParam("<script>")).toBeUndefined();
    expect(leerResponsableParam(undefined)).toBeUndefined();
  });
});
