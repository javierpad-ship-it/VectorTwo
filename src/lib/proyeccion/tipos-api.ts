/**
 * Contratos de M7 (docs/modulos/07-proyeccion-anual.md, sección 7). Autocontenido:
 * describe el JSON que viaja y las constantes del método; lo usan igual el
 * servidor y la pantalla. Sin imports de `@supabase/*`, de React ni de Next.
 */

// ─── Constantes del método ───

export const UMBRAL_AVANCE = 0.3;
export const UMBRAL_COBERTURA = 0.25;
export const UMBRAL_COLA_LARGA = 100;
/** Tope de un total anual (unidades): una cifra mayor no cabe en un `integer` de la base ni tiene sentido (mismo tope que una decisión). */
export const MAX_TOTAL = 100_000_000;
/**
 * `0.10.1`: una fila de cola larga con `dispon < UMBRAL_DISPONIBILIDAD` tuvo un quiebre relevante (proxy mensual: tienda-meses con
 * stock al cierre del mes ÷ tienda-meses totales; ficha 07, «Cambios 0.10.1», punto 2).
 */
export const UMBRAL_DISPONIBILIDAD = 0.75;
/** `0.10.1`: con `F < UMBRAL_APERTURA_TARDIA` la tienda vende menos del 25 % de un año maduro en su año de apertura (aviso `apertura_tardia`, informativo). */
export const UMBRAL_APERTURA_TARDIA = 0.25;
/** `0.10.8` (07d): aviso informativo `venta_esperada_fuera_de_rango` si `12·V` cae fuera de estos múltiplos de la venta anual media de una tienda de la red. */
export const VENTA_ESPERADA_RANGO = { min: 0.3, max: 3 } as const;
export const RAMPA_MADURACION: readonly number[] = [1, 1, 1];
export const RAMPA_MAX = 5;
export const MESES_MIN_AVANCE = 3;
export const MESES_UNIVERSO = 24;
export const MESES_COMPOSICION = 12;
export const ANIOS_HISTORICO = 3;
export const TANDA_GML = 60;
export const PARALELO = 3;
export const TANDA_UPSERT = 500;
export const CALCULO_CADUCA_MIN = 15;
export const RATIO_MIN = 0.05;
export const RATIO_MAX = 3;
/**
 * Entra en `resumen` para detectar fórmulas cambiadas (como `VERSION_MODELO` de M6). `2`: revisión del avance propio, el factor por
 * mes y el poco avance. `3` (`0.10.1`): venta esperada del año de apertura, cola larga con disponibilidad y participaciones con
 * periodo y eje por marca; una proyección en trabajo con `version_metodo < 3` queda desactualizada hasta recalcular. `4` (`0.10.8`,
 * fichas 07c y 07d): el % de crecimiento del año siguiente es BRUTO (`P = round(B × (1 + g))` con `B` = vigente de `Y` de las mismas
 * tiendas de `Y+1`, sin normalizar por el Niño; vale para la fila, la celda género × mundo y el Resto) y la venta esperada de una
 * tienda nueva es la venta MENSUAL promedio en régimen (año maduro `S = 12 × V`, estacionalizado en los meses abiertos). `5` (`0.14.0`,
 * ficha 06e): el % aprobado es «sobre `Y` corregido del Niño» (`P = round(B' × (1 + g))` con `B'` = `B` dividida por el factor RELATIVO de su
 * temporada, por fila); una versión aprobada antes de `0.14.0` (`sobre_base = 'bruta'`) se sigue aplicando como en el 4. Sin Niño en `Y` no cambia
 * ninguna cifra. Una proyección en trabajo de método 4 queda desactualizada («método nuevo») y no se cierra ni forzando.
 */
export const VERSION_METODO = 5;
/**
 * `0.10.8` (07d §7): versión mínima del método con que debe estar calculada una proyección cerrada para que M8 la use sin avisar
 * (`cerrada_metodo_anterior`). Constante FIJA (no `VERSION_METODO`): una subida futura del método no invalida en M8 cerradas válidas.
 * `0.14.0` (06e D12): sube a 5, pero una cerrada de método 4 SIGUE sirviendo a M8 con el aviso (no bloquea) hasta el nuevo cierre.
 */
export const VERSION_METODO_MIN_M8 = 5;
/**
 * `0.14.0` (06e D8): umbral único de materialidad del Niño. Un GM (o el Resto) «tiene Niño» solo si `|Σ B' ÷ Σ B − 1| ≥ 0,5 %`
 * (`correccionMaterial`, `factor-nino.ts`). Pantalla (`hay_nino`) y M7 (`gm_con_nino`) usan la misma función.
 */
export const UMBRAL_CORRECCION_NINO = 0.005;
/** `0.14.0` (06e D4): meses del periodo con dato que hacen falta para que el sistema calcule un factor del Niño (con menos, lo escribe el planner). */
export const MIN_MESES_FACTOR = 2;
/** `0.14.0` (06e §2.1): sobre qué base se interpreta un %: `bruta` = `Y+1 ÷ Y real − 1` (versiones de antes de `0.14.0`), `corregida` = sobre `Y` corregido del Niño. */
export const SOBRE_BASE = ["bruta", "corregida"] as const;
export type SobreBase = (typeof SOBRE_BASE)[number];
/** `0.14.0` (06e §5.2): fórmula con que se calcula `ratio_calculado` desde `0.14.0` (`factores_volumen_atipico.formula`). */
export const FORMULA_FACTOR_RELATIVO = "relativo_periodo";
/** `0.10.8` (07c §2.5): géneros que son columna de la matriz de crecimientos, en este orden (se resuelven por `upper(trim(nombre))`). */
export const GENEROS_MATRIZ: readonly string[] = ["HOMBRE", "MUJER"];
/** `0.10.8` (07c): un % fuera de ±50 es «extremo» (la pantalla avisa, no bloquea). */
export const CRECIMIENTO_EXTREMO_PCT = 50;

// ─── Enumeraciones ───

export const ESTADOS_PROYECCION = ["en_trabajo", "cerrada", "archivada"] as const;
export type EstadoProyeccion = (typeof ESTADOS_PROYECCION)[number];
export type Bloque = "mismas" | "nuevas" | "cierres";
export type Subbloque = "nuevas_anterior" | "aperturas";
export type TemporadaFactor = "invierno" | "verano";

export type MotivoDesactualizada =
  | "cargas_nuevas"
  | "curvas_cambiadas"
  | "nivel_cambiado"
  | "tiendas_cambiadas"
  | "factores_cambiados"
  | "periodos_cambiados"
  | "recalculo_pendiente"
  /** `0.10.1`: la proyección se calculó con una versión anterior del método (`resumen.version_metodo < VERSION_METODO`). */
  | "version_metodo"
  /**
   * `0.10.8` (07c): la matriz de crecimientos guardada no es la que aplicó el último cálculo (`resumen.huella_crecimientos`), o un nodo con
   * filas base cambió de mundo (`resumen.gm_gml` ≠ catálogo). No se puede saltar con `forzar` al cerrar.
   */
  | "crecimientos_cambiados"
  /**
   * M12 (`0.11.0`): cambió la configuración de 02b (marcas relevantes, modalidades o conjuntos) después de calcular
   * (`proyecciones.huella_flujo`); una calculada antes de M12 (huella nula) también. Una proyección cerrada no se toca.
   */
  | "config_cambiada"
  /** `0.14.0` (06e §3.3): cambió la agrupación de alguna línea con Niño y con ella su factor. No se puede saltar con `forzar` al cerrar. */
  | "temporada_cambiada";

