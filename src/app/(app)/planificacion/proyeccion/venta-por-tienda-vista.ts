// Lógica de vista de «Ver por tienda» en la pestaña Crecimientos (ficha 07f, §5 y §7). Pura, sin React: la prueban vitest con datos sintéticos.
// El servidor (`GET …/crecimientos/por-tienda`) es el dueño de las cifras, de la clasificación de las tiendas y del reparto del vigente; aquí solo se arman las
// filas de la tabla (tiendas de la base, «sin atribuir», subtotales, tiendas de fuera y total), las variaciones de los subtotales (con la comparable cuando hay
// tiendas parciales), los textos, los motivos y la hoja de Excel. Nada de esto escribe ni recalcula una cifra del servidor.

import { formatearNumero } from "@/lib/formato";
import type { Hoja } from "@/lib/proyeccion/excel";
import type {
  CifraVentaApi,
  EstadoTiendaVenta,
  MotivoVariacion,
  PeriodoVentaApi,
  ProyeccionApi,
  ResumenCrecimientosProyeccionApi,
  TiendaVentaApi,
  TotalVentaApi,
  VentaPorTiendaApi,
} from "@/lib/proyeccion/tipos-api";
import { paresVariacion, periodoCompleto, variacionesDeCifras, type VariacionDePar, type VariacionVenta } from "@/lib/proyeccion/venta-por-tienda";
import { formatearPct, unidades } from "./vista";

// ─── Clave del conjunto (`?por_tienda=`) ───

const CLAVE_POR_TIENDA = /^(resto|[0-9A-Za-z-]{1,64}\.[0-9A-Za-z-]{1,64})$/;
/** `resto` o `<genero_id>.<mundo_id>`: lo único que se acepta de la URL. */
export const clavePorTiendaValida = (v: string | null): v is string => v !== null && CLAVE_POR_TIENDA.test(v);

export type OpcionPorTienda = { clave: string; nombre: string };

/** Los conjuntos que se pueden ver por tienda: cada GM de la tabla de Crecimientos y el Resto (el Total no). */
export function opcionesPorTienda(r: Pick<ResumenCrecimientosProyeccionApi, "filas">): OpcionPorTienda[] {
  return [...r.filas.map((f) => ({ clave: f.clave, nombre: [f.genero, f.mundo].filter(Boolean).join(" · ") || f.clave })), { clave: "resto", nombre: "Resto" }];
}

// ─── Textos ───

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const mesCorto = (mes: number): string => MESES[mes - 1] ?? String(mes);

/** `2026-09` (o `2026-09-01`) → `sep 2026`. */
export function mesAnioCorto(periodo: string): string {
  return `${mesCorto(Number(periodo.slice(5, 7)))} ${periodo.slice(0, 4)}`;
}

const soles = (n: number): string => `S/ ${formatearNumero(Math.round(n))}`;
const nUnidades = (n: number): string => `${unidades(n)} u`;

/** «Venta por tienda · MUJER · URBANO». */
export const tituloPorTienda = (nombre: string): string => `Venta por tienda · ${nombre}`;

/** «2023», «2025 ene–sep», «2026 ene–sep (real)». */
export function etiquetaPeriodo(p: Pick<PeriodoVentaApi, "clave" | "anio" | "hasta_mes">, anioEnCurso: number): string {
  if (!p.clave.endsWith("-ac")) return String(p.anio);
  return `${p.anio} ene–${mesCorto(p.hasta_mes)}${p.anio === anioEnCurso ? " (real)" : ""}`;
}

const etiquetaClave = (clave: string, v: Pick<VentaPorTiendaApi, "periodos" | "anio_en_curso">): string => {
  if (clave === "vigente") return `${v.anio_en_curso} cierre vigente`;
  const p = v.periodos.find((x) => x.clave === clave);
  return p ? etiquetaPeriodo(p, v.anio_en_curso) : clave;
};

/** «faltan: mar 2024» (hasta tres meses; el resto, «+N más»). `null` si no falta ninguno. */
export function textoFaltan(meses: readonly string[]): string | null {
  if (meses.length === 0) return null;
  const lista = meses.slice(0, 3).map(mesAnioCorto).join(", ");
  return `faltan: ${lista}${meses.length > 3 ? ` +${meses.length - 3} más` : ""}`;
}

