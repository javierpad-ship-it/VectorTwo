import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La app lee y escribe Excel con SheetJS en el navegador. El paquete `xlsx` de npm (0.18.5) tiene dos avisos sin parche en ese
 * registro, así que `xlsx` es un alias de la republicación `@e965/xlsx` de SheetJS 0.20.3, con versión EXACTA. Estas pruebas
 * fijan el alias y que la librería siga cargándose bajo demanda (no entra en el JS de las pantallas).
 */
const RAIZ = process.cwd();

function archivosFuente(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

describe("dependencia xlsx", () => {
  it("package.json fija el alias de @e965/xlsx en versión exacta, sin rango", () => {
    const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(paquete.dependencies.xlsx).toBe("npm:@e965/xlsx@0.20.3");
    expect(paquete.dependencies.xlsx).not.toMatch(/[\^~*><]/);
  });

  it("package-lock.json guarda el paquete real con integridad y URL del registro de npm", () => {
    const bloqueo = JSON.parse(readFileSync(join(RAIZ, "package-lock.json"), "utf8")) as {
      packages: Record<string, { name?: string; version?: string; resolved?: string; integrity?: string }>;
    };
    const xlsx = bloqueo.packages["node_modules/xlsx"];
    expect(xlsx.name).toBe("@e965/xlsx");
    expect(xlsx.version).toBe("0.20.3");
    expect(xlsx.resolved).toBe("https://registry.npmjs.org/@e965/xlsx/-/xlsx-0.20.3.tgz");
    expect(xlsx.integrity).toMatch(/^sha512-/);
  });

  it("ninguna pantalla (.tsx) importa xlsx de forma estática ni de ninguna otra forma que no sea import() dinámico", () => {
    const tsx = archivosFuente(join(RAIZ, "src")).filter((f) => f.endsWith(".tsx"));
    expect(tsx.length).toBeGreaterThan(0);
    for (const f of tsx) {
      const texto = readFileSync(f, "utf8");
      expect(texto, f).not.toMatch(/from\s+["']xlsx["']/);
      expect(texto, f).not.toMatch(/require\(\s*["']xlsx["']\s*\)/);
    }
  });

  it("en todo src, xlsx solo entra como import() dinámico o como import type", () => {
    let dinamicos = 0;
    for (const f of archivosFuente(join(RAIZ, "src"))) {
      const texto = readFileSync(f, "utf8");
      expect(texto, f).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["']xlsx["']/m);
      expect(texto, f).not.toMatch(/^\s*import\s+["']xlsx["']/m);
      expect(texto, f).not.toMatch(/^\s*export\s+[^;]*from\s+["']xlsx["']/m);
      expect(texto, f).not.toMatch(/require\(\s*["']xlsx["']\s*\)/);
      dinamicos += (texto.match(/await import\("xlsx"\)/g) ?? []).length;
    }
    expect(dinamicos).toBeGreaterThan(0);
  });

  it("los dos lectores cargan la librería con import() y la leen con las opciones recortadas y el tope de tamaño", () => {
    for (const ruta of ["src/lib/arbol/leer-archivo.ts", "src/lib/ventas/leer-por-bloques.ts"]) {
      const texto = readFileSync(join(RAIZ, ruta), "utf8");
      expect(texto, ruta).toContain('await import("xlsx")');
      expect(texto, ruta).toContain("exigirExcelLiviano(archivo)");
      expect(texto, ruta).toContain("XLSX.read(");
      expect(texto, ruta).toContain("OPCIONES_LECTURA_EXCEL");
      expect(texto.indexOf("exigirExcelLiviano(archivo)"), ruta).toBeLessThan(texto.indexOf("XLSX.read("));
    }
  });
});
