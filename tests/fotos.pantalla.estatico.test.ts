import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DetalleCompra } from "../src/components/compras/detalle-compra";
import { FichaLinea } from "../src/components/fotos/ficha-linea";
import { FotosLinea } from "../src/components/fotos/fotos-linea";
import { SelectorFotos } from "../src/components/fotos/selector-fotos";
import { NAV_SECTIONS, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";
import type { FotoLineaApi } from "../src/lib/fotos/tipos-api";
import { compraApiC12Parcial, compraApiCancelada } from "./compras.fixture";

/**
 * Estructura de las pantallas de 08c (T3a, E1): proveedores y fotos de las líneas. Patrones obligatorios del frontend (página mínima de
 * servidor + panel de cliente, datos solo por /api, kit de UI, confirm en lo destructivo, errores con Alert), la subida multipart por
 * `api.subir`, el menú y los textos clave de las tarjetas con los tres roles. Sin datos reales.
 */

const RAIZ = path.resolve(__dirname, "..");
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function archivosDe(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((f) => {
    const ruta = `${dir}/${f}`;
    if (statSync(path.join(RAIZ, ruta)).isDirectory()) return archivosDe(ruta);
    return /\.(ts|tsx)$/.test(f) ? [ruta] : [];
  });
}

const ARCHIVOS = [
  ...archivosDe("src/components/fotos"),
  ...archivosDe("src/components/proveedores"),
  ...archivosDe("src/app/(app)/compras/proveedores"),
  "src/lib/fotos/use-fotos.ts",
  "src/lib/fotos/cliente.ts",
];

describe("estructura", () => {
  it("la página de Proveedores es un server component mínimo: perfil, redirect y el panel con el rol", () => {
    const c = fuente("src/app/(app)/compras/proveedores/page.tsx");
    expect(c).not.toContain('"use client"');
    expect(c).toContain("perfilActual()");
    expect(c).toContain('redirect("/")');
    expect(c).toContain("<ProveedoresPanel rol={r.rol}");
    expect(c).toContain("export const metadata");
    expect(fuente("src/app/(app)/compras/proveedores/proveedores-panel.tsx").startsWith('"use client"')).toBe(true);
  });

  it("ningún archivo habla con Supabase ni usa fetch directo: todo va por /api con `api`, `useColeccion` o `useLectura`", () => {
    for (const f of ARCHIVOS) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("sin colores sueltos: solo los tokens del tema (el único color literal es el blanco del fondo del canvas JPEG)", () => {
    for (const f of ARCHIVOS.filter((x) => x.endsWith(".tsx"))) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|gray|grey|slate|zinc|neutral|amber|yellow|orange|emerald|rose|sky)-\d{2,3}/);
    }
    const comprimir = sinComentarios(fuente("src/components/fotos/comprimir.ts"));
    expect([...comprimir.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual(["#ffffff"]);
  });

  it("toda acción destructiva pide confirmación: quitar foto, desactivar, eliminar y recargar una ficha que se pisa", () => {
    // Quitar una foto usa la confirmación del kit (QA E1, hallazgo 9), no el `confirm()` nativo.
    const quitar = fuente("src/components/fotos/fotos-linea.tsx");
    expect(quitar).toMatch(/<DialogoConfirmar[\s\S]*¿Quitar esta foto\? Quedará registrado que la quitaste\./);
    expect(quitar).not.toMatch(/\bconfirm\(/);
    const d = fuente("src/components/proveedores/detalle-proveedor.tsx");
    expect(d).toMatch(/confirm\(aviso\)/);
    expect(d).toMatch(/confirm\(`¿Eliminar «\$\{ficha\.nombre\}»\?/);
    expect(fuente("src/components/proveedores/formulario-proveedor.tsx")).toContain("confirm(");
  });

  it("los errores de la API se muestran con Alert, nunca se tragan", () => {
    for (const f of ["src/components/fotos/fotos-linea.tsx", "src/components/fotos/ficha-linea.tsx", "src/components/fotos/visor-foto.tsx", "src/components/proveedores/formulario-proveedor.tsx", "src/components/proveedores/detalle-proveedor.tsx", "src/components/proveedores/historial-proveedor.tsx", "src/components/proveedores/selector-proveedor.tsx", "src/app/(app)/compras/proveedores/proveedores-panel.tsx"]) {
      expect(fuente(f), f).toContain("<Alert");
    }
  });

  it("la subida va por `api.subir` con un FormData de las partes `foto` y `miniatura`, de una en una, sin Content-Type propio", () => {
    const h = sinComentarios(fuente("src/lib/fotos/use-fotos.ts"));
    expect(h).toContain("new FormData()");
    expect(h).toContain('cuerpo.append("foto"');
    expect(h).toContain('cuerpo.append("miniatura"');
    expect(h).toMatch(/api\.subir<FotoLineaApi>\(urlFotos\(compraId, lineaId\), cuerpo\)/);
    expect(h).toContain("cola.current.then(");
    expect(h).not.toMatch(/Content-Type/i);
    // El cliente `api.subir` está en api-client y no fija `Content-Type` para este cuerpo.
    expect(sinComentarios(fuente("src/lib/api-client.ts"))).toMatch(/subir: <T>\(url: string, cuerpo: FormData/);
  });

  it("la reducción en el navegador usa la orientación EXIF explícita y los límites del servidor", () => {
    const c = sinComentarios(fuente("src/components/fotos/comprimir.ts"));
    expect(c).toContain('imageOrientation: "from-image"');
    expect(c).toContain("LADO_MAX_FOTO");
    expect(c).toContain("LADO_MAX_MINIATURA");
    expect(c).toContain('"image/jpeg"');
    expect(c).toContain("CALIDADES_FOTO");
  });

  it("[Cámara] abre la trasera con `capture` y [Galería] deja elegir varias; ambas ≥ 44 px", () => {
    const c = fuente("src/components/fotos/selector-fotos.tsx");
    expect(c).toContain('capture="environment"');
    expect(c).toMatch(/accept="image\/\*" multiple/);
    expect(c.match(/h-11!/g)?.length).toBe(2);
  });
});

describe("menú y rutas", () => {
  const compras = NAV_SECTIONS.find((s) => s.title === "Compras");

  it("Proveedores está en la sección Compras, sin pendiente y sin restricción de rol, y los tres roles abren la ruta (también por URL directa)", () => {
    const l = compras?.links.find((x) => x.href === "/compras/proveedores");
    expect(l?.label).toBe("Proveedores");
    expect(l?.pendiente).toBeUndefined();
    expect(l?.roles).toBeUndefined();
    for (const rol of ["admin", "planner", "comprador"] as const) {
      expect(puedeVerRuta(rol, "/compras/proveedores")).toBe(true);
      expect(puedeVerRuta(rol, "/compras/proveedores/")).toBe(true);
      expect(seccionesVisibles(rol).find((s) => s.title === "Compras")?.links.some((x) => x.href === "/compras/proveedores")).toBe(true);
    }
  });

  it("todo item del menú sin `pendiente` tiene su página: no hay menús que lleven a un 404 (Fotos, Galería, Proformas y Directorio se registran con su pantalla)", () => {
    for (const l of NAV_SECTIONS.flatMap((s) => s.links).filter((x) => !x.pendiente)) {
      const ruta = l.href === "/" ? "src/app/(app)/page.tsx" : `src/app/(app)${l.href}/page.tsx`;
      expect(existsSync(path.join(RAIZ, ruta)), `${l.label} → ${ruta}`).toBe(true);
    }
  });

  it("la API de proveedores y de fotos que usan las pantallas existe como ruta", () => {
    for (const r of [
      "src/app/api/compras/proveedores/route.ts",
      "src/app/api/compras/proveedores/[id]/route.ts",
      "src/app/api/compras/proveedores/[id]/activo/route.ts",
      "src/app/api/compras/proveedores/[id]/historial/route.ts",
      "src/app/api/compras/[id]/lineas/[lineaId]/fotos/route.ts",
      "src/app/api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]/route.ts",
      "src/app/api/compras/[id]/lineas/[lineaId]/fotos/traer/route.ts",
      "src/app/api/compras/[id]/lineas/[lineaId]/ficha/route.ts",
      "src/app/api/compras/fotos/[fotoId]/route.ts",
      "src/app/api/compras/fotos/[fotoId]/miniatura/route.ts",
    ]) expect(existsSync(path.join(RAIZ, r)), r).toBe(true);
  });
});

const foto = (n: number): FotoLineaApi => ({ id: `00000000-0000-4000-8000-00000000000${n}`, miniatura_url: `/api/compras/fotos/00000000-0000-4000-8000-00000000000${n}/miniatura`, ancho: 800, alto: 600, subida_por: { nombre: "Comprador Uno", at: "2026-10-02T15:00:00.000Z" } });
const ids = { compraId: "10000000-0000-4000-8000-000000000001", lineaId: "20000000-0000-4000-8000-000000000001" };

describe("tarjeta de fotos de la línea", () => {
  it("sin fotos: [Cámara], [Galería], el contador 0/3 y «Traer fotos de la versión cancelada»", () => {
    const h = html(createElement(FotosLinea, { ...ids, fotos: [], etiqueta: "línea 1" }));
    for (const t of ["Esta línea todavía no tiene fotos.", "Cámara", "Galería", "0/3", "Traer fotos de la versión cancelada", 'capture="environment"']) expect(h, t).toContain(t);
  });

  it("con dos fotos: miniaturas con su ✕ para quitar y el contador 2/3", () => {
    const h = html(createElement(FotosLinea, { ...ids, fotos: [foto(1), foto(2)], etiqueta: "línea 1" }));
    expect(h).toContain("/miniatura");
    expect(h).toContain("Quitar foto 1, línea 1");
    expect(h).toContain("Quitar foto 2, línea 1");
    expect(h).toContain("2/3");
    expect(h).toContain("Ver foto 1 de 2");
  });

  it("con las tres fotos desaparecen los botones y se lee «3/3»", () => {
    const h = html(createElement(FotosLinea, { ...ids, fotos: [foto(1), foto(2), foto(3)], etiqueta: "línea 1" }));
    expect(h).toContain("3/3");
    expect(h).not.toContain("Cámara");
    expect(h).not.toContain("Galería");
    expect(h).not.toContain("Traer fotos");
  });

  it("compra cancelada: solo lectura para el comprador (ni botones ni ✕); el admin ve la ✕ para quitar una foto equivocada", () => {
    const comprador = html(createElement(FotosLinea, { ...ids, fotos: [foto(1)], etiqueta: "línea 1", compraCancelada: true }));
    expect(comprador).toContain("Compra cancelada: solo lectura");
    expect(comprador).not.toContain("Cámara");
    expect(comprador).not.toContain("Quitar foto");
    const admin = html(createElement(FotosLinea, { ...ids, fotos: [foto(1)], etiqueta: "línea 1", compraCancelada: true, esAdmin: true }));
    expect(admin).toContain("Quitar foto 1");
    expect(admin).not.toContain("Cámara");
  });

  it("el selector con el cupo agotado dice «3/3»", () => {
    expect(html(createElement(SelectorFotos, { activas: 3, cupo: 0, etiqueta: "línea 1", onElegir: () => {} }))).toContain("3/3");
  });
});

describe("descripción y modelo de la línea", () => {
  it("se leen con «Editar» y, sin datos, dicen «Sin descripción ni modelo»", () => {
    const con = html(createElement(FichaLinea, { ...ids, descripcion: "Jean slim azul medio", modelo: "DL-2231", editable: true, etiqueta: "línea 1" }));
    expect(con).toContain("Jean slim azul medio · modelo DL-2231");
    expect(con).toContain("Editar descripción y modelo de línea 1");
    const sin = html(createElement(FichaLinea, { ...ids, descripcion: null, modelo: null, editable: true, etiqueta: "línea 1" }));
    expect(sin).toContain("Sin descripción ni modelo");
    expect(html(createElement(FichaLinea, { ...ids, descripcion: null, modelo: null, editable: false, etiqueta: "línea 1" }))).not.toContain("Editar");
  });
});

describe("detalle de la compra con fotos (prop `fotos`)", () => {
  const props = { puedeEscribir: false, onConfirmarIngreso: () => {}, onQuitarIngreso: () => {}, onCancelar: () => {} };

  it("el COMPRADOR (sin permisos de escritura de M8) igual sube fotos y edita la descripción, y no ve las acciones de M8", () => {
    const h = html(createElement(DetalleCompra, { ...props, compra: compraApiC12Parcial(), fotos: { esAdmin: false } }));
    for (const t of ["Cámara", "Galería", "Editar descripción y modelo de línea 1", "Fotos de línea 1"]) expect(h, t).toContain(t);
    for (const t of ["Confirmar ingreso", "Cancelar compra"]) expect(h, t).not.toContain(t);
  });

  it("sin la prop `fotos` el detalle es el de M8 (el comprador no ve ningún botón)", () => {
    const h = html(createElement(DetalleCompra, { ...props, compra: compraApiC12Parcial() }));
    expect(h).not.toContain("<button");
    expect(h).not.toContain("Cámara");
  });

  it("una compra cancelada no admite fotos nuevas ni edición de la ficha", () => {
    const h = html(createElement(DetalleCompra, { ...props, compra: compraApiCancelada(), fotos: { esAdmin: false } }));
    expect(h).toContain("Compra cancelada: solo lectura");
    expect(h).not.toContain("Cámara");
    expect(h).not.toContain("Editar descripción y modelo");
  });

  it("muestra las fotos que trae la línea", () => {
    const c = compraApiC12Parcial();
    c.lineas[0] = { ...c.lineas[0], fotos_activas: [foto(1), foto(2)] };
    const h = html(createElement(DetalleCompra, { ...props, compra: c, fotos: { esAdmin: false } }));
    expect(h).toContain("2/3");
    expect(h).toContain("Quitar foto 2, línea 1");
  });
});