export type MotivoBloqueo = "sin_meses" | "meses_faltantes" | "tienda_sin_apertura_con_venta" | "sin_mismas_tiendas";

export type AvisoFila =
  | "sin_curva"
  | "curva_incompleta"
  | "curva_cambio"
  | "propuesta_cambio"
  | "avance_bajo"
  | "plan_anterior"
  | "sin_venta_anio"
  | "sin_base"
  | "sin_factor"
  | "objetivo_atipico"
  | "temporadas_mezcladas"
  | "mes_negativo"
  | "quiebre"
  | "cola_larga"
  | "nivel_cambiado"
  | "bloque_cambiado"
  | "sin_venta_esperada"
  | "sin_referente"
  | "referente_sin_historia"
  | "fijadas_exceden"
  | "cierre_no_proyectado"
  | "apertura_dudosa"
  | "cierre_dudoso"
  // 0.10.1 (el aviso por zona de la 0.10.0 se eliminó: decisión 20 de la ronda 4)
  /** Cola larga con quiebres relevantes y demanda corregida bajo el umbral: informativo, se cierra con la propuesta. */
  | "cola_larga_con_quiebres"
  /**
   * Cola larga con quiebres relevantes y demanda corregida `A_f` sobre el umbral: bloquea el cierre hasta decidirla. Su PROPUESTA es
   * `A_f` y el avance normal va en `referencia_alternativa` (decisión de Javier, ronda 4).
   */
  | "revision_cola_larga"
  /** Sin stock cargado en `W12` para la fila: no se pudo medir la disponibilidad (cola larga normal). */
  | "sin_stock_historico"
  /** Tienda cuya venta esperada cubre menos del 25 % de un año maduro (abre tarde o rampa muy baja): informativo. */
  | "apertura_tardia"
  /** Una cifra del método (unidades maduras, propuesta de una tienda nueva) no es finita o pasa de `MAX_TOTAL`: no se propone (queda sin cifra). */
  | "cifra_excesiva"
  /** `0.10.8` (07d), de tienda: abre y cierra dentro de `Y+1`; no se proyecta y un total que se escriba no llega a la Matriz ni a M8. */
  | "apertura_y_cierre"
  /** `0.10.8` (07d), de tienda e informativo: `12·V` cae fuera de `[0,3, 3]` veces la venta anual media de una tienda de la red. */
  | "venta_esperada_fuera_de_rango";

export type Metodo =
  | "avance"
  | "plan_anterior"
  | "crecimiento"
  | "apertura"
  | "avance_propio"
  | "maduro_propio"
  | "cierre"
  | "sin_propuesta";

export type OrigenDecision = "propuesta" | "manual" | "escalada";
export type OrigenMes = "real" | "proyectado";
export type ClaseAnioFila = "normal" | "atipico" | "en_curso";
export type EstadoLinea = "sin_proyectar" | "parcial" | "proyectada" | "curva_cambio" | "propuesta_cambio";

// ─── Tiendas y bloques ───

export type TiendaBloqueApi = {
  tienda_id: string;
  codigo: string;
  nombre: string;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  motivo: string;
  clave: string;
  subbloque?: Subbloque;
  /** Venta MENSUAL promedio esperada (S/ sin IGV, en régimen; `0.10.8`). Antes de `version_metodo = 4` era la del año de apertura. */
  venta_esperada?: number | null;
  referente_id?: string | null;
  rampa?: number[];
  zona?: string | null;
};

export type BloquesAnioApi = {
  mismas: TiendaBloqueApi[];
  nuevas: TiendaBloqueApi[];
  cierres: TiendaBloqueApi[];
  fuera: TiendaBloqueApi[];
};
export type BloquesApi = Record<number, BloquesAnioApi>;

/** Quién cambió qué parámetro y cuándo (auditoría de `PATCH`): se guarda en `parametros.ediciones` (jsonb), sin tabla nueva. */
export type EdicionParametros = {
  por: string | null;
  por_id: string | null;
  /** ISO. */
  en: string;
  cambios: { campo: string; de: number | number[]; a: number | number[] }[];
};
/** Cuántas ediciones de parámetros se conservan (las más recientes). */
export const MAX_EDICIONES_PARAMETROS = 50;

export type ParametrosProyeccion = {
  crecimiento_pct_defecto: number;
  umbral_avance: number;
  umbral_cobertura: number;
  umbral_cola_larga: number;
  /** `0.10.1`: por debajo de esta disponibilidad (0 a 1) una fila de cola larga tuvo un quiebre relevante. Por defecto `UMBRAL_DISPONIBILIDAD`. */
  umbral_disponibilidad: number;
  rampa_maduracion: number[];
  factores_usados: {
    anio: number;
    temporada: TemporadaFactor;
    ratio: number | null;
    origen: "calculado" | "manual" | null;
    /** `0.14.0` (06e §3.3): fórmula y huella de cargas del factor con que se calculó. */
    formula?: string | null;
    huella_cargas?: string | null;
  }[];
  bloques: BloquesApi;
  /** `0.10.3`: historial de quién editó parámetros (umbrales, crecimiento, rampa) y qué cambió; las más recientes al final. */
  ediciones?: EdicionParametros[];
  /** Cambiaste parámetros o «datos hasta» después de calcular: hay que recalcular (`PATCH` lo marca, `calcular` lo limpia). */
  recalculo_pendiente?: boolean;
  /**
   * `0.10.8` (07c §2.2): `crecimiento_pct_defecto` ES el «Resto» de la matriz de crecimientos (bruto). Quién lo fijó y su nota; se escribe
   * solo con `PUT …/crecimientos`.
   */
  crecimiento_resto_meta?: { nota: string | null; por_nombre: string | null; at: string };
  /** `0.10.8` (07c §2.6): meta informativa de crecimiento bruto de mismas tiendas (`-95..500`) o `null`. No se aplica a ninguna fila. */
  crecimiento_objetivo_pct?: number | null;
  /**
   * `0.12.1` (06d §2.2): el Resto con que se calculó la proyección (el aprobado vigente o, sin él, el provisional = `crecimiento_pct_defecto`).
   * `crecimiento_id = null` = se usó el Resto provisional. Sin la clave (calculada antes de `0.12.1`), el Resto de la foto es
   * `crecimiento_pct_defecto`. `parametrosDe` debe dejarla pasar.
   */
  crecimiento_resto_usado?: RestoUsadoApi;
};

/** `0.12.1` (06d): el Resto aplicado en un cálculo (`parametros.crecimiento_resto_usado`). */
export type RestoUsadoApi = {
  pct: number;
  crecimiento_id: string | null;
  version: number | null;
  por_nombre: string | null;
  at: string | null;
  /** `0.14.0` (06e §2.2): sobre qué base se aplicó el Resto. Sin la clave (calculada antes de `0.14.0`) se lee `bruta`; el Resto provisional es `corregida`. */
  sobre_base?: SobreBase;
};

