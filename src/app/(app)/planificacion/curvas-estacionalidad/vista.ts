import { normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearDecimal, formatearNumero, formatearPp as formatearPpCompartido } from "@/lib/formato";
import { MESES_CORTOS, MESES_LARGOS } from "@/lib/reportes/histograma";
import {
  DESCRIPCION_MODELO_USUARIO,
  ETIQUETA_MOTIVO_RED,
  ETIQUETA_TEMPORADA,
  MODELOS,
  esModeloAprobable,
  type AgrupacionCurvasApi,
  type AgrupacionResultado,
  type AnioAgrupacion,
  type AvisoVigenteApi,
  type ClaseAnioCurva,
  type CodigoAviso,
  type CodigoPrerrequisito,
  type EfectoAtipicoCorrida,
  type EfectoTemporadaAnio,
  type EstadoAgrupacion,
  type ModeloAprobable,
  type ModeloCurva,
  type MotivoTratamiento,
  type ObsoletaApi,
  type PartidaCurvaUsuario,
  type RedAnioApi,
  type ResumenEstadoCurvas,
  type RedTiendaAnioApi,
  type TemporadaAgrupacion,
  type TrabajoAgrupacionApi,
  type TratamientoAnio,
  type TratamientoAtipicos,
  type VeredictoForma,
} from "@/lib/curvas/tipos-api";
import { resumirMeses } from "./meses";

/**
 * Presentación pura de la pantalla de curvas (M6): formatos, textos, filtros,
 * comparaciones y adaptadores de datos. Sin React ni acceso a la API: las prueba
 * vitest con datos sintéticos.
 */

// ─── Formatos (los compartidos de `src/lib/formato.ts`: el servidor y la pantalla escriben igual) ───

const numero = (n: number, decimales: number): string => formatearDecimal(n, decimales);

/** Fracción → porcentaje: `0.123` → `12.3 %`; `—` si no hay valor. */
export function formatearPct(fraccion: number | null | undefined, decimales = 1): string {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return "—";
  return `${numero(fraccion * 100, decimales)} %`;
}

/** Solo el número del porcentaje (sin el signo `%`), para celdas de tabla. */
export function formatearPctSolo(fraccion: number | null | undefined, decimales = 1): string {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return "—";
  return numero(fraccion * 100, decimales);
}

/** Puntos porcentuales: `29.1 pp`. */
export function formatearPp(pp: number | null | undefined, decimales = 1): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  return formatearPpCompartido(pp, decimales);
}

/** Diferencia en puntos con signo: `+1.8`, `-0.4`, `0.0`. */
export function formatearDiferenciaPp(pp: number | null | undefined, decimales = 1): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  const redondeado = Math.round(pp * 10 ** decimales) / 10 ** decimales;
  const texto = numero(Math.abs(redondeado), decimales);
  if (redondeado === 0) return texto;
  return `${redondeado > 0 ? "+" : "-"}${texto}`;
}

/** Ratio: `0.66` (dos decimales por defecto), `—` sin valor. */
export function formatearRatio(r: number | null | undefined, decimales = 2): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return numero(r, decimales);
}

/** `×0.66` para celdas compactas. */
export function formatearFactor(r: number | null | undefined, decimales = 2): string {
  return r === null || r === undefined || !Number.isFinite(r) ? "—" : `×${formatearRatio(r, decimales)}`;
}

function partesLima(iso: string): Record<string, string> | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  return Object.fromEntries(partes.map((p) => [p.type, p.value]));
}

/** `14/10/2026 10:42` en hora de Lima; el texto original si no es una fecha. */
export function formatearFechaHora(iso: string): string {
  const p = partesLima(iso);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : iso;
}

/** `14/10` en hora de Lima (año cuando no es el de `anioReferencia`). */
export function formatearDiaMes(iso: string, anioReferencia?: number): string {
  const p = partesLima(iso);
  if (!p) return iso;
  return anioReferencia !== undefined && Number(p.year) !== anioReferencia ? `${p.day}/${p.month}/${p.year}` : `${p.day}/${p.month}`;
}

/** Nombre largo del mes 1-12. */
export function nombreMes(mes: number): string {
  return MESES_LARGOS[mes - 1]?.toLowerCase() ?? String(mes);
}

/** `ene–set` para los primeros `k` meses del año. */
export function rangoPrimerosMeses(k: number): string {
  if (k <= 0) return "—";
  if (k === 1) return MESES_CORTOS[0].toLowerCase();
  return `${MESES_CORTOS[0].toLowerCase()}–${MESES_CORTOS[Math.min(11, k - 1)].toLowerCase()}`;
}

// ─── Etiquetas ───

export const ETIQUETA_CLASE: Record<ClaseAnioCurva, string> = {
  normal: "Normal",
  con_huecos: "Con huecos",
  atipico_completo: "Atípico completo",
  incompleto: "Incompleto",
  en_curso: "En curso",
};

export const ETIQUETA_TRATAMIENTO: Record<TratamientoAnio, string> = {
  incluido: "incluido",
  imputado: "imputado",
  descartado: "descartado",
};

export const ETIQUETA_VEREDICTO: Record<VeredictoForma, string> = {
  forma_estable: "Estable",
  forma_cambia: "Cambia",
  sin_comparacion: "Sin comparación",
};

export const ETIQUETA_AVISO: Record<CodigoAviso, string> = {
  sin_anos_utilizables: "Sin años utilizables",
  pocos_anos_ajuste: "Pocos años de ajuste",
  escaso: "Año escaso",
  cambio_volumen_extremo: "Cambio de volumen extremo",
  meses_sin_cargar: "Meses sin cargar",
  mes_negativo: "Mes negativo",
  forma_cambia: "La forma cambia",
  sin_referencia: "Sin referencia",
  sin_referencia_volumen: "Sin referencia de volumen",
  pocos_anos_normales: "Pocos años normales",
  ano_atipico_completo: "Año atípico completo",
  temporada_sugerida_distinta: "Temporada distinta de la sugerida",
  temporadas_mezcladas: "Temporadas mezcladas",
  anio_excluido: "Año excluido a mano",
  liquidacion_fuerte: "Liquidación fuerte",
  sin_venta: "Sin venta",
  inactiva_con_curva: "Inactiva con curva",
  tienda_dominante: "Tienda dominante",
  tienda_distinta: "Tienda distinta",
  sin_red_comparable: "Sin red comparable",
  prestada: "Curva prestada",
};

export function etiquetaModelo(codigo: ModeloAprobable): string {
  if (codigo === "U") return DESCRIPCION_MODELO_USUARIO.nombre;
  const m = MODELOS.find((x) => x.codigo === codigo);
  return m ? m.nombre : codigo;
}

/** `B · Ponderado por volumen`. */
export function modeloConNombre(codigo: ModeloAprobable): string {
  return `${codigo} · ${etiquetaModelo(codigo)}`;
}

/** Etiqueta de la serie y de la fila de la propuesta: `Propuesta A · Promedio simple`. */
export function etiquetaPropuesta(modelo: ModeloCurva): string {
  return `Propuesta ${modeloConNombre(modelo)}`;
}

/** Etiqueta de la serie y de la fila de la aprobada: `Aprobada v2 (A)`. */
export function etiquetaAprobada(version: number, modelo: ModeloAprobable): string {
  return `Aprobada v${version} (${modelo})`;
}

export const ETIQUETA_MOTIVO_RECOMENDACION = {
  sin_evidencia: "sin evidencia para apartarse del promedio",
  menor_error: "menor error",
  prestada: "sin años suficientes: curva de la temporada",
} as const;

