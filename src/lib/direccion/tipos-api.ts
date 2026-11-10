/**
 * Contratos del tablero de aprobación de dirección (docs/modulos/14-dashboard-aprobacion-direccion.md, §3.3 y §2.3). Autocontenido: describe el
 * JSON que viaja y las constantes de las reglas; lo usan igual el servidor y la pantalla. Sin imports (ni `@supabase/*`, ni React, ni Next, ni
 * `node:*`, ni otros módulos de `src/lib`).
 *
 * Tres partes:
 *   1. Constantes y catálogos (umbrales, máximos, tolerancias, listas de valores).
 *   2. Contratos de la API (`*Api`): lo que responden las rutas de `/api/direccion/*` y lo que recibe el `POST`.
 *   3. Contratos de las funciones SQL de la migración `0041` (`*Sql`): lo que devuelven `tablero_proyeccion`, `tablero_venta` y
 *      `registrar_aprobacion_direccion`, TAL COMO ESTÁ ESCRITA LA MIGRACIÓN (no como lo resume la ficha). Solo los usa el servidor
 *      (`consultas.ts` y la lógica pura); la pantalla no los toca.
 *
 * Convenciones: unidades en enteros; los `*pct` son porcentajes (7,9 = 7,9 %), sin redondear; las participaciones son fracciones (0,157 = 15,7 %);
 * los periodos son `aaaa-mm`; las fechas, `aaaa-mm-dd`; los instantes, ISO 8601. `gm_clave` es la `claveGM` de M7 (`genero_id|mundo_id`),
 * `GM_CLAVE_RESTO` para el Resto o `GM_CLAVE_TOTAL` para la fila del total.
 *
 * Las líneas marcadas `T1:` son precisiones o añadidos de la tanda de contratos respecto del texto de §3.3 (van listadas en el informe de la tanda).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Constantes y catálogos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Versión de la fórmula de `huella_proyeccion` (§2.3 a, I-B): la primera línea del texto canónico es `v|<VERSION_HUELLA>`. Cambiarla es un cambio de
 * contrato (invalida todas las aprobaciones vigentes): solo con una decisión registrada y en el mismo commit que la migración que cambie la fórmula.
 */
export const VERSION_HUELLA = 1;

/** `desvio_crecimiento`: |implícito − declarado| en puntos porcentuales, en la base del declarado (§4.5). También el corte de «coincide» del semáforo. */
export const UMBRAL_DESVIO_PP = 2;
/** `contra_tendencia`: declarado − tendencia (corregida del Niño) en puntos porcentuales, con tendencia negativa (§4.5). */
export const UMBRAL_TENDENCIA_PP = 5;
/** `concentracion`: participación de las 10 filas mayores en el año siguiente (§4.5). */
export const UMBRAL_CONCENTRACION_TOP10 = 0.4;
/** `concentracion`: participación de una sola fila en el año siguiente (§4.5). */
export const UMBRAL_FILA_DOMINANTE = 0.05;
/** `concentracion`: solo se evalúa desde este número de filas base del recorte (§4.5). */
export const MIN_FILAS_CONCENTRACION = 50;
/** Cuántas filas mayores muestra la pantalla (la función SQL trae 20). */
export const FILAS_MAYORES = 10;
/** `tienda_nueva_relevante`: peso de la tienda en la base `B` (si entra) o en el año siguiente (si es nueva o apertura) (§4.5). */
export const UMBRAL_TIENDA_NUEVA_RELEVANTE = 0.05;
/** `origen_decisiones`: parte de las unidades del año siguiente «aceptada sin cambiar» (lote + ia + propuesta) (§4.5, M-E). */
export const UMBRAL_DECISION_MASIVA = 0.8;
/** `origen_decisiones`: parte de los registros decididos del año siguiente que concentra el día pico (§4.5). */
export const UMBRAL_DIA_PICO = 0.5;

export const MAX_TIENDAS = 30;
export const MAX_AGRUPACIONES = 40;
export const MAX_GENEROS = 20;
/** Comentario de la decisión: tope (también `check` de la tabla) y mínimo cuando el resultado no es `aprobada` (R18). */
export const MAX_COMENTARIO_DIRECCION = 1000;
export const MIN_COMENTARIO_DIRECCION = 10;
/** Tope de `aprobaciones_direccion.resumen` (`check (pg_column_size(resumen) <= 65536)`). */
export const MAX_BYTES_RESUMEN = 65536;

/** Reparto mensual por tienda (§3.4 C): tolerancia del desvío máximo de fila y tope de vueltas del ajuste biproporcional. */
export const IPF_TOLERANCIA = 1e-6;
export const IPF_MAX_ITERACIONES = 1000;

/** Claves especiales de `gm_clave` (las demás son `genero_id|mundo_id`). */
export const GM_CLAVE_RESTO = "resto";
export const GM_CLAVE_TOTAL = "total";

/** Temporada de la fila (la del filtro de M7) más `sin_temporada` (= `temporada is null`). */
export const TEMPORADAS_TABLERO = ["invierno", "verano", "todo_el_ano", "sin_temporada"] as const;
export type TemporadaTablero = (typeof TEMPORADAS_TABLERO)[number];

export const BLOQUES_TABLERO = ["todas", "mismas", "nuevas", "cierres"] as const;
export type Bloque = (typeof BLOQUES_TABLERO)[number];

export const DESGLOSES_TABLERO = ["genero", "mundo", "linea", "agrupacion_marca", "marca", "temporada", "tienda"] as const;
export type Desglose = (typeof DESGLOSES_TABLERO)[number];

export const RESULTADOS_APROBACION = ["aprobada", "con_observaciones", "rechazada"] as const;
export type ResultadoAprobacion = (typeof RESULTADOS_APROBACION)[number];