/** `0.12.1` (06d §3.1): qué falta aprobar para cerrar (`ProyeccionApi.crecimientos_sin_aprobar`, detalle del `409 crecimientos_sin_aprobar`). */
export type CrecimientosSinAprobarApi = {
  faltan: { clave: string; nombre: string }[];
  /** Se exige el Resto y no hay uno aprobado (el provisional no basta). */
  resto_provisional: boolean;
  /** `0.14.0` (06e §3.3): las vigentes `bruta` de GM con Niño material (y el Resto si es `bruta` y tiene Niño): hay que reaprobarlas para cerrar. */
  reaprobar?: ReaprobarCierreApi[];
};

/** `0.14.0` (06e §3.3): un GM (o el Resto, `clave = "resto"`) cuya versión vigente es `bruta` y que tiene Niño material. */
export type ReaprobarCierreApi = { clave: string; nombre: string; version: number; correccion_pct: number };

/** `0.12.1` (06d §3.1): código del `409` que bloquea el cierre (no se puede forzar). */
export const CODIGO_CRECIMIENTOS_SIN_APROBAR = "crecimientos_sin_aprobar";
/** `0.12.1` (06d §3.1): código del aviso (no bloqueo) de «Antes de proyectar» (`prerrequisitos.avisa`). */
export const CODIGO_CRECIMIENTOS_SIN_APROBAR_ANIO = "crecimientos_sin_aprobar_anio";

// ─── 0.10.8 · 07c: crecimientos por género × mundo ───

/** De dónde sale el % que aplica a una fila base de `Y+1`: su % propio, la celda género × mundo o el Resto (`crecimiento_pct_defecto`). */
export type OrigenCrecimiento = "fila" | "celda" | "resto";

/** `crecimiento_efectivo` de una fila base de `Y+1`. `celda` es el nombre del GM («HOMBRE · FORMAL») si el origen es `celda` (o el GM al que pertenece la fila). */
export type CrecimientoEfectivoApi = {
  pct: number;
  origen: OrigenCrecimiento;
  celda: string | null;
  /** `0.12.1` (06d): versión aprobada del GM o del Resto que dio el %; `null` si es el Resto provisional o un % propio de la fila. */
  version?: number | null;
  /** `0.14.0` (06e §5.1): sobre qué base se aplicó el %. Fila con % propio y Resto provisional: `corregida`. */
  sobre_base?: SobreBase;
  /** `0.12.1` (06d): el % es el Resto provisional de la proyección (`crecimiento_pct_defecto`), no uno aprobado. */
  provisional?: boolean;
};

/** Agregado sobre las filas base activas de `Y+1` de una celda o del Resto. */
export type AgregadoCrecimientoApi = {
  filas: number;
  filas_sin_base: number;
  /** `Σ B`: unidades de `Y` de las mismas tiendas de `Y+1` = peso del conjunto. */
  base: number;
  /** `Σ B` de las filas que siguen la celda (sin % propio y sin total de `Y+1` decidido). */
  base_libre: number;
  /** `siguiente = Σ round(B × (1 + g_fila))`. */
  pct_propio: { filas: number; base: number; siguiente: number; /** `0.14.0`: `Σ B'` de esas filas. */ base_corregida?: number };
  /** `siguiente = Σ decidido de Y+1` (una decidida con % propio cuenta aquí). */
  decididas: { filas: number; base: number; siguiente: number; /** `0.14.0`: `Σ B'` de esas filas. */ base_corregida?: number };
  /** `Σ B''` de las filas con base (método 5: `Σ B'`, la base corregida del Niño). */
  base_normalizada: number;
  /** `0.14.0` (06e §3.3): `Σ B'` de las filas que siguen la celda (`base_libre` corregida). */
  base_libre_corregida?: number;
  /** `Σ B'' ÷ Σ B − 1` en %; `null` sin filas con meses del Niño (o con `Σ B = 0`). Solo referencia. */
  rebote_nino_pct: number | null;
  /** `Σ vigente` de `Y+1` hoy. */
  siguiente_vigente: number;
};

/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type CeldaCrecimientoApi = {
  genero_id: string;
  mundo_id: string;
  /** `null` = sin definir: sigue al Resto. */
  pct: number | null;
  nota: string | null;
  actualizado_por: string | null;
  actualizado_at: string | null;
  /** Ese género no tiene filas base activas de `Y+1` en ese mundo: se ve «—», no se edita y no es obligatoria. */
  sin_filas: boolean;
  agregado: AgregadoCrecimientoApi;
};

/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type RespuestaCrecimientosApi = {
  /** `false` si la proyección está cerrada, archivada o calculándose. */
  editable: boolean;
  anio_en_curso: number;
  anio_siguiente: number;
  /** Bloqueo optimista: se devuelve tal cual en el `PUT`. */
  huella: string;
  /** `false` = `crecimientos_cambiados` o `version_metodo` (la cabecera pide recalcular). */
  al_dia: boolean;
  /** `true` si falta `version_metodo` (proyección de antes de `0.10.8`): `agregado.base = 0` y «Calcular promedio» no sirve. */
  metodo_viejo: boolean;
  /** HOMBRE y MUJER (los que se encontraron en el catálogo), en ese orden. */
  generos: { id: string; nombre: string }[];
  /** Géneros de `GENEROS_MATRIZ` que no se encontraron (la pantalla lo avisa: «sus filas siguen el Resto»). */
  generos_faltantes: string[];
  mundos: { id: string; nombre: string; orden: number | null }[];
  /** Una por género × mundo mostrado, también las vacías y las «sin filas». */
  celdas: CeldaCrecimientoApi[];
  resto: {
    pct: number;
    nota: string | null;
    actualizado_por: string | null;
    actualizado_at: string | null;
    agregado: AgregadoCrecimientoApi;
    por_genero: { genero: string; base: number }[];
  };
  objetivo_pct: number | null;
  /** Para el puente al Total de `Y+1`, sacado de `resumen.totales` (todo en unidades). */
  puente: {
    total_en_curso: number;
    nuevas_anterior: number;
    aperturas: number;
    /** Vigente de `Y+1` de las tiendas que cierran en `Y+1`: SUMA (su `Y` ya salió de `B`). */
    cierres: number;
    /** Tiendas que cierran en `Y+1` sin total decidido (hoy proponen 0). */
    cierres_sin_decidir: number;
  };
};

/** Una celda como entra a `calcularPromedio` (lo que el usuario tiene escrito en pantalla). */
export type CeldaParaPromedio = {
  genero: string;
  mundo: string;
  /** Lo que escribió (`null` = vacía). */
  pct: number | null;
  sin_filas: boolean;
  agregado: AgregadoCrecimientoApi;
};

export type FilaResultadoPromedio = {
  /** Vacíos en el Resto. */
  genero: string | null;
  mundo: string | null;
  base: number;
  pct_escrito: number;
  /** `S_c = pct_propio.siguiente + decididas.siguiente + base_libre × (1 + g_c)`. */
  siguiente: number;
  /** `S_c ÷ B_c − 1` en %; `null` si `B_c = 0`. Con `sobre = 'corregida'`, `base` es `Σ B'` y este es el % «sobre 2026 corregido». */
  pct_resultante: number | null;
  /** `0.14.0`: solo con `sobre = 'corregida'`: `S_c ÷ Σ B − 1` en % («sobre 2026 real»). */
  pct_resultante_real?: number | null;
};

