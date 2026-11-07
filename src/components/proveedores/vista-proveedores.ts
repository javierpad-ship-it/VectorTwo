import { dinero } from "@/components/compras/formato";
import type { PersonaFechaApi } from "@/lib/compras/tipos-api";
import { ACCIONES_PROVEEDOR, MAX_CONTACTOS_POR_PROVEEDOR, type AccionProveedor, type CampoFaltante } from "@/lib/proveedores/constantes";
import { proveedorFichaSchema } from "@/lib/proveedores/esquemas";
import { PAIS_EEUU } from "@/lib/proveedores/paises";
import type { ParecidoProveedorApi, ProveedorFichaApi, ProveedorListadoApi, ResumenProveedorApi } from "@/lib/proveedores/tipos-api";

/**
 * Lógica pura de las pantallas de proveedores (08c, §4.2): el borrador del formulario, su paso al cuerpo de la API (con la validación del
 * mismo esquema zod que usa el servidor, para que el mensaje sea idéntico), el filtro de la lista y los textos. Sin React: se prueba con
 * vitest. El servidor vuelve a validar todo; esto solo evita ida y vuelta.
 */

// ─── Borrador del formulario ───

export type BorradorContacto = { clave: string; nombre: string; cargo: string; telefono: string; correo: string; es_principal: boolean };

export type BorradorProveedor = {
  nombre: string;
  codigo: string;
  identificacion: string;
  pais: string;
  region: string;
  ciudad: string;
  direccion: string;
  puerto_embarque: string;
  incoterm: string;
  moneda: string;
  plazo_produccion_dias: string;
  plazo_transito_dias: string;
  condiciones_pago: string;
  nota: string;
  es_intercompany: boolean;
  contactos: BorradorContacto[];
};

let consecutivo = 0;
export const claveContacto = (): string => `contacto-${(consecutivo += 1)}`;

export const contactoVacio = (): BorradorContacto => ({ clave: claveContacto(), nombre: "", cargo: "", telefono: "", correo: "", es_principal: false });

export function borradorVacio(): BorradorProveedor {
  return {
    nombre: "",
    codigo: "",
    identificacion: "",
    pais: "",
    region: "",
    ciudad: "",
    direccion: "",
    puerto_embarque: "",
    incoterm: "",
    moneda: "",
    plazo_produccion_dias: "",
    plazo_transito_dias: "",
    condiciones_pago: "",
    nota: "",
    es_intercompany: false,
    contactos: [],
  };
}

const t = (v: string | null | undefined): string => v ?? "";
const n = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

export function borradorDeFicha(f: ProveedorFichaApi): BorradorProveedor {
  return {
    nombre: f.nombre,
    codigo: t(f.codigo),
    identificacion: t(f.identificacion),
    pais: t(f.pais),
    region: t(f.region),
    ciudad: t(f.ciudad),
    direccion: t(f.direccion),
    puerto_embarque: t(f.puerto_embarque),
    incoterm: t(f.incoterm),
    moneda: t(f.moneda),
    plazo_produccion_dias: n(f.plazo_produccion_dias),
    plazo_transito_dias: n(f.plazo_transito_dias),
    condiciones_pago: t(f.condiciones_pago),
    nota: t(f.nota),
    es_intercompany: f.es_intercompany,
    contactos: f.contactos.map((c) => ({ clave: claveContacto(), nombre: c.nombre, cargo: t(c.cargo), telefono: t(c.telefono), correo: t(c.correo), es_principal: c.es_principal })),
  };
}

const aNulo = (s: string): string | null => (s.trim() === "" ? null : s.trim());
/** `""` → null; un número válido → número; cualquier otra cosa → `NaN` (el esquema la rechaza con su mensaje). */
const aEntero = (s: string): number | null => {
  const x = s.trim();
  if (x === "") return null;
  return /^-?\d+$/.test(x) ? Number(x) : Number.NaN;
};