/** Catálogo de motivos (el mismo del `check` de `aprobaciones_direccion.motivo`). */
export const MOTIVOS_DIRECCION = [
  "crecimiento_alto",
  "crecimiento_bajo",
  "contra_tendencia",
  "tiendas_nuevas",
  "nino",
  "filas_sin_decidir",
  "concentracion",
  "otro",
] as const;
export type MotivoDireccion = (typeof MOTIVOS_DIRECCION)[number];

/** Estado de la proyección al aprobar (una archivada no se aprueba). */
export type EstadoProyeccionAprobable = "en_trabajo" | "cerrada";
export type SobreBaseTablero = "bruta" | "corregida";

// ─────────────────────────────────────────────────────────────────────────────
// 2. Contratos de la API
// ─────────────────────────────────────────────────────────────────────────────

export type Exactitud = "exacto" | "estimado";

// ─── Entrada ───

/**
 * Filtros de `GET /api/direccion/tablero` ya validados (salida de `tableroQuerySchema`). En la URL las listas van como texto separado por comas
 * (`generos=a,b`); aquí ya son arreglos. Una lista vacía se trata como ausente (sin filtro en esa dimensión).
 */
export type FiltrosTableroApi = {
  /** Ausente = `por_defecto` de `/opciones`. */
  proyeccion_id?: string;
  /** Un uuid, o `"ninguna"` (sin comparar). Ausente = `comparar_por_defecto`. */
  comparar_id?: string;
  generos?: string[];
  /** Atajo: suma a `generos` los géneros del Resto (fuera de `generosDeMatriz`). En la URL, `resto=1`. */
  resto: boolean;
  mundo_id?: string;
  /** Exige un solo género (sin `resto`) y `mundo_id`. */
  linea_id?: string;
  temporadas?: TemporadaTablero[];
  /** Agrupaciones de marca. */
  am?: string[];
  /** UNA unidad de marca en `0.19.0`; su agrupación se deduce (si hay `am`, debe estar entre ellas). */
  marca?: string;
  tiendas?: string[];
  bloque: Bloque;
  desglose: Desglose;
};

/** Lo que el admin tenía filtrado al decidir. Informativo: la aprobación es siempre de la proyección entera. Se guarda en `resumen.filtros_vistos`. */
export type FiltrosVistosApi = {
  generos?: string[];
  resto?: boolean;
  mundo_id?: string | null;
  linea_id?: string | null;
  temporadas?: TemporadaTablero[];
  am?: string[];
  marca?: string | null;
  tiendas?: string[];
  bloque?: Bloque;
};

/** Cuerpo de `POST /api/direccion/aprobaciones` (salida de `aprobarDireccionSchema`; `motivo` y `comentario` pueden omitirse y valen `null`). */
export type AprobarCuerpoApi = {
  proyeccion_id: string;
  /** La `huella` que trajo el `GET` del tablero. */
  huella_vista: string;
  resultado: ResultadoAprobacion;
  /** Obligatorio si el resultado no es `aprobada`. */
  motivo: MotivoDireccion | null;
  /** Obligatorio (≥ `MIN_COMENTARIO_DIRECCION` caracteres) si el resultado no es `aprobada`. */
  comentario: string | null;
  /** «Revisé las alertas y las cifras de toda la proyección». */
  confirmo_revision: true;
  filtros_vistos?: FiltrosVistosApi;
};

/** Códigos estables de los errores de `/api/direccion/*` (`{ error, codigo }`), más el del `DELETE` de proyecciones de M7. */
export type CodigoErrorDireccion =
  | "marca_fuera_de_agrupacion"
  | "comparar_igual"
  | "proyeccion_no_encontrada"
  | "sin_calcular"
  | "calculo_en_curso"
  | "sin_proyeccion"
  | "huella_distinta"
  | "archivada"
  | "tiene_aprobaciones";

/** Cuerpo del `409 huella_distinta` del `POST`: además del mensaje y el código, la huella de ahora. */
export type ErrorHuellaDistintaApi = { error: string; codigo: "huella_distinta"; huella_actual: string };

// ─── Series, puente y comparativos ───

export type SerieMensualApi = {
  clave: string;
  etiqueta: string;
  anio: number;
  tipo: "real" | "real_parcial" | "proyectado" | "sin_nino" | "comparada" | "aprobada";
  /** Año del Niño según `periodos_atipicos` (D14). */
  nino: boolean;
  /** 12; `null` = sin dato (futuro, sin carga o sin atribución mensual). */
  meses: (number | null)[];
  total: number | null;
  exactitud: Exactitud;
};

export type ClavePuente =
  | "cierre_en_curso"
  | "fuera_base"
  | "ajuste_base"
  | "base"
  | "nino"
  | "crecimiento"
  | "manual"
  | "otras"
  | "sin_base"
  | "mismas_siguiente"
  | "nuevas_anterior"
  | "aperturas"
  | "cierres"
  | "total_siguiente";

export type PuenteApi = {
  /**
   * T2 (añadido, opcional): `ayuda` es el texto de ayuda de la línea (`title` y lector de pantalla). Viaja en `puente.recorte` y `puente.por_gm` del
   * tablero; NO se guarda en la foto de la aprobación (`resumen.puente`).
   *
   * La línea `manual` («Fijado a mano») es `delta_manual` de la migración 0041: `vigente − propuesta` de los registros base con `B` CLASIFICADOS
   * `manual` (los fijó una persona: `origen = 'manual'`, sin lote ni propuesta de IA), la misma clase «a mano» de `decisiones`. Las cifras de IA
   * aceptadas y lo aceptado en bloque van en `otras` («Otras diferencias con la propuesta»).
   *
   * `pct` (cada paso sobre el acumulado anterior a él): `base_sobre_real` = base ÷ cierre − 1; `nino` = (B′ − B) ÷ B; `crecimiento` =
   * (propuesta − B′) ÷ B′; `manual` y `otras`, sobre el acumulado previo; `total_vs_cierre` = total ÷ cierre − 1.
   */
  lineas: { clave: ClavePuente; etiqueta: string; u: number; acumulado: number; subtotal: boolean; ayuda?: string }[];
  /** `nino` es `null` si la proyección (o el GM) no tiene base corregida (`B_corr` nulo: método anterior). */
  pct: {
    base_sobre_real: number | null;
    nino: number | null;
    crecimiento: number | null;
    manual: number | null;
    otras: number | null;
    total_vs_cierre: number | null;
  };
};

