/**
 * Contrato JSON del flujo de M8 (docs/modulos/08-flujo-y-compras.md, §0.5, §0.6, §0.9, §0.10 y sección 7; `0.13.0`). ARCHIVO
 * AUTOCONTENIDO: lo importa también la pantalla, así que no importa de `@supabase/*` ni de módulos de servidor (solo tipos de
 * contratos hermanos). Congelado al terminar T0: si falta un campo, se pide a `backend`.
 *
 * Convenciones: meses `aaaa-mm`; unidades enteras e IMI con un decimal, redondeados AL SERIALIZAR (el cálculo va en flotante);
 * `pct_directo` en puntos 0–100 (`PctDirectoObservado` de M13: nunca la fracción); `GET /api/flujo` entrega unidades, nunca
 * `venta_soles` ni costo vendido de M5.
 *
 * Respuestas de las rutas de `0.13.0` (todas dentro de `{ data }`):
 *   GET /api/flujo                       → FlujoApi            (filtros en el servidor; caché por huella)
 *   GET /api/flujo/fila                  → FilaFlujoDetalleApi (con la historia de doce meses, que la lista no trae)
 *   GET /api/flujo/huecos                → HuecosApi           (tarjetas ordenadas por saldo descendente)
 *   GET /api/flujo/conciliacion          → ConciliacionApi     (nunca escribe)
 *   GET /api/flujo/parametros            → ParametrosFlujoApi
 *   PUT /api/flujo/parametros            → ParametrosFlujoApi
 *   POST /api/flujo/conciliacion/aceptar → RespuestaAceptarApi
 * Errores: `{ error, codigo }` con `CodigoErrorFlujo` (y los de compras en «aceptar»), su estado en `ESTADO_HTTP_ERROR_FLUJO` y su
 * texto en `MENSAJE_ERROR_FLUJO`.
 */
import type { CodigoErrorCompra, CompraApi } from "@/lib/compras/tipos-api";
import type { Mes, TipoLinea } from "@/lib/compras/tipos";
import type { PctDirectoObservado } from "@/lib/intercompany/tipos-api";
import type { Temporada, TemporadasConfig } from "@/lib/marcas-barrer/tipos-api";

export type { Mes, PctDirectoObservado, Temporada, TemporadasConfig };

// ─── Señales ───

export const SENALES = ["quiebre", "falta", "exceso", "al_dia", "sin_demanda", "sin_curva"] as const;
export type Senal = (typeof SENALES)[number];

/** Orden de gravedad del resumen: `quiebre` > `falta` > `exceso` > `al_dia`; `sin_curva` y `sin_demanda` se muestran aparte. */
export const ORDEN_SENAL: Record<Senal, number> = { quiebre: 0, falta: 1, exceso: 2, al_dia: 3, sin_demanda: 4, sin_curva: 5 };

export const ETIQUETA_SENAL: Record<Senal, string> = {
  quiebre: "Quiebre",
  falta: "Falta",
  exceso: "Exceso",
  al_dia: "Al día",
  sin_demanda: "Sin demanda",
  sin_curva: "Sin curva",
};

/** Un carácter por periodo en `SerieFlujoApi.senal`; `-` en `k'` (el mes publicado no lleva señal). */
export const CARACTER_SENAL: Record<Senal, string> = { quiebre: "q", falta: "f", exceso: "x", al_dia: "a", sin_demanda: "d", sin_curva: "c" };
export const CARACTER_SENAL_K = "-";

/** Decodifica un carácter de `SerieFlujoApi.senal`; `null` para `-` o cualquier otro. */
export function senalDeCaracter(caracter: string): Senal | null {
  for (const s of SENALES) if (CARACTER_SENAL[s] === caracter) return s;
  return null;
}

// ─── Avisos ───

export type AvisoFlujo =
  | "cerrada_atrasada"
  | "horizonte_corto"
  | "cerrada_sin_periodo"
  | "cerrada_metodo_anterior"
  | "config_cambiada"
  | "stock_en_tiendas_inactivas"
  | "stock_sin_clave"
  | "entregas_sin_confirmar"
  | "filas_sin_curva";

