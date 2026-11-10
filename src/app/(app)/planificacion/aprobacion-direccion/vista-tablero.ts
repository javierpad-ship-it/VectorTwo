import { colorAnio } from "@/lib/reportes/histograma";
import { plural } from "@/lib/formato";
import {
  BLOQUES_TABLERO,
  DESGLOSES_TABLERO,
  FILAS_MAYORES,
  GM_CLAVE_TOTAL,
  MAX_AGRUPACIONES,
  MAX_GENEROS,
  MAX_TIENDAS,
  MIN_COMENTARIO_DIRECCION,
  TEMPORADAS_TABLERO,
  type AlertaApi,
  type AprobacionApi,
  type AprobarCuerpoApi,
  type Bloque,
  type BloqueosCierreApi,
  type ClavePuente,
  type ComparativoApi,
  type CrecimientoGMApi,
  type DecisionesAnioApi,
  type Desglose,
  type DiferenciaAprobadaApi,
  type FilaDesgloseApi,
  type FiltrosVistosApi,
  type MotivoDireccion,
  type OpcionesTableroApi,
  type ProyeccionTableroApi,
  type PuenteApi,
  type ResultadoAprobacion,
  type SerieMensualApi,
  type SituacionTienda,
  type TableroApi,
  type TemporadaTablero,
} from "@/lib/direccion/tipos-api";
import { hojasDireccion, type EntradaExcelDireccion } from "@/lib/direccion/excel";
import type { Hoja } from "@/lib/proyeccion/excel";
import {
  ETIQUETA_RESULTADO,
  etiquetaMotivo,
  fechaCorta,
  fechaHora,
  MESES_LARGOS,
  mesAnio,
  mesesCobertura,
  nombreMes,
  participacion,
  porcentaje,
  puntos,
  rangoMeses,
  soles,
  textoEstadoDireccion,
  unidades,
  unidadesConSigno,
} from "@/components/direccion/formato";

/**
 * Vista del tablero de aprobación de dirección (ficha 14, §4). Pura: sin React, sin red y sin estado. Convierte la respuesta de
 * `GET /api/direccion/tablero` (y las de `/opciones`, `/bloqueos` y `/aprobaciones`) en filas, textos y hojas de Excel; no recalcula ninguna
 * cifra de negocio (solo suma meses ya entregados, acumula series para el gráfico y divide dos cifras de la misma respuesta para un %).
 *
 * Aquí vive también la ÚNICA traducción entre los nombres cortos de la URL de la página (§4.7: `proyeccion`, `comparar`, `mundo`, `linea`…) y los
 * de la API (`proyeccion_id`, `comparar_id`, `mundo_id`, `linea_id`…), que rechaza con `400` cualquier parámetro desconocido: `consultaTablero`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Filtros: URL de la página ↔ query de la API
// ─────────────────────────────────────────────────────────────────────────────

export type FiltrosVista = {
  /** `null` = la que el servidor abre por defecto (la que usa Compras). */
  proyeccion: string | null;
  /** Un id, `"ninguna"` (sin comparar) o `null` (la última aprobada). */
  comparar: string | null;
  generos: string[];
  /** Atajo: los géneros del Resto, de una vez. */
  resto: boolean;
  mundo: string | null;
  linea: string | null;
  temporadas: TemporadaTablero[];
  am: string[];
  /** Unidad de marca (una a la vez en 0.19.0). */
  marca: string | null;
  tiendas: string[];
  bloque: Bloque;
  desglose: Desglose;
};

export const FILTROS_VACIOS: FiltrosVista = {
  proyeccion: null,
  comparar: null,
  generos: [],
  resto: false,
  mundo: null,
  linea: null,
  temporadas: [],
  am: [],
  marca: null,
  tiendas: [],
  bloque: "todas",
  desglose: "mundo",
};