export type ComparativoApi = {
  clave: "sig_vs_cierre" | "sig_vs_anterior" | "cierre_vs_anterior" | "cierre_vs_hace_dos" | "ac_vs_ac" | "anterior_vs_hace_dos";
  /** «2027 vs 2025 (último año normal)», «2026 ene–oct vs 2025 ene–oct». */
  etiqueta: string;
  /** Algún año del par es del Niño. */
  nino: boolean;
  total: { pct: number | null; motivo: null | "sin_base" | "incompleto" | "nueva" };
  /**
   * T2 (añadido, opcional): `pct_corregido` es la variación de mismas tiendas sobre la base CORREGIDA del Niño. Solo tiene sentido en
   * `sig_vs_cierre` (año siguiente sobre `B′` en vez de `B`: +5,2 % frente a +6,9 % en el caso de la ficha); en los demás pares va `null`, y también
   * si la proyección no tiene base corregida o `pct` es `null`.
   */
  mismas: { pct: number | null; tiendas: string[]; motivo: null | "sin_base" | "incompleto"; pct_corregido?: number | null };
  /**
   * T3 (añadido, opcional): texto corto para mostrar junto al % cuando el par mezcla una cifra estimada por participación de marca con venta real de
   * la marca (con `marca` elegida: «2027 vs 2025», «2026 cierre vs 2025» y «2026 cierre vs 2024»). `null` en los demás casos.
   */
  advertencia?: string | null;
};

// ─── Crecimientos, decisiones y alertas ───

export type CrecimientoGMApi = {
  gm_clave: string;
  /** «HOMBRE · URBANO», «Resto» o «Total». */
  nombre: string;
  /**
   * T2 (precisión): para el Resto es el que APLICÓ el último cálculo (`parametros.crecimiento_resto_usado`). Si esa clave falta (proyección sin
   * calcular o de antes de `0.12.1`), `declarado_pct`, `sobre_base`, `version`, `autor` y `aprobada_at` van `null` y el semáforo es `sin_dato`: el
   * tablero dice «sin dato» y NO muestra el Resto provisional (`crecimiento_pct_defecto`). Por eso no hace falta un campo `provisional`.
   */
  declarado_pct: number | null;
  sobre_base: SobreBaseTablero | null;
  version: number | null;
  autor: string | null;
  aprobada_at: string | null;
  nota: string | null;
  base_real: number | null;
  base_corregida: number | null;
  con_nino: boolean;
  siguiente_mismas: number | null;
  implicito_sobre_real_pct: number | null;
  implicito_sobre_corregida_pct: number | null;
  /** Implícito (en la base del declarado) − declarado. */
  desvio_pp: number | null;
  /** Enero a `k'` de `Y` frente a enero a `k'` de `Y−1` en `M(Y)`, sin filtros, en bruto. */
  tendencia_mismas_pct: number | null;
  /** I-E: la misma con la venta de `Y` dividida por φ (§4.5); igual a la bruta si el GM no tiene corrección. */
  tendencia_mismas_corregida_pct: number | null;
  /** La bruta es < 0 y la corregida no: la alerta baja a informativa. */
  tendencia_afectada_nino: boolean;
  semaforo: "coincide" | "revisar" | "contra_tendencia" | "sin_dato";
  anomalias: ("sin_base" | "reemplazada_mismo_dia" | "sin_nota")[];
};

export type ClaseDecision = "lote" | "ia" | "propuesta" | "manual" | "escalada" | "sin_decidir";

export type DecisionesAnioApi = {
  anio: number;
  /**
   * T2 (precisión): `pct_u` es un PORCENTAJE de 0 a 100 (49,2 = 49,2 %), como todos los `*pct` del contrato: las unidades de esa clase sobre el
   * vigente de todos los registros del año en el recorte. Los seis suman 100 (o todos 0 si el año no tiene unidades).
   */
  por_origen: { clave: ClaseDecision; etiqueta: string; n: number; u: number; pct_u: number }[];
  /** T1: `desde` y `hasta` pueden ser `null` (registros decididos sin `decidido_at`: la función SQL los devuelve así). `nombre` puede ser `""`. */
  autores: { nombre: string; n: number; u: number; desde: string | null; hasta: string | null }[];
  dia_pico: { fecha: string; n: number } | null;
};

export type CodigoAlerta =
  | "factor_provisional"
  | "base_corregida_nino"
  | "contra_tendencia"
  | "desvio_crecimiento"
  | "origen_decisiones"
  | "anomalia_crecimiento"
  | "tienda_nueva_relevante"
  | "apertura_sin_historia"
  | "concentracion"
  | "propuesta_cambio"
  | "curva_cambio"
  | "sin_curva"
  | "datos_mas_nuevos"
  | "metodo_anterior"
  | "meses_faltantes"
  | "atribucion_estimada"
  | "atribucion_sin_mensual"
  | "marca_estimada"
  | "comparada_distinta_k"
  | "distinta_de_aprobada";

export type NivelAlerta = "importante" | "info";

export type AlertaApi = {
  codigo: CodigoAlerta;
  nivel: NivelAlerta;
  alcance: "proyeccion" | "recorte";
  titulo: string;
  detalle: string;
  cifras: Record<string, number | string>;
  enlace: string | null;
};

// ─── Lo que bloquearía el cierre (GET /api/direccion/bloqueos) ───

export type BloqueoCierreApi = {
  /** `codigo` y `mensaje` de `motivoRechazoCerrar`, tal cual. */
  codigo: string;
  mensaje: string;
  detalle?: Record<string, unknown>;
  /** `true` solo para `desactualizada` («Cerrar de todos modos»). */
  forzable: boolean;
};

