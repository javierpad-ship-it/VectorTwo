/**
 * Contrato JSON de la API de marcas (M2) y de su mejora 02b: modalidad,
 * conjuntos de marcas y marcas relevantes por GML
 * (docs/modulos/02-marcas.md y docs/modulos/02b-marcas-tratamiento-gml.md,
 * "Contratos de API"). Describe el JSON que viaja, no las filas de la base.
 *
 * ÚNICO origen de verdad: el backend tipa con esto lo que devuelve (`tipos.ts`
 * lo re-exporta) y el frontend lo importa tal cual. Es autocontenido a
 * propósito: solo importa tipos de `@/lib/arbol/tipos` (también puro); nada de
 * `@/components`, de Supabase ni de módulos de cliente.
 */
import type { ModoImportacion, NivelPlanificacion } from "@/lib/arbol/tipos";

export type { ModoImportacion, NivelPlanificacion };

// ─── Agrupaciones de marca (GET /api/agrupaciones-marca) ───

/** Fila de `agrupaciones_marca` en el listado, con el conteo de marcas (todas) y de marcas activas. */
export type AgrupacionMarcaFila = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
  /** Marcas que cuelgan de ella, activas o no. */
  marcas: number;
  /** Solo las activas; lo usa el `confirm` de desactivar. */
  marcas_activas: number;
};

/** La agrupación tal como viaja embebida en cada marca. */
export type AgrupacionMarcaEmbebida = Pick<AgrupacionMarcaFila, "id" | "codigo" | "nombre" | "orden" | "activo">;

export type CrearAgrupacionMarcaCuerpo = { nombre: string; codigo?: string; orden?: number };
export type EditarAgrupacionMarcaCuerpo = Partial<{ nombre: string; codigo: string; orden: number; activo: boolean }>;

// ─── Marcas (/api/marcas) ───

/** 02b: `por_gml` (relevante en los GML asignados) o `barrido` (flujo propio sin detalle por GML). */
export type Modalidad = "por_gml" | "barrido";

/** 02b: avisos de un conjunto de marcas (regla 22). */
export type AvisoConjunto = "agrupacion_distinta" | "cabeza_inactiva" | "config_propia_ignorada" | "cadena";

/** 02b: la cabeza del conjunto tal como viaja embebida en la marca. */
export type ConjuntoEmbebido = { id: string; nombre: string; activo: boolean };

export type MarcaFila = {
  id: string;
  codigo: string;
  nombre: string;
  agrupacion_marca_id: string;
  tratamiento_especial: boolean;
  /** Solo con `tratamiento_especial`; ≤ 200 caracteres. */
  nota_tratamiento: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  agrupacion_marca: AgrupacionMarcaEmbebida;
  /** `activo ∧ agrupacion_marca.activo`. */
  vigente: boolean;
  /** 02b: solo con la casilla; `null` sin casilla (o heredada de antes de `0010`, que se lee `barrido`). */
  modalidad_tratamiento: Modalidad | null;
  /** 02b regla 1: `null` sin casilla; con casilla y modalidad nula se lee `barrido`. */
  modalidad_efectiva: Modalidad | null;
  /** 02b: asignaciones marca × GML guardadas (vigentes o ignoradas). */
  gml_asignados: number;
  /** 02b: las vigentes (las que cuentan en el flujo). */
  gml_vigentes: number;
  /** 02b: la cabeza del conjunto a la que pertenece, o `null`. */
  conjunto_marca_id: string | null;
  conjunto: ConjuntoEmbebido | null;
  /** 02b: la cabeza si la marca es miembro de un conjunto efectivo, si no la marca misma. */
  unidad_marca_id: string;
  /** 02b: cuántas marcas la tienen de cabeza. */
  miembros: number;
  avisos_conjunto: AvisoConjunto[];
};

export type CrearMarcaCuerpo = {
  nombre: string;
  codigo?: string;
  agrupacion_marca_id: string;
  tratamiento_especial?: boolean;
  nota_tratamiento?: string | null;
  /** 02b: con casilla y sin modalidad se guarda `barrido`; modalidad sin casilla → `400`. */
  modalidad_tratamiento?: Modalidad | null;
};