export type ResultadoPromedio = {
  /**
   * `ḡ = Σ B_c g_c ÷ Σ B_c` (ponderado de lo que escribió) en %; `null` si `Σ B = 0`. Con `sobre = 'corregida'` (0.14.0) pondera por `Σ B'` y es
   * «sobre 2026 corregido» (el equivalente sobre real es `ponderado_escrito_real_pct`).
   */
  ponderado_escrito_pct: number | null;
  /** Una por celda con filas, más el Resto al final (`genero = null`). */
  filas: FilaResultadoPromedio[];
  /** `Σ B` REAL de los conjuntos (también con `sobre = 'corregida'`: «sobre 2026 real»). La base corregida va en `base_corregida_total`. */
  base_total: number;
  /** 0.14.0: `Σ B'` (la base corregida del Niño; con método 4, o sin Niño, es `base_total`). */
  base_corregida_total: number;
  /** `Σ S` (mismas tiendas de `Y+1`, con las filas fijadas). */
  siguiente_total: number;
  /** `Σ S ÷ Σ B − 1` en %; `null` si `Σ B = 0`. Con `sobre = 'corregida'` es `Σ S ÷ Σ B' − 1` («sobre 2026 corregido»); el real es `resultante_real_pct`. */
  resultante_pct: number | null;
  /** 0.14.0: `Σ S ÷ Σ B − 1` en % sobre la base REAL; igual a `resultante_pct` con método 4. `null` si `Σ B = 0`. */
  resultante_real_pct: number | null;
  /** 0.14.0: lo escrito (`Σ B'_c (1 + g_c) ÷ Σ B − 1`) expresado sobre la base REAL; igual a `ponderado_escrito_pct` con método 4. `null` si `Σ B = 0`. */
  ponderado_escrito_real_pct: number | null;
  filas_con_pct_propio: number;
  filas_decididas: number;
  /**
   * Comparación con el objetivo global; `null` sin objetivo. El objetivo es «% sobre 2026 real»: todos los `faltan_*` se miden sobre `Σ B` real
   * (`sobre: "real"`), también con `sobre = 'corregida'`.
   */
  objetivo: null | {
    pct: number;
    /** Rótulo: la base del objetivo es siempre la venta REAL de `Y` de las mismas tiendas («sobre 2026 real»); el servidor siempre lo informa. */
    sobre?: "real";
    /** pp que faltan para el objetivo con lo escrito (`objetivo − ḡ_real`); `null` sin base. */
    faltan_pp_escrito: number | null;
    /** pp que faltan con el resultado (`objetivo − resultante_real`). */
    faltan_pp_resultado: number | null;
    /** Unidades que faltan: `Σ B real × (1 + objetivo) − Σ S`. */
    faltan_unidades: number | null;
  };
  /** Puente al Total de `Y+1` de la Matriz: `total = mismas + nuevas_anterior + aperturas + cierres` (los cierres SUMAN). */
  puente: {
    base: number;
    mismas_siguiente: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    cierres_sin_decidir: number;
    total_siguiente: number;
    total_en_curso: number;
    /** `Total Y+1 ÷ Total Y − 1` en %. */
    var_pct: number | null;
  };
  /** `Σ B = 0`: «sin base: recalcula la proyección». */
  sin_base: boolean;
};


/** Cuerpo del `PUT …/crecimientos` (reemplazo completo; lo que no viene se borra). */
/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type GuardarCrecimientosCuerpoApi = {
  huella: string;
  resto: { pct: number; nota?: string | null };
  objetivo_pct: number | null;
  celdas: { genero_id: string; mundo_id: string; pct: number; nota?: string | null }[];
  /** Solo con la respuesta de Javier al `409 filas_manuales`; exige `huella_choque`. */
  resolucion?: "pisar" | "conservar";
  /** Solo con `resolucion = "pisar"`. */
  incluir_decididas?: boolean;
  huella_choque?: string;
};

/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type ResultadoGuardarCrecimientosApi = {
  pisadas: { fila_id: string; pct_anterior: number | null; decidido_anterior: number | null }[];
  conservadas: number;
  /** `fila_id` pisados que, al releer tras el recálculo, volvieron a tener % propio o total (decisión concurrente). */
  revertidas: string[];
  /**
   * Celdas que había guardadas y que este guardado borró porque ya no son editables (típicamente, su mundo se desactivó: la pantalla
   * no las mostraba). Vacío si no se perdió ninguna.
   */
  celdas_descartadas: { genero: string; mundo: string; pct: number }[];
  recalculo: { ok: true } | { ok: false; codigo: string; mensaje: string };
};

/** `data` de la respuesta `200` del `PUT …/crecimientos`: el `GET` recalculado más el resultado del guardado. */
/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type RespuestaGuardarCrecimientosApi = RespuestaCrecimientosApi & ResultadoGuardarCrecimientosApi;

type FilaChoqueBaseApi = { fila_id: string; genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string };

/**
 * Cuerpo (más allá de `{ error, codigo }`) del `409` con `codigo = "filas_manuales"` del `PUT …/crecimientos`. No se escribió nada.
 * `huella_choque` identifica TODAS las filas en choque (no solo las mostradas, ≤ 200 por lista).
 */
/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type ConflictoFilasManualesApi = {
  error: string;
  codigo: "filas_manuales";
  huella_choque: string;
  pct_propio: { total: number; filas: (FilaChoqueBaseApi & { pct_fila: number; pct_nuevo: number })[] };
  decididas: { total: number; filas: (FilaChoqueBaseApi & { decidido: number; propuesta_nueva_estimada: number | null })[] };
};

/** Cuerpo del `400` con `codigo = "celdas_incompletas"`. */
/** @deprecated `0.12.1` (06d): la matriz editable de 07c ya no existe; sin uso, se borra en la siguiente versión que toque este archivo. */
export type CeldasIncompletasApi = { error: string; codigo: "celdas_incompletas"; faltan: { genero: string; mundo: string }[] };

/** Cuerpo del `400` con `codigo = "usar_crecimientos"` (un `PATCH` de parámetros intentó cambiar `crecimiento_pct_defecto`). */
export type UsarCrecimientosApi = { error: string; codigo: "usar_crecimientos" };

// ─── 0.12.1 · 06d: resumen de solo lectura de la pestaña «Crecimientos» ───

/** Puente al Total de `Y+1` (07c §5.2): lo que entra a `calcularPromedio` además de la base. */
export type PuenteApi = {
  total_en_curso: number;
  nuevas_anterior: number;
  aperturas: number;
  /** Vigente de `Y+1` de las tiendas que cierran en `Y+1`: SUMA (su `Y` ya salió de `B`). */
  cierres: number;
  /** Tiendas que cierran en `Y+1` sin total decidido (hoy proponen 0). */
  cierres_sin_decidir: number;
};

/** Lo que aplicó el último cálculo (de la foto) o lo que hay aprobado hoy en el global, de un GM o del Resto. */
export type CrecimientoAplicadoApi = { pct: number; version: number | null };