export const ETIQUETA_ESTABILIDAD = { alta: "Alta", media: "Media", baja: "Baja" } as const;

type DatosAnioTexto = {
  anio: number;
  clase: ClaseAnioCurva;
  tratamiento: TratamientoAnio | null;
  escaso: boolean;
  meses_atipicos: number;
};

/** Notas de un año (clase fuera de lo normal, tratamiento, escaso): `["atípico completo", "incluido"]`. */
export function notasAnio(a: DatosAnioTexto): string[] {
  const notas: string[] = [];
  if (a.clase === "atipico_completo") notas.push("atípico completo");
  else if (a.clase === "con_huecos") notas.push(`${a.meses_atipicos} ${a.meses_atipicos === 1 ? "mes atípico" : "meses atípicos"}`);
  else if (a.clase === "incompleto") notas.push("incompleto");
  else if (a.clase === "en_curso" && a.meses_atipicos > 0) notas.push("atípico");
  if (a.tratamiento && a.clase !== "normal") notas.push(ETIQUETA_TRATAMIENTO[a.tratamiento]);
  if (a.escaso) notas.push("escaso");
  return notas;
}

/** Texto de un año para la columna Años y el `confirm`: `2023 (atípico completo, incluido)`. */
export function textoAnio(a: DatosAnioTexto): string {
  const notas = notasAnio(a);
  const base = a.clase === "en_curso" ? `${a.anio} parcial` : String(a.anio);
  return notas.length === 0 ? base : `${base} (${notas.join(", ")})`;
}

/** Descripción corta de la clase para la cabecera de la tabla año × mes: `parcial, ene–set, atípico`; `normal`. */
export function descripcionClase(a: DatosAnioTexto & { meses_cargados: number }): string {
  const partes = notasAnio(a);
  if (a.clase === "en_curso") partes.unshift(`parcial, ${rangoPrimerosMeses(a.meses_cargados)}`);
  return partes.join(", ") || "normal";
}

/** Tono de color de la clase del año (clases de Tailwind del tema). */
export function claseColorAnio(clase: ClaseAnioCurva, escaso = false): string {
  if (escaso) return "text-tinta-suave";
  switch (clase) {
    case "atipico_completo":
    case "con_huecos":
      return "text-alerta";
    case "en_curso":
      return "text-marca-oscura";
    case "incompleto":
      return "text-tinta-suave";
    default:
      return "text-tinta";
  }
}

/** Color por signo de una diferencia en puntos (`claseVariacion` de M11): sube = éxito, baja = alerta, 0 = neutro. */
export function claseDiferencia(pp: number | null): string {
  if (pp === null || Math.round(pp * 10) === 0) return "text-tinta-suave";
  return pp > 0 ? "text-exito" : "text-alerta";
}

// ─── Obsolescencia ───

/** `Obsoleta: la tienda X entra en la red de 2026` (todos los motivos, separados por «; »). */
export function textoObsoleta(o: ObsoletaApi | null): string | null {
  if (!o || o.motivos.length === 0) return null;
  return `Obsoleta: ${o.motivos.map((m) => m.detalle).join("; ")}`;
}

// ─── Lista de agrupaciones: estados, filtros y resumen ───

export const ETIQUETA_ESTADO: Record<EstadoAgrupacion, string> = {
  sin_curva: "Sin curva",
  al_dia: "Al día",
  al_dia_distinta: "Al día · distinta de la recomendada",
  obsoleta: "Obsoleta",
  curva_usuario: "Curva del usuario",
  inactiva_con_curva: "Inactiva con curva",
};

/** Texto corto de un prerrequisito que bloquea y se evalúa sin calcular (`bloqueada_por` de la lista). */
export function textoBloqueo(codigo: CodigoPrerrequisito, temporada: TemporadaAgrupacion): string {
  switch (codigo) {
    case "periodos_temporada_faltantes":
      return `Bloqueada: sin periodos para ${ETIQUETA_TEMPORADA[temporada].toLowerCase()}`;
    case "composicion_vacia":
      return "Bloqueada: sin equivalencias";
    case "tienda_sin_apertura":
      return "Bloqueada: hay una tienda con venta sin fecha de apertura";
    case "sin_meses_publicados":
      return "Bloqueada: no hay meses publicados";
    default:
      return "Bloqueada";
  }
}

export const ETIQUETA_AVISO_VIGENTE: Record<AvisoVigenteApi["codigo"], string> = {
  datos_posteriores: "Datos posteriores",
  modelo_anterior: "Modelo anterior",
  temporada_recompuesta: "Temporada recompuesta",
  cambio_desde_aprobacion: "Cambio desde la aprobación",
};

export type FiltroTemporada = "todas" | TemporadaAgrupacion;
export type FiltroEstado = "todas" | "sin_curva" | "obsoletas" | "distintas" | "al_dia" | "usuario" | "bloqueadas";

export function cumpleEstado(a: AgrupacionCurvasApi, f: FiltroEstado): boolean {
  switch (f) {
    case "todas":
      return true;
    case "sin_curva":
      return a.estado === "sin_curva";
    case "obsoletas":
      return a.estado === "obsoleta";
    case "distintas":
      return a.estado === "al_dia_distinta";
    case "al_dia":
      return a.estado === "al_dia";
    case "usuario":
      return a.estado === "curva_usuario";
    case "bloqueadas":
      return a.bloqueada_por.length > 0;
  }
}

export const FILTROS_ESTADO: { id: FiltroEstado; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "sin_curva", label: "Sin curva" },
  { id: "obsoletas", label: "Obsoletas" },
  { id: "distintas", label: "Distintas" },
  { id: "al_dia", label: "Al día" },
  { id: "usuario", label: "Curva del usuario" },
  { id: "bloqueadas", label: "Bloqueadas" },
];

/** Conteo de cada chip de estado sobre las agrupaciones activas. */
export function contarEstados(agrupaciones: readonly AgrupacionCurvasApi[]): Record<FiltroEstado, number> {
  const activas = agrupaciones.filter((a) => a.activo);
  const r = {} as Record<FiltroEstado, number>;
  for (const f of FILTROS_ESTADO) r[f.id] = activas.filter((a) => cumpleEstado(a, f.id)).length;
  return r;
}

export type OpcionesFiltro = { temporada: FiltroTemporada; estado: FiltroEstado; genero: string; busqueda: string };

/**
 * Agrupaciones que pasan los filtros, alfabéticas y con las inactivas al final.
 * Con un chip puesto las inactivas no se listan (así el conteo coincide con las filas).
 */
export function filtrarAgrupaciones(agrupaciones: readonly AgrupacionCurvasApi[], o: OpcionesFiltro): AgrupacionCurvasApi[] {
  const q = normalizarNombre(o.busqueda);
  const hayChip = o.temporada !== "todas" || o.estado !== "todas";
  return agrupaciones
    .filter((a) => !hayChip || a.activo)
    .filter((a) => o.temporada === "todas" || a.temporada === o.temporada)
    .filter((a) => cumpleEstado(a, o.estado))
    .filter((a) => o.genero === "" || a.generos.includes(o.genero))
    .filter((a) => q === "" || normalizarNombre(a.nombre).includes(q))
    .sort((a, b) => Number(!a.activo) - Number(!b.activo) || a.nombre.localeCompare(b.nombre, "es"));
}