export type EditarMarcaCuerpo = Partial<{
  nombre: string;
  codigo: string;
  agrupacion_marca_id: string;
  tratamiento_especial: boolean;
  nota_tratamiento: string | null;
  modalidad_tratamiento: Modalidad | null;
  /** 02b: entrar en un conjunto, cambiar de conjunto (uuid de la cabeza) o salir (`null`). */
  conjunto_marca_id: string | null;
  activo: boolean;
}>;

/** `DELETE /api/marcas/[id]`: las asignaciones por GML se van en cascada. */
export type EliminarMarcaRespuesta = { id: string; gml_eliminados: number };

// ─── Importador de marcas (POST /api/marcas/importar) ───

/**
 * Una fila del archivo ya mapeada; `tratamiento_especial` es `""` si la
 * columna no se mapeó. `conjunto` (02b, opcional) también: ausente o `""` =
 * "no opina".
 */
export type FilaImportacionMarca = {
  marca: string;
  agrupacion: string;
  tratamiento_especial: string;
  conjunto?: string;
};

export type MotivoOmisionMarca =
  | "marca_vacia"
  | "fila_total"
  | "agrupacion_vacia"
  | "agrupacion_desconocida"
  | "agrupacion_inactiva"
  | "tratamiento_invalido"
  | "duplicada_en_archivo";

/** Fila omitida con su contenido normalizado (`tratamiento_especial` tal como vino), para corregir el archivo. */
export type FilaOmitidaMarca = FilaImportacionMarca & {
  fila: number;
  motivo: MotivoOmisionMarca;
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición de la misma marca. */
  fila_original?: number;
};

/** Marca existente cuyo archivo trae otra agrupación, tratamiento o conjunto; informativo, el importador no la modifica. */
export type DiferenciaImportacionMarca = {
  fila: number;
  marca: string;
  campo: "agrupacion" | "tratamiento_especial" | "conjunto";
  /** Legibles: nombre de agrupación, `SI`/`NO` o nombre del conjunto (`(ninguno)`). */
  en_base: string;
  en_archivo: string;
};

export type ConteosCrearMarcas = {
  marcas: number;
  con_tratamiento_especial: number;
  /** 02b: marcas nuevas que entran con su conjunto. */
  con_conjunto: number;
};
export type ConteosExistentesMarcas = { marcas: number };

/** 02b: cabeza que no existe y se creará con la agrupación de la primera fila que la nombra. */
export type ConjuntoACrear = {
  conjunto: string;
  agrupacion: string;
  /** Marca (de la fila que la nombra primero) de la que se toma la agrupación. */
  de: string;
};

/** 02b: por qué la columna `CONJUNTO` de una fila no se aplicó (la marca se crea igual, sin conjunto). */
export type ConjuntoOmitidoMarca = {
  fila: number;
  marca: string;
  conjunto: string;
  motivo: MotivoOmisionConjunto;
  detalle?: string;
};

/** Reporte sin `modo`: lo produce `planificarImportacionMarcas`; el handler le agrega el modo. */
export type ReporteImportacionMarcasBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: ConteosCrearMarcas;
  existentes: ConteosExistentesMarcas;
  existentes_inactivos: ConteosExistentesMarcas;
  diferencias: DiferenciaImportacionMarca[];
  omitidas: FilaOmitidaMarca[];
  /** Primeras 20 como `"LEVI'S → PREMIUM"`. */
  muestra: { marcas: string[] };
  /** 02b: columna `CONJUNTO` (solo marcas nuevas; las existentes con otro conjunto van a `diferencias`). */
  conjuntos: { a_crear: ConjuntoACrear[]; omitidos: ConjuntoOmitidoMarca[] };
};

export type ReporteImportacionMarcas = ReporteImportacionMarcasBase & { modo: ModoImportacion };

// ─── Etiquetas de pantalla (M2) ───

