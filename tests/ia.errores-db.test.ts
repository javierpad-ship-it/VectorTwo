import { describe, expect, it, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";

describe("registrarErrorDb · R26: la IA no loguea message ni details", () => {
  const err = { code: "23514", message: 'new row for relation "ia_propuestas_filas" violates check constraint, Failing row contains (DENIM 2025)', details: "Key (razon)=(texto del modelo) ...", hint: "pista", name: "PostgrestError" } as unknown as PostgrestError;

  it("con contexto «IA: …» solo salen code y hint", async () => {
    const { registrarErrorDb, datosParaLogDb } = await import("@/lib/api/errores-db");
    expect(datosParaLogDb(err, "IA: guardar la entrada")).toEqual({ code: "23514", hint: "pista" });
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      registrarErrorDb(err, "IA: guardar la entrada");
      const texto = JSON.stringify(espia.mock.calls);
      expect(texto).toContain("23514");
      expect(texto).not.toContain("DENIM");
      expect(texto).not.toContain("texto del modelo");
      expect(texto).not.toContain("ia_propuestas_filas");
    } finally {
      espia.mockRestore();
    }
  });

  it("en los demás módulos el log sigue siendo completo", async () => {
    const { datosParaLogDb } = await import("@/lib/api/errores-db");
    expect(datosParaLogDb(err, "leer proyección")).toEqual({ code: "23514", message: err.message, details: err.details, hint: "pista" });
    expect(datosParaLogDb(err)).toMatchObject({ message: err.message });
  });

  it("estático: todo fallaDb/traducirErrorDb de src/lib/ia usa un contexto que empieza por «IA:»", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = `${__dirname}/../src/lib/ia`;
    const malos: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const t = readFileSync(`${dir}/${f}`, "utf8");
      for (const m of t.matchAll(/(?:fallaDb|traducirErrorDb)\([^;\n]*?,\s*"([^"]*)"\)/g)) if (!m[1].startsWith("IA:")) malos.push(`${f}: ${m[1]}`);
    }
    expect(malos).toEqual([]);
  });
});