/** La leyenda bajo la cabecera: «Soles netos de IGV. Sin CD. Datos hasta sep 2026». */
export const textoLeyendaPorTienda = (hastaPeriodo: string): string => `Soles netos de IGV. Sin CD. Datos hasta ${mesAnioCorto(hastaPeriodo)}.`;

export type Segmento = { texto: string; negrita?: boolean };

const dice = (segmentos: Segmento[]): string => segmentos.map((s) => s.texto).join("");
/** La cabecera como texto plano (la pantalla la dibuja con las partes en negrita). */
export const textoPlano = dice;

/**
 * La aclaración que pidió Javier (§5): qué es la base de `Y+1` y de qué tiendas sale. Con método anterior o sin filas base no hay base que explicar y lo dice.
 * La parte de la base corregida del Niño solo aparece si `Σ B' ≠ Σ B`.
 */
export function cabeceraPorTienda(v: VentaPorTiendaApi): Segmento[] {
  const s = v.anio_siguiente;
  const y = v.anio_en_curso;
  if (v.base.motivo_nulo === "metodo_anterior") {
    return [{ texto: `Recalcula la proyección para ver la base ${s}`, negrita: true }, { texto: ". Mientras tanto se muestra la venta real por tienda." }];
  }
  if (v.base.motivo_nulo === "sin_filas") {
    return [{ texto: v.conjunto.es_resto ? `El Resto no tiene filas base en ${s}` : `Este GM no tiene filas base en ${s}`, negrita: true }, { texto: ". Se muestra la venta real por tienda; no hay base que repartir." }];
  }
  const total = v.base.total ?? 0;
  const cuenta = v.base.tiendas === 1 ? "1 tienda" : `${v.base.tiendas} tiendas`;
  const proyectado = v.k >= 12 ? `real ene–dic` : `real ene–${mesCorto(v.k)} + proyectado ${mesCorto(v.k + 1)}–dic`;
  const segmentos: Segmento[] = [
    { texto: `Base ${s} = ${nUnidades(total)}`, negrita: true },
    { texto: `: unidades ${y} ` },
    { texto: "vigentes", negrita: true },
    { texto: ` (${proyectado}) de las ` },
    { texto: `mismas tiendas de ${s} (${cuenta}: abiertas los doce meses de ${y})`, negrita: true },
    { texto: `. Es la «Base ${y} (u)» real de la tabla de arriba.` },
  ];
  if (v.base.entran.length > 0) segmentos.push({ texto: ` ${v.base.entran.join(", ")} entra${v.base.entran.length === 1 ? "" : "n"} con su ${y} vigente exacto.` });
  if (v.base.corregida !== null && Math.round(v.base.corregida) !== Math.round(total)) {
    segmentos.push({ texto: ` El crecimiento aprobado se aplica sobre la base corregida del Niño (${nUnidades(v.base.corregida)}), que no se reparte por tienda.` });
  }
  return segmentos;
}

/** «La proyección cambió de datos después de calcular…» si hay un motivo que mueve el real por tienda; `null` si no. */
export function textoAlertaDatosCambiados(p: Pick<ProyeccionApi, "desactualizada">): string | null {
  const motivos = new Set(["cargas_nuevas", "tiendas_cambiadas", "crecimientos_cambiados"]);
  if (!p.desactualizada.some((m) => motivos.has(m.codigo))) return null;
  return "La proyección cambió de datos después de calcular: el real por tienda es el de hoy; recalcula para que el reparto use la misma venta. El cuadre con Σ B se mantiene.";
}

// ─── Motivos de variación ───

export const TEXTO_MOTIVO: Record<MotivoVariacion, string> = { nueva: "nueva", sin_dato: "—", parcial: "parcial", incompleto: "incompleto" };
export const AYUDA_MOTIVO: Record<MotivoVariacion, string> = {
  nueva: "Nueva: no vendió en el periodo anterior, así que no hay % que calcular.",
  sin_dato: "Sin dato: no hay venta en los dos periodos, o el periodo anterior es negativo.",
  parcial: "Parcial: la tienda no estuvo abierta todo uno de los dos periodos, así que la comparación no es válida.",
  incompleto: "Incompleto: falta un mes publicado en uno de los dos periodos.",
};

// ─── Modelo de la tabla ───