export const ETIQUETA_MOTIVO_OMISION_MARCA: Record<MotivoOmisionMarca, string> = {
  marca_vacia: "Marca vacía",
  fila_total: "Fila de totales",
  agrupacion_vacia: "Agrupación vacía",
  agrupacion_desconocida: "Agrupación desconocida",
  agrupacion_inactiva: "Agrupación inactiva",
  tratamiento_invalido: "Tratamiento especial no reconocido",
  duplicada_en_archivo: "Duplicada en el archivo",
};

export const ETIQUETA_CAMPO_DIFERENCIA: Record<DiferenciaImportacionMarca["campo"], string> = {
  agrupacion: "Agrupación",
  tratamiento_especial: "Tratamiento especial",
  conjunto: "Conjunto",
};

// ─── Marcas relevantes por GML: estado (GET /api/marcas/gml-especial) ───

export type MotivoIgnorada =
  | "marca_sin_tratamiento"
  | "marca_no_vigente"
  | "marca_en_barrido"
  | "en_conjunto"
  | "gml_no_vigente";

/** Una asignación marca × GML dentro de `marcas[].gml`. */
export type AsignacionGml = {
  id: string;
  genero_mundo_linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  nivel_planificacion: NivelPlanificacion;
  nota: string | null;
  /** Vigente = cuenta en el flujo (`motivo_ignorada` es `null`). */
  vigente: boolean;
  motivo_ignorada: MotivoIgnorada | null;
  /** Con `gml_no_vigente`, qué padre está inactivo ("línea TERNO inactiva"); con `en_conjunto`, quién la cuenta. */
  detalle?: string;
  created_at: string;
};

export type MotivoPendiente = "sin_gml" | "sin_modalidad" | "marca_no_vigente";

export type MarcaEstadoGml = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  vigente: boolean;
  agrupacion_marca: { id: string; nombre: string; activo: boolean };
  modalidad_tratamiento: Modalidad | null;
  modalidad_efectiva: Modalidad | null;
  nota_tratamiento: string | null;
  /** Cabeza del conjunto al que pertenece (aunque esté inactiva), o `null`. */
  conjunto: { id: string; nombre: string } | null;
  /** Nombres de las marcas que la tienen de cabeza. */
  miembros: string[];
  gml: AsignacionGml[];
  pendiente: boolean;
  motivo_pendiente: MotivoPendiente | null;
};

export type NodoEstadoGml = {
  genero_mundo_linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  vigente: boolean;
  nivel_planificacion: NivelPlanificacion;
  agrupaciones: {
    agrupacion_marca_id: string;
    nombre: string;
    marcas: { marca_id: string; nombre: string; vigente: boolean }[];
  }[];
  relevantes_vigentes: number;
};

export type ResumenGmlEspecial = {
  marcadas: number;
  por_gml: number;
  barrido: number;
  sin_modalidad: number;
  asignaciones: number;
  asignaciones_vigentes: number;
  asignaciones_ignoradas: number;
  pendientes_sin_gml: number;
  nodos_con_relevantes: number;
  /** Aviso suave (pregunta 14): nodos donde alguna agrupación pasa de 4 relevantes vigentes. */
  nodos_con_mas_de_4_por_agrupacion: number;
};

export type EstadoGmlEspecial = {
  marcas: MarcaEstadoGml[];
  por_nodo: NodoEstadoGml[];
  resumen: ResumenGmlEspecial;
};

export const ETIQUETA_MOTIVO_IGNORADA: Record<MotivoIgnorada, string> = {
  marca_sin_tratamiento: "marca sin tratamiento especial",
  marca_no_vigente: "marca o agrupación inactiva",
  marca_en_barrido: "marca al barrer",
  en_conjunto: "la marca es miembro de un conjunto (cuenta su cabeza)",
  gml_no_vigente: "GML no vigente",
};

// ─── Asignación individual y en bloque ───

/** De qué estado pasa la marca a `por_gml` al recibir un GML. */
export type CambioMarca = { de: "sin_tratamiento" | "barrido" | "sin_modalidad"; a: "por_gml" };

/** `POST /api/marcas/gml-especial`. */
export type CrearGmlEspecialCuerpo = { marca_id: string; genero_mundo_linea_id: string; nota?: string | null };

