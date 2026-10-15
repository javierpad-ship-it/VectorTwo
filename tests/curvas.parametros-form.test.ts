import { describe, expect, it } from "vitest";
import { PARAMETROS_POR_DEFECTO } from "../src/lib/curvas/tipos-api";
import {
  FORMULARIO_POR_DEFECTO,
  consultaRedComparable,
  formularioDesdeParametros,
  formulariosIguales,
  leerNumero,
  validarFormulario,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/parametros-form";

describe("leerNumero", () => {
  it("acepta punto y coma decimal; rechaza vacío y basura", () => {
    expect(leerNumero("0.25")).toBe(0.25);
    expect(leerNumero(" 0,25 ")).toBe(0.25);
    expect(leerNumero("-3")).toBe(-3);
    expect(leerNumero("")).toBeNull();
    expect(leerNumero("abc")).toBeNull();
    expect(leerNumero("1e3")).toBeNull();
    expect(leerNumero("1.2.3")).toBeNull();
  });
});

describe("formulario de parámetros", () => {
  it("los valores por defecto del formulario producen los de la API (fracciones)", () => {
    const { cuerpo, errores } = validarFormulario(FORMULARIO_POR_DEFECTO);
    expect(errores).toEqual({});
    expect(cuerpo).toMatchObject({
      solo_tiendas_completas: true,
      exigir_venta_todo_el_ano: true,
      meses_tienda_nueva: 0,
      umbral_tienda_dominante: 0.35,
      tratamiento_atipicos: "auto",
      umbral_forma: 3,
      max_meses_hueco: 4,
      min_unidades_ano: 120,
      umbral_cambio_volumen: 3,
      margen_ruido: 0.25,
      peso_minimo_diagnostico: 0.05,
      umbral_liquidacion: 0.15,
      marcar_referencia: false,
    });
    expect(cuerpo).not.toHaveProperty("hasta_periodo");
  });

  it("los porcentajes se muestran como porcentaje y vuelven a fracción", () => {
    const f = formularioDesdeParametros({ ...PARAMETROS_POR_DEFECTO, umbral_tienda_dominante: 0.4, peso_minimo_diagnostico: 0.1, umbral_liquidacion: 0.2 });
    expect([f.umbral_tienda_dominante, f.peso_minimo_diagnostico, f.umbral_liquidacion]).toEqual(["40", "10", "20"]);
    expect(validarFormulario(f).cuerpo).toMatchObject({ umbral_tienda_dominante: 0.4, peso_minimo_diagnostico: 0.1, umbral_liquidacion: 0.2 });
  });

  it("sin errores de redondeo en 0,07 × 100", () => {
    const f = formularioDesdeParametros({ ...PARAMETROS_POR_DEFECTO, peso_minimo_diagnostico: 0.07 });
    expect(f.peso_minimo_diagnostico).toBe("7");
    expect(validarFormulario(f).cuerpo?.peso_minimo_diagnostico).toBe(0.07);
  });

  it("rechaza lo que el esquema de la API rechaza", () => {
    const base = FORMULARIO_POR_DEFECTO;
    const caso = (campo: keyof typeof base, valor: string) => validarFormulario({ ...base, [campo]: valor }).errores[campo as keyof ReturnType<typeof validarFormulario>["errores"]];
    expect(caso("meses_tienda_nueva", "37")).toBeDefined();
    expect(caso("meses_tienda_nueva", "1.5")).toBeDefined();
    expect(caso("meses_tienda_nueva", "36")).toBeUndefined();
    expect(caso("umbral_tienda_dominante", "5")).toBeDefined();
    expect(caso("umbral_tienda_dominante", "95")).toBeDefined();
    expect(caso("umbral_forma", "0.1")).toBeDefined();
    expect(caso("umbral_forma", "51")).toBeDefined();
    expect(caso("max_meses_hueco", "0")).toBeDefined();
    expect(caso("max_meses_hueco", "7")).toBeDefined();
    expect(caso("min_unidades_ano", "-1")).toBeDefined();
    expect(caso("min_unidades_ano", "0")).toBeUndefined();
    expect(caso("umbral_cambio_volumen", "1")).toBeDefined();
    expect(caso("umbral_cambio_volumen", "11")).toBeDefined();
    expect(caso("margen_ruido", "1.5")).toBeDefined();
    expect(caso("margen_ruido", "0")).toBeUndefined();
    expect(caso("peso_minimo_diagnostico", "60")).toBeDefined();
    expect(caso("umbral_liquidacion", "4")).toBeDefined();
    expect(caso("umbral_liquidacion", "")).toBeDefined();
  });

  it("con errores no hay cuerpo", () => {
    const r = validarFormulario({ ...FORMULARIO_POR_DEFECTO, margen_ruido: "x" });
    expect(r.cuerpo).toBeNull();
    expect(r.errores.margen_ruido).toContain("número");
  });

  it("el mes final se valida y, si es válido, viaja", () => {
    expect(validarFormulario({ ...FORMULARIO_POR_DEFECTO, hasta_periodo: "2026-13" }).errores.hasta_periodo).toBeDefined();
    expect(validarFormulario({ ...FORMULARIO_POR_DEFECTO, hasta_periodo: "2026-09" }).cuerpo?.hasta_periodo).toBe("2026-09");
  });

  it("marcar como referencia y los interruptores viajan tal cual", () => {
    const c = validarFormulario({ ...FORMULARIO_POR_DEFECTO, marcar_referencia: true, solo_tiendas_completas: false, tratamiento_atipicos: "imputar" }).cuerpo!;
    expect(c.marcar_referencia).toBe(true);
    expect(c.solo_tiendas_completas).toBe(false);
    expect(c.tratamiento_atipicos).toBe("imputar");
  });

  it("recalcular abre con los parámetros de la corrida", () => {
    const f = formularioDesdeParametros({ ...PARAMETROS_POR_DEFECTO, meses_tienda_nueva: 12, tratamiento_atipicos: "descartar" }, "2026-09");
    expect(f.meses_tienda_nueva).toBe("12");
    expect(f.tratamiento_atipicos).toBe("descartar");
    expect(f.hasta_periodo).toBe("2026-09");
    expect(f.marcar_referencia).toBe(false);
    expect(formulariosIguales(f, f)).toBe(true);
    expect(formulariosIguales(f, FORMULARIO_POR_DEFECTO)).toBe(false);
  });
});

describe("consulta de la vista previa de la red", () => {
  it("lleva los parámetros que deciden la red y la diagnóstica", () => {
    const q = new URLSearchParams(consultaRedComparable({ ...FORMULARIO_POR_DEFECTO, meses_tienda_nueva: "12", hasta_periodo: "2026-09" })!);
    expect(q.get("meses_tienda_nueva")).toBe("12");
    expect(q.get("solo_tiendas_completas")).toBe("true");
    expect(q.get("exigir_venta_todo_el_ano")).toBe("true");
    expect(q.get("umbral_tienda_dominante")).toBe("0.35");
    expect(q.get("umbral_forma")).toBe("3");
    expect(q.get("peso_minimo_diagnostico")).toBe("0.05");
    expect(q.get("hasta_periodo")).toBe("2026-09");
  });
  it("con un formulario inválido no hay consulta", () => {
    expect(consultaRedComparable({ ...FORMULARIO_POR_DEFECTO, meses_tienda_nueva: "99" })).toBeNull();
  });
});