/** Nombres de género distintos, ordenados. */
export function generosDe(agrupaciones: readonly AgrupacionCurvasApi[]): string[] {
  return [...new Set(agrupaciones.flatMap((a) => a.generos))].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Resumen de la cabecera de la lista: «15 agrupaciones activas · 3 con curva al día · 1 aprobada distinta de la
 * recomendada · 2 obsoletas · 9 sin curva (5 bloqueadas, 4 calculables) · 10 siguen en Toda temporada (revísalas)».
 */
export function textoResumen(r: ResumenEstadoCurvas): string {
  const n = (v: number) => formatearNumero(v);
  const partes = [
    `${n(r.agrupaciones_activas)} ${r.agrupaciones_activas === 1 ? "agrupación activa" : "agrupaciones activas"}`,
    `${n(r.al_dia)} con curva al día`,
    `${n(r.al_dia_distintas)} ${r.al_dia_distintas === 1 ? "aprobada distinta de la recomendada" : "aprobadas distintas de la recomendada"}`,
    `${n(r.obsoletas)} ${r.obsoletas === 1 ? "obsoleta" : "obsoletas"}`,
  ];
  // 06c: las curvas del usuario se cuentan aparte y nunca son obsoletas.
  if (r.curvas_usuario > 0) partes.push(`${n(r.curvas_usuario)} ${r.curvas_usuario === 1 ? "con curva del usuario" : "con curva del usuario"}`);
  partes.push(
    r.sin_curva === 0
      ? "0 sin curva"
      : `${n(r.sin_curva)} sin curva (${n(r.bloqueadas_sin_curva)} ${r.bloqueadas_sin_curva === 1 ? "bloqueada" : "bloqueadas"}, ${n(r.calculables_sin_curva)} ${r.calculables_sin_curva === 1 ? "calculable" : "calculables"})`
  );
  if (r.inactivas_con_curva > 0) partes.push(`${n(r.inactivas_con_curva)} ${r.inactivas_con_curva === 1 ? "inactiva con curva" : "inactivas con curva"}`);
  partes.push(`${n(r.sin_revisar_toda_temporada)} ${r.sin_revisar_toda_temporada === 1 ? "sigue" : "siguen"} en Toda temporada${r.sin_revisar_toda_temporada > 0 ? " (revísalas)" : ""}`);
  return partes.join(" · ");
}

/** Qué muestra la columna «Sistema hoy» de una fila antes de pulsar Comparar. */
export type SistemaHoy =
  | { tipo: "igual"; texto: string }
  | { tipo: "distinta"; texto: string }
  | { tipo: "comparar" }
  | { tipo: "ninguno" };

/**
 * Sin calcular: con la curva al día el sistema (determinista) propondría lo mismo que
 * al aprobar → «= (A)»; si se aprobó otra candidata, «A (vs B)» (de la foto);
 * obsoleta o sin curva → se puede comparar a demanda; inactiva → nada.
 */
export function sistemaHoy(a: Pick<AgrupacionCurvasApi, "estado" | "vigente" | "bloqueada_por">): SistemaHoy {
  const v = a.vigente;
  switch (a.estado) {
    case "al_dia":
      return v ? { tipo: "igual", texto: `= (${v.modelo})` } : { tipo: "ninguno" };
    case "al_dia_distinta":
      return v ? { tipo: "distinta", texto: `${v.recomendada_entonces ?? "?"} (vs ${v.modelo})` } : { tipo: "ninguno" };
    case "curva_usuario":
      // 06c: lo que el sistema proponía al aprobarse; «Comparar con el sistema» sigue disponible (la fila lo ofrece aparte).
      return v ? { tipo: "distinta", texto: `${v.recomendada_entonces ?? "?"} (vs U)` } : { tipo: "ninguno" };
    case "obsoleta":
    case "sin_curva":
      return a.bloqueada_por.length > 0 && a.estado === "sin_curva" ? { tipo: "ninguno" } : { tipo: "comparar" };
    default:
      return { tipo: "ninguno" };
  }
}

/** Lo que deja «Comparar con el sistema» de una fila (vive en memoria de la pantalla; no se guarda nada). */
export type ResultadoComparar =
  | { tipo: "bloqueada"; detalle: string }
  | { tipo: "sin_candidata" }
  | { tipo: "sin_vigente"; modelo: ModeloCurva; eat: number | null; curva: number[] | null }
  | { tipo: "comparada"; modelo: ModeloCurva; eat: number | null; curva: number[] | null; eat_vs_vigente: number; difiere: boolean; comparable: boolean | null };

/** Resume una respuesta de `calcular` para la columna «Sistema hoy». */
export function resumirComparacion(t: Pick<TrabajoAgrupacionApi, "prerrequisitos" | "calculo" | "comparador">): ResultadoComparar {
  if (t.prerrequisitos.bloquea.length > 0 || !t.calculo) return { tipo: "bloqueada", detalle: t.prerrequisitos.bloquea[0]?.detalle ?? "No se puede calcular todavía." };
  const r = t.calculo.resultado;
  const modelo = r.recomendada;
  if (modelo === null) return { tipo: "sin_candidata" };
  const candidata = r.candidatas.find((c) => c.modelo === modelo);
  const eat = candidata?.eat ?? null;
  const curva = modelo === "T" ? (t.calculo.temporada_curva?.curva_T ?? null) : (candidata?.curva ?? null);
  const c = t.comparador;
  if (!c) return { tipo: "sin_vigente", modelo, eat, curva };
  return { tipo: "comparada", modelo, eat, curva, eat_vs_vigente: c.eat_vs_vigente, difiere: c.difiere, comparable: c.comparable_con_vigente };
}

/** «A · difiere 4.1 pp de la vigente», «A · igual a la vigente», «A · sin vigente». */
export function textoComparacionFila(r: ResultadoComparar): string {
  switch (r.tipo) {
    case "bloqueada":
      return `No se puede calcular: ${r.detalle}`;
    case "sin_candidata":
      return "Sin curva posible (sin años utilizables)";
    case "sin_vigente":
      return `${r.modelo} · sin vigente con la que comparar`;
    case "comparada":
      return r.difiere
        ? `${r.modelo} · difiere ${formatearPp(r.eat_vs_vigente)} de la vigente${r.comparable === false ? " (EAT no comparable: otros años)" : ""}`
        : `${r.modelo} · igual a la vigente`;
  }
}

// ─── Navegar entre agrupaciones ───

export type Vecino = { id: string; nombre: string };
export type Vecinos = {
  /** Posición de la agrupación abierta, desde 1. */
  posicion: number;
  total: number;
  anterior: Vecino | null;
  siguiente: Vecino | null;
};

/**
 * Anterior y siguiente de la agrupación `id` dentro de `orden` (los ids de la lista como la veía el usuario),
 * sin dar la vuelta: en los extremos el vecino es `null`. `null` si `id` no está en `orden`.
 */
export function vecinosDe(orden: readonly string[], id: string, nombres: ReadonlyMap<string, string>): Vecinos | null {
  const i = orden.indexOf(id);
  if (i < 0) return null;
  const vecino = (j: number): Vecino | null => (j < 0 || j >= orden.length ? null : { id: orden[j], nombre: nombres.get(orden[j]) ?? "agrupación" });
  return { posicion: i + 1, total: orden.length, anterior: vecino(i - 1), siguiente: vecino(i + 1) };
}

// ─── Comparador vigente / propuesta ───

export type Comparacion = {
  /** EAT entre las dos curvas, en puntos. */
  eat: number;
  /** `propuesta − vigente` por mes, en puntos (12). */
  diferencias: number[];
  /** Mes 1-12 con la mayor diferencia absoluta. */
  mesMayorCambio: number;
  /** Diferencia del mes de mayor cambio (con signo). */
  diferenciaMayor: number;
  /** Alguna diferencia mensual supera `umbralPp` (0,5 pp) o el modelo es otro. */
  difiere: boolean;
};

/** Compara dos curvas (fracciones de 12). Con longitudes distintas devuelve `null`. */
export function compararCurvas(vigente: readonly number[], propuesta: readonly number[], mismoModelo = false, umbralPp = 0.5): Comparacion | null {
  if (vigente.length !== 12 || propuesta.length !== 12) return null;
  const diferencias = propuesta.map((p, i) => (p - vigente[i]) * 100);
  const eat = diferencias.reduce((s, d) => s + Math.abs(d), 0);
  let mes = 0;
  for (let i = 1; i < 12; i++) if (Math.abs(diferencias[i]) > Math.abs(diferencias[mes])) mes = i;
  const maxAbs = Math.abs(diferencias[mes]);
  return { eat, diferencias, mesMayorCambio: mes + 1, diferenciaMayor: diferencias[mes], difiere: !mismoModelo || maxAbs > umbralPp };
}

/** «EAT entre ambas: 4.1 pp; el mes que más cambia: enero (+1.8)». */
export function fraseComparacion(c: Comparacion): string {
  return `EAT entre ambas: ${formatearPp(c.eat)}; el mes que más cambia: ${nombreMes(c.mesMayorCambio)} (${formatearDiferenciaPp(c.diferenciaMayor)})`;
}

// ─── Lo que propone el sistema ───

export const ETIQUETA_MOTIVO_TRATAMIENTO: Record<MotivoTratamiento, string> = {
  excluido_manual: "excluido a mano",
  parametro: "por el parámetro de tratamiento",
  forma_cambia: "su forma cambia más que el ruido",
  sin_referencia: "sin referencia con qué compararlo",
};

function listaAnios(xs: readonly number[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * La frase de recomendación: qué propone, con qué años (y qué pasa con los del Niño y con los que
 * quedaron fuera) y por qué, con el texto comparativo que genera el servidor (EAT, pruebas, margen).
 * Ejemplo: «Propone A · Promedio simple de 2023, 2024 y 2025 (2023, año del Niño, entra incluido).
 * B se equivoca 27.4 pp frente a 29.1 de A en 3 pruebas; …».
 */
export function textoPropone(r: Pick<AgrupacionResultado, "recomendada" | "anios" | "comparacion" | "origen"> & Partial<Pick<AgrupacionResultado, "motivo_recomendacion">>): string {
  if (r.recomendada === null) return "El sistema no puede proponer una curva: la agrupación no tiene años utilizables y su temporada tampoco. Revisa los avisos y los meses cargados.";
  if (r.recomendada === "T") {
    // 06c: `T` también compite con backtesting; solo es «prestada por falta de años» cuando no hay propias con EAT.
    if (r.motivo_recomendacion === "menor_error")
      return `Propone T · Curva de la temporada (prestada de las demás agrupaciones de su temporada): se equivoca menos que las propias, por más del margen.${r.comparacion ? ` ${r.comparacion.frase}` : ""}`;
    return "Propone T · Curva de la temporada (prestada): la agrupación no tiene años suficientes para una curva propia y usa la de las demás agrupaciones de su temporada.";
  }
  const usados = r.anios.filter((a) => a.en_ajuste).sort((a, b) => a.anio - b.anio);
  const nino = usados.filter((a) => a.clase !== "normal" && a.tratamiento !== null);
  const notaNino =
    nino.length === 0
      ? ""
      : ` (${nino
          .map((a) => `${a.anio}, ${a.clase === "atipico_completo" ? "año del Niño" : "con meses atípicos"}, entra ${ETIQUETA_TRATAMIENTO[a.tratamiento as TratamientoAnio]}`)
          .join("; ")})`;
  const fuera = r.anios.filter((a) => a.tratamiento === "descartado").sort((a, b) => a.anio - b.anio);
  const notaFuera = fuera.length === 0 ? "" : ` Fuera del ajuste: ${fuera.map((a) => `${a.anio} (${a.tratamiento_motivo ? ETIQUETA_MOTIVO_TRATAMIENTO[a.tratamiento_motivo] : "descartado"})`).join("; ")}.`;
  const base = `Propone ${modeloConNombre(r.recomendada)} de ${usados.length === 0 ? "ningún año" : listaAnios(usados.map((a) => a.anio))}${notaNino}.${notaFuera}`;
  return r.comparacion ? `${base} ${r.comparacion.frase}` : base;
}

/**
 * «EAT 29.1 · ruido 33.0»: el EAT de una curva aprobada SIEMPRE con el ruido entre años normales al lado
 * (lista y Versiones). `ruido` `null` = no medible; `undefined` = la respuesta no lo trae (versiones anteriores).
 * `null` si no hay EAT (curva prestada o un solo año de ajuste).
 */
export function textoEatConRuido(eat: number | null, ruido: number | null | undefined): string | null {
  if (eat === null) return null;
  const r = ruido === undefined ? "ruido sin dato" : ruido === null ? "ruido no medible" : `ruido ${formatearDecimal(ruido, 1)}`;
  return `EAT ${formatearDecimal(eat, 1)} · ${r}`;
}

/** Ruido entre años normales siempre junto al EAT: «ruido 33.0 pp (2024 frente a 2025)» o «ruido no medible». */
export function textoRuido(r: Pick<AgrupacionResultado, "ruido_normal" | "ruido_normal_detalle">): string {
  if (r.ruido_normal === null) return "Ruido entre años normales: no medible (hacen falta dos años normales completos).";
  const pares = r.ruido_normal_detalle.map((p) => `${p.anios[0]} frente a ${p.anios[1]}: ${formatearPp(p.eat)}`).join("; ");
  return `Ruido entre años normales: ${formatearPp(r.ruido_normal)}${pares ? ` (${pares})` : ""}. Se muestra aunque no haya Niño.`;
}

/**
 * «EAT no comparable con el cálculo anterior (la vigente usó 2024 y 2025; hoy 2023, 2024 y 2025)», o `null`
 * si es comparable o no hay con qué comparar.
 */
export function textoNoComparable(comparable: boolean | null | undefined, aniosVigente: readonly number[] | null, aniosHoy: readonly number[]): string | null {
  if (comparable !== false) return null;
  const antes = aniosVigente && aniosVigente.length > 0 ? listaAnios([...aniosVigente].sort((a, b) => a - b)) : "otros años";
  const hoy = aniosHoy.length > 0 ? listaAnios([...aniosHoy].sort((a, b) => a - b)) : "ningún año";
  return `EAT no comparable con el cálculo anterior (la vigente usó ${antes}; hoy ${hoy}).`;
}

/** Años que entran al ajuste en el cálculo de hoy. */
export function aniosDeAjuste(anios: readonly Pick<AnioAgrupacion, "anio" | "en_ajuste">[]): number[] {
  return anios.filter((a) => a.en_ajuste).map((a) => a.anio).sort((a, b) => a - b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ¿Es un id de agrupación válido (UUID)? (el de `?agrupacion=` de la URL). */
export function esIdAgrupacion(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** ¿Es el código de una candidata (A a F o T)? (el de `?modelo=` de la URL). La `U` no es una candidata. */
export function esModeloCurva(v: string | null | undefined): v is ModeloCurva {
  return MODELOS.some((m) => m.codigo === v);
}

export { esModeloAprobable };

// ─── Aprobar una curva ───

/** Años que entraron al ajuste, con su clase y tratamiento: `2023 (atípico completo, incluido) · 2024 · 2025`. */
export function textoAniosUsados(anios: readonly AnioAgrupacion[]): string {
  const usados = anios.filter((a) => a.en_ajuste).sort((x, y) => x.anio - y.anio);
  return usados.map((a) => textoAnio(a)).join(" · ");
}

/** Años que NO entraron al ajuste y por qué (en curso, descartado, escaso, incompleto). */
export function textoAniosFuera(anios: readonly AnioAgrupacion[]): string {
  const fuera = anios.filter((a) => !a.en_ajuste).sort((x, y) => x.anio - y.anio);
  return fuera.map((a) => textoAnio(a)).join(" · ");
}

export type EntradaConfirmar = {
  agrupacion: string;
  temporada: TemporadaAgrupacion;
  modelo: ModeloAprobable;
  recomendada: ModeloCurva | null;
  anios: readonly AnioAgrupacion[];
  eat: number | null;
  ruidoNormal: number | null;
  /** Versión de la curva vigente (se reemplaza); `null` si no hay. */
  versionVigente: number | null;
  comparacion: Comparacion | null;
  /** El conjunto de años de ajuste coincide con el de la vigente (`null` sin vigente o de la 0.9.6). */
  comparableConVigente: boolean | null;
  /** Años de ajuste de la vigente (para decir con cuáles ajustó). */
  aniosAjusteVigente: readonly number[] | null;
  /** Años y tiendas que el planner sacó a mano (las tiendas, por código). */
  aniosExcluidos: readonly number[];
  tiendasExcluidas: readonly string[];
  tratamiento: TratamientoAtipicos;
  /** `aaaa-mm` hasta el que se calculó. */
  hasta: string;
  avisos: readonly { detalle: string }[];
  nota: string;
  /** 06c: con `modelo = "U"`, lo que el planner escribió y cómo se midió (EN MUESTRA). */
  usuario?: {
    valores: readonly number[];
    eatEnMuestra: number | null;
    parcialEnMuestra: number | null;
    partida: PartidaCurvaUsuario;
    igualA: ModeloCurva | null;
  };
};

/** De dónde partió la curva del usuario, en texto de pantalla. */
export function textoPartida(p: PartidaCurvaUsuario): string {
  switch (p.tipo) {
    case "candidata":
      return `la candidata ${modeloConNombre(p.referencia)}`;
    case "anio":
      return `la curva del año ${p.referencia}`;
    case "vigente":
      return `la curva vigente ${p.referencia}`;
    case "pegado":
      return "valores pegados desde Excel";
    case "en_blanco":
      return "una curva en blanco";
  }
}

function listaTexto(xs: readonly (string | number)[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/**
 * Texto del `confirm` de «Aprobar esta curva»: agrupación, temporada, candidata, años con su clase y
 * tratamiento, lo excluido a mano, EAT frente al ruido (y «no comparable» si cambió el conjunto de años),
 * diferencia con la vigente, el mes hasta el que se calculó y los avisos.
 */
export function textoConfirmarAprobacion(e: EntradaConfirmar): string {
  const lineas: string[] = [];
  if (e.modelo === "U" && e.usuario) return textoConfirmarCurvaUsuario(e, e.usuario);
  const prestada = e.modelo === "T";
  lineas.push(`¿Aprobar la curva ${modeloConNombre(e.modelo)} de ${e.agrupacion}?`);
  lineas.push(`Temporada: ${ETIQUETA_TEMPORADA[e.temporada]}.`);
  if (e.recomendada !== null && e.recomendada !== e.modelo) lineas.push(`No es la recomendada (${e.recomendada}).`);
  if (prestada) lineas.push("Curva prestada de la temporada: la agrupación no tiene años suficientes para una curva propia.");
  const usados = textoAniosUsados(e.anios);
  lineas.push(`Años usados: ${usados === "" ? "ninguno" : usados}.`);
  const fuera = textoAniosFuera(e.anios);
  if (fuera !== "") lineas.push(`Fuera del ajuste: ${fuera}.`);
  if (e.aniosExcluidos.length > 0) lineas.push(`Años excluidos a mano: ${listaTexto(e.aniosExcluidos)}.`);
  if (e.tiendasExcluidas.length > 0) lineas.push(`Tiendas excluidas a mano: ${listaTexto(e.tiendasExcluidas)}.`);
  if (e.tratamiento !== "auto") lineas.push(`Tratamiento del Niño: ${e.tratamiento} (no es el automático).`);
  if (!prestada) {
    lineas.push(
      e.eat === null
        ? "EAT: sin backtesting (un solo año de ajuste)."
        : `EAT: ${formatearPp(e.eat)}; ruido entre años normales: ${e.ruidoNormal === null ? "no medible" : formatearPp(e.ruidoNormal)}.`
    );
    if (e.comparableConVigente === false && e.versionVigente !== null) {
      const antes = e.aniosAjusteVigente && e.aniosAjusteVigente.length > 0 ? listaTexto(e.aniosAjusteVigente) : "otros años";
      const hoy = e.anios.filter((a) => a.en_ajuste).map((a) => a.anio).sort((x, y) => x - y);
      lineas.push(`EAT no comparable con el de la v${e.versionVigente}: aquella ajustó con ${antes}; esta, con ${hoy.length > 0 ? listaTexto(hoy) : "ningún año"}.`);
    }
  }
  lineas.push(`Datos hasta ${e.hasta}.`);
  if (e.versionVigente === null) lineas.push("No hay curva vigente: esta será la versión 1.");
  else if (e.comparacion)
    lineas.push(
      `Reemplaza la v${e.versionVigente}: difiere ${formatearPp(e.comparacion.eat)}; el mes que más cambia es ${nombreMes(e.comparacion.mesMayorCambio)} (${formatearDiferenciaPp(e.comparacion.diferenciaMayor)}).`
    );
  else lineas.push(`Reemplaza la v${e.versionVigente}.`);
  if (e.avisos.length > 0) lineas.push(`Avisos: ${e.avisos.map((a) => a.detalle).join(" | ")}`);
  if (e.nota.trim() !== "") lineas.push(`Nota: ${e.nota.trim()}`);
  return lineas.join("\n");
}

/** El `confirm` de aprobar la curva del usuario: los doce valores, el EAT EN MUESTRA frente al ruido, lo que proponía el sistema y de dónde partió. */
function textoConfirmarCurvaUsuario(e: EntradaConfirmar, u: NonNullable<EntradaConfirmar["usuario"]>): string {
  const lineas: string[] = [];
  lineas.push(`¿Aprobar TU curva (${modeloConNombre("U")}) de ${e.agrupacion}?`);
  lineas.push(`Temporada: ${ETIQUETA_TEMPORADA[e.temporada]}.`);
  lineas.push(`Tus doce valores (%): ${u.valores.map((v) => formatearDecimal(v, 1)).join(" · ")}.`);
  lineas.push(
    u.eatEnMuestra === null
      ? "EAT en muestra: no medible (no hay años de ajuste)."
      : `EAT EN MUESTRA: ${formatearPp(u.eatEnMuestra)}, medida con los mismos años que ves (las candidatas se miden fuera de muestra); ruido entre años normales: ${e.ruidoNormal === null ? "no medible" : formatearPp(e.ruidoNormal)}.`
  );
  if (u.parcialEnMuestra !== null) lineas.push(`Año en curso (parcial): ${formatearPp(u.parcialEnMuestra)} (en muestra).`);
  if (u.igualA) lineas.push(`Coincide con la candidata ${u.igualA}.`);
  lineas.push(e.recomendada ? `El sistema proponía ${modeloConNombre(e.recomendada)}.` : "El sistema no tenía ninguna candidata que proponer.");
  lineas.push(`Partiste de: ${textoPartida(u.partida)}.`);
  if (e.aniosExcluidos.length > 0) lineas.push(`Años excluidos a mano: ${listaTexto(e.aniosExcluidos)}.`);
  if (e.tiendasExcluidas.length > 0) lineas.push(`Tiendas excluidas a mano: ${listaTexto(e.tiendasExcluidas)}.`);
  lineas.push(`Datos hasta ${e.hasta}.`);
  if (e.versionVigente === null) lineas.push("No hay curva vigente: esta será la versión 1.");
  else if (e.comparacion)
    lineas.push(`Reemplaza la v${e.versionVigente}: difiere ${formatearPp(e.comparacion.eat)}; el mes que más cambia es ${nombreMes(e.comparacion.mesMayorCambio)} (${formatearDiferenciaPp(e.comparacion.diferenciaMayor)}).`);
  else lineas.push(`Reemplaza la v${e.versionVigente}.`);
  lineas.push("Esta curva NO se marcará obsoleta por datos nuevos: verás avisos y la cambias tú cuando decidas.");
  if (e.avisos.length > 0) lineas.push(`Avisos: ${e.avisos.map((a) => a.detalle).join(" | ")}`);
  if (e.nota.trim() !== "") lineas.push(`Nota: ${e.nota.trim()}`);
  return lineas.join("\n");
}

// ─── Efecto del Niño ───

/** Texto con las tres cifras de forma: «difiere 31.2 pp de la referencia; los dos años normales difieren 33.0 pp entre sí: estable respecto al ruido». */
export function textoVeredictoForma(f: { veredicto: VeredictoForma; diferencia: number | null; ruido: number | null; umbralEfectivo: number }): string {
  if (f.veredicto === "sin_comparacion" || f.diferencia === null) return "Sin año normal con el que comparar la forma.";
  const ruido = f.ruido === null ? `no hay dos años normales para medir el ruido (manda el piso de ${formatearPp(f.umbralEfectivo)})` : `los años normales difieren ${formatearPp(f.ruido)} entre sí`;
  const cierre = f.veredicto === "forma_estable" ? "estable respecto al ruido" : "la forma cambia";
  return `difiere ${formatearPp(f.diferencia)} de la referencia; ${ruido}: ${cierre}`;
}

/** Corrimiento del pico en meses: `se adelanta 1 mes`, `se retrasa 2 meses`, `sin corrimiento`. */
export function textoCorrimiento(c: number): string {
  if (c === 0) return "sin corrimiento";
  const n = Math.abs(c);
  return `${c < 0 ? "se adelanta" : "se retrasa"} ${n} ${n === 1 ? "mes" : "meses"}`;
}

/** Mes del pico (índice 0-11 o 1-12 según el contrato; `pico` viaja 1-12) en texto corto. */
export function mesPico(pico: number): string {
  return MESES_CORTOS[pico - 1] ?? "—";
}

/** Etiqueta de una fila de `por_temporada`: `Invierno`, `Toda temporada`, `Toda la red`. */
export function etiquetaTemporadaORed(t: EfectoTemporadaAnio["temporada"]): string {
  if (t === "red") return "Toda la red";
  return t === "invierno" ? "Invierno" : t === "verano" ? "Verano" : "Toda temporada";
}

/**
 * Lectura de una fila de volumen. Ejemplo: «Invierno 2026 (ene–set): 0.66 frente a 2025 en las mismas 9
 * tiendas; la red de toda temporada hace 0.975: relativo 0.68».
 */
export function lecturaVolumen(f: EfectoTemporadaAnio): string {
  const nombre = `${etiquetaTemporadaORed(f.temporada)} ${f.anio}`;
  const parcial = f.meses_comparados > 0 && f.meses_comparados < 12 ? ` (${rangoPrimerosMeses(f.meses_comparados)})` : "";
  if (f.ratio_volumen === null) return `${nombre}${parcial}: sin año normal o sin tiendas comunes con qué comparar.`;
  const ref = f.anio_referencia === null ? "el año de referencia" : String(f.anio_referencia);
  const tiendas = `en las mismas ${f.tiendas_comunes} tiendas`;
  let texto = `${nombre}${parcial}: ${formatearRatio(f.ratio_volumen)} frente a ${ref} ${tiendas}`;
  if (f.ratio_control !== null && f.ratio_relativo !== null) {
    texto += `; la red de toda temporada hace ${formatearRatio(f.ratio_control, 3)}: relativo ${formatearRatio(f.ratio_relativo)}`;
    if (f.crecimiento_normal !== null) {
      const cerca = Math.abs(f.ratio_relativo / f.crecimiento_normal - 1) <= 0.1;
      texto += cerca
        ? `, del orden del crecimiento normal de la temporada (${formatearRatio(f.crecimiento_normal)})`
        : `, distinto del crecimiento normal de la temporada (${formatearRatio(f.crecimiento_normal)})`;
    }
  }
  return `${texto}.`;
}

/** Filas del bloque Volumen: solo años atípicos y la red; las de `todo_el_ano` entran como control. */
export function filasVolumen(efecto: EfectoAtipicoCorrida, filtro: FiltroTemporada): EfectoTemporadaAnio[] {
  const orden = (t: EfectoTemporadaAnio["temporada"]) => ({ invierno: 0, verano: 1, todo_el_ano: 2, red: 3 })[t];
  return efecto.por_temporada
    .filter((f) => filtro === "todas" || f.temporada === filtro)
    .sort((a, b) => orden(a.temporada) - orden(b.temporada) || a.anio - b.anio);
}

// ─── Red comparable ───

/** Fila de tienda × año lista para pintar (la misma forma para la red de la corrida y la de una agrupación). */
export type TiendaAnioVista = {
  entra: boolean;
  motivos: RedTiendaAnioApi["motivos"];
  mesesSinVenta: string[];
  primerMesConVenta: string | null;
  entraDesde: number | null;
  unidades: number;
  peso: number;
  participacion: number[] | null;
  eatVsRed: number | null;
  distinta: boolean;
};

export type AnioRedVista = {
  anio: number;
  sinRed: boolean;
  totalUnidades: number;
  tiendasEnRed: number;
  tiendasTotal: number;
  /** `tienda_id` de la dominante (peso sobre el umbral) o `null`. */
  dominante: string | null;
  pesoMayor: number | null;
  participacion: number[] | null;
  tiendas: Map<string, TiendaAnioVista>;
};

export type RedVista = {
  anios: AnioRedVista[];
  tiendas: { id: string; codigo: string; nombre: string }[];
};

function ordenarTiendas(tiendas: Map<string, { id: string; codigo: string; nombre: string }>) {
  return [...tiendas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

/** Red de la corrida: los pesos son sobre la venta total de cada tienda (nivel red). */
export function redVistaDesdeRed(red: readonly RedAnioApi[]): RedVista {
  const ids = new Map<string, { id: string; codigo: string; nombre: string }>();
  const anios = red.map<AnioRedVista>((r) => {
    const tiendas = new Map<string, TiendaAnioVista>();
    for (const t of r.tiendas) {
      ids.set(t.tienda_id, { id: t.tienda_id, codigo: t.codigo, nombre: t.nombre });
      tiendas.set(t.tienda_id, {
        entra: t.entra,
        motivos: t.motivos,
        mesesSinVenta: t.meses_sin_venta,
        primerMesConVenta: t.primer_mes_con_venta,
        entraDesde: t.entra_desde,
        unidades: t.unidades,
        peso: t.peso,
        participacion: t.participacion,
        eatVsRed: t.eat_vs_red,
        distinta: t.distinta,
      });
    }
    return {
      anio: r.anio,
      sinRed: r.sin_red,
      totalUnidades: r.total_unidades,
      tiendasEnRed: r.tiendas.filter((t) => t.entra).length,
      tiendasTotal: r.tiendas.length,
      dominante: r.dominante,
      pesoMayor: r.peso_mayor,
      participacion: r.participacion,
      tiendas,
    };
  });
  return { anios, tiendas: ordenarTiendas(ids) };
}

/**
 * Red de una agrupación: las mismas tiendas que entraron en cada año de la red
 * de la corrida, pero con los pesos, perfiles y `eat_vs_red` sobre la venta de
 * la agrupación (`resultado.anios[].por_tienda`). La dominante usa el umbral de
 * la corrida.
 */
export function redVistaDeAgrupacion(
  red: readonly RedAnioApi[],
  tiendas: readonly { id: string; codigo: string; nombre: string }[],
  resultado: Pick<AgrupacionResultado, "anios">,
  umbralDominante: number
): RedVista {
  const ids = new Map(tiendas.map((t) => [t.id, t]));
  const anios = red.map<AnioRedVista>((r) => {
    const delAnio = resultado.anios.find((a) => a.anio === r.anio);
    const porTienda = new Map((delAnio?.por_tienda ?? []).map((p) => [p.tienda_id, p]));
    const mapa = new Map<string, TiendaAnioVista>();
    let mayor: { id: string; peso: number } | null = null;
    for (const t of r.tiendas) {
      if (!ids.has(t.tienda_id)) ids.set(t.tienda_id, { id: t.tienda_id, codigo: t.codigo, nombre: t.nombre });
      const p = t.entra ? porTienda.get(t.tienda_id) : undefined;
      if (p && (mayor === null || p.peso > mayor.peso)) mayor = { id: t.tienda_id, peso: p.peso };
      mapa.set(t.tienda_id, {
        entra: t.entra,
        motivos: t.motivos,
        mesesSinVenta: t.meses_sin_venta,
        primerMesConVenta: t.primer_mes_con_venta,
        entraDesde: t.entra_desde,
        unidades: p?.unidades ?? 0,
        peso: p?.peso ?? 0,
        participacion: p?.participacion ?? null,
        eatVsRed: p?.eat_vs_red ?? null,
        distinta: p?.distinta ?? false,
      });
    }
    const total = (delAnio?.por_tienda ?? []).reduce((s, p) => s + p.unidades, 0);
    return {
      anio: r.anio,
      sinRed: r.sin_red,
      totalUnidades: total,
      tiendasEnRed: r.tiendas.filter((t) => t.entra).length,
      tiendasTotal: r.tiendas.length,
      dominante: mayor && mayor.peso > umbralDominante ? mayor.id : null,
      pesoMayor: mayor?.peso ?? null,
      participacion: delAnio?.participacion_real ?? delAnio?.participacion_parcial ?? delAnio?.participacion ?? null,
      tiendas: mapa,
    };
  });
  return { anios, tiendas: ordenarTiendas(ids) };
}

/** Motivo legible de una tienda fuera de la red de un año, o aviso de una que entra (`null` si no hay nada que decir). */
export function textoMotivoRed(t: Pick<TiendaAnioVista, "entra" | "motivos" | "mesesSinVenta" | "primerMesConVenta" | "entraDesde">): string | null {
  const tiene = (m: TiendaAnioVista["motivos"][number]) => t.motivos.includes(m);
  if (!t.entra) {
    if (tiene("centro_distribucion")) return "Centro de distribución";
    if (tiene("tienda_desactivada")) return "Tienda desactivada";
    if (tiene("no_abierta_todo_el_ano")) return "No abierta todo el año";
    if (tiene("tienda_nueva")) return t.entraDesde !== null ? `Tienda nueva: entra en ${t.entraDesde}` : "Tienda nueva";
    if (tiene("meses_sin_venta")) {
      const meses = t.mesesSinVenta.length > 0 ? `Sin venta en ${resumirMeses(t.mesesSinVenta, false)}` : "Sin venta en algunos meses";
      if (tiene("apertura_dudosa")) {
        return t.primerMesConVenta ? `Apertura dudosa: vende desde ${t.primerMesConVenta}` : `${meses} (apertura dudosa)`;
      }
      if (tiene("cierre_dudoso")) return `${meses} (cierre dudoso)`;
      return meses;
    }
    const otro = t.motivos[0];
    return otro ? ETIQUETA_MOTIVO_RED[otro] : "Fuera de la red";
  }
  if (tiene("tienda_sin_apertura")) return "Sin fecha de apertura en Tiendas";
  return null;
}

/** ¿El motivo pide corregir la fecha de apertura en M4 (para mostrar el enlace a Tiendas)? */
export function pideCorregirApertura(t: Pick<TiendaAnioVista, "motivos">): boolean {
  return t.motivos.includes("apertura_dudosa") || t.motivos.includes("tienda_sin_apertura") || t.motivos.includes("cierre_dudoso");
}

/** Fila Total de un año: «9 de 10 tiendas · la mayor pesa 38.0 %». */
export function textoTotalRed(a: Pick<AnioRedVista, "sinRed" | "tiendasEnRed" | "tiendasTotal" | "pesoMayor">): string {
  if (a.sinRed) return "Sin red comparable: relaja los parámetros";
  const mayor = a.pesoMayor === null ? "" : ` · la mayor pesa ${formatearPct(a.pesoMayor)}`;
  return `${a.tiendasEnRed} de ${a.tiendasTotal} tiendas${mayor}`;
}

// ─── CSV ───

const CABECERA_MESES = MESES_CORTOS.map((m) => `${m.toUpperCase()} (%)`);

/** CSV de curvas vigentes (solo agrupaciones activas con curva). Los meses van en porcentaje. */
export function filasCsvVigentes(agrupaciones: readonly AgrupacionCurvasApi[]): { campos: string[]; datos: (string | number)[][] } {
  const campos = ["AGRUPACION", "CODIGO", "VERSION", "MODELO", "ORIGEN", ...CABECERA_MESES, "EAT", "APROBADA"];
  const datos = agrupaciones
    .filter((a) => a.activo && a.vigente)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((a) => {
      const v = a.vigente!;
      return [
        a.nombre,
        a.codigo,
        v.version,
        v.modelo,
        v.origen,
        ...v.curva.map((c) => Math.round(c * 100 * 1e4) / 1e4),
        v.eat === null ? "" : Math.round(v.eat * 10) / 10,
        v.aprobada_at.slice(0, 10),
      ];
    });
  return { campos, datos };
}

/** CSV de «Lo que recibirá M7»: factores de volumen por temporada y año, y crecimiento entre años normales. */
export function filasCsvFactoresM7(efecto: EfectoAtipicoCorrida): { campos: string[]; datos: (string | number)[][] } {
  const campos = ["TIPO", "TEMPORADA", "ANIO", "ANIO_REFERENCIA", "AGRUPACIONES", "RATIO_VOLUMEN", "RATIO_CONTROL", "RATIO_RELATIVO", "CRECIMIENTO_NORMAL", "TIENDAS_COMUNES"];
  const n = (v: number | null) => (v === null ? "" : Math.round(v * 1e4) / 1e4);
  const factores = efecto.por_temporada.map((f) => [
    "factor",
    f.temporada,
    f.anio,
    f.anio_referencia ?? "",
    f.agrupaciones,
    n(f.ratio_volumen),
    n(f.ratio_control),
    n(f.ratio_relativo),
    n(f.crecimiento_normal),
    f.tiendas_comunes,
  ]);
  const crecimientos = efecto.crecimiento_normal.map((c) => ["crecimiento_normal", c.temporada, c.anio, c.anio_referencia, "", n(c.ratio), "", "", "", c.tiendas_comunes]);
  return { campos, datos: [...factores, ...crecimientos] };
}

// ─── Detalle de una agrupación ───

/**
 * Referencia de forma `r`: promedio simple de la participación de los años
 * normales (la misma definición del modelo, para dibujar `p(Y)` frente a `r`).
 * `null` si no hay años normales con participación.
 */
export function referenciaForma(anios: readonly Pick<AnioAgrupacion, "clase" | "participacion" | "participacion_real">[]): number[] | null {
  const normales = anios
    .filter((a) => a.clase === "normal")
    .map((a) => a.participacion_real ?? a.participacion)
    .filter((p): p is number[] => p !== null && p.length === 12);
  if (normales.length === 0) return null;
  return Array.from({ length: 12 }, (_, m) => normales.reduce((s, p) => s + p[m], 0) / normales.length);
}

/** Meses (1-12) imputados de un año en texto: `set–dic`. */
export function textoMesesImputados(imputados: readonly number[]): string {
  if (imputados.length === 0) return "";
  const nombres = [...imputados].sort((a, b) => a - b).map((m) => `2000-${String(m).padStart(2, "0")}`);
  return resumirMeses(nombres, false);
}

/** Valor de la celda de un año en la tabla año × mes: participación (fracción) y unidades; `null` donde no hay dato. */
export function celdaAnioMes(a: AnioAgrupacion, mes: number): { participacion: number | null; unidades: number | null; imputado: boolean; atipico: boolean; liquidacion: boolean } {
  const periodo = `${a.anio}-${String(mes + 1).padStart(2, "0")}`;
  const cargado = (a.clase === "en_curso" || a.clase === "incompleto") ? mes < a.meses_cargados : true;
  // Un año descartado (por tratamiento o excluido a mano) no tiene `participacion` pero sí su curva real: la tabla la muestra (regla 47).
  const base = a.clase === "en_curso" ? a.participacion_parcial : (a.participacion ?? a.participacion_real);
  return {
    participacion: cargado && base ? base[mes] : null,
    unidades: cargado ? (a.meses[mes] ?? null) : null,
    imputado: a.imputados.includes(mes + 1),
    atipico: a.atipicos.includes(periodo),
    liquidacion: a.liquidacion.includes(periodo),
  };
}

/**
 * Por qué un año no se puede dibujar (`null` si tiene curva): sin red comparable, meses sin cargar (año pasado
 * incompleto: no hay año entero que repartir), sin volumen. La tabla lo lista con «—» y este motivo (regla 47).
 */
export function motivoAnioSinDatos(a: AnioAgrupacion, ctx: { sinRed: boolean; faltantes: readonly string[] }): string | null {
  if (a.participacion ?? a.participacion_real ?? a.participacion_parcial) return null;
  if (ctx.sinRed) return "sin red comparable";
  if (a.clase === "incompleto") {
    const f = ctx.faltantes.filter((m) => m.startsWith(`${a.anio}-`));
    return f.length > 0 ? `meses sin cargar: ${f.join(", ")}` : "meses sin cargar";
  }
  if (a.unidades <= 0) return "sin volumen en la red";
  return "sin datos para dibujar";
}

export type ResumenMensual = {
  /** Promedio de unidades del mes entre los años que entraron al ajuste; `null` sin años. */
  promedio: (number | null)[];
  /** `promedio ÷ promedio de los promedios`: 1.00 es un mes promedio. */
  indice: (number | null)[];
  /** Cuántos años aportan al mes. */
  considerados: number[];
};

/**
 * Las tres filas del visor de estacionalidad de Vector-One, por mes: promedio de unidades, índice (1.00 =
 * mes promedio) y años considerados. Solo cuentan los años del ajuste (con sus meses cargados); cada año
 * se mide sobre la red de ese año, así que son unidades de redes comparables, no del total de la agrupación.
 */
export function resumenMensual(anios: readonly AnioAgrupacion[]): ResumenMensual {
  const ajuste = anios.filter((a) => a.en_ajuste);
  const promedio: (number | null)[] = [];
  const considerados: number[] = [];
  for (let m = 0; m < 12; m++) {
    const valores = ajuste.filter((a) => m < a.meses_cargados).map((a) => a.meses[m] ?? 0);
    considerados.push(valores.length);
    promedio.push(valores.length === 0 ? null : valores.reduce((s, v) => s + v, 0) / valores.length);
  }
  const con = promedio.filter((p): p is number => p !== null);
  const media = con.length === 0 ? 0 : con.reduce((s, v) => s + v, 0) / con.length;
  const indice = promedio.map((p) => (p === null || media <= 0 ? null : p / media));
  return { promedio, indice, considerados };
}

/** CSV de la tabla año × mes: participación (%) y unidades de cada año, propuesta y aprobada (%), diferencia, y las tres filas del visor (promedio de unidades, índice y años considerados). */
export function filasCsvAnioMes(
  anios: readonly AnioAgrupacion[],
  propuesta: readonly number[] | null,
  vigente: readonly number[] | null,
  /** 06c, regla 78: la curva del usuario (fracciones) si es válida; añade «MI CURVA (%)» y su diferencia con la aprobada. */
  usuario: readonly number[] | null = null
): { campos: string[]; datos: (string | number)[][] } {
  const ordenados = [...anios].sort((a, b) => a.anio - b.anio);
  const resumen = resumenMensual(ordenados);
  const campos = [
    "MES",
    ...ordenados.flatMap((a) => [`${a.anio} (%)`, `${a.anio} (unidades)`]),
    "PROPUESTA (%)",
    "APROBADA (%)",
    "DIFERENCIA (pp)",
    ...(usuario ? ["MI CURVA (%)", "MI CURVA - APROBADA (pp)"] : []),
    "PROMEDIO (unidades)",
    "INDICE (1.00 = promedio)",
    "ANIOS CONSIDERADOS",
  ];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const datos = MESES_CORTOS.map((nombre, mes) => {
    const fila: (string | number)[] = [nombre];
    for (const a of ordenados) {
      const c = celdaAnioMes(a, mes);
      fila.push(c.participacion === null ? "" : r1(c.participacion * 100), c.unidades === null ? "" : Math.round(c.unidades));
    }
    fila.push(
      propuesta ? r1(propuesta[mes] * 100) : "",
      vigente ? r1(vigente[mes] * 100) : "",
      propuesta && vigente ? r1((propuesta[mes] - vigente[mes]) * 100) : "",
      ...(usuario ? [r1(usuario[mes] * 100), vigente ? r1((usuario[mes] - vigente[mes]) * 100) : ""] : []),
      resumen.promedio[mes] === null ? "" : Math.round(resumen.promedio[mes] as number),
      resumen.indice[mes] === null ? "" : r2(resumen.indice[mes] as number),
      resumen.considerados[mes]
    );
    return fila;
  });
  return { campos, datos };
}