/** `201`: la asignación (misma forma que en el estado) más el cambio que sufrió la marca. */
export type CrearGmlEspecialRespuesta = AsignacionGml & { marca_id: string; cambio_marca: CambioMarca | null };

/** `PATCH /api/marcas/gml-especial/[id]`. */
export type EditarGmlEspecialCuerpo = { nota: string | null };

/** `PATCH`: la asignación con el mismo formato del estado. */
export type EditarGmlEspecialRespuesta = AsignacionGml & { marca_id: string };

/** `DELETE /api/marcas/gml-especial/[id]`. */
export type EliminarGmlEspecialRespuesta = { id: string };

export type MotivoNoPermitidoGml =
  | "marca_no_encontrada"
  | "nodo_no_encontrado"
  | "marca_inactiva"
  | "marca_en_conjunto"
  | "nodo_no_vigente";

export const ETIQUETA_MOTIVO_NO_PERMITIDO_GML: Record<MotivoNoPermitidoGml, string> = {
  marca_no_encontrada: "marca no encontrada",
  nodo_no_encontrado: "GML no encontrado",
  marca_inactiva: "marca inactiva",
  marca_en_conjunto: "la marca es miembro de un conjunto: hazla relevante en su cabeza",
  nodo_no_vigente: "GML no vigente",
};

export type ParMarcaNodo = { marca_id: string; nodo_id: string };

/** `POST /api/marcas/gml-especial/asignar`: producto cartesiano (hasta 5 000 pares) o lista de pares. */
export type AsignarGmlCuerpo =
  | { forma: "cartesiano"; accion: "asignar" | "quitar"; marca_ids: string[]; nodo_ids: string[]; nota?: string | null }
  | { forma: "pares"; accion: "asignar" | "quitar"; pares: ParMarcaNodo[]; nota?: string | null };

export type NoPermitidaGml = {
  marca_id: string;
  marca: string;
  nodo_id: string;
  ruta: string;
  motivo: MotivoNoPermitidoGml;
  detalle?: string;
};

export type CambioMarcaBloque = { marca_id: string; marca: string; de: CambioMarca["de"]; a: "por_gml" };

/** Invariante: `pares = asignadas + sin_cambio + quitadas + no_permitidas.length`. */
export type AsignarGmlRespuesta = {
  accion: "asignar" | "quitar";
  pares: number;
  asignadas: number;
  sin_cambio: number;
  quitadas: number;
  no_permitidas: NoPermitidaGml[];
  cambios_marca: CambioMarcaBloque[];
};

// ─── Sugerencias de marcas relevantes ───

export type MedidaSugerencia = "venta_soles" | "unidades";

export type EstadoSugerencia = "nueva" | "ya_relevante" | "marca_al_barrer" | "marca_inactiva" | "nodo_no_vigente";

/** Filas por unidad de marca: ALFA aparece con la venta de ALFA + ALFA JEANS + ALFA KIDS. */
export type SugerenciaGml = {
  genero_mundo_linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  nivel_planificacion: NivelPlanificacion;
  agrupacion_marca_id: string;
  agrupacion: string;
  marca_id: string;
  marca: string;
  /** Marcas que se cuentan dentro de esta unidad además de ella misma (`"ALFA (3 marcas)"`: 2). */
  miembros: number;
  rango: number;
  unidades: number;
  venta_soles: number;
  /** Fracción 0..1 sobre el total de la agrupación en el GML. */
  participacion: number;
  estado: EstadoSugerencia;
};

export type RespuestaSugerencias = {
  /** `aaaa-mm`. */
  rango: { desde: string; hasta: string; meses_publicados: number };
  sugerencias: SugerenciaGml[];
  resumen: { nodos: number; pares: number; nuevas: number; ya_relevantes: number; al_barrer: number };
};

export const ETIQUETA_ESTADO_SUGERENCIA: Record<EstadoSugerencia, string> = {
  nueva: "Nueva",
  ya_relevante: "Ya relevante",
  marca_al_barrer: "Marca al barrer",
  marca_inactiva: "Marca inactiva",
  nodo_no_vigente: "GML no vigente",
};

