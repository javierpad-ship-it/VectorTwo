import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, esActivo, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";

/**
 * Estructura de las pantallas de Compras de M8 (T3a): patrones obligatorios del frontend (página mínima de servidor con el panel de cliente
 * al lado, datos solo por /api, kit de UI, confirm en lo destructivo, errores con Alert), los hooks hablando con las rutas del contrato y el
 * menú: la sección la ven los tres roles y `/compras/registro` también (los botones de escritura se ocultan por rol).
 */

const RAIZ = path.resolve(__dirname, "..");
const DIRS = ["src/app/(app)/compras", "src/components/compras"];
const HOOKS = ["src/lib/flujo/use-flujo.ts", "src/lib/compras/use-compras.ts"];
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function archivosDe(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((f) => {
    const ruta = `${dir}/${f}`;
    if (statSync(path.join(RAIZ, ruta)).isDirectory()) return archivosDe(ruta);
    return /\.(ts|tsx)$/.test(f) ? [ruta] : [];
  });
}
const ARCHIVOS = [...DIRS.flatMap(archivosDe), ...HOOKS];
const PAGINAS = [
  { ruta: "src/app/(app)/compras/page.tsx", panel: "HuecosPanel", archivoPanel: "src/app/(app)/compras/huecos-panel.tsx" },
  { ruta: "src/app/(app)/compras/flujo/page.tsx", panel: "FlujoPanel", archivoPanel: "src/app/(app)/compras/flujo/flujo-panel.tsx" },
  { ruta: "src/app/(app)/compras/registro/page.tsx", panel: "RegistroPanel", archivoPanel: "src/app/(app)/compras/registro/registro-panel.tsx" },
];