export type BloqueosCierreApi =
  | { aplica: false }
  | {
      aplica: true;
      /** No hay ninguna causa. */
      puede_cerrar: boolean;
      /** Todas las causas son forzables. */
      puede_forzar: boolean;
      bloqueos: BloqueoCierreApi[];
      /** Conteo con `filaBloqueaCierre`. */
      filas: { anio: number; n: number; u: number; por_motivo: { umbral: number; revision_cola_larga: number } }[];
    };

// ─── Desglose y datos de apoyo ───

export type FilaDesgloseApi = {
  id: string;
  nombre: string;
  exactitud: Exactitud;
  anios: { anio: number; tipo: "real" | "real_parcial" | "cierre" | "proyectado"; total: number | null }[];
  ac_anterior: number | null;
  ac_en_curso: number | null;
  pct: { sig_vs_cierre: number | null; sig_vs_anterior: number | null; cierre_vs_anterior: number | null; ac_vs_ac: number | null };
  participacion_siguiente: number | null;
  /** Al elegirla se aplica como filtro (D11). */
  filtrable: boolean;
};

export type ApoyoApi = {
  soles: {
    anios: { anio: number; s: number; tipo: "real" | "real_parcial" | "estimado" }[];
    precio_medio: number | null;
    ventana: { desde: string; hasta: string };
    u_sin_precio: number;
  };
  cobertura: {
    periodo: string;
    stock_tiendas: number;
    /** `null` con filtro de tienda. */
    stock_cd: number | null;
    imi_proyectado: number | null;
    imi_real: number | null;
    exactitud: Exactitud;
  };
};

// ─── Aprobaciones ───

export type EstadoAprobacion = "sin_aprobacion" | "aprobada" | "con_observaciones" | "rechazada" | "invalidada";

/** Foto de lo aprobado (`aprobaciones_direccion.resumen`). `huella` es la misma de la columna `huella` (D10). */
export type ResumenAprobacionApi = {
  huella: string;
  /** `VERSION_HUELLA` con que se registró. */
  huella_version: number;
  hasta_periodo: string;
  version_metodo: number | null;
  totales: { anio: number; total: number; por_bloque: Record<"mismas" | "nuevas_anterior" | "aperturas" | "cierres", number> }[];
  /** El puente total de la proyección. */
  puente: PuenteApi;
  por_gm: { gm_clave: string; nombre: string; en_curso: number; siguiente: number; declarado_pct: number | null; implicito_pct: number | null }[];
  alertas: { codigo: string; nivel: string; cantidad: number }[];
  filtros_vistos?: FiltrosVistosApi;
};

export type AprobacionApi = {
  id: string;
  proyeccion_id: string;
  estado_proyeccion: EstadoProyeccionAprobable;
  resultado: ResultadoAprobacion;
  /** T1: acotado al catálogo (el `check` de la tabla no admite otro valor). */
  motivo: MotivoDireccion | null;
  comentario: string | null;
  usuario_nombre: string;
  rol: "admin";
  created_at: string;
  huella: string;
  /** Su huella no es la actual de la proyección, o se registró con otra versión de la fórmula. */
  invalidada: boolean;
  /** `version_huella`: `resumen.huella_version` ≠ `VERSION_HUELLA` (§2.3 a). `null` si no está invalidada. */
  invalidada_por: "cifras" | "version_huella" | null;
  resumen: ResumenAprobacionApi;
};

/** `GET /api/direccion/aprobaciones?proyeccion_id=`: `historial` de la más reciente a la más antigua. */
export type AprobacionesApi = {
  huella_actual: string;
  estado: EstadoAprobacion;
  /** La más reciente, solo si el estado es `aprobada` o `con_observaciones` (§5.1). */
  vigente: AprobacionApi | null;
  historial: AprobacionApi[];
};

export type DiferenciaAprobadaApi = {
  aprobacion_id: string;
  proyeccion_id: string;
  proyeccion_nombre: string;
  misma_proyeccion: boolean;
  fecha: string;
  usuario_nombre: string;
  resultado: "aprobada" | "con_observaciones";
  /** Misma huella. */
  identica: boolean;
  en_curso: { aprobado: number; actual: number; u: number; pct: number | null };
  siguiente: { aprobado: number; actual: number; u: number; pct: number | null };
  /** Del año siguiente, ordenado por |u|; un GM ausente en uno de los dos lados cuenta 0. */
  por_gm: { gm_clave: string; nombre: string; aprobado: number; actual: number; u: number; pct: number | null }[];
};

/** Lo mínimo de una aprobación para los avisos y el rótulo de estado. */
export type AprobacionBreveApi = Pick<AprobacionApi, "resultado" | "motivo" | "usuario_nombre" | "created_at">;

// ─── Proyección, estado y tablero ───

export type ProyeccionTableroApi = {
  id: string;
  nombre: string;
  estado: "en_trabajo" | "cerrada" | "archivada";
  anio_en_curso: number;
  anio_siguiente: number;
  hasta_periodo: string;
  k: number;
  version_metodo: number | null;
  cerrada_at: string | null;
  cerrada_por_nombre: string | null;
  usa_compras: boolean;
};

/**
 * `GET /api/direccion/estado`. Con `?para=compras` y sin cerrada que use el flujo: `proyeccion = null`, `estado = "sin_aprobacion"` y lo demás `null`.
 */
export type EstadoDireccionApi = {
  proyeccion: ProyeccionTableroApi | null;
  estado: EstadoAprobacion;
  /** Solo si el estado es `aprobada` o `con_observaciones`. */
  vigente: Pick<AprobacionApi, "resultado" | "usuario_nombre" | "created_at"> | null;
  /**
   * T1 (añadido): la aprobación más reciente de la proyección, sea cual sea su resultado y aunque esté invalidada. Los avisos de §4.11 la necesitan
   * para «Dirección rechazó esta proyección el … (motivo)» y «Aprobación invalidada: la proyección cambió después del …», donde `vigente` es `null`.
   */
  ultima: AprobacionBreveApi | null;
  diferencia: DiferenciaAprobadaApi | null;
};

