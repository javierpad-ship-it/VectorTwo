// Lógica pura de la pestaña «Crecimiento por género × mundo» (06d §4.1 y 06e §4.1): textos, formatos, filtros, series del
// gráfico (con 2026 corregido y la vista previa de 2027), tabla año × mes, cierre por agrupación, factores y diagnóstico de
// verano, base y nota del formulario de aprobación, reaprobar, CSV y URL. Sin React ni acceso a la base de datos.
// Todos los % de la API son PORCENTAJES (15 = 15 %), salvo lo que se dice en cada función. Formato `es-PE` (decimal con punto).

import type { AprobarCrecimientoValidado } from "@/lib/crecimientos/esquemas";
import { CLAVE_RESTO } from "@/lib/crecimientos/tipos-api";
import type {
  BandaNinoApi,
  CierreAgrupacionApi,
  CierreGMApi,
  DetalleGeneroMundoApi,
  DiagnosticoVeranoGMApi,
  FactorYApi,
  FilaGMApi,
  ListaGeneroMundoApi,
  MotivoNuloReferencia,
  MotivoObsoleto,
  OrigenMesGM,
  ProyeccionReferenciaApi,
  ReaprobarApi,
  ReferenciaApi,
  SerieAnioGMApi,
  SobreBase,
  TipoReferencia,
  VarianteAprobable,
  VarianteBase,
  VersionCrecimientoApi,
} from "@/lib/crecimientos/tipos-api";
import { formatearDecimal } from "@/lib/formato";
import { UMBRAL_CORRECCION_NINO } from "@/lib/proyeccion/tipos-api";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import { MESES_CORTOS, MESES_LARGOS, colorAnio, formatearUnidades } from "@/lib/reportes/histograma";

// ─── Formatos ───

/** `15.0 %`; `—` sin valor. */
export function formatearPctPlano(pct: number | null | undefined, decimales = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${formatearDecimal(pct, decimales)} %`;
}

/** `+3.0 %`, `-2.0 %`; `—` sin valor. Con `decimales = 2`: `+15.36 %`. */
export function formatearPctSigno(pct: number | null | undefined, decimales = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  const f = 10 ** decimales;
  const r = Math.round(pct * f) / f;
  const texto = formatearDecimal(Math.abs(r), decimales);
  return r === 0 ? `${texto} %` : `${r > 0 ? "+" : "-"}${texto} %`;
}

/** Diferencia en puntos porcentuales con signo: `+3.4 pp`, `-0.2 pp`. */
export function formatearDifPp(pp: number): string {
  const r = Math.round(pp * 10) / 10;
  const texto = formatearDecimal(Math.abs(r), 1);
  return r === 0 ? `${texto} pp` : `${r > 0 ? "+" : "-"}${texto} pp`;
}

/** Unidades con miles; `—` sin valor. */
export function formatearUds(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : formatearUnidades(n);
}

/** `0.66` (dos decimales, texto corrido); `—` sin valor. */
export function formatearFactorNino(f: number | null | undefined): string {
  return f === null || f === undefined || !Number.isFinite(f) ? "—" : formatearDecimal(f, 2);
}

/** `0.660` (tres decimales, tablas de diagnóstico); `—` sin valor. */
export function formatearFactorTabla(f: number | null | undefined): string {
  return f === null || f === undefined || !Number.isFinite(f) ? "—" : formatearDecimal(f, 3);
}

/** `ene–set` para los primeros `k` meses. */
export function rangoMeses(k: number): string {
  if (k <= 1) return MESES_CORTOS[0].toLowerCase();
  return `${MESES_CORTOS[0].toLowerCase()}–${MESES_CORTOS[Math.min(11, k - 1)].toLowerCase()}`;
}

/** `setiembre` (mes 1 a 12, minúsculas). */
export function nombreMesLargo(m: number): string {
  return MESES_LARGOS[m - 1]?.toLowerCase() ?? String(m);
}

// ─── Nombres ───

export function tituloGM(f: Pick<FilaGMApi, "clave" | "genero" | "mundo">): string {
  if (f.clave === CLAVE_RESTO) return "Resto";
  return `${f.genero ?? "—"} · ${f.mundo ?? "—"}`;
}

// ─── URL (M10): `?pestana=genero-mundo&anio=&proyeccion=` abre la lista; `?gm=<g>.<m>|resto&…` abre el detalle ───

export const PESTANA_GENERO_MUNDO = "genero-mundo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esIdProyeccion(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** `resto` o `<genero_id>.<mundo_id>`. */
export function esClaveGM(v: string | null | undefined): v is string {
  if (typeof v !== "string") return false;
  if (v === CLAVE_RESTO) return true;
  const partes = v.split(".");
  return partes.length === 2 && UUID.test(partes[0]) && UUID.test(partes[1]);
}

export type EstadoUrlGM = {
  /** Clave del detalle abierto (`?gm=`); `null` = lista. */
  gm: string | null;
  /** `?pestana=genero-mundo` o `?gm=`: la pestaña nueva es la activa. */
  pestanaGM: boolean;
  anio: number | null;
  proyeccion: string | null;
};

/** Lee la parte de la URL que usa la pestaña nueva. Un valor inválido se ignora (nunca rompe la pantalla). */
export function leerUrlGM(params: Pick<URLSearchParams, "get">): EstadoUrlGM {
  const gmTexto = params.get("gm");
  const gm = esClaveGM(gmTexto) ? gmTexto : null;
  const anioTexto = params.get("anio");
  const anio = anioTexto !== null && /^\d{4}$/.test(anioTexto) && Number(anioTexto) >= 2024 && Number(anioTexto) <= 2100 ? Number(anioTexto) : null;
  const proyTexto = params.get("proyeccion");
  return {
    gm,
    pestanaGM: gm !== null || params.get("pestana") === PESTANA_GENERO_MUNDO,
    anio,
    proyeccion: esIdProyeccion(proyTexto) ? proyTexto : null,
  };
}

/** URL de la lista (`gm = null`) o del detalle de un GM. */
export function urlGM(pathname: string, o: { gm: string | null; anio: number | null; proyeccion: string | null }): string {
  const q = new URLSearchParams();
  if (o.gm) q.set("gm", o.gm);
  else q.set("pestana", PESTANA_GENERO_MUNDO);
  if (o.anio !== null) q.set("anio", String(o.anio));
  if (o.proyeccion) q.set("proyeccion", o.proyeccion);
  return `${pathname}?${q.toString()}`;
}

/** Parámetros de la API a partir de la URL. */
export function consultaApiGM(o: { anio: number | null; proyeccion: string | null }): string {
  const q = new URLSearchParams();
  if (o.anio !== null) q.set("anio", String(o.anio));
  if (o.proyeccion) q.set("proyeccion", o.proyeccion);
  return q.size > 0 ? `?${q.toString()}` : "";
}

/** Dónde se cambia el factor del Niño (la pantalla de GM solo enlaza: no lo edita). */
export const URL_FACTORES_NINO = "/planificacion/proyeccion?pestana=factores";
/** Dónde se quita o se pone la marca de año del Niño. */
export const URL_PERIODOS_ATIPICOS = "/planificacion/curvas-estacionalidad";

// ─── Método 5: proyección de referencia ───

/** Desde `0.14.0` la proyección de referencia exige `version_metodo ≥ 5` (06e §3.1). */
export const METODO_MIN_REFERENCIA = 5;

// ─── Textos fijos ───

/** Texto fijo de la lista (06e §4.1). */
export function textoFijoLista(anio: number): string {
  const y = anio - 1;
  const umbral = formatearDecimal(UMBRAL_CORRECCION_NINO * 100, 1);
  return `% de ${anio} sobre la venta de ${y} corregida del Niño, de las tiendas que tendrá ${anio}. El factor del Niño es relativo: quita lo que la temporada cayó o subió de más frente a la red, y conserva la tendencia de la red. En un GM sin Niño (corrección menor que ${umbral} %), corregida = real.`;
}

export const TEXTO_MOTIVO_NULO: Record<MotivoNuloReferencia, string> = {
  metodo_anterior: "recalcula la proyección con 0.14.0 (método anterior)",
  sin_base: "la proyección no tiene base para este año: recalcúlala",
  sin_referencia: "recalcula la proyección con 0.14.0 y elígela como referencia",
  denominador_cero: "sin venta en el periodo anterior",
  sin_venta: "sin venta comparable",
  sin_curva: "ninguna agrupación del GM tiene curva vigente",
  meses_faltantes: "faltan meses publicados del año en curso",
};

export function textoMotivoNulo(m: MotivoNuloReferencia | null): string | null {
  return m ? TEXTO_MOTIVO_NULO[m] : null;
}

export const TEXTO_OBSOLETO: Record<MotivoObsoleto, string> = {
  base_movida: "la base elegida se movió 1 punto o más desde que se aprobó",
  base_no_calculable: "la base elegida ya no se puede calcular",
  composicion: "algún nodo salió de este género × mundo",
  factor_cambiado: "cambió el factor del Niño con que se calculó y la base corregida se movió 0.5 % o más",
  metodo_anterior: "se aprobó sobre 2026 real, antes de 0.14.0, y este género × mundo tuvo Niño: hay que reaprobarlo sobre 2026 corregido",
};

export const ETIQUETA_TIPO_REFERENCIA: Record<TipoReferencia, string> = {
  acumulado: "Acumulado",
  cierre_curva: "Cierre por curva",
  cierre_proyectado: "Cierre proyectado",
  anio_completo: "Año completo",
  aplicado_hoy: "Aplicado hoy",
};

/** El aviso de `anio_siguiente_atipico` (06e §3.1, D7): bloquea aprobar y cerrar. `meses` son `aaaa-mm`. */
export function textoAnioSiguienteAtipico(anio: number, meses: readonly string[] = []): string {
  const base = `${anio} está marcado como año del Niño en Curvas → Periodos atípicos. Por ahora el crecimiento de ${anio} no incluye el Niño: si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar.`;
  if (meses.length === 0) return base;
  return `${base} Meses marcados: ${meses.map((m) => textoUltimoMes(m)).join(", ")}.`;
}

// ─── Corrección del Niño, base y cierre (lectura de los campos de 0.14.0) ───

/** `hay_nino` (D8): de la fila y, si falta, del cierre por curva. */
export function hayNino(f: Pick<FilaGMApi, "hay_nino" | "cierre">): boolean {
  return f.hay_nino ?? f.cierre?.hay_nino ?? false;
}

/** Corrección del Niño en %: `Σ B' ÷ Σ B − 1` de la referencia, o la de la base por curva si no hay referencia. */
export function correccionNinoPct(f: Pick<FilaGMApi, "correccion_nino_pct" | "cierre">): number | null {
  return f.correccion_nino_pct ?? f.cierre?.correccion_curva_pct ?? null;
}

/** «corrección del Niño +6.8 %»; con una corrección menor que el umbral, «(no material)»; sin corrección, `null`. */
export function textoCorreccionNino(f: Pick<FilaGMApi, "hay_nino" | "cierre" | "correccion_nino_pct">): string | null {
  const c = correccionNinoPct(f);
  if (c === null || !Number.isFinite(c)) return null;
  if (hayNino(f)) return `corrección del Niño ${formatearPctSigno(c)}`;
  if (Math.abs(c) < 0.005) return null;
  return `corrección del Niño ${formatearPctSigno(c)} (no material)`;
}

export type BaseGM = {
  /** `proyeccion` = `Σ B` y `Σ B'` de la proyección de referencia (método 5); `curva` = base por curva sobre `M(Y+1)`. */
  origen: "proyeccion" | "curva";
  real: number | null;
  corregida: number | null;
  /** Solo con la base por curva: tiendas de 2027 y las que no están en `C(Y)` (R511 en el ejemplo). */
  tiendas: number | null;
  fueraCy: string[];
};

/** La base del año siguiente de un GM: de la proyección de referencia si existe, si no la base por curva. `null` si no hay ninguna. */
export function baseSiguienteGM(f: Pick<FilaGMApi, "base_siguiente" | "base_corregida" | "cierre">): BaseGM | null {
  if (f.base_siguiente !== null && f.base_siguiente !== undefined && f.base_corregida !== null && f.base_corregida !== undefined) {
    return { origen: "proyeccion", real: f.base_siguiente, corregida: f.base_corregida, tiendas: null, fueraCy: [] };
  }
  const b = f.cierre?.base_curva ?? null;
  if (b && b.real !== null && b.corregida !== null) return { origen: "curva", real: b.real, corregida: b.corregida, tiendas: b.tiendas, fueraCy: b.tiendas_fuera_cy };
  return null;
}

export function textoOrigenBase(b: BaseGM): string {
  return b.origen === "proyeccion" ? "de la proyección de referencia" : "por curva";
}

/** Un % escrito sobre 2026 corregido, visto sobre 2026 real: `(B' × (1+g)) ÷ B − 1`. `null` sin base. */
export function equivalenteSobreReal(pct: number | null, base: Pick<BaseGM, "real" | "corregida"> | null): number | null {
  if (pct === null || !base || base.real === null || base.corregida === null || !(base.real > 0)) return null;
  return ((base.corregida * (1 + pct / 100)) / base.real - 1) * 100;
}

/** 2027 resultante de la base corregida con el %: `round(B' × (1 + g))`. */
export function resultadoSobreCorregida(pct: number | null, base: Pick<BaseGM, "corregida"> | null): number | null {
  if (pct === null || !base || base.corregida === null) return null;
  return Math.round(base.corregida * (1 + pct / 100));
}

export type TotalSobreReal = { corregido: number | null; real: number | null };

/**
 * El Total de la lista en sus dos lecturas (06e §4.1): `Σ 2027 ÷ Σ B' − 1` (sobre 2026 corregido) y `Σ 2027 ÷ Σ B − 1` (sobre 2026 real).
 * Cada GM usa su versión vigente; uno sin versión (o un género que no se aprueba) sigue al Resto. Si falta la base de alguna fila o
 * el crecimiento del Resto, `null`. Es un cálculo del navegador sobre la lista: el % ponderado oficial es `total.pct_ponderado`.
 */
export function totalSobreReal(lista: Pick<ListaGeneroMundoApi, "filas" | "resto">): TotalSobreReal {
  const nulo: TotalSobreReal = { corregido: null, real: null };
  const resto = lista.resto.vigente;
  let sumaB = 0;
  let sumaBc = 0;
  let sumaP = 0;
  for (const f of [...lista.filas, lista.resto]) {
    const B = f.base_siguiente;
    const Bc = f.base_corregida;
    if (B === null || B === undefined || Bc === null || Bc === undefined) return nulo;
    const v = f.detallable && f.vigente ? f.vigente : resto;
    if (!v) return nulo;
    const sobre = sobreBaseDe(v);
    sumaB += B;
    sumaBc += Bc;
    sumaP += (sobre === "corregida" ? Bc : B) * (1 + v.pct / 100);
  }
  if (!(sumaB > 0) || !(sumaBc > 0)) return nulo;
  return { corregido: (sumaP / sumaBc - 1) * 100, real: (sumaP / sumaB - 1) * 100 };
}

/** Una versión sin `sobre_base` es de antes de `0.14.0`: `bruta`. */
export function sobreBaseDe(v: Pick<VersionCrecimientoApi, "sobre_base"> | null | undefined): SobreBase {
  return v?.sobre_base ?? "bruta";
}

export function esBrutaAntigua(v: Pick<VersionCrecimientoApi, "sobre_base"> | null | undefined): boolean {
  return v !== null && v !== undefined && sobreBaseDe(v) === "bruta";
}

/** `sobre 2026 corregido` o `sobre 2026 real (antes de 0.14.0)`. */
export function textoSobreBase(v: Pick<VersionCrecimientoApi, "sobre_base">, anioY: number): string {
  return sobreBaseDe(v) === "corregida" ? `sobre ${anioY} corregido` : `sobre ${anioY} real (antes de 0.14.0)`;
}

// ─── Lista ───

export type FiltroEstadoGM = "todos" | "sin_aprobar" | "aprobado" | "obsoleto" | "sigue_resto";

export const FILTROS_ESTADO_GM: { id: FiltroEstadoGM; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "sin_aprobar", label: "Sin aprobar" },
  { id: "aprobado", label: "Aprobados" },
  { id: "obsoleto", label: "Obsoletos" },
  { id: "sigue_resto", label: "Siguen al Resto" },
];

