import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResumenCrecimientos, TablaResumenCrecimientos } from "../src/app/(app)/planificacion/proyeccion/crecimientos-tab";
import { ContenidoVentaPorTienda, TablaVentaPorTienda, VentaPorTienda } from "../src/app/(app)/planificacion/proyeccion/venta-por-tienda";
import type { ProyeccionApi } from "../src/lib/proyeccion/tipos-api";
import { proyeccion } from "./proyeccion.pantalla.fixture";
import { resumenCrecimientos } from "./proyeccion.crecimientos-pantalla.fixture";
import {
  ventaConMesFaltante,
  ventaConSinBloque,
  ventaMetodoAnterior,
  ventaMujerUrbano,
  ventaResto,
  ventaSinAtribuir,
  ventaRestoSinFilas,
  ventaSinFilas,
} from "./proyeccion.venta-por-tienda-pantalla.fixture";

/**
 * Lo que `useLectura` devuelve en las pruebas de la tarjeta: `null` deja la lectura real (en un render de servidor no llega a leer: queda «cargando»).
 * Así se prueban los estados de carga, error y datos sin red ni efectos.
 */
type Lectura = { datos: unknown; cargando: boolean; error: string | null; codigo: string | null };
const falsa: { valor: Lectura | null; url: string | null } = { valor: null, url: null };
vi.mock("../src/app/(app)/planificacion/proyeccion/use-proyeccion", async (original) => {
  const real = await original<typeof import("../src/app/(app)/planificacion/proyeccion/use-proyeccion")>();
  return {
    ...real,
    useLectura: (url: string | null, ...resto: unknown[]) => {
      falsa.url = url;
      return falsa.valor ? { ...falsa.valor, setError: () => {}, recargar: () => Promise.resolve() } : (real.useLectura as (u: string | null, ...r: unknown[]) => unknown)(url, ...resto);
    },
  };
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const RAIZ = path.resolve(__dirname, "..");
const DIR = "src/app/(app)/planificacion/proyeccion/";
const fuente = (f: string) => readFileSync(path.join(RAIZ, DIR, f), "utf8");
const deshabilitado = (tag: string | undefined) => /\sdisabled(=""|\s|>)/.test(tag ?? "");
const boton = (s: string, texto: string) => new RegExp(`<button[^>]*>${texto}</button>`).exec(s)?.[0];

const OPCIONES = [
  { clave: "g-hombre.m-formal", nombre: "HOMBRE · FORMAL" },
  { clave: "g-hombre.m-urbano", nombre: "HOMBRE · URBANO" },
  { clave: "resto", nombre: "Resto" },
];

const tarjeta = (extra: Partial<Parameters<typeof VentaPorTienda>[0]> = {}, p: ProyeccionApi = proyeccion()) =>
  html(createElement(VentaPorTienda, { proyeccion: p, clave: "g-hombre.m-urbano", opciones: OPCIONES, puedeRecalcular: true, onClave: noop, onCerrar: noop, onRecalcular: noop, ...extra }));

beforeEach(() => {
  falsa.valor = null;
  falsa.url = null;
});

describe("la tabla de venta por tienda", () => {
  const s = html(createElement(TablaVentaPorTienda, { datos: ventaMujerUrbano() }));

  it("las columnas de la ficha: tienda, años con su variación, ene–set (las dos), cierre vigente y su variación", () => {
    for (const c of ["Tienda", "2023", "2024", "2025", "2025 ene–set", "2026 ene–set (real)", "2026 cierre vigente", "solo unidades"]) expect(s).toContain(c);
    expect(s.match(/>Var\.</g)).toHaveLength(4);
    expect(s).toContain("vs 2025 ene–set");
  });

  it("las filas: tiendas de la base, subtotal Σ B con su marca, fuera con su subtotal y el total", () => {
    for (const t of ["Tienda T01", "Tienda T02", "Tienda T03", "Tienda T10", "Tienda T04", "Tienda T11", "Tienda T09"]) expect(s).toContain(t);
    expect(s).toContain("Base 2027 · mismas tiendas de 2027 (4)");
    expect(s).toContain("15,600 u");
    expect(s).toContain("= base de la tabla de arriba");
    expect(s).toContain("Fuera de la base (3)");
    expect(s).toContain("Total MUJER · URBANO (todas las tiendas, sin CD)");
    expect(s).not.toContain("CD1");
    expect(s).not.toContain("Sin atribuir a tienda");
  });

  it("cada celda lleva unidades y soles; el vigente, real + proyectado y «estimado» salvo el exacto", () => {
    expect(s).toContain("6,000 u");
    expect(s).toContain("S/ 480,000");
    expect(s).toContain("S/ 380,000");
    expect(s).toContain("8,400 u");
    expect(s).toContain("real 6,000 + proy. 2,400 · estimado");
    expect(s).toContain("real 1,200 + proy. 400");
    expect(s).toContain("real 400 + proy. 300");
    expect(s.match(/proy\. \d[\d,]* · estimado/g)).toHaveLength(3);
  });

  it("variaciones en u y S/, con sus motivos y la comparable de los subtotales", () => {
    expect(s).toContain("+20.0 % u");
    expect(s).toContain("+26.3 % S/");
    expect(s).toContain("-8.3 % u");
    expect(s).toContain("+27.3 % u");
    expect(s).toContain(">nueva<");
    expect(s).toContain(">parcial<");
    expect(s).toContain("+31.8 % u");
    expect(s).toContain("comparable +17.6 % u");
    expect(s).toContain("El subtotal incluye T10, sin 2025 ene–set completo");
    expect(s).toContain("«Comparable»: la misma variación sin las tiendas que no estuvieron abiertas todo el periodo.");
  });

  it("cada tienda dice por qué está en la base o fuera de ella (insignia, título y texto)", () => {
    for (const t of [">misma<", ">entra<", ">sale<", ">abrió en 2026<", ">cerrada<"]) expect(s).toContain(t);
    expect(s).toContain('title="Misma tienda de 2026 y de 2027"');
    expect(s).toContain("Abrió en nov 2025: entra en la base de 2027 con su 2026 vigente");
    expect(s).toContain("Cierra el 30 jun 2027: su 2026 sale de la base");
    expect(s).toContain("Abrió en may 2026: en 2027 va aparte (nueva del año anterior); entra en la base de 2028");
    expect(s).toContain("Cerró el 31 ago 2024");
    expect(s).toContain("Su 2026 sale de la base (B2); no se reparte por tienda.");
  });

  it("nota de la base: el estimado se reparte por el real ene–set y cuadra con la base", () => {
    expect(s).toContain("«Estimado»: el resto de la base se reparte entre las mismas tiendas en proporción a su real ene–set");
    expect(s).toContain("cuadra exacto con la base de 2027");
  });

  it("la tabla se desplaza dentro de su contenedor, es solo lectura y usa solo tokens del tema", () => {
    expect(s).toContain("overflow-x-auto");
    expect(s).toContain('aria-label="Venta por tienda y año de MUJER · URBANO"');
    expect(s).not.toContain("<input");
    expect(s).not.toContain("<button");
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,6}|\b(bg|text|border)-(red|green|blue|gray|slate|white|black)-?\d*/);
  });

  it("«Sin atribuir a tienda» aparece cuando hay algo que no se reparte", () => {
    const x = html(createElement(TablaVentaPorTienda, { datos: ventaSinAtribuir() }));
    expect(x).toContain("Sin atribuir a tienda");
    expect(x).toContain("14,000 u");
    expect(x).toContain("no se reparte entre tiendas");
  });

  it("mes faltante: el badge «faltan: mar 2024» va en la cabecera y las variaciones salen «incompleto»", () => {
    const x = html(createElement(TablaVentaPorTienda, { datos: ventaConMesFaltante() }));
    expect(x).toContain("faltan: mar 2024");
    expect(x).toContain(">incompleto<");
    expect(s).not.toContain("faltan:");
  });

  it("método anterior: no hay columna de vigente ni nota del estimado", () => {
    const x = html(createElement(TablaVentaPorTienda, { datos: ventaMetodoAnterior() }));
    expect(x).not.toContain("cierre vigente");
    expect(x).not.toContain("Estimado");
    expect(x.match(/>Var\.</g)).toHaveLength(3);
    expect(x).toContain("6,000 u");
  });

  it("el Resto se ve igual, sin tiendas de fuera", () => {
    const x = html(createElement(TablaVentaPorTienda, { datos: ventaResto() }));
    expect(x).toContain("Total Resto (todas las tiendas, sin CD)");
    expect(x).not.toContain("Fuera de la base");
  });
});