/** Textos fijos de los avisos de cabecera; los que llevan cifras (`entregas_sin_confirmar`, `filas_sin_curva`, …) las pone la pantalla. */
export const TEXTO_AVISO_FLUJO: Record<AvisoFlujo, string> = {
  cerrada_atrasada: "La proyección cerrada es más antigua que el último mes publicado: la demanda puede estar vieja. Cierra una nueva.",
  horizonte_corto: "Solo hay una proyección cerrada del año anterior: el horizonte llega hasta diciembre de ese año.",
  cerrada_sin_periodo: "La proyección cerrada no trae el periodo de referencia: el desglose por marca puede no coincidir con el del stock.",
  cerrada_metodo_anterior: "La cerrada se calculó antes de 0.10.8: aperturas y crecimientos con el método anterior; cierra una nueva.",
  config_cambiada:
    "Cambiaron marcas relevantes, modalidades o conjuntos después de cerrar: el desglose por marca de la demanda puede no coincidir con el del stock.",
  stock_en_tiendas_inactivas: "Hay stock en tiendas desactivadas: no cuenta en el flujo futuro.",
  stock_sin_clave: "Hay stock que no se pudo ubicar en ninguna fila del flujo (marca o equivalencia sin clasificar).",
  entregas_sin_confirmar: "Hay entregas vencidas sin confirmar que el flujo sigue esperando: si ya llegaron, se cuentan dos veces hasta que confirmes su ingreso.",
  filas_sin_curva: "Hay filas con venta proyectada sin curva de estacionalidad: quedan fuera del IMI total.",
};

export type AvisoFila =
  | "intercompany_no_aplicable"
  | "sin_participaciones"
  | "stock_negativo"
  | "sin_curva"
  | "fila_sin_proyeccion"
  | "entregas_vencidas"
  | "posible_doble_conteo"
  | "demanda_parcial_sin_curva"
  | "regla_cambia_en_horizonte"
  | "regla_futura";

export type AvisoConciliacion = "ingreso_sin_registrar" | "recepcion_sin_respaldo" | "salida_neta" | "sin_mes_anterior" | "reclasificacion_probable";

// ─── Series y meses ───

/**
 * Una serie por magnitud, alineada con `datos.periodos` = `[k', k'+1 … H]` (sin historia: va en el detalle). Unidades enteras e IMI
 * con un decimal. `senal` y `fuera_de_rango` son cadenas de un carácter por periodo (`CARACTER_SENAL`; `"0"` o `"1"`).
 */
export type SerieFlujoApi = {
  demanda: number[];
  /** Entregas pendientes y recepciones de `m > k'`; en `k'` va el ingreso inferido del inventario. */
  ingresos: number[];
  /** `Σ_B R^B`: reposición directa esperada, solo en filas con subflujo (§0.9); `null` en el resto. */
  reposicion: number[] | null;
  stock: number[];
  /** `null` si no hay VPM (`sin_demanda` o `sin_curva`). Nunca negativo. */
  imi: (number | null)[];
  saldo: number[];
  exceso: number[];
  senal: string;
  fuera_de_rango: string;
};

export type MesFlujoApi = {
  periodo: Mes;
  /** `true` en los meses publicados (`≤ k'`): `demanda` es la venta real. */
  real: boolean;
  demanda: number;
  /** `m > k'`: entregas pendientes y recepciones; `m ≤ k'`: ingreso inferido del inventario. */
  ingresos: number;
  ingreso_inferido: number | null;
  salida_inferida: number | null;
  recepciones_registradas: number | null;
  stock_fin: number;
  vpm: number | null;
  imi: number | null;
  objetivo_min: number;
  tope: number;
  saldo: number;
  exceso: number;
  senal: Senal;
  fuera_de_rango: boolean;
  /** `true` si el VPM de este mes usó demanda repetida más allá del horizonte. */
  extendido: boolean;
};

/** El ingreso `[desde, hasta]` y el % directo observado agregado de doce meses (§0.14, supuesto 6). */
export type PctDirectoObservado12mApi = { desde: Mes; hasta: Mes; valor: number };

export type SubflujoApi = {
  marca_id: string;
  marca: string;
  regla_id: string;
  imi_min: number;
  imi_max: number;
  /** Puntos 0–100. */
  pct_directo: number;
  /** Del último mes conciliado, en puntos 0–100 (armado con `armarPctDirectoObservado`). */
  pct_directo_observado: PctDirectoObservado | null;
  /** Agregado de los doce meses: `Σ max(0, Ing^B − Rec^B) ÷ Σ V^B`. Se infla si no se registran las compras al CD de la marca. */
  pct_directo_observado_12m: PctDirectoObservado12mApi | null;
  /** Fracción 0–1. */
  part: number;
  stock_k: number;
  meses: (MesFlujoApi & { reposicion_esperada: number })[];
  resumen: { senal: Senal; imi_k: number | null; saldo_n_meses: number };
};

