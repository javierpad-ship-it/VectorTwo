// Lógica pura de la pestaña «Crecimiento por género × mundo» (06d, §4.1): textos, formatos, filtros, series del
// gráfico, tabla año × mes, base y nota del formulario de aprobación, CSV y URL. Sin React ni acceso a la base de datos.
// Todos los % de la API son PORCENTAJES (15 = 15 %), salvo lo que se dice en cada función.

import type { AprobarCrecimientoValidado } from "@/lib/crecimientos/esquemas";
import { CLAVE_RESTO } from "@/lib/crecimientos/tipos-api";
import type {
  BandaNinoApi,
  DetalleGeneroMundoApi,
  FilaGMApi,
  ListaGeneroMundoApi,
  MotivoNuloReferencia,
  MotivoObsoleto,
  ProyeccionReferenciaApi,
  ReferenciaApi,
  SerieAnioGMApi,
  TipoReferencia,
  VarianteBase,
  VersionCrecimientoApi,
} from "@/lib/crecimientos/tipos-api";
import { formatearDecimal } from "@/lib/formato";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import { MESES_CORTOS, MESES_LARGOS, colorAnio, formatearUnidades, formatearVariacion } from "@/lib/reportes/histograma";

// ─── Formatos ───

/** `15.0 %`; `—` sin valor. */
export function formatearPctPlano(pct: number | null | undefined, decimales = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${formatearDecimal(pct, decimales)} %`;
}

/** `+3.0 %`, `-2.0 %`; `—` sin valor. */
export function formatearPctSigno(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return formatearVariacion(pct);
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

/** `0.66`; `—` sin valor. */
export function formatearFactorNino(f: number | null | undefined): string {
  return f === null || f === undefined || !Number.isFinite(f) ? "—" : formatearDecimal(f, 2);
}

/** `ene–set` para los primeros `k` meses. */
export function rangoMeses(k: number): string {
  if (k <= 1) return MESES_CORTOS[0].toLowerCase();
  return `${MESES_CORTOS[0].toLowerCase()}–${MESES_CORTOS[Math.min(11, k - 1)].toLowerCase()}`;
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

// ─── Textos fijos ───

export function textoFijoLista(anio: number): string {
  return `% bruto ${anio} frente a ${anio - 1} de las mismas tiendas de ${anio}, sin corregir por el Niño; todas las filas del GM crecen igual.`;
}

export const TEXTO_MOTIVO_NULO: Record<MotivoNuloReferencia, string> = {
  metodo_anterior: "recalcula la proyección (método anterior)",
  sin_base: "la proyección no tiene base para este año: recalcúlala",
  sin_referencia: "elige una proyección de referencia",
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
  factor_cambiado: "cambió el factor del Niño con que se calculó",
  metodo_anterior: "se aprobó sobre 2026 real, antes de 0.14.0",
};

export const ETIQUETA_TIPO_REFERENCIA: Record<TipoReferencia, string> = {
  acumulado: "Acumulado",
  cierre_curva: "Cierre por curva",
  cierre_proyectado: "Cierre proyectado",
  anio_completo: "Año completo",
  aplicado_hoy: "Aplicado hoy",
};

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

/** Proyecciones que se pueden elegir como referencia: solo método 4 o posterior (I1); la elegida actual siempre queda. */
export function referenciasElegibles(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles" | "proyeccion_referencia">): ListaGeneroMundoApi["proyecciones_disponibles"] {
  const actual = lista.proyeccion_referencia?.id ?? null;
  return lista.proyecciones_disponibles.filter((p) => (p.version_metodo ?? 0) >= 4 || p.id === actual);
}

/** ¿Hay una proyección de referencia calculada con el método actual? Si no, se avisa y las cifras de proyección salen «—». */
export function hayReferenciaValida(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles" | "proyeccion_referencia">): boolean {
  const r: ProyeccionReferenciaApi | null = lista.proyeccion_referencia;
  return r !== null && (r.version_metodo ?? 0) >= 4;
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
  return `No hay proyección de ${y} calculada con el método actual: recalcula la proyección para ver «Cierre proyectado», «Aplicado hoy» y la base ${anioAplicacion}.`;
}

export function etiquetaProyeccion(p: ProyeccionReferenciaApi & { estado?: string }): string {
  const estado = p.estado === "en_trabajo" ? "en trabajo" : p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : null;
  return [p.nombre, estado].filter(Boolean).join(" · ");
}

export function enTrabajoDe(lista: Pick<ListaGeneroMundoApi, "proyecciones_disponibles"> | null): { id: string; nombre: string }[] {
  return (lista?.proyecciones_disponibles ?? []).filter((p) => p.estado === "en_trabajo").map((p) => ({ id: p.id, nombre: p.nombre }));
}

function celdaPct(n: number | null): string | number {
  return n === null ? "" : n;
}

export function filasCsvLista(lista: ListaGeneroMundoApi, filas: readonly FilaGMApi[]): { campos: string[]; datos: (string | number)[][] } {
  const anio = lista.anio_aplicacion;
  const campos = [
    "Género",
    "Mundo",
    `Unidades ${anio - 2}`,
    "Acumulado % bruto",
    "Acumulado % sin Niño",
    "Acumulado extremo",
    "Aplicado hoy %",
    `Base ${anio}`,
    `Crecimiento ${anio} aprobado %`,
    "Versión",
    "Aprobado por",
    "Aprobado el",
    "Estado",
  ];
  const datos = [...filas, lista.resto].map((f): (string | number)[] => [
    f.clave === CLAVE_RESTO ? "RESTO" : (f.genero ?? ""),
    f.mundo ?? "",
    f.unidades_anterior === null ? "" : Math.round(f.unidades_anterior),
    celdaPct(f.acumulado.pct_bruto),
    celdaPct(f.acumulado.pct_sin_nino),
    f.acumulado.extremo ? "sí" : "no",
    celdaPct(f.aplicado_hoy.pct_bruto),
    f.base_siguiente === null ? "" : Math.round(f.base_siguiente),
    f.vigente ? f.vigente.pct : "",
    f.vigente ? f.vigente.version : "",
    f.vigente?.por_nombre ?? "",
    f.vigente?.aprobada_at ?? "",
    textoEstadoGM(f),
  ]);
  return { campos, datos };
}

// ─── Detalle: curva de venta ───

export type ModoGM = "unidades" | "forma" | "sin_nino";

export const MODOS_GM: { id: ModoGM; label: string }[] = [
  { id: "unidades", label: "Unidades" },
  { id: "forma", label: "Forma (%)" },
  { id: "sin_nino", label: "Sin Niño" },
];

/** Valores de un año según el modo, en la unidad del gráfico: unidades, o fracción (0 a 1) en Forma. */
export function valoresSerie(s: Pick<SerieAnioGMApi, "meses" | "meses_sin_nino" | "forma">, modo: ModoGM): (number | null)[] {
  if (modo === "forma") return s.forma.map((v) => (v === null ? null : v / 100));
  return modo === "sin_nino" ? s.meses_sin_nino : s.meses;
}

/** Parte la serie de un año en lo real (trazo continuo) y lo proyectado (discontinuo, unido al último mes real). */
export function dividirRealProyectado(
  valores: readonly (number | null)[],
  origen: readonly ("real" | "proyectado" | null)[]
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

/** Las series del gráfico: una línea por año (2026 en dos tramos: real continuo y proyectado discontinuo) y, en Forma, la forma típica. */
export function seriesDelGrafico(d: Pick<DetalleGeneroMundoApi, "series" | "forma_tipica">, modo: ModoGM): SerieGM[] {
  const salida: SerieGM[] = [];
  for (const s of [...d.series].sort((a, b) => a.anio - b.anio)) {
    const valores = valoresSerie(s, modo);
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
    salida.push({ clave: `${grupo}-proy`, grupo, anio: s.anio, etiqueta: `${s.anio} proyectado`, valores: proyectado, color, trazo: "discontinuo" });
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

export type FilaTablaGM = {
  anio: number;
  valores: (number | null)[];
  origen: ("real" | "proyectado" | null)[];
  /** Total del año en la unidad del modo; `null` en Forma (siempre 100 %). */
  total: number | null;
  incompleto: boolean;
  /** Variación del total frente al año anterior (%); `null` sin año anterior o en Forma. */
  variacion: number | null;
};

/** Variación % entre dos totales; `null` si el anterior no es positivo. */
export function variacionPct(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || !(anterior > 0)) return null;
  return (actual / anterior - 1) * 100;
}

export function filasTablaAnioMes(d: Pick<DetalleGeneroMundoApi, "series">, modo: ModoGM): FilaTablaGM[] {
  const ordenadas = [...d.series].sort((a, b) => a.anio - b.anio);
  const totalDe = (s: SerieAnioGMApi): number | null => (modo === "unidades" ? s.total : modo === "sin_nino" ? s.total_sin_nino : null);
  return ordenadas.map((s) => {
    const previo = ordenadas.find((p) => p.anio === s.anio - 1) ?? null;
    return {
      anio: s.anio,
      valores: modo === "forma" ? s.forma : valoresSerie(s, modo),
      origen: s.origen,
      total: totalDe(s),
      incompleto: s.incompleto,
      variacion: modo === "forma" || !previo ? null : variacionPct(totalDe(s), totalDe(previo)),
    };
  });
}

/** CSV de la curva: tres filas por año (unidades, sin Niño y forma %) con los doce meses y el total. */
export function filasCsvSeries(d: Pick<DetalleGeneroMundoApi, "series">): { campos: string[]; datos: (string | number)[][] } {
  const campos = ["Año", "Medida", ...MESES_CORTOS, "Total", "Meses proyectados"];
  const datos: (string | number)[][] = [];
  const cel = (n: number | null) => (n === null ? "" : n);
  for (const s of [...d.series].sort((a, b) => a.anio - b.anio)) {
    const proy = s.origen.filter((o) => o === "proyectado").length;
    datos.push([s.anio, "Unidades", ...s.meses.map(cel), s.total, proy]);
    datos.push([s.anio, "Unidades sin Niño", ...s.meses_sin_nino.map(cel), s.total_sin_nino, proy]);
    datos.push([s.anio, "Forma (% del año)", ...s.forma.map(cel), 100, proy]);
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
  return r.pct_bruto === null && r.pct_sin_nino === null && r.equivalente.bruto === null && r.equivalente.sin_nino_mas_rebote === null;
}

/** Temporadas del Niño que afectaron al año `anio` (para el aviso «fue Niño en invierno»). */
export function temporadasNino(bandas: readonly Pick<BandaNinoApi, "anio" | "temporada">[], anio: number): string[] {
  return [...new Set(bandas.filter((b) => b.anio === anio).map((b) => b.temporada))];
}

export function textoAvisoNino(anio: number, temporadas: readonly string[], rebote: number | null): string {
  const cuando = temporadas.length === 0 ? "" : ` en ${temporadas.join(" y ")}`;
  const reb = rebote === null ? "" : ` (rebote del Niño: ${formatearPctSigno(rebote)})`;
  return `${anio} fue Niño${cuando}: compara con las cifras sin Niño + rebote${reb}.`;
}

/** El año al que se aplica el crecimiento (`Y + 1`). */
export function anioAplicacionDe(d: Pick<DetalleGeneroMundoApi, "acumulado">): number {
  return d.acumulado.anio + 1;
}

// ─── Aprobar ───

export const NINGUNA = "ninguna";

export type OpcionBase = {
  id: string;
  tipo: TipoReferencia;
  anio: number | null;
  variante: VarianteBase;
  etiqueta: string;
  /** Equivalente bruto para `Y+1` de esa referencia y variante; `null` = no calculable. */
  valor: number | null;
  /** Por qué no se puede elegir (si `valor` es `null`). */
  motivo: string | null;
};

export function idOpcionBase(tipo: TipoReferencia, anio: number | null, variante: VarianteBase): string {
  return `${tipo}|${tipo === "anio_completo" ? (anio ?? "") : ""}|${variante}`;
}

const NOMBRE_VARIANTE: Record<VarianteBase, string> = { corregido: "corregido", bruto: "bruto", sin_nino_mas_rebote: "sin Niño + rebote" };

export function nombreVariante(v: VarianteBase): string {
  return NOMBRE_VARIANTE[v];
}

/** Las bases elegibles: cada referencia en sus dos variantes. Las que no se pueden calcular salen deshabilitadas con su motivo. */
export function opcionesDeBase(referencias: readonly ReferenciaApi[]): OpcionBase[] {
  const salida: OpcionBase[] = [];
  for (const r of referencias) {
    for (const variante of ["bruto", "sin_nino_mas_rebote"] as const) {
      const valor = r.equivalente[variante];
      const motivo =
        valor !== null
          ? null
          : variante === "sin_nino_mas_rebote" && r.equivalente.bruto !== null
            ? "sin proyección de referencia válida no hay rebote del Niño"
            : (textoMotivoNulo(r.motivo_nulo) ?? "no se puede calcular");
      const anio = r.tipo === "anio_completo" ? r.anio : null;
      salida.push({
        id: idOpcionBase(r.tipo, anio, variante),
        tipo: r.tipo,
        anio,
        variante,
        etiqueta: `${r.etiqueta} · ${NOMBRE_VARIANTE[variante]}`,
        valor,
        motivo,
      });
    }
  }
  return salida;
}

/** La base con que se abre el formulario: Acumulado en su variante por defecto si se puede calcular; si no, la primera que sí. */
export function baseInicial(referencias: readonly ReferenciaApi[]): string {
  const opciones = opcionesDeBase(referencias);
  const acumulado = referencias.find((r) => r.tipo === "acumulado");
  if (acumulado) {
    const id = idOpcionBase("acumulado", null, acumulado.variante_defecto);
    if (opciones.find((o) => o.id === id)?.valor != null) return id;
  }
  return opciones.find((o) => o.valor !== null)?.id ?? NINGUNA;
}

/** El % que precarga una base: su equivalente redondeado a 1 decimal. */
export function precargaDeBase(valor: number | null): number | null {
  return valor === null || !Number.isFinite(valor) ? null : Math.round(valor * 10) / 10;
}

/** Texto de un % para el campo (`15` → `15`, `15.5` → `15.5`; con punto, sin miles). */
export function pctATexto(pct: number | null): string {
  return pct === null ? "" : String(pct);
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
  if (n === null) return "El crecimiento debe ser un número (por ejemplo 15 o 15,5).";
  if (n < -95) return "El crecimiento no puede ser menor que −95 %.";
  if (n > 500) return "El crecimiento no puede ser mayor que 500 %.";
  return null;
}

/** Umbral de la regla R-N: una diferencia mayor a este número de puntos exige nota. */
export const UMBRAL_NOTA_PP = 0.5;

/** Por qué la nota es obligatoria ahora (R-N, §5.2) o `null` si es opcional. */
export function motivoNotaObligatoria(o: { pct: number | null; tipoBase: TipoReferencia | typeof NINGUNA; valorBase: number | null }): string | null {
  if (o.tipoBase === NINGUNA) return "No elegiste una base: explica de dónde sale el %.";
  if (o.valorBase === null) return "La base elegida no se pudo calcular: explica de dónde sale el %.";
  if (o.pct === null) return null;
  const dif = Math.round(Math.abs(o.pct - o.valorBase) * 100) / 100;
  if (dif > UMBRAL_NOTA_PP) return `Tu % se aparta ${formatearDecimal(dif, 1)} puntos de la base (más de ${formatearDecimal(UMBRAL_NOTA_PP, 1)}): explica por qué.`;
  return null;
}

/** `(1 + pct) ÷ (1 + rebote) − 1`: el % bruto escrito visto sobre la base normalizada por el Niño. `null` sin rebote. */
export function equivalenteNormalizado(pct: number | null, rebote: number | null): number | null {
  if (pct === null || rebote === null || 1 + rebote / 100 <= 0) return null;
  return ((1 + pct / 100) / (1 + rebote / 100) - 1) * 100;
}

export function proximaVersion(versiones: readonly Pick<VersionCrecimientoApi, "version">[]): number {
  return versiones.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

/** El cuerpo del `POST /api/curvas/genero-mundo/[clave]` (§3): lo que el servidor valida con `aprobarCrecimientoSchema`. */
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
    pct: o.pct,
    nota: nota === "" ? null : nota,
    base: o.base ? { tipo: o.base.tipo, anio: o.base.anio, variante: o.base.variante } : { tipo: "ninguna", anio: null, variante: "bruto" },
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
  vigente: Pick<VersionCrecimientoApi, "version" | "pct"> | null;
  /** Proyecciones en trabajo de `anio − 1` que quedarán desactualizadas; `null` si no se conocen. */
  desactualizadas: { id: string; nombre: string }[] | null;
};

/** El texto del `confirm` del botón «Aprobar vN»: repite el %, la base, la diferencia y qué proyecciones quedan desactualizadas. */
export function textoConfirmarGM(e: EntradaConfirmarGM): string {
  const lineas = [`¿Aprobar la v${e.version} de ${e.titulo} para ${e.anio}?`, `Crecimiento bruto: ${formatearPctPlano(e.pct)} (mismas tiendas, sin corregir por el Niño).`];
  if (!e.base || e.base.valor === null) lineas.push("Base: ninguna (escribiste el % sin apoyarte en una referencia).");
  else lineas.push(`Base: ${e.base.etiqueta} (${formatearPctSigno(e.base.valor)}). Diferencia: ${formatearDifPp(e.pct - e.base.valor)}.`);
  if (e.vigente) lineas.push(`Reemplaza a la v${e.vigente.version} (${formatearPctPlano(e.vigente.pct)}); la anterior queda en el historial.`);
  if (e.desactualizadas === null) lineas.push(`Las proyecciones en trabajo de ${e.anio - 1} quedarán desactualizadas hasta que las recalcules.`);
  else if (e.desactualizadas.length === 0) lineas.push(`No hay proyecciones en trabajo de ${e.anio - 1} que queden desactualizadas.`);
  else
    lineas.push(
      `${e.desactualizadas.length === 1 ? "1 proyección en trabajo quedará desactualizada" : `${e.desactualizadas.length} proyecciones en trabajo quedarán desactualizadas`} y habrá que recalcularla${e.desactualizadas.length === 1 ? "" : "s"}: ${e.desactualizadas.map((p) => p.nombre).join(", ")}.`
    );
  return lineas.join("\n");
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
      return { mensaje: mensajeServidor, recargar: false };
    default:
      return { mensaje: mensajeServidor, recargar: false };
  }
}

export function textoAprobadoOk(titulo: string, v: Pick<VersionCrecimientoApi, "version" | "pct">, anio: number, desactualizadas: readonly { nombre: string }[]): string {
  const base = `${titulo}: aprobada la v${v.version} (${formatearPctPlano(v.pct)}) para ${anio}.`;
  if (desactualizadas.length === 0) return base;
  return `${base} Quedaron desactualizadas ${desactualizadas.length === 1 ? "la proyección" : "las proyecciones"} ${desactualizadas.map((p) => p.nombre).join(", ")}: recalcúlalas para que usen el nuevo crecimiento.`;
}

// ─── Versiones ───

export const ESTADO_VERSION_GM = {
  vigente: { texto: "vigente", tono: "exito" },
  reemplazada: { texto: "reemplazada", tono: "neutro" },
  retirada: { texto: "retirada", tono: "alerta" },
} as const;

/** La base de una versión en una línea: «Acumulado · sin Niño + rebote · 18.4 %». */
export function textoBaseVersion(b: VersionCrecimientoApi["base"]): string {
  if (b.tipo === "ninguna") return "sin base";
  const nombre = ETIQUETA_TIPO_REFERENCIA[b.tipo];
  const anio = b.tipo === "anio_completo" && b.anio !== null ? ` ${b.anio}` : "";
  return `${nombre}${anio} · ${NOMBRE_VARIANTE[b.variante]} · ${b.valor === null ? "sin valor" : formatearPctSigno(b.valor)}`;
}

/** Foto de una versión (`referencia` del servidor, si la manda) como pares «etiqueta, valor» legibles; objetos anidados se aplanan. */
export function lineasDeFoto(referencia: unknown): { clave: string; valor: string }[] {
  const salida: { clave: string; valor: string }[] = [];
  const texto = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return formatearDecimal(v, Number.isInteger(v) ? 0 : 2);
    if (typeof v === "boolean") return v ? "sí" : "no";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.length <= 8 ? v.map(texto).join(", ") : `${v.length} elementos`;
    return JSON.stringify(v);
  };
  const recorrer = (v: unknown, prefijo: string, nivel: number) => {
    if (v && typeof v === "object" && !Array.isArray(v) && nivel < 2) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) recorrer(x, prefijo ? `${prefijo} · ${k}` : k, nivel + 1);
      return;
    }
    salida.push({ clave: prefijo, valor: texto(v) });
  };
  if (referencia && typeof referencia === "object") recorrer(referencia, "", 0);
  return salida;
}