export type ColumnaPorTienda = {
  clave: string;
  tipo: "tienda" | "periodo" | "variacion" | "vigente";
  titulo: string;
  /** Línea pequeña bajo el título: en una variación, contra qué se compara. */
  subtitulo: string | null;
  /** La clave de `periodos` (o `vigente`) que muestra la columna; en una variación, la del periodo que se compara. */
  periodo: string | null;
  /** `aaaa-mm` sin carga publicada en el periodo (el `Badge` «faltan: …» de la cabecera). */
  faltan: string[];
};

export type CeldaPeriodo = {
  u: string;
  s: string;
  valor: CifraVentaApi;
  /** La tienda no estuvo abierta todo el periodo: la cifra va en gris. */
  gris: boolean;
  /** Además de gris, lleva la marca «parcial» (solo si hubo venta: un cero de una tienda que aún no abría no la necesita). */
  parcial: boolean;
  titulo: string | null;
};

export type LineaVariacion = { texto: string; negativo: boolean; motivo: MotivoVariacion | null };
export type CeldaVariacion = {
  u: VariacionVenta;
  s: VariacionVenta | null;
  lineas: LineaVariacion[];
  titulo: string;
  /** Solo en un subtotal con tiendas parciales: la variación sin esas tiendas. */
  comparable: { u: VariacionVenta; s: VariacionVenta | null; texto: string; titulo: string } | null;
};

export type CeldaVigente = {
  principal: string;
  /** «real 6,000 + proy. 2,400 · estimado». */
  detalle: string | null;
  /** «= base de la tabla de arriba» (solo en el subtotal de la base). */
  marca: string | null;
  titulo: string | null;
  valor: { u: number; real: number; proyectado: number; exacto: boolean } | null;
};

export type TipoFilaPorTienda = "tienda" | "sin_atribuir" | "subtotal_base" | "subtotal_fuera" | "total";

export type FilaPorTienda = {
  clave: string;
  tipo: TipoFilaPorTienda;
  /** Código de la tienda (vacío en las filas de resumen). */
  codigo: string;
  nombre: string;
  grupo: "base" | "fuera" | null;
  insignia: { texto: string; tono: "neutro" | "marca" | "alerta"; titulo: string } | null;
  /** El texto del motivo de la tienda (`estado_texto`), visible bajo el nombre salvo en las `misma`. */
  nota: string | null;
  periodos: Record<string, CeldaPeriodo>;
  /** Por clave de periodo que se compara (`2024`, `2025`, `2026-ac`, `vigente`). */
  variaciones: Record<string, CeldaVariacion>;
  vigente: CeldaVigente | null;
};

export type TablaPorTienda = { columnas: ColumnaPorTienda[]; filas: FilaPorTienda[]; conVigente: boolean };

const TEXTO_ESTADO = (estado: EstadoTiendaVenta, y: number): { texto: string; tono: "neutro" | "marca" | "alerta" } => {
  switch (estado) {
    case "misma":
      return { texto: "misma", tono: "neutro" };
    case "entra":
      return { texto: "entra", tono: "marca" };
    case "sale":
      return { texto: "sale", tono: "alerta" };
    case "abrio_en_curso":
      return { texto: `abrió en ${y}`, tono: "marca" };
    case "cerro":
      return { texto: "cerrada", tono: "neutro" };
    case "otra":
      return { texto: "no entra", tono: "neutro" };
    case "sin_bloque":
      return { texto: "sin clasificar", tono: "alerta" };
  }
};

const sumaCentavos = (xs: readonly number[]): number => xs.reduce((a, x) => a + Math.round(x * 100), 0) / 100;

function sumarCifras(tiendas: readonly TiendaVentaApi[], periodos: readonly PeriodoVentaApi[]): Record<string, CifraVentaApi> {
  return Object.fromEntries(
    periodos.map((p) => [p.clave, { u: tiendas.reduce((a, t) => a + (t.periodos[p.clave]?.u ?? 0), 0), s: sumaCentavos(tiendas.map((t) => t.periodos[p.clave]?.s ?? 0)) }])
  );
}

function celdaPeriodo(c: CifraVentaApi & { completo?: boolean }, etiqueta: string): CeldaPeriodo {
  const gris = c.completo === false;
  const hayVenta = c.u !== 0 || c.s !== 0;
  return {
    u: nUnidades(c.u),
    s: soles(c.s),
    valor: { u: c.u, s: c.s },
    gris,
    parcial: gris && hayVenta,
    titulo: gris ? `La tienda no estuvo abierta todo el periodo (${etiqueta}): la cifra es parcial.` : null,
  };
}

