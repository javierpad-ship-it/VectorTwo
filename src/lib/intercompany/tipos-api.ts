/**
 * Contrato JSON de M13 (docs/modulos/13-intercompany.md, sección 7): reglas de intercompany por marca × GML (× equivalencia) con
 * vigencia por mes, rango IMI propio (4–8 por defecto, editable) y porcentaje que llega directo por compras regulares. ARCHIVO
 * AUTOCONTENIDO: lo importa también la pantalla, así que no importa de `@supabase/*` ni de módulos de servidor. Los tipos NO se
 * renombran: el frontend los consume tal cual.
 *
 * Convenciones: meses como `aaaa-mm` (`vigente_desde`, `hasta_derivado`, `mes`); la entrada acepta además `aaaa-mm-01` y rechaza
 * cualquier otro día; `imi_*` en meses de inventario con un decimal; `pct_directo` y `pct_cd` en PUNTOS PORCENTUALES 0–100 (no
 * fracción: así lo dice la ficha, "80 %"); `clave` de una regla = `(marca_id, genero_mundo_linea_id, equivalencia_id)`. Toda la API
 * es de `requirePlanner`: el comprador no ve nada de esto (ve el efecto en M8).
 *
 * Nota de base: la tabla de la migración `0020` guarda el rango en `cobertura_min_meses` y `cobertura_max_meses` (sin default).
 * La API los expone como `imi_min` e `imi_max`; el default 4 y 8 lo pone esta capa (zod), no la base.
 */

// ─── Constantes del método ───

/** El rango IMI general de M8 (decisión 26): el de una regla que el planner no edita. */
export const IMI_MIN_DEFECTO = 4;
export const IMI_MAX_DEFECTO = 8;
/** Límites razonables de un rango propio (los valida zod, no la base: criterio I9). */
export const IMI_LIMITE_MIN = 0.5;
export const IMI_LIMITE_MAX = 24;
export const MAX_NOTA_REGLA = 200;

/** Ámbito sugerido (decisión 17): género HOMBRE y mundos FORMAL, CASUAL y RI. Informativo, no restringe. */
export const GENERO_AMBITO = "HOMBRE";
export const MUNDOS_AMBITO = ["FORMAL", "CASUAL", "RI"] as const;

/** Marcas intercompany de hoy (por nombre): fuera de ellas la regla se acepta con el aviso `fuera_de_marcas_sugeridas`. */
export const MARCAS_SUGERIDAS = ["JOHN HOLDEN", "DONATELLI", "VAN HEUSEN"] as const;

// ─── Enumeraciones ───

export type MotivoNoAplicable = "marca_sin_clave" | "sin_cerrada";

export const MOTIVO_NO_APLICABLE_TEXTO: Record<MotivoNoAplicable, string> = {
  marca_sin_clave: "la marca no tiene venta en ese GML en la proyección cerrada (márcala relevante en 02b o cierra una proyección 0.10.1)",
  sin_cerrada: "todavía no hay proyección cerrada: se sabrá al cerrar una",
};

/** Avisos informativos de una regla recién guardada (no bloquean). */
export type AvisoRegla = "fuera_de_marcas_sugeridas" | "aplicabilidad_no_evaluada";

export const AVISO_REGLA_TEXTO: Record<AvisoRegla, string> = {
  fuera_de_marcas_sugeridas: "La marca no es JOHN HOLDEN, DONATELLI ni VAN HEUSEN: la regla se guarda igual.",
  aplicabilidad_no_evaluada: "La regla se guardó, pero no se pudo comprobar si aplica con la proyección cerrada. Recarga la pantalla para verlo.",
};

/** Códigos estables de los `409`/`400` de las rutas de escritura (`{ error, codigo }`). */
export type CodigoRechazoRegla =
  | "marca_en_conjunto"
  | "marca_generica"
  | "marca_inactiva"
  | "nodo_no_vigente"
  | "nodo_no_gmle"
  | "equivalencia_de_otro_nodo"
  | "equivalencia_inactiva"
  | "clave_mes_repetido"
  | "rango_invalido";

// ─── Regla ───

export type NivelNodo = "GML" | "GMLE";

