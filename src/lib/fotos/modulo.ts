import type { Rol } from "@/lib/auth/roles";
import type { ViajeResumenApi } from "@/lib/compras/agrupadores/tipos-api";
import type { NodoInfo } from "@/lib/arbol/nivel/indice";
import { ESTADOS_COMPRA, MONEDAS, TALLAS_COMPRA, TIPOS_LINEA, type EstadoCompra, type Moneda, type TallasCompra, type TipoLinea } from "@/lib/compras/tipos";
import { POR_PAGINA_FOTOS_DEFECTO } from "./constantes";
import { urlMiniatura } from "./rutas";
import type { FotosModuloApi, LineaConFotosApi, NombreGml, ProveedorFotosApi } from "./tipos-api";

/**
 * Compras → Fotos (08c, §3.3 y §4.3): de las filas planas de la base a `FotosModuloApi`. Puro, sin reloj y sin base. El servicio
 * (`servicio-modulo.ts`) lee las filas YA filtradas por viaje, compra, origen, estado y proveedor; aquí se aplican «solo sin foto», la
 * búsqueda, los contadores, el selector de proveedores y la paginación.
 */

export type CompraFotos = { id: string; numero: string; estado: string; proveedor_id: string; viaje_id: string | null; fecha_compra: string; moneda: string };
export type LineaFotos = {
  id: string;
  compra_id: string;
  tipo: string;
  genero_mundo_linea_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  tallas: string;
  unidades: number;
  costo_unitario: number | null;
  descripcion: string | null;
  modelo: string | null;
  created_at: string;
};
export type FotoActivaFotos = { id: string; linea_id: string; subida_por_nombre: string | null; created_at: string };

export type NombresFotos = {
  nodos: ReadonlyMap<string, Pick<NodoInfo, "genero" | "mundo" | "linea" | "ruta">>;
  marcas: ReadonlyMap<string, string>;
  agrupaciones: ReadonlyMap<string, string>;
};

export type EntradaFotosModulo = {
  compras: readonly CompraFotos[];
  lineas: readonly LineaFotos[];
  fotos: readonly FotoActivaFotos[];
  proveedores: ReadonlyMap<string, string>;
  viajes: ReadonlyMap<string, ViajeResumenApi>;
  nombres: NombresFotos;
  rol: Rol;
  /** Filtro del proveedor elegido: la lista y los contadores lo respetan; `por_proveedor`, no. */
  proveedor_id?: string | undefined;
  solo_sin_foto: boolean;
  q?: string | undefined;
  pagina?: number | undefined;
  por_pagina?: number | undefined;
};

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const elegir = <T extends string>(validos: readonly T[], v: string, defecto: T): T => (validos as readonly string[]).includes(v) ? (v as T) : defecto;

/** Minúsculas y sin tildes: «Jeán» coincide con «jean». */
export const normalizarBusqueda = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();

/**
 * Lo que puede hacer quien mira una tarjeta. Todos los roles suben, quitan y editan la ficha en una compra viva (§9 B3); en una compra
 * CANCELADA todo queda en solo lectura salvo que el admin retire una foto equivocada (`quitar_foto_linea`, I7).
 */
export function permisosLineaFoto(estado: string, rol: Rol): LineaConFotosApi["puede"] {
  const viva = estado !== "cancelada";
  return { subir: viva, quitar: viva || rol === "admin", editar_ficha: viva };
}

/** El nodo de una línea específica; `null` si es un lote o el nodo ya no está en el catálogo. */
function gmlDe(id: string | null, nombres: NombresFotos): NombreGml | null {
  if (id === null) return null;
  const n = nombres.nodos.get(id);
  return n ? { genero: n.genero, mundo: n.mundo, linea: n.linea, etiqueta: n.ruta } : null;
}

type Armada = { api: LineaConFotosApi; texto: string; proveedor_id: string; con_foto: boolean };

