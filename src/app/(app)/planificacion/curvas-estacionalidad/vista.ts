import { normalizarNombre } from "@/lib/arbol/normalizar";
import { MESES_CORTOS, MESES_LARGOS } from "@/lib/reportes/histograma";
import {
  ETIQUETA_MOTIVO_RED,
  MODELOS,
  type AgrupacionCurvasApi,
  type AgrupacionResultado,
  type AnioAgrupacion,
  type AvisoCurva,
  type ClaseAnioCurva,
  type CodigoAviso,
  type EfectoAtipicoCorrida,
  type EfectoTemporadaAnio,
  type FormaAnio,
  type ModeloCurva,
  type ObsoletaApi,
  type RedAnioApi,
  type RedTiendaAnioApi,
  type TemporadaAgrupacion,
  type TratamientoAnio,
  type VeredictoForma,
} from "@/lib/curvas/tipos-api";
import { resumirMeses } from "./meses";

/**
 * Presentación pura de la pantalla de curvas (M6, paso 2): formatos, textos,
 * filtros, comparaciones y adaptadores de datos. Sin React ni acceso a la API:
 * las prueba vitest con datos sintéticos.
 */

// ─── Formatos (es-PE, como el resto de la aplicación) ───

function numero(n: number, minimo: number, maximo: number): string {
  return n.toLocaleString("es-PE", { minimumFractionDigits: minimo, maximumFractionDigits: maximo });
}

/** Fracción → porcentaje: `0.123` → `12.3 %`; `—` si no hay valor. */
export function formatearPct(fraccion: number | null | undefined, decimales = 1): string {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return "—";
  return `${numero(fraccion * 100, decimales, decimales)} %`;
}

/** Solo el número del porcentaje (sin el signo `%`), para celdas de tabla. */
export function formatearPctSolo(fraccion: number | null | undefined, decimales = 1): string {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return "—";
  return numero(fraccion * 100, decimales, decimales);
}

/** Puntos porcentuales: `29.1 pp`. */
export function formatearPp(pp: number | null | undefined, decimales = 1): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  return `${numero(pp, decimales, decimales)} pp`;
}

/** Diferencia en puntos con signo: `+1.8`, `-0.4`, `0.0`. */
export function formatearDiferenciaPp(pp: number | null | undefined, decimales = 1): string {
  if (pp === null || pp === undefined || !Number.isFinite(pp)) return "—";
  const redondeado = Math.round(pp * 10 ** decimales) / 10 ** decimales;
  const texto = numero(Math.abs(redondeado), decimales, decimales);
  if (redondeado === 0) return texto;
  return `${redondeado > 0 ? "+" : "-"}${texto}`;
}

/** Ratio: `0.66` (dos decimales por defecto), `—` sin valor. */
export function formatearRatio(r: number | null | undefined, decimales = 2): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return numero(r, decimales, decimales);
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
  liquidacion_fuerte: "Liquidación fuerte",
  sin_venta: "Sin venta",
  inactiva_con_curva: "Inactiva con curva",
  tienda_dominante: "Tienda dominante",
  tienda_distinta: "Tienda distinta",
  sin_red_comparable: "Sin red comparable",
  prestada: "Curva prestada",
};

export function etiquetaModelo(codigo: ModeloCurva): string {
  const m = MODELOS.find((x) => x.codigo === codigo);
  return m ? m.nombre : codigo;
}