const contactoEnBlanco = (c: BorradorContacto) => [c.nombre, c.cargo, c.telefono, c.correo].every((v) => v.trim() === "");

/** Los contactos con algo escrito (una fila en blanco se ignora) y su posición en el borrador, para poner cada error en su fila. */
export function contactosConDatos(b: BorradorProveedor): { indice: number; contacto: BorradorContacto }[] {
  return b.contactos.map((contacto, indice) => ({ indice, contacto })).filter((x) => !contactoEnBlanco(x.contacto));
}

/** El cuerpo de `POST` (modo ficha) o de `PATCH` (con `revision`) de `/api/compras/proveedores`. */
export function cuerpoProveedor(b: BorradorProveedor, revision: number | null): Record<string, unknown> {
  const contactos = contactosConDatos(b).map(({ contacto: c }) => ({
    nombre: c.nombre.trim(),
    cargo: aNulo(c.cargo),
    telefono: aNulo(c.telefono),
    correo: aNulo(c.correo),
    es_principal: c.es_principal,
  }));
  return {
    nombre: b.nombre.trim(),
    codigo: aNulo(b.codigo),
    pais: b.pais,
    region: aNulo(b.region),
    ciudad: aNulo(b.ciudad),
    direccion: aNulo(b.direccion),
    identificacion: aNulo(b.identificacion),
    es_intercompany: b.es_intercompany,
    puerto_embarque: aNulo(b.puerto_embarque),
    incoterm: aNulo(b.incoterm),
    moneda: aNulo(b.moneda),
    plazo_produccion_dias: aEntero(b.plazo_produccion_dias),
    plazo_transito_dias: aEntero(b.plazo_transito_dias),
    condiciones_pago: aNulo(b.condiciones_pago),
    nota: aNulo(b.nota),
    contactos,
    ...(revision === null ? {} : { revision }),
  };
}

/** Errores por campo (`nombre`, `pais`, `region`, `contactos.2.correo`, …) con el mismo texto que daría la API. Vacío = se puede enviar. */
export function validarBorrador(b: BorradorProveedor): Record<string, string> {
  const errores: Record<string, string> = {};
  const cuerpo = cuerpoProveedor(b, null);
  const filas = contactosConDatos(b);
  const r = proveedorFichaSchema.safeParse(cuerpo);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const [primero, posicion, campo] = issue.path;
      let clave = String(primero ?? "general");
      if (primero === "contactos" && typeof posicion === "number") {
        const fila = filas[posicion];
        clave = fila ? `contactos.${fila.indice}.${String(campo ?? "nombre")}` : "contactos";
      }
      if (!(clave in errores)) errores[clave] = issue.message;
    }
  }
  // El esquema solo mira la región de EE. UU. cuando todo lo demás está bien: así se ve junto con los otros errores.
  if (b.pais === PAIS_EEUU && b.region.trim() === "" && !("region" in errores)) errores.region = "Elige el estado de Estados Unidos.";
  if (b.pais === "" && !("pais" in errores)) errores.pais = "Elige un país de la lista.";
  return errores;
}

export const puedeAgregarContacto = (b: BorradorProveedor): boolean => b.contactos.length < MAX_CONTACTOS_POR_PROVEEDOR;

/** Marca a UN contacto como principal (la radio): los demás quedan sin marca. */
export function marcarPrincipal(contactos: readonly BorradorContacto[], clave: string): BorradorContacto[] {
  return contactos.map((c) => ({ ...c, es_principal: c.clave === clave }));
}

// ─── Lista ───

export type EstadoFiltro = "activos" | "inactivos" | "todos";
export type FiltrosProveedores = { q: string; estado: EstadoFiltro; pais: string; intercompany: boolean };
export const FILTROS_INICIALES: FiltrosProveedores = { q: "", estado: "activos", pais: "", intercompany: false };

