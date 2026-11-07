import { ESTADOS_COMPRA, ORIGENES_COMPRA, type EstadoCompra, type OrigenCompra } from "@/lib/compras/tipos";
import { plural } from "@/lib/formato";
import type { FotosModuloApi, LimpiezaFotosApi, LineaConFotosApi, ProveedorFotosApi } from "@/lib/fotos/tipos-api";

/**
 * Lógica pura de la pantalla Compras → Fotos (08c, §4.3): filtros en la URL, la consulta a `GET /api/compras/fotos` (con el viaje activo
 * como `viaje_id` explícito: la API no lee la cookie), los textos del contador y del selector de proveedor, la paginación, el ajuste local de
 * los contadores cuando alguien sube o quita una foto, y los textos de la limpieza de huérfanas. Sin React ni navegador.
 */

export const POR_PAGINA_FOTOS = 20;

export type ParametrosFotos = {
  proveedor: string | null;
  origen: OrigenCompra | null;
  estado: EstadoCompra | null;
  soloSinFoto: boolean;
  q: string;
  /** Desde 1. */
  pagina: number;
};

export const PARAMETROS_FOTOS_VACIOS: ParametrosFotos = { proveedor: null, origen: null, estado: null, soloSinFoto: false, q: "", pagina: 1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leerParametrosFotos(get: (clave: string) => string | null): ParametrosFotos {
  const proveedor = get("proveedor");
  const origen = get("origen") ?? "";
  const estado = get("estado") ?? "";
  const pagina = Number(get("pagina") ?? "1");
  return {
    proveedor: proveedor !== null && UUID.test(proveedor) ? proveedor : null,
    origen: (ORIGENES_COMPRA as readonly string[]).includes(origen) ? (origen as OrigenCompra) : null,
    estado: (ESTADOS_COMPRA as readonly string[]).includes(estado) ? (estado as EstadoCompra) : null,
    soloSinFoto: get("sin_foto") === "1",
    q: (get("q") ?? "").slice(0, 100),
    pagina: Number.isInteger(pagina) && pagina >= 1 && pagina <= 100_000 ? pagina : 1,
  };
}

/** La parte `?…` de la URL de la pantalla (sin el `?`); vacía si todo está por defecto. */
export function consultaFotos(p: ParametrosFotos): string {
  const q = new URLSearchParams();
  if (p.proveedor) q.set("proveedor", p.proveedor);
  if (p.origen) q.set("origen", p.origen);
  if (p.estado) q.set("estado", p.estado);
  if (p.soloSinFoto) q.set("sin_foto", "1");
  if (p.q.trim() !== "") q.set("q", p.q);
  if (p.pagina > 1) q.set("pagina", String(p.pagina));
  return q.toString();
}

export const hayFiltrosFotos = (p: ParametrosFotos): boolean => p.proveedor !== null || p.origen !== null || p.estado !== null || p.soloSinFoto || p.q.trim() !== "";

/**
 * URL de `GET /api/compras/fotos`. El viaje activo viaja SIEMPRE como `viaje_id` (`todos`, `sin_viaje` o un uuid): sin él la API no filtra
 * por viaje y la pantalla no coincidiría con lo que muestra la barra. La búsqueda de texto va recortada.
 */
export function urlFotosModulo(p: ParametrosFotos, viajeActivo: string, porPagina: number = POR_PAGINA_FOTOS): string {
  const q = new URLSearchParams();
  q.set("viaje_id", viajeActivo);
  if (p.proveedor) q.set("proveedor_id", p.proveedor);
  if (p.origen) q.set("origen", p.origen);
  if (p.estado) q.set("estado", p.estado);
  if (p.soloSinFoto) q.set("solo_sin_foto", "1");
  if (p.q.trim() !== "") q.set("q", p.q.trim());
  q.set("pagina", String(p.pagina));
  q.set("por_pagina", String(porPagina));
  return `/api/compras/fotos?${q.toString()}`;
}

// ─── Textos ───

/** «8 de 12 líneas con foto» (con 1 línea: «1 de 1 línea con foto»). */
export function textoContador(c: { lineas: number; con_foto: number }): string {
  return `${c.con_foto.toLocaleString("es-PE")} de ${c.lineas.toLocaleString("es-PE")} ${c.lineas === 1 ? "línea" : "líneas"} con foto`;
}

/** «Feria Sur · 12 líneas · 4 sin foto» (con todas: «… · todas con foto»). */
export function etiquetaProveedorFotos(p: ProveedorFotosApi): string {
  const sin = p.sin_foto === 0 ? "todas con foto" : `${p.sin_foto.toLocaleString("es-PE")} sin foto`;
  return `${p.nombre} · ${plural(p.lineas, "línea", "líneas")} · ${sin}`;
}

/** «HOMBRE · URBANO · DENIM» o «Lote BETA al barrer». */
export function titularLinea(l: Pick<LineaConFotosApi["linea"], "gml" | "marca" | "tipo">): string {
  if (l.gml) return l.gml.etiqueta;
  return l.marca ? `Lote ${l.marca} al barrer` : "Lote al barrer";
}

/** Costo de la tarjeta: «USD 4,20» o «sin costo». */
export function textoCostoLinea(costo: number | null, moneda: string): string {
  if (costo === null) return "sin costo";
  return `${moneda} ${costo.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const ETIQUETA_TALLAS: Record<string, string> = { centrales: "Tallas centrales", extremas: "Tallas extremas", ambas: "Todas las tallas" };

// ─── Paginación ───

export type Paginacion = { pagina: number; paginas: number; desde: number; hasta: number; hayAnterior: boolean; haySiguiente: boolean };

/** Con `total` 0 → `desde` y `hasta` 0 y una sola página. La página se acota al rango real. */
export function paginacion(total: number, pagina: number, porPagina: number): Paginacion {
  const paginas = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, porPagina)));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const desde = total <= 0 ? 0 : (actual - 1) * porPagina + 1;
  const hasta = total <= 0 ? 0 : Math.min(total, actual * porPagina);
  return { pagina: actual, paginas, desde, hasta, hayAnterior: actual > 1, haySiguiente: actual < paginas };
}

export const textoPaginacion = (p: Paginacion, total: number): string => (total <= 0 ? "Sin líneas" : `Líneas ${p.desde}–${p.hasta} de ${total.toLocaleString("es-PE")} · página ${p.pagina} de ${p.paginas}`);

// ─── Ajuste local de contadores ───

/**
 * Cuando alguien sube o quita fotos en una tarjeta, la lista no se vuelve a pedir (la tarjeta se quedaría sin su subida en curso y, con «Solo
 * sin foto», desaparecería a mitad de trabajo). En su lugar, los contadores se corrigen aquí: `conteos` es cuántas fotos tiene AHORA cada línea
 * de la página (solo las que cambiaron de cantidad). Una línea que pasa de 0 a más de 0 suma a «con foto» (y resta a «sin foto», también la de
 * su proveedor); al revés, lo contrario. Nunca devuelve negativos.
 */
export function ajustarContadores(
  datos: Pick<FotosModuloApi, "contadores" | "por_proveedor" | "lineas">,
  conteos: Readonly<Record<string, number>>,
): { contadores: FotosModuloApi["contadores"]; por_proveedor: ProveedorFotosApi[] } {
  let delta = 0;
  const porProveedor = new Map<string, number>();
  for (const l of datos.lineas) {
    const ahora = conteos[l.linea.id];
    if (ahora === undefined) continue;
    const antes = l.fotos.length > 0;
    const despues = ahora > 0;
    if (antes === despues) continue;
    const d = despues ? 1 : -1;
    delta += d;
    porProveedor.set(l.compra.proveedor.id, (porProveedor.get(l.compra.proveedor.id) ?? 0) + d);
  }
  const lineas = datos.contadores.lineas;
  const conFoto = Math.min(lineas, Math.max(0, datos.contadores.con_foto + delta));
  return {
    contadores: { lineas, con_foto: conFoto, sin_foto: lineas - conFoto },
    por_proveedor: datos.por_proveedor.map((p) => {
      const d = porProveedor.get(p.id) ?? 0;
      return d === 0 ? p : { ...p, sin_foto: Math.min(p.lineas, Math.max(0, p.sin_foto - d)) };
    }),
  };
}

// ─── Limpieza de huérfanas (admin) ───

export const totalHuerfanas = (l: Pick<LimpiezaFotosApi, "sin_fila" | "quitadas">): number => l.sin_fila + l.quitadas;

/** «3 sin registro y 1 de fotos quitadas, de hace más de 24 h», o «No hay fotos huérfanas». */
export function textoVistaPreviaLimpieza(l: LimpiezaFotosApi): string {
  if (totalHuerfanas(l) === 0) return "No hay fotos huérfanas para limpiar.";
  const partes = [l.sin_fila > 0 ? `${l.sin_fila} sin registro` : null, l.quitadas > 0 ? `${l.quitadas} de fotos quitadas` : null].filter((p): p is string => p !== null);
  return `${partes.join(" y ")}, de hace más de ${l.horas} h.`;
}

export function textoConfirmarLimpieza(l: LimpiezaFotosApi): string {
  const n = totalHuerfanas(l);
  return `¿Borrar ${n === 1 ? "1 archivo huérfano" : `${n} archivos huérfanos`} del almacenamiento? No se puede deshacer; las fotos que se ven en las líneas no se tocan.`;
}

export function textoResultadoLimpieza(r: { borrados: number; fallidos: number }): string {
  const base = r.borrados === 1 ? "Se borró 1 archivo huérfano." : `Se borraron ${r.borrados} archivos huérfanos.`;
  return r.fallidos > 0 ? `${base} ${r.fallidos === 1 ? "1 no se pudo borrar" : `${r.fallidos} no se pudieron borrar`}: vuelve a intentarlo.` : base;
}

/** Texto cuando la lista está vacía. */
export function textoSinLineas(filtrado: boolean, viajeFiltra: boolean, soloSinFoto: boolean): { titulo: string; detalle?: string } {
  const aviso = viajeFiltra ? "El viaje activo también filtra: cámbialo arriba o elige «Todos los viajes»." : undefined;
  if (soloSinFoto) return { titulo: "Ninguna línea sin foto con estos filtros.", detalle: aviso ?? "Quita «Solo sin foto» para ver también las que ya tienen." };
  if (filtrado) return { titulo: "Ninguna línea con estos filtros.", detalle: aviso };
  if (viajeFiltra) return { titulo: "Ninguna línea en el viaje activo.", detalle: "Cambia el viaje arriba o elige «Todos los viajes»." };
  return { titulo: "Todavía no hay compras.", detalle: "Se cargan con el importador de carga inicial (Compras → Compras → Importar)." };
}