export type FilaResumenCrecimientoApi = {
  /** `<genero_id>.<mundo_id>` o `resto`. */
  clave: string;
  /** `null` en el Resto. */
  genero: string | null;
  mundo: string | null;
  /**
   * De la foto (`proyeccion_crecimientos` o `parametros.crecimiento_resto_usado`). `sobre_base` (0.14.0): sobre qué base se escribió ese %; foto de antes de
   * 0.14.0 = `bruta`, el Resto provisional y el % propio de una fila = `corregida`.
   */
  aplicado: { pct: number; version: number | null; provisional: boolean; sobre_base?: SobreBase; por_nombre: string | null; at: string | null };
  /** Del global (`crecimientos_genero_mundo`); `null` si no hay versión vigente. `sobre_base` (0.14.0): la de esa versión (una sin el dato es `bruta`); el servidor siempre lo informa. */
  vigente_hoy: { pct: number; version: number; sobre_base?: SobreBase; por_nombre: string | null; aprobada_at: string } | null;
  /** 07c: `B`, `B''`, rebote, filas con % propio, decididas y `Σ vigente` de `Y+1`. */
  agregado: AgregadoCrecimientoApi;
  /** `Σ vigente de Y+1 ÷ Σ B − 1` en %; `null` sin base. */
  resultante_pct: number | null;
  /** `/planificacion/curvas-estacionalidad?gm=<g>.<m>&anio=2027&proyeccion=<id>` (o `gm=resto`). */
  enlace: string;
};

/** `data` del `GET …/proyecciones/[id]/crecimientos` desde `0.12.1`: solo lectura. */
export type ResumenCrecimientosProyeccionApi = {
  anio_siguiente: number;
  /** `< 4` (o `null`): la pantalla solo dice «recalcula la proyección». */
  version_metodo: number | null;
  /** Los GM de HOMBRE y MUJER con filas base (`gm_gml`) o con foto. */
  filas: FilaResumenCrecimientoApi[];
  /** Con desglose por género. */
  resto: FilaResumenCrecimientoApi & { por_genero: { genero: string; base: number }[] };
  /** `calcularPromedio` de 07c sobre la foto; `null` si la proyección es de un método anterior. */
  total: ResultadoPromedio | null;
  puente: PuenteApi;
  objetivo_pct: number | null;
  cambiados: { clave: string; nombre: string; aplicado: CrecimientoAplicadoApi | null; vigente: CrecimientoAplicadoApi | null }[];
  sin_aprobar: CrecimientosSinAprobarApi | null;
};

// ─── Filas y años ───

export type VeredictoColaLarga = "cierra" | "cierra_con_quiebres" | "revision" | "sin_dato";

/**
 * Validación de disponibilidad de una fila de cola larga (`0.10.1`). `disponibilidad` y `demanda_corregida` son `null` cuando no se
 * pudieron medir (`sin_dato`) o la fila no tiene curva. La disponibilidad es un PROXY mensual: tienda-meses con stock al cierre del
 * mes ÷ tienda-meses totales (M5 no tiene días con stock).
 */
export type ColaLargaApi = {
  /**
   * `A_f`: venta anual corregida por disponibilidad y estacionalidad (unidades, un decimal). Con veredicto `revision` es la propuesta del
   * registro de `Y` (`propuesto`); con otro veredicto, solo informativa.
   */
  demanda_corregida: number | null;
  /** `dispon_f` de 0 a 1. */
  disponibilidad: number | null;
  tienda_meses_con_stock: number;
  tienda_meses: number;
  meses_cd_con_stock: number;
  veredicto: VeredictoColaLarga;
  /** `ritmo_f`: unidades por tienda-mes con stock (informativo). */
  ritmo: number | null;
  /** Meses de `W12` en que ninguna tienda tenía stock de la fila (informativo). */
  meses_tiendas_sin_stock: number;
};

export type AnioFilaApi = {
  anio: number;
  bloque: Bloque;
  subbloque: Subbloque | null;
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  referencia_alternativa: number | null;
  referencia_tres_meses: number | null;
  explicacion: string;
  crecimiento_pct: number | null;
  decidido: number | null;
  origen: OrigenDecision | null;
  propuesta_al_decidir: number | null;
  vigente: number | null;
  nota: string | null;
  decidido_por_nombre: string | null;
  decidido_at: string | null;
  meses: number[] | null;
  meses_propuestos: number[] | null;
  origen_meses: OrigenMes[] | null;
  avance: number | null;
  avisos: AvisoFila[];
  /**
   * `0.10.1`, solo en el registro de `Y` de una fila base con propuesta bajo el umbral de cola larga y solo en las respuestas que
   * leen `historico` (`/lineas` y `/filas/[filaId]`); `null` (o ausente) en el resto. La fila de `Y+1` hereda el veredicto de `Y`
   * (lo dicen sus `avisos`).
   */
  cola_larga?: ColaLargaApi | null;
  /** Id del registro (`proyeccion_fila_anios.id`); lo pone la lectura, no el método. */
  id?: string;
  /**
   * `0.10.8` (07c), solo en las filas base de `Y+1`: el % que se aplicó (fila > celda GM > Resto). Siempre bruto. `null`/ausente en el
   * resto (año en curso, aperturas, cierres, filas de tienda).
   */
  crecimiento_efectivo?: CrecimientoEfectivoApi | null;
  /** `0.10.8`, solo filas base de `Y+1`: `B` = vigente de `Y` de las mismas tiendas de `Y+1`, sin normalizar (B2 incluido). `null` sin base o sin curva. */
  base_siguiente?: number | null;
  /**
   * `0.14.0` (método 5): `B'` = `B` corregida del Niño de `Y` (lo que habrían vendido las mismas tiendas de `Y+1` en un año normal); con `φ_Y ≡ 1`, `B' = B`.
   * Es la base del % «sobre 2026 corregido». (Antes de 0.14.0 era `B''` = `B' × Σ c φ_{Y+1}`, solo referencia.)
   */
  base_normalizada?: number | null;
  /** `0.10.8`: `vigente ÷ B − 1` en % («sobre 2026 real»); `null` sin `B` o sin vigente. */
  pct_bruto?: number | null;
  /** `0.14.0`: `vigente ÷ B' − 1` en % («sobre 2026 corregido»); `null` sin `B'` (0 o nulo) o sin vigente. */
  pct_sobre_normalizada?: number | null;
};

export type FilaApi = {
  id: string;
  tienda_id: string | null;
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  nivel: "GML" | "GMLE";
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  agrupacion_estacionalidad: { id: string; nombre: string; temporada: string } | null;
  historico_anual: { anio: number; unidades: number; clase: ClaseAnioFila; completo: boolean; tiendas: number }[];
  anios: AnioFilaApi[];
  avisos: AvisoFila[];
  activo: boolean;
};

export type MesHistorico = {
  periodo: string;
  unidades: number;
  venta_soles: number;
  stock_fin: number;
  cobertura: number | null;
  quiebre: boolean;
  atipico: boolean;
};

export type HistoricoAnio = {
  anio: number;
  clase: ClaseAnioFila;
  meses_atipicos: string[];
  total: number;
  total_normalizado: number;
  tiendas: string[];
  meses: MesHistorico[];
};

