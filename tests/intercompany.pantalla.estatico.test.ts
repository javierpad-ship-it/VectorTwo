import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";

/** Estructura de la pantalla /maestros/intercompany (M13): patrones obligatorios del frontend y que el comprador no la vea ni entre. */

const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/maestros/intercompany/";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const archivos = readdirSync(path.join(RAIZ, DIR)).filter((f) => /\.(ts|tsx)$/.test(f) && statSync(path.join(RAIZ, DIR, f)).isFile());
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("estructura de la pantalla /maestros/intercompany", () => {
  it("la página es un server component mínimo: valida el rol, redirige al comprador a Inicio y envuelve el panel en Suspense", () => {
    const p = fuente(`${DIR}page.tsx`);
    expect(p).not.toContain('"use client"');
    expect(p).toContain("perfilActual()");
    expect(p).toContain("puedeEditarMaestros(r.rol)");
    expect(p).toContain('redirect("/")');
    expect(p).toMatch(/<Suspense[\s\S]*<IntercompanyPanel/);
  });

  it("el panel es cliente y guarda pestaña, mes y filtros en la URL con la API de historial", () => {
    const p = fuente(`${DIR}intercompany-panel.tsx`);
    expect(p.startsWith('"use client"')).toBe(true);
    expect(p).toMatch(/history\.pushState/);
    expect(p).toMatch(/history\.replaceState/);
    const v = fuente(`${DIR}vista.ts`);
    for (const k of ["pestana", "marca", "genero", "mundo", "linea", "mes", "solo"]) expect(v).toContain(`get("${k}")`);
  });

  it("ningún archivo habla con Supabase ni usa fetch directo: todo va por /api con `api` o los hooks", () => {
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("las escrituras son POST, PATCH y DELETE sobre /api/intercompany/reglas y ningún GET lleva efectos", () => {
    const d = fuente(`${DIR}dialogo-regla.tsx`);
    expect(d).toContain('api.post<ReglaIntercompanyApi>("/api/intercompany/reglas"');
    expect(d).toMatch(/api\.patch<ReglaIntercompanyApi>\(`\/api\/intercompany\/reglas\/\$\{modo\.regla\.id\}`/);
    expect(fuente(`${DIR}pestana-historial.tsx`)).toMatch(/api\.delete<EliminarReglaApi>\(`\/api\/intercompany\/reglas\/\$\{r\.id\}`/);
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/api\.(put|get)/);
    }
    expect(fuente(`${DIR}use-intercompany.ts`)).toContain("useLectura<");
  });

  it("los tipos de la API se importan del contrato del módulo, no se duplican", () => {
    const todo = archivos.map((f) => fuente(`${DIR}${f}`)).join("\n");
    expect(todo).toContain('from "@/lib/intercompany/tipos-api"');
    expect(sinComentarios(todo)).not.toMatch(/type ReglaIntercompanyApi\s*=/);
  });

  it("eliminar pide confirmación, el formulario se deshabilita mientras envía y los errores de la API se muestran con Alert", () => {
    const h = fuente(`${DIR}pestana-historial.tsx`);
    expect(h).toMatch(/confirm\(textoConfirmarEliminar\(/);
    expect(h).toContain("<Alert");
    const d = fuente(`${DIR}dialogo-regla.tsx`);
    expect(d).toContain("disabled={accion.ocupado}");
    expect(d).toContain("<Alert");
    expect(d).toMatch(/confirm\(`\$\{TEXTO_AVISO_SIN_CLAVE\}/);
    expect(d).toContain("cerrable={!accion.ocupado}");
  });

  it("recarga las listas tras guardar o eliminar", () => {
    const p = fuente(`${DIR}intercompany-panel.tsx`);
    expect(p).toMatch(/await recargar\(\)/);
    expect(p).toMatch(/Promise\.all\(\[vigentes\.recargar\(\), historial\.recargar\(\)\]\)/);
  });

  it("SheetJS solo se carga bajo demanda: ningún import estático de xlsx y la descarga usa el import dinámico de M7", () => {
    for (const f of archivos) expect(fuente(`${DIR}${f}`), f).not.toMatch(/from "xlsx"/);
    expect(fuente(`${DIR}descarga.ts`)).toContain("descargarLibro");
  });

  it("la pantalla no usa colores sueltos: solo los tokens del tema", () => {
    for (const f of archivos) {
      const c = sinComentarios(fuente(`${DIR}${f}`));
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border)-(?:red|green|blue|yellow|gray|slate|zinc|amber|emerald|white|black)\b/);
    }
  });

  it("los textos de la pantalla no nombran las columnas crudas de las reglas", () => {
    for (const f of archivos.filter((x) => x.endsWith(".tsx"))) {
      const c = sinComentarios(fuente(`${DIR}${f}`)).replace(/Pick<[^>]*>/g, "");
      // Los textos visibles van entre comillas o dentro de JSX; las propiedades de la API (r.imi_min) y los `Pick<…>` de tipos son código, no texto.
      const literales = [...c.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      for (const t of literales) expect(t, `${f}: «${t}»`).not.toMatch(/\b(?:imi_min|imi_max|pct_directo|pct_cd|cobertura_min_meses|cobertura_max_meses|es_rango_defecto)\b/);
    }
  });

  it("los controles son accesibles: el formulario tiene etiquetas, los errores usan role=alert y los chips son grupos rotulados", () => {
    const d = fuente(`${DIR}dialogo-regla.tsx`);
    expect(d).toContain('role="alert"');
    expect(d).toContain("aria-invalid");
    expect(d).toContain("<Field");
    const b = fuente(`${DIR}barra-filtros.tsx`);
    expect(b).toContain('etiqueta="Filtrar por mundo"');
  });
});

describe("menú y acceso por rol", () => {
  it("Intercompany está en Maestros, sin pendiente, solo para admin y planner", () => {
    const l = NAV_SECTIONS.flatMap((s) => s.links).find((x) => x.href === "/maestros/intercompany");
    expect(l?.label).toBe("Intercompany");
    expect(l?.pendiente).toBeUndefined();
    expect(l?.roles).toEqual(["admin", "planner"]);
    expect(seccionesVisibles("admin").flatMap((s) => s.links).some((x) => x.href === "/maestros/intercompany")).toBe(true);
    expect(seccionesVisibles("planner").flatMap((s) => s.links).some((x) => x.href === "/maestros/intercompany")).toBe(true);
  });

  it("el comprador no lo ve en el menú ni entra por URL", () => {
    expect(seccionesVisibles("comprador").flatMap((s) => s.links).some((x) => x.href === "/maestros/intercompany")).toBe(false);
    expect(puedeVerRuta("comprador", "/maestros/intercompany")).toBe(false);
    expect(puedeVerRuta("comprador", "/maestros/intercompany/")).toBe(false);
    expect(puedeVerRuta("admin", "/maestros/intercompany")).toBe(true);
    expect(puedeVerRuta("planner", "/maestros/intercompany")).toBe(true);
  });
});
