import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { construirHojaLibro, nombreHojaValido } from "../src/app/(app)/planificacion/proyeccion/descarga-libro";
import { hojasMatriz, hojasMensual } from "../src/lib/proyeccion/excel";
import { bloques, respuestaMatriz, respuestaMensual, Y } from "./proyeccion.pantalla.fixture";

/** Comprobaciones de estructura de la pantalla de M7 (patrones obligatorios del frontend) y del Excel del navegador. */

const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/proyeccion/";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const archivos = readdirSync(path.join(RAIZ, DIR)).filter((f) => /\.(ts|tsx)$/.test(f) && statSync(path.join(RAIZ, DIR, f)).isFile());

describe("estructura de la pantalla /planificacion/proyeccion", () => {
  it("la página es un server component mínimo: valida el rol y redirige al comprador a Inicio", () => {
    const p = fuente(`${DIR}page.tsx`);
    expect(p).not.toContain('"use client"');
    expect(p).toContain("perfilActual()");
    expect(p).toContain("puedeEditarMaestros(r.rol)");
    expect(p).toContain('redirect("/")');
    expect(p).toMatch(/<Suspense[\s\S]*<ProyeccionPanel/);
  });

  it("el panel es cliente y guarda el estado de la vista en la URL con la API de historial", () => {
    const p = fuente(`${DIR}proyeccion-panel.tsx`);
    expect(p.startsWith('"use client"')).toBe(true);
    for (const k of ["proyeccion", "pestana", "fila", "tienda"]) expect(p).toContain(`params.get("${k}")`);
    expect(p).toMatch(/history\.pushState/);
    expect(p).toMatch(/history\.replaceState/);
    expect(p).toContain("leerFiltro(params)");
  });

  it("la pestaña de la URL se respeta desde el primer render: solo cae a Factores si ya se sabe que no hay proyección", () => {
    const p = fuente(`${DIR}proyeccion-panel.tsx`);
    expect(p).toContain("const sinProyeccion = estado.datos !== null && idElegido === null;");
    expect(p).toContain("activa={pestanaVisible}");
    expect(p).not.toMatch(/activa=\{pestana === "factores" \|\| proyeccion/);
  });

  it("las filas de una tienda se leen bajo demanda al expandir, con carga y error", () => {
    const t = fuente(`${DIR}tarjeta-tienda.tsx`);
    expect(t).toMatch(/tiendas\/\$\{t\.tienda_id\}\/filas\?anio=\$\{t\.anio\}/);
    expect(t).toContain("onToggle");
    expect(t).toContain("Leyendo las filas de");
  });

  it("ningún archivo de la pantalla habla con Supabase ni usa fetch directo: todo va por /api con `api`", () => {
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("SheetJS solo se carga bajo demanda (import dinámico) y nunca de forma estática", () => {
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/from "xlsx"/);
    }
    expect(fuente(`${DIR}descarga-libro.ts`)).toContain('await import("xlsx")');
  });

  it("las acciones destructivas piden confirmación y los errores de la API se muestran", () => {
    const p = fuente(`${DIR}proyeccion-panel.tsx`);
    expect(p).toMatch(/confirm\(`¿Eliminar[\s\S]*api\.delete/);
    expect(p).toMatch(/confirm\(`¿Archivar[\s\S]*archivar/);
    expect(p).toContain("<AlertaError");
    expect(fuente(`${DIR}linea-tab.tsx`)).toMatch(/confirm\(`Se copiará el reparto con la curva nueva/);
    expect(fuente(`${DIR}factores-tab.tsx`)).toMatch(/confirm\(\s*"Sincronizar vuelve a calcular el factor relativo/);
  });

  it("las mutaciones usan POST, PUT, PATCH o DELETE; ningún GET lleva efectos", () => {
    const usos = archivos.map((f) => fuente(`${DIR}${f}`)).join("\n");
    expect(usos).toMatch(/api\.post/);
    expect(usos).toMatch(/api\.put/);
    expect(usos).toMatch(/api\.patch/);
    // Lo único que se lee con `api.get` es lo que cargan los hooks (`useLectura`), nunca una acción.
    for (const f of archivos.filter((x) => x !== "use-proyeccion.ts")) expect(fuente(`${DIR}${f}`), f).not.toMatch(/api\.get/);
    expect(fuente(`${DIR}use-proyeccion.ts`)).toMatch(/api\s*\.get</);
  });

  it("los números usan el formato compartido (es-PE, punto decimal): ni toFixed ni toLocaleString('es-ES')", () => {
    for (const f of archivos) {
      const c = fuente(`${DIR}${f}`);
      expect(c, f).not.toMatch(/\.toFixed\(/);
      expect(c, f).not.toMatch(/es-ES/);
    }
  });

  it("no se agregó ninguna librería de UI: la pantalla solo importa de React, Next y del propio proyecto", () => {
    const permitidos = new Set(["react", "next/link", "next/navigation"]);
    for (const f of archivos) {
      const externos = [...fuente(`${DIR}${f}`).matchAll(/from "([^"]+)"/g)].map((m) => m[1]).filter((m) => !m.startsWith(".") && !m.startsWith("@/"));
      for (const e of externos) expect(permitidos.has(e), `${f} importa ${e}`).toBe(true);
    }
  });

  it("el importador de tiendas acepta solo alias de venta MENSUAL como venta esperada (07d): no mapea solo una columna anual", () => {
    const c = fuente("src/app/(app)/maestros/tiendas/importar-tiendas.tsx");
    const alias = /campo: "venta_esperada"[\s\S]*?alias:\s*\[([^\]]*)\]/.exec(c)?.[1] ?? "";
    expect(alias).toContain('"VENTA_MENSUAL"');
    expect(alias).toContain('"VENTA_PROMEDIO_MENSUAL"');
    expect(alias).toContain('"VENTA_ESPERADA"');
    expect(alias).toContain('"VENTA_ESPERADA_PROMEDIO"');
    expect(alias).not.toContain("VENTA_ESPERADA_ANIO_APERTURA");
    expect(alias).not.toContain("VENTA_APERTURA");
    expect(c).not.toMatch(/alias:\s*\[[^\]]*VENTA_PROM"/);
    expect(c).toContain("Venta mensual promedio esperada");
  });

  it("los textos de la pantalla no prometen una versión concreta para los cierres de tienda", () => {
    for (const f of archivos) expect(fuente(`${DIR}${f}`), f).not.toMatch(/llega en la 0\.10\.1/);
  });

  it("Factores del Niño: confirmar es escribir el valor (sin botón «usar el calculado»), los errores se muestran y todo va por /api", () => {
    const f = fuente(`${DIR}factores-tab.tsx`);
    expect(f.startsWith('"use client"')).toBe(true);
    expect(f).toContain("useLectura<FactorApi[]>");
    expect(f).toContain("api.put<FactorApi[]>");
    expect(f).toContain("api.post<FactorApi[]>");
    expect(f).toContain("<AlertaError");
    expect(f).not.toMatch(/usar (este valor|el calculado)/i);
    expect(f).not.toMatch(/@supabase|\bfetch\(/);
    // La fórmula, los estados y el diagnóstico los arma `factores-vista.ts` (puro, sin React).
    const v = fuente(`${DIR}factores-vista.ts`);
    expect(v).not.toContain("react");
    expect(v).toContain("MIN_MESES_FACTOR");
  });

  it("el cierre usa la constante `VERSION_METODO` y los códigos de `tipos-api`, no copias sueltas", () => {
    expect(fuente(`${DIR}crecimientos-vista.ts`)).toContain("VERSION_METODO");
    expect(fuente(`${DIR}vista.ts`)).toContain("CODIGOS_CIERRE_BLOQUEADO_NINO");
    expect(fuente(`${DIR}cerrar-modal.tsx`)).toContain("CODIGOS_CIERRE_BLOQUEADO_NINO");
  });

  it("la versión vigente es 0.13.0 · M8 b", () => {
    expect(fuente("src/lib/version.ts")).toContain('APP_VERSION = "0.13.0 · M8 b"');
  });
});

describe("Excel en el navegador", () => {
  it("nombre de hoja válido para Excel", () => {
    expect(nombreHojaValido("MATRIZ")).toBe("MATRIZ");
    expect(nombreHojaValido("a/b?c*d[e]f:g")).toBe("a b c d e f g");
    expect(nombreHojaValido("x".repeat(50))).toHaveLength(31);
    expect(nombreHojaValido("   ")).toBe("HOJA");
  });

  it("las celdas sin dato quedan vacías (no 0) y un texto que parece fórmula se escribe como texto", () => {
    const hoja = construirHojaLibro(XLSX, [
      ["NOMBRE", "ENE", "FEB"],
      ["=HYPERLINK(\"x\")", 10, null],
    ]);
    expect(hoja.A2.t).toBe("s");
    expect(hoja.A2.v).toBe('=HYPERLINK("x")');
    expect(hoja.B2.v).toBe(10);
    expect(hoja.C2).toBeUndefined();
    expect(hoja["!cols"]).toHaveLength(3);
  });

  it("la matriz exportada lleva las tres hojas, el filtro en palabras y las columnas sin solapes", () => {
    const m = respuestaMatriz();
    const hojas = hojasMatriz({
      nodos: m.nodos,
      bloques: bloques(),
      anio: Y,
      filtro: { ...m.filtro, genero_id: "g-h" },
      datosHasta: "2026-09",
      nombresFiltro: { "g-h": "HOMBRE" },
    });
    expect(Object.keys(hojas)).toEqual(["MATRIZ", "BLOQUES", "FILTROS"]);
    expect(hojas.MATRIZ[0]).toContain("VENTA A LA FECHA 2026");
    expect(hojas.MATRIZ[0]).toContain("NUEVAS AÑO ANTERIOR 2027");
    expect(hojas.MATRIZ).toHaveLength(1 + m.nodos.length);
    expect(hojas.FILTROS.some((f) => f[0] === "genero" && f[1] === "HOMBRE")).toBe(true);
    expect(hojas.FILTROS.some((f) => f[0] === "datos_hasta" && f[1] === "2026-09")).toBe(true);
    expect(hojas.BLOQUES.some((f) => f[3] === "T12" && f[2] === "aperturas")).toBe(true);
    const libro = XLSX.utils.book_new();
    for (const [nombre, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(libro, construirHojaLibro(XLSX, filas), nombreHojaValido(nombre));
    expect(libro.SheetNames).toEqual(["MATRIZ", "BLOQUES", "FILTROS"]);
  });

  it("la mensual exportada lleva meses aaaa-mm, totales, origen real/proyectado y la celda sin curva vacía", () => {
    const m = respuestaMensual();
    const hojas = hojasMensual({ filas: m.filas, bloques: bloques(), anio: Y, filtro: m.filtro, datosHasta: "2026-09" });
    expect(Object.keys(hojas)).toEqual(["MENSUAL", "BLOQUES", "FILTROS"]);
    const cab = hojas.MENSUAL[0];
    expect(cab).toContain("2026-01");
    expect(cab).toContain("2027-12");
    expect(cab).toContain("TOTAL_2026");
    expect(cab).toContain("ORIGEN_2026");
    expect(hojas.MENSUAL[1][cab.indexOf("ORIGEN_2026")]).toBe("real:9/proy:3");
    const sinCurva = hojas.MENSUAL[2];
    expect(sinCurva[5]).toBeNull();
    expect(sinCurva[cab.indexOf("AVISOS")]).toBe("sin_curva");
    const hoja = construirHojaLibro(XLSX, hojas.MENSUAL);
    expect(hoja.F3).toBeUndefined();
  });
});