/** Minúsculas y sin tildes, para buscar sin distinguir. */
export const normalizarTexto = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function contactoPrincipal(p: Pick<ProveedorListadoApi, "contactos">): ProveedorListadoApi["contactos"][number] | null {
  return p.contactos.find((c) => c.es_principal) ?? p.contactos[0] ?? null;
}

/** `China · Zhejiang`, solo `Perú`, o `—`. */
export function textoUbicacion(p: Pick<ProveedorListadoApi, "pais" | "region">): string {
  return [p.pais, p.region].filter((x): x is string => Boolean(x)).join(" · ") || "—";
}

export function filtrarProveedores(lista: readonly ProveedorListadoApi[], f: FiltrosProveedores): ProveedorListadoApi[] {
  const q = normalizarTexto(f.q);
  return lista.filter((p) => {
    if (f.estado === "activos" && !p.activo) return false;
    if (f.estado === "inactivos" && p.activo) return false;
    if (f.pais && p.pais !== f.pais) return false;
    if (f.intercompany && !p.es_intercompany) return false;
    if (q === "") return true;
    const pajar = normalizarTexto(
      [p.nombre, p.codigo, p.pais, p.region, p.ciudad, p.identificacion, p.puerto_embarque, ...p.contactos.flatMap((c) => [c.nombre, c.correo])].filter(Boolean).join(" "),
    );
    return pajar.includes(q);
  });
}

/** Los países que aparecen en la lista, ordenados, para el filtro. */
export function paisesDe(lista: readonly ProveedorListadoApi[]): string[] {
  return [...new Set(lista.map((p) => p.pais).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "es"));
}

// ─── Textos ───

export const ETIQUETA_FALTANTE: Record<CampoFaltante, string> = {
  pais: "país",
  identificacion: "RUC / Tax ID",
  direccion: "dirección",
  contacto: "contacto",
};

/** `Falta: país y contacto`. */
export function textoFaltan(faltan: readonly CampoFaltante[]): string {
  const nombres = faltan.map((c) => ETIQUETA_FALTANTE[c]);
  if (nombres.length === 0) return "";
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `Falta: ${lista}`;
}

/**
 * Lo que se sabe que falta de un elemento del listado (que solo trae `completo`, sin la dirección). Si faltan país, RUC o contacto se
 * nombran; si no falta ninguno de esos y la ficha está incompleta, solo puede faltar la dirección. Con otros faltantes, la dirección
 * puede faltar también: la ficha abierta (`faltan`) lo dice con exactitud.
 */
export function faltanDeListado(p: Pick<ProveedorListadoApi, "pais" | "identificacion" | "contactos" | "completo">): CampoFaltante[] {
  if (p.completo) return [];
  const faltan: CampoFaltante[] = [];
  if (!p.pais) faltan.push("pais");
  if (!p.identificacion) faltan.push("identificacion");
  if (p.contactos.length === 0) faltan.push("contacto");
  if (faltan.length === 0) faltan.push("direccion");
  return faltan;
}

const decimales = (x: number) => x.toFixed(2).replace(".", ",");

/** `Proveedor Norte Ltd. (mismo nombre sin la razón social)` o `Textiles Delta Ltd. (0,83)`. */
export function textoParecido(p: ParecidoProveedorApi): string {
  return p.motivo === "misma_razon_social" ? `${p.nombre} (mismo nombre sin la razón social)` : `${p.nombre} (${decimales(p.similitud)})`;
}

/** «llegada estimada ≈ fecha de compra + 80 días»; sin plazos, la ayuda genérica. */
export function ayudaPlazos(produccion: string, transito: string): string {
  const a = aEntero(produccion);
  const b = aEntero(transito);
  const suma = (a !== null && !Number.isNaN(a) ? a : 0) + (b !== null && !Number.isNaN(b) ? b : 0);
  if (suma <= 0) return "Con los dos plazos, la llegada estimada ≈ fecha de compra + producción + tránsito.";
  return `Llegada estimada ≈ fecha de compra + ${suma} ${suma === 1 ? "día" : "días"}.`;
}