// ─── Conciliación (§0.5, 4.3b) ───

/** Confirmar el ingreso de una entrega en el mes de la fila conciliada (el mes X). */
export type SugerenciaApi = {
  tipo: "vencida" | "adelantada";
  linea_id: string;
  compra_id: string;
  compra_numero: string;
  entrega_id: string;
  periodo_entrega: Mes;
  unidades: number;
  /** `false` en los lotes en `0.13.0`: la pantalla muestra «Ver compra». */
  boton: boolean;
};

export type ConciliacionFilaApi = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  ruta: string;
  agrupacion_marca: string;
  /** Filas «de la cual JH»: la marca del subflujo; nulo en la fila completa. */
  marca_id: string | null;
  marca: string | null;
  /** Mes conciliado = el mes X de las sugerencias. */
  periodo: Mes;
  venta: number;
  stock_inicio: number | null;
  stock_fin: number;
  ingreso_inferido: number | null;
  salida_inferida: number | null;
  recepciones_registradas: number;
  entregas_programadas: number;
  sin_registrar: number;
  sin_respaldo: number;
  avisos: AvisoConciliacion[];
  sugerencias: SugerenciaApi[];
  /** Solo filas de marca con regla: `max(0, Ing^B − Rec^B) ÷ V^B` en puntos 0–100 y el `pct_directo` de la regla al lado. */
  pct_directo_observado: PctDirectoObservado | null;
  pct_directo_regla: number | null;
  mia: boolean;
};

export type TotalesConciliacionApi = {
  venta: number;
  ingreso_inferido: number;
  salida_inferida: number;
  recepciones_registradas: number;
  entregas_programadas: number;
  sin_registrar: number;
  sin_respaldo: number;
};

/** «Avisos del mes»: cuántas filas lo tienen (`unidades` solo en `salida_neta`, con signo). */
export type AvisoMesConciliacionApi = { aviso: AvisoConciliacion; filas: number; unidades: number | null };

export type ConciliacionApi = {
  periodo: Mes;
  mes_anterior_publicado: boolean;
  filas: ConciliacionFilaApi[];
  totales: TotalesConciliacionApi;
  avisos: AvisoMesConciliacionApi[];
};

export type RespuestaAceptarApi = { compra: CompraApi; conciliacion: ConciliacionFilaApi };

// ─── Filas ───

export type ResumenFilaApi = {
  senal: Senal;
  imi_k: number | null;
  vpm_k: number | null;
  vpm_real_k: number | null;
  /** `Σ C_m` de los próximos `N` meses (`meses_tarjeta`). */
  saldo_n_meses: number;
  /** `Σ I_m` del horizonte. */
  en_camino: number;
  primer_mes_falta: Mes | null;
  exceso_desde: Mes | null;
  primer_mes_fuera_de_rango: Mes | null;
  /** Unidades de entregas vencidas sin confirmar (§0.5). */
  por_confirmar: number;
  /** De ellas, las que el inventario publicado ya respalda. */
  posible_doble_conteo: number;
};

export type FilaFlujoApi = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  nivel: "GML" | "GMLE";
  responsable: { perfil_id: string; nombre: string } | null;
  mia: boolean;
  stock_k: { cd: number; tiendas: number; total: number };
  meses: MesFlujoApi[];
  subflujos_resumen: { marca: string; senal: Senal; imi_k: number | null; rango: [number, number] }[];
  resumen: ResumenFilaApi;
  avisos: AvisoFila[];
};

/** Fila de la lista: `serie` en lugar de `meses` y sin nombres (van en `catalogo`). */
export type FilaFlujoListaApi = Omit<
  FilaFlujoApi,
  "meses" | "genero" | "mundo" | "linea" | "equivalencia" | "agrupacion_marca" | "nivel" | "responsable"
> & { serie: SerieFlujoApi };