/** Arma las tarjetas en su orden: compra más reciente primero (`fecha_compra` y `numero` descendentes) y, dentro, la línea más antigua primero. */
function armarTarjetas(e: EntradaFotosModulo): Armada[] {
  const compras = new Map(e.compras.map((c) => [c.id, c]));
  const fotosDe = new Map<string, FotoActivaFotos[]>();
  for (const f of e.fotos) fotosDe.set(f.linea_id, [...(fotosDe.get(f.linea_id) ?? []), f]);
  const salida: { compra: CompraFotos; linea: LineaFotos; armada: Armada }[] = [];
  for (const l of e.lineas) {
    const c = compras.get(l.compra_id);
    if (!c) continue;
    const fotos = [...(fotosDe.get(l.id) ?? [])].sort((a, b) => comparar(a.created_at, b.created_at) || comparar(a.id, b.id));
    const estado: EstadoCompra = elegir(ESTADOS_COMPRA, c.estado, "confirmada");
    const tipo: TipoLinea = elegir(TIPOS_LINEA, l.tipo, "especifica");
    const tallas: TallasCompra = elegir(TALLAS_COMPRA, l.tallas, "ambas");
    const moneda: Moneda = elegir(MONEDAS, c.moneda, "PEN");
    const marca = l.marca_id ? (e.nombres.marcas.get(l.marca_id) ?? null) : null;
    const agrupacion = l.agrupacion_marca_id ? (e.nombres.agrupaciones.get(l.agrupacion_marca_id) ?? null) : null;
    const gml = gmlDe(l.genero_mundo_linea_id, e.nombres);
    const proveedor = e.proveedores.get(c.proveedor_id) ?? "—";
    const api: LineaConFotosApi = {
      compra: { id: c.id, numero: c.numero, estado, proveedor: { id: c.proveedor_id, nombre: proveedor }, viaje: c.viaje_id ? (e.viajes.get(c.viaje_id) ?? null) : null },
      linea: {
        id: l.id,
        tipo,
        gml,
        marca,
        agrupacion_marca: agrupacion,
        tallas,
        unidades: l.unidades,
        costo_unitario: l.costo_unitario === null ? null : Number(l.costo_unitario),
        moneda,
        descripcion: l.descripcion,
        modelo: l.modelo,
      },
      fotos: fotos.map((f) => ({ id: f.id, miniatura_url: urlMiniatura(f.id), subida_por_nombre: f.subida_por_nombre, at: f.created_at })),
      fotos_en_cancelada: 0,
      puede: permisosLineaFoto(c.estado, e.rol),
    };
    const texto = normalizarBusqueda([c.numero, proveedor, marca, agrupacion, gml?.etiqueta, l.descripcion, l.modelo].filter((x): x is string => !!x).join(" "));
    salida.push({ compra: c, linea: l, armada: { api, texto, proveedor_id: c.proveedor_id, con_foto: fotos.length > 0 } });
  }
  salida.sort(
    (a, b) =>
      comparar(b.compra.fecha_compra, a.compra.fecha_compra) ||
      comparar(b.compra.numero, a.compra.numero) ||
      comparar(a.linea.created_at, b.linea.created_at) ||
      comparar(a.linea.id, b.linea.id),
  );
  return salida.map((x) => x.armada);
}

/** `FotosModuloApi` de lo leído. `fotos_en_cancelada` queda en 0: lo llena el servicio solo para las líneas de la página. */
export function armarFotosModulo(e: EntradaFotosModulo): FotosModuloApi {
  const todas = armarTarjetas(e);
  const q = e.q ? normalizarBusqueda(e.q) : "";
  const buscadas = q === "" ? todas : todas.filter((t) => t.texto.includes(q));

  // Selector de proveedores: el conjunto con viaje, origen, estado y búsqueda, SIN el proveedor elegido (si no, solo mostraría uno).
  const porProveedor = new Map<string, ProveedorFotosApi>();
  for (const t of buscadas) {
    const fila = porProveedor.get(t.proveedor_id) ?? { id: t.proveedor_id, nombre: t.api.compra.proveedor.nombre, lineas: 0, sin_foto: 0 };
    fila.lineas += 1;
    if (!t.con_foto) fila.sin_foto += 1;
    porProveedor.set(t.proveedor_id, fila);
  }

  const delProveedor = e.proveedor_id === undefined ? buscadas : buscadas.filter((t) => t.proveedor_id === e.proveedor_id);
  const conFoto = delProveedor.filter((t) => t.con_foto).length;
  const lista = e.solo_sin_foto ? delProveedor.filter((t) => !t.con_foto) : delProveedor;

  const porPagina = e.por_pagina ?? POR_PAGINA_FOTOS_DEFECTO;
  const pagina = e.pagina ?? 1;
  const desde = (pagina - 1) * porPagina;
  return {
    contadores: { lineas: delProveedor.length, con_foto: conFoto, sin_foto: delProveedor.length - conFoto },
    por_proveedor: [...porProveedor.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || comparar(a.id, b.id)),
    lineas: lista.slice(desde, desde + porPagina).map((t) => t.api),
    pagina,
    por_pagina: porPagina,
    total: lista.length,
  };
}
