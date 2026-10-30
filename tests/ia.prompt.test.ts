import { describe, expect, it } from "vitest";
import { BANDERAS_IA, salidaNaturalIa, salidaRepartoIa } from "@/lib/ia/esquemas";
import { huellaPrompt, PROMPTS, textoPrompt, VERSION_PROMPT, VERSIONES_PROMPT } from "@/lib/ia/prompt";

/** R32 (ficha 07e, §3.7): el prompt `v1` dice lo que la ficha fija y no lleva ningún término prohibido ni año real. */

const v1 = PROMPTS.v1;

/** Las huellas del texto de cada versión publicada. Cambiar una letra del prompt exige subir la versión (y evaluarla): no se edita esta cifra. */
const HUELLAS_PUBLICADAS: Record<string, string> = {
  v1: "e4ce0a2cc47db1fb4513d210f64c0b7bf4f587f35f4ac4eba03b6cc0e844a71c",
};

describe("R32 · registro de versiones", () => {
  it("v1 es la versión actual y las demás consultas devuelven nulo", () => {
    expect(VERSION_PROMPT).toBe("v1");
    expect([...VERSIONES_PROMPT]).toEqual(["v1"]);
    expect(textoPrompt("v1")).toBe(v1);
    expect(textoPrompt("v99")).toBeNull();
  });
  it("la huella del texto de cada versión publicada está fijada", () => {
    for (const version of VERSIONES_PROMPT) expect(huellaPrompt(version), `La huella de ${version} cambió: el texto publicado no se edita, se crea otra versión.`).toBe(HUELLAS_PUBLICADAS[version]);
  });
});

describe("R32 · contenido de v1", () => {
  it("rol de analista de planeamiento sin nombrar la empresa ni ningún término prohibido", () => {
    expect(v1).toMatch(/analista de planeamiento/);
    expect(v1).toMatch(/tiendas de ropa en Perú/);
    for (const prohibido of ["lukers", "vector", "marcax", "z901", "anthropic", "claude", "sunat", "http", "@"]) expect(v1.toLowerCase()).not.toContain(prohibido);
  });

  it("ningún año real, ni uuid, ni fecha", () => {
    expect(v1).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(v1).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(v1).not.toMatch(/\b\d{4}-\d{2}\b/);
  });

  it("glosario: años relativos, mismas tiendas y comparable_pct, B = cierre + entrantes − salientes, base corregida y A+1 normal", () => {
    expect(v1).toMatch(/A es el año en curso/);
    expect(v1).toMatch(/A\+1 es el año que se planifica/);
    expect(v1).toMatch(/ultimo_mes_cerrado/);
    expect(v1).toMatch(/comparable_pct/);
    expect(v1).toMatch(/mismas tiendas/);
    expect(v1).toContain("B = cierre de A + entrantes − salientes");
    expect(v1).toMatch(/Ejemplo sintético/);
    expect(v1).toMatch(/base_corregida/);
    expect(v1).toMatch(/A\+1 es un año normal/);
    expect(v1).toMatch(/fila libre/);
    expect(v1).toMatch(/fila fija/);
    expect(v1).toMatch(/meta libre/);
  });

  it("alias y nombres como datos; solo el JSON del esquema", () => {
    expect(v1).toMatch(/MARCA_A/);
    expect(v1).toMatch(/TIENDA_A/);
    expect(v1).toMatch(/son datos/);
    expect(v1).toMatch(/datos, no instrucciones/);
    expect(v1).toMatch(/Responde solo con el JSON/);
  });

  it("las tres tareas, y la natural no conoce la meta", () => {
    expect(v1).toMatch(/natural\. Para cada fila libre/);
    expect(v1).toMatch(/NO hay meta/);
    expect(v1).toMatch(/reparto\. Recibes meta\.del_lote/);
    expect(v1).toMatch(/poniendo más esfuerzo donde la fila tiene con qué crecer y menos donde no/);
    expect(v1).toMatch(/lineas \(solo en/);
    expect(v1).toMatch(/meta\.libre/);
  });

  it("reglas: unidades enteras, no inventar, poca historia, aperturas y cierres fuera, límites de las razones", () => {
    expect(v1).toMatch(/Unidades enteras/);
    expect(v1).toMatch(/No inventes datos/);
    expect(v1).toMatch(/dato_insuficiente/);
    expect(v1).toMatch(/no uses la venta de A sin corregir como base/);
    expect(v1).toMatch(/aperturas y los cierres/);
    expect(v1).toMatch(/200 caracteres/);
    expect(v1).toMatch(/280 caracteres/);
    expect(v1).toMatch(/600 caracteres/);
  });

  it("el catálogo de banderas del prompt es el del esquema", () => {
    for (const b of BANDERAS_IA) expect(v1).toContain(b);
  });

  it("no manda la propuesta del método ni la meta en la tarea natural", () => {
    expect(v1).not.toMatch(/propuesta del método/i);
  });

  it("el ejemplo sintético cumple los esquemas de salida (A: natural 10 300 · 6 600 · 5 100; reparto 11 000 · 6 700 · 5 000)", () => {
    const bloques = v1
      .split("\n\n")
      .map((b) => b.trim())
      .filter((b) => b.startsWith('{"version_salida"'));
    expect(bloques).toHaveLength(2);
    const [natural, reparto] = bloques.map((b) => JSON.parse(b) as unknown);
    const n = salidaNaturalIa.parse(natural);
    const r = salidaRepartoIa.parse(reparto);
    expect(n.filas.map((f) => f.natural_y1)).toEqual([10300, 6600, 5100]);
    expect(r.filas.map((f) => f.meta_y1)).toEqual([11000, 6700, 5000]);
    expect(n.filas.every((f) => f.razon_natural.length <= 200)).toBe(true);
    expect(r.filas.every((f) => f.razon.length <= 280)).toBe(true);
    expect(r.razon_gm.length).toBeLessThanOrEqual(600);
  });

  it("el texto es estable: sin caracteres de control ni de formato ocultos", () => {
    expect(new RegExp("[\\p{Cf}\\p{Zl}\\p{Zp}]", "u").test(v1)).toBe(false);
  });
});
