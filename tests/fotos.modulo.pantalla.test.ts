import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { abrirImagen, ErrorFoto } from "../src/components/fotos/comprimir";
import { FotosLinea } from "../src/components/fotos/fotos-linea";
import { LimpiezaHuerfanas } from "../src/components/fotos/limpieza-huerfanas";
import { SelectorFotos } from "../src/components/fotos/selector-fotos";
import { TarjetaLineaFotos } from "../src/components/fotos/tarjeta-linea-fotos";
import {
  ajustarContadores,
  consultaFotos,
  etiquetaProveedorFotos,
  hayFiltrosFotos,
  leerParametrosFotos,
  paginacion,
  PARAMETROS_FOTOS_VACIOS,
  textoConfirmarLimpieza,
  textoContador,
  textoPaginacion,
  textoResultadoLimpieza,
  textoSinLineas,
  textoVistaPreviaLimpieza,
  titularLinea,
  urlFotosModulo,
} from "../src/components/fotos/vista-fotos";
import { Field, Input, Select } from "../src/components/ui/form";
import { DialogoConfirmar } from "../src/components/ui/dialogo-confirmar";
import { hrefComprasDeProveedor } from "../src/components/proveedores/vista-proveedores";
import { consultaCompras, leerParametrosCompras, PARAMETROS_COMPRAS_VACIOS } from "../src/components/compras/vista-compras";
import { MENSAJE_FORMATO_NO_COMPATIBLE } from "../src/lib/fotos/cliente";
import { NAV_SECTIONS, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";
import type { FotosModuloApi, LineaConFotosApi } from "../src/lib/fotos/tipos-api";

/**
 * Compras → Fotos (08c, §4.3; hito E1): lógica pura (filtros, URL de la API con `viaje_id` explícito, contadores, paginación, limpieza),
 * render de la tarjeta por rol y por estado, los pulidos de QA (reintento de `createImageBitmap`, ✕ de 44 px con confirmación del kit,
 * `aria-describedby` del error de `Field`, `aria-label` fuera del `<p>`, «Ver sus compras» sin el viaje activo) y la estructura de la página.
 * Datos inventados.
 */

const RAIZ = path.resolve(__dirname, "..");
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** `<Field …>hijos</Field>` sin JSX: los hijos entran como `children`. */
const campo = (props: { label: string; hint?: string; error?: string }, ...hijos: ReactNode[]) => (createElement as (...a: unknown[]) => ReactElement)(Field, props, ...hijos);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

function linea(n: number, sobre: Partial<LineaConFotosApi> = {}, fotos = 0): LineaConFotosApi {
  return {
    compra: { id: `c0000000-0000-4000-8000-00000000000${n}`, numero: `C-00010${n}`, estado: "confirmada", proveedor: { id: U1, nombre: "Feria Sur" }, viaje: { id: U2, codigo: "V-01", nombre: "Feria otoño", estado: "abierto" } },
    linea: {
      id: `l0000000-0000-4000-8000-00000000000${n}`,
      tipo: "especifica",
      gml: { genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", etiqueta: "HOMBRE · URBANO · DENIM" },
      marca: "BETA",
      agrupacion_marca: "PREMIUM",
      tallas: "centrales",
      unidades: 300,
      costo_unitario: 4.2,
      moneda: "USD",
      descripcion: "Jean slim azul medio",
      modelo: "DL-2231",
    },
    fotos: Array.from({ length: fotos }, (_, i) => ({ id: `f0000000-0000-4000-8000-0000000000${n}${i}`, miniatura_url: `/api/compras/fotos/f${n}${i}/miniatura`, subida_por_nombre: "Ana", at: "2026-11-02T15:00:00.000Z" })),
    fotos_en_cancelada: 0,
    puede: { subir: true, quitar: true, editar_ficha: true },
    ...sobre,
  };
}

describe("filtros de la URL y consulta a la API", () => {
  it("lee y descarta lo inválido: uuid, origen, estado, página y texto", () => {
    const get = (m: Record<string, string>) => (k: string) => m[k] ?? null;
    expect(leerParametrosFotos(get({}))).toEqual(PARAMETROS_FOTOS_VACIOS);
    const p = leerParametrosFotos(get({ proveedor: U1, origen: "carga_inicial", estado: "cancelada", sin_foto: "1", q: "jean", pagina: "3" }));
    expect(p).toEqual({ proveedor: U1, origen: "carga_inicial", estado: "cancelada", soloSinFoto: true, q: "jean", pagina: 3 });
    const mal = leerParametrosFotos(get({ proveedor: "x", origen: "otro", estado: "zzz", sin_foto: "0", pagina: "-2", q: "a".repeat(300) }));
    expect(mal).toMatchObject({ proveedor: null, origen: null, estado: null, soloSinFoto: false, pagina: 1 });
    expect(mal.q).toHaveLength(100);
    expect(leerParametrosFotos(get({ pagina: "1.5" })).pagina).toBe(1);
  });

  it("la URL de la pantalla es vacía por defecto y se lee igual que se escribe", () => {
    expect(consultaFotos(PARAMETROS_FOTOS_VACIOS)).toBe("");
    const p = { proveedor: U1, origen: "intercompany_cd" as const, estado: "borrador" as const, soloSinFoto: true, q: "azul", pagina: 2 };
    const q = new URLSearchParams(consultaFotos(p));
    expect(leerParametrosFotos((k) => q.get(k))).toEqual(p);
    expect(consultaFotos({ ...p, pagina: 1 })).not.toContain("pagina");
  });

  it("hayFiltrosFotos: la página y el viaje no cuentan como filtro", () => {
    expect(hayFiltrosFotos(PARAMETROS_FOTOS_VACIOS)).toBe(false);
    expect(hayFiltrosFotos({ ...PARAMETROS_FOTOS_VACIOS, pagina: 4 })).toBe(false);
    expect(hayFiltrosFotos({ ...PARAMETROS_FOTOS_VACIOS, soloSinFoto: true })).toBe(true);
    expect(hayFiltrosFotos({ ...PARAMETROS_FOTOS_VACIOS, q: "  " })).toBe(false);
  });

  it("la consulta manda SIEMPRE `viaje_id` explícito (todos, sin_viaje o uuid) y los filtros con los nombres de la API", () => {
    for (const v of ["todos", "sin_viaje", U2]) {
      const u = new URL(urlFotosModulo(PARAMETROS_FOTOS_VACIOS, v), "http://x");
      expect(u.pathname).toBe("/api/compras/fotos");
      expect(u.searchParams.get("viaje_id")).toBe(v);
      expect(u.searchParams.get("pagina")).toBe("1");
      expect(u.searchParams.get("por_pagina")).toBe("20");
      expect(u.searchParams.has("solo_sin_foto")).toBe(false);
    }
    const u = new URL(urlFotosModulo({ proveedor: U1, origen: "comprador", estado: "cancelada", soloSinFoto: true, q: "  jean ", pagina: 2 }, U2), "http://x");
    expect(Object.fromEntries(u.searchParams)).toEqual({ viaje_id: U2, proveedor_id: U1, origen: "comprador", estado: "cancelada", solo_sin_foto: "1", q: "jean", pagina: "2", por_pagina: "20" });
  });
});

describe("textos", () => {
  it("el contador dice «8 de 12 líneas con foto»", () => {
    expect(textoContador({ lineas: 12, con_foto: 8 })).toBe("8 de 12 líneas con foto");
    expect(textoContador({ lineas: 1, con_foto: 0 })).toBe("0 de 1 línea con foto");
    expect(textoContador({ lineas: 1200, con_foto: 3 })).toBe("3 de 1,200 líneas con foto");
  });

  it("el selector de proveedor: «Feria Sur · 12 líneas · 4 sin foto» o «todas con foto»", () => {
    expect(etiquetaProveedorFotos({ id: U1, nombre: "Feria Sur", lineas: 12, sin_foto: 4 })).toBe("Feria Sur · 12 líneas · 4 sin foto");
    expect(etiquetaProveedorFotos({ id: U1, nombre: "Feria Sur", lineas: 1, sin_foto: 0 })).toBe("Feria Sur · 1 línea · todas con foto");
  });

  it("el titular es el género · mundo · línea o «Lote BETA al barrer»", () => {
    expect(titularLinea(linea(1).linea)).toBe("HOMBRE · URBANO · DENIM");
    expect(titularLinea({ ...linea(1).linea, gml: null, tipo: "barrer_marca" })).toBe("Lote BETA al barrer");
    expect(titularLinea({ ...linea(1).linea, gml: null, marca: null, tipo: "barrer_marca" })).toBe("Lote al barrer");
  });

  it("paginación: rangos, acotada a la última página y vacía sin líneas", () => {
    expect(paginacion(45, 1, 20)).toEqual({ pagina: 1, paginas: 3, desde: 1, hasta: 20, hayAnterior: false, haySiguiente: true });
    expect(paginacion(45, 3, 20)).toMatchObject({ desde: 41, hasta: 45, hayAnterior: true, haySiguiente: false });
    expect(paginacion(45, 99, 20).pagina).toBe(3);
    expect(paginacion(0, 5, 20)).toEqual({ pagina: 1, paginas: 1, desde: 0, hasta: 0, hayAnterior: false, haySiguiente: false });
    expect(textoPaginacion(paginacion(45, 2, 20), 45)).toBe("Líneas 21–40 de 45 · página 2 de 3");
    expect(textoPaginacion(paginacion(0, 1, 20), 0)).toBe("Sin líneas");
  });

  it("los vacíos explican qué filtra (viaje activo, «Solo sin foto» o nada cargado)", () => {
    expect(textoSinLineas(false, false, false).titulo).toBe("Todavía no hay compras.");
    expect(textoSinLineas(false, true, false).titulo).toBe("Ninguna línea en el viaje activo.");
    expect(textoSinLineas(true, true, false).detalle).toContain("viaje activo");
    expect(textoSinLineas(true, false, true).detalle).toContain("Quita «Solo sin foto»");
  });
});

describe("contadores corregidos en el sitio al subir o quitar fotos", () => {
  const base = (): Pick<FotosModuloApi, "contadores" | "por_proveedor" | "lineas"> => ({
    contadores: { lineas: 12, con_foto: 8, sin_foto: 4 },
    por_proveedor: [
      { id: U1, nombre: "Feria Sur", lineas: 12, sin_foto: 4 },
      { id: U2, nombre: "Otro", lineas: 5, sin_foto: 5 },
    ],
    lineas: [linea(1, {}, 0), linea(2, {}, 2), linea(3, { compra: { ...linea(3).compra, proveedor: { id: U2, nombre: "Otro" } } }, 0)],
  });

  it("sin cambios devuelve lo mismo", () => {
    const d = base();
    const r = ajustarContadores(d, {});
    expect(r.contadores).toEqual(d.contadores);
    expect(r.por_proveedor).toEqual(d.por_proveedor);
  });

  it("una línea sin foto que recibe una suma a «con foto» y resta a «sin foto» (también la de su proveedor)", () => {
    const r = ajustarContadores(base(), { [linea(1).linea.id]: 1 });
    expect(r.contadores).toEqual({ lineas: 12, con_foto: 9, sin_foto: 3 });
    expect(r.por_proveedor.map((p) => p.sin_foto)).toEqual([3, 5]);
  });

  it("una línea que se queda sin su única foto resta a «con foto»; la que pasa de 2 a 1 no cambia nada", () => {
    const r = ajustarContadores(base(), { [linea(2).linea.id]: 0 });
    expect(r.contadores).toEqual({ lineas: 12, con_foto: 7, sin_foto: 5 });
    expect(r.por_proveedor.map((p) => p.sin_foto)).toEqual([5, 5]);
    expect(ajustarContadores(base(), { [linea(2).linea.id]: 1 }).contadores.con_foto).toBe(8);
  });

  it("nunca pasa de las líneas ni baja de 0, y suma por proveedor distinto", () => {
    const lleno = { ...base(), contadores: { lineas: 12, con_foto: 12, sin_foto: 0 } };
    expect(ajustarContadores(lleno, { [linea(1).linea.id]: 1 }).contadores).toEqual({ lineas: 12, con_foto: 12, sin_foto: 0 });
    const r = ajustarContadores(base(), { [linea(1).linea.id]: 1, [linea(3).linea.id]: 3 });
    expect(r.contadores.con_foto).toBe(10);
    expect(r.por_proveedor.map((p) => p.sin_foto)).toEqual([3, 4]);
  });
});

describe("limpieza de huérfanas (admin)", () => {
  it("la vista previa dice cuántas hay de cada tipo y de hace cuánto", () => {
    expect(textoVistaPreviaLimpieza({ sin_fila: 3, quitadas: 1, horas: 24 })).toBe("3 sin registro y 1 de fotos quitadas, de hace más de 24 h.");
    expect(textoVistaPreviaLimpieza({ sin_fila: 2, quitadas: 0, horas: 24 })).toBe("2 sin registro, de hace más de 24 h.");
    expect(textoVistaPreviaLimpieza({ sin_fila: 0, quitadas: 0, horas: 24 })).toBe("No hay fotos huérfanas para limpiar.");
  });

  it("la confirmación avisa que no se deshace y el resultado cuenta los fallidos", () => {
    expect(textoConfirmarLimpieza({ sin_fila: 3, quitadas: 1, horas: 24 })).toContain("4 archivos huérfanos");
    expect(textoConfirmarLimpieza({ sin_fila: 1, quitadas: 0, horas: 24 })).toContain("1 archivo huérfano");
    expect(textoConfirmarLimpieza({ sin_fila: 1, quitadas: 0, horas: 24 })).toContain("No se puede deshacer");
    expect(textoResultadoLimpieza({ borrados: 4, fallidos: 0 })).toBe("Se borraron 4 archivos huérfanos.");
    expect(textoResultadoLimpieza({ borrados: 1, fallidos: 2 })).toContain("2 no se pudieron borrar");
  });

  it("el diálogo arranca revisando (el GET se pide al montar) y no borra nada por sí solo", () => {
    const h = html(createElement(LimpiezaHuerfanas, { onCerrar: () => {} }));
    expect(h).toContain("Limpiar fotos huérfanas");
    expect(h).toContain("Revisando…");
    expect(h).toContain("Borrar…");
    expect(h).not.toContain("Sí, borrar");
  });

  it("el fuente: GET para la vista previa, POST con `confirmar: true`, paso de confirmación y errores en Alert", () => {
    const f = fuente("src/components/fotos/limpieza-huerfanas.tsx");
    expect(f).toMatch(/api\s*\.get<LimpiezaFotosApi>\(URL_LIMPIAR\)/);
    expect(f).toContain("api.post<ResultadoLimpiezaFotosApi>(URL_LIMPIAR, { confirmar: true })");
    expect(f).toContain('setPaso("confirmar")');
    expect(f).toMatch(/\{error && <Alert/);
  });
});

describe("tarjeta de línea en Compras → Fotos", () => {
  it("muestra compra, proveedor, GML, marca, tallas, unidades, costo, descripción y modelo", () => {
    const h = html(createElement(TarjetaLineaFotos, { item: linea(1), esAdmin: false }));
    for (const t of ["C-000101", "Feria Sur", "HOMBRE · URBANO · DENIM", "BETA", "Tallas centrales", "300 u", "USD 4.20", "Jean slim azul medio · modelo DL-2231", "Cámara", "Galería", "Sin foto", "0/3"]) expect(h, t).toContain(t);
    expect(h).toContain("Editar descripción y modelo");
  });

  it("un lote al barrer sale como «Lote BETA al barrer» y una línea con fotos dice «Con foto»", () => {
    const l = linea(2, {}, 2);
    const h = html(createElement(TarjetaLineaFotos, { item: { ...l, linea: { ...l.linea, tipo: "barrer_marca", gml: null, costo_unitario: null } }, esAdmin: false }));
    expect(h).toContain("Lote BETA al barrer");
    expect(h).toContain("sin costo");
    expect(h).toContain("Con foto");
    expect(h).toContain("2/3");
    expect(h).toContain("Quitar foto 2");
  });

  it("el enlace a la compra no queda recortado por el viaje activo", () => {
    expect(html(createElement(TarjetaLineaFotos, { item: linea(1), esAdmin: false }))).toContain("?compra=c0000000-0000-4000-8000-000000000001&amp;viaje=todos");
  });

  it("compra cancelada: solo lectura para el comprador; el admin ve la ✕ pero no [Cámara]", () => {
    const c = linea(1, { compra: { ...linea(1).compra, estado: "cancelada" }, puede: { subir: false, quitar: false, editar_ficha: false } }, 1);
    const comprador = html(createElement(TarjetaLineaFotos, { item: c, esAdmin: false }));
    expect(comprador).toContain("Compra cancelada: solo lectura");
    expect(comprador).toContain("Cancelada");
    for (const t of ["Cámara", "Galería", "Quitar foto", "Editar descripción", "Traer fotos"]) expect(comprador, t).not.toContain(t);
    const admin = html(createElement(TarjetaLineaFotos, { item: { ...c, puede: { subir: false, quitar: true, editar_ficha: false } }, esAdmin: true }));
    expect(admin).toContain("Quitar foto 1");
    expect(admin).not.toContain("Cámara");
  });

  it("«Traer fotos» solo aparece si la API dice que hay algo que traer (fotos_en_cancelada) y entra en la cuenta del botón", () => {
    expect(html(createElement(TarjetaLineaFotos, { item: linea(1), esAdmin: false }))).not.toContain("Traer fotos");
    const h = html(createElement(TarjetaLineaFotos, { item: linea(1, { fotos_en_cancelada: 2 }), esAdmin: false }));
    expect(h).toContain("Traer fotos de la versión cancelada (2)");
    // Sin lugar para más fotos no tiene sentido ofrecerlo.
    expect(html(createElement(TarjetaLineaFotos, { item: linea(1, { fotos_en_cancelada: 2 }, 3), esAdmin: false }))).not.toContain("Traer fotos");
  });

  it("`puede.editar_ficha` falso oculta «Editar» aunque se pueda subir", () => {
    const h = html(createElement(TarjetaLineaFotos, { item: linea(1, { puede: { subir: true, quitar: true, editar_ficha: false } }), esAdmin: false }));
    expect(h).not.toContain("Editar descripción");
    expect(h).toContain("Cámara");
  });
});

describe("pulidos de QA", () => {
  it("la ✕ de quitar tiene área táctil de 44 px y pide confirmación con el kit, no con confirm() nativo", () => {
    const h = html(createElement(FotosLinea, { compraId: "c", lineaId: "l", fotos: linea(1, {}, 1).fotos, etiqueta: "línea 1" }));
    const boton = h.match(/<button[^>]*aria-label="Quitar foto 1, línea 1"[^>]*>/)?.[0] ?? "";
    expect(boton).toContain("h-11");
    expect(boton).toContain("w-11");
    const f = fuente("src/components/fotos/fotos-linea.tsx");
    expect(f).toContain("<DialogoConfirmar");
    expect(f).not.toMatch(/\bconfirm\(/);
  });

  it("DialogoConfirmar: título, mensaje y dos botones de 44 px, el de confirmar en rojo", () => {
    const h = html(createElement(DialogoConfirmar, { titulo: "Quitar foto", mensaje: "¿Quitar esta foto?", confirmar: "Quitar", onConfirmar: () => {}, onCancelar: () => {} }));
    for (const t of ["Quitar foto", "¿Quitar esta foto?", "Cancelar", "Quitar", "h-11!", "text-alerta"]) expect(h, t).toContain(t);
    expect(html(createElement(DialogoConfirmar, { titulo: "T", mensaje: "M", ocupado: true, onConfirmar: () => {}, onCancelar: () => {} }))).toContain("Un momento…");
  });

  it("Field enlaza el mensaje de error con el control (aria-describedby y aria-invalid), también con un datalist al lado", () => {
    const h = html(campo({ label: "Nombre", error: "Ya existe" }, createElement(Input, { defaultValue: "x" })));
    const id = h.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(h).toContain(`id="${id}"`);
    expect(h).toContain('aria-invalid="true"');
    const sel = html(campo({ label: "País", error: "Elige uno" }, createElement(Select, { "aria-describedby": "ayuda", defaultValue: "" })));
    expect(sel).toMatch(/aria-describedby="ayuda [^"]+"/);
    const conLista = html(campo({ label: "Puerto", error: "Largo" }, createElement(Input, { list: "p" }), createElement("datalist", { id: "p" })));
    expect(conLista.match(/aria-describedby/g)).toHaveLength(1);
    expect(conLista).not.toMatch(/<datalist[^>]*aria-/);
  });

  it("Field sin error no agrega atributos de más", () => {
    const h = html(campo({ label: "Nombre", hint: "Ayuda" }, createElement(Input)));
    expect(h).not.toContain("aria-describedby");
    expect(h).not.toContain("aria-invalid");
    expect(h).toContain("Ayuda");
  });

  it("el cupo agotado se lee con texto solo para lectores (sr-only), no con aria-label en un <p>", () => {
    const h = html(createElement(SelectorFotos, { activas: 3, cupo: 0, etiqueta: "línea 1", onElegir: () => {} }));
    expect(h).not.toMatch(/<p[^>]*aria-label/);
    expect(h).toContain("sr-only");
    expect(h).toContain("línea 1: 3/3 fotos, ya no caben más");
  });

  it("createImageBitmap: si rechaza `imageOrientation`, reintenta sin opciones antes de decir «Formato no compatible»", async () => {
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    const archivo = new Blob(["x"], { type: "image/jpeg" });
    const soloSinOpciones = vi.fn(async (_a: Blob, opciones?: ImageBitmapOptions) => {
      if (opciones) throw new TypeError("opción no soportada");
      return bitmap;
    });
    expect(await abrirImagen(archivo, soloSinOpciones as unknown as typeof createImageBitmap)).toBe(bitmap);
    expect(soloSinOpciones).toHaveBeenCalledTimes(2);
    expect(soloSinOpciones.mock.calls[0][1]).toEqual({ imageOrientation: "from-image" });
    expect(soloSinOpciones.mock.calls[1]).toHaveLength(1);

    const bien = vi.fn(async () => bitmap);
    await abrirImagen(archivo, bien as unknown as typeof createImageBitmap);
    expect(bien).toHaveBeenCalledTimes(1);

    const nunca = vi.fn(async () => {
      throw new Error("no es imagen");
    });
    await expect(abrirImagen(archivo, nunca as unknown as typeof createImageBitmap)).rejects.toThrow(MENSAJE_FORMATO_NO_COMPATIBLE);
    await expect(abrirImagen(archivo, nunca as unknown as typeof createImageBitmap)).rejects.toBeInstanceOf(ErrorFoto);
    expect(nunca).toHaveBeenCalledTimes(4);
  });

  it("«Ver sus compras» del proveedor pide todos los viajes y el registro lo respeta sin tocar la preferencia", () => {
    const href = hrefComprasDeProveedor(U1);
    expect(href).toBe(`/compras/registro?proveedor=${U1}&viaje=todos`);
    const q = new URL(href, "http://x").searchParams;
    const p = leerParametrosCompras((k) => q.get(k));
    expect(p).toMatchObject({ proveedor: U1, todosLosViajes: true });
    expect(consultaCompras(p)).toContain("viaje=todos");
    expect(leerParametrosCompras(() => null).todosLosViajes).toBe(false);
    expect(consultaCompras(PARAMETROS_COMPRAS_VACIOS)).toBe("");
    expect(leerParametrosCompras((k) => (k === "viaje" ? "otro" : null)).todosLosViajes).toBe(false);
    const panel = fuente("src/app/(app)/compras/registro/registro-panel.tsx");
    expect(panel).toContain("const ignoraViajeActivo = parametros.todosLosViajes");
    expect(panel).toContain("...(ignoraViajeActivo && { viaje_id: undefined })");
  });
});

describe("estructura de /compras/fotos", () => {
  it("la página es un server component mínimo: perfil, redirect, cookie del viaje y el panel", () => {
    const c = fuente("src/app/(app)/compras/fotos/page.tsx");
    expect(c).not.toContain('"use client"');
    expect(c).toContain("perfilActual()");
    expect(c).toContain('redirect("/")');
    expect(c).toContain("<FotosPanel rol={r.rol}");
    expect(c).toContain("export const metadata");
    expect(c).toContain("<Suspense");
    expect(fuente("src/app/(app)/compras/fotos/fotos-panel.tsx").startsWith('"use client"')).toBe(true);
  });

  it("los datos van por /api; el viaje viaja explícito; la limpieza es solo del admin; nada de Supabase ni fetch directo", () => {
    const panel = fuente("src/app/(app)/compras/fotos/fotos-panel.tsx");
    expect(panel).toContain("urlFotosModulo(parametros, viaje)");
    expect(panel).toMatch(/\{esAdmin && \(\s*<div/);
    expect(panel).toContain("Limpiar fotos huérfanas");
    expect(panel).toContain("<BarraViajeActiva");
    for (const f of ["src/app/(app)/compras/fotos/fotos-panel.tsx", "src/components/fotos/limpieza-huerfanas.tsx", "src/components/fotos/tarjeta-linea-fotos.tsx", "src/components/fotos/vista-fotos.ts"]) {
      const c = fuente(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("el menú trae «Fotos» sin pendiente y sin restricción de rol: los tres roles la abren", () => {
    const item = NAV_SECTIONS.find((s) => s.title === "Compras")?.links.find((l) => l.href === "/compras/fotos");
    expect(item).toMatchObject({ label: "Fotos" });
    expect(item?.pendiente).toBeUndefined();
    expect(item?.roles).toBeUndefined();
    for (const rol of ["admin", "planner", "comprador"] as const) {
      expect(seccionesVisibles(rol).find((s) => s.title === "Compras")?.links.map((l) => l.label)).toContain("Fotos");
      expect(puedeVerRuta(rol, "/compras/fotos"), rol).toBe(true);
    }
  });
});