function lineasDe(u: VariacionVenta, s: VariacionVenta | null): LineaVariacion[] {
  const una = (x: VariacionVenta, medida: string | null): LineaVariacion =>
    x.motivo ? { texto: TEXTO_MOTIVO[x.motivo], negativo: false, motivo: x.motivo } : { texto: `${formatearPct(x.pct)}${medida ? ` ${medida}` : ""}`, negativo: (x.pct ?? 0) < 0, motivo: null };
  if (!s) return [una(u, "u")];
  if (u.motivo !== null && u.motivo === s.motivo) return [una(u, null)];
  return [una(u, "u"), una(s, "S/")];
}

function tituloVariacion(par: VariacionDePar, v: Pick<VentaPorTiendaApi, "periodos" | "anio_en_curso">): string {
  const motivos = [...new Set([par.u.motivo, par.s?.motivo ?? null].filter((m): m is MotivoVariacion => m !== null))];
  return [`${etiquetaClave(par.clave, v)} frente a ${etiquetaClave(par.contra, v)}.`, ...motivos.map((m) => AYUDA_MOTIVO[m])].join(" ");
}

function celdaVariacion(par: VariacionDePar, v: Pick<VentaPorTiendaApi, "periodos" | "anio_en_curso">): CeldaVariacion {
  return { u: par.u, s: par.s, lineas: lineasDe(par.u, par.s), titulo: tituloVariacion(par, v), comparable: null };
}

/** `comparable +17.6 % u · +20.1 % S/` (o el motivo si no hay %). */
function textoComparable(u: VariacionVenta, s: VariacionVenta | null): string {
  const una = (x: VariacionVenta, medida: string) => (x.motivo ? TEXTO_MOTIVO[x.motivo] : `${formatearPct(x.pct)} ${medida}`);
  return `comparable ${una(u, "u")}${s ? ` · ${una(s, "S/")}` : ""}`;
}

/**
 * Las variaciones de un subtotal (sobre las sumas, sin motivo `parcial`: una suma siempre es comparable consigo misma) y, si alguna tienda incluida tiene un periodo
 * parcial, la comparable: la misma variación sin esas tiendas. `sinAtribuir` (solo en la base) se queda en la comparable porque pertenece a las mismas tiendas.
 */
function variacionesDeSubtotal(
  v: VentaPorTiendaApi,
  tiendas: readonly TiendaVentaApi[],
  total: TotalVentaApi,
  sinAtribuir: number
): Record<string, CeldaVariacion> {
  const anio = v.anio_en_curso;
  const salida: Record<string, CeldaVariacion> = {};
  const sobreSumas = variacionesDeCifras({ anio, periodos: v.periodos, cifras: total.periodos, vigente: total.vigente, completo: () => true });
  for (const par of sobreSumas) salida[par.clave] = celdaVariacion(par, v);

  for (const par of paresVariacion(anio, v.periodos)) {
    const celda = salida[par.clave];
    if (!celda) continue;
    const excluidos = new Set([...(total.no_comparables[par.clave] ?? []), ...(total.no_comparables[par.contra] ?? [])]);
    if (excluidos.size === 0) continue;
    const incluidas = tiendas.filter((t) => !excluidos.has(t.codigo));
    const vigente = total.vigente === null ? null : incluidas.reduce((a, t) => a + (t.vigente?.u ?? 0), 0) + sinAtribuir;
    const comparable = variacionesDeCifras({ anio, periodos: v.periodos, cifras: sumarCifras(incluidas, v.periodos), vigente, completo: () => true }).find((p) => p.clave === par.clave);
    if (!comparable) continue;
    // Si las tiendas parciales no mueven la cifra (no vendieron en esos periodos), la comparable es la misma y repetirla solo estorba.
    const texto = (ls: LineaVariacion[]) => ls.map((l) => l.texto).join("|");
    if (texto(lineasDe(comparable.u, comparable.s)) === texto(celda.lineas)) continue;
    const lista = [...excluidos].sort((a, b) => a.localeCompare(b, "es")).join(", ");
    const causas = [par.clave, par.contra].filter((c) => (total.no_comparables[c] ?? []).length > 0).map((c) => etiquetaClave(c, v));
    salida[par.clave] = {
      ...celda,
      comparable: {
        u: comparable.u,
        s: comparable.s,
        texto: textoComparable(comparable.u, comparable.s),
        titulo: `El subtotal incluye ${lista}, sin ${causas.join(" ni ")} completo. La variación comparable las deja fuera: sin ${lista}.`,
      },
    };
  }
  return salida;
}