// ─── Vigentes (GET /api/marcas/gml-especial/vigentes): contrato para M7 y M8 ───

export type RelevanteVigente = { marca_id: string; marca: string; miembros: string[] };

export type AgrupacionVigente = { agrupacion_marca_id: string; agrupacion: string; relevantes: RelevanteVigente[] };

export type GmlVigente = {
  genero_mundo_linea_id: string;
  genero: string;
  mundo: string;
  linea: string;
  nivel_planificacion: NivelPlanificacion;
  agrupaciones: AgrupacionVigente[];
};

export type BarridoVigente = {
  marca_id: string;
  marca: string;
  agrupacion_marca_id: string;
  agrupacion: string;
  miembros: string[];
};

export type PendienteVigente = { marca_id: string; marca: string; motivo: "sin_gml" | "sin_modalidad" };

export type VigentesRespuesta = {
  /** Solo GML vigentes con al menos una marca relevante vigente. */
  gml: GmlVigente[];
  barrido: BarridoVigente[];
  /** Mapa marca → unidad de toda marca con conjunto efectivo (lo mismo que la vista de unidades de marca). */
  unidades: { marca_id: string; unidad_marca_id: string }[];
  pendientes: PendienteVigente[];
  nodos_gmle: number;
  calculado_at: string;
};

// ─── Contrato de M7 y M8: claveFlujo y curvaUnidad ───

/** Un hecho de venta o stock: lo que `claveFlujo` necesita (la equivalencia da el nodo). */
export type HechoFlujo = { marca_id: string; equivalencia_id: string };

/**
 * A qué fila del flujo va un hecho. `unidad` con `marca_id` = marca relevante
 * dentro de su agrupación; con `marca_id: null` = "otras de la agrupación".
 * `barrido` = flujo propio fuera de las unidades de planificación.
 */
export type ClaveFlujo =
  | {
      tipo: "unidad";
      gml_id: string;
      /** El de la equivalencia si el nodo es `GMLE`; `null` si es `GML`. */
      equivalencia_id: string | null;
      agrupacion_marca_id: string;
      marca_id: string | null;
    }
  | { tipo: "barrido"; marca_id: string };

/** Curva mensual: doce participaciones que suman 1. */
export type CurvaMensual = readonly number[];

export type AvisoCurva = "curva_incompleta";

export type ResultadoCurvaUnidad = {
  /** `null` si ninguna equivalencia con peso tiene curva vigente. */
  curva: number[] | null;
  avisos: AvisoCurva[];
};

// ─── Conjuntos de marcas (/api/marcas/conjuntos) ───

export type ConjuntoMiembro = {
  id: string;
  nombre: string;
  activo: boolean;
  agrupacion_marca: { id: string; nombre: string };
  avisos: AvisoConjunto[];
};

export type ConjuntoCabeza = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  agrupacion_marca: { id: string; nombre: string };
  tratamiento_especial: boolean;
  modalidad_efectiva: Modalidad | null;
  gml_vigentes: number;
  /** Tiene venta o stock cargados en M5. */
  vende: boolean;
};

export type ConjuntoFila = {
  cabeza: ConjuntoCabeza;
  miembros: ConjuntoMiembro[];
  /** La cabeza está activa: los miembros cuentan como ella. */
  efectivo: boolean;
  avisos: AvisoConjunto[];
};

export type ResumenConjuntos = {
  conjuntos: number;
  marcas_en_conjunto: number;
  cabezas_inactivas: number;
  con_agrupacion_distinta: number;
  miembros_con_config_propia: number;
  cadenas: number;
};

export type RespuestaConjuntos = { conjuntos: ConjuntoFila[]; resumen: ResumenConjuntos };

export type MiembrosCuerpo = { cabeza_marca_id: string; accion: "asignar" | "quitar"; marca_ids: string[] };

export type MotivoRechazoConjunto =
  | "cabeza_no_encontrada"
  | "marca_no_encontrada"
  | "conjunto_propio"
  | "cabeza_inactiva"
  | "cabeza_es_miembro"
  | "marca_es_cabeza"
  | "marca_generica";