/** `B · Ponderado por volumen`. */
export function modeloConNombre(codigo: ModeloCurva): string {
  return `${codigo} · ${etiquetaModelo(codigo)}`;
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

// ─── Filtros de la tabla de Curvas ───

export type FiltroTemporada = "todas" | TemporadaAgrupacion;
export type FiltroEstado = "todas" | "sin_curva" | "obsoletas" | "distinta" | "con_avisos" | "prestadas" | "forma_cambia";

export function cumpleEstado(a: AgrupacionCurvasApi, f: FiltroEstado): boolean {
  switch (f) {
    case "todas":
      return true;
    case "sin_curva":
      return a.activo && a.vigente === null;
    case "obsoletas":
      return a.obsoleta !== null;
    case "distinta":
      return a.propuesta?.difiere_de_vigente === true;
    case "con_avisos":
      return (a.propuesta?.avisos.length ?? 0) > 0;
    case "prestadas":
      return a.vigente?.origen === "prestada" || a.propuesta?.origen === "prestada";
    case "forma_cambia":
      return a.propuesta?.veredicto_forma === "forma_cambia";
  }
}

export const FILTROS_ESTADO: { id: FiltroEstado; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "sin_curva", label: "Sin curva" },
  { id: "obsoletas", label: "Obsoletas" },
  { id: "distinta", label: "Propuesta distinta" },
  { id: "con_avisos", label: "Con avisos" },
  { id: "prestadas", label: "Prestadas" },
  { id: "forma_cambia", label: "Forma cambia" },
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

// ─── Resumen de la cabecera ───

/** «15 agrupaciones activas · 12 con curva vigente · 3 sin curva con venta · 2 obsoletas · 10 siguen en Toda temporada». */
export function textoResumen(r: {
  agrupaciones_activas: number;
  con_curva_vigente: number;
  sin_curva_con_venta: number;
  obsoletas: number;
  sin_revisar_toda_temporada: number;
}): string {
  const pl = (n: number, s: string, p: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? s : p}`;
  return [
    pl(r.agrupaciones_activas, "agrupación activa", "agrupaciones activas"),
    `${pl(r.con_curva_vigente, "con curva vigente", "con curva vigente")}`,
    `${pl(r.sin_curva_con_venta, "sin curva con venta", "sin curva con venta")}`,
    pl(r.obsoletas, "obsoleta", "obsoletas"),
    `${r.sin_revisar_toda_temporada.toLocaleString("es-PE")} ${r.sin_revisar_toda_temporada === 1 ? "sigue" : "siguen"} en Toda temporada`,
  ].join(" · ");
}

/** Vista previa de la corrida: «45 meses, 2023-01 a 2026-09; 2023, 2024 y 2025 completos; 2026 parcial (9); 4 periodos activos; …». */
export function vistaPreviaDatos(
  datos: { desde: string | null; hasta: string | null; meses_publicados: number; faltantes: string[] },
  periodosActivos: number,
  porTemporada: Record<TemporadaAgrupacion, number>
): string {
  if (!datos.desde || !datos.hasta) return "Todavía no hay meses publicados en M5.";
  const desdeAnio = Number(datos.desde.slice(0, 4));
  const hastaAnio = Number(datos.hasta.slice(0, 4));
  const faltan = new Set(datos.faltantes);
  const completos: number[] = [];
  const parciales: { anio: number; meses: number }[] = [];
  for (let anio = desdeAnio; anio <= hastaAnio; anio++) {
    let cargados = 0;
    for (let m = 1; m <= 12; m++) {
      const periodo = `${anio}-${String(m).padStart(2, "0")}`;
      if (periodo < datos.desde || periodo > datos.hasta) continue;
      if (!faltan.has(periodo)) cargados++;
    }
    if (cargados === 12) completos.push(anio);
    else if (cargados > 0) parciales.push({ anio, meses: cargados });
  }
  const lista = (xs: number[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
  const partes = [`${datos.meses_publicados} meses, ${datos.desde} a ${datos.hasta}`];
  if (completos.length > 0) partes.push(`${lista(completos)} ${completos.length === 1 ? "completo" : "completos"}`);
  for (const p of parciales) partes.push(`${p.anio} parcial (${p.meses})`);
  partes.push(`${periodosActivos} ${periodosActivos === 1 ? "periodo activo" : "periodos activos"}`);
  partes.push(
    `${porTemporada.invierno} de invierno, ${porTemporada.verano} de verano, ${porTemporada.todo_el_ano} de toda temporada`
  );
  return partes.join("; ");
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
  modelo: ModeloCurva;
  recomendada: ModeloCurva | null;
  anios: readonly AnioAgrupacion[];
  eat: number | null;
  ruidoNormal: number | null;
  /** Versión de la curva vigente (se reemplaza); `null` si no hay. */
  versionVigente: number | null;
  comparacion: Comparacion | null;
  avisos: readonly AvisoCurva[];
  nota: string;
};

/** Texto del `confirm` de «Aprobar esta curva»: modelo, años con su clase, EAT frente al ruido, diferencia con la vigente y avisos. */
export function textoConfirmarAprobacion(e: EntradaConfirmar): string {
  const lineas: string[] = [];
  const prestada = e.modelo === "T";
  lineas.push(`¿Aprobar la curva ${modeloConNombre(e.modelo)} de ${e.agrupacion}?`);
  if (e.recomendada !== null && e.recomendada !== e.modelo) lineas.push(`No es la recomendada (${e.recomendada}).`);
  if (prestada) lineas.push("Curva prestada de la temporada: la agrupación no tiene años suficientes para una curva propia.");
  const usados = textoAniosUsados(e.anios);
  lineas.push(`Años usados: ${usados === "" ? "ninguno" : usados}.`);
  const fuera = textoAniosFuera(e.anios);
  if (fuera !== "") lineas.push(`Fuera del ajuste: ${fuera}.`);
  if (!prestada) {
    lineas.push(
      e.eat === null
        ? "EAT: sin backtesting (un solo año de ajuste)."
        : `EAT: ${formatearPp(e.eat)}; ruido entre años normales: ${e.ruidoNormal === null ? "no medible" : formatearPp(e.ruidoNormal)}.`
    );
  }
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

export type FilaForma = {
  clave: string;
  agrupacionId: string;
  agrupacion: string;
  temporada: TemporadaAgrupacion;
  anio: number;
  clase: ClaseAnioCurva | null;
  parcial: boolean;
  veredicto: VeredictoForma | null;
  diferencia: number | null;
  ruido: number | null;
  umbralEfectivo: number | null;
  pico: number | null;
  corrimiento: number | null;
  tratamiento: TratamientoAnio | null;
  /** Solo año en curso: las dos formas parciales. */
  parcialRed: number | null;
  parcialComunes: number | null;
  parcialTiendas: number | null;
};

/** Una fila por agrupación y año con medición de forma (la tabla filtrable del bloque Forma). */
export function filasForma(
  agrupaciones: {
    id: string;
    nombre: string;
    temporada: TemporadaAgrupacion;
    efecto_atipico: { forma: { ruido_normal: number | null; umbral_efectivo: number; por_anio: FormaAnio[] } | null };
  }[],
  anios: { anio: number; clase_por_temporada: Record<TemporadaAgrupacion, ClaseAnioCurva> }[]
): FilaForma[] {
  const filas: FilaForma[] = [];
  for (const a of agrupaciones) {
    const forma = a.efecto_atipico.forma;
    if (!forma) continue;
    for (const f of forma.por_anio) {
      const clase = anios.find((x) => x.anio === f.anio)?.clase_por_temporada[a.temporada] ?? (f.parcial ? "en_curso" : null);
      if (f.parcial) {
        filas.push({
          clave: `${a.id}-${f.anio}`,
          agrupacionId: a.id,
          agrupacion: a.nombre,
          temporada: a.temporada,
          anio: f.anio,
          clase,
          parcial: true,
          veredicto: null,
          diferencia: null,
          ruido: forma.ruido_normal,
          umbralEfectivo: forma.umbral_efectivo,
          pico: f.red_completa?.pico ?? f.tiendas_comunes?.pico ?? null,
          corrimiento: null,
          tratamiento: null,
          parcialRed: f.red_completa?.diferencia_anio ?? null,
          parcialComunes: f.tiendas_comunes?.diferencia_anio ?? null,
          parcialTiendas: f.tiendas_comunes?.tiendas ?? null,
        });
      } else {
        filas.push({
          clave: `${a.id}-${f.anio}`,
          agrupacionId: a.id,
          agrupacion: a.nombre,
          temporada: a.temporada,
          anio: f.anio,
          clase,
          parcial: false,
          veredicto: f.veredicto,
          diferencia: f.diferencia_anio,
          ruido: forma.ruido_normal,
          umbralEfectivo: forma.umbral_efectivo,
          pico: f.pico,
          corrimiento: f.corrimiento_pico,
          tratamiento: f.tratamiento_aplicado,
          parcialRed: null,
          parcialComunes: null,
          parcialTiendas: null,
        });
      }
    }
  }
  return filas.sort((x, y) => x.agrupacion.localeCompare(y.agrupacion, "es") || x.anio - y.anio);
}

export type FiltroVeredicto = "todos" | VeredictoForma | "parcial";

export function filtrarFilasForma(filas: readonly FilaForma[], temporada: FiltroTemporada, veredicto: FiltroVeredicto): FilaForma[] {
  return filas
    .filter((f) => temporada === "todas" || f.temporada === temporada)
    .filter((f) => veredicto === "todos" || (veredicto === "parcial" ? f.parcial : f.veredicto === veredicto));
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
  const base = a.clase === "en_curso" ? a.participacion_parcial : a.participacion;
  return {
    participacion: cargado && base ? base[mes] : null,
    unidades: cargado ? (a.meses[mes] ?? null) : null,
    imputado: a.imputados.includes(mes + 1),
    atipico: a.atipicos.includes(periodo),
    liquidacion: a.liquidacion.includes(periodo),
  };
}

/** CSV de la tabla año × mes: participación (%) y unidades de cada año, propuesta y vigente (%). */
export function filasCsvAnioMes(
  anios: readonly AnioAgrupacion[],
  propuesta: readonly number[] | null,
  vigente: readonly number[] | null
): { campos: string[]; datos: (string | number)[][] } {
  const ordenados = [...anios].sort((a, b) => a.anio - b.anio);
  const campos = [
    "MES",
    ...ordenados.flatMap((a) => [`${a.anio} (%)`, `${a.anio} (unidades)`]),
    "PROPUESTA (%)",
    "VIGENTE (%)",
    "DIFERENCIA (pp)",
  ];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const datos = MESES_CORTOS.map((nombre, mes) => {
    const fila: (string | number)[] = [nombre];
    for (const a of ordenados) {
      const c = celdaAnioMes(a, mes);
      fila.push(c.participacion === null ? "" : r1(c.participacion * 100), c.unidades === null ? "" : Math.round(c.unidades));
    }
    fila.push(
      propuesta ? r1(propuesta[mes] * 100) : "",
      vigente ? r1(vigente[mes] * 100) : "",
      propuesta && vigente ? r1((propuesta[mes] - vigente[mes]) * 100) : ""
    );
    return fila;
  });
  return { campos, datos };
}