export type HistoricoFila = {
  anios: HistoricoAnio[];
  tendencia: number | null;
  prueba_anterior: {
    anio: number;
    propuesto: number;
    real: number;
    desvio_pct: number;
    dentro_de_muestra: true;
    /** `null` si alguna agrupación de la unidad no trae backtesting (curva del usuario, `F` sin backtesting honesto…): ver `eat_m6_cobertura`. */
    eat_m6: number | null;
    /** 06c. Peso (0 a 1) de la unidad cuyas agrupaciones traen backtesting de M6: "sin backtesting (cubre 70 %)". Ausente en filas guardadas antes de la 06c. */
    eat_m6_cobertura?: number;
  } | null;
  pesos_equivalencias: { equivalencia_id: string; peso: number }[];
  /** `0.10.1`: la validación de disponibilidad (solo si la propuesta de `Y` quedó bajo el umbral de cola larga). */
  cola_larga?: ColaLargaApi | null;
  /** Real a `k` de las tiendas de `M(Y)` que salen de `M(Y+1)` (resta de la base del año siguiente; B2). */
  salientes: { tienda_id: string; vendido: number; meses: number[] }[];
};

export type CurvaOrigen = { agrupacion_id: string; curva_id: string; version: number; peso: number };

/**
 * Participaciones históricas de una fila base (decisión 24, `0.10.1`). `periodo_referencia` dice sobre qué doce meses y qué tiendas se
 * midieron (`W12` sobre `M(Y)`, normalizado por el Niño). Una cerrada calculada en `0.10.0` no trae `periodo_referencia` ni
 * `por_marca`: la lectura los entrega `null`.
 */
/**
 * `normalizado_nino` dice si las participaciones se midieron con las unidades llevadas a nivel normal por el factor del Niño. Hoy es
 * SIEMPRE `false`: `detalle_w12` (de `venta_proyeccion`) no trae el mes de cada hecho y sin él no se puede dividir por `φ_{año,mes}`;
 * las participaciones son sobre unidades reales de `W12`. (La ficha 07 daba `true`; para que lo sea hay que añadir `periodo` a
 * `detalle_w12` en SQL y normalizar en `participacionesFila`.) M8 debe leerlo, no suponerlo.
 */
export type PeriodoReferencia = { desde: string; hasta: string; meses: number; tiendas: "mismas"; anio: number; normalizado_nino: boolean };
export type Participaciones = {
  periodo_referencia: PeriodoReferencia | null;
  por_clave_flujo: { clave_flujo: string; marca_id: string | null; participacion: number }[];
  /** Toda unidad de marca (`marcas_unidad`) con venta en `W12`, tenga o no tratamiento en 02b; suma 1. */
  por_marca: { marca_id: string; participacion: number }[] | null;
  por_talla: { agrupacion_talla_id: string; participacion: number }[];
};

export type OrigenComposicion = "referente" | "red" | "propia";

export type TiendaProyeccionApi = {
  tienda_id: string;
  codigo: string;
  nombre: string;
  bloque: "nuevas" | "cierres";
  subbloque: Subbloque | null;
  anio: number;
  fecha_usada: string;
  /** `venta_esperada_usada` tal cual: desde `version_metodo = 4` es la venta MENSUAL promedio en régimen (S/ sin IGV); antes, la del año de apertura. */
  venta_esperada: number | null;
  referente: { id: string; codigo: string; nombre: string } | null;
  origen_composicion: OrigenComposicion;
  unidades_maduras: number | null;
  rampa: number[];
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  referencia_alternativa: number | null;
  referencia_tres_meses: number | null;
  decidido: number | null;
  origen: "propuesta" | "manual" | null;
  propuesta_al_decidir: number | null;
  vigente: number | null;
  explicacion: string;
  nota: string | null;
  pasa_a_mismas: boolean;
  filas: FilaApi[];
  avisos: AvisoFila[];
  /** `0.10.7`: suma del `vigente` de las filas de la tienda en `anio` (`null` si la tienda no tiene filas) y cuántas están fijadas a mano. */
  suma_filas: number | null;
  filas_fijadas: number;
  /**
   * `0.10.8` (07d §4): solo aperturas con venta esperada `V`; `null` en el resto. `venta_mensual = V`, `anio_maduro = 12 V`,
   * `fraccion = F` (qué parte de un año maduro vende en su año de apertura; `null` sin `F`), `venta_anio_apertura = 12 V F`.
   * `con_meses_reales`: el año de la tarjeta es `Y` y la tienda ya tiene meses cerrados (`fecha_apertura ≤ hasta_periodo`): la cifra es solo referencia.
   */
  escala: { venta_mensual: number; anio_maduro: number; fraccion: number | null; venta_anio_apertura: number | null; con_meses_reales: boolean } | null;
};

export type NodoMatrizApi = {
  nivel: "compania" | "genero" | "mundo" | "linea" | "agrupacion_marca";
  ids: { genero_id?: string; mundo_id?: string; linea_id?: string; agrupacion_marca_id?: string };
  nombre: string;
  en_curso: {
    venta_a_la_fecha: number;
    mismas: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    total: number;
    decididas: number;
    filas: number;
  };
  siguiente: {
    mismas: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    total: number;
    decididas: number;
    filas: number;
    /** `0.10.8` (07c): `Σ B` de las filas base de `Y+1` del nodo (la base 2026 de las mismas tiendas de 2027). */
    base_siguiente: number;
    /** `0.10.8`: `Σ vigente de Y+1 de las filas base ÷ Σ B − 1` en %; `null` si `Σ B = 0`. */
    crec_mismas_pct: number | null;
    /** `0.14.0` (06e §3.3): `Σ B'` de las filas base de `Y+1` del nodo (la base corregida del Niño). */
    base_corregida?: number;
    /** `0.14.0`: `Σ vigente ÷ Σ B' − 1` en %; `null` si `Σ B' = 0`. */
    crec_corregida_pct?: number | null;
  };
  variacion_pct: number | null;
  estado: EstadoLinea;
  avisos: AvisoFila[];
};

export type FilaMensualApi = {
  ids: NodoMatrizApi["ids"];
  genero: string;
  mundo: string;
  linea: string;
  agrupacion_marca: string | null;
  bloque: Bloque | "todas";
  anios: { anio: number; total: number; meses: (number | null)[]; origen_meses: OrigenMes[]; sin_curva: number }[];
};

/** `0.14.0` (06e §5.2): diagnóstico mes a mes de un factor del Niño; es el `jsonb` `factores_volumen_atipico.diagnostico`. */
export type DiagnosticoFactorApi = {
  /** Los doce meses de `Y` (`m` = 1 a 12). `en_periodo`: atípico de la temporada y publicado en `Y` y en el año de referencia. */
  meses: { m: number; en_periodo: boolean; u: number; u_ref: number; ratio: number | null; control: number | null; relativo: number | null }[];
  /** Ratio de la temporada en los meses publicados fuera del periodo; `null` si no hay. */
  ratio_fuera: number | null;
  /** Meses atípicos de la temporada en `Y` (publicados o no). */
  meses_periodo: number;
  /** Meses del periodo con dato en ambos años (`≥ MIN_MESES_FACTOR` para que haya `ratio_calculado`). */
  meses_periodo_con_dato: number;
  /**
   * Año normal de referencia con que se calculó (el «frente a 2025» de la pantalla). Lo escribe `sincronizarFactores` dentro del `jsonb`
   * `diagnostico` (sin columna nueva); `null`/ausente en un diagnóstico guardado antes de ese cambio (re-sincronizar lo pone).
   */
  anio_ref?: number | null;
};