function variacionesDeTienda(v: VentaPorTiendaApi, t: TiendaVentaApi): Record<string, CeldaVariacion> {
  const anio = v.anio_en_curso;
  const pares = variacionesDeCifras({
    anio,
    periodos: v.periodos,
    cifras: t.periodos,
    vigente: t.vigente?.u ?? null,
    completo: (clave) => (clave === "vigente" ? periodoCompleto(t.fecha_apertura, t.fecha_cierre, anio, 12) : (t.periodos[clave]?.completo ?? false)),
  });
  return Object.fromEntries(pares.map((p) => [p.clave, celdaVariacion(p, v)]));
}

function celdaVigenteDeTienda(t: TiendaVentaApi, anio: number, k: number): CeldaVigente {
  const x = t.vigente;
  if (!x) {
    return {
      principal: "—",
      detalle: null,
      marca: null,
      titulo: t.estado === "sale" ? `Su ${anio} sale de la base (B2); no se reparte por tienda.` : `Sin cierre vigente: esta tienda no suma a la base de ${anio + 1}.`,
      valor: null,
    };
  }
  return {
    principal: nUnidades(x.u),
    detalle: `real ${unidades(x.real)} + proy. ${unidades(x.proyectado)}${x.exacto ? "" : " · estimado"}`,
    marca: null,
    titulo: x.exacto
      ? "Exacto: sale de las filas de tienda de esta tienda, no de un reparto."
      : `Estimado: el resto de la base se reparte entre las mismas tiendas en proporción a su real ene–${mesCorto(k)} de ${anio}; el subtotal cuadra exacto con Σ B.`,
    valor: x,
  };
}

const NADA = (): Pick<FilaPorTienda, "codigo" | "insignia" | "nota" | "grupo"> => ({ codigo: "", insignia: null, nota: null, grupo: null });

function filaDeTienda(v: VentaPorTiendaApi, t: TiendaVentaApi): FilaPorTienda {
  const e = TEXTO_ESTADO(t.estado, v.anio_en_curso);
  return {
    clave: t.tienda_id,
    tipo: "tienda",
    codigo: t.codigo,
    nombre: t.nombre,
    grupo: t.grupo,
    insignia: { texto: e.texto, tono: e.tono, titulo: t.estado_texto },
    nota: t.estado === "misma" ? null : t.estado_texto,
    periodos: Object.fromEntries(v.periodos.map((p) => [p.clave, celdaPeriodo(t.periodos[p.clave] ?? { u: 0, s: 0, completo: false }, etiquetaPeriodo(p, v.anio_en_curso))])),
    variaciones: variacionesDeTienda(v, t),
    vigente: celdaVigenteDeTienda(t, v.anio_en_curso, v.k),
  };
}

function filaDeResumen(
  v: VentaPorTiendaApi,
  tipo: "subtotal_base" | "subtotal_fuera" | "total",
  nombre: string,
  tiendas: readonly TiendaVentaApi[],
  total: TotalVentaApi,
  vigente: CeldaVigente | null,
  sinAtribuir: number
): FilaPorTienda {
  return {
    clave: tipo,
    tipo,
    ...NADA(),
    nombre,
    periodos: Object.fromEntries(v.periodos.map((p) => [p.clave, celdaPeriodo(total.periodos[p.clave] ?? { u: 0, s: 0 }, etiquetaPeriodo(p, v.anio_en_curso))])),
    variaciones: variacionesDeSubtotal(v, tiendas, total, sinAtribuir),
    vigente,
  };
}

