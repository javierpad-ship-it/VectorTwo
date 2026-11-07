import type { Rol } from "@/lib/auth/roles";
import { MONEDAS } from "@/lib/compras/tipos";
import { camposFaltantes } from "./completitud";
import { INCOTERMS, type Incoterm } from "./constantes";
import { permisosProveedor } from "./reglas";
import type { ContactoProveedorApi, ProveedorFichaApi, ProveedorListadoApi, ResumenProveedorApi } from "./tipos-api";

/**
 * De las filas de la base a los contratos de la API (08c, §3.2). Puro. NUNCA copia `clave_origen`, `perfil_id` ni datos bancarios: arma
 * cada campo a mano (la prueba R17 recorre la respuesta buscando esas claves).
 */

export type ProveedorFila = {
  id: string;
  codigo: string | null;
  nombre: string;
  pais: string | null;
  region: string | null;
  ciudad: string | null;
  direccion: string | null;
  identificacion: string | null;
  es_intercompany: boolean;
  nota: string | null;
  activo: boolean;
  puerto_embarque: string | null;
  incoterm: string | null;
  moneda: string | null;
  plazo_produccion_dias: number | null;
  plazo_transito_dias: number | null;
  condiciones_pago: string | null;
  revision: number;
  usuario_nombre: string | null;
  created_at: string;
  updated_at: string;
  updated_by_nombre: string | null;
};

export type ContactoFila = {
  id: string;
  proveedor_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  correo: string | null;
  es_principal: boolean;
  orden: number;
  created_at: string;
};

const esIncoterm = (v: string | null): v is Incoterm => v !== null && (INCOTERMS as readonly string[]).includes(v);
const esMoneda = (v: string | null): v is (typeof MONEDAS)[number] => v !== null && (MONEDAS as readonly string[]).includes(v);

/** Los contactos de un proveedor en su orden (`orden`, alta, id). */
export function contactosDe(filas: readonly ContactoFila[]): ContactoProveedorApi[] {
  return [...filas]
    .sort((a, b) => a.orden - b.orden || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
    .map((c) => ({ id: c.id, nombre: c.nombre, cargo: c.cargo, telefono: c.telefono, correo: c.correo, es_principal: c.es_principal }));
}

export function armarListado(p: ProveedorFila, contactos: readonly ContactoFila[], compras: number): ProveedorListadoApi {
  const lista = contactosDe(contactos);
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    pais: p.pais,
    region: p.region,
    ciudad: p.ciudad,
    identificacion: p.identificacion,
    es_intercompany: p.es_intercompany,
    nota: p.nota,
    activo: p.activo,
    puerto_embarque: p.puerto_embarque,
    incoterm: esIncoterm(p.incoterm) ? p.incoterm : null,
    moneda: esMoneda(p.moneda) ? p.moneda : null,
    compras,
    completo: camposFaltantes({ pais: p.pais, identificacion: p.identificacion, direccion: p.direccion, contactos: lista }).length === 0,
    contactos: lista,
  };
}

export function armarFicha(p: ProveedorFila, contactos: readonly ContactoFila[], compras: number, rol: Rol): ProveedorFichaApi {
  const base = armarListado(p, contactos, compras);
  return {
    ...base,
    direccion: p.direccion,
    plazo_produccion_dias: p.plazo_produccion_dias,
    plazo_transito_dias: p.plazo_transito_dias,
    condiciones_pago: p.condiciones_pago,
    faltan: camposFaltantes({ pais: p.pais, identificacion: p.identificacion, direccion: p.direccion, contactos: base.contactos }),
    creado_por: { nombre: p.usuario_nombre, at: p.created_at },
    modificado_por: p.revision > 0 ? { nombre: p.updated_by_nombre, at: p.updated_at } : null,
    revision: p.revision,
    puede: permisosProveedor(rol),
  };
}

export type CompraParaResumen = { id: string; estado: string; fecha_compra: string; moneda: string };
export type LineaParaResumen = { compra_id: string; unidades: number; unidades_canceladas: number; costo_unitario: number | null; activo: boolean };

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resumen de las compras del proveedor: cuántas (no canceladas), la última fecha, las unidades (comprado menos cancelado, líneas activas)
 * y el costo por moneda (unidades × costo de las líneas con costo).
 */
export function armarResumen(compras: readonly CompraParaResumen[], lineas: readonly LineaParaResumen[]): ResumenProveedorApi {
  const vigentes = compras.filter((c) => c.estado !== "cancelada");
  const porId = new Map(vigentes.map((c) => [c.id, c]));
  let unidades = 0;
  const costo = { USD: 0, PEN: 0 };
  for (const l of lineas) {
    const c = porId.get(l.compra_id);
    if (!c || !l.activo) continue;
    const u = Math.max(l.unidades - l.unidades_canceladas, 0);
    unidades += u;
    if (l.costo_unitario !== null && (c.moneda === "USD" || c.moneda === "PEN")) costo[c.moneda] += u * l.costo_unitario;
  }
  const ultima = vigentes.reduce<string | null>((m, c) => (m === null || c.fecha_compra > m ? c.fecha_compra : m), null);
  return { compras: vigentes.length, ultima_compra: ultima, unidades, costo: { USD: redondear2(costo.USD), PEN: redondear2(costo.PEN) } };
}