export type EstadoFactorY = "ok" | "faltante" | "desfasado" | "sin_confirmar";
export type MotivoDesfaseFactor = "formula" | "cargas" | "meses" | "composicion";

export type FactorApi = {
  anio: number;
  temporada: TemporadaFactor;
  /** `0.14.0` (06e §3.2): `relativo_periodo` o `null` (calculado con la fórmula anterior). */
  formula?: string | null;
  /** `0.14.0`: `ρ_P`, ratio de la temporada en los meses del periodo (solo se muestra). */
  ratio_volumen?: number | null;
  /** `0.14.0`: `κ_P`, ratio de la red de todo el año en los mismos meses y tiendas (solo se muestra). */
  ratio_control?: number | null;
  /** `0.14.0`: meses atípicos de la temporada en `Y` y cuántos tienen dato en ambos años. */
  meses_periodo?: number;
  meses_periodo_con_dato?: number;
  diagnostico?: DiagnosticoFactorApi | null;
  /** `0.14.0`: solo en los factores de `Y` (el año en curso). */
  estado?: EstadoFactorY;
  motivos_desfase?: MotivoDesfaseFactor[];
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
  ratio_efectivo: number | null;
  origen: "calculado" | "manual" | null;
  parcial: boolean;
  tiendas_comunes: number | null;
  meses_comparados: number | null;
  calculado_at: string | null;
  /**
   * `0.14.0`: cuándo se escribió `ratio_aplicado`. No hay columna propia (sin migración nueva): es `updated_at` de la fila, y solo cuando
   * `ratio_aplicado` no es nulo y la última escritura de la fila NO fue un «Sincronizar» (que también mueve `updated_at`). Si la última
   * escritura fue un sincronizar, la fecha real del valor escrito no se conoce y viene `null` (la pantalla dice «confirmado» sin día).
   */
  aplicado_at?: string | null;
  nota: string | null;
  objetivo: boolean;
};

// ─── Proyección y prerrequisitos ───

export type Motivo = { codigo: string; mensaje: string; detalle?: string[] };

export type ResumenProyeccion = {
  filas: number;
  filas_por_anio: Record<number, number>;
  decididas: Record<number, number>;
  totales: Record<number, { mismas: number; nuevas_anterior: number; aperturas: number; cierres: number; total: number }>;
  avisos: Partial<Record<AvisoFila, number>>;
  huella_cargas: string;
  curvas_usadas: { agrupacion_id: string; curva_id: string; version: number }[];
  desvio_prueba_anterior_pct: number | null;
  perfiles_apertura: { tienda: string; ratios: number[] }[];
  fuera_bloque: number;
  /** `0.10.1`: filas base con algún año `revision_cola_larga` sin decidir (lo que bloquea el cierre por cola larga). */
  filas_para_revision?: number;
  version_metodo: number;
  duracion_ms: number | null;
  /**
   * Foto interna `gml_id → nivel proyectado` con que se calculó (para detectar `nivel_cambiado` sin leer las filas). La API no
   * la entrega: `aProyeccionApi` la quita.
   */
  niveles_gml?: Record<string, string>;
  /** `0.10.8` (07c): sha de la matriz de crecimientos y el Resto con que se calculó. La API no la entrega. */
  huella_crecimientos?: string;
  /** `0.10.8`: `gml_id → "genero_id|mundo_id"` de los nodos con filas base al calcular. La API no lo entrega. */
  gm_gml?: Record<string, string>;
  /**
   * `0.14.0` (06e §3.3): claves `genero_id|mundo_id` y `resto` cuyas filas base de `Y+1` tienen Niño material
   * (`correccionMaterial(Σ B, Σ B')`). Una versión `bruta` de uno de ellos hay que reaprobarla para cerrar.
   */
  gm_con_nino?: string[];
  /** `0.14.0` (M8): por GM, filas base con `B` nulo (`sin_propuesta` o `sin_curva`) y su venta de `Y`: lo que queda fuera de la base de M7. */
  gm_fuera_base?: Record<string, { filas: number; unidades: number }>;
  /** `0.14.0`: `Σ B' ÷ Σ B − 1` en % de cada clave de `gm_con_nino` (para decir cuánto Niño tiene el GM que hay que reaprobar). */
  gm_correccion_nino_pct?: Record<string, number>;
  /** `0.14.0` (D5): temporadas con `φ` (`invierno`, `verano`) que entran en la composición de alguna fila base: las que exigen un factor de `Y` para cerrar. */
  temporadas_filas?: string[];
  /** `0.14.0` (M6): foto interna `equivalencia_id → temporada` (invierno y verano) con que se calculó, para detectar `temporada_cambiada`. La API no la entrega. */
  temporada_equivalencias?: Record<string, string>;
};

export type ProyeccionApi = {
  id: string;
  anio_en_curso: number;
  anio_siguiente: number;
  nombre: string;
  estado: EstadoProyeccion;
  hasta_periodo: string;
  parametros: ParametrosProyeccion;
  resumen: ResumenProyeccion | null;
  calculando: boolean;
  calculando_desde: string | null;
  calculado_at: string | null;
  cerrada_at: string | null;
  cerrada_por_nombre: string | null;
  nota: string | null;
  usuario_nombre: string | null;
  created_at: string;
  updated_at: string;
  desactualizada: Motivo[];
  bloques: BloquesApi;
  /** `0.12.1` (06d §3.1): solo en trabajo; `null` si no falta nada. Deshabilita «Cerrar proyección» sin esperar al `409`. */
  crecimientos_sin_aprobar?: CrecimientosSinAprobarApi | null;
  /** `0.14.0` (06e §3.3): lo que impide cerrar sin forzar por el Niño; solo en trabajo, `null` si nada. */
  cierre_bloqueado_por?: { codigo: CodigoCierreBloqueadoNino; mensaje: string }[] | null;
};

export const CODIGOS_CIERRE_BLOQUEADO_NINO = [
  "anio_siguiente_atipico",
  "factor_faltante",
  "factor_desfasado",
  "factor_sin_confirmar",
  "factores_cambiados",
  "temporada_cambiada",
] as const;
export type CodigoCierreBloqueadoNino = (typeof CODIGOS_CIERRE_BLOQUEADO_NINO)[number];

export type DatosProyeccionApi = {
  desde: string | null;
  hasta: string | null;
  meses_publicados: string[];
  meses_faltantes: string[];
  ultimo_mes_cerrado: string | null;
  curvas_vigentes: number;
  agrupaciones_sin_curva: { id: string; nombre: string }[];
  curvas_obsoletas: number;
  /**
   * Tendencia del último año completo en % (`total(Y−1) ÷ total(Y−2) − 1` sobre las mismas tiendas de `M(Y−1) ∩ M(Y)`, con el
   * Niño normalizado), referencia del crecimiento por defecto. `null` si no hay dos años completos publicados.
   */
  tendencia_ultimo_anio_pct: number | null;
};

export type PrerrequisitosProyeccionApi = { bloquea: Motivo[]; avisa: Motivo[] };

export type RespuestaProyeccionApi = {
  datos: DatosProyeccionApi;
  prerrequisitos: PrerrequisitosProyeccionApi;
  bloques_hoy: BloquesApi;
  proyecciones: ProyeccionApi[];
  factores: FactorApi[];
};

// ─── Parte 1: líneas ───