/** Un género que no se aprueba por separado «sigue al Resto», sin importar su estado numérico. */
export function estadoEfectivoGM(f: Pick<FilaGMApi, "detallable" | "estado">): Exclude<FiltroEstadoGM, "todos"> {
  return f.detallable ? f.estado : "sigue_resto";
}

export function contarEstadosGM(filas: readonly FilaGMApi[]): Record<FiltroEstadoGM, number> {
  const c: Record<FiltroEstadoGM, number> = { todos: filas.length, sin_aprobar: 0, aprobado: 0, obsoleto: 0, sigue_resto: 0 };
  for (const f of filas) c[estadoEfectivoGM(f)] += 1;
  return c;
}

export function generosDeLista(filas: readonly FilaGMApi[]): string[] {
  return [...new Set(filas.map((f) => f.genero).filter((g): g is string => g !== null))].sort((a, b) => a.localeCompare(b, "es"));
}

/** Detallables primero (género, mundo); luego los que siguen al Resto. */
export function ordenarFilasGM(filas: readonly FilaGMApi[]): FilaGMApi[] {
  return [...filas].sort((a, b) => {
    if (a.detallable !== b.detallable) return a.detallable ? -1 : 1;
    return (a.genero ?? "").localeCompare(b.genero ?? "", "es") || (a.mundo ?? "").localeCompare(b.mundo ?? "", "es");
  });
}

export function filtrarFilasGM(filas: readonly FilaGMApi[], f: { estado: FiltroEstadoGM; genero: string }): FilaGMApi[] {
  return ordenarFilasGM(filas).filter((x) => (f.estado === "todos" || estadoEfectivoGM(x) === f.estado) && (f.genero === "" || x.genero === f.genero));
}

export type FilaListaGM = { tipo: "gm"; fila: FilaGMApi } | { tipo: "resto"; fila: FilaGMApi } | { tipo: "total" };

/** Las filas de la tabla: los GM filtrados, el Resto y el Total (estos dos van siempre). */
export function filasDeLista(lista: Pick<ListaGeneroMundoApi, "filas" | "resto">, f: { estado: FiltroEstadoGM; genero: string }): FilaListaGM[] {
  return [
    ...filtrarFilasGM(lista.filas, f).map((fila): FilaListaGM => ({ tipo: "gm", fila })),
    { tipo: "resto", fila: lista.resto },
    { tipo: "total" },
  ];
}

export function textoEstadoGM(f: Pick<FilaGMApi, "detallable" | "estado" | "motivo_obsoleto" | "vigente">): string {
  if (!f.detallable) return "Sigue al Resto";
  if (f.estado === "aprobado") return `Aprobado v${f.vigente?.version ?? "?"}`;
  if (f.estado === "obsoleto") return `Obsoleto: ${f.motivo_obsoleto ? TEXTO_OBSOLETO[f.motivo_obsoleto] : "revisa la base"}`;
  return "Sin aprobar";
}

export function textoTotalSinAprobar(n: number): string {
  if (n <= 0) return "Todos los GM tienen crecimiento aprobado.";
  return `${n} GM sin aprobar ${n === 1 ? "sigue" : "siguen"} al Resto`;
}

/** Proyecciones que se pueden elegir como referencia: solo método 5 o posterior (06e); la elegida actual siempre queda. */
export function referenciasElegibles(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles" | "proyeccion_referencia">): ListaGeneroMundoApi["proyecciones_disponibles"] {
  const actual = lista.proyeccion_referencia?.id ?? null;
  return lista.proyecciones_disponibles.filter((p) => (p.version_metodo ?? 0) >= METODO_MIN_REFERENCIA || p.id === actual);
}

/** ¿Hay una proyección de referencia calculada con el método 5? Si no, se avisa y las cifras de proyección salen «—». */
export function hayReferenciaValida(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles" | "proyeccion_referencia">): boolean {
  const r: ProyeccionReferenciaApi | null = lista.proyeccion_referencia;
  return r !== null && (r.version_metodo ?? 0) >= METODO_MIN_REFERENCIA;
}