describe("el contenido de la tarjeta", () => {
  const contenido = (datos = ventaMujerUrbano(), p: Pick<ProyeccionApi, "desactualizada"> = { desactualizada: [] }, extra: Partial<Parameters<typeof ContenidoVentaPorTienda>[0]> = {}) =>
    html(createElement(ContenidoVentaPorTienda, { datos, proyeccion: p, ...extra }));

  it("cabecera con la base, de qué tiendas sale y la leyenda con el corte", () => {
    const s = contenido();
    expect(s).toContain("<strong>Base 2027 = 15,600 u</strong>");
    expect(s).toContain("<strong>vigentes</strong>");
    expect(s).toContain("<strong>mismas tiendas de 2027 (4 tiendas: abiertas los doce meses de 2026)</strong>");
    expect(s).toContain("base corregida del Niño (16,400 u)");
    expect(s).toContain("Soles netos de IGV. Sin CD. Datos hasta set 2026.");
  });

  it("muestra los avisos de la API tal como vienen", () => {
    const v = ventaMujerUrbano();
    const s = contenido(v);
    expect(v.avisos.length).toBeGreaterThan(0);
    for (const a of v.avisos) expect(s).toContain(a.mensaje);
    expect(s).toContain("1 fila sin curva vendió 150 u en 2026: no entran en la base y sí en el real por tienda.");
    const sb = ventaConSinBloque();
    const x = contenido(sb);
    for (const a of sb.avisos) expect(x).toContain(a.mensaje);
    expect(x).toContain("T12 no existía al calcular la proyección");
    const falt = ventaConMesFaltante();
    expect(contenido(falt)).toContain("Faltan cargas de venta publicadas: mar 2024");
    const sa = ventaSinAtribuir();
    expect(contenido(sa)).toContain("Se muestran en «Sin atribuir a tienda»");
  });

  it("avisa que la proyección cambió de datos y ofrece Recalcular solo si se puede", () => {
    const cambiada = { desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] } as unknown as Pick<ProyeccionApi, "desactualizada">;
    const con = contenido(ventaMujerUrbano(), cambiada, { puedeRecalcular: true, onRecalcular: noop });
    expect(con).toContain("La proyección cambió de datos después de calcular: el real por tienda es el de hoy; recalcula para que el reparto use la misma venta");
    expect(con).toContain(">Recalcular</button>");
    expect(contenido(ventaMujerUrbano(), cambiada, { puedeRecalcular: false, onRecalcular: noop })).not.toContain("<button");
    expect(contenido()).not.toContain("cambió de datos");
  });

  it("H6: la leyenda de los motivos y el «Estimado» se ven bajo la tabla (sin depender del hover)", () => {
    const c = contenido(ventaMujerUrbano());
    expect(c).toContain("Variación sin %:");
    expect(c).toContain("«nueva» no vendió en el periodo anterior");
    expect(c).toContain("«parcial» la tienda no estuvo abierta todo uno de los dos periodos");
    expect(c).toContain("«Estimado»: el resto de la base se reparte");
  });

  it("método anterior y sin filas: los mensajes de la ficha", () => {
    expect(contenido(ventaMetodoAnterior())).toContain("Recalcula la proyección para ver la base 2027");
    expect(contenido(ventaSinFilas())).toContain("Este GM no tiene filas base en 2027");
    expect(contenido(ventaRestoSinFilas())).toContain("El Resto no tiene filas base en 2027");
    expect(contenido(ventaRestoSinFilas())).not.toContain("Este GM");
  });
});