export type IndiceLineaApi = {
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  estado: EstadoLinea;
};

/** `0.10.7` (07b): una fila de apertura de la línea (`tienda_id` no nulo). `anios` trae solo los años en que la tienda es nueva. */
export type FilaTiendaLineaApi = FilaApi & { tienda_codigo: string; composicion_s: number | null };

/** Fila de `tiendas_linea` tal como la entregaba la `0.10.6` (la base de `TiendaLineaApi`). */
export type TiendaLineaBaseApi = {
  anio: number;
  bloque: "nuevas" | "cierres";
  subbloque: Subbloque | null;
  tienda: string;
  vendido: number;
  vigente: number | null;
  decidida: boolean;
};

/** `0.10.7` (07b): `tiendas_linea` ampliada con lo que necesita la cabecera de la sección de cada tienda. */
export type TiendaLineaApi = TiendaLineaBaseApi & {
  tienda_id: string;
  fecha_apertura: string | null;
  origen_composicion: "referente" | "red" | "propia";
  referente: string | null;
  /** De `proyeccion_tiendas`: TODA la tienda, todas las líneas. */
  total_tienda: { propuesto: number | null; decidido: number | null };
};

/** `0.10.7` (07b): las marcas de más peso de una fila base (GML × equivalencia × agrupación de marca) y el resto. Solo dato, no decisión. */
export type MarcasDeFilaApi = {
  fila_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  /** `periodo_referencia` de la fila base + cantidad de tiendas de `M(Y)`. */
  periodo: { desde: string; hasta: string; tiendas: number } | null;
  /** Hasta 3, de mayor a menor participación (empate: por nombre). */
  top: { marca_id: string; marca: string; participacion: number }[];
  /** El resto, para que `Σ top + otras = 1`; `null` si no sobra nada. */
  otras: { marcas: number; participacion: number } | null;
};

export type RespuestaLineasApi = {
  filtro: { genero_id: string | null; mundo_id: string | null; linea_id: string | null; q: string | null };
  filas: FilaApi[];
  /**
   * `base_siguiente` (`0.10.8`): `Σ B` de las filas base de la línea en `Y+1` (0 en los demás años). `vigente_con_base`: el vigente de
   * ESAS mismas filas (las que tienen `B`), el numerador del «Crec. mismas tiendas» (= `vigente_con_base ÷ base_siguiente − 1`), igual que
   * en la Matriz. `vigente` es el de todas las filas (el total de la línea) y no sirve para ese %.
   * `base_corregida` (`0.14.0`): `Σ B'` de las MISMAS filas (la base corregida del Niño; una fila sin `B'` aporta su `B`): el denominador del «% sobre 2026 corregido».
   */
  totales_por_anio: { anio: number; vigente: number; propuesto: number; decididas: number; filas: number; base_siguiente: number; base_corregida?: number; vigente_con_base: number }[];
  historico_linea: { anio: number; unidades: number; clase: ClaseAnioFila; tiendas: number }[];
  tiendas_linea: TiendaLineaApi[];
  /** `0.10.7`: filas de apertura (bloque `nuevas`, activas), por año, código de tienda, equivalencia y orden de agrupación de marca. */
  filas_tienda: FilaTiendaLineaApi[];
  /** `0.10.7`: marcas de más peso por fila base de la línea (vacío sin línea elegida). */
  marcas: MarcasDeFilaApi[];
  prueba_anterior: { propuesto: number; real: number; desvio_pct: number | null; eat_m6: number | null; eat_m6_cobertura: number } | null;
  avisos_linea: "tienda_nueva_sin_decidir"[];
  indice_lineas: IndiceLineaApi[];
};

/**
 * `0.10.7` (07b): respuesta de `PUT …/filas/[filaId]/anios/[anio]`. Al decidir una fila de tienda, el total de la tienda pasa a `D + Δ`
 * («solo se mueve lo modificado»); `tienda` trae ese total y la suma de sus filas de ese año (ausente en una fila base).
 */
export type RespuestaDecidirFilaApi = AnioFilaApi & { tienda?: { anio: number; decidido: number | null; suma_filas: number } };

export type FilaDetalleApi = FilaApi & {
  historico: HistoricoFila | null;
  curva: number[] | null;
  curva_origen: CurvaOrigen[];
  factores_mes: Record<number, number[]> | null;
  participaciones: Participaciones | null;
};

/** `GET …/tiendas/[tiendaId]/filas?anio=`: las filas de UNA tienda en UN año (las que `GET …/tiendas` ya no trae). */
export type RespuestaFilasTiendaApi = {
  tienda_id: string;
  anio: number;
  filas: FilaApi[];
};

export type RespuestaTiendasApi = {
  /** `filas` viene siempre vacío: se piden con `GET …/tiendas/[tiendaId]/filas?anio=`. */
  tiendas: TiendaProyeccionApi[];
  perfiles_apertura: { tienda: string; ratios: number[] }[];
};

export type RespuestaMatrizApi = {
  filtro: FiltroMatrizApi;
  nodos: NodoMatrizApi[];
  bloques: BloquesApi;
  resumen: {
    lineas: number;
    lineas_total: number;
    porcentaje_total: number | null;
    desvio_prueba_anterior_pct: number | null;
    /** `0.10.1`: filas base (del recorte filtrado) con algún año `revision_cola_larga` sin decidir; el «12 filas para revisión» de la cabecera. */
    filas_para_revision: number;
  };
};

export type FiltroMatrizApi = {
  genero_id: string | null;
  mundo_id: string | null;
  linea_id: string | null;
  temporada: string | null;
  agrupacion_estacionalidad_id: string | null;
  agrupacion_marca_id: string | null;
  solo: SoloMatriz | null;
  por: "arbol" | "agrupacion_marca";
};

export const SOLO_MATRIZ = [
  "con_tiendas_nuevas",
  "sin_proyectar",
  "parciales",
  "curva_cambio",
  "propuesta_cambio",
  "cola_larga",
  /** `0.10.1`: líneas con alguna fila `revision_cola_larga` sin decidir. */
  "para_revision",
] as const;
export type SoloMatriz = (typeof SOLO_MATRIZ)[number];

export type RespuestaMensualApi = {
  filtro: FiltroMatrizApi & { bloque: Bloque | "todas"; por_agrupacion: boolean };
  filas: FilaMensualApi[];
  totales: { anio: number; meses: (number | null)[]; origen_meses: OrigenMes[]; total: number }[];
  bloques: BloquesApi;
};

// ─── Contrato de M8 ───

export type FilaCerradaApi = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  nivel: "GML" | "GMLE";
  agrupacion_estacionalidad_id: string | null;
  temporada: string | null;
  bloque: Bloque;
  subbloque: Subbloque | null;
  tienda_id: string | null;
  anio: number;
  total: number;
  meses: number[] | null;
  origen_meses: OrigenMes[] | null;
  curva_origen_usada: CurvaOrigen[];
  participaciones_historicas: Participaciones | null;
  avisos: AvisoFila[];
};

export type RespuestaCerradaApi = {
  proyeccion: ProyeccionApi;
  anio_pedido: number;
  cubre: "en_curso" | "siguiente";
  bloques: BloquesApi;
  filas: FilaCerradaApi[];
};

export const TEMPORADAS_FACTOR: readonly TemporadaFactor[] = ["invierno", "verano"];