/** `2026-09` → `setiembre 2026`. */
export function textoUltimoMes(aaaamm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(aaaamm);
  if (!m) return aaaamm;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${MESES_LARGOS[mes - 1].toLowerCase()} ${m[1]}` : aaaamm;
}

export function textoSinReferencia(anioAplicacion: number): string {
  const y = anioAplicacion - 1;
  return `No hay proyección de ${y} calculada con el método 5 (0.14.0): recalcula la proyección para ver «Aplicado hoy», «Reaprobar» y la base ${anioAplicacion} de la proyección. El cierre por curva, la base por curva, el Acumulado y los Años completos funcionan igual.`;
}

export function etiquetaProyeccion(p: ProyeccionReferenciaApi & { estado?: string }): string {
  const estado = p.estado === "en_trabajo" ? "en trabajo" : p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : null;
  return [p.nombre, estado].filter(Boolean).join(" · ");
}

export function enTrabajoDe(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles"> | null): { id: string; nombre: string }[] {
  return (lista?.proyecciones_disponibles ?? []).filter((p) => p.estado === "en_trabajo").map((p) => ({ id: p.id, nombre: p.nombre }));
}

/** Insignias del cierre por curva en la lista: «avance bajo», «sin curva 4 %», «factor parcial», «sin factor». */
export function insigniasCierre(c: CierreGMApi | undefined | null): { texto: string; titulo?: string }[] {
  if (!c) return [];
  const salida: { texto: string; titulo?: string }[] = [];
  if (c.avance_bajo) salida.push({ texto: "avance bajo", titulo: c.agrupaciones_avance_bajo.length > 0 ? `Avance bajo de la curva: ${c.agrupaciones_avance_bajo.join(", ")}` : "El avance de la curva a hoy es bajo: el cierre es poco estable" });
  if (c.sin_curva_pct !== null && c.sin_curva_pct > 0) salida.push({ texto: `sin curva ${formatearDecimal(c.sin_curva_pct, 0)} %`, titulo: "Parte del vendido se cerró con la curva compuesta del GM porque su agrupación no tiene curva vigente" });
  if (c.sin_factor) salida.push({ texto: "sin factor", titulo: "Una temporada con Niño no tiene factor: su 2026 no se corrigió" });
  else if (c.factor_parcial) salida.push({ texto: "factor parcial", titulo: "El factor del Niño de este año se calculó solo con los meses publicados" });
  return salida;
}

function celdaNum(n: number | null | undefined): string | number {
  return n === null || n === undefined ? "" : n;
}

function celdaRed(n: number | null | undefined): string | number {
  return n === null || n === undefined ? "" : Math.round(n);
}

export function filasCsvLista(lista: ListaGeneroMundoApi, filas: readonly FilaGMApi[]): { campos: string[]; datos: (string | number)[][] } {
  const anio = lista.anio_aplicacion;
  const campos = [
    "Género",
    "Mundo",
    `Unidades ${anio - 2}`,
    "Acumulado % real",
    "Acumulado % corregido",
    "Acumulado extremo",
    `Cierre ${anio - 1} por curva (u)`,
    `Cierre ${anio - 1} por curva corregido (u)`,
    "Cierre % real",
    "Cierre % corregido",
    "Aplicado hoy % sobre corregido",
    "Aplicado hoy % sobre real",
    `Base ${anio} real`,
    `Base ${anio} corregida`,
    "Origen de la base",
    "Corrección del Niño %",
    "Con Niño",
    `Crecimiento ${anio} aprobado %`,
    "Sobre",
    "Versión",
    "Aprobado por",
    "Aprobado el",
    "Estado",
  ];
  const datos = [...filas, lista.resto].map((f): (string | number)[] => {
    const b = baseSiguienteGM(f);
    return [
      f.clave === CLAVE_RESTO ? "RESTO" : (f.genero ?? ""),
      f.mundo ?? "",
      celdaRed(f.unidades_anterior),
      celdaNum(f.acumulado.pct_bruto),
      celdaNum(f.acumulado.pct_sin_nino),
      f.acumulado.extremo ? "sí" : "no",
      celdaRed(f.cierre?.cierre),
      celdaRed(f.cierre?.cierre_corregido),
      celdaNum(f.cierre?.pct),
      celdaNum(f.cierre?.pct_corregido),
      celdaNum(f.aplicado_hoy.pct_sin_nino),
      celdaNum(f.aplicado_hoy.pct_bruto),
      celdaRed(b?.real),
      celdaRed(b?.corregida),
      b ? textoOrigenBase(b) : "",
      celdaNum(correccionNinoPct(f)),
      hayNino(f) ? "sí" : "no",
      f.vigente ? f.vigente.pct : "",
      f.vigente ? (sobreBaseDe(f.vigente) === "corregida" ? "corregido" : "real (antes de 0.14.0)") : "",
      f.vigente ? f.vigente.version : "",
      f.vigente?.por_nombre ?? "",
      f.vigente?.aprobada_at ?? "",
      textoEstadoGM(f),
    ];
  });
  return { campos, datos };
}

// ─── Detalle: curva de venta ───

export type ModoGM = "unidades" | "forma" | "sin_nino";

export const MODOS_GM: { id: ModoGM; label: string }[] = [
  { id: "unidades", label: "Unidades" },
  { id: "forma", label: "Forma (%)" },
  { id: "sin_nino", label: "Sin Niño" },
];

/**
 * Valores de un año según el modo, en la unidad del gráfico: unidades, o fracción (0 a 1) en Forma. En «Sin Niño», el año en curso
 * es la serie corregida del cierre por curva (si el servidor la manda: solo con `hay_nino`); los demás años, sus meses sin Niño.
 */
export function valoresSerie(s: Pick<SerieAnioGMApi, "anio" | "meses" | "meses_sin_nino" | "forma">, modo: ModoGM, corregida?: Pick<SerieAnioGMApi, "anio" | "meses"> | null): (number | null)[] {
  if (modo === "forma") return s.forma.map((v) => (v === null ? null : v / 100));
  if (modo === "sin_nino") return corregida && corregida.anio === s.anio ? corregida.meses : s.meses_sin_nino;
  return s.meses;
}

/** Parte la serie de un año en lo real (trazo continuo) y lo proyectado (discontinuo, unido al último mes real). */
export function dividirRealProyectado(
  valores: readonly (number | null)[],
  origen: readonly OrigenMesGM[]
): { real: (number | null)[]; proyectado: (number | null)[] | null } {
  if (!origen.includes("proyectado")) return { real: [...valores], proyectado: null };
  const real = valores.map((v, i) => (origen[i] === "real" ? v : null));
  const primero = origen.indexOf("proyectado");
  const proyectado = valores.map((v, i) => (origen[i] === "proyectado" ? v : null));
  for (let i = primero - 1; i >= 0; i--) {
    if (origen[i] === "real") {
      proyectado[i] = valores[i];
      break;
    }
  }
  return { real, proyectado };
}

/** Cuántos meses reales tiene el año en curso (el último con `origen = real` cuando hay meses proyectados); `null` si no hay. */
export function mesesRealesDelAnioEnCurso(series: readonly Pick<SerieAnioGMApi, "origen">[]): number | null {
  for (const s of series) {
    if (!s.origen.includes("proyectado")) continue;
    let k = 0;
    s.origen.forEach((o, i) => {
      if (o === "real") k = i + 1;
    });
    return k > 0 ? k : null;
  }
  return null;
}

/** El año en curso (`Y`): el de la serie con meses proyectados. */
export function anioEnCursoDe(series: readonly Pick<SerieAnioGMApi, "origen" | "anio">[]): number | null {
  return series.find((s) => s.origen.includes("proyectado"))?.anio ?? null;
}

export type SerieGM = SerieGrafico & {
  /** Clave del interruptor de la leyenda: real y proyectado de un año se encienden juntos. */
  grupo: string;
  anio: number | null;
};

export const GRUPO_FORMA_TIPICA = "forma-tipica";
export const GRUPO_CORREGIDO = "anio-corregido";
export const GRUPO_VISTA_PREVIA = "vista-previa";

/** La vista previa de 2027 (en el navegador): `base 2027 corregida por curva × (1 + g)`, mes a mes, sobre las tiendas de 2027. */
export function vistaPrevia2027(serie: { corregida: readonly number[] } | null | undefined, pct: number | null): number[] | null {
  if (!serie || pct === null || !Number.isFinite(pct) || serie.corregida.length !== 12) return null;
  return serie.corregida.map((v) => v * (1 + pct / 100));
}

export type OpcionesSeriesGM = {
  /** El % que se está escribiendo (sobre 2026 corregido); `null` = sin vista previa. */
  pct?: number | null;
};

/**
 * Las series del gráfico: una línea por año (2026 en dos tramos: real continuo y cierre por curva discontinuo), «2026 corregido
 * (sin Niño)» punteada si el GM tiene Niño y «2027 vista previa» discontinua clara. En Forma se añade la forma típica y no se dibujan las
 * dos líneas extra; en «Sin Niño», 2026 ya es la serie corregida y no hay línea aparte.
 */
export function seriesDelGrafico(
  d: Pick<DetalleGeneroMundoApi, "series" | "forma_tipica" | "serie_corregida" | "serie_base_curva"> & { acumulado?: Pick<ReferenciaApi, "anio"> },
  modo: ModoGM,
  o: OpcionesSeriesGM = {}
): SerieGM[] {
  const salida: SerieGM[] = [];
  const corregida = d.serie_corregida ?? null;
  for (const s of [...d.series].sort((a, b) => a.anio - b.anio)) {
    const valores = valoresSerie(s, modo, corregida);
    if (valores.every((v) => v === null)) continue;
    const { real, proyectado } = dividirRealProyectado(valores, s.origen);
    const color = colorAnio(s.anio);
    const grupo = `anio-${s.anio}`;
    if (proyectado === null) {
      salida.push({ clave: grupo, grupo, anio: s.anio, etiqueta: String(s.anio), valores: real, color, trazo: "continuo" });
      continue;
    }
    const k = mesesRealesDelAnioEnCurso([s]);
    salida.push({ clave: `${grupo}-real`, grupo, anio: s.anio, etiqueta: `${s.anio} real${k ? ` (${rangoMeses(k)})` : ""}`, valores: real, color, trazo: "continuo" });
    salida.push({ clave: `${grupo}-proy`, grupo, anio: s.anio, etiqueta: `${s.anio} cierre por curva`, valores: proyectado, color, trazo: "discontinuo" });
  }
  if (modo === "unidades" && corregida && corregida.meses.some((v) => v !== null)) {
    salida.push({
      clave: `${GRUPO_CORREGIDO}-${corregida.anio}`,
      grupo: `${GRUPO_CORREGIDO}-${corregida.anio}`,
      anio: corregida.anio,
      etiqueta: `${corregida.anio} corregido (sin Niño)`,
      valores: corregida.meses,
      color: colorAnio(corregida.anio),
      trazo: "punteado",
    });
  }
  if (modo !== "forma" && d.acumulado) {
    const previa = vistaPrevia2027(d.serie_base_curva, o.pct ?? null);
    if (previa && o.pct !== null && o.pct !== undefined) {
      const anioPrevia = d.acumulado.anio + 1;
      salida.push({
        clave: GRUPO_VISTA_PREVIA,
        grupo: GRUPO_VISTA_PREVIA,
        anio: anioPrevia,
        etiqueta: `${anioPrevia} vista previa (${formatearDecimal(o.pct, 2)} %)`,
        valores: previa,
        color: colorAnio(anioPrevia),
        trazo: "discontinuo",
        opacidad: 0.6,
      });
    }
  }
  if (modo === "forma" && d.forma_tipica && d.forma_tipica.length === 12) {
    salida.push({
      clave: GRUPO_FORMA_TIPICA,
      grupo: GRUPO_FORMA_TIPICA,
      anio: null,
      etiqueta: "Forma típica",
      valores: d.forma_tipica.map((v) => v / 100),
      color: "var(--tinta)",
      trazo: "punteado",
      grosor: 2.5,
    });
  }
  return salida;
}

export type BandaNinoVista = BandaNinoApi & { texto: string; rango: string };

/** `jun–set` para los meses de una banda (consecutivos) o `dic, ene–mar` si cruzan el año. */
export function rangoDeMeses(meses: readonly number[]): string {
  const m = [...new Set(meses)].filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b);
  if (m.length === 0) return "—";
  const tramos: string[] = [];
  let ini = m[0];
  let ant = m[0];
  const nombre = (x: number) => MESES_CORTOS[x - 1].toLowerCase();
  const cerrar = () => tramos.push(ini === ant ? nombre(ini) : `${nombre(ini)}–${nombre(ant)}`);
  for (const x of m.slice(1)) {
    if (x === ant + 1) {
      ant = x;
      continue;
    }
    cerrar();
    ini = x;
    ant = x;
  }
  cerrar();
  return tramos.join(", ");
}

/** El texto de cada banda: «Niño 2026 · invierno (jun–set): factor 0.66 · factor parcial (ene–set)». */
export function bandasDelNino(d: Pick<DetalleGeneroMundoApi, "bandas_nino" | "series">): BandaNinoVista[] {
  const k = mesesRealesDelAnioEnCurso(d.series);
  return d.bandas_nino.map((b) => {
    const rango = rangoDeMeses(b.meses);
    const factor = b.factor === null ? "sin factor" : `factor ${formatearFactorNino(b.factor)}`;
    const parcial = b.parcial ? ` · factor parcial (${k ? rangoMeses(k) : "solo los meses cargados"})` : "";
    return { ...b, rango, texto: `Niño ${b.anio} · ${b.temporada} (${rango}): ${factor}${parcial}` };
  });
}

/** Meses (1 a 12) con banda, sin repetir, para sombrear el gráfico. */
export function mesesDeBandas(bandas: readonly Pick<BandaNinoApi, "meses">[]): number[] {
  return [...new Set(bandas.flatMap((b) => b.meses))].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
}

/**
 * Leyenda de «2026 corregido (sin Niño)»: «invierno ÷ 0.70 (relativo) · verano set–dic ÷ 1.50 (escrito por Javier)». Solo las
 * temporadas del año en curso `anioY` que tocan al GM (`factores_y`); una sin factor dice «sin factor».
 */
export function textoLeyendaCorregido(factores: readonly Pick<FactorYApi, "anio" | "temporada" | "efectivo" | "origen">[], bandas: readonly Pick<BandaNinoApi, "anio" | "temporada" | "meses">[], anioY: number): string | null {
  const partes: string[] = [];
  for (const f of factores.filter((x) => x.anio === anioY)) {
    const banda = bandas.find((b) => b.anio === anioY && b.temporada === f.temporada);
    const rango = f.temporada === "invierno" || !banda ? "" : ` ${rangoDeMeses(banda.meses)}`;
    if (f.efectivo === null) {
      partes.push(`${f.temporada}${rango} sin factor`);
      continue;
    }
    const quien = f.temporada === "invierno" ? "relativo" : f.origen === "aplicado" ? "escrito por Javier" : "relativo";
    partes.push(`${f.temporada}${rango} ÷ ${formatearFactorNino(f.efectivo)} (${quien})`);
  }
  return partes.length === 0 ? null : partes.join(" · ");
}

/** «tiendas de 2027 (incluye T10)»: el rótulo de la base por curva y de la vista previa. */
export function textoTiendasBase(anioAplicacion: number, base: { tiendas_fuera_cy: readonly string[] } | null | undefined): string {
  const fuera = base?.tiendas_fuera_cy ?? [];
  return fuera.length > 0 ? `tiendas de ${anioAplicacion} (incluye ${fuera.join(", ")})` : `tiendas de ${anioAplicacion}`;
}

export type TipoFilaTabla = "anio" | "corregido" | "base_real" | "base_corregida" | "previa";

export type FilaTablaGM = {
  /** Estable y única por fila. */
  clave: string;
  tipo: TipoFilaTabla;
  anio: number;
  /** Rótulo de la fila: «2026», «2026 corregido (sin Niño)», «Base 2027 por curva (tiendas de 2027)»… */
  etiqueta: string;
  valores: (number | null)[];
  origen: OrigenMesGM[];
  /** Total del año en la unidad del modo; `null` en Forma (siempre 100 %). */
  total: number | null;
  incompleto: boolean;
  /** Variación del total frente al año anterior (%); `null` sin año anterior, en Forma o en las filas de base. */
  variacion: number | null;
  /** Explica de dónde sale la variación de una fila que no es un año (para el `title`). */
  notaVariacion?: string;
};

/** Variación % entre dos totales; `null` si el anterior no es positivo. */
export function variacionPct(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || !(anterior > 0)) return null;
  return (actual / anterior - 1) * 100;
}

const sumar = (v: readonly (number | null)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);

type DetalleTabla = Pick<DetalleGeneroMundoApi, "series" | "serie_corregida" | "serie_base_curva" | "cierre" | "acumulado" | "hay_nino">;

/**
 * Filas de la tabla año × mes (06e §4.1 punto 2): 2023…2026, «2026 corregido (sin Niño)» debajo de 2026, la base 2027 por curva
 * (real y corregida) y la vista previa de 2027 con el % que se escribe. La fila corregida compara con el año anterior corregido.
 * En Unidades van todas; en «Sin Niño», 2026 ya es la serie corregida y solo van la base corregida y la vista previa; en Forma, solo los años.
 */
export function filasTablaAnioMes(d: DetalleTabla, modo: ModoGM, o: OpcionesSeriesGM = {}): FilaTablaGM[] {
  const ordenadas = [...d.series].sort((a, b) => a.anio - b.anio);
  const corregida = d.serie_corregida ?? null;
  const usaCorregida = (s: SerieAnioGMApi) => modo === "sin_nino" && corregida !== null && corregida.anio === s.anio;
  const totalDe = (s: SerieAnioGMApi): number | null => (modo === "unidades" ? s.total : modo === "sin_nino" ? (usaCorregida(s) && corregida ? corregida.total : s.total_sin_nino) : null);
  const filas: FilaTablaGM[] = [];
  for (const s of ordenadas) {
    const previo = ordenadas.find((p) => p.anio === s.anio - 1) ?? null;
    filas.push({
      clave: `anio-${s.anio}`,
      tipo: "anio",
      anio: s.anio,
      etiqueta: String(s.anio),
      valores: modo === "forma" ? s.forma : valoresSerie(s, modo, corregida),
      origen: s.origen,
      total: totalDe(s),
      incompleto: s.incompleto,
      variacion: modo === "forma" || !previo ? null : variacionPct(totalDe(s), totalDe(previo)),
    });
    if (modo === "unidades" && corregida && corregida.anio === s.anio) {
      const previoCorregido = previo ? previo.total_sin_nino : null;
      filas.push({
        clave: `corregido-${s.anio}`,
        tipo: "corregido",
        anio: s.anio,
        etiqueta: `${s.anio} corregido (sin Niño)`,
        valores: corregida.meses,
        origen: corregida.origen.length === 12 ? corregida.origen : s.origen,
        total: corregida.total,
        incompleto: corregida.incompleto || s.incompleto,
        variacion: variacionPct(corregida.total, previoCorregido),
        notaVariacion: `Frente a ${s.anio - 1} corregido`,
      });
    }
  }
  if (modo === "forma") return filas;

  const base = d.serie_base_curva ?? null;
  const k = d.cierre?.k ?? null;
  const anioPrevia = d.acumulado.anio + 1;
  if (base && base.real.length === 12 && base.corregida.length === 12) {
    const origenBase: OrigenMesGM[] = Array.from({ length: 12 }, (_, i) => (k !== null && i < k ? "real" : "proyectado"));
    const tiendas = textoTiendasBase(anioPrevia, d.cierre?.base_curva ?? null);
    const hayCorreccion = modo === "unidades" && (d.hay_nino ?? d.cierre?.hay_nino ?? false);
    if (modo === "unidades") {
      filas.push({
        clave: "base-real",
        tipo: "base_real",
        anio: anioPrevia,
        etiqueta: hayCorreccion ? `Base ${anioPrevia} por curva, real — ${tiendas}` : `Base ${anioPrevia} por curva — ${tiendas}`,
        valores: base.real,
        origen: origenBase,
        total: sumar(base.real),
        incompleto: true,
        variacion: null,
        notaVariacion: "Son otras tiendas que las del año anterior: no se compara",
      });
    }
    if (modo === "sin_nino" || hayCorreccion) {
      filas.push({
        clave: "base-corregida",
        tipo: "base_corregida",
        anio: anioPrevia,
        etiqueta: `Base ${anioPrevia} por curva, corregida — ${tiendas}`,
        valores: base.corregida,
        origen: origenBase,
        total: sumar(base.corregida),
        incompleto: true,
        variacion: null,
        notaVariacion: "Son otras tiendas que las del año anterior: no se compara",
      });
    }
    const previa = vistaPrevia2027(base, o.pct ?? null);
    if (previa && o.pct !== null && o.pct !== undefined) {
      filas.push({
        clave: "vista-previa",
        tipo: "previa",
        anio: anioPrevia,
        etiqueta: `${anioPrevia} vista previa (${formatearDecimal(o.pct, 2)} %)`,
        valores: previa,
        origen: previa.map(() => "proyectado" as const),
        total: sumar(previa),
        incompleto: true,
        variacion: o.pct,
        notaVariacion: `Sobre la base ${anioPrevia} corregida: es el % que escribes`,
      });
    }
  }
  return filas;
}

/**
 * CSV de la curva: tres filas por año (unidades, sin Niño y forma %) con los doce meses y el total, más las filas nuevas de 0.14.0
 * (2026 corregido, base 2027 por curva real y corregida y la vista previa con el %).
 */
export function filasCsvSeries(d: Pick<DetalleGeneroMundoApi, "series" | "serie_corregida" | "serie_base_curva" | "acumulado" | "cierre">, o: OpcionesSeriesGM = {}): { campos: string[]; datos: (string | number)[][] } {
  const campos = ["Año", "Medida", ...MESES_CORTOS, "Total", "Meses proyectados"];
  const datos: (string | number)[][] = [];
  const cel = (n: number | null) => (n === null ? "" : n);
  for (const s of [...d.series].sort((a, b) => a.anio - b.anio)) {
    const proy = s.origen.filter((x) => x === "proyectado").length;
    datos.push([s.anio, "Unidades", ...s.meses.map(cel), s.total, proy]);
    datos.push([s.anio, "Unidades sin Niño", ...s.meses_sin_nino.map(cel), s.total_sin_nino, proy]);
    datos.push([s.anio, "Forma (% del año)", ...s.forma.map(cel), 100, proy]);
  }
  const c = d.serie_corregida ?? null;
  if (c) datos.push([c.anio, "Unidades corregidas (sin Niño)", ...c.meses.map(cel), c.total, c.origen.filter((x) => x === "proyectado").length]);
  const base = d.serie_base_curva ?? null;
  const anioPrevia = d.acumulado.anio + 1;
  if (base && base.real.length === 12 && base.corregida.length === 12) {
    const k = d.cierre?.k ?? null;
    const proy = k === null ? 12 : 12 - k;
    datos.push([anioPrevia, "Base por curva real (tiendas del año)", ...base.real.map(cel), Math.round(sumar(base.real)), proy]);
    datos.push([anioPrevia, "Base por curva corregida (tiendas del año)", ...base.corregida.map(cel), Math.round(sumar(base.corregida)), proy]);
    const previa = vistaPrevia2027(base, o.pct ?? null);
    if (previa && o.pct !== null && o.pct !== undefined) datos.push([anioPrevia, `Vista previa con ${formatearDecimal(o.pct, 2)} % sobre corregido`, ...previa.map((v) => Math.round(v)), Math.round(sumar(previa)), 12]);
  }
  return { campos, datos };
}

/** «Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026).» */
export function textoLeyendaTiendas(d: Pick<DetalleGeneroMundoApi, "tiendas" | "series">, anioEnCurso: number | null): string {
  const n = d.tiendas.n;
  const tiendas = `${n} ${n === 1 ? "tienda" : "tiendas"}`;
  if (anioEnCurso === null) return `Mismas tiendas: ${tiendas}.`;
  const k = mesesRealesDelAnioEnCurso(d.series);
  const periodo = k ? rangoMeses(k) : "los meses cerrados";
  return `Mismas tiendas de ${anioEnCurso}: ${tiendas} (abiertas todo ${anioEnCurso - 1} y ${periodo} ${anioEnCurso}).`;
}

// ─── Detalle: cómo se cierra 2026 ───

/** Etiqueta legible de la temporada de una agrupación. */
export function textoTemporada(t: string): string {
  return t === "todo_el_ano" ? "todo el año" : t === "sin_agrupacion" ? "sin agrupación" : t;
}

/**
 * El factor mes a mes de una agrupación en una celda: `÷ 0.70` si es constante, `—` si no hay (1,00 todo el año) o
 * `÷ 1.50 (set–dic)` si solo toca algunos meses. `factor_meses[i]` es el factor de enero + `i`.
 */
export function textoFactorAgrupacion(factorMeses: readonly number[]): string {
  const meses = factorMeses.slice(0, 12);
  if (meses.length === 0) return "—";
  const afectados = meses.map((f, i) => ({ f, m: i + 1 })).filter((x) => Math.abs(x.f - 1) > 1e-9);
  if (afectados.length === 0) return "—";
  const valores = [...new Set(afectados.map((x) => formatearFactorNino(x.f)))];
  if (afectados.length === meses.length && valores.length === 1) return `÷ ${valores[0]}`;
  return valores.map((v) => `÷ ${v} (${rangoDeMeses(afectados.filter((x) => formatearFactorNino(x.f) === v).map((x) => x.m))})`).join(" · ");
}

export type FilaCierre = { tipo: "agrupacion"; a: CierreAgrupacionApi } | { tipo: "total"; c: CierreGMApi };

export function filasDeCierre(d: Pick<DetalleGeneroMundoApi, "cierre_por_agrupacion" | "cierre">): FilaCierre[] {
  const filas: FilaCierre[] = (d.cierre_por_agrupacion ?? []).map((a): FilaCierre => ({ tipo: "agrupacion", a }));
  if (d.cierre) filas.push({ tipo: "total", c: d.cierre });
  return filas;
}

/** Avisos del cierre por curva: avance bajo, sin curva, meses faltantes y factor faltante o parcial. */
export function avisosDeCierre(c: CierreGMApi | undefined | null, agrupaciones: readonly CierreAgrupacionApi[] = []): string[] {
  if (!c) return [];
  const avisos: string[] = [];
  if (c.motivo_nulo === "meses_faltantes") avisos.push("Faltan meses publicados del año en curso: no se calcula el cierre por curva. El Acumulado y los Años completos siguen disponibles.");
  if (c.motivo_nulo === "sin_curva") avisos.push("Ninguna agrupación de este género × mundo tiene curva vigente: no se puede cerrar el año por curva.");
  const bajas = c.agrupaciones_avance_bajo.length > 0 ? c.agrupaciones_avance_bajo : agrupaciones.filter((a) => a.avance_bajo).map((a) => a.nombre);
  if (c.avance_bajo)
    avisos.push(`Avance bajo de la curva${bajas.length > 0 ? ` (${bajas.join(", ")})` : ""}: el cierre se apoya en pocos meses y es poco estable. La base por defecto pasa a «Año completo».`);
  else if (bajas.length > 0) avisos.push(`Avance bajo en ${bajas.join(", ")}: el cierre de esas agrupaciones es poco estable.`);
  const sinCurva = agrupaciones.filter((a) => a.curva === null).map((a) => a.nombre);
  if (c.sin_curva_pct !== null && c.sin_curva_pct > 0)
    avisos.push(`${formatearDecimal(c.sin_curva_pct, 0)} % del vendido se cerró con la curva compuesta del género × mundo${sinCurva.length > 0 ? ` (sin curva vigente: ${sinCurva.join(", ")})` : ""}.`);
  if (c.sin_factor) avisos.push("Una temporada con Niño no tiene factor: su 2026 no se corrigió y no podrás cerrar la proyección.");
  return avisos;
}

/** «En la proyección «Plan 2026»: base 2027 56 120 u real · 59 940 corregida (…)». `null` sin proyección de método 5. */
export function textoCierreProyeccion(p: DetalleGeneroMundoApi["cierre_proyeccion"] | undefined, anioAplicacion: number): string | null {
  if (!p) return null;
  return `En la proyección «${p.nombre}»: base ${anioAplicacion} ${formatearUds(p.base)} u real · ${formatearUds(p.base_corregida)} u corregida (tiendas de ${anioAplicacion} de la proyección; la diferencia con la curva viene de las decisiones y de la venta esperada de tiendas nuevas).`;
}

// ─── Detalle: factores del Niño de Y y diagnóstico ───

export type ParteTexto = { t: string; b?: boolean };

const ESTADO_FACTOR_TEXTO: Record<FactorYApi["estado"], string> = {
  ok: "al día",
  faltante: "sin factor",
  desfasado: "desfasado: sincroniza en Factores del Niño",
  sin_confirmar: "por confirmar en Factores del Niño",
};

/** Estado del factor para la insignia: «factor parcial · confirmado por Javier», «por confirmar», «desfasado: sincroniza»… */
export function textoEstadoFactor(f: Pick<FactorYApi, "estado" | "parcial" | "origen">): { texto: string; tono: "exito" | "alerta" | "neutro" } {
  if (f.estado === "ok") {
    const base = f.parcial ? "factor parcial · confirmado por Javier" : f.origen === "aplicado" ? "escrito por Javier" : "al día";
    return { texto: base, tono: "exito" };
  }
  const prefijo = f.parcial && f.estado !== "faltante" ? "factor parcial · " : "";
  return { texto: `${prefijo}${ESTADO_FACTOR_TEXTO[f.estado]}`, tono: "alerta" };
}

/** El factor de verano de verdad tiene un tono distinto del de invierno: se usa solo para el orden de los bloques. */
export function ordenarFactores(factores: readonly FactorYApi[]): FactorYApi[] {
  const peso = (t: string) => (t === "invierno" ? 0 : 1);
  return [...factores].sort((a, b) => b.anio - a.anio || peso(a.temporada) - peso(b.temporada));
}

/** Meses del periodo de una temporada con dato en ambos años, según el diagnóstico. */
function mesesEnPeriodo(diagnostico: Pick<NonNullable<FactorYApi["diagnostico"]>, "meses"> | null | undefined): number[] {
  return (diagnostico?.meses ?? []).filter((m) => m.en_periodo).map((m) => m.m);
}

function mismoFactor(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && formatearFactorNino(a) === formatearFactorNino(b);
}

/**
 * El rótulo del factor de invierno (06e §4.1 punto 3), con los dos números que lo forman y la insignia aparte:
 * «Factor 0.70 = 0.66 ÷ 0.94. 0.66: invierno 2026 ÷ 2025 de las mismas tiendas en ene–set (9 de 12 meses del periodo). 0.94: la red de
 * todo el año en los mismos meses y tiendas. El invierno corregido es lo que habría vendido si hubiera seguido la tendencia de la red
 * (-6 % frente a 2025), no 2025 repetido.» El año de referencia se supone `anio − 1` (el contrato no lo trae).
 */
export function partesFactorInvierno(f: FactorYApi): ParteTexto[] {
  const ref = f.anio - 1;
  if (f.efectivo === null) return [{ t: `Sin factor de invierno ${f.anio}: el invierno de ${f.anio} no se corrigió y no podrás cerrar.` }];
  const calc = f.ratio_calculado;
  const partes: ParteTexto[] = [];
  const mismo = f.origen === "calculado" || mismoFactor(f.efectivo, calc);
  if (f.ratio_volumen !== null && f.ratio_control !== null && (mismo || calc !== null)) {
    const formula = `${formatearFactorNino(calc ?? f.efectivo)} = ${formatearFactorNino(f.ratio_volumen)} ÷ ${formatearFactorNino(f.ratio_control)}`;
    partes.push(mismo ? { t: `Factor ${formatearFactorNino(f.efectivo)} = ${formatearFactorNino(f.ratio_volumen)} ÷ ${formatearFactorNino(f.ratio_control)}. ` } : { t: `Factor ${formatearFactorNino(f.efectivo)} (tu valor) · calculado hoy ${formula}. ` });
    const periodo = mesesEnPeriodo(f.diagnostico);
    const rango = periodo.length > 0 ? ` en ${rangoDeMeses(periodo)}` : "";
    partes.push({ t: formatearFactorNino(f.ratio_volumen), b: true });
    partes.push({ t: `: invierno ${f.anio} ÷ ${ref} de las mismas tiendas${rango} (${f.meses_periodo_con_dato} de ${f.meses_periodo} meses del periodo). ` });
    partes.push({ t: formatearFactorNino(f.ratio_control), b: true });
    partes.push({ t: ": la red de todo el año en los mismos meses y tiendas. " });
    const tendencia = (f.ratio_control - 1) * 100;
    partes.push({ t: `El invierno corregido es lo que habría vendido si hubiera seguido la tendencia de la red (${formatearPctSigno(tendencia, 0)} frente a ${ref}), no ${ref} repetido.` });
    return partes;
  }
  partes.push({ t: `Factor ${formatearFactorNino(f.efectivo)} ${f.origen === "aplicado" ? "escrito por Javier" : "calculado"}${calc !== null && !mismoFactor(f.efectivo, calc) ? ` (calculado hoy ${formatearFactorNino(calc)})` : ""}. ` });
  partes.push({ t: "El invierno corregido conserva la tendencia de la red: solo se le quita el efecto propio del Niño." });
  return partes;
}

/**
 * El rótulo del factor de verano: «Factor 1.50 escrito por Javier · oct–dic de 2026 se proyecta ×1.50 (supone que el Niño sigue hasta
 * diciembre)». Sin factor: «Sin factor: 2026 de verano no se corrigió y no podrás cerrar.»
 */
export function textoFactorVerano(f: FactorYApi, bandas: readonly Pick<BandaNinoApi, "anio" | "temporada" | "meses">[], k: number | null): string {
  if (f.efectivo === null) return `Sin factor: ${f.anio} de verano no se corrigió y no podrás cerrar.`;
  const quien = f.origen === "aplicado" ? "escrito por Javier" : "calculado (relativo)";
  const calc = f.origen === "aplicado" && f.ratio_calculado !== null && !mismoFactor(f.efectivo, f.ratio_calculado) ? ` · calculado hoy ${formatearFactorNino(f.ratio_calculado)}` : "";
  const banda = bandas.find((b) => b.anio === f.anio && b.temporada === f.temporada);
  const futuros = banda && k !== null ? banda.meses.filter((m) => m > k) : [];
  const proyeccion = futuros.length > 0 ? ` · ${rangoDeMeses(futuros)} de ${f.anio} se proyecta ×${formatearFactorNino(f.efectivo)} (supone que el Niño sigue hasta ${nombreMesLargo(Math.max(...futuros))})` : "";
  return `Factor ${formatearFactorNino(f.efectivo)} ${quien}${calc}${proyeccion}`;
}

export type MesDiagnostico = { m: number; en_periodo: boolean; u: number; u_ref: number; ratio: number | null; control: number | null; relativo?: number | null };

/** Filas de la tabla de diagnóstico: el relativo se calcula (`ratio ÷ red`) si el contrato no lo trae. */
export function filasDiagnostico(meses: readonly MesDiagnostico[]): (MesDiagnostico & { relativo: number | null })[] {
  return [...meses]
    .sort((a, b) => a.m - b.m)
    .map((x) => ({ ...x, relativo: x.relativo ?? (x.ratio !== null && x.control !== null && x.control > 0 ? x.ratio / x.control : null) }));
}

export type ResumenDiagnostico = {
  /** «Setiembre: ×1.90 frente a 2025; su tendencia ene–ago ×1.20; la red ×0.95 → crece ×1.58 sobre su tendencia y ×2.00 sobre la red.» */
  linea: string | null;
  /** «1 solo mes del periodo, y es el de inicio de temporada: dato frágil.» / «Sin datos del periodo todavía.» */
  aviso: string | null;
  excesoPropio: number | null;
  excesoRed: number | null;
};

const veces = (n: number | null): string => (n === null ? "—" : `×${formatearDecimal(n, 2)}`);

/**
 * «Cómo crece … atípicamente» (decisión 2, 06e §5.2). Lo calcula con lo que el contrato trae: `rho`/`kappa` del factor (o, para el verano
 * del GM, de los meses del periodo), la tendencia propia fuera del periodo y los dos excesos (contra su tendencia y contra la red).
 * El sistema solo informa: nunca propone ni escribe el factor.
 */
export function resumenDiagnostico(o: {
  meses: readonly MesDiagnostico[];
  anioRef: number;
  ratioFuera: number | null;
  rho?: number | null;
  kappa?: number | null;
  excesoPropio?: number | null;
  excesoRed?: number | null;
  /** Primer mes (1 a 12) del periodo atípico de la temporada, para decir «es el de inicio de temporada». */
  mesInicio?: number | null;
}): ResumenDiagnostico {
  const periodo = o.meses.filter((m) => m.en_periodo && m.ratio !== null);
  if (periodo.length === 0) return { linea: null, aviso: "Sin datos del periodo todavía.", excesoPropio: null, excesoRed: null };
  const sumaU = periodo.reduce((a, m) => a + m.u, 0);
  const sumaRef = periodo.reduce((a, m) => a + m.u_ref, 0);
  const rho = o.rho ?? (sumaRef > 0 ? sumaU / sumaRef : null);
  const controles = periodo.map((m) => m.control).filter((c): c is number => c !== null);
  const kappa = o.kappa ?? (controles.length > 0 ? controles.reduce((a, b) => a + b, 0) / controles.length : null);
  const excesoPropio = o.excesoPropio ?? (rho !== null && o.ratioFuera !== null && o.ratioFuera > 0 ? rho / o.ratioFuera : null);
  const excesoRed = o.excesoRed ?? (rho !== null && kappa !== null && kappa > 0 ? rho / kappa : null);
  const fuera = o.meses.filter((m) => !m.en_periodo && m.ratio !== null).map((m) => m.m);
  const nombres = periodo.length === 1 ? nombreMesLargo(periodo[0].m) : rangoDeMeses(periodo.map((m) => m.m));
  const inicio = nombres.charAt(0).toUpperCase() + nombres.slice(1);
  const tendencia = o.ratioFuera !== null && fuera.length > 0 ? `; su tendencia ${rangoDeMeses(fuera)} ${veces(o.ratioFuera)}` : "; no hay meses fuera del periodo para medir su tendencia";
  const crece = excesoPropio !== null ? `crece ${veces(excesoPropio)} sobre su tendencia y ${veces(excesoRed)} sobre la red` : `crece ${veces(excesoRed)} sobre la red`;
  const linea = `${inicio}: ${veces(rho)} frente a ${o.anioRef}${tendencia}; la red ${veces(kappa)} → ${crece}.`;
  const aviso =
    periodo.length === 1
      ? `1 solo mes del periodo${o.mesInicio !== null && o.mesInicio !== undefined && periodo[0].m === o.mesInicio ? ", y es el de inicio de temporada" : ""}: dato frágil.`
      : null;
  return { linea, aviso, excesoPropio, excesoRed };
}

/** El diagnóstico de la temporada (de `factores_y`) listo para mostrar. */
export function resumenDiagnosticoFactor(f: FactorYApi, bandas: readonly Pick<BandaNinoApi, "anio" | "temporada" | "meses">[]): { meses: ReturnType<typeof filasDiagnostico>; resumen: ResumenDiagnostico } | null {
  if (!f.diagnostico) return null;
  const banda = bandas.find((b) => b.anio === f.anio && b.temporada === f.temporada);
  const inicio = banda && banda.meses.length > 0 ? banda.meses[0] : null;
  return {
    meses: filasDiagnostico(f.diagnostico.meses),
    resumen: resumenDiagnostico({ meses: f.diagnostico.meses, anioRef: f.anio - 1, ratioFuera: f.diagnostico.ratio_fuera, rho: f.ratio_volumen, kappa: f.ratio_control, mesInicio: inicio }),
  };
}

/** El diagnóstico de verano solo con las agrupaciones de verano del GM (informativo), listo para mostrar. */
export function resumenDiagnosticoGM(dv: DiagnosticoVeranoGMApi | undefined, anioY: number, bandas: readonly Pick<BandaNinoApi, "anio" | "temporada" | "meses">[]): { meses: ReturnType<typeof filasDiagnostico>; resumen: ResumenDiagnostico } | null {
  if (!dv) return null;
  const banda = bandas.find((b) => b.anio === anioY && b.temporada === "verano");
  const inicio = banda && banda.meses.length > 0 ? banda.meses[0] : null;
  return {
    meses: filasDiagnostico(dv.meses),
    resumen: resumenDiagnostico({ meses: dv.meses, anioRef: anioY - 1, ratioFuera: dv.ratio_fuera, excesoPropio: dv.exceso_propio, excesoRed: dv.exceso_red, mesInicio: inicio }),
  };
}

// ─── Detalle: cómo crece ───

export function textoTiendaMayor(r: Pick<ReferenciaApi, "tienda_mayor" | "anio">): string | null {
  const t = r.tienda_mayor;
  if (!t) return null;
  const sin = t.pct_sin_ella === null ? "sin ella no quedan tiendas" : `sin ella, ${formatearPctSigno(t.pct_sin_ella)}`;
  return `${t.codigo} aporta el ${formatearDecimal(t.aporte_pct, 1)} % de ${r.anio - 1}; ${sin}`;
}

/** «ene–set es el 71 % del año 2025»; solo en Acumulado. */
export function textoCobertura(r: Pick<ReferenciaApi, "tipo" | "cobertura_pct" | "anio">, k: number | null): string | null {
  if (r.tipo !== "acumulado" || r.cobertura_pct === null) return null;
  return `${k ? rangoMeses(k) : "El acumulado"} es el ${formatearDecimal(r.cobertura_pct, 0)} % del año ${r.anio - 1}`;
}

/** Una referencia sin ninguna cifra utilizable: se muestra su motivo en vez de números. */
export function referenciaSinCifras(r: Pick<ReferenciaApi, "pct_bruto" | "pct_sin_nino" | "equivalente">): boolean {
  return r.pct_bruto === null && r.pct_sin_nino === null && (r.equivalente.corregido ?? null) === null && r.equivalente.bruto === null;
}

/** Temporadas del Niño que afectaron al año `anio` (para el aviso «fue Niño en invierno»). */
export function temporadasNino(bandas: readonly Pick<BandaNinoApi, "anio" | "temporada">[], anio: number): string[] {
  return [...new Set(bandas.filter((b) => b.anio === anio).map((b) => b.temporada))];
}

/**
 * «2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido (58 750 u en las mismas tiendas, +8.8 % frente a 2025)».
 * Sin cierre por curva calculable, sin la parte entre paréntesis.
 */
export function textoAvisoNino(anio: number, temporadas: readonly string[], cierre: Pick<CierreGMApi, "cierre_corregido" | "pct_corregido"> | null | undefined): string {
  const cuando = temporadas.length === 0 ? "" : ` en ${temporadas.join(" y ")}`;
  const cifras =
    cierre && cierre.cierre_corregido !== null && cierre.pct_corregido !== null
      ? ` (${formatearUds(cierre.cierre_corregido)} u en las mismas tiendas, ${formatearPctSigno(cierre.pct_corregido)} frente a ${anio - 1})`
      : "";
  return `${anio} fue Niño${cuando}: el % de ${anio + 1} se escribe sobre ${anio} corregido${cifras}.`;
}

/** Aviso de verano (ejemplo C): con la base corregida por debajo de la real, 2026 vendió de más por el Niño. */
export function textoVendioDeMas(anio: number, correccionPct: number | null): string | null {
  if (correccionPct === null || !Number.isFinite(correccionPct) || correccionPct >= -UMBRAL_CORRECCION_NINO * 100) return null;
  return `${anio} vendió de más por el Niño en alguna temporada: la base corregida (${formatearPctSigno(correccionPct)}) queda por debajo de la real.`;
}

/** El año al que se aplica el crecimiento (`Y + 1`). */
export function anioAplicacionDe(d: Pick<DetalleGeneroMundoApi, "acumulado">): number {
  return d.acumulado.anio + 1;
}

/** Las referencias que se muestran y se eligen: sin la heredada «Cierre proyectado»; Cierre por curva, Acumulado, Año completo (más reciente primero), Aplicado hoy. */
export function referenciasVisibles(referencias: readonly ReferenciaApi[]): ReferenciaApi[] {
  const orden: Record<string, number> = { cierre_curva: 0, acumulado: 1, anio_completo: 2, aplicado_hoy: 3 };
  return referencias
    .filter((r) => r.tipo !== "cierre_proyectado")
    .sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9) || b.anio - a.anio);
}

// ─── Aprobar ───

export const NINGUNA = "ninguna";

export type OpcionBase = {
  id: string;
  tipo: TipoReferencia;
  anio: number | null;
  variante: VarianteAprobable;
  etiqueta: string;
  /** El % que se escribiría sobre 2026 corregido (variante `corregido`) o el % real de la referencia (variante `bruto`); `null` = no calculable. */
  valor: number | null;
  /** Por qué no se puede elegir (si `valor` es `null`). */
  motivo: string | null;
  /** El año `Z` que mide la referencia (para decidir si toca un año Niño). */
  anioReferencia: number;
};

export function idOpcionBase(tipo: TipoReferencia, anio: number | null, variante: VarianteBase): string {
  return `${tipo}|${tipo === "anio_completo" ? (anio ?? "") : ""}|${variante}`;
}

const NOMBRE_VARIANTE: Record<VarianteBase, string> = { corregido: "corregido", bruto: "real", sin_nino_mas_rebote: "sin Niño + rebote" };

export function nombreVariante(v: VarianteBase): string {
  return NOMBRE_VARIANTE[v];
}

/** El valor de una referencia en una variante: `corregido` es el equivalente sobre 2026 corregido y `bruto` el % real. */
export function equivalenteDe(r: Pick<ReferenciaApi, "equivalente">, variante: VarianteAprobable): number | null {
  return variante === "corregido" ? (r.equivalente.corregido ?? null) : r.equivalente.bruto;
}

/** Las bases elegibles: cada referencia en sus dos variantes («corregido» primero). Las que no se pueden calcular salen deshabilitadas con su motivo. */
export function opcionesDeBase(referencias: readonly ReferenciaApi[]): OpcionBase[] {
  const salida: OpcionBase[] = [];
  for (const r of referenciasVisibles(referencias)) {
    for (const variante of ["corregido", "bruto"] as const) {
      const valor = equivalenteDe(r, variante);
      const motivo = valor !== null ? null : (textoMotivoNulo(r.motivo_nulo) ?? "no se puede calcular");
      const anio = r.tipo === "anio_completo" ? r.anio : null;
      salida.push({
        id: idOpcionBase(r.tipo, anio, variante),
        tipo: r.tipo,
        anio,
        variante,
        etiqueta: `${r.etiqueta} · ${NOMBRE_VARIANTE[variante]}`,
        valor,
        motivo,
        anioReferencia: r.anio,
      });
    }
  }
  return salida;
}

/**
 * La base con que se abre el formulario (D11): «Cierre por curva · corregido»; con avance bajo (M2), «Año completo del año anterior ·
 * corregido». Si esa no se puede calcular, la primera corregida que sí; si ninguna, la primera real; si ninguna, `NINGUNA`.
 */
export function baseInicial(referencias: readonly ReferenciaApi[], avanceBajo = false): string {
  const opciones = opcionesDeBase(referencias);
  const visibles = referenciasVisibles(referencias);
  const completos = visibles.filter((r) => r.tipo === "anio_completo");
  const anioCompleto = completos.length > 0 ? completos[0] : null; // el más reciente
  const preferidas: string[] = [];
  const curva = visibles.find((r) => r.tipo === "cierre_curva");
  const idCurva = curva ? idOpcionBase("cierre_curva", null, "corregido") : null;
  const idCompleto = anioCompleto ? idOpcionBase("anio_completo", anioCompleto.anio, "corregido") : null;
  if (avanceBajo) preferidas.push(...[idCompleto, idCurva].filter((v): v is string => v !== null));
  else preferidas.push(...[idCurva, idCompleto].filter((v): v is string => v !== null));
  for (const id of preferidas) if (opciones.find((o) => o.id === id)?.valor != null) return id;
  return opciones.find((o) => o.variante === "corregido" && o.valor !== null)?.id ?? opciones.find((o) => o.valor !== null)?.id ?? NINGUNA;
}

/** El % que precarga una base: su equivalente redondeado a 2 decimales (dos decimales conservan el total del GM al reaprobar). */
export function precargaDeBase(valor: number | null): number | null {
  return valor === null || !Number.isFinite(valor) ? null : Math.round(valor * 100) / 100;
}

/** Texto de un % para el campo (`8` → `8.00`, `7.66` → `7.66`; con punto, sin miles). */
export function pctATexto(pct: number | null): string {
  return pct === null ? "" : pct.toFixed(2);
}

/** Lee el campo: acepta coma o punto decimal. `null` si está vacío o no es un número. */
export function leerPct(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (t === "" || !/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Error del campo % (o `null` si está bien). Mismo rango que el servidor: −95 a 500. */
export function errorPct(texto: string): string | null {
  if (texto.trim() === "") return "Escribe el crecimiento (%).";
  const n = leerPct(texto);
  if (n === null) return "El crecimiento debe ser un número (por ejemplo 8 o 8,25).";
  if (n < -95) return "El crecimiento no puede ser menor que −95 %.";
  if (n > 500) return "El crecimiento no puede ser mayor que 500 %.";
  return null;
}

/** El % con que se abre el formulario (el de `baseInicial`), en texto del campo. */
export function pctInicialTexto(d: Pick<DetalleGeneroMundoApi, "referencias" | "cierre">): string {
  const opciones = opcionesDeBase(d.referencias);
  const id = baseInicial(d.referencias, d.cierre?.avance_bajo ?? false);
  return pctATexto(precargaDeBase(opciones.find((o) => o.id === id)?.valor ?? null));
}

/** Umbral de la regla R-N: una diferencia mayor a este número de puntos exige nota. */
export const UMBRAL_NOTA_PP = 0.5;

/** ¿La referencia mide un año con Niño del GM? (R-N del caso `bruto`.) */
export function periodoTocaNino(anioReferencia: number, bandas: readonly Pick<BandaNinoApi, "anio">[]): boolean {
  return bandas.some((b) => b.anio === anioReferencia);
}

/** Por qué la nota es obligatoria ahora (R-N, 06e R12) o `null` si es opcional. */
export function motivoNotaObligatoria(o: {
  pct: number | null;
  tipoBase: TipoReferencia | typeof NINGUNA;
  valorBase: number | null;
  variante?: VarianteAprobable;
  hayNino?: boolean;
  periodoTocaNino?: boolean;
}): string | null {
  if (o.tipoBase === NINGUNA) return "No elegiste una base: explica de dónde sale el %.";
  if (o.valorBase === null) return "La base elegida no se pudo calcular: explica de dónde sale el %.";
  if (o.variante === "bruto" && o.hayNino && o.periodoTocaNino)
    return "Elegiste la variante «real» de un periodo con Niño en un género × mundo con Niño: ese % no descuenta el Niño. Explica por qué.";
  if (o.pct === null) return null;
  const dif = Math.round(Math.abs(o.pct - o.valorBase) * 100) / 100;
  if (dif > UMBRAL_NOTA_PP) return `Tu % se aparta ${formatearDecimal(dif, 1)} puntos de la base (más de ${formatearDecimal(UMBRAL_NOTA_PP, 1)}): explica por qué.`;
  return null;
}

export function proximaVersion(versiones: readonly Pick<VersionCrecimientoApi, "version">[]): number {
  return versiones.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

export type ResumenAprobacion = {
  base: BaseGM | null;
  /** `round(B' × (1 + g))`. */
  resultado: number | null;
  /** El % visto sobre 2026 real. */
  equivalenteReal: number | null;
};

export function resumenAprobacion(f: Pick<FilaGMApi, "base_siguiente" | "base_corregida" | "cierre">, pct: number | null): ResumenAprobacion {
  const base = baseSiguienteGM(f);
  return { base, resultado: resultadoSobreCorregida(pct, base), equivalenteReal: equivalenteSobreReal(pct, base) };
}

/**
 * La frase en vivo junto al campo: «= +15.36 % sobre 2026 real · base 2027 (tiendas de 2027): 56 100 real / 59 925 corregida →
 * 64 719 u». Sin proyección de referencia de método 5 dice «estimado por curva». Sin Niño material, real = corregida.
 */
export function textoEquivalenteVivo(o: { anioY: number; anio: number; pct: number | null; resumen: ResumenAprobacion; hayNino: boolean }): string {
  const { base, resultado, equivalenteReal } = o.resumen;
  if (o.pct === null) return "Escribe el % para ver su equivalente sobre la venta real.";
  if (!base || resultado === null || equivalenteReal === null) return `Sin base ${o.anio} calculable (falta el cierre por curva o la proyección): no se puede mostrar el equivalente sobre ${o.anioY} real.`;
  const origen = base.origen === "curva" ? " · estimado por curva" : "";
  const cifras = o.hayNino
    ? `base ${o.anio} (tiendas de ${o.anio}): ${formatearUds(base.real)} real / ${formatearUds(base.corregida)} corregida → ${formatearUds(resultado)} u`
    : `base ${o.anio} (tiendas de ${o.anio}, sin Niño material): ${formatearUds(base.corregida)} u → ${formatearUds(resultado)} u`;
  return `= ${formatearPctSigno(equivalenteReal, 2)} sobre ${o.anioY} real · ${cifras}${origen}`;
}

/** El cuerpo del `POST /api/curvas/genero-mundo/[clave]` (§3): lo que el servidor valida con `aprobarCrecimientoSchemaEstricto`. */
export function cuerpoAprobar(o: {
  anio: number;
  pct: number;
  nota: string;
  base: OpcionBase | null;
  proyeccionId: string | null;
  huella: string;
  versionVigente: number | null;
}): AprobarCrecimientoValidado {
  const nota = o.nota.trim();
  return {
    anio: o.anio,
    pct: Math.round(o.pct * 100) / 100,
    nota: nota === "" ? null : nota,
    base: o.base ? { tipo: o.base.tipo, anio: o.base.anio, variante: o.base.variante } : { tipo: "ninguna", anio: null, variante: "corregido" },
    proyeccion_referencia_id: o.proyeccionId,
    huella_datos: o.huella,
    version_vigente: o.versionVigente,
  };
}

export type EntradaConfirmarGM = {
  titulo: string;
  anio: number;
  version: number;
  pct: number;
  base: OpcionBase | null;
  vigente: Pick<VersionCrecimientoApi, "version" | "pct" | "sobre_base"> | null;
  /** Proyecciones en trabajo de `anio − 1` que quedarán desactualizadas; `null` si no se conocen. */
  desactualizadas: { id: string; nombre: string }[] | null;
  /** Las dos bases en unidades y el % sobre real (06e: el `confirm` repite los dos %). */
  resumen?: ResumenAprobacion;
  hayNino?: boolean;
};

function textoDesactualizadas(anio: number, d: { nombre: string }[] | null): string {
  if (d === null) return `Las proyecciones en trabajo de ${anio - 1} quedarán desactualizadas hasta que las recalcules.`;
  if (d.length === 0) return `No hay proyecciones en trabajo de ${anio - 1} que queden desactualizadas.`;
  return `${d.length === 1 ? "1 proyección en trabajo quedará desactualizada" : `${d.length} proyecciones en trabajo quedarán desactualizadas`} y habrá que recalcularla${d.length === 1 ? "" : "s"}: ${d.map((p) => p.nombre).join(", ")}.`;
}

/** El texto del `confirm` del botón «Aprobar vN»: repite los dos % (corregido y real), las bases, la diferencia y qué proyecciones quedan desactualizadas. */
export function textoConfirmarGM(e: EntradaConfirmarGM): string {
  const y = e.anio - 1;
  const lineas = [`¿Aprobar la v${e.version} de ${e.titulo} para ${e.anio}?`];
  const real = e.resumen?.equivalenteReal ?? null;
  lineas.push(`Crecimiento: ${formatearPctPlano(e.pct, 2)} sobre ${y} corregido${real !== null ? ` = ${formatearPctSigno(real, 2)} sobre ${y} real` : ""}.`);
  const b = e.resumen?.base ?? null;
  if (b && e.resumen && e.resumen.resultado !== null)
    lineas.push(
      e.hayNino === false
        ? `Base ${e.anio} (tiendas de ${e.anio}${b.origen === "curva" ? ", estimada por curva" : ""}): ${formatearUds(b.corregida)} u → ${formatearUds(e.resumen.resultado)} u.`
        : `Base ${e.anio} (tiendas de ${e.anio}${b.origen === "curva" ? ", estimada por curva" : ""}): ${formatearUds(b.real)} u real / ${formatearUds(b.corregida)} u corregida → ${formatearUds(e.resumen.resultado)} u.`
    );
  if (!e.base || e.base.valor === null) lineas.push("Base: ninguna (escribiste el % sin apoyarte en una referencia).");
  else lineas.push(`Base elegida: ${e.base.etiqueta} (${formatearPctSigno(e.base.valor)}). Diferencia: ${formatearDifPp(e.pct - e.base.valor)}.`);
  if (e.vigente)
    lineas.push(`Reemplaza a la v${e.vigente.version} (${formatearPctPlano(e.vigente.pct, 2)} ${sobreBaseDe(e.vigente) === "corregida" ? `sobre ${y} corregido` : `sobre ${y} real, antes de 0.14.0`}); la anterior queda en el historial.`);
  lineas.push(textoDesactualizadas(e.anio, e.desactualizadas));
  return lineas.join("\n");
}

// ─── Reaprobar (I3) ───

/** El texto de la alerta de reaprobar: «v1 (15.00 % sobre 2026 real) se aprobó antes de 0.14.0. Hoy equivale a 7.66 % sobre 2026 corregido. …». */
export function textoAlertaReaprobar(v: Pick<VersionCrecimientoApi, "version" | "pct">, r: ReaprobarApi | undefined, anioY: number, factores: readonly Pick<FactorYApi, "anio" | "temporada" | "efectivo">[] = []): string {
  const inicio = `v${v.version} (${formatearPctPlano(v.pct, 2)} sobre ${anioY} real) se aprobó antes de 0.14.0.`;
  if (!r) return `${inicio} Este género × mundo tuvo Niño en ${anioY}: hay que reaprobarlo sobre ${anioY} corregido. Para medir el equivalente y el efecto, recalcula la proyección con 0.14.0.`;
  return `${inicio} Hoy equivale a ${formatearPctPlano(r.pct_equivalente, 2)} sobre ${anioY} corregido. Reaprobar conserva el total del GM y redistribuye ${textoRedistribucion(factores, anioY)}.`;
}

/** Hacia dónde se mueven las unidades al reaprobar: las temporadas con factor menor que 1 suben y las de factor mayor que 1 bajan. */
export function textoRedistribucion(factores: readonly Pick<FactorYApi, "anio" | "temporada" | "efectivo">[], anioY: number): string {
  const suben = [...new Set(factores.filter((f) => f.anio === anioY && f.efectivo !== null && f.efectivo < 1).map((f) => f.temporada))];
  const bajan = [...new Set(factores.filter((f) => f.anio === anioY && f.efectivo !== null && f.efectivo > 1).map((f) => f.temporada))];
  if (suben.length > 0 && bajan.length === 0) return `entre sus líneas: suben las de ${suben.join(" y ")} y bajan las demás`;
  if (bajan.length > 0 && suben.length === 0) return `entre sus líneas: bajan las de ${bajan.join(" y ")} y suben las demás`;
  return "entre sus líneas";
}

/** El `confirm` de «Reaprobar»: «2027 de HOMBRE · URBANO: 64 515 → 64 515 u. Cambian 2 filas (1 sube, 1 baja; 2 995 u se mueven). …». */
export function textoConfirmarReaprobar(o: { titulo: string; anio: number; version: number; r: NonNullable<ReaprobarApi> }): string {
  const { r } = o;
  const filas = r.filas_suben + r.filas_bajan;
  const decididas = r.decididas_con_propuesta_cambio;
  return [
    `¿Reaprobar la v${o.version} de ${o.titulo} con ${formatearPctPlano(r.pct_equivalente, 2)} sobre ${o.anio - 1} corregido?`,
    `${o.anio} de ${o.titulo}: ${formatearUds(r.total_antes)} → ${formatearUds(r.total_despues)} u.`,
    `Cambian ${filas} ${filas === 1 ? "fila" : "filas"} (${r.filas_suben} ${r.filas_suben === 1 ? "sube" : "suben"}, ${r.filas_bajan} ${r.filas_bajan === 1 ? "baja" : "bajan"}; ${formatearUds(r.unidades_movidas)} u se mueven).`,
    `${decididas} ${decididas === 1 ? "fila decidida quedará" : "filas decididas quedarán"} con “propuesta cambió”. Después recalcula la proyección.`,
  ].join("\n");
}

export type ErrorAprobarGM = { mensaje: string; recargar: boolean };

/** Mensaje claro de cada `409`/`400` del `POST`; `recargar` = hay que releer el detalle (los datos o la vigente cambiaron). */
export function errorDeAprobarGM(codigo: string | null, mensajeServidor: string, vigente: Pick<VersionCrecimientoApi, "version"> | null): ErrorAprobarGM {
  switch (codigo) {
    case "datos_cambiados":
      return { mensaje: `${mensajeServidor} Se volvió a cargar el detalle con los datos nuevos: revisa las cifras y vuelve a aprobar.`, recargar: true };
    case "vigente_cambiada":
      return { mensaje: `${mensajeServidor} Se volvió a cargar el detalle con la versión vigente actual.`, recargar: true };
    case "sin_cambio":
      return { mensaje: vigente ? `Es igual a la v${vigente.version}: no se crea otra versión.` : mensajeServidor, recargar: false };
    case "nota_requerida":
    case "base_retirada":
    case "anio_siguiente_atipico":
      return { mensaje: mensajeServidor, recargar: false };
    default:
      return { mensaje: mensajeServidor, recargar: false };
  }
}

/** «Aprobado. Recalcula la proyección y sigue en Por línea.» (06e §4.1 punto 5), con las proyecciones que quedaron desactualizadas. */
export function textoAprobadoOk(titulo: string, v: Pick<VersionCrecimientoApi, "version" | "pct">, anio: number, desactualizadas: readonly { nombre: string }[]): string {
  const base = `${titulo}: aprobada la v${v.version} (${formatearPctPlano(v.pct, 2)} sobre ${anio - 1} corregido) para ${anio}.`;
  const desact =
    desactualizadas.length === 0
      ? ""
      : ` Quedaron desactualizadas ${desactualizadas.length === 1 ? "la proyección" : "las proyecciones"} ${desactualizadas.map((p) => p.nombre).join(", ")}.`;
  return `${base}${desact} Recalcula la proyección y sigue en Por línea.`;
}

// ─── Versiones ───

export const ESTADO_VERSION_GM = {
  vigente: { texto: "vigente", tono: "exito" },
  reemplazada: { texto: "reemplazada", tono: "neutro" },
  retirada: { texto: "retirada", tono: "alerta" },
} as const;

/** La base de una versión en una línea: «Cierre por curva · corregido · +8.8 %» (las heredadas conservan su nombre). */
export function textoBaseVersion(b: VersionCrecimientoApi["base"]): string {
  if (b.tipo === "ninguna") return "sin base";
  const nombre = ETIQUETA_TIPO_REFERENCIA[b.tipo];
  const anio = b.tipo === "anio_completo" && b.anio !== null ? ` ${b.anio}` : "";
  return `${nombre}${anio} · ${NOMBRE_VARIANTE[b.variante]} · ${b.valor === null ? "sin valor" : formatearPctSigno(b.valor)}`;
}

const ETIQUETA_FOTO: Record<string, string> = {
  metodo: "Método de la proyección",
  sobre_base: "El % es sobre",
  k: "Último mes real (k)",
  base_siguiente: "Base real (Σ B)",
  base_corregida: "Base corregida (Σ B')",
  correccion_nino_pct: "Corrección del Niño (%)",
  equivalente_real: "Equivale sobre real (%)",
};

/** Claves de la foto que se muestran con su propio formato (o no se muestran por ser listas largas). */
const CLAVES_FOTO_ESPECIALES = new Set(["cierre_por_agrupacion", "factores", "serie_corregida", "tiendas_cy", "tiendas_m", "cierre"]);

function textoFoto(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatearDecimal(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length <= 8 ? v.map(textoFoto).join(", ") : `${v.length} elementos`;
  return JSON.stringify(v);
}

function num(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Foto de una versión (`referencia` del servidor, si la manda) como pares «etiqueta, valor» legibles; objetos anidados se aplanan.
 * Con la foto de 0.14.0 muestra además el cierre por agrupación (una línea por agrupación), los factores con su origen y los totales
 * del cierre; ni las listas de tiendas ni la serie corregida se vuelcan enteras.
 */
export function lineasDeFoto(referencia: unknown): { clave: string; valor: string }[] {
  const salida: { clave: string; valor: string }[] = [];
  const recorrer = (v: unknown, prefijo: string, nivel: number) => {
    if (v && typeof v === "object" && !Array.isArray(v) && nivel < 2) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (nivel === 0 && CLAVES_FOTO_ESPECIALES.has(k)) continue;
        const etiqueta = nivel === 0 ? (ETIQUETA_FOTO[k] ?? k) : k;
        recorrer(x, prefijo ? `${prefijo} · ${etiqueta}` : etiqueta, nivel + 1);
      }
      return;
    }
    salida.push({ clave: prefijo, valor: textoFoto(v) });
  };
  if (!referencia || typeof referencia !== "object") return salida;
  recorrer(referencia, "", 0);
  const r = referencia as Record<string, unknown>;

  const cierre = r.cierre;
  if (cierre && typeof cierre === "object" && !Array.isArray(cierre)) {
    const c = cierre as Record<string, unknown>;
    const partes = [
      num(c, "cierre") !== null ? `cierre ${formatearUds(num(c, "cierre"))} u` : null,
      num(c, "cierre_corregido") !== null ? `corregido ${formatearUds(num(c, "cierre_corregido"))} u` : null,
      num(c, "pct") !== null ? `${formatearPctSigno(num(c, "pct"))} real` : null,
      num(c, "pct_corregido") !== null ? `${formatearPctSigno(num(c, "pct_corregido"))} corregido` : null,
    ].filter(Boolean);
    if (partes.length > 0) salida.push({ clave: "Cierre del año en curso (mismas tiendas)", valor: partes.join(" · ") });
  }
  if (Array.isArray(r.cierre_por_agrupacion)) {
    for (const item of r.cierre_por_agrupacion) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      const nombre = typeof a.nombre === "string" ? a.nombre : "agrupación";
      const curva = a.curva_id ? `curva v${typeof a.curva_version === "number" ? a.curva_version : (num((a.curva as Record<string, unknown>) ?? {}, "version") ?? "?")}` : "sin curva (compuesta)";
      const partes = [
        curva,
        num(a, "avance") !== null ? `avance ${formatearDecimal((num(a, "avance") as number) * 100, 0)} %` : null,
        `cierre ${formatearUds(num(a, "cierre"))} → corregido ${formatearUds(num(a, "cierre_corregido"))} u`,
        num(a, "base_curva") !== null ? `base ${formatearUds(num(a, "base_curva"))} → ${formatearUds(num(a, "base_curva_corregida"))} u` : null,
      ].filter(Boolean);
      salida.push({ clave: `Cierre · ${nombre}`, valor: partes.join(" · ") });
    }
  }
  if (Array.isArray(r.factores)) {
    for (const item of r.factores) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const origen = f.origen === "aplicado" ? "escrito por Javier" : f.origen === "calculado" ? "calculado" : "sin origen";
      const partes = [`${num(f, "efectivo") === null ? "sin factor" : formatearFactorNino(num(f, "efectivo"))} (${origen})`, f.formula ? `fórmula ${String(f.formula)}` : "fórmula anterior", f.parcial ? "parcial" : null].filter(Boolean);
      salida.push({ clave: `Factor · ${String(f.temporada ?? "?")} ${String(f.anio ?? "")}`.trim(), valor: partes.join(" · ") });
    }
  }
  if (Array.isArray(r.tiendas_cy)) salida.push({ clave: "Tiendas del %", valor: String(r.tiendas_cy.length) });
  if (Array.isArray(r.tiendas_m)) salida.push({ clave: "Tiendas de la base", valor: String(r.tiendas_m.length) });
  return salida;
}