export type EntregaDetalleApi = {
  compra_id: string;
  numero: string;
  proveedor: string;
  linea_id: string;
  entrega_id: string;
  tipo: TipoLinea;
  marca: string | null;
  agrupacion_marca: string;
  tallas: string;
  unidades: number;
  pendiente: number;
  periodo: Mes;
  vencida: boolean;
  estado: string;
};

export type FilaFlujoDetalleApi = FilaFlujoApi & {
  /** Los doce meses cerrados `k'−11 … k'`. */
  historia: { periodo: Mes; venta: number; stock_fin: number; ingreso_inferido: number | null }[];
  al_barrer: { periodo: Mes; marcas: { marca_id: string; marca: string; unidades: number }[] }[];
  subflujos: SubflujoApi[];
  /** El resto de la fila (`D − Σ D^B`, con el 4–8 general); nulo sin subflujos. */
  resto: { meses: MesFlujoApi[] } | null;
  conciliacion: ConciliacionFilaApi[];
  entregas: EntregaDetalleApi[];
};

// ─── Huecos ───

/** Lo que la tarjeta muestra además del resumen (p. ej. «falta en oct (83) y desde feb», «En camino 500 u (nov)»). */
export type DetalleTarjetaApi = {
  saldo_primer_mes: number;
  exceso_primer_mes: number;
  en_camino_primer_mes: { periodo: Mes; unidades: number } | null;
  /** Primer mes de un nuevo tramo de falta después de uno sin falta. */
  falta_desde: Mes | null;
};

export type TarjetaHuecoApi = Pick<
  FilaFlujoApi,
  "gml_id" | "equivalencia_id" | "agrupacion_marca_id" | "genero" | "mundo" | "linea" | "equivalencia" | "agrupacion_marca" | "mia" | "responsable" | "stock_k" | "resumen" | "subflujos_resumen"
> & { detalle: DetalleTarjetaApi };

// ─── Reparto y reglas (proyecciones reducidas de M12 y M13) ───

/** Proyección reducida de `RepartoVigenteApi` (M12): sin `fuente` ni `hasta_periodo`. */
export type RepartoFlujoApi = {
  marca_id: string;
  marca: string;
  reparto_id: string;
  version: number;
  modo: "anual" | "por_temporada";
  alcance: { generos: string[]; mundos: string[]; lineas: string[] };
  error_reparto_pp: number | null;
  temporadas_usadas: TemporadasConfig;
  filas: { gml_id: string; equivalencia_id: string | null; temporada: Temporada | null; participacion: number }[];
};

/** Proyección reducida de `ReglaIntercompanyApi` (M13): sin `nota` ni `usuario_nombre`. */
export type ReglaFlujoApi = {
  id: string;
  marca_id: string;
  marca: string;
  gml_id: string;
  equivalencia_id: string | null;
  vigente_desde: Mes;
  hasta_derivado: Mes | null;
  imi_min: number;
  imi_max: number;
  /** Puntos 0–100. */
  pct_directo: number;
};

export type ParametrosFlujoApi = {
  imi_min: number;
  imi_max: number;
  meses_tarjeta: number;
  extender_horizonte: boolean;
  temporadas: TemporadasConfig;
  umbral_conciliacion_u: number;
  umbral_conciliacion_pct: number;
  usuario_nombre: string | null;
  updated_at: string | null;
};

/** Cuerpo de `PUT /api/flujo/parametros`: todos los campos (la fila es única y se reemplaza). */
export type ParametrosFlujoCuerpo = Omit<ParametrosFlujoApi, "usuario_nombre" | "updated_at">;

// ─── Lista de flujo ───

export type DatosFlujoApi = {
  cerrada: { id: string; nombre: string; hasta_periodo: Mes; anio_en_curso: number; version_metodo: number; periodo_referencia: { desde: Mes; hasta: Mes } | null };
  /** `hasta_periodo` de la cerrada. */
  k: Mes;
  /** Último mes publicado y terminado: el flujo arranca con su stock. */
  k_prima: Mes;
  horizonte: { desde: Mes; hasta: Mes };
  /** `[k', k'+1 … H]`, una sola vez para todas las series. */
  periodos: Mes[];
  parametros: ParametrosFlujoApi;
  avisos: AvisoFlujo[];
  stock_excluido: { stock: number; unidades: number };
  stock_sin_clave: number;
  /** Entregas vencidas sin confirmar (§0.5) y cuántas de ellas respalda el inventario publicado. */
  por_confirmar: { entregas: number; unidades: number; con_respaldo_entregas: number; con_respaldo_unidades: number };
  /** Filas sin curva: fuera del IMI de los totales (§0.10). */
  filas_sin_curva: { filas: number; venta_anual: number; stock: number };
  huella: string;
};