/**
 * T1 (añadido): situación de una tienda en la proyección mostrada, según `parametros.bloques` (las claves guardadas, no las fechas de M4). La pantalla
 * la usa para agrupar el filtro de tiendas (§4.7: «Mismas tiendas», «Abiertas en el año en curso», «Aperturas», «Cierres», «Cerradas»).
 * `mismas`, `nuevas_anterior`, `aperturas` y `cierres` son su grupo en `bloques[Y+1]`; `fuera`, una tienda que no está en ninguno (ya cerrada o sin datos).
 */
export type SituacionTienda = "mismas" | "nuevas_anterior" | "aperturas" | "cierres" | "fuera";

export type TableroApi = {
  proyeccion: ProyeccionTableroApi;
  comparada: (ProyeccionTableroApi & { motivo: "aprobada" | "elegida"; huella_igual_a_aprobada: boolean | null }) | null;
  datos: {
    k_prima: number;
    ultimo_publicado: string;
    meses_faltantes: string[];
    anios_nino: number[];
    /** T1 (añadido): situación de cada tienda de tipo Tienda en la proyección mostrada (ver `SituacionTienda`). */
    tiendas: { tienda_id: string; situacion: SituacionTienda }[];
    /** T1 (añadido): venta del recorte sin fila base en la proyección, por año. No se muestra en pantalla: va en una línea de la hoja `RESUMEN` del Excel (M6). */
    fuera_universo: { anio: number; u: number }[];
  };
  filtros: { texto: string; exactitud: Exactitud; conjunto_tiendas: { etiqueta: string; codigos: string[] } | null };
  /** SIEMPRE de la proyección entera (no depende de los filtros). */
  decidir: {
    /** 3 a 5 líneas (§4.3). */
    lineas: string[];
    estado: EstadoAprobacion;
    /** Solo si el estado es `aprobada` o `con_observaciones`. */
    vigente: AprobacionApi | null;
    /** T1 (añadido): la más reciente, sea cual sea su resultado y aunque esté invalidada (rótulos «Rechazada por …» e «invalidada … después del …»). */
    ultima: AprobacionApi | null;
    diferencia: DiferenciaAprobadaApi | null;
    precision: { desvio_prueba_anterior_pct: number | null; rotulo: "dentro de muestra" };
    objetivo_pct: number | null;
    puede_aprobar: boolean;
    alertas_importantes: number;
  };
  puente: {
    /** `null` con filtro de tienda (el puente no se recorta por tienda). */
    recorte: PuenteApi | null;
    /** De toda la proyección: una fila por GM de la matriz, la del Resto y, la última, la del Total (`gm_clave = GM_CLAVE_TOTAL`). */
    por_gm: (PuenteApi & { gm_clave: string; nombre: string })[];
  };
  /** Importantes primero; las de bloqueo del cierre vienen de `/bloqueos`. */
  alertas: AlertaApi[];
  kpis: {
    siguiente: number;
    cierre: number;
    /**
     * T2 (precisión): real de enero a `k` (el mes con que se calculó la proyección): con `proyectado_resto` suma `cierre` (salvo unidades sin reparto
     * mensual). Sin tiendas ni bloque es lo vendido guardado; con ellos, la venta publicada de esas tiendas.
     */
    real_ac: number;
    /**
     * T3 (añadido, opcional): exactitud de `real_ac`. `"estimado"` con una unidad de marca elegida (es lo vendido guardado de enero a `k` por la
     * participación de la marca en cada fila, no su venta real; rotularlo «estimado», no «real»); `"exacto"` en los demás casos.
     */
    real_ac_exactitud?: Exactitud;
    /** T2 (añadido, opcional): real de enero a `k'` (el último mes publicado, `datos.k_prima`), para «en lo que va»; `null` si no hay venta publicada. */
    real_ac_k_prima?: number | null;
    proyectado_resto: number;
    anterior: number;
    hace_dos: number;
    hace_tres: number;
    comparativos: ComparativoApi[];
    exactitud: Exactitud;
  };
  series: SerieMensualApi[];
  tabla_mensual: {
    /**
     * T3 (precisión): las filas `sin_atribuir_<año>` llevan como `total` la SUMA DE SUS MESES y solo salen si algún mes no es cero (el «sin atribuir»
     * anual sigue en `atribucion.sin_atribuir`).
     */
    filas: { clave: string; etiqueta: string; meses: (number | null)[]; total: number | null; tipo: SerieMensualApi["tipo"] | "variacion"; exactitud: Exactitud }[];
    /**
     * T3 (añadido, opcional): nota al pie de la tabla, o `null`. Sale cuando alguna fila `sin_atribuir_*` tiene meses negativos (texto de §3.4 C:
     * «−1 u en jul 2027: lo atribuido a las tiendas ese mes supera lo proyectado para el bloque (…)») y/o cuando el «sin atribuir» anual no es la
     * suma de sus meses (dice por qué: unidades sin curva mensual; en el año en curso, los meses de enero a `k`). Pintarla tal cual.
     */
    nota?: string | null;
  };
  desglose: { dimension: Desglose; filas: FilaDesgloseApi[]; total: FilaDesgloseApi };
  /** Siempre de toda la proyección: los GM de la matriz, el Resto y el Total. */
  crecimientos: CrecimientoGMApi[];
  /** Del recorte (sin filtro de tienda). */
  decisiones: DecisionesAnioApi[];
  apoyo: ApoyoApi;
  mayores: { fila: string; vigente: number; participacion: number; crecimiento_pct: number | null }[];
  /** Solo con filtro de tienda o bloque. `sin_atribuir` puede ser negativo (§3.4 C). */
  atribucion: {
    tiendas: { tienda_id: string; codigo: string; participacion_anual: number; participacion_mes: (number | null)[] }[];
    sin_atribuir: { en_curso: number; siguiente: number };
    mensual: boolean;
  } | null;
  /** La que se manda al aprobar (`huella_vista`). */
  huella: string;
};