describe("estructura de las tres pantallas", () => {
  it("cada página es un server component mínimo: obtiene el perfil, redirige si no hay y envuelve el panel en Suspense con el rol", () => {
    for (const p of PAGINAS) {
      const c = fuente(p.ruta);
      expect(c, p.ruta).not.toContain('"use client"');
      expect(c, p.ruta).toContain("perfilActual()");
      expect(c, p.ruta).toContain('redirect("/")');
      expect(c, p.ruta).toMatch(new RegExp(`<Suspense[\\s\\S]*<${p.panel} rol=\\{r\\.rol\\}`));
      expect(c, p.ruta).toContain("export const metadata");
    }
  });

  it("cada panel es de cliente, recibe el rol y guarda sus filtros en la URL con la API de historial", () => {
    for (const p of PAGINAS) {
      const c = fuente(p.archivoPanel);
      expect(c.startsWith('"use client"'), p.archivoPanel).toBe(true);
      expect(c, p.archivoPanel).toContain("useSearchParams");
      expect(c, p.archivoPanel).toMatch(/history\.(replaceState|pushState)/);
      expect(c, p.archivoPanel).toMatch(/\{ rol \}: \{ rol: Rol \}/);
    }
  });

  it("el panel de Flujo y el de Compras ocultan la escritura al comprador (la API la exige con requirePlanner)", () => {
    for (const f of ["src/app/(app)/compras/flujo/flujo-panel.tsx", "src/app/(app)/compras/registro/registro-panel.tsx"]) {
      const c = fuente(f);
      expect(c, f).toContain('const puedeEscribir = rol === "admin" || rol === "planner"');
    }
    expect(fuente("src/app/(app)/compras/registro/registro-panel.tsx")).toMatch(/puedeEscribir && \(\s*<Button onClick=\{\(\) => irA\(\{ \.\.\.parametros, importar: true/);
    expect(fuente("src/app/(app)/compras/flujo/flujo-panel.tsx")).toContain("puedeEscribir && datos");
    const detalle = fuente("src/components/compras/detalle-compra.tsx");
    expect(detalle).toContain("const puedeRecibir = puedeEscribir && compra.puede.recibir");
    expect(detalle).toContain("puedeEscribir && compra.puede.cancelar");
    expect(fuente("src/components/compras/pestana-conciliacion.tsx")).toContain("s.boton && puedeEscribir");
  });

  it("el rol llega al panel de Huecos solo para decidir «Mis líneas»: es un filtro, nunca un permiso", () => {
    const c = fuente("src/components/compras/vista-huecos.ts");
    expect(c).toContain('rol === "comprador" && combinaciones > 0 ? "mias" : "todas"');
  });
});

describe("datos, kit de UI y errores", () => {
  it("ningún archivo habla con Supabase ni usa fetch directo: todo va por /api con `api` o los hooks", () => {
    for (const f of ARCHIVOS) {
      const c = fuente(f);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("los hooks hablan con las rutas del contrato de T0", () => {
    const flujo = sinComentarios(fuente("src/lib/flujo/use-flujo.ts"));
    for (const r of ["/api/flujo${", "/api/flujo/huecos", "/api/flujo/fila", "/api/flujo/conciliacion${", "/api/flujo/parametros", "/api/flujo/conciliacion/aceptar"]) expect(flujo, r).toContain(r);
    expect(flujo).toContain("api.put<ParametrosFlujoApi>(URL_PARAMETROS");
    expect(flujo).toContain("api.post<RespuestaAceptarApi>(URL_ACEPTAR_SUGERENCIA");
    const compras = sinComentarios(fuente("src/lib/compras/use-compras.ts"));
    for (const r of ["/api/compras", "/api/compras/${id}", "/api/compras/proveedores", "/api/compras/importar", "/recibir", "/recepciones/${recepcionId}?revision=${revision}", "/cancelar", "/historial"]) expect(compras, r).toContain(r);
    expect(compras).toContain("api.post<CompraApi>(`${urlCompra(compraId)}/recibir`");
    expect(compras).toContain("api.delete<CompraApi>(");
    expect(compras).toContain("useLectura<CompraApi[]>(urlCompras(filtros), true)");
    expect(compras).toContain("useColeccion<ProveedorApi>(URL_PROVEEDORES)");
  });

  it("«Aceptar sugerencia» manda la `revision` que trae la sugerencia: no se lee la compra antes", () => {
    const flujo = sinComentarios(fuente("src/app/(app)/compras/flujo/flujo-panel.tsx"));
    expect(flujo).toContain("s.revision");
    expect(flujo).not.toContain("leerCompra");
    expect(sinComentarios(fuente("src/lib/compras/use-compras.ts"))).not.toContain("leerCompra");
  });

  it("Excel: Flujo y Compras usan las hojas de `lib/flujo/excel.ts` y la descarga del navegador, sin import estático de xlsx", () => {
    const descarga = sinComentarios(fuente("src/components/compras/descarga.ts"));
    expect(descarga).toContain("hojasFlujo(");
    expect(descarga).toContain("hojasCompras(");
    expect(descarga).toContain("descargarLibro");
    expect(sinComentarios(fuente("src/app/(app)/compras/flujo/flujo-panel.tsx"))).toContain("descargarFlujo(");
    expect(sinComentarios(fuente("src/app/(app)/compras/registro/registro-panel.tsx"))).toContain("descargarCompras(visibles)");
  });

  it("los tipos de la API se importan de los contratos del módulo y no se duplican", () => {
    const todo = ARCHIVOS.map((f) => sinComentarios(fuente(f))).join("\n");
    expect(todo).toContain('from "@/lib/flujo/tipos-api"');
    expect(todo).toContain('from "@/lib/compras/tipos-api"');
    for (const tipo of ["FlujoApi", "HuecosApi", "CompraApi", "ConciliacionApi", "TarjetaHuecoApi", "ReporteImportacionComprasApi", "ParametrosFlujoApi"]) {
      expect(todo, tipo).not.toMatch(new RegExp(`(?:type|interface) ${tipo}\\s*[=<{]`));
    }
  });

  it("lo destructivo pide confirm: quitar un ingreso, cancelar, aceptar una sugerencia y aplicar la importación", () => {
    expect(fuente("src/app/(app)/compras/registro/registro-panel.tsx")).toMatch(/confirm\(textoConfirmarQuitar\(/);
    expect(fuente("src/components/compras/dialogo-cancelar.tsx")).toMatch(/confirm\(textoConfirmarCancelar\(/);
    expect(fuente("src/app/(app)/compras/flujo/flujo-panel.tsx")).toMatch(/confirm\(`Confirmar \$\{resumenIngreso\(/);
    expect(fuente("src/components/compras/use-importar-compras.ts")).toMatch(/confirm\(confirmarAplicar\(/);
  });

  it("los formularios se deshabilitan mientras envían, los errores de la API se muestran con Alert y las escrituras recargan", () => {
    for (const f of ["dialogo-ingreso", "dialogo-cancelar", "dialogo-parametros"]) {
      const c = fuente(`src/components/compras/${f}.tsx`);
      expect(c, f).toContain("disabled={accion.ocupado}");
      expect(c, f).toContain("cerrable={!accion.ocupado}");
      expect(c, f).toContain("<Alert");
      expect(c, f).toContain("accion.error");
    }
    const registro = fuente("src/app/(app)/compras/registro/registro-panel.tsx");
    expect(registro).toContain("<Alert");
    expect(registro).toMatch(/await recargarTodo\(\)/);
    expect(registro).toMatch(/Promise\.all\(\[compras\.recargar\(\), detalle\.recargar\(\), cabecera\.recargar\(\)\]\)/);
    const flujo = fuente("src/app/(app)/compras/flujo/flujo-panel.tsx");
    expect(flujo).toContain("<Alert");
    expect(flujo).toMatch(/await recargarTodo\(\)/);
    // «Aceptar sugerencia» no se ejecuta sola y su botón queda desactivado mientras la petición está en vuelo.
    expect(fuente("src/components/compras/pestana-conciliacion.tsx")).toContain("disabled={ocupada}");
    expect(flujo).toContain("setAceptando(s.entrega_id)");
  });

  it("los formularios son accesibles: etiquetas con Field, errores con role=alert (el Alert) y grupos de chips rotulados", () => {
    expect(fuente("src/components/compras/dialogo-ingreso.tsx")).toContain("<Field");
    expect(fuente("src/components/compras/dialogo-ingreso.tsx")).toContain("aria-invalid");
    expect(fuente("src/components/ui/alert.tsx")).toContain('role="alert"');
    expect(fuente("src/components/compras/barra-filtros-flujo.tsx")).toContain('etiqueta="Mostrar solo"');
    expect(fuente("src/components/compras/senal.tsx")).toContain('role="meter"');
    expect(fuente("src/components/compras/tabla-matriz.tsx")).toContain('scope="row"');
  });

  it("las tablas van dentro de DataTable o de un contenedor con scroll horizontal (nada fuera de pantalla en 390 px)", () => {
    expect(fuente("src/components/compras/tabla-matriz.tsx")).toContain("overflow-x-auto");
    expect(fuente("src/components/compras/pestana-conciliacion.tsx")).toContain("overflow-x-auto");
    for (const f of ["lista-filas", "lista-compras"]) expect(fuente(`src/components/compras/${f}.tsx`), f).toContain("<DataTable");
  });

  it("SheetJS solo se carga bajo demanda: ningún import estático de xlsx", () => {
    for (const f of ARCHIVOS) expect(fuente(f), f).not.toMatch(/from "xlsx"/);
  });

  it("no hay colores sueltos: solo los tokens del tema", () => {
    for (const f of ARCHIVOS.filter((x) => x.endsWith(".tsx"))) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|blue|yellow|gray|slate|zinc|amber|emerald|white|black|orange)\b/);
    }
  });

  it("los textos visibles no nombran los campos crudos de la API ni de la base", () => {
    for (const f of ARCHIVOS.filter((x) => x.endsWith(".tsx") || x.endsWith("vista-compras.ts") || x.endsWith("vista-flujo.ts") || x.endsWith("matriz.ts") || x.endsWith("vista-huecos.ts") || x.endsWith("vista-importar.ts") || x.endsWith("formato.ts"))) {
      const c = sinComentarios(fuente(f)).replace(/Pick<[^>]*>/g, "");
      const literales = [...c.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      for (const literal of literales) {
        const t = literal.replace(/\$\{[^}]*\}/g, "");
        // Los nombres de propiedad de la API aparecen entre comillas solo como claves de código (`"imi_min"`); un texto de pantalla no debe llevarlos.
        if (/^[a-z_]+$/.test(t)) continue;
        expect(t, `${f}: «${t}»`).not.toMatch(/\b(?:imi_min|imi_max|pct_directo|ingreso_inferido|sin_registrar|sin_respaldo|recepciones_registradas|saldo_n_meses|k_prima|carga_id|revision)\b/);
      }
    }
  });

  it("los textos de pantalla llaman «ingreso» a lo que la API llama recepción", () => {
    for (const f of ["detalle-compra", "dialogo-ingreso", "pestana-conciliacion"]) {
      const c = sinComentarios(fuente(`src/components/compras/${f}.tsx`));
      const literales = [...c.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      for (const t of literales) if (!/^[a-z_]+$/.test(t)) expect(t, `${f}: «${t}»`).not.toMatch(/\brecepci[oó]n(es)? (a confirmar|por confirmar)\b|\bConfirmar recepci[oó]n\b/i);
    }
  });
});

describe("menú y acceso por rol", () => {
  const compras = NAV_SECTIONS.find((s) => s.title === "Compras");

  it("la sección Compras trae Huecos, Flujo mensual y Compras, sin pendiente y para los tres roles", () => {
    expect(compras?.roles).toEqual(["admin", "planner", "comprador"]);
    expect(compras?.links.map((l) => [l.href, l.label])).toEqual([
      ["/compras", "Huecos"],
      ["/compras/flujo", "Flujo mensual"],
      ["/compras/registro", "Compras"],
    ]);
    for (const l of compras?.links ?? []) {
      expect(l.pendiente).toBeUndefined();
      expect(l.roles).toBeUndefined();
    }
  });

  it("los tres roles ven la sección y pueden abrir las tres rutas, también por URL directa", () => {
    for (const rol of ["admin", "planner", "comprador"] as const) {
      expect(seccionesVisibles(rol).find((s) => s.title === "Compras")?.links).toHaveLength(3);
      for (const ruta of ["/compras", "/compras/flujo", "/compras/registro", "/compras/registro/"]) expect(puedeVerRuta(rol, ruta), `${rol} ${ruta}`).toBe(true);
    }
  });

  it("«Huecos» solo se marca activo en la ruta exacta; las otras, también en sus subrutas", () => {
    const [huecos, flujo, registro] = compras!.links;
    expect(esActivo("/compras", huecos)).toBe(true);
    expect(esActivo("/compras/flujo", huecos)).toBe(false);
    expect(esActivo("/compras/flujo", flujo)).toBe(true);
    expect(esActivo("/compras/registro", registro)).toBe(true);
  });

  it("las secciones de planificación siguen vedadas al comprador", () => {
    expect(puedeVerRuta("comprador", "/planificacion/proyeccion")).toBe(false);
    expect(puedeVerRuta("comprador", "/maestros/intercompany")).toBe(false);
  });
});
