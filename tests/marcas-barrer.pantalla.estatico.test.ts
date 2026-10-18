import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";

/** Estructura de la pantalla /planificacion/marcas-barrer (M12) y de los cambios de M2 y M7 que la acompañan: patrones obligatorios del frontend. */

const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/marcas-barrer/";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const archivos = readdirSync(path.join(RAIZ, DIR)).filter((f) => /\.(ts|tsx)$/.test(f) && statSync(path.join(RAIZ, DIR, f)).isFile());
const todos = (dir: string): string[] =>
  readdirSync(path.join(RAIZ, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) return todos(rel);
    return /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("estructura de la pantalla /planificacion/marcas-barrer", () => {
  it("la página es un server component mínimo: valida el rol, redirige al comprador a Inicio y envuelve el panel en Suspense", () => {
    const p = fuente(`${DIR}page.tsx`);
    expect(p).not.toContain('"use client"');
    expect(p).toContain("perfilActual()");
    expect(p).toContain("puedeEditarMaestros(r.rol)");
    expect(p).toContain('redirect("/")');
    expect(p).toMatch(/<Suspense[\s\S]*<MarcasBarrerPanel/);
  });

  it("el panel es cliente y guarda la marca, la ventana, el modo y el alcance en la URL con la API de historial", () => {
    const p = fuente(`${DIR}marcas-barrer-panel.tsx`);
    expect(p.startsWith('"use client"')).toBe(true);
    expect(p).toMatch(/history\.pushState/);
    expect(p).toMatch(/history\.replaceState/);
    const v = fuente(`${DIR}vista.ts`);
    for (const k of ["marca", "ventana", "modo", "genero", "mundo", "lineas"]) expect(v).toContain(`get("${k}")`);
  });

  it("ningún archivo habla con Supabase ni usa fetch directo: todo va por /api con `api`", () => {
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("las lecturas pasan por los hooks y las acciones solo por api.post / api.patch; ningún GET lleva efectos", () => {
    const usos = archivos.map((f) => fuente(`${DIR}${f}`)).join("\n");
    expect(usos).toMatch(/api\.post<RepartoApi>\(`\/api\/marcas-barrer\/\$\{marcaId\}\/repartos`/);
    expect(usos).toMatch(/api\.patch\(`\/api\/marcas\/\$\{marca\.id\}`/);
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/api\.(put|delete)/);
      expect(c, f).not.toMatch(/api\.get/);
    }
    expect(fuente(`${DIR}use-marcas-barrer.ts`)).toContain("useLectura<");
  });

  it("SheetJS solo se carga bajo demanda: ningún import estático de xlsx y la descarga usa el import dinámico de M7", () => {
    for (const f of archivos) expect(fuente(`${DIR}${f}`), f).not.toMatch(/from "xlsx"/);
    expect(fuente(`${DIR}descarga.ts`)).toContain("descargarLibro");
    expect(fuente("src/app/(app)/planificacion/proyeccion/descarga-libro.ts")).toContain('await import("xlsx")');
  });

  it("los cambios de modalidad, los ajustes descartados y los parámetros con ajustes pendientes piden confirmación; los errores de la API se muestran con Alert", () => {
    const cab = fuente(`${DIR}cabecera-marca.tsx`);
    expect(cab).toMatch(/confirm\(textoConfirmarModalidad\(/);
    expect(cab).toContain("<Alert");
    expect(fuente(`${DIR}bloque-reparto.tsx`)).toMatch(/confirm\("¿Descartar los ajustes/);
    expect(fuente(`${DIR}detalle-marca.tsx`)).toMatch(/confirm\("Esto recalcula el análisis y descarta los ajustes/);
    for (const f of ["detalle-marca.tsx", "bloque-reparto.tsx", "lista-marcas.tsx", "versiones-reparto.tsx"]) expect(fuente(`${DIR}${f}`), f).toContain("<Alert");
  });

  it("aprobar envía la huella del análisis y el botón se deshabilita mientras envía o si hay un bloqueo", () => {
    const d = fuente(`${DIR}detalle-marca.tsx`);
    expect(d).toContain("huella: analisis.huella");
    expect(d).toContain("aprobar.ocupado || releyendo");
    const b = fuente(`${DIR}bloque-reparto.tsx`);
    expect(b).toMatch(/disabled=\{accion\.ocupado \|\| aprob\.bloqueos\.length > 0\}/);
  });

  it("los números usan el formato compartido (es-PE): ni toFixed ni toLocaleString('es-ES')", () => {
    for (const f of archivos) {
      const c = sinComentarios(fuente(`${DIR}${f}`));
      expect(c, f).not.toMatch(/\.toFixed\(/);
      expect(c, f).not.toMatch(/es-ES/);
    }
  });

  it("solo tokens del tema: ni colores hexadecimales sueltos ni clases de color de Tailwind fuera de la paleta del proyecto", () => {
    for (const f of archivos.filter((x) => x.endsWith(".tsx"))) {
      const c = sinComentarios(fuente(`${DIR}${f}`));
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border|fill|stroke)-(?:red|blue|green|gray|slate|zinc|yellow|orange|white|black)\b/);
    }
  });

  it("no se agregó ninguna librería de UI: solo React, Next y el propio proyecto", () => {
    const permitidos = new Set(["react", "next/link", "next/navigation"]);
    for (const f of archivos) {
      const externos = [...fuente(`${DIR}${f}`).matchAll(/from "([^"]+)"/g)].map((m) => m[1]).filter((m) => !m.startsWith(".") && !m.startsWith("@/"));
      for (const e of externos) expect(permitidos.has(e), `${f} importa ${e}`).toBe(true);
    }
  });

  it("la lógica pura no importa React ni nada de cliente", () => {
    for (const f of ["ajuste.ts", "vista.ts", "excel-vista.ts"]) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/from "react"|"use client"|next\//);
    }
  });

  it("los gráficos son SVG propio: la pantalla no importa ninguna librería de gráficos", () => {
    expect(fuente(`${DIR}grafico-lineas.tsx`)).toContain("<svg");
    expect(fuente("package.json")).not.toMatch(/recharts|chart\.js|d3|victory|nivo|visx/);
  });

  it("los controles tienen nombre accesible: las celdas de porcentaje, los chips y los selectores", () => {
    expect(fuente(`${DIR}celda-porcentaje.tsx`)).toContain("aria-label={etiqueta}");
    expect(fuente(`${DIR}bloque-reparto.tsx`)).toContain('etiqueta="Fuente del reparto"');
    expect(fuente(`${DIR}cabecera-marca.tsx`)).toContain("etiqueta={`${titulo} del alcance`}");
  });
});

describe("menú y acceso por rol", () => {
  const link = NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === "/planificacion/marcas-barrer");

  it("«Marcas al barrer por GML» está en Planificación, sin pendiente", () => {
    expect(link?.label).toBe("Marcas al barrer por GML");
    expect(link?.pendiente).toBeUndefined();
    expect(NAV_SECTIONS.find((s) => s.links.includes(link!))?.title).toBe("Planificación");
  });

  it("admin y planner la ven y entran; el comprador no la ve ni entra por URL", () => {
    for (const rol of ["admin", "planner"] as const) {
      expect(puedeVerRuta(rol, "/planificacion/marcas-barrer")).toBe(true);
      expect(seccionesVisibles(rol).flatMap((s) => s.links).some((l) => l.href === "/planificacion/marcas-barrer")).toBe(true);
    }
    expect(puedeVerRuta("comprador", "/planificacion/marcas-barrer")).toBe(false);
    expect(puedeVerRuta("comprador", "/planificacion/marcas-barrer/")).toBe(false);
    expect(seccionesVisibles("comprador").flatMap((s) => s.links).some((l) => l.href === "/planificacion/marcas-barrer")).toBe(false);
  });
});

describe("la modalidad cruda no se lee en las pantallas (ficha 12, 6.1: todos leen `modalidad_efectiva`)", () => {
  it("ningún archivo de la pantalla de M12 ni de las pantallas de marcas nombra la columna (los helpers viven en src/lib/marcas/modalidad.ts)", () => {
    const archivosPantalla = [...todos("src/components"), ...todos("src/app/(app)")];
    const nombran = archivosPantalla.filter((f) => /modalidad_tratamiento/.test(sinComentarios(fuente(f))));
    expect(nombran).toEqual([]);
  });

  it("los selectores de modalidad ofrecen las tres modalidades (también en el alta de una marca)", () => {
    expect(fuente("src/components/marcas/comunes-m2b.ts")).toContain('MODALIDADES_ELEGIBLES: readonly ModalidadEfectiva[] = ["por_gml", "barrido", "mixta"]');
    for (const f of ["marcas-tabla.tsx", "gml-por-marca.tsx", "conjunto-detalle.tsx"]) expect(fuente(`src/app/(app)/maestros/marcas/${f}`), f).toContain("MODALIDADES_ELEGIBLES");
    expect(fuente("src/app/(app)/maestros/marcas/marcas-tabla.tsx")).toContain('<option value="mixta">');
  });

  it("toda asignación de GML pasa por la pregunta «¿Por GML o Mixta?» antes de escribir", () => {
    const g = fuente("src/app/(app)/maestros/marcas/gml-tab.tsx");
    expect(g).toContain("marcasQueRequierenDestino(marcasObjetivo)");
    expect(g.indexOf("await pedirDestino(preguntar)")).toBeLessThan(g.indexOf('api.post<AsignarGmlRespuesta>("/api/marcas/gml-especial/asignar"'));
    expect(g).toContain("modalidad_destino: destino");
    // Las tres vistas asignan solo por `ops.asignar`: ninguna escribe asignaciones por su cuenta.
    for (const f of ["gml-por-marca.tsx", "gml-por-gml.tsx", "gml-sugerencias.tsx"]) expect(fuente(`src/app/(app)/maestros/marcas/${f}`), f).not.toContain("/api/marcas/gml-especial/asignar");
  });
});

describe("M7 avisa de la configuración cambiada", () => {
  it("el motivo `config_cambiada` tiene su texto y un enlace a Marcas en la cabecera de la proyección", () => {
    expect(fuente("src/app/(app)/planificacion/proyeccion/vista.ts")).toContain('m.codigo === "config_cambiada"');
    expect(fuente("src/app/(app)/planificacion/proyeccion/cabecera-proyeccion.tsx")).toMatch(/config_cambiada[\s\S]*href="\/maestros\/marcas"/);
  });
});