export const ETIQUETA_MOTIVO_RECHAZO_CONJUNTO: Record<MotivoRechazoConjunto, string> = {
  cabeza_no_encontrada: "la cabeza no existe",
  marca_no_encontrada: "la marca no existe",
  conjunto_propio: "una marca no puede ser su propio conjunto",
  cabeza_inactiva: "la cabeza está inactiva",
  cabeza_es_miembro: "la cabeza es miembro de otro conjunto",
  marca_es_cabeza: "es cabeza de un conjunto: quita primero sus miembros",
  marca_generica: "es VARIOS, OTROS o SIN MARCA y no entra en conjuntos",
};

export type CambiadaDeConjunto = { marca_id: string; marca: string; de_conjunto_id: string; de: string };

/** Invariante: `|marca_ids| = asignadas + quitadas + sin_cambio + no_permitidas.length`. */
export type MiembrosRespuesta = {
  asignadas: number;
  quitadas: number;
  sin_cambio: number;
  no_permitidas: { marca_id: string; marca: string; motivo: MotivoRechazoConjunto }[];
  /** Las que estaban en otro conjunto y pasaron a este (ya cuentan en `asignadas`). */
  cambiadas_de_conjunto: CambiadaDeConjunto[];
};

/** `GET /api/marcas/conjuntos/sugerencias?umbral=`: solo ayuda, nunca crea nada. */
export type RazonSugerenciaConjunto = {
  /** Nombres de las dos marcas que la señal une. */
  a: string;
  b: string;
  razon: "primera_palabra" | "similar";
  /** Solo con `similar` (Dice sobre bigramas, 2 decimales). */
  similitud?: number;
  /** Texto para pantalla: `"primera palabra común: ALFA"`, `"similar 0,75"`. */
  detalle: string;
};

export type GrupoSugeridoConjunto = {
  /** La marca de nombre más corto (a igualdad, la primera de la lista); el planner puede cambiarla. */
  cabeza_id: string;
  cabeza: { id: string; nombre: string };
  marcas: { id: string; nombre: string; agrupacion_marca: { id: string; nombre: string } }[];
  razones: RazonSugerenciaConjunto[];
};

export type SugerenciasConjuntosRespuesta = { grupos: GrupoSugeridoConjunto[] };

// ─── Importador de conjuntos (POST /api/marcas/conjuntos/importar) ───

export type FilaImportacionConjunto = { marca: string; conjunto: string };

export type MotivoOmisionConjunto =
  | "marca_vacia"
  | "fila_total"
  | "marca_desconocida"
  | "conjunto_igual_marca"
  | "marca_generica"
  | "marca_es_cabeza"
  | "conjunto_es_miembro"
  | "cabeza_inactiva"
  | "agrupacion_inactiva"
  | "duplicada_en_archivo";

export const ETIQUETA_MOTIVO_OMISION_CONJUNTO: Record<MotivoOmisionConjunto, string> = {
  marca_vacia: "Marca vacía",
  fila_total: "Fila de totales",
  marca_desconocida: "Marca desconocida",
  conjunto_igual_marca: "La marca es igual al conjunto",
  marca_generica: "Marca genérica (VARIOS, OTROS, SIN MARCA)",
  marca_es_cabeza: "La marca es cabeza de un conjunto",
  conjunto_es_miembro: "El conjunto es miembro de otro",
  cabeza_inactiva: "La cabeza está inactiva",
  agrupacion_inactiva: "La cabeza nueva iría en una agrupación inactiva",
  duplicada_en_archivo: "Duplicada en el archivo",
};

export type FilaOmitidaConjunto = FilaImportacionConjunto & {
  fila: number;
  motivo: MotivoOmisionConjunto;
  detalle?: string;
  fila_original?: number;
};

/** La marca estaba en otro conjunto y el archivo manda: `de → a`. */
export type CambioConjunto = { fila: number; marca: string; de: string; a: string };