export type NodoCatalogoFlujoApi = {
  genero_id: string;
  mundo_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  nivel: "GML" | "GMLE";
};

/**
 * Nombres una sola vez (§0.6). `nodos` se indexa por `equivalencia_id` si la fila lo tiene y, si no, por `gml_id`;
 * `responsables` por `genero_id|mundo_id`.
 */
export type CatalogoFlujoApi = {
  nodos: Record<string, NodoCatalogoFlujoApi>;
  agrupaciones: Record<string, string>;
  responsables: Record<string, { perfil_id: string; nombre: string }>;
};

export type CombinacionApi = { genero_id: string; mundo_id: string };

export type FlujoApi = {
  datos: DatosFlujoApi;
  catalogo: CatalogoFlujoApi;
  filas: FilaFlujoListaApi[];
  /** El IMI sin las filas sin curva (§0.10). */
  totales: SerieFlujoApi;
  repartos_vigentes: RepartoFlujoApi[];
  reglas_intercompany: ReglaFlujoApi[];
  mis_combinaciones: CombinacionApi[];
};

/** `GET /api/flujo/huecos`: la cabecera de la lista más las tarjetas (la tarjeta no repite lo que ya está en `datos`). */
export type HuecosApi = {
  datos: DatosFlujoApi;
  /** Los próximos `N` meses del saldo de las tarjetas (`?meses=`, por defecto `parametros.meses_tarjeta`). */
  meses: number;
  tarjetas: TarjetaHuecoApi[];
  mis_combinaciones: CombinacionApi[];
};

// ─── Filtros (query string) ───

export const SOLO_FLUJO = ["falta", "exceso", "quiebre", "por_confirmar"] as const;
export type SoloFlujo = (typeof SOLO_FLUJO)[number];
export const SOLO_CONCILIACION = ["sin_registrar", "sin_respaldo", "entregas_vencidas", "por_confirmar"] as const;
export type SoloConciliacion = (typeof SOLO_CONCILIACION)[number];

export type FiltrosFlujo = {
  genero_id?: string;
  mundo_id?: string;
  linea_id?: string;
  agrupacion_marca_id?: string;
  solo?: SoloFlujo;
  mio?: boolean;
  meses?: number;
};

export type FiltrosConciliacion = Omit<FiltrosFlujo, "solo" | "meses" | "agrupacion_marca_id"> & { periodo?: Mes; solo?: SoloConciliacion };

/** Cuerpo de `POST /api/flujo/conciliacion/aceptar` (sin `huella`: el servidor recalcula). */
export type AceptarSugerenciaCuerpo = { periodo: Mes; linea_id: string; entrega_id: string; unidades: number; revision: number };

// ─── Errores ───

export type CodigoErrorFlujo = "sin_cerrada" | "sin_mes" | "sugerencia_vencida" | "tipo_no_disponible" | "fila_no_encontrada";
/** «Aceptar sugerencia» puede devolver además los de compras (`no_pertenece`, `excede_pendiente`, `compra_cambio`, …). */
export type CodigoErrorAceptar = CodigoErrorFlujo | CodigoErrorCompra;

export const ESTADO_HTTP_ERROR_FLUJO: Record<CodigoErrorFlujo, number> = {
  sin_cerrada: 404,
  sin_mes: 404,
  sugerencia_vencida: 409,
  tipo_no_disponible: 409,
  fila_no_encontrada: 404,
};

export const MENSAJE_ERROR_FLUJO: Record<CodigoErrorFlujo, string> = {
  sin_cerrada: "Todavía no hay una proyección cerrada que alimente el flujo. Cierra una en Proyección.",
  sin_mes: "Ese mes no está publicado en Venta y stock.",
  sugerencia_vencida: "La conciliación cambió: recarga.",
  tipo_no_disponible: "Esta sugerencia es de un lote que toca varias filas: confirma el ingreso desde la compra.",
  fila_no_encontrada: "No encontramos esa fila en el flujo.",
};