export type OpcionesTableroApi = {
  proyecciones: (ProyeccionTableroApi & { estado_direccion: EstadoAprobacion })[];
  por_defecto: { proyeccion_id: string; motivo: "usa_compras" | "en_trabajo_mas_reciente" } | null;
  comparar_por_defecto: { proyeccion_id: string; aprobacion_id: string } | null;
  generos: { id: string; nombre: string; es_resto: boolean }[];
  mundos: { id: string; nombre: string }[];
  lineas: { id: string; nombre: string; genero_id: string; mundo_id: string }[];
  /** T1 (añadido): §3.1 las lista entre las opciones y §3.3 las omitía. Catálogo fijo, en el orden de `TEMPORADAS_TABLERO`. */
  temporadas: { id: TemporadaTablero; nombre: string }[];
  agrupaciones_marca: { id: string; nombre: string }[];
  unidades_marca: { id: string; nombre: string; agrupacion_marca_id: string }[];
  tiendas: { id: string; codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null; activa: boolean }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Contratos de las funciones SQL (supabase/migrations/0041_tablero_direccion.sql)
// ─────────────────────────────────────────────────────────────────────────────
// Tipan el `jsonb` que devuelve cada función tal como está escrita. Reglas comunes de la migración:
//   * Todas las claves salen SIEMPRE; lo que no aplica va en `null` (única excepción: `tablero_venta` con `solo_tendencia`, que devuelve otro documento).
//   * En la entrada, una clave ausente o `null` = sin filtro en esa dimensión; un arreglo VACÍO = nada coincide (el servidor no manda arreglos vacíos).
//   * Los índices (`i_t`, `i_d`, `i_gml`, `i_am`) empiezan en 0 y apuntan al arreglo de ids del mismo documento.

// ─── tablero_proyeccion(p_proyeccion_id, p) ───

/** Entrada `p` de `tablero_proyeccion`. No recibe tiendas: el servidor atribuye (§3.4) y recorta. */
export type ParamsTableroProyeccionSql = {
  gml_ids?: string[] | null;
  agrupacion_marca_ids?: string[] | null;
  unidad_marca_id?: string | null;
  temporadas?: TemporadaTablero[] | null;
  desglose?: Desglose | null;
};

type Cuenta = { n: number; u: number };

/** Clasificación excluyente, en este orden: lote > ia > sin decidir > origen. `n` cuenta registros y `u` suma su vigente (base y tiendas del recorte). */
export type DecisionesSql = Record<ClaseDecision, Cuenta> & {
  /** Registros DECIDIDOS por `decidido_por_nombre` (`""` si es nulo), por `u` descendente. Fechas en Lima; `null` si ninguno trae `decidido_at`. */
  autores: { nombre: string; n: number; u: number; desde: string | null; hasta: string | null }[];
  /** El día (Lima) con más registros decididos; en empate, el más reciente. `null` si no hay ninguno con fecha. */
  dia_pico: { fecha: string; n: number } | null;
};

export type ConteosSql = { registros: number; propuesta_cambio: number; curva_cambio: number };

type BaseComunSql = {
  /** 12 enteros (suma de `meses`; con unidad de marca, redondeado por mes). Ceros si ningún registro trae `meses`. */
  meses: number[];
  vigente: number;
  propuesto: number;
  vendido: number;
  /** Vigente menos la suma de `meses` (un registro sin `meses` aporta todo su vigente). */
  sin_meses: number;
};

/** `base` del año en curso (`Y`): registros de filas sin tienda. Lo que es solo de `Y+1` va en `null`. */
export type BaseAnioEnCursoSql = BaseComunSql & {
  B: null;
  B_corr: null;
  vigente_con_B: null;
  propuesto_con_B: null;
  vigente_sin_B: null;
  delta_manual: null;
  delta_otras: null;
  /** 12 números con 2 decimales: Σ meses_m ÷ φ_Y,m de la fila (`factores_mes[Y]`; 1 si no hay o no es > 0). */
  meses_sin_nino: number[];
};

/** `base` del año siguiente (`Y+1`). */
export type BaseAnioSiguienteSql = BaseComunSql & {
  /** Σ `base_siguiente`; `null` si ningún registro base del recorte tiene `B` (método anterior). */
  B: number | null;
  /** Σ `base_normalizada` de los registros con `B`, CON 2 DECIMALES; `null` si ninguno tiene `B`. */
  B_corr: number | null;
  vigente_con_B: number;
  propuesto_con_B: number;
  /** Registros base sin `B` (otro método): van aparte en el puente. */
  vigente_sin_B: number;
  /** Σ (vigente − propuesto) de los registros con `B` clasificados `manual` (`origen = 'manual'`, sin lote ni propuesta de IA). */
  delta_manual: number;
  /** `vigente_con_B − propuesto_con_B − delta_manual` (exacto, sobre las cifras ya redondeadas). */
  delta_otras: number;
  meses_sin_nino: null;
};

type TiendaComunSql = {
  /** `tienda_id`. */
  t: string;
  bloque: "nuevas" | "cierres";
  subbloque: "nuevas_anterior" | "aperturas" | null;
  /** 12 enteros. */
  meses: number[];
  vigente: number;
  sin_meses: number;
};

/**
 * Filas de tienda de `Y`, por (tienda, bloque, subbloque). `para_base`: solo para las tiendas de `bloques[Y+1].mismas` (si no, `null`): vigente de sus
 * filas de tienda cuya fila base tiene `B` en `Y+1` (= `vigentesDeTiendasNuevas.paraBase` de 07f).
 */
export type TiendaAnioEnCursoSql = TiendaComunSql & { para_base: number | null };
export type TiendaAnioSiguienteSql = TiendaComunSql & { para_base: null };

export type AnioEnCursoSql = { anio: number; base: BaseAnioEnCursoSql; tiendas: TiendaAnioEnCursoSql[]; decisiones: DecisionesSql; conteos: ConteosSql };
export type AnioSiguienteSql = { anio: number; base: BaseAnioSiguienteSql; tiendas: TiendaAnioSiguienteSql[]; decisiones: DecisionesSql; conteos: ConteosSql };

/** Un género × mundo, SIEMPRE de toda la proyección (sin filtros ni unidad de marca). Enteros salvo `B_corr` y `base_meses_sin_nino`. */
export type PorGmSql = {
  /** `genero_id`. */
  g: string;
  /** `mundo_id`. */
  m: string;
  Y: {
    cierre: number;
    base: number;
    /** Vigente de las filas de tienda de `Y` menos el `para_base` de las tiendas que entran a la base de `Y+1`. */
    fuera_base_exacto: number;
    /** I-E: 12 enteros, Σ meses_m de los registros base de `Y` del GM. */
    base_meses: number[];
    /** I-E: 12 números, Σ meses_m ÷ φ_Y,m de los mismos registros. */
    base_meses_sin_nino: number[];
  };
  Y1: {
    /** `null` si ningún registro base del GM tiene `B` (el tablero dice «—», no 0). */
    B: number | null;
    /** Con 2 decimales; `null` como `B`. */
    B_corr: number | null;
    propuesto_con_B: number;
    vigente_con_B: number;
    vigente_sin_B: number;
    delta_manual: number;
    delta_otras: number;
    nuevas_anterior: number;
    aperturas: number;
    cierres: number;
    /** = vigente_con_B + vigente_sin_B + nuevas_anterior + aperturas + cierres (R4). */
    total: number;
  };
};

/** `[tienda_id, unidades]`. */
export type ParTiendaSql = [tienda_id: string, u: number];

/**
 * Un elemento del desglose. `d` es `genero_id`, `mundo_id`, `gml_id` (línea), `agrupacion_marca_id`, la unidad de marca (estimado con `por_marca`) o
 * la temporada (`"sin_temporada"` si es nula: el mismo texto que el filtro). Ordenado por `d`.
 */
export type PorDimSql = {
  d: string;
  /** `base_resto` = proyectado de `k+1` a 12 de los registros base. */
  Y: { base: number; base_resto: number; tiendas: ParTiendaSql[] };
  Y1: { base: number; tiendas: ParTiendaSql[] };
};

/** `[i_gml, i_am, y_resto, y1]`: proyectado de `k+1` a 12 de `Y` y vigente de `Y+1` del par (base y tiendas). Solo pares con alguna cifra ≠ 0. */
export type ParProyectadoSql = [i_gml: number, i_am: number, y_resto: number, y1: number];

/** Documento de `tablero_proyeccion`. La función devuelve `null` si la proyección no existe. */
export type TableroProyeccionSql = {
  /** La de `huella_proyeccion`, calculada en la misma sentencia (D10). */
  huella: string;
  /**
   * El Resto DECLARADO que aplicó el último cálculo (`parametros.crecimiento_resto_usado`). El objeto sale siempre; sus dos campos son `null` si la
   * clave falta (proyección sin calcular o de antes de `0.12.1`) o no tiene el tipo esperado.
   */
  resto: { pct: number | null; sobre_base: SobreBaseTablero | null };
  /** `Y` y `Y+1`, siempre los dos y en ese orden. */
  anios: [AnioEnCursoSql, AnioSiguienteSql];
  por_gm: PorGmSql[];
  /** `null` sin `desglose` o con `desglose = "tienda"` (la tienda sale de `tiendas` y de la atribución). */
  por_dim: PorDimSql[] | null;
  /** Del recorte. La temporada nula va como `null` (aquí NO como `"sin_temporada"`), al final. `Y1_con_factor_Y`: filas BASE con algún φ_Y,m ≠ 1. */
  por_temporada: { temporada: Exclude<TemporadaTablero, "sin_temporada"> | null; Y1: number; Y1_con_factor_Y: number }[];
  /** Para valorizar en soles (D2). */
  por_par: { gml: string[]; am: string[]; filas: ParProyectadoSql[] };
  /** Las 20 filas base de mayor vigente en `Y+1` del recorte (empate: por `clave`). */
  mayores: { clave: string; gml_id: string; am_id: string; Y1: number; B: number | null }[];
  /** No nulo solo con `unidad_marca_id` o con `desglose = "marca"`: vigente del recorte cuya fila base no trae `por_marca`. */
  sin_participacion_marca: { Y: number; Y1: number } | null;
};

// ─── tablero_venta(p) ───

/**
 * Entrada `p` de `tablero_venta`. `Y` es el año de `hasta`; el servidor pide de enero de `Y−3` al último mes publicado `k'`. `tienda_ids` SOLO recorta
 * `por_dim`, `precios` y `stock`: `por_tienda` trae siempre todas las tiendas del recorte (la atribución las necesita, R10). Sin `proyeccion_id`, un
 * filtro de temporada no deja nada.
 */
export type ParamsTableroVentaSql = {
  gml_ids?: string[] | null;
  agrupacion_marca_ids?: string[] | null;
  unidad_marca_id?: string | null;
  tienda_ids?: string[] | null;
  temporadas?: TemporadaTablero[] | null;
  proyeccion_id?: string | null;
  /** `aaaa-mm-01`. Sin `desde` o sin `hasta` el documento sale vacío. */
  desde: string;
  hasta: string;
  /** Se acepta y NO se usa: ninguna clave de la salida depende de él (el real de enero a `k` por tienda lo suma el servidor con `por_tienda`). */
  k?: number | null;
  /** 1 a 12; por defecto, el mes de `hasta`. */
  k_prima?: number | null;
  desglose?: Desglose | null;
  solo_tendencia?: boolean | null;
};

/** `[i_t, "aaaa-mm", unidades, soles]`: por (tienda, mes); sin CD; no se inventan ceros. Unidades netas y soles netos de IGV. */
export type VentaTiendaMesSql = [i_t: number, periodo: string, u: number, s: number];
/** `[i_d, u_Y−3, u_Y−2, u_Y−1, u_ac_ant, u_ac_cur, s_Y−1, s_ac_cur]`: `ac` = enero a `k'` de `Y−1` (ant) y de `Y` (cur). */
export type VentaDimSql = [i_d: number, u_hace_tres: number, u_hace_dos: number, u_anterior: number, u_ac_ant: number, u_ac_cur: number, s_anterior: number, s_ac_cur: number];
/** `[i_gml, i_am, u12, s12]`: los 12 meses que terminan en `hasta`. Solo pares con unidades o soles ≠ 0. */
export type PrecioParSql = [i_gml: number, i_am: number, u12: number, s12: number];
/** `[i_t, unidades]`: solo tiendas con stock ≠ 0. */
export type StockTiendaSql = [i_t: number, u: number];
/** `[genero_id, mundo_id, i_t, u_ac_cur, u_ac_ant]`: enero a `k'` de `Y` y de `Y−1`; solo tuplas con alguna de las dos ≠ 0. */
export type TendenciaGmSql = [genero_id: string, mundo_id: string, i_t: number, u_ac_cur: number, u_ac_ant: number];
/** `[anio, unidades]`. */
export type FueraUniversoSql = [anio: number, u: number];

/** Texto de `por_dim.ids` (desglose por temporada) para la venta cuya (nodo, equivalencia, AM) no tiene fila base en la proyección. */
export const DIM_FUERA_UNIVERSO = "fuera_universo";
/**
 * T3 (añadido): `id` de la fila del desglose por marca con lo proyectado que no es de ninguna marca (filas cuya fila base no trae `por_marca`, más el
 * redondeo de repartir por participación). `filtrable: false`, `exactitud: "estimado"`, venta en 0; solo sale si no es cero.
 */
export const DIM_SIN_MARCA = "sin_marca";

type VentaComunSql = {
  /** Meses publicados en `[desde, hasta]`: `aaaa-mm` → `carga_id`. */
  periodos: Record<string, string>;
  /** TODAS las tiendas de tipo Tienda, por id (no solo las del recorte): es el índice `i_t`. */
  tiendas: string[];
};

/** Documento de `tablero_venta` sin `solo_tendencia`. */
export type TableroVentaSql = VentaComunSql & {
  por_tienda: VentaTiendaMesSql[];
  /**
   * `null` sin `desglose` o con `desglose = "tienda"`. `ids`: los mismos identificadores que `por_dim` de `tablero_proyeccion`; por temporada, la de la
   * fila base (`"sin_temporada"` si es nula) o `DIM_FUERA_UNIVERSO` si esa venta no tiene fila base (o no se pasó `proyeccion_id`). Ordenados; solo
   * elementos con alguna cifra ≠ 0.
   */
  por_dim: { ids: string[]; filas: VentaDimSql[] } | null;
  precios: { gml: string[]; am: string[]; filas: PrecioParSql[] };
  /** Stock de la carga de `hasta` en el recorte. `por_tienda` respeta `tienda_ids` y omite los ceros; `cd` es 0 si no hay y `null` si se pidieron tiendas. */
  stock: { periodo: string; por_tienda: StockTiendaSql[]; cd: number | null };
  tendencia_gm: null;
  /** Por año (de `Y−3` a `Y`): venta del recorte de GML, AM y unidad sin fila base en `proyeccion_id` (no depende de temporadas ni de tiendas). `null` sin `proyeccion_id`; `[]` si no hay. */
  fuera_universo: FueraUniversoSql[] | null;
};

/** Documento de `tablero_venta` con `solo_tendencia = true`: SOLO estas tres claves, y `tendencia_gm` va SIN filtros (toda la empresa, tipo Tienda). */
export type TableroVentaTendenciaSql = VentaComunSql & { tendencia_gm: TendenciaGmSql[] };

// ─── registrar_aprobacion_direccion(p) ───

/** Entrada `p`: `perfil_id`, `usuario_nombre` y `rol` los pone el servidor desde la sesión; `resumen` lo arma el servidor. */
export type ParamsRegistrarAprobacionSql = {
  proyeccion_id: string;
  huella_vista: string;
  resultado: ResultadoAprobacion;
  motivo: MotivoDireccion | null;
  comentario: string | null;
  resumen: ResumenAprobacionApi;
  perfil_id: string;
  usuario_nombre: string;
  rol: "admin";
};

/** La fila de `aprobaciones_direccion` tal como la devuelve `to_jsonb` (y como la lee un `select`). */
export type FilaAprobacionSql = {
  id: string;
  proyeccion_id: string;
  anio_en_curso: number;
  estado_proyeccion: EstadoProyeccionAprobable;
  huella: string;
  resultado: ResultadoAprobacion;
  motivo: MotivoDireccion | null;
  comentario: string | null;
  resumen: ResumenAprobacionApi;
  perfil_id: string | null;
  usuario_nombre: string;
  rol: "admin";
  activo: boolean;
  created_at: string;
  updated_at: string;
};

/** Códigos que `registrar_aprobacion_direccion` devuelve DENTRO del `jsonb` (sin `raise`): el handler los traduce a `404` o `409`. */
export type ErrorRegistrarAprobacionSql =
  | { error: "no_encontrada" | "archivada" | "calculo_en_curso" | "sin_calcular" }
  | { error: "huella_distinta"; huella_actual: string };

/** Éxito = la fila (trae `id` y no trae `error`). */
export type ResultadoRegistrarAprobacionSql = FilaAprobacionSql | ErrorRegistrarAprobacionSql;