export type ReporteConjuntosBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  /** Marcas que entran a un conjunto sin estar en ninguno. */
  asignar: number;
  /** Marcas que cambian de conjunto. */
  cambios: CambioConjunto[];
  /** Cabezas que no existen como marca y se crearán, con la agrupación de la primera fila que las nombra. */
  conjuntos_a_crear: ConjuntoACrear[];
  /** Marcas que ya estaban en ese conjunto. */
  existentes: number;
  /** Filas con `CONJUNTO` vacío: no opinan. */
  sin_opinion: number;
  omitidas: FilaOmitidaConjunto[];
  /** Primeras 20 como `"ALFA JEANS → ALFA"`. */
  muestra: { asignaciones: string[] };
};

export type ReporteImportacionConjuntos = ReporteConjuntosBase & { modo: ModoImportacion };

// ─── Importador de marcas relevantes (POST /api/marcas/gml-especial/importar) ───

export type FilaImportacionGml = { marca: string; genero: string; mundo: string; linea: string; nota: string };

export type MotivoOmisionGml =
  | "marca_vacia"
  | "fila_total"
  | "marca_desconocida"
  | "marca_inactiva"
  | "marca_en_conjunto"
  | "genero_vacio"
  | "genero_desconocido"
  | "genero_inactivo"
  | "mundo_vacio"
  | "mundo_desconocido"
  | "mundo_inactivo"
  | "linea_vacia"
  | "linea_desconocida"
  | "linea_inactiva"
  | "gml_inexistente"
  | "gml_inactivo"
  | "nota_larga"
  | "duplicada_en_archivo";

export const ETIQUETA_MOTIVO_OMISION_GML: Record<MotivoOmisionGml, string> = {
  marca_vacia: "Marca vacía",
  fila_total: "Fila de totales",
  marca_desconocida: "Marca desconocida",
  marca_inactiva: "Marca inactiva",
  marca_en_conjunto: "La marca es miembro de un conjunto: usa la cabeza",
  genero_vacio: "Género vacío",
  genero_desconocido: "Género desconocido",
  genero_inactivo: "Género inactivo",
  mundo_vacio: "Mundo vacío",
  mundo_desconocido: "Mundo desconocido",
  mundo_inactivo: "Mundo inactivo",
  linea_vacia: "Línea vacía",
  linea_desconocida: "Línea desconocida",
  linea_inactiva: "Línea inactiva",
  gml_inexistente: "Esa línea no está en ese género y mundo",
  gml_inactivo: "Género-mundo-línea inactivo",
  nota_larga: "Nota de más de 200 caracteres",
  duplicada_en_archivo: "Duplicada en el archivo",
};

export type FilaOmitidaGml = FilaImportacionGml & {
  fila: number;
  motivo: MotivoOmisionGml;
  detalle?: string;
  /** Solo en `duplicada_en_archivo`: la primera aparición del mismo par marca × GML. */
  fila_original?: number;
};

/** Par que ya existe con otra nota; informativo, el importador no lo modifica. */
export type DiferenciaImportacionGml = {
  fila: number;
  marca: string;
  ruta: string;
  campo: "nota";
  en_base: string | null;
  en_archivo: string | null;
};

export type ReporteGmlBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  /** `procesadas = crear.asignaciones + existentes.asignaciones`. */
  crear: { asignaciones: number; por_marca: { marca_id: string; marca: string; asignaciones: number }[] };
  existentes: { asignaciones: number };
  /** Marcas no `por_gml` con al menos una asignación nueva: pasarán a `por_gml`. */
  cambios_marca: CambioMarcaBloque[];
  diferencias: DiferenciaImportacionGml[];
  omitidas: FilaOmitidaGml[];
  /** Primeras 20 como `"ALFA → HOMBRE · URBANO · DENIM"`. */
  muestra: { asignaciones: string[] };
};

export type ReporteImportacionGml = ReporteGmlBase & { modo: ModoImportacion };

// ─── Query strings ───

/** `GET /api/marcas/gml-especial/sugerencias`. */
export type SugerenciasQuery = {
  desde?: string;
  hasta?: string;
  top?: number;
  min_participacion?: number;
  medida?: MedidaSugerencia;
};