/** Las columnas: la tienda, cada periodo con su variación contra el anterior y, si hay base, el cierre vigente con la suya. */
export function columnasPorTienda(v: VentaPorTiendaApi): ColumnaPorTienda[] {
  const y = v.anio_en_curso;
  const pares = new Map(paresVariacion(y, v.periodos).map((p) => [p.clave, p]));
  const columnas: ColumnaPorTienda[] = [{ clave: "tienda", tipo: "tienda", titulo: "Tienda", subtitulo: null, periodo: null, faltan: [] }];
  const variacion = (clave: string): ColumnaPorTienda | null => {
    const par = pares.get(clave);
    return par ? { clave: `var:${clave}`, tipo: "variacion", titulo: "Var.", subtitulo: `vs ${etiquetaClave(par.contra, v)}`, periodo: clave, faltan: [] } : null;
  };
  for (const p of v.periodos) {
    columnas.push({ clave: p.clave, tipo: "periodo", titulo: etiquetaPeriodo(p, y), subtitulo: null, periodo: p.clave, faltan: p.meses_faltantes });
    const var_ = variacion(p.clave);
    if (var_) columnas.push(var_);
  }
  if (v.base.total !== null) {
    columnas.push({ clave: "vigente", tipo: "vigente", titulo: `${y} cierre vigente`, subtitulo: "solo unidades", periodo: "vigente", faltan: [] });
    const var_ = variacion("vigente");
    if (var_) columnas.push(var_);
  }
  return columnas;
}

/**
 * Las filas en el orden de §5: tiendas de la base, «Sin atribuir a tienda» (si no es 0), subtotal de la base (su vigente = `Σ B`), tiendas de fuera con su subtotal y
 * el total del conjunto con solo las columnas reales. El subtotal de la base y el total traen la variación comparable cuando una tienda incluida es parcial.
 */
export function tablaPorTienda(v: VentaPorTiendaApi): TablaPorTienda {
  const y = v.anio_en_curso;
  const s = v.anio_siguiente;
  const conVigente = v.base.total !== null;
  const claveAc = `${y}-ac`;
  const base = v.tiendas.filter((t) => t.grupo === "base");
  const fuera = v.tiendas.filter((t) => t.grupo === "fuera");
  const filas: FilaPorTienda[] = base.map((t) => filaDeTienda(v, t));

  if (conVigente && v.base.sin_atribuir !== 0) {
    filas.push({
      clave: "sin_atribuir",
      tipo: "sin_atribuir",
      ...NADA(),
      grupo: "base",
      nombre: "Sin atribuir a tienda",
      nota: v.base.sin_atribuir > 0 ? "No se puede repartir entre las mismas tiendas" : "Las tiendas que entran ya superan la base",
      periodos: {},
      variaciones: {},
      vigente: {
        principal: nUnidades(v.base.sin_atribuir),
        detalle: "no se reparte entre tiendas",
        marca: null,
        titulo: "Parte de la base que ninguna tienda explica (ninguna de las mismas tiendas vendió en el año en curso en este conjunto, o las que entran ya suman más que la base).",
        valor: null,
      },
    });
  }

  // Subtotal de la base: su vigente es `Σ B` (con «sin atribuir»); el real de la base sale de su columna ene–k y lo demás es proyectado.
  const real = v.totales.base.periodos[claveAc]?.u ?? 0;
  const vigenteBase: CeldaVigente | null = conVigente
    ? {
        principal: nUnidades(v.base.total ?? 0),
        detalle: `real ${unidades(real)} + proy. ${unidades((v.base.total ?? 0) - real)}`,
        marca: "= base de la tabla de arriba",
        titulo: `Es la «Base ${y} (u)» real de este conjunto en la tabla de Crecimientos (Σ B).`,
        valor: { u: v.base.total ?? 0, real, proyectado: (v.base.total ?? 0) - real, exacto: false },
      }
    : null;
  filas.push(filaDeResumen(v, "subtotal_base", `Base ${s} · mismas tiendas de ${s} (${v.base.tiendas})`, base, v.totales.base, vigenteBase, v.base.sin_atribuir));

  if (fuera.length > 0) {
    for (const t of fuera) filas.push(filaDeTienda(v, t));
    filas.push(filaDeResumen(v, "subtotal_fuera", `Fuera de la base (${fuera.length})`, fuera, v.totales.fuera, null, 0));
  }
  filas.push(filaDeResumen(v, "total", `Total ${v.conjunto.nombre} (todas las tiendas, sin CD)`, v.tiendas, v.totales.conjunto, null, 0));
  return { columnas: columnasPorTienda(v), filas, conVigente };
}

/** Clase de fondo por tipo de fila (solo tokens del tema). */
export function claseFilaPorTienda(f: Pick<FilaPorTienda, "tipo">): string | undefined {
  if (f.tipo === "subtotal_base") return "bg-marca-suave/50 font-semibold";
  if (f.tipo === "subtotal_fuera") return "bg-neutro-suave/60 font-semibold";
  if (f.tipo === "total") return "bg-neutro-suave font-semibold";
  if (f.tipo === "sin_atribuir") return "bg-alerta-suave/30";
  return undefined;
}