/**
 * % directo observado por M8 (conciliación de inventarios); hasta construir M8 siempre llega `null`.
 *
 * UNIDAD DEL CONTRATO: `valor` va en PUNTOS PORCENTUALES 0–100, igual que `pct_directo` y `pct_cd` (80 = «80 %»). La función
 * `pctDirectoObservado` de `subflujo.ts` (y `pct_directo_observado` de la ficha 8, 4c) devuelve FRACCIÓN 0–1: quien arme este
 * objeto desde ella DEBE pasar por `armarPctDirectoObservado` (`reglas.ts`), que convierte y fija la unidad en una sola parte.
 */
export type PctDirectoObservado = { periodo: string; valor: number };

export type ReglaIntercompanyApi = {
  id: string;
  marca_id: string;
  marca: string;
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  /** `HOMBRE · FORMAL · CAMISA` o, con equivalencia, `HOMBRE · FORMAL · CAMISA › MANGA CORTA`. */
  ruta: string;
  nivel: NivelNodo;
  /** Mes desde el que rige (inclusive), `aaaa-mm`. */
  vigente_desde: string;
  /** Mes anterior a la regla siguiente de la MISMA clave exacta, `aaaa-mm`; `null` = abierta. Derivado, no guardado. */
  hasta_derivado: string | null;
  imi_min: number;
  imi_max: number;
  /** `imi_min = 4` e `imi_max = 8`: el rango general, sin editar. */
  es_rango_defecto: boolean;
  /** % de la demanda de la marca que llega directo (0–100); M8 lo usa como reposición directa esperada. */
  pct_directo: number;
  /** `100 − pct_directo`: lo que sale del CD. */
  pct_cd: number;
  pct_directo_observado: PctDirectoObservado | null;
  nota: string | null;
  usuario_nombre: string | null;
  updated_at: string;
  /** `true`/`false` según la cerrada de M7; `null` = no evaluada (`sin_cerrada`, o la ruta no la consulta: `vigentes`). */
  aplicable: boolean | null;
  motivo_no_aplicable: MotivoNoAplicable | null;
  /** Género ≠ HOMBRE o mundo ∉ {FORMAL, CASUAL, RI}: informativo, la regla se guarda igual. */
  fuera_de_ambito: boolean;
  /** Solo en la respuesta de `POST` y `PATCH`; en las listas siempre `[]`. */
  avisos: AvisoRegla[];
};

// ─── Rutas ───

/**
 * `GET /api/intercompany/reglas?mes=aaaa-mm&incluir_historial=1` → `{ data: ReglaIntercompanyApi[] }` (lista plana, como pide la
 * ficha; sirve a `useColeccion`). `mes` por defecto es el mes en curso de Lima. Con `incluir_historial=1`: todas las reglas por clave
 * y `vigente_desde`; sin él, solo la vigente de cada clave en `mes`. Orden estable: marca, ruta, equivalencia, `vigente_desde`.
 */

/** De dónde salió `aplicable`. `con_por_marca = false` es una cerrada de `0.10.0` (VAN HEUSEN sin tratamiento no es aplicable). */
export type CerradaConsultadaApi = { anio: number; cubre: "en_curso" | "siguiente"; con_por_marca: boolean };

/** `DELETE /api/intercompany/reglas/[id]` → `{ data }`: la regla anterior de la misma clave exacta vuelve a regir desde entonces. */
export type EliminarReglaApi = { id: string; regla_anterior_id: string | null };

/** `GET /api/intercompany/vigentes?desde=aaaa-mm&hasta=aaaa-mm` → contrato de M8 (todas las activas, `aplicable` sin evaluar). */
export type VigentesIntercompanyApi = {
  reglas: ReglaIntercompanyApi[];
  marcas: { marca_id: string; nombre: string }[];
};

/**
 * `GET /api/intercompany/aplicabilidad?marca_id=&genero_mundo_linea_id=` → `{ data }`: si una regla de esa marca en ese nodo
 * sería aplicable con la cerrada de hoy. Permite el aviso amarillo ANTES de guardar (no bloquea).
 */
export type AplicabilidadApi = {
  aplicable: boolean | null;
  motivo_no_aplicable: MotivoNoAplicable | null;
  cerrada: CerradaConsultadaApi | null;
};

// ─── Subflujo (lógica pura compartida con M8) ───

/** Una participación de la cerrada para `aplicable()`: lo mínimo de `participaciones_historicas` de una fila base del nodo. */
export type ParticipacionFilaCerrada = {
  gml_id: string;
  por_clave_flujo: { marca_id: string | null; participacion: number }[];
  /** `null` en una cerrada de `0.10.0`. */
  por_marca: { marca_id: string; participacion: number }[] | null;
};
