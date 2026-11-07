import { ACCIONES_PROVEEDOR, type AccionProveedor } from "./constantes";
import type { CambioProveedorApi, EventoProveedorApi } from "./tipos-api";

/**
 * Historial de un proveedor (08c, §11.P4). Puro: de la fila de `proveedor_eventos` (instantáneas `antes` y `despues`) al detalle campo a
 * campo. Las instantáneas son las de `proveedor_foto`: nunca llevan banco, `clave_origen` ni `revision`.
 */

export type EventoProveedorDb = {
  id: string;
  accion: string;
  antes: unknown;
  despues: unknown;
  resumen: string | null;
  usuario_nombre: string | null;
  created_at: string;
};

export const ETIQUETA_CAMPO_PROVEEDOR: Readonly<Record<string, string>> = {
  nombre: "Nombre",
  codigo: "Código",
  pais: "País",
  region: "Estado o provincia",
  ciudad: "Ciudad",
  direccion: "Dirección",
  identificacion: "RUC / Tax ID",
  es_intercompany: "Intercompany",
  puerto_embarque: "Puerto de embarque",
  incoterm: "Incoterm",
  moneda: "Moneda",
  plazo_produccion_dias: "Plazo de producción (días)",
  plazo_transito_dias: "Plazo de tránsito (días)",
  condiciones_pago: "Condiciones de pago",
  nota: "Nota",
  activo: "Activo",
  contactos: "Contactos",
};

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function texto(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

function contactoATexto(c: unknown): string {
  if (!esObjeto(c)) return "";
  const partes = [texto(c.nombre), texto(c.cargo), texto(c.telefono), texto(c.correo)].filter((p): p is string => p !== null);
  return partes.join(" · ") + (c.es_principal === true ? " (principal)" : "");
}

function contactosATexto(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map(contactoATexto).join(" | ");
}

/** Los campos que cambian entre dos instantáneas, en el orden de `ETIQUETA_CAMPO_PROVEEDOR`. Sin `antes`, lista todo lo que trae `despues` (alta). */
export function cambiosDeProveedor(antes: unknown, despues: unknown): CambioProveedorApi[] {
  const a = esObjeto(antes) ? antes : {};
  const d = esObjeto(despues) ? despues : {};
  const cambios: CambioProveedorApi[] = [];
  for (const campo of Object.keys(ETIQUETA_CAMPO_PROVEEDOR)) {
    const va = campo === "contactos" ? contactosATexto(a[campo]) : texto(a[campo]);
    const vd = campo === "contactos" ? contactosATexto(d[campo]) : texto(d[campo]);
    if (va === vd) continue;
    cambios.push({ campo: ETIQUETA_CAMPO_PROVEEDOR[campo], antes: va, despues: vd });
  }
  return cambios;
}

const esAccion = (v: string): v is AccionProveedor => (ACCIONES_PROVEEDOR as readonly string[]).includes(v);

/** Los eventos más recientes primero (por fecha y, a igual fecha, por id), ya traducidos. */
export function historialDeProveedor(eventos: readonly EventoProveedorDb[]): EventoProveedorApi[] {
  return [...eventos]
    .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : x.id < y.id ? 1 : -1))
    .map((e) => ({
      id: e.id,
      accion: esAccion(e.accion) ? e.accion : "editar",
      resumen: e.resumen,
      cambios: e.accion === "editar" ? cambiosDeProveedor(e.antes, e.despues) : [],
      por: { nombre: e.usuario_nombre, at: e.created_at },
    }));
}