export function textoRespuestaEliminar(accion: "borrado" | "desactivado", nombre: string): string {
  return accion === "borrado" ? `«${nombre}» eliminado.` : `«${nombre}» tenía compras: quedó desactivado (no se puede borrar).`;
}

export const ETIQUETA_ACCION_PROVEEDOR: Record<AccionProveedor, string> = {
  crear: "Alta",
  editar: "Edición",
  desactivar: "Desactivado",
  reactivar: "Reactivado",
  eliminar: "Eliminado",
  importar: "Carga desde COTV",
};

export const esAccionProveedor = (v: string): v is AccionProveedor => (ACCIONES_PROVEEDOR as readonly string[]).includes(v);

/** `3 compras · 1 200 u · US$ 5 000,00 · S/ 0,00` o `Sin compras`. */
export function textoResumen(r: ResumenProveedorApi): string {
  if (r.compras === 0) return "Sin compras";
  const costos = [r.costo.USD > 0 ? dinero("USD", r.costo.USD) : null, r.costo.PEN > 0 ? dinero("PEN", r.costo.PEN) : null].filter((x): x is string => x !== null);
  return [`${r.compras} ${r.compras === 1 ? "compra" : "compras"}`, `${Math.round(r.unidades)} u`, ...(costos.length > 0 ? costos : ["sin costo registrado"])].join(" · ");
}

/** `Ana Paz · 2026-10-14 10:02`. */
export const textoPersona = (p: PersonaFechaApi, fecha: (iso: string) => string): string => `${p.nombre ?? "—"} · ${fecha(p.at)}`;

/** Enlace a las compras de un proveedor (`/compras/registro?proveedor=` es el filtro que lee el panel de Compras). */
export const hrefComprasDeProveedor = (id: string): string => `/compras/registro?proveedor=${encodeURIComponent(id)}`;

/** ¿Ya hay un proveedor con este nombre (sin tildes ni mayúsculas)? Para ofrecer «Crear» solo cuando no hay coincidencia exacta. */
export const hayNombreIgual = (lista: readonly Pick<ProveedorListadoApi, "nombre">[], nombre: string): boolean => {
  const x = normalizarTexto(nombre);
  return x !== "" && lista.some((p) => normalizarTexto(p.nombre) === x);
};

// ─── Excel ───

export const NOMBRE_ARCHIVO_PROVEEDORES = (hoy: string): string => `proveedores-${hoy}.xlsx`;

/**
 * La hoja `PROVEEDORES` (§4.2) con lo que muestra la lista: nunca datos bancarios ni claves internas. Todo texto viaja como texto: SheetJS
 * escribe cada cadena como celda de texto (`aoa_to_sheet`), así que un nombre que empiece por `=` o `+` no se ejecuta como fórmula (R26).
 */
export function hojaProveedores(lista: readonly ProveedorListadoApi[]): (string | number | null)[][] {
  const cabecera = ["Nombre", "Código", "RUC / Tax ID", "País", "Estado o provincia", "Ciudad", "Puerto de embarque", "Incoterm", "Moneda", "Intercompany", "Estado", "Compras", "Contacto principal", "Teléfono", "Correo", "Ficha"];
  const filas = lista.map((p) => {
    const c = contactoPrincipal(p);
    return [
      p.nombre,
      p.codigo,
      p.identificacion,
      p.pais,
      p.region,
      p.ciudad,
      p.puerto_embarque,
      p.incoterm,
      p.moneda,
      p.es_intercompany ? "Sí" : "No",
      p.activo ? "Activo" : "Inactivo",
      p.compras,
      c?.nombre ?? null,
      c?.telefono ?? null,
      c?.correo ?? null,
      p.completo ? "Completa" : "Incompleta",
    ];
  });
  return [cabecera, ...filas];
}