describe("la tarjeta «Venta por tienda»", () => {
  it("cargando: título del conjunto, selector con los GM y el Resto, Cerrar y el Excel deshabilitado", () => {
    const s = tarjeta();
    expect(s).toContain("Venta por tienda · HOMBRE · URBANO");
    expect(s).toContain("Leyendo la venta por tienda…");
    expect(s).toContain('aria-busy="true"');
    expect(s).toMatch(/<option value="g-hombre\.m-urbano" selected="">HOMBRE · URBANO<\/option>/);
    expect(s).toContain('<option value="resto">Resto</option>');
    expect(s).toContain(">Cerrar</button>");
    expect(deshabilitado(boton(s, "Descargar Excel"))).toBe(true);
  });

  it("la tarjeta «Resto» sin filas base dice «El Resto no tiene filas base», no «Este GM»", () => {
    falsa.valor = { datos: ventaRestoSinFilas(), cargando: false, error: null, codigo: null };
    const s = tarjeta({ clave: "resto" });
    expect(s).toContain("Venta por tienda · Resto");
    expect(s).toContain("El Resto no tiene filas base en 2027");
    expect(s).not.toContain("Este GM no tiene filas base");
  });

  it("lee la ruta del contrato con el conjunto en `gm` y nada más", () => {
    tarjeta();
    expect(falsa.url).toBe("/api/proyeccion/proyecciones/proy-1/crecimientos/por-tienda?gm=g-hombre.m-urbano");
    tarjeta({ clave: "resto" });
    expect(falsa.url).toBe("/api/proyeccion/proyecciones/proy-1/crecimientos/por-tienda?gm=resto");
  });

  it("con datos: cabecera, tabla y el Excel habilitado", () => {
    falsa.valor = { datos: ventaMujerUrbano(), cargando: false, error: null, codigo: null };
    const s = tarjeta({ clave: "g-hombre.m-urbano" });
    expect(s).toContain("Base 2027 = 15,600 u");
    expect(s).toContain("Total MUJER · URBANO");
    expect(s).not.toContain("Leyendo la venta por tienda");
    expect(deshabilitado(boton(s, "Descargar Excel"))).toBe(false);
    expect(s).toContain('aria-busy="false"');
  });

  it("errores de la API: el mensaje siempre se muestra; calculo_en_curso ofrece actualizar y sin_calcular, calcular", () => {
    falsa.valor = { datos: null, cargando: false, error: "El cálculo está en curso. Espera a que termine.", codigo: "calculo_en_curso" };
    const a = tarjeta();
    expect(a).toContain("El cálculo está en curso. Espera a que termine.");
    expect(a).toContain('role="alert"');
    expect(a).toContain(">Actualizar pantalla</button>");
    expect(a).not.toContain("Leyendo la venta por tienda");
    expect(deshabilitado(boton(a, "Descargar Excel"))).toBe(true);

    falsa.valor = { datos: null, cargando: false, error: "Calcula la proyección para ver la venta por tienda", codigo: "sin_calcular" };
    const b = tarjeta();
    expect(b).toContain("Calcula la proyección para ver la venta por tienda");
    expect(b).toContain(">Calcular</button>");
    expect(tarjeta({ puedeRecalcular: false })).not.toContain(">Calcular</button>");

    for (const [codigo, mensaje] of [["gm_no_encontrado", "Ese género y mundo no existen."], ["genero_no_detallado", "Ese género va en el Resto: usa gm=resto"], [null, "Error 500"]] as const) {
      falsa.valor = { datos: null, cargando: false, error: mensaje, codigo };
      expect(tarjeta()).toContain(mensaje);
    }
  });
});