// ─── Excel ───

const redondear1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

function textoMotivos(c: CeldaVariacion): string {
  const una = (x: VariacionVenta | null, medida: string) => (x?.motivo ? `${medida}: ${x.motivo}` : null);
  return [una(c.u, "u"), una(c.s, "S/")].filter(Boolean).join("; ");
}

const GRUPO_TEXTO: Record<TipoFilaPorTienda, string> = { tienda: "", sin_atribuir: "BASE", subtotal_base: "SUBTOTAL BASE", subtotal_fuera: "SUBTOTAL FUERA", total: "TOTAL" };

/**
 * Hojas `POR_TIENDA` (las mismas filas que la tabla; una columna por cifra: unidades, soles y %) y `FILTROS` (proyección, conjunto, corte y fecha). Los % van como
 * número con un decimal; cuando no hay % se deja la celda vacía y el motivo va en su columna. Pura: la fecha la pone quien llama.
 */
export function hojasPorTienda(args: { datos: VentaPorTiendaApi; proyeccion: string; fecha: string }): { POR_TIENDA: Hoja; FILTROS: Hoja } {
  const { datos: v } = args;
  const t = tablaPorTienda(v);
  const columnas = t.columnas.filter((c) => c.tipo !== "tienda");
  const conComparable = new Set(t.filas.flatMap((f) => Object.entries(f.variaciones).filter(([, c]) => c.comparable).map(([clave]) => clave)));
  const cabecera: string[] = ["GRUPO", "CODIGO", "TIENDA", "ESTADO"];
  for (const c of columnas) {
    const nombre = c.titulo.toUpperCase();
    if (c.tipo === "periodo") cabecera.push(`${nombre} U`, `${nombre} S/`);
    else if (c.tipo === "vigente") cabecera.push(`${nombre} U`, `${nombre} REAL U`, `${nombre} PROYECTADO U`, `${nombre} TIPO`);
    else {
      const n = `VAR ${etiquetaClave(c.periodo ?? "", v).toUpperCase()}`;
      cabecera.push(`${n} U %`, `${n} S/ %`, `${n} MOTIVO`);
      if (c.periodo && conComparable.has(c.periodo)) cabecera.push(`${n} COMPARABLE U %`, `${n} COMPARABLE S/ %`);
    }
  }
  const filas: Hoja = [cabecera];
  for (const f of t.filas) {
    const grupo = f.tipo === "tienda" ? (f.grupo === "base" ? "BASE" : "FUERA") : GRUPO_TEXTO[f.tipo];
    const fila: (string | number | null)[] = [grupo, f.codigo || null, f.nombre, f.nota ?? (f.tipo === "tienda" ? "misma" : null)];
    for (const c of columnas) {
      if (c.tipo === "periodo") {
        const x = f.periodos[c.periodo ?? ""];
        fila.push(x ? x.valor.u : null, x ? x.valor.s : null);
      } else if (c.tipo === "vigente") {
        const x = f.vigente?.valor ?? null;
        const sinAtribuir = f.tipo === "sin_atribuir" ? v.base.sin_atribuir : null;
        fila.push(x ? x.u : sinAtribuir, x ? x.real : null, x ? x.proyectado : null, x ? (x.exacto ? "exacto" : f.tipo === "subtotal_base" ? "= Σ B" : "estimado") : null);
      } else {
        const x = f.variaciones[c.periodo ?? ""];
        fila.push(redondear1(x?.u.pct ?? null), redondear1(x?.s?.pct ?? null), x ? textoMotivos(x) || null : null);
        if (c.periodo && conComparable.has(c.periodo)) fila.push(redondear1(x?.comparable?.u.pct ?? null), redondear1(x?.comparable?.s?.pct ?? null));
      }
    }
    filas.push(fila);
  }
  const filtros: Hoja = [
    ["FILTRO", "VALOR"],
    ["proyeccion", args.proyeccion],
    ["conjunto", v.conjunto.nombre],
    ["corte", v.hasta_periodo.slice(0, 7)],
    ["fecha", args.fecha],
  ];
  return { POR_TIENDA: filas, FILTROS: filtros };
}
