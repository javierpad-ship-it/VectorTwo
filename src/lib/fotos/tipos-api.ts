import type { ViajeResumenApi } from "@/lib/compras/agrupadores/tipos-api";
import type { PersonaFechaApi } from "@/lib/compras/tipos-api";
import type { EstadoCompra, Moneda, TallasCompra, TipoLinea } from "@/lib/compras/tipos";

/**
 * Contratos de la API de fotos de las líneas (08c, §3.3).
 *
 *   POST   /api/compras/[id]/lineas/[lineaId]/fotos              → 201 FotoLineaApi        (multipart: `foto` y `miniatura`)
 *   DELETE /api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]     → { id }
 *   POST   /api/compras/[id]/lineas/[lineaId]/fotos/traer        → RespuestaTraerFotosApi
 *   PATCH  /api/compras/[id]/lineas/[lineaId]/ficha              → LineaFichaApi
 *   GET    /api/compras/fotos                                    → FotosModuloApi            (Compras → Fotos, §3.3 y §4.3)
 *   GET    /api/compras/fotos/[fotoId]                           → FotoGrandeApi
 *   GET    /api/compras/fotos/[fotoId]/miniatura                 → bytes image/jpeg
 *   GET    /api/compras/fotos/limpiar                            → LimpiezaFotosApi          (admin)
 *   POST   /api/compras/fotos/limpiar                            → ResultadoLimpiezaFotosApi (admin)
 *
 * Ninguna respuesta trae `ruta`, `ruta_miniatura` ni `clave_origen` (R8, decisión 106).
 */

export type FotoLineaApi = {
  id: string;
  /** `/api/compras/fotos/{id}/miniatura`: del mismo origen y sin caducidad. */
  miniatura_url: string;
  ancho: number;
  alto: number;
  subida_por: PersonaFechaApi;
};

export type FotoGrandeApi = {
  /** URL firmada de Storage, de corta vida. */
  url: string;
  expira_at: string;
  ancho: number;
  alto: number;
  leyenda: string;
};

// ─── Compras → Fotos (§3.3 y §4.3) ───

/** El nodo género · mundo · línea de una línea específica; `null` en un lote al barrer (la pantalla escribe «Lote BETA al barrer»). */
export type NombreGml = { genero: string; mundo: string; linea: string; etiqueta: string };

export type MiniaturaLineaApi = { id: string; miniatura_url: string; subida_por_nombre: string | null; at: string };

/**
 * Una tarjeta de la pantalla Fotos: una línea con su compra, sus fotos activas (de la más antigua a la más nueva) y lo que puede hacer quien
 * mira. NO lleva la `revision` de la compra (la tarjeta no la necesita, §2.7).
 */
export type LineaConFotosApi = {
  compra: { id: string; numero: string; estado: EstadoCompra; proveedor: { id: string; nombre: string }; viaje: ViajeResumenApi | null };
  linea: {
    id: string;
    tipo: TipoLinea;
    gml: NombreGml | null;
    marca: string | null;
    agrupacion_marca: string | null;
    tallas: TallasCompra;
    unidades: number;
    costo_unitario: number | null;
    moneda: Moneda;
    descripcion: string | null;
    modelo: string | null;
  };
  fotos: MiniaturaLineaApi[];
  /** Fotos que «Traer» copiaría ahora de la versión cancelada de esta línea (decisión 104); 0 si no hay o la línea ya está completa. */
  fotos_en_cancelada: number;
  puede: { subir: boolean; quitar: boolean; editar_ficha: boolean };
};

export type ProveedorFotosApi = { id: string; nombre: string; lineas: number; sin_foto: number };

/**
 * `GET /api/compras/fotos`. `contadores` son del conjunto filtrado por viaje, compra, origen, estado, proveedor y búsqueda (sin «solo sin
 * foto»): «8 de 12 líneas con foto». `por_proveedor` es lo mismo SIN el filtro de proveedor, para armar el selector «Feria Sur · 12 líneas ·
 * 4 sin foto». `total` es el de la lista (con «solo sin foto»), de la que `lineas` es una página.
 */
export type FotosModuloApi = {
  contadores: { lineas: number; con_foto: number; sin_foto: number };
  por_proveedor: ProveedorFotosApi[];
  lineas: LineaConFotosApi[];
  pagina: number;
  por_pagina: number;
  total: number;
};

export type LineaFichaApi = { linea_id: string; descripcion: string | null; modelo: string | null };

export type RespuestaTraerFotosApi = { traidas: FotoLineaApi[]; saltadas: number; activas: number };

export type LimpiezaFotosApi = { sin_fila: number; quitadas: number; horas: number };
export type ResultadoLimpiezaFotosApi = { borrados: number; fallidos: number };

// ─── Códigos de error (§3.6) ───

export type CodigoErrorFoto =
  | "longitud_requerida"
  | "foto_grande"
  | "origen_invalido"
  | "foto_requerida"
  | "formato_invalido"
  | "dimensiones_invalidas"
  | "max_fotos"
  | "ya_quitada"
  | "almacen_no_disponible"
  | "linea_cambio"
  | "no_pertenece"
  | "no_editable"
  | "sin_origen"
  | "no_encontrado";

export const ESTADO_HTTP_ERROR_FOTO: Record<CodigoErrorFoto, number> = {
  longitud_requerida: 411,
  foto_grande: 413,
  origen_invalido: 403,
  foto_requerida: 400,
  formato_invalido: 400,
  dimensiones_invalidas: 400,
  max_fotos: 409,
  ya_quitada: 409,
  almacen_no_disponible: 502,
  linea_cambio: 409,
  no_pertenece: 404,
  no_editable: 409,
  sin_origen: 404,
  no_encontrado: 404,
};

export const MENSAJE_ERROR_FOTO: Record<CodigoErrorFoto, string> = {
  longitud_requerida: "La subida debe indicar su tamaño. Vuelve a intentarlo desde la pantalla.",
  foto_grande: "La foto es demasiado grande (máximo 400 KB después de reducirla). Vuelve a elegirla.",
  origen_invalido: "La subida no viene de esta aplicación. Recarga la página y vuelve a intentarlo.",
  foto_requerida: "Adjunta la foto y su miniatura.",
  formato_invalido: "El archivo no es una foto JPEG válida.",
  dimensiones_invalidas: "La foto supera el tamaño permitido (800 × 800 píxeles; la miniatura, 320 × 320).",
  max_fotos: "La línea ya tiene 3 fotos. Quita una antes de agregar otra.",
  ya_quitada: "Esa foto ya estaba quitada.",
  almacen_no_disponible: "No pudimos guardar la foto en este momento. Inténtalo de nuevo en unos minutos.",
  linea_cambio: "Otra persona cambió la descripción o el modelo de esta línea. Recarga y vuelve a intentarlo.",
  no_pertenece: "Esa línea o esa foto no pertenece a esta compra.",
  no_editable: "La compra está cancelada o la línea está inactiva: ya no admite cambios.",
  sin_origen: "No hay fotos de una versión cancelada de esta línea para traer.",
  no_encontrado: "No encontramos esa foto.",
};