describe("«Ver por tienda» en la tabla de Crecimientos", () => {
  const datos = resumenCrecimientos();
  const con = html(createElement(TablaResumenCrecimientos, { datos, onVerPorTienda: noop, porTiendaActiva: "g-hombre.m-urbano" }));

  it("un botón por GM y uno en el Resto; el Total no lo tiene; sigue «Analizar y aprobar»", () => {
    expect(con.match(/>Ver por tienda</g)).toHaveLength(5);
    expect(con).toContain('aria-label="Ver por tienda HOMBRE · FORMAL"');
    expect(con).toContain('aria-label="Ver por tienda Resto"');
    expect(con).not.toContain("Ver por tienda Total");
    expect(con.match(/>Analizar y aprobar</g)).toHaveLength(5);
  });

  it("H5: el botón va en la primera columna (bajo el nombre), no en la última: se ve en el móvil sin desplazar", () => {
    const filaHombre = con.slice(con.indexOf("HOMBRE · FORMAL"));
    const iBoton = filaHombre.indexOf('aria-label="Ver por tienda HOMBRE · FORMAL"');
    expect(iBoton).toBeGreaterThan(-1);
    // Está en la primera celda de la fila; la última (el enlace «Analizar y aprobar») ya no lo trae.
    const celdas = filaHombre.split("</td>");
    expect(celdas[0]).toContain('aria-label="Ver por tienda HOMBRE · FORMAL"');
    expect(celdas[celdas.length - 2] ?? "").not.toContain("Ver por tienda");
  });

  it("marca el conjunto abierto (aria-pressed) y solo ese", () => {
    expect(con.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(/aria-label="Ver por tienda HOMBRE · URBANO"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Ver por tienda HOMBRE · URBANO"/.test(con)).toBe(true);
  });

  it("sin el manejador la tabla sigue siendo de solo lectura pura", () => {
    const sin = html(createElement(TablaResumenCrecimientos, { datos }));
    expect(sin).not.toContain("Ver por tienda");
    expect(sin).not.toContain("<button");
  });

  it("el resumen monta la tarjeta debajo de la tabla cuando hay un conjunto elegido, y no la monta sin él", () => {
    const base = { datos, proyeccion: proyeccion(), bloqueada: false, onRecalcular: noop, onRecargar: noop, onObjetivoGuardado: () => Promise.resolve(), onPorTienda: noop };
    const abierto = html(createElement(ResumenCrecimientos, { ...base, porTienda: "resto" }));
    expect(abierto).toContain("Venta por tienda · Resto");
    expect(abierto.indexOf("Venta por tienda · Resto")).toBeGreaterThan(abierto.indexOf("Total (mismas tiendas)"));
    expect(abierto.indexOf("Venta por tienda · Resto")).toBeLessThan(abierto.indexOf("Puente al Total 2027"));
    expect(html(createElement(ResumenCrecimientos, { ...base, porTienda: null }))).not.toContain("Venta por tienda ·");
    const desconocido = html(createElement(ResumenCrecimientos, { ...base, porTienda: "x-1.y-2" }));
    expect(desconocido).toContain("Ese género · mundo no tiene filas en esta proyección");
    expect(desconocido).not.toContain("Venta por tienda ·");
  });
});

describe("estructura (patrones obligatorios)", () => {
  it("la tarjeta lee con useLectura, no escribe nada y no habla con Supabase ni con fetch", () => {
    for (const f of ["venta-por-tienda.tsx", "venta-por-tienda-vista.ts"]) {
      const c = fuente(f);
      expect(c, f).not.toMatch(/@supabase|\bfetch\(|api\.(post|put|patch|delete|get)|useAccion|useColeccion/);
      expect(c, f).not.toMatch(/\.toFixed\(|es-ES/);
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,6}\b|\b(bg|text|border)-(red|green|blue|gray|slate|white|black)-?\d*/);
    }
    const t = fuente("venta-por-tienda.tsx");
    expect(t.startsWith('"use client"')).toBe(true);
    expect(t).toContain("useLectura<VentaPorTiendaApi>");
    expect(t).toContain("/crecimientos/por-tienda?gm=");
    expect(t).toContain("<AlertaError");
    expect(t).toContain("descargarLibro");
  });

  it("la vista es pura (sin React) y usa la lógica del backend en lugar de copiarla", () => {
    const v = fuente("venta-por-tienda-vista.ts");
    expect(v).not.toMatch(/from "react"|"use client"/);
    expect(v).toContain('from "@/lib/proyeccion/venta-por-tienda"');
    for (const f of ["variacionesDeCifras", "paresVariacion", "periodoCompleto"]) expect(v).toContain(f);
  });

  it("el panel lleva `por_tienda` en la URL y lo borra al cambiar de pestaña o de proyección", () => {
    const p = fuente("proyeccion-panel.tsx");
    expect(p).toContain('params.get("por_tienda")');
    expect(p).toContain("clavePorTiendaValida(porTiendaUrl)");
    expect(p).toMatch(/function cambiarPestana\(p: Pestana\) \{\s*cambiarUrl\(\{[^}]*por_tienda: null/);
    expect(p).toMatch(/function elegirProyeccion\(id: string\) \{\s*cambiarUrl\(\{[^}]*por_tienda: null/);
    expect(p).toMatch(/onPorTienda=\{\(clave\) => cambiarUrl\(\{ por_tienda: clave \}\)\}/);
  });

  it("la pestaña no abre ninguna acción de escritura nueva: el único PATCH sigue siendo el objetivo", () => {
    const c = fuente("crecimientos-tab.tsx");
    expect(c.match(/api\.(post|put|patch|delete)/g)).toEqual(["api.patch"]);
    expect(fuente("use-proyeccion.ts")).toContain("codigoDeError");
  });

  it("no hay filtro por rol en la tarjeta: la ven los tres roles que lleguen a la pantalla (el guard es el de la página)", () => {
    expect(fuente("venta-por-tienda.tsx")).not.toMatch(/\brol\b|esAdmin|puedeEditar/);
    expect(fuente("page.tsx")).toContain("puedeEditarMaestros(r.rol)");
  });
});