/** Los parámetros de la URL de la página, en su orden (§4.7). */
export const CLAVES_URL = ["proyeccion", "comparar", "generos", "resto", "mundo", "linea", "temporadas", "am", "marca", "tiendas", "bloque", "desglose"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const idONulo = (v: string | null): string | null => {
  const s = v?.trim().toLowerCase() ?? "";
  return UUID.test(s) ? s : null;
};
const lista = (v: string | null): string[] => [
  ...new Set(
    (v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "")
  ),
];
const listaIds = (v: string | null, max: number): string[] =>
  lista(v)
    .map((x) => x.toLowerCase())
    .filter((x) => UUID.test(x))
    .slice(0, max);
const esDe = <T extends string>(valores: readonly T[], v: string | null): v is T => v !== null && (valores as readonly string[]).includes(v);

/** La línea solo se puede filtrar con un solo género (sin «Resto») y un mundo, como la Matriz de M7 (la API responde `400` si no). */
export function admiteLinea(f: Pick<FiltrosVista, "generos" | "resto" | "mundo">): boolean {
  return f.generos.length === 1 && !f.resto && f.mundo !== null;
}

/** Deja los filtros coherentes entre sí (sin línea si no se puede; sin comparar con la misma). No mira el catálogo. */
function coherentes(f: FiltrosVista): FiltrosVista {
  const r = { ...f };
  if (r.linea !== null && !admiteLinea(r)) r.linea = null;
  if (r.comparar !== null && r.comparar !== "ninguna" && r.comparar === r.proyeccion) r.comparar = null;
  return r;
}

/** Lee los filtros de la URL de la página. Lo que no se entiende se ignora (un enlace viejo o mal copiado abre el tablero sin ese filtro). */
export function leerFiltrosUrl(params: { get: (k: string) => string | null }): FiltrosVista {
  const comparar = params.get("comparar");
  const bloque = params.get("bloque");
  const desglose = params.get("desglose");
  return coherentes({
    proyeccion: idONulo(params.get("proyeccion")),
    comparar: comparar === "ninguna" ? "ninguna" : idONulo(comparar),
    generos: listaIds(params.get("generos"), MAX_GENEROS),
    resto: params.get("resto") === "1",
    mundo: idONulo(params.get("mundo")),
    linea: idONulo(params.get("linea")),
    temporadas: lista(params.get("temporadas")).filter((t): t is TemporadaTablero => esDe(TEMPORADAS_TABLERO, t)),
    am: listaIds(params.get("am"), MAX_AGRUPACIONES),
    marca: idONulo(params.get("marca")),
    tiendas: listaIds(params.get("tiendas"), MAX_TIENDAS),
    bloque: esDe(BLOQUES_TABLERO, bloque) ? bloque : "todas",
    desglose: esDe(DESGLOSES_TABLERO, desglose) ? desglose : "mundo",
  });
}

const csv = (v: readonly string[]): string | null => (v.length > 0 ? v.join(",") : null);

/** Los filtros como parámetros de la URL de la PÁGINA (nombres cortos); `null` = el parámetro no va. */
export function filtrosAUrl(f: FiltrosVista): Record<(typeof CLAVES_URL)[number], string | null> {
  return {
    proyeccion: f.proyeccion,
    comparar: f.comparar,
    generos: csv(f.generos),
    resto: f.resto ? "1" : null,
    mundo: f.mundo,
    linea: f.linea,
    temporadas: csv(f.temporadas),
    am: csv(f.am),
    marca: f.marca,
    tiendas: csv(f.tiendas),
    bloque: f.bloque === "todas" ? null : f.bloque,
    desglose: f.desglose === "mundo" ? null : f.desglose,
  };
}

/** Query de la página (sin `?`), con los parámetros en el orden de `CLAVES_URL`. */
export function consultaPagina(f: FiltrosVista): string {
  const q = new URLSearchParams();
  const valores = filtrosAUrl(f);
  for (const k of CLAVES_URL) {
    const v = valores[k];
    if (v !== null && v !== "") q.set(k, v);
  }
  return q.toString();
}

/**
 * Query de `GET /api/direccion/tablero` (sin `?`): el ÚNICO lugar que traduce los nombres de la página a los de la API. La API rechaza parámetros
 * desconocidos, así que aquí solo salen los de `tableroQuerySchema`.
 */
export function consultaTablero(f: FiltrosVista): string {
  const c = coherentes(f);
  const q = new URLSearchParams();
  const poner = (k: string, v: string | null) => {
    if (v !== null && v !== "") q.set(k, v);
  };
  poner("proyeccion_id", c.proyeccion);
  poner("comparar_id", c.comparar);
  poner("generos", csv(c.generos));
  poner("resto", c.resto ? "1" : null);
  poner("mundo_id", c.mundo);
  poner("linea_id", c.linea);
  poner("temporadas", csv(c.temporadas));
  poner("am", csv(c.am));
  poner("marca", c.marca);
  poner("tiendas", csv(c.tiendas));
  poner("bloque", c.bloque === "todas" ? null : c.bloque);
  poner("desglose", c.desglose === "mundo" ? null : c.desglose);
  return q.toString();
}

export const RUTA_API_DIRECCION = "/api/direccion";

export function urlTablero(f: FiltrosVista): string {
  const q = consultaTablero(f);
  return q === "" ? `${RUTA_API_DIRECCION}/tablero` : `${RUTA_API_DIRECCION}/tablero?${q}`;
}
export const urlOpciones = (): string => `${RUTA_API_DIRECCION}/opciones`;
export const urlBloqueos = (proyeccionId: string): string => `${RUTA_API_DIRECCION}/bloqueos?proyeccion_id=${encodeURIComponent(proyeccionId)}`;
export const urlAprobaciones = (proyeccionId: string): string => `${RUTA_API_DIRECCION}/aprobaciones?proyeccion_id=${encodeURIComponent(proyeccionId)}`;

/** Cuántos filtros de recorte hay puestos (el «Filtros (3)» del móvil). No cuentan la proyección, la comparada ni el desglose. */
export function cuentaFiltros(f: FiltrosVista): number {
  return (
    f.generos.length +
    (f.resto ? 1 : 0) +
    (f.mundo !== null ? 1 : 0) +
    (f.linea !== null ? 1 : 0) +
    f.temporadas.length +
    f.am.length +
    (f.marca !== null ? 1 : 0) +
    f.tiendas.length +
    (f.bloque !== "todas" ? 1 : 0)
  );
}

/** Quita el recorte y conserva la proyección, la comparada y el desglose. */
export function limpiarRecorte(f: FiltrosVista): FiltrosVista {
  return { ...FILTROS_VACIOS, proyeccion: f.proyeccion, comparar: f.comparar, desglose: f.desglose };
}

/**
 * Aplica un cambio de filtros y deja el resultado coherente con las reglas de la API (para que un clic nunca acabe en un `400`):
 * - con «Resto» encendido, sus géneros no se listan uno a uno;
 * - la línea se quita si deja de haber un solo género y un mundo, o si no es de ese género y ese mundo;
 * - la marca (unidad de marca) debe ser de una de las agrupaciones elegidas: al cambiar la marca se sueltan las agrupaciones que la excluyen, y al
 *   cambiar las agrupaciones se suelta la marca que quedó fuera;
 * - no se compara una proyección consigo misma.
 */
export function aplicarCambio(f: FiltrosVista, cambio: Partial<FiltrosVista>, opciones: OpcionesTableroApi | null): FiltrosVista {
  const r: FiltrosVista = { ...f, ...cambio };
  if (opciones) {
    if (r.resto) {
      const delResto = new Set(opciones.generos.filter((g) => g.es_resto).map((g) => g.id));
      r.generos = r.generos.filter((g) => !delResto.has(g));
    }
    if (r.linea !== null) {
      const l = opciones.lineas.find((x) => x.id === r.linea);
      if (l && (l.genero_id !== r.generos[0] || l.mundo_id !== r.mundo)) r.linea = null;
    }
    if (r.marca !== null && r.am.length > 0) {
      const unidad = opciones.unidades_marca.find((x) => x.id === r.marca);
      if (unidad && !r.am.includes(unidad.agrupacion_marca_id)) {
        if ("marca" in cambio && !("am" in cambio)) r.am = [];
        else r.marca = null;
      }
    }
  }
  return coherentes(r);
}

/** Lo que el admin tenía filtrado al decidir (informativo: va a `resumen.filtros_vistos`). */
export function filtrosVistos(f: FiltrosVista): FiltrosVistosApi {
  return { generos: f.generos, resto: f.resto, mundo_id: f.mundo, linea_id: f.linea, temporadas: f.temporadas, am: f.am, marca: f.marca, tiendas: f.tiendas, bloque: f.bloque };
}

export const ETIQUETA_BLOQUE = (anioSiguiente: number | null): Record<Bloque, string> => ({
  todas: "Todas",
  mismas: anioSiguiente ? `Mismas tiendas de ${anioSiguiente}` : "Mismas tiendas",
  nuevas: "Tiendas nuevas",
  cierres: anioSiguiente ? `Cierres ${anioSiguiente}` : "Cierres",
});

export const ETIQUETA_DESGLOSE: Record<Desglose, string> = {
  genero: "Género",
  mundo: "Mundo",
  linea: "Línea",
  temporada: "Temporada",
  agrupacion_marca: "Agrupación de marca",
  marca: "Marca",
  tienda: "Tienda",
};
/** Orden del selector de desglose (§4.8). */
export const ORDEN_DESGLOSE: readonly Desglose[] = ["genero", "mundo", "linea", "temporada", "agrupacion_marca", "marca", "tienda"];

export const ETIQUETA_TEMPORADA: Record<TemporadaTablero, string> = { invierno: "Invierno", verano: "Verano", todo_el_ano: "Todo el año", sin_temporada: "Sin temporada" };

export const AYUDA_MARCA = "Lo proyectado por marca es estimado con su participación de los últimos 12 meses en cada fila.";

export type GrupoTiendas = { clave: SituacionTienda | "todas"; titulo: string; items: { id: string; label: string; title: string }[] };

const ORDEN_SITUACION: readonly SituacionTienda[] = ["mismas", "nuevas_anterior", "aperturas", "cierres", "fuera"];

/** Las tiendas del filtro agrupadas por su situación en el año siguiente (§4.7), según lo guardado en la proyección mostrada. */
export function gruposDeTiendas(tiendas: OpcionesTableroApi["tiendas"], situaciones: TableroApi["datos"]["tiendas"] | null, proyeccion: Pick<ProyeccionTableroApi, "anio_en_curso" | "anio_siguiente"> | null): GrupoTiendas[] {
  const item = (t: OpcionesTableroApi["tiendas"][number]) => ({ id: t.id, label: `${t.codigo} · ${t.nombre}`, title: t.fecha_cierre ? `Cierre: ${fechaCorta(t.fecha_cierre)}` : t.fecha_apertura ? `Apertura: ${fechaCorta(t.fecha_apertura)}` : t.nombre });
  const ordenadas = [...tiendas].sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
  if (!situaciones || !proyeccion) return ordenadas.length > 0 ? [{ clave: "todas", titulo: "Tiendas", items: ordenadas.map(item) }] : [];
  const de = new Map(situaciones.map((s) => [s.tienda_id, s.situacion] as const));
  const titulos: Record<SituacionTienda, string> = {
    mismas: `Mismas tiendas ${proyeccion.anio_siguiente}`,
    nuevas_anterior: `Abiertas en ${proyeccion.anio_en_curso}`,
    aperturas: `Aperturas ${proyeccion.anio_siguiente}`,
    cierres: `Cierres ${proyeccion.anio_siguiente}`,
    fuera: "Cerradas o fuera de la proyección",
  };
  return ORDEN_SITUACION.map((s) => ({ clave: s, titulo: titulos[s], items: ordenadas.filter((t) => (de.get(t.id) ?? "fuera") === s).map(item) })).filter((g) => g.items.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cabecera
// ─────────────────────────────────────────────────────────────────────────────

const ESTADO_PROYECCION: Record<ProyeccionTableroApi["estado"], string> = { en_trabajo: "en trabajo", cerrada: "cerrada", archivada: "archivada" };

/** «Proyección 2026–2027 · cerrada el 07 nov 2026 por Planner P. · datos hasta set 2026 · la que usa Compras». */
export function textoCabecera(p: ProyeccionTableroApi): string {
  const estado = p.estado === "cerrada" ? `cerrada${p.cerrada_at ? ` el ${fechaCorta(p.cerrada_at)}` : ""}${p.cerrada_por_nombre ? ` por ${p.cerrada_por_nombre}` : ""}` : ESTADO_PROYECCION[p.estado];
  return [p.nombre, estado, `datos hasta ${mesAnio(p.hasta_periodo)}`, ...(p.usa_compras ? ["la que usa Compras"] : [])].join(" · ");
}

/** Texto de cada proyección en el selector. */
export function etiquetaProyeccion(p: ProyeccionTableroApi): string {
  return [p.nombre, ESTADO_PROYECCION[p.estado], ...(p.usa_compras ? ["usa Compras"] : [])].join(" · ");
}

/** «Hay venta publicada hasta oct 2026; esta proyección se calculó con datos hasta set 2026» (solo si `k' > k`). */
export function textoDatosMasNuevos(t: Pick<TableroApi, "proyeccion" | "datos">): string | null {
  if (t.datos.k_prima <= t.proyeccion.k || mesAnio(t.datos.ultimo_publicado) === mesAnio(t.proyeccion.hasta_periodo)) return null;
  return `Hay venta publicada hasta ${mesAnio(t.datos.ultimo_publicado)}; esta proyección se calculó con datos hasta ${mesAnio(t.proyeccion.hasta_periodo)}.`;
}

/** El recorte en texto, bajo la barra de filtros: el del servidor más el conjunto de tiendas de las líneas (I4). */
export function textoRecorte(f: TableroApi["filtros"]): string[] {
  const lineas = [f.texto];
  if (f.conjunto_tiendas) lineas.push(f.conjunto_tiendas.codigos.length > 0 && !f.conjunto_tiendas.etiqueta.includes(":") ? `${f.conjunto_tiendas.etiqueta}: ${f.conjunto_tiendas.codigos.join(", ")}` : f.conjunto_tiendas.etiqueta);
  return lineas.filter((l) => l.trim() !== "");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Lo que bloquearía el cierre y alertas
// ─────────────────────────────────────────────────────────────────────────────

export type NivelVisual = "bloquea" | "forzable" | "importante" | "info";

/** Nivel con icono Y palabra (nunca solo color). */
export const ROTULO_NIVEL: Record<NivelVisual, { palabra: string; icono: string; tono: "alerta" | "marca" | "neutro" }> = {
  bloquea: { palabra: "Bloquea el cierre", icono: "✕", tono: "alerta" },
  forzable: { palabra: "Se puede cerrar igual", icono: "↷", tono: "marca" },
  importante: { palabra: "Importante", icono: "!", tono: "alerta" },
  info: { palabra: "Informativo", icono: "i", tono: "neutro" },
};

export type ItemBloqueo = { codigo: string; mensaje: string; detalles: string[] };

export type VistaBloqueos =
  | { estado: "no_aplica" }
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; duros: ItemBloqueo[]; forzables: ItemBloqueo[]; titulo: string };

const textoDe = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (v !== null && typeof v === "object" && typeof (v as { mensaje?: unknown }).mensaje === "string") return (v as { mensaje: string }).mensaje;
  return null;
};

/** «2027: 37 filas sin decidir, 41,200 u; 12 de ellas de cola larga para revisión» (el conteo de `filaBloqueaCierre`, por año). */
export function lineasFilasSinDecidir(filas: Extract<BloqueosCierreApi, { aplica: true }>["filas"]): string[] {
  return filas
    .filter((f) => f.n > 0)
    .map((f) => {
      const cola = f.por_motivo.revision_cola_larga;
      return `${f.anio}: ${plural(f.n, "fila sin decidir", "filas sin decidir")}, ${unidades(f.u)} u${cola > 0 ? `; ${cola === f.n ? "todas" : `${unidades(cola)} de ellas`} de cola larga para revisión` : ""}`;
    });
}

/**
 * Lo que bloquearía el cierre (§4.5), con el código y el mensaje del cierre TAL CUAL. «Desactualizada» (forzable) va aparte, como aviso.
 * `enTrabajo = false` → no aplica (cerrada o archivada).
 */
export function vistaBloqueos(args: { enTrabajo: boolean; datos: BloqueosCierreApi | null; cargando: boolean; error: string | null }): VistaBloqueos {
  if (!args.enTrabajo) return { estado: "no_aplica" };
  if (args.datos === null) return args.error !== null ? { estado: "error", mensaje: args.error } : { estado: "cargando" };
  const b = args.datos;
  if (!b.aplica) return { estado: "no_aplica" };
  const item = (x: (typeof b.bloqueos)[number]): ItemBloqueo => {
    const detalles: string[] = [];
    if (x.codigo === "filas_sin_decidir") detalles.push(...lineasFilasSinDecidir(b.filas));
    const motivos = x.detalle?.motivos;
    if (Array.isArray(motivos)) for (const m of motivos) {
      const t = textoDe(m);
      if (t !== null) detalles.push(t);
    }
    return { codigo: x.codigo, mensaje: x.mensaje, detalles };
  };
  const duros = b.bloqueos.filter((x) => !x.forzable).map(item);
  const forzables = b.bloqueos.filter((x) => x.forzable).map(item);
  const titulo = duros.length > 0 ? `${plural(duros.length, "causa bloquearía", "causas bloquearían")} el cierre` : forzables.length > 0 ? "Nada bloquea el cierre; está desactualizada" : "Nada bloquea el cierre";
  return { estado: "listo", duros, forzables, titulo };
}

/** La línea del resumen que completa la pantalla con `/bloqueos` (§4.3, línea 5): solo en trabajo. */
export function lineaResumenBloqueos(v: VistaBloqueos): string | null {
  switch (v.estado) {
    case "no_aplica":
      return null;
    case "cargando":
      return "En trabajo; comprobando qué bloquearía el cierre…";
    case "error":
      return "En trabajo; no se pudo comprobar qué bloquearía el cierre";
    case "listo":
      if (v.duros.length > 0) return `En trabajo; ${plural(v.duros.length, "causa bloquearía", "causas bloquearían")} el cierre`;
      return v.forzables.length > 0 ? "En trabajo; está desactualizada, pero se puede cerrar igual" : "En trabajo; nada bloquea el cierre";
  }
}

export type AlertasSeparadas = { importantes: AlertaApi[]; informativas: AlertaApi[] };

/** Las alertas de un alcance, importantes primero y en el orden en que las entrega el servidor (el de la tabla de §4.5). */
export function alertasDe(alertas: readonly AlertaApi[], alcance: AlertaApi["alcance"]): AlertasSeparadas {
  const propias = alertas.filter((a) => a.alcance === alcance);
  return { importantes: propias.filter((a) => a.nivel === "importante"), informativas: propias.filter((a) => a.nivel !== "importante") };
}

/** «Ver 6 informativas». */
export const textoVerInformativas = (n: number): string => `Ver ${plural(n, "informativa", "informativas")}`;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Puente del año en curso al siguiente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Texto de ayuda de cada paso (`title` y lector de pantalla) cuando el servidor no lo trae en `ayuda`. El rótulo y la ayuda de cada línea los arma el
 * servidor (`src/lib/direccion/puente.ts`), que sabe qué cuenta la línea `manual` («Fijado a mano» o «Cifras fijadas (a mano o sugeridas por IA)»,
 * según lo que sume la función de la base): la pantalla los pinta TAL CUAL, para decir lo mismo que el resumen, las alertas y el Excel.
 */
export const AYUDA_PUENTE: Record<ClavePuente, string> = {
  cierre_en_curso: "El cierre vigente del año en curso de todas las tiendas: lo vendido hasta el mes de los datos más lo proyectado para el resto del año.",
  fuera_base: "Lo del año en curso de tiendas que no forman la base del año siguiente: aperturas del año en curso que siguen fuera y cierres del año en curso.",
  ajuste_base: "Incluye lo del año en curso que M7 resta de la base por las tiendas que cierran el año siguiente y cualquier diferencia entre la base y el cierre de esas tiendas (por ejemplo, decisiones sobre el año en curso tomadas después de calcular la base).",
  base: "La base del año siguiente (B): lo del año en curso de las mismas tiendas del año siguiente.",
  nino: "Corrección del Niño: la base corregida menos la base (B′ − B).",
  crecimiento: "El crecimiento declarado aplicado: la propuesta de hoy menos la base corregida.",
  manual: "Lo fijado por encima o por debajo de la propuesta: vigente menos propuesta de las filas que cuenta esta línea (las dice su rótulo).",
  otras:
    "Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular (se aceptó una propuesta anterior), y filas escaladas por tienda: no son decisiones a mano, pero hacen que lo vigente no sea la propuesta de hoy.",
  sin_base: "Filas de mismas tiendas proyectadas por otro método, sin base B.",
  mismas_siguiente: "Lo proyectado para el año siguiente en las mismas tiendas.",
  nuevas_anterior: "Tiendas abiertas en el año en curso, que el año siguiente todavía van aparte de la base.",
  aperturas: "Aperturas del año siguiente.",
  cierres: "Lo que venden el año siguiente, hasta su cierre, las tiendas que cierran ese año.",
  total_siguiente: "El total proyectado del año siguiente: la suma exacta de los pasos.",
};

export const AYUDA_DIFERENCIA = "No hay tiendas que salgan de la base: esta línea es solo la diferencia entre la base y el cierre (decisiones sobre el año en curso tomadas después de calcular la base).";

/** La ayuda del paso: la del servidor; si no la trae (la foto de una aprobación no la guarda), la de la pantalla. */
export function ayudaPaso(l: { clave: ClavePuente; ayuda?: string }): string {
  return l.ayuda && l.ayuda.trim() !== "" ? l.ayuda : AYUDA_PUENTE[l.clave];
}

export type FilaPuente = { clave: ClavePuente; etiqueta: string; ayuda: string; unidades: string; acumulado: string; pct: string; subtotal: boolean; diferencia: boolean };

const PCT_DEL_SERVIDOR: Partial<Record<ClavePuente, keyof PuenteApi["pct"]>> = { nino: "nino", crecimiento: "crecimiento", manual: "manual", otras: "otras" };

/**
 * Las filas de la tabla de pasos (§4.4): unidades del paso, acumulado y % sobre el paso anterior. El % de Niño, crecimiento, fijadas y otras es el
 * del servidor; el de los demás pasos, el paso sobre el acumulado anterior; el de la base y el del total, frente al cierre (también del servidor).
 * `hayCierres`: si alguna tienda sale de la base.
 */
export function filasPuente(p: PuenteApi, opciones: { hayCierres?: boolean } = {}): FilaPuente[] {
  return p.lineas.map((l) => {
    const clavePct = PCT_DEL_SERVIDOR[l.clave];
    const anterior = l.acumulado - l.u;
    let pct = "";
    if (l.clave === "total_siguiente") pct = p.pct.total_vs_cierre === null ? "" : `${porcentaje(p.pct.total_vs_cierre)} vs cierre`;
    else if (l.clave === "base") pct = p.pct.base_sobre_real === null ? "" : `${porcentaje(p.pct.base_sobre_real)} vs cierre`;
    else if (clavePct) pct = porcentaje(p.pct[clavePct]);
    else if (!l.subtotal) pct = l.u === 0 ? "" : anterior !== 0 ? porcentaje((l.u / Math.abs(anterior)) * 100) : "—";
    const sinNino = l.clave === "nino" && p.pct.nino === null && l.u === 0;
    return {
      clave: l.clave,
      etiqueta: l.etiqueta,
      ayuda: ayudaPaso(l),
      unidades: l.subtotal ? "" : sinNino ? "—" : unidadesConSigno(l.u),
      acumulado: unidades(l.acumulado),
      pct,
      subtotal: l.subtotal,
      diferencia: l.clave === "ajuste_base" && l.u !== 0 && opciones.hayCierres === false,
    };
  });
}

const NOMBRE_CORTO = (y: number, y1: number): Record<ClavePuente, string> => ({
  cierre_en_curso: `${y} cierre`,
  fuera_base: "− fuera de la base",
  ajuste_base: "− salen de la base",
  base: `Base ${y1}`,
  nino: "+ Niño",
  crecimiento: "+ crecimiento",
  manual: "+ fijadas",
  otras: "+ otras",
  sin_base: "+ sin base",
  mismas_siguiente: `Mismas ${y1}`,
  nuevas_anterior: `+ abiertas ${y}`,
  aperturas: `+ aperturas ${y1}`,
  cierres: `+ cierran ${y1}`,
  total_siguiente: String(y1),
});

const EN_LINEA: Partial<Record<ClavePuente, string>> = {
  base: "Base",
  nino: "Niño",
  crecimiento: "crecimiento",
  manual: "fijadas",
  otras: "otras diferencias",
  sin_base: "sin base",
  mismas_siguiente: "mismas",
  nuevas_anterior: "abiertas el año en curso",
  aperturas: "aperturas",
  cierres: "cierres",
};

/** El puente del recorte en una línea (§4.7): «Base 47,040 → Niño +753 → crecimiento +2,390 → fijadas +117 → mismas 50,300 → aperturas +1,408 → cierres +1,000 → 52,708». */
export function puenteEnLinea(p: PuenteApi): string {
  const desde = p.lineas.findIndex((l) => l.clave === "base");
  const partes: string[] = [];
  for (const l of p.lineas.slice(Math.max(0, desde))) {
    if (l.clave === "total_siguiente") partes.push(unidades(l.acumulado));
    else if (l.subtotal) partes.push(`${EN_LINEA[l.clave] ?? l.etiqueta} ${unidades(l.acumulado)}`);
    else if (l.u !== 0) partes.push(`${EN_LINEA[l.clave] ?? l.etiqueta} ${unidadesConSigno(l.u)}`);
  }
  return partes.join(" → ");
}

export type TablaPuenteGm = {
  columnas: { clave: ClavePuente; titulo: string; ayuda: string; subtotal: boolean }[];
  filas: { gm_clave: string; nombre: string; nino: boolean; total: boolean; celdas: string[] }[];
};

/** El puente por género × mundo en columnas (§4.4): una fila por GM, la del Resto y la del Total. Los GM con Niño lo dicen en su celda. */
export function tablaPuenteGm(porGm: TableroApi["puente"]["por_gm"], crecimientos: readonly CrecimientoGMApi[], p: Pick<ProyeccionTableroApi, "anio_en_curso" | "anio_siguiente">): TablaPuenteGm {
  const corto = NOMBRE_CORTO(p.anio_en_curso, p.anio_siguiente);
  const modelo = porGm[porGm.length - 1] ?? porGm[0];
  const columnas = (modelo?.lineas ?? []).map((l) => ({ clave: l.clave, titulo: corto[l.clave], ayuda: `${l.etiqueta}. ${ayudaPaso(l)}`, subtotal: l.subtotal }));
  const conNino = new Set(crecimientos.filter((c) => c.con_nino).map((c) => c.gm_clave));
  const filas = porGm.map((g) => {
    const de = new Map(g.lineas.map((l) => [l.clave, l] as const));
    return {
      gm_clave: g.gm_clave,
      nombre: g.nombre,
      nino: conNino.has(g.gm_clave),
      total: g.gm_clave === GM_CLAVE_TOTAL,
      celdas: columnas.map((c) => {
        const l = de.get(c.clave);
        if (!l) return "—";
        if (c.clave === "nino" && g.pct.nino === null && l.u === 0) return "—";
        return l.subtotal ? unidades(l.acumulado) : unidadesConSigno(l.u);
      }),
    };
  });
  return { columnas, filas };
}

/** El puente total de la proyección (la fila del Total de `por_gm`). */
export function puenteTotal(t: Pick<TableroApi, "puente">): (PuenteApi & { gm_clave: string; nombre: string }) | null {
  return t.puente.por_gm.find((g) => g.gm_clave === GM_CLAVE_TOTAL) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Frente a lo aprobado
// ─────────────────────────────────────────────────────────────────────────────

export type FilaDiferencia = { clave: string; nombre: string; aprobado: string; actual: string; diferencia: string; pct: string; resaltada: boolean };

export type VistaDiferencia =
  | { tipo: "sin_aprobadas"; texto: string }
  | { tipo: "oculta" }
  | { tipo: "identica"; texto: string }
  | { tipo: "tabla"; encabezado: string; filas: FilaDiferencia[]; anioEnCurso: number; anioSiguiente: number };

/** La tarjeta «Frente a lo aprobado» (§4.6) según el caso. */
export function vistaDiferencia(d: DiferenciaAprobadaApi | null, p: Pick<ProyeccionTableroApi, "anio_en_curso" | "anio_siguiente">): VistaDiferencia {
  if (d === null) return { tipo: "sin_aprobadas", texto: "Todavía no hay ninguna proyección aprobada." };
  if (d.identica && d.misma_proyeccion) return { tipo: "oculta" };
  if (d.identica) return { tipo: "identica", texto: `Idéntica a lo aprobado el ${fechaCorta(d.fecha)} en ${d.proyeccion_nombre}; esta copia aún no tiene aprobación propia.` };
  const fila = (clave: string, nombre: string, x: { aprobado: number; actual: number; u: number; pct: number | null }, resaltada = false): FilaDiferencia => ({
    clave,
    nombre,
    aprobado: unidades(x.aprobado),
    actual: unidades(x.actual),
    diferencia: unidadesConSigno(x.u),
    pct: porcentaje(x.pct),
    resaltada,
  });
  const porGm = [...d.por_gm].sort((a, b) => Math.abs(b.u) - Math.abs(a.u));
  return {
    tipo: "tabla",
    encabezado: `${ETIQUETA_RESULTADO[d.resultado]} el ${fechaCorta(d.fecha)} por ${d.usuario_nombre}${d.misma_proyeccion ? " (esta misma proyección, antes de cambiar)" : ` en ${d.proyeccion_nombre}`}.`,
    filas: [...porGm.map((g) => fila(g.gm_clave, g.nombre, g)), fila("total", `Total ${p.anio_siguiente}`, d.siguiente, true), fila("cierre", `${p.anio_en_curso} cierre`, d.en_curso, true)],
    anioEnCurso: p.anio_en_curso,
    anioSiguiente: p.anio_siguiente,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cifras del recorte (tarjetas)
// ─────────────────────────────────────────────────────────────────────────────

const comparativo = (t: Pick<TableroApi, "kpis">, clave: ComparativoApi["clave"]): ComparativoApi | undefined => t.kpis.comparativos.find((c) => c.clave === clave);

const MOTIVO_COMPARATIVO: Record<"sin_base" | "incompleto" | "nueva", string> = { sin_base: "sin base para comparar", incompleto: "año incompleto", nueva: "nueva: sin historia" };

/** Un % o, si no se puede calcular, por qué. */
export function textoPct(x: { pct: number | null; motivo: null | "sin_base" | "incompleto" | "nueva" } | undefined): string {
  if (!x) return "—";
  return x.pct !== null ? porcentaje(x.pct) : x.motivo ? MOTIVO_COMPARATIVO[x.motivo] : "—";
}

export type LineaTarjeta = { texto: string; fuerte?: boolean };
export type Tarjeta = { clave: "siguiente" | "cierre" | "en_curso" | "mismas"; titulo: string; valor: string; estimado: boolean; nino: boolean; lineas: LineaTarjeta[] };

/** Lo real del año en curso hasta `k'` (la serie real del año en curso); si no viene, lo real hasta `k`. */
function realEnLoQueVa(t: TableroApi): { u: number | null; hasta: number } {
  const serie = t.series.find((s) => s.tipo === "real_parcial" && s.anio === t.proyeccion.anio_en_curso);
  if (serie) {
    const meses = serie.meses.slice(0, t.datos.k_prima);
    if (meses.some((m) => m !== null)) return { u: meses.reduce<number>((a, m) => a + (m ?? 0), 0), hasta: t.datos.k_prima };
  }
  return { u: t.kpis.real_ac, hasta: t.proyeccion.k };
}

/**
 * El % de mismas tiendas del año siguiente sobre la base CORREGIDA del Niño, derivado del puente del recorte (mismas ÷ (base + corrección) − 1).
 * `null` sin puente (con tiendas elegidas), sin base corregida o con filas sin base (el subtotal ya no es comparable con la base).
 */
export function mismasSobreCorregido(p: PuenteApi | null): number | null {
  if (!p || p.pct.nino === null) return null;
  const de = new Map(p.lineas.map((l) => [l.clave, l] as const));
  const base = de.get("base");
  const nino = de.get("nino");
  const mismas = de.get("mismas_siguiente");
  if (!base || !nino || !mismas || (de.get("sin_base")?.u ?? 0) !== 0) return null;
  const corregida = base.acumulado + nino.u;
  return corregida > 0 ? (mismas.acumulado / corregida - 1) * 100 : null;
}

/** Las cuatro tarjetas del recorte (§4.7). Todo sale de `kpis`, de sus comparativos (con su etiqueta) y de los años del Niño de la respuesta. */
export function tarjetas(t: TableroApi): Tarjeta[] {
  const y = t.proyeccion.anio_en_curso;
  const y1 = t.proyeccion.anio_siguiente;
  const k = t.proyeccion.k;
  const nino = new Set(t.datos.anios_nino);
  const estimado = t.kpis.exactitud === "estimado";
  const sigCierre = comparativo(t, "sig_vs_cierre");
  const sigAnterior = comparativo(t, "sig_vs_anterior");
  const cierreAnterior = comparativo(t, "cierre_vs_anterior");
  const cierreHaceDos = comparativo(t, "cierre_vs_hace_dos");
  const acAc = comparativo(t, "ac_vs_ac");
  const ultimoNormal = nino.has(y) && !nino.has(y - 1);

  const siguiente: Tarjeta = {
    clave: "siguiente",
    titulo: `${y1} proyectado`,
    valor: `${unidades(t.kpis.siguiente)} u`,
    estimado,
    nino: nino.has(y1),
    lineas: [
      { texto: `${textoPct(sigCierre?.total)} vs cierre ${y}` },
      { texto: `${textoPct(sigAnterior?.total)} vs ${y - 1}${ultimoNormal ? ", último año normal" : nino.has(y - 1) ? " (año del Niño)" : ""}`, fuerte: true },
    ],
  };

  const lineasCierre: LineaTarjeta[] = [{ texto: k >= 12 ? `= real ${rangoMeses(1, 12)} ${unidades(t.kpis.real_ac)}` : `= real ${rangoMeses(1, k)} ${unidades(t.kpis.real_ac)} + proyectado ${rangoMeses(k + 1, 12)} ${unidades(t.kpis.proyectado_resto)}` }, { texto: `${textoPct(cierreAnterior?.total)} vs ${y - 1}` }];
  if (cierreHaceDos) lineasCierre.push({ texto: `${textoPct(cierreHaceDos.total)} vs ${y - 2}${nino.has(y - 2) ? " (año del Niño)" : ""}` });
  if (nino.has(y)) lineasCierre.push({ texto: "año del Niño", fuerte: true });
  const cierre: Tarjeta = { clave: "cierre", titulo: `${y} cierre`, valor: `${unidades(t.kpis.cierre)} u`, estimado, nino: nino.has(y), lineas: lineasCierre };

  const real = realEnLoQueVa(t);
  const enCurso: Tarjeta = {
    clave: "en_curso",
    titulo: `${y} en lo que va (${rangoMeses(1, real.hasta)})`,
    valor: `${unidades(real.u)} u`,
    estimado: false,
    nino: nino.has(y),
    lineas: acAc ? [{ texto: `${textoPct(acAc.total)} · ${acAc.etiqueta}` }] : [],
  };

  const corregido = mismasSobreCorregido(t.puente.recorte);
  const nTiendas = sigCierre?.mismas.tiendas.length ?? 0;
  const lineasMismas: LineaTarjeta[] = [];
  if (sigCierre) {
    const sobre = sigCierre.mismas.pct !== null ? `${porcentaje(sigCierre.mismas.pct)} sobre real${corregido !== null ? `, ${porcentaje(corregido)} sobre corregido` : ""}` : textoPct({ pct: null, motivo: sigCierre.mismas.motivo });
    lineasMismas.push({ texto: `${y1} vs ${y}: ${sobre}${nTiendas > 0 ? ` (${plural(nTiendas, "tienda", "tiendas")})` : ""}`, fuerte: true });
    lineasMismas.push({ texto: `total con nuevas, aperturas y cierres ${textoPct(sigCierre.total)}` });
  }
  if (cierreAnterior) {
    const n = cierreAnterior.mismas.tiendas.length;
    lineasMismas.push({ texto: `${y} vs ${y - 1}: ${textoPct({ pct: cierreAnterior.mismas.pct, motivo: cierreAnterior.mismas.motivo })}${n > 0 ? ` (${plural(n, "tienda", "tiendas")})` : ""}` });
  }
  const mismas: Tarjeta = {
    clave: "mismas",
    titulo: "Mismas tiendas",
    valor: sigCierre ? textoPct({ pct: sigCierre.mismas.pct, motivo: sigCierre.mismas.motivo }) : "—",
    estimado,
    nino: Boolean(sigCierre?.nino),
    lineas: lineasMismas,
  };

  return [siguiente, cierre, enCurso, mismas];
}

/** ¿El recorte no trae nada (ni venta ni proyección)? Para el estado vacío «Sin venta ni proyección con estos filtros». */
export function recorteVacio(t: TableroApi): boolean {
  const k = t.kpis;
  return k.siguiente === 0 && k.cierre === 0 && k.real_ac === 0 && k.proyectado_resto === 0 && k.anterior === 0 && k.hace_dos === 0 && k.hace_tres === 0;
}

/** Notas de la atribución por tienda (§3.4 E): la participación usada, a la vista, y lo que quedó sin atribuir (con su signo). */
export function notasAtribucion(t: Pick<TableroApi, "atribucion" | "proyeccion">): string[] {
  const a = t.atribucion;
  if (!a) return [];
  const y = t.proyeccion.anio_en_curso;
  const y1 = t.proyeccion.anio_siguiente;
  const notas = a.tiendas.map((x) => {
    const conDato = x.participacion_mes.map((v, i) => ({ v, mes: i + 1 })).filter((m): m is { v: number; mes: number } => m.v !== null);
    let mensual = "";
    if (a.mensual && conDato.length > 0) {
      const min = conDato.reduce((p, c) => (c.v < p.v ? c : p));
      const max = conDato.reduce((p, c) => (c.v > p.v ? c : p));
      mensual = min.v === max.v ? ` y, mes a mes, con la misma participación (${participacion(min.v)})` : ` y, mes a mes, con su participación de cada mes del año de referencia (de ${participacion(min.v)} en ${MESES_LARGOS[min.mes - 1]} a ${participacion(max.v)} en ${MESES_LARGOS[max.mes - 1]})`;
    }
    return `${x.codigo}: ${y1} estimado con su parte de la base ${y} (${participacion(x.participacion_anual)})${mensual}.`;
  });
  if (!a.mensual) notas.push("El reparto mensual por tienda del resto del año en curso no se pudo hacer: el total anual de cada tienda sí es el atribuido.");
  for (const [anio, valor] of [
    [y, a.sin_atribuir.en_curso],
    [y1, a.sin_atribuir.siguiente],
  ] as const) {
    if (valor > 0) notas.push(`Sin atribuir a tienda en ${anio}: ${unidades(valor)} u (no se asignan a ninguna tienda).`);
    if (valor < 0) notas.push(`Sin atribuir en ${anio}: ${unidadesConSigno(valor)} u: lo atribuido a las tiendas supera lo proyectado para el bloque (la base anual y la curva guardada difieren; ver la línea «diferencia» del puente). Nunca se resta de una tienda.`);
  }
  return notas;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Gráfico mensual
// ─────────────────────────────────────────────────────────────────────────────

export type SerieDibujo = {
  clave: string;
  etiqueta: string;
  /** Doce valores; `null` donde no hay dato. */
  valores: (number | null)[];
  color: string;
  /** `stroke-dasharray`; sin él, trazo continuo. Las series se distinguen por trazo y grosor, no solo por color. */
  dash?: string;
  grosor: number;
  tipo: SerieMensualApi["tipo"];
  anio: number;
  nino: boolean;
  estimado: boolean;
  /** Encendida por defecto: siempre, solo en pantallas anchas (los años más viejos) o nunca. */
  porDefecto: "si" | "ancho";
  /** Explicación de la serie en la leyenda (`title`). */
  ayuda?: string;
};

const COLOR_COMPARADA = "var(--tinta-suave)";

/** La etiqueta de una serie con sus rótulos: «(Niño)» si el año es del Niño y «(estimado)» si la cifra está atribuida o es de marca. */
export function etiquetaSerie(s: Pick<SerieMensualApi, "etiqueta" | "nino" | "exactitud" | "tipo">): string {
  let e = s.etiqueta;
  if (s.nino && s.tipo !== "sin_nino" && !/ni[ñn]o/i.test(e)) e += " (Niño)";
  if (s.exactitud === "estimado" && !/estimad/i.test(e)) e += " (estimado)";
  return e;
}

/** Las series del tablero con su trazo (§4.8). `p`: la proyección mostrada (para saber cuál es el año en curso y cuál el siguiente). */
export function seriesGrafico(t: Pick<TableroApi, "series" | "proyeccion">): SerieDibujo[] {
  const y = t.proyeccion.anio_en_curso;
  const y1 = t.proyeccion.anio_siguiente;
  return t.series.map((s) => {
    const base = { clave: s.clave, etiqueta: etiquetaSerie(s), valores: Array.from({ length: 12 }, (_, i) => s.meses[i] ?? null), tipo: s.tipo, anio: s.anio, nino: s.nino, estimado: s.exactitud === "estimado" };
    switch (s.tipo) {
      case "real":
        return { ...base, color: colorAnio(s.anio), dash: s.nino ? "9 3 2 3" : undefined, grosor: 1.5, porDefecto: s.anio <= y - 2 ? ("ancho" as const) : ("si" as const) };
      case "real_parcial":
        return { ...base, color: colorAnio(s.anio), grosor: 3, porDefecto: "si" as const };
      case "proyectado":
        return { ...base, color: colorAnio(s.anio), dash: "7 5", grosor: s.anio >= y1 ? 4 : 3, porDefecto: "si" as const };
      case "sin_nino":
        return { ...base, color: colorAnio(s.anio), dash: "3 4", grosor: 1.5, porDefecto: "si" as const, ayuda: `${s.anio} dividido por el factor del Niño de cada mes, para ver qué parte del salto de ${s.anio + 1} es corrección.` };
      case "comparada":
      case "aprobada":
        // Pueden venir dos (el cierre del año en curso y el año siguiente de la comparada): la del año siguiente, más gruesa.
        return { ...base, etiqueta: s.tipo === "aprobada" && !/aprobada/i.test(base.etiqueta) ? `${base.etiqueta} (aprobada)` : base.etiqueta, color: COLOR_COMPARADA, dash: "1 5", grosor: s.anio >= y1 ? 2.5 : 1.75, porDefecto: "si" as const };
    }
  });
}

/** Las series encendidas por defecto según el ancho de la pantalla (en móvil, los años más viejos van apagados). */
export function clavesPorDefecto(series: readonly SerieDibujo[], pantallaAncha: boolean): string[] {
  return series.filter((s) => s.porDefecto === "si" || pantallaAncha).map((s) => s.clave);
}

/**
 * Las series acumuladas de enero en adelante. Lo proyectado del año en curso (que empieza en `k+1`) arranca desde lo real acumulado hasta su mes
 * anterior, para que real y proyectado se lean sobre la misma escala. Un mes sin dato corta el trazo y no suma.
 */
export function acumularSeries(series: readonly SerieDibujo[]): SerieDibujo[] {
  return series.map((s) => {
    const primero = s.valores.findIndex((v) => v !== null);
    let acumulado = 0;
    if (s.tipo === "proyectado" && primero > 0) {
      const real = series.find((r) => r.tipo === "real_parcial" && r.anio === s.anio);
      if (real) acumulado = real.valores.slice(0, primero).reduce<number>((a, v) => a + (v ?? 0), 0);
    }
    return {
      ...s,
      valores: s.valores.map((v) => {
        if (v === null) return null;
        acumulado += v;
        return acumulado;
      }),
    };
  });
}

/** Lectura de un mes (para `aria-live`): el valor de cada serie visible y, si ese mes tiene real y proyectado del mismo año, su diferencia. */
export function lecturaDelMes(mes: number, series: readonly SerieDibujo[], acumulado = false): string {
  const con = series.map((s) => ({ s, v: s.valores[mes - 1] })).filter((x): x is { s: SerieDibujo; v: number } => x.v !== null && x.v !== undefined);
  if (con.length === 0) return `${nombreMes(mes)}: sin dato`;
  const partes = con.map((x) => `${x.s.etiqueta}: ${unidades(x.v)}`);
  if (!acumulado) {
    for (const r of con.filter((x) => x.s.tipo === "real_parcial")) {
      const p = con.find((x) => x.s.tipo === "proyectado" && x.s.anio === r.s.anio);
      if (p) partes.push(`real − proyectado de ${r.s.anio}: ${unidadesConSigno(r.v - p.v)}`);
    }
  }
  return `${nombreMes(mes)}${acumulado ? " (acumulado)" : ""} · ${partes.join(" · ")}`;
}

/** El pie del gráfico en texto: «2027 proyecta 52,708 u, +5.4 % sobre el cierre 2026; el mes mayor es diciembre». */
export function descripcionGrafico(t: Pick<TableroApi, "kpis" | "series" | "proyeccion">): string {
  const y1 = t.proyeccion.anio_siguiente;
  const c = comparativo(t, "sig_vs_cierre");
  const serie = t.series.find((s) => s.tipo === "proyectado" && s.anio === y1);
  let mayor = "";
  if (serie) {
    let iMax = -1;
    serie.meses.forEach((v, i) => {
      if (v !== null && (iMax < 0 || v > (serie.meses[iMax] ?? 0))) iMax = i;
    });
    if (iMax >= 0) mayor = `; el mes mayor es ${MESES_LARGOS[iMax]}`;
  }
  const estimado = t.kpis.exactitud === "estimado" ? " (estimado)" : "";
  return `${y1} proyecta ${unidades(t.kpis.siguiente)} u${estimado}${c && c.total.pct !== null ? `, ${porcentaje(c.total.pct)} sobre el cierre ${t.proyeccion.anio_en_curso}` : ""}${mayor}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Tabla mensual
// ─────────────────────────────────────────────────────────────────────────────

export type FilaMensual = {
  clave: string;
  etiqueta: string;
  /** Doce celdas en texto. */
  celdas: string[];
  total: string;
  /** Enero a `k'`. */
  acumulado: string;
  /** Lo proyectado va en cursiva Y con «proy.» en el `title` y para el lector de pantalla. */
  proyectado: boolean;
  estimado: boolean;
  variacion: boolean;
};

export const TEXTO_SIN_CARGA = "sin carga publicada";

/** Identificador de la tabla mensual: es la alternativa exacta del gráfico (`aria-describedby`). */
export const ID_TABLA_MENSUAL = "tabla-mensual";

/** Las filas de la tabla mensual (§4.8), que es la alternativa exacta del gráfico. Un mes sin dato sale «—». */
export function filasTablaMensual(t: Pick<TableroApi, "tabla_mensual" | "datos">): FilaMensual[] {
  const nino = new Set(t.datos.anios_nino);
  const kPrima = t.datos.k_prima;
  return t.tabla_mensual.filas.map((f) => {
    const variacion = f.tipo === "variacion";
    const formato = variacion ? porcentaje : unidades;
    const anio = Number(/^\s*(\d{4})\b/.exec(f.etiqueta)?.[1] ?? NaN);
    const rotuloNino = !variacion && f.tipo !== "sin_nino" && nino.has(anio) && !/ni[ñn]o/i.test(f.etiqueta) ? " (Niño)" : "";
    const hastaK = f.meses.slice(0, kPrima);
    const acumulado = variacion || hastaK.length === 0 || hastaK.some((m) => m === null) ? "—" : unidades(hastaK.reduce<number>((a, m) => a + (m ?? 0), 0));
    return {
      clave: f.clave,
      etiqueta: `${f.etiqueta}${rotuloNino}`,
      celdas: Array.from({ length: 12 }, (_, i) => formato(f.meses[i] ?? null)),
      total: formato(f.total),
      acumulado,
      proyectado: f.tipo === "proyectado",
      estimado: f.exactitud === "estimado",
      variacion,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Desglose
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnaDesglose = { clave: string; titulo: string; valor: (f: FilaDesgloseApi) => string; proyectado?: boolean };

const dos = (anio: number): string => String(anio % 100).padStart(2, "0");

/** Las columnas del desglose (§4.8), en el orden de la ficha; los años salen de la fila del total (no van fijos). */
export function columnasDesglose(total: FilaDesgloseApi, t: Pick<TableroApi, "proyeccion" | "datos">): ColumnaDesglose[] {
  const y = t.proyeccion.anio_en_curso;
  const y1 = t.proyeccion.anio_siguiente;
  const ene = rangoMeses(1, t.datos.k_prima);
  const nino = new Set(t.datos.anios_nino);
  const cols: ColumnaDesglose[] = [];
  const anio = (a: FilaDesgloseApi["anios"][number]): ColumnaDesglose => ({
    clave: `anio-${a.anio}-${a.tipo}`,
    titulo: `${a.anio}${a.tipo === "cierre" ? " cierre" : a.tipo === "real_parcial" ? " (parcial)" : ""}${nino.has(a.anio) ? " (Niño)" : ""}`,
    valor: (f) => unidades(f.anios.find((x) => x.anio === a.anio && x.tipo === a.tipo)?.total ?? null),
    proyectado: a.tipo === "proyectado" || a.tipo === "cierre",
  });
  const ordenados = [...total.anios].sort((a, b) => a.anio - b.anio);
  for (const a of ordenados.filter((x) => x.anio < y)) cols.push(anio(a));
  cols.push({ clave: "ac_anterior", titulo: `${y - 1} ${ene}`, valor: (f) => unidades(f.ac_anterior) });
  cols.push({ clave: "ac_en_curso", titulo: `${y} ${ene}`, valor: (f) => unidades(f.ac_en_curso) });
  for (const a of ordenados.filter((x) => x.anio >= y)) cols.push(anio(a));
  cols.push({ clave: "sig_vs_cierre", titulo: `% ${dos(y1)}/${dos(y)}`, valor: (f) => porcentaje(f.pct.sig_vs_cierre) });
  cols.push({ clave: "sig_vs_anterior", titulo: `% ${dos(y1)}/${dos(y - 1)}`, valor: (f) => porcentaje(f.pct.sig_vs_anterior) });
  cols.push({ clave: "cierre_vs_anterior", titulo: `% ${dos(y)}/${dos(y - 1)}`, valor: (f) => porcentaje(f.pct.cierre_vs_anterior) });
  cols.push({ clave: "ac_vs_ac", titulo: `% ${ene}`, valor: (f) => porcentaje(f.pct.ac_vs_ac) });
  cols.push({ clave: "participacion", titulo: `part. ${y1}`, valor: (f) => participacion(f.participacion_siguiente) });
  return cols;
}

/** Las filas del desglose por lo proyectado del año siguiente, de mayor a menor (orden estable). */
export function ordenarDesglose(filas: readonly FilaDesgloseApi[], anioSiguiente: number): FilaDesgloseApi[] {
  const sig = (f: FilaDesgloseApi) => f.anios.find((a) => a.anio === anioSiguiente)?.total ?? Number.NEGATIVE_INFINITY;
  return filas.map((f, i) => ({ f, i })).sort((a, b) => sig(b.f) - sig(a.f) || a.i - b.i).map((x) => x.f);
}

/**
 * Elegir una fila del desglose la aplica como filtro (D11): la serie mensual de ese elemento se ve en el gráfico. Devuelve el cambio de filtros, o
 * `null` si esa fila no se puede aplicar (no es filtrable, o es una línea que no está en el catálogo de opciones).
 */
export function cambioPorFilaDesglose(dimension: Desglose, fila: Pick<FilaDesgloseApi, "id" | "filtrable">, opciones: OpcionesTableroApi | null): Partial<FiltrosVista> | null {
  if (!fila.filtrable) return null;
  switch (dimension) {
    case "genero":
      return { generos: [fila.id], resto: false };
    case "mundo":
      return { mundo: fila.id };
    case "linea": {
      const l = opciones?.lineas.find((x) => x.id === fila.id);
      return l ? { generos: [l.genero_id], resto: false, mundo: l.mundo_id, linea: l.id } : null;
    }
    case "agrupacion_marca":
      return { am: [fila.id] };
    case "marca":
      return { marca: fila.id };
    case "temporada":
      return esDe(TEMPORADAS_TABLERO, fila.id) ? { temporadas: [fila.id] } : null;
    case "tienda":
      return { tiendas: [fila.id] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Crecimiento declarado, implícito y tendencia
// ─────────────────────────────────────────────────────────────────────────────

export const TEXTO_SIN_DATO = "sin dato";

export const ETIQUETA_ANOMALIA: Record<CrecimientoGMApi["anomalias"][number], string> = { sin_base: "sin base", reemplazada_mismo_dia: "reemplazada el mismo día", sin_nota: "sin nota" };

/** «+5.0 % sobre 2026 corregido»; si el GM (o el Resto) no tiene crecimiento aplicado, «sin dato». */
export function textoDeclarado(c: Pick<CrecimientoGMApi, "declarado_pct" | "sobre_base">, anioEnCurso: number): string {
  if (c.declarado_pct === null) return TEXTO_SIN_DATO;
  return `${porcentaje(c.declarado_pct)}${c.sobre_base ? ` sobre ${anioEnCurso} ${c.sobre_base === "corregida" ? "corregido" : "real"}` : ""}`;
}

/** «v2 · Planner P. · 06 nov 2026». */
export function textoVersion(c: Pick<CrecimientoGMApi, "version" | "autor" | "aprobada_at">): string {
  return [c.version !== null ? `v${c.version}` : null, c.autor, c.aprobada_at ? fechaCorta(c.aprobada_at) : null].filter((x): x is string => Boolean(x)).join(" · ");
}

/** El implícito en la base del declarado primero, y el otro entre paréntesis. */
export function textoImplicito(c: Pick<CrecimientoGMApi, "implicito_sobre_real_pct" | "implicito_sobre_corregida_pct" | "sobre_base" | "con_nino">): string {
  const real = c.implicito_sobre_real_pct;
  const corregida = c.implicito_sobre_corregida_pct;
  if (real === null && corregida === null) return TEXTO_SIN_DATO;
  if (corregida === null || !c.con_nino) return `${porcentaje(real ?? corregida)} sobre real`;
  if (real === null) return `${porcentaje(corregida)} sobre corregido`;
  return c.sobre_base === "bruta" ? `${porcentaje(real)} sobre real (${porcentaje(corregida)} sobre corregido)` : `${porcentaje(corregida)} sobre corregido (${porcentaje(real)} sobre real)`;
}

/** ¿Se muestran las dos cifras de tendencia? (GM con corrección del Niño y corregida distinta de la bruta). */
const dosTendencias = (c: Pick<CrecimientoGMApi, "tendencia_mismas_pct" | "tendencia_mismas_corregida_pct" | "con_nino">): boolean =>
  c.con_nino && c.tendencia_mismas_pct !== null && c.tendencia_mismas_corregida_pct !== null && Math.abs(c.tendencia_mismas_corregida_pct - c.tendencia_mismas_pct) >= 0.05;

/** «-3.9 % corregida del Niño (-5.9 % en bruto)»; sin corrección, una sola cifra. `anteriorNino`: el año anterior también fue del Niño (no se corrige). */
export function textoTendencia(c: Pick<CrecimientoGMApi, "tendencia_mismas_pct" | "tendencia_mismas_corregida_pct" | "con_nino">, anteriorNino = false): string {
  if (c.tendencia_mismas_pct === null && c.tendencia_mismas_corregida_pct === null) return TEXTO_SIN_DATO;
  const nota = anteriorNino && c.con_nino ? " · el año anterior también fue del Niño: sin corregir" : "";
  if (dosTendencias(c)) return `${porcentaje(c.tendencia_mismas_corregida_pct)} corregida del Niño (${porcentaje(c.tendencia_mismas_pct)} en bruto)${nota}`;
  return `${porcentaje(c.tendencia_mismas_pct ?? c.tendencia_mismas_corregida_pct)}${nota}`;
}

/** El semáforo EN TEXTO (§4.8), con la tendencia corregida. */
export function textoSemaforo(c: CrecimientoGMApi): string {
  const afectada = c.tendencia_afectada_nino ? " · tendencia afectada por el Niño" : "";
  switch (c.semaforo) {
    case "coincide":
      return `coincide${afectada}`;
    case "revisar":
      return `revisar${c.desvio_pp !== null ? `: ${puntos(c.desvio_pp)}` : ""}${afectada}`;
    case "contra_tendencia": {
      const tendencia = c.tendencia_mismas_corregida_pct ?? c.tendencia_mismas_pct;
      return `contra la tendencia: declara ${porcentaje(c.declarado_pct)}, la venta va ${porcentaje(tendencia)}${dosTendencias(c) ? " corregida del Niño" : ""}${afectada}`;
    }
    case "sin_dato":
      return `${TEXTO_SIN_DATO}${afectada}`;
  }
}

export const TONO_SEMAFORO: Record<CrecimientoGMApi["semaforo"], "exito" | "alerta" | "neutro"> = { coincide: "exito", revisar: "alerta", contra_tendencia: "alerta", sin_dato: "neutro" };

// ─────────────────────────────────────────────────────────────────────────────
// 11. Cómo se decidió
// ─────────────────────────────────────────────────────────────────────────────

export type VistaDecisiones = {
  anio: number;
  total: string;
  origenes: { clave: string; etiqueta: string; registros: string; unidades: string; parte: string }[];
  autores: { nombre: string; registros: string; unidades: string; fechas: string }[];
  diaPico: string | null;
};

/** Por año: unidades y parte de cada origen, quién decidió (cuántas filas y entre qué fechas) y el día con más decisiones. */
export function vistaDecisiones(d: DecisionesAnioApi): VistaDecisiones {
  const total = d.por_origen.reduce((a, o) => a + o.u, 0);
  return {
    anio: d.anio,
    total: unidades(total),
    origenes: d.por_origen.filter((o) => o.n > 0 || o.u !== 0).map((o) => ({ clave: o.clave, etiqueta: o.etiqueta, registros: unidades(o.n), unidades: unidades(o.u), parte: total > 0 ? participacion(o.u / total, 0) : "—" })),
    autores: d.autores.map((a) => ({
      nombre: a.nombre.trim() === "" ? "(sin nombre)" : a.nombre,
      registros: plural(a.n, "fila", "filas"),
      unidades: `${unidades(a.u)} u`,
      fechas: a.desde === null || a.hasta === null ? "sin fecha" : a.desde === a.hasta ? `el ${fechaCorta(a.desde)}` : `del ${fechaCorta(a.desde)} al ${fechaCorta(a.hasta)}`,
    })),
    diaPico: d.dia_pico ? `El día con más decisiones: ${fechaCorta(d.dia_pico.fecha)} (${plural(d.dia_pico.n, "fila", "filas")}).` : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Datos de apoyo y filas mayores
// ─────────────────────────────────────────────────────────────────────────────

export const ROTULO_APOYO = "Datos de apoyo: estimados, no forman parte de lo que se aprueba";
export const NOTA_COBERTURA = "El índice de cobertura con el que se compra es el de Flujo mensual; este es un dato de contexto del recorte.";

export type FilaSoles = { anio: number; etiqueta: string; valor: string; estimado: boolean };

/** Soles por año: reales, real parcial (enero a `k'`) y estimados. Cada cifra estimada lleva su «estimado» al lado. */
export function filasSoles(t: Pick<TableroApi, "apoyo" | "proyeccion" | "datos">): FilaSoles[] {
  const y = t.proyeccion.anio_en_curso;
  const nino = new Set(t.datos.anios_nino);
  return t.apoyo.soles.anios.map((a) => {
    const base = a.tipo === "real_parcial" ? `${a.anio} real ${rangoMeses(1, t.datos.k_prima)}` : a.tipo === "estimado" && a.anio === y ? `${a.anio} cierre` : a.tipo === "estimado" ? `${a.anio} proyectado` : `${a.anio} real`;
    return { anio: a.anio, etiqueta: `${base}${nino.has(a.anio) ? " (Niño)" : ""}`, valor: soles(a.s), estimado: a.tipo === "estimado" };
  });
}

/** Cómo se valorizó lo proyectado: precio medio, su ventana y cuántas unidades usaron el precio del recorte. */
export function notasSoles(s: TableroApi["apoyo"]["soles"]): string[] {
  const notas = [
    `Lo proyectado se valoriza al precio medio de los últimos 12 meses de cada línea × agrupación de marca (soles netos de IGV ÷ unidades, de ${mesAnio(s.ventana.desde)} a ${mesAnio(s.ventana.hasta)}).`,
  ];
  if (s.precio_medio !== null) notas.push(`Precio medio del recorte: S/ ${s.precio_medio.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por unidad.`);
  if (s.u_sin_precio > 0) notas.push(`${unidades(s.u_sin_precio)} u de pares sin venta en esos meses se valorizaron al precio medio del recorte.`);
  return notas;
}

export type DatoCobertura = { etiqueta: string; valor: string; estimado: boolean };

/** Stock del último mes publicado y meses de cobertura (definición de M8). Con tiendas elegidas no hay CD. */
export function datosCobertura(c: TableroApi["apoyo"]["cobertura"]): DatoCobertura[] {
  const estimado = c.exactitud === "estimado";
  const mes = mesAnio(c.periodo);
  return [
    { etiqueta: `Stock en tiendas (${mes})`, valor: `${unidades(c.stock_tiendas)} u`, estimado: false },
    { etiqueta: `Stock en el CD (${mes})`, valor: c.stock_cd === null ? "no aplica con tiendas elegidas" : `${unidades(c.stock_cd)} u`, estimado: false },
    { etiqueta: "Cobertura con la venta proyectada de los 12 meses siguientes", valor: mesesCobertura(c.imi_proyectado), estimado: estimado && c.imi_proyectado !== null },
    { etiqueta: "Cobertura con la venta real de los últimos 12 meses", valor: mesesCobertura(c.imi_real), estimado: false },
  ];
}

export type FilaMayor = { fila: string; vigente: string; participacion: string; crecimiento: string };

/** Las filas mayores (GML × agrupación de marca) del recorte en el año siguiente, con su participación y su crecimiento sobre su base. */
export function filasMayores(mayores: TableroApi["mayores"]): FilaMayor[] {
  return mayores.slice(0, FILAS_MAYORES).map((m) => ({ fila: m.fila, vigente: unidades(m.vigente), participacion: participacion(m.participacion), crecimiento: m.crecimiento_pct === null ? "sin base" : porcentaje(m.crecimiento_pct) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Decisión e historial
// ─────────────────────────────────────────────────────────────────────────────

export const OPCIONES_RESULTADO: readonly { id: ResultadoAprobacion; etiqueta: string }[] = [
  { id: "aprobada", etiqueta: "Aprobar" },
  { id: "con_observaciones", etiqueta: "Aprobar con observaciones" },
  { id: "rechazada", etiqueta: "Rechazar" },
];

export const TEXTO_CONFIRMO = "Revisé las alertas y las cifras de toda la proyección";
export const TEXTO_EN_TRABAJO_AL_DECIDIR = "Si se cierra sin cambiar cifras, tu aprobación sigue vigente; si cambia una cifra, queda invalidada.";
export const TEXTO_HUELLA_DISTINTA = "La proyección cambió mientras la mirabas (alguien decidió o recalculó). Vuelve a cargar el tablero y revisa de nuevo. No se registró nada.";

/** Largo como lo cuenta el servidor (y Postgres): por caracteres, tras quitar los espacios de los extremos. */
export const largoComentario = (texto: string): number => [...texto.trim()].length;

export type FormularioDecision = { resultado: ResultadoAprobacion | null; motivo: MotivoDireccion | ""; comentario: string; confirmo: boolean };

/** Por qué no se puede enviar la decisión todavía (`null` = se puede). Las mismas reglas que valida el servidor (R18). */
export function motivoNoEnviar(f: FormularioDecision): string | null {
  if (f.resultado === null) return "Elige aprobar, aprobar con observaciones o rechazar.";
  if (f.resultado !== "aprobada") {
    if (f.motivo === "") return "Para aprobar con observaciones o rechazar, elige un motivo.";
    if (largoComentario(f.comentario) < MIN_COMENTARIO_DIRECCION) return `Para aprobar con observaciones o rechazar, escribe un comentario de al menos ${MIN_COMENTARIO_DIRECCION} caracteres.`;
  }
  if (!f.confirmo) return "Marca que revisaste las alertas y las cifras de toda la proyección.";
  return null;
}

/** El cuerpo del `POST /api/direccion/aprobaciones`. Solo se llama con un formulario válido (`motivoNoEnviar(f) === null`). */
export function cuerpoDecision(f: FormularioDecision & { resultado: ResultadoAprobacion }, t: Pick<TableroApi, "proyeccion" | "huella">, filtros: FiltrosVista): AprobarCuerpoApi {
  const comentario = f.comentario.trim();
  return {
    proyeccion_id: t.proyeccion.id,
    huella_vista: t.huella,
    resultado: f.resultado,
    motivo: f.motivo === "" ? null : f.motivo,
    comentario: comentario === "" ? null : comentario,
    confirmo_revision: true,
    filtros_vistos: filtrosVistos(filtros),
  };
}

export type FilaHistorial = { id: string; fecha: string; quien: string; resultado: ResultadoAprobacion; etiqueta: string; motivo: string; comentario: string; sobre: string; invalidada: string | null };

/** El historial de aprobaciones (§4.10), de la más reciente a la más antigua. */
export function filasHistorial(historial: readonly AprobacionApi[]): FilaHistorial[] {
  return [...historial]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => ({
      id: a.id,
      fecha: fechaHora(a.created_at),
      quien: a.usuario_nombre,
      resultado: a.resultado,
      etiqueta: ETIQUETA_RESULTADO[a.resultado],
      motivo: a.motivo ? etiquetaMotivo(a.motivo) : "",
      comentario: a.comentario ?? "",
      sobre: a.estado_proyeccion === "en_trabajo" ? "en trabajo" : "cerrada",
      invalidada: !a.invalidada ? null : a.invalidada_por === "version_huella" ? "invalidada por un cambio en el cálculo de la huella" : "invalidada: la proyección cambió después",
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Excel
// ─────────────────────────────────────────────────────────────────────────────

/** `proyeccion-2026-2027-direccion.xlsx` (el mismo patrón de nombre que los Excel de M7). */
export function nombreArchivoDireccion(anioEnCurso: number): string {
  return `proyeccion-${anioEnCurso}-${anioEnCurso + 1}-direccion.xlsx`;
}

const nombresDe = (ids: readonly string[], catalogo: readonly { id: string; nombre: string }[] | undefined): string => (ids.length === 0 ? "—" : ids.map((id) => catalogo?.find((x) => x.id === id)?.nombre ?? id).join(", "));

/** Los filtros en texto para la hoja `FILTROS`, con nombres del catálogo. */
export function filtrosEnTexto(f: FiltrosVista, opciones: OpcionesTableroApi | null, t: Pick<TableroApi, "proyeccion">): [string, string][] {
  const uno = (id: string | null, catalogo: readonly { id: string; nombre: string }[] | undefined) => (id === null ? "—" : (catalogo?.find((x) => x.id === id)?.nombre ?? id));
  const tiendas = f.tiendas.length === 0 ? "—" : f.tiendas.map((id) => opciones?.tiendas.find((x) => x.id === id)?.codigo ?? id).join(", ");
  return [
    ["géneros", nombresDe(f.generos, opciones?.generos)],
    ["Resto", f.resto ? "sí" : "no"],
    ["mundo", uno(f.mundo, opciones?.mundos)],
    ["línea", uno(f.linea, opciones?.lineas)],
    ["temporadas", f.temporadas.length === 0 ? "—" : f.temporadas.map((x) => ETIQUETA_TEMPORADA[x]).join(", ")],
    ["agrupaciones de marca", nombresDe(f.am, opciones?.agrupaciones_marca)],
    ["unidad de marca", uno(f.marca, opciones?.unidades_marca)],
    ["tiendas", tiendas],
    ["bloque", ETIQUETA_BLOQUE(t.proyeccion.anio_siguiente)[f.bloque]],
    ["desglose", ETIQUETA_DESGLOSE[f.desglose]],
  ];
}

/** Las hojas del Excel (§4.9), con exactamente lo que la pantalla tiene cargado. `ahora`: instante de la descarga. */
export function hojasTablero(args: { tablero: TableroApi; opciones: OpcionesTableroApi | null; filtros: FiltrosVista; bloqueos: VistaBloqueos; historial: readonly AprobacionApi[]; ahora: string }): Record<string, Hoja> {
  const t = args.tablero;
  const bloqueos: EntradaExcelDireccion["bloqueos"] = [];
  if (args.bloqueos.estado === "listo") {
    for (const b of args.bloqueos.duros) bloqueos.push({ nivel: ROTULO_NIVEL.bloquea.palabra, codigo: b.codigo, texto: [b.mensaje, ...b.detalles].join(" · ") });
    for (const b of args.bloqueos.forzables) bloqueos.push({ nivel: ROTULO_NIVEL.forzable.palabra, codigo: b.codigo, texto: [b.mensaje, ...b.detalles].join(" · ") });
  }
  const lineaBloqueos = lineaResumenBloqueos(args.bloqueos);
  const comparada = t.comparada ? `${t.comparada.nombre}${t.comparada.motivo === "aprobada" ? " (la última aprobada)" : ""} · datos hasta ${mesAnio(t.comparada.hasta_periodo)}` : "sin comparar";
  const entrada: EntradaExcelDireccion = {
    tablero: t,
    textos: {
      cabecera: textoCabecera(t.proyeccion),
      estado: textoEstadoDireccion(t.decidir.estado, t.decidir.vigente ?? t.decidir.ultima),
      cerrada_por: t.proyeccion.estado === "cerrada" ? `${t.proyeccion.cerrada_por_nombre ?? "—"}${t.proyeccion.cerrada_at ? ` el ${fechaCorta(t.proyeccion.cerrada_at)}` : ""}` : "—",
      vigente: t.decidir.vigente ? `${ETIQUETA_RESULTADO[t.decidir.vigente.resultado]} por ${t.decidir.vigente.usuario_nombre} el ${fechaCorta(t.decidir.vigente.created_at)}` : "sin aprobación vigente",
      lineas: [...t.decidir.lineas, ...(lineaBloqueos ? [lineaBloqueos] : [])],
      comparada,
      datos_hasta: mesAnio(t.proyeccion.hasta_periodo),
      ultimo_publicado: mesAnio(t.datos.ultimo_publicado),
      descargado: fechaHora(args.ahora),
      nota_exactitud:
        t.filtros.exactitud === "estimado"
          ? "Hay cifras ESTIMADAS en este recorte (atribución por tienda o participación por marca): van marcadas en la columna EXACTITUD."
          : "Las unidades de este recorte son exactas (lo guardado en la proyección y la venta publicada). Los soles proyectados y la cobertura son siempre datos de apoyo estimados.",
      recorte: textoRecorte(t.filtros).join(" · "),
    },
    filtros: filtrosEnTexto(args.filtros, args.opciones, t),
    pasos: (puenteTotal(t)?.lineas ?? []).map((l) => l.etiqueta),
    bloqueos,
    crecimientos: t.crecimientos.map((c) => ({
      declarado: textoDeclarado(c, t.proyeccion.anio_en_curso),
      version: textoVersion(c),
      tendencia: textoTendencia(c, t.datos.anios_nino.includes(t.proyeccion.anio_en_curso - 1)),
      semaforo: textoSemaforo(c),
      anomalias: c.anomalias.map((a) => ETIQUETA_ANOMALIA[a]).join(", "),
    })),
    historial: filasHistorial(args.historial).map((h) => ({ fecha: h.fecha, quien: h.quien, resultado: h.etiqueta, motivo: h.motivo, comentario: h.comentario, sobre: h.sobre, invalidada: h.invalidada ?? "no" })),
    atribucion: notasAtribucion(t),
  };
  return hojasDireccion(entrada);
}
