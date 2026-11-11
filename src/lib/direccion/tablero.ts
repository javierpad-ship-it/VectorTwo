import { periodoCompleto } from "@/lib/proyeccion/venta-por-tienda";
import type { BloquesApi } from "@/lib/proyeccion/tipos-api";
import {
  alertaComparadaDistintaK,
  alertaConcentracion,
  alertaDatosMasNuevos,
  alertaDistintaDeAprobada,
  alertaFactorProvisional,
  alertaMarcaEstimada,
  alertaMesesFaltantes,
  alertaMetodoAnterior,
  alertaOrigenDecisiones,
  alertaSinCurva,
  alertasAnomalias,
  alertasAperturaSinHistoria,
  alertasAtribucion,
  alertasBaseCorregida,
  alertasCambios,
  alertasContraTendencia,
  alertasDesvio,
  alertasTiendaNueva,
  ordenarAlertas,
  type FactorProvisional,
} from "./alertas";
import { armarApoyo } from "./apoyo";
import { aAprobacionApi, diferenciaConAprobada, estadoDeProyeccion, type EstadoDeProyeccion } from "./aprobacion";
import { atribuirTiendas, repartirMayorResto, repartirVendidoGuardado, type HistoriaVenta, type SalidaTiendas, type TiendaAtribuible } from "./atribucion";
import {
  CLAVES_COMPARATIVO,
  advertenciaMarca,
  claseTienda,
  comparativo,
  etiquetaComparativo,
  mismasDe,
  parConNino,
  situacionTienda,
  tiendasDeBloques,
  type LadoComparativo,
} from "./comparativos";
import { armarCrecimientos, type DeclaradoGm, type RestoDeclarado, type VersionCrecimiento } from "./crecimientos";
import { ROTULO_MANUAL_EN_FRASE, armarPuente, cifrasDeRecorte, lineaPuente, puentesPorGm } from "./puente";
import { MESES_CORTOS, conSigno, fechaCorta, frase, lista, mesAnio, miles, pct, rangoMeses, sumar, variacionPct } from "./textos";
import {
  DIM_FUERA_UNIVERSO,
  DIM_SIN_MARCA,
  FILAS_MAYORES,
  GM_CLAVE_TOTAL,
  type AlertaApi,
  type Bloque,
  type ClaseDecision,
  type ComparativoApi,
  type CrecimientoGMApi,
  type DecisionesAnioApi,
  type DecisionesSql,
  type Desglose,
  type DiferenciaAprobadaApi,
  type Exactitud,
  type FilaAprobacionSql,
  type FilaDesgloseApi,
  type MotivoSinComparada,
  type ProyeccionTableroApi,
  type PuenteApi,
  type SerieMensualApi,
  type SituacionTienda,
  type TableroApi,
  type TableroProyeccionSql,
  type TableroVentaSql,
  type TableroVentaTendenciaSql,
  type TemporadaTablero,
} from "./tipos-api";

/**
 * Armado del tablero de dirección (ficha 14, §3.3 y §4). Puro: recibe los documentos de `tablero_proyeccion` y `tablero_venta`, los maestros y las
 * aprobaciones ya leídos, y devuelve `TableroApi`. Solo lectura sobre lo guardado (D1): nunca recalcula ni reparte la proyección; lo único que
 * estima es la parte de cada tienda en las mismas tiendas (`atribucion.ts`), siempre rotulada.
 */

const MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const dos = (n: number): string => String(n).padStart(2, "0");
const periodo = (anio: number, mes: number): string => `${anio}-${dos(mes)}`;
const doce = <T,>(f: (mes: number) => T): T[] => MESES.map((m) => f(m));
const sumaNula = (v: readonly (number | null)[]): number | null => (v.some((x) => x !== null) ? v.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
const sumaMeses = (a: readonly number[], b: readonly number[]): number[] => doce((m) => (a[m - 1] ?? 0) + (b[m - 1] ?? 0));

// ─────────────────────────────────────────────────────────────────────────────
// Entradas
// ─────────────────────────────────────────────────────────────────────────────

export type TiendaMaestra = { id: string; codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null };

/** La proyección con lo que el tablero necesita de sus `parametros` y de su `resumen`. */
export type ProyeccionDeTablero = ProyeccionTableroApi & {
  bloques: BloquesApi;
  objetivo_pct: number | null;
  desvio_prueba_anterior_pct: number | null;
};

export type NombresTablero = {
  genero: ReadonlyMap<string, string>;
  mundo: ReadonlyMap<string, string>;
  /** `gml_id` → «GÉNERO · MUNDO · LÍNEA». */
  linea: ReadonlyMap<string, string>;
  agrupacionMarca: ReadonlyMap<string, string>;
  /** Unidad de marca → nombre de su marca cabeza. */
  marca: ReadonlyMap<string, string>;
};

export type MaestrosTablero = {
  /** Solo tiendas de tipo Tienda (el CD no aparece en filtros ni en venta). */
  tiendas: ReadonlyMap<string, TiendaMaestra>;
  /** Ids de los géneros que son columna de la matriz de crecimientos (HOMBRE y MUJER). */
  generosMatriz: ReadonlySet<string>;
  nombres: NombresTablero;
};

/** Los filtros ya resueltos contra el catálogo (lo que se mandó a las funciones SQL) y su texto. */
export type FiltrosResueltos = {
  /** Algún filtro de producto (géneros, mundo, línea, temporada, agrupación de marca o marca). */
  hayFiltroProducto: boolean;
  /** Unidad de marca elegida (lo proyectado es estimado con `por_marca`). */
  unidadMarcaId: string | null;
  /** Tiendas elegidas; `null` = ninguna. */
  tiendas: readonly string[] | null;
  bloque: Bloque;
  desglose: Desglose;
  /** El recorte en texto, sin la nota de exactitud («HOMBRE · URBANO · AM: AM-A»); vacío sin filtros. */
  partesTexto: readonly string[];
};

export type ComparadaDeTablero = {
  proyeccion: ProyeccionDeTablero;
  /** `tablero_proyeccion(comparada, mismos filtros)`. */
  doc: TableroProyeccionSql;
  motivo: "aprobada" | "elegida";
  huella_igual_a_aprobada: boolean | null;
};

/** Lo que es SIEMPRE de la proyección entera (lo que se aprueba): no depende de los filtros. */
export type EntradaEntera = {
  proyeccion: ProyeccionDeTablero;
  maestros: MaestrosTablero;
  /** `tablero_proyeccion(id, {})` o con solo `desglose`: sin filtros. */
  docTotal: TableroProyeccionSql;
  tendencia: TableroVentaTendenciaSql | null;
  declarados: readonly DeclaradoGm[];
  versiones: readonly VersionCrecimiento[];
  resto: Omit<RestoDeclarado, "pct" | "sobre_base">;
  /** Factores del Niño del año en curso cuyo estado no es `ok`. */
  factoresProvisionales: readonly FactorProvisional[];
  /** Aperturas del año siguiente proyectadas por venta esperada. */
  aperturasSinHistoria: readonly { tienda_id: string; fecha: string | null }[];
  aniosNino: readonly number[];
  /** `aaaa-mm` del último mes publicado y terminado (`k'`), o `null` si no hay venta publicada. */
  ultimoPublicado: string | null;
};

export type EntradaTablero = EntradaEntera & {
  filtros: FiltrosResueltos;
  /** `tablero_proyeccion(id, filtros + desglose)`. */
  docRecorte: TableroProyeccionSql;
  /** `tablero_venta` del recorte (con `tienda_ids` = el conjunto de tiendas mostrado, si lo hay). */
  venta: TableroVentaSql;
  /** `tablero_venta` sin filtros (puede ser el mismo documento): las frases del resumen son de la empresa entera. */
  ventaTotal: TableroVentaSql;
  comparada: ComparadaDeTablero | null;
  /** Las aprobaciones de ESTA proyección. */
  aprobaciones: readonly FilaAprobacionSql[];
  /** La aprobación más reciente no rechazada de cualquier proyección, con el nombre de la suya. */
  ultimaAprobada: { fila: FilaAprobacionSql; proyeccion_nombre: string } | null;
  /** El que mira es admin (aprueba) y la proyección no está archivada. */
  puedeAprobar: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Venta publicada por tienda y mes
// ─────────────────────────────────────────────────────────────────────────────

export type IndiceVenta = {
  tiendas: readonly string[];
  u: (tiendaId: string, anio: number, mes: number) => number;
  s: (tiendaId: string, anio: number, mes: number) => number;
  publicado: (anio: number, mes: number) => boolean;
  /** Meses `aaaa-mm` sin carga publicada entre enero de `desdeAnio` y `hasta` (incluido). */
  faltantes: (desdeAnio: number, hasta: string) => string[];
};

export function indiceVenta(venta: Pick<TableroVentaSql, "periodos" | "tiendas" | "por_tienda">): IndiceVenta {
  const porTienda = new Map<string, Map<string, { u: number; s: number }>>();
  for (const [iT, p, u, s] of venta.por_tienda ?? []) {
    const id = venta.tiendas[iT];
    if (id === undefined) continue;
    const m = porTienda.get(id) ?? new Map<string, { u: number; s: number }>();
    const x = m.get(p) ?? { u: 0, s: 0 };
    x.u += Number(u);
    x.s += Number(s);
    m.set(p, x);
    porTienda.set(id, m);
  }
  const publicados = new Set(Object.keys(venta.periodos ?? {}));
  return {
    tiendas: venta.tiendas,
    u: (t, anio, mes) => porTienda.get(t)?.get(periodo(anio, mes))?.u ?? 0,
    s: (t, anio, mes) => porTienda.get(t)?.get(periodo(anio, mes))?.s ?? 0,
    publicado: (anio, mes) => publicados.has(periodo(anio, mes)),
    faltantes: (desdeAnio, hasta) => {
      const salida: string[] = [];
      for (let z = desdeAnio; z <= Number(hasta.slice(0, 4)); z++) for (const m of MESES) if (periodo(z, m) <= hasta && !publicados.has(periodo(z, m))) salida.push(periodo(z, m));
      return salida;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conjunto de tiendas (§4.7, I4)
// ─────────────────────────────────────────────────────────────────────────────

export type ConjuntoTiendas = {
  /** Hay tiendas elegidas o un bloque distinto de «todas»: las cifras de mismas tiendas se atribuyen (§3.4). */
  recortado: boolean;
  /** Las tiendas del conjunto (con recorte); `null` sin recorte (todas). */
  ids: ReadonlySet<string> | null;
  /** El bloque entero, sin tiendas elegidas: su «sin atribuir» se suma y su total es exacto. */
  bloqueEntero: boolean;
  bloque: Bloque;
};

/**
 * El conjunto de tiendas que usan TODAS las líneas del gráfico y de la tabla: el del bloque en el año siguiente (`M(Y+1)`, las nuevas o los cierres)
 * intersectado con las tiendas elegidas. Sin bloque ni tiendas no hay recorte.
 */
export function conjuntoTiendas(bloques: BloquesApi, anio: number, bloque: Bloque, elegidas: readonly string[] | null): ConjuntoTiendas {
  if (bloque === "todas" && (elegidas === null || elegidas.length === 0)) return { recortado: false, ids: null, bloqueEntero: false, bloque };
  const sig = bloques[anio + 1];
  let ids: Set<string> | null = null;
  if (bloque !== "todas") ids = new Set((sig?.[bloque] ?? []).map((t) => t.tienda_id));
  if (elegidas !== null && elegidas.length > 0) ids = ids === null ? new Set(elegidas) : new Set(elegidas.filter((t) => ids?.has(t)));
  return { recortado: true, ids: ids ?? new Set(), bloqueEntero: bloque !== "todas" && (elegidas === null || elegidas.length === 0), bloque };
}

const ROTULO_BLOQUE: Record<Bloque, (anio: number) => string> = {
  todas: () => "Tiendas elegidas",
  mismas: (anio) => `Mismas tiendas de ${anio + 1}`,
  nuevas: (anio) => `Tiendas nuevas de ${anio + 1}`,
  cierres: (anio) => `Cierres de ${anio + 1}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Lo proyectado de un recorte para un conjunto de tiendas
// ─────────────────────────────────────────────────────────────────────────────

type CifraTienda = { anual: number; meses: (number | null)[]; estimado: boolean };

export type ProyectadoRecorte = {
  /** Cierre del año en curso: 12 meses (`null` = sin reparto mensual por tienda) y total anual. */
  enCurso: { meses: (number | null)[]; total: number; estimado: boolean };
  siguiente: { meses: (number | null)[]; total: number; estimado: boolean };
  /** Algo de lo mostrado es atribuido (mismas tiendas por tienda). */
  estimado: boolean;
  /** Por tienda (solo con recorte de tienda o desglose por tienda): su año en curso y su año siguiente. */
  porTienda: Map<string, { enCurso: CifraTienda; siguiente: CifraTienda }>;
  /** «Sin atribuir» anual y por mes de cada año (lo que no se asigna a ninguna tienda). */
  sinAtribuir: { enCurso: number; siguiente: number; mesEnCurso: (number | null)[]; mesSiguiente: (number | null)[] };
  atribucion: SalidaTiendas;
  clases: Map<string, TiendaAtribuible["clase"]>;
};

const cifraVacia = (): CifraTienda => ({ anual: 0, meses: doce(() => 0), estimado: false });

function sumarCifra(a: CifraTienda, anual: number, meses: readonly (number | null)[], estimado: boolean): CifraTienda {
  return { anual: a.anual + anual, meses: doce((m) => (a.meses[m - 1] === null || meses[m - 1] === null ? null : (a.meses[m - 1] as number) + (meses[m - 1] as number))), estimado: a.estimado || estimado };
}

/** Fechas con que se calculó la proyección (las guardadas en `bloques`); si la tienda no está, las del maestro de hoy. */
function fechasDe(bloques: BloquesApi, maestros: MaestrosTablero): (id: string) => { apertura: string | null; cierre: string | null } {
  const guardadas = tiendasDeBloques(bloques);
  return (id) => {
    const g = guardadas.get(id);
    if (g) return { apertura: g.fecha_apertura, cierre: g.fecha_cierre };
    const m = maestros.tiendas.get(id);
    return { apertura: m?.fecha_apertura ?? null, cierre: m?.fecha_cierre ?? null };
  };
}

/**
 * Lo proyectado de un recorte, por tienda y para el conjunto (§3.4 D). Las mismas tiendas se atribuyen SIEMPRE con todas las tiendas del recorte; las
 * filas de tienda (nuevas, aperturas, cierres y las de tienda del año en curso) van exactas.
 *
 * T3d (B1) · `porMarca`: con una unidad de marca, `doc` trae lo proyectado Y lo vendido guardado por la participación de la marca, pero `venta` es la
 * venta REAL de la marca. Mezclar las dos escalas (enero a `k` real y el total anual `A_t` de la base estimada) hacía que `A_t − real_t` saliera
 * negativo, que no hubiera reparto mensual y que el cierre del recorte no cuadrara. Con marca, el enero a `k` de cada tienda atribuida es lo vendido
 * guardado de la base del recorte repartido con la venta real de cada tienda en ese mes (`repartirVendidoGuardado`), y ese mismo enero a `k` es el
 * `real_t` de la regla 111 (que reparte en proporción a él). La venta real de la marca va solo en las filas `real_*`.
 */
export function proyectadoDeRecorte(o: {
  proyeccion: ProyeccionDeTablero;
  doc: TableroProyeccionSql;
  venta: IndiceVenta;
  maestros: MaestrosTablero;
  conjunto: ConjuntoTiendas;
  porMarca: boolean;
}): ProyectadoRecorte {
  const { proyeccion: p, doc, venta } = o;
  const Y = p.anio_en_curso;
  const [enCurso, siguiente] = doc.anios;
  const fechas = fechasDe(p.bloques, o.maestros);
  const historia: HistoriaVenta = {
    venta: venta.u,
    publicado: venta.publicado,
    completa: (id, anio) => {
      const f = fechas(id);
      return periodoCompleto(f.apertura, f.cierre, anio, 12);
    },
  };

  // Todas las tiendas del recorte: las de los bloques guardados, las que vendieron y las que tienen filas de tienda.
  const ids = new Set<string>([...tiendasDeBloques(p.bloques).keys(), ...venta.tiendas, ...enCurso.tiendas.map((t) => t.t), ...siguiente.tiendas.map((t) => t.t)]);
  const clases = new Map<string, TiendaAtribuible["clase"]>();
  for (const id of ids) if (o.maestros.tiendas.has(id)) clases.set(id, claseTienda(p.bloques, Y, id));
  const codigoDe = (id: string) => o.maestros.tiendas.get(id)?.codigo ?? id;
  // Con marca, enero a `k` de las tiendas atribuidas (*misma* y *sale*) es lo vendido guardado × participación, repartido con su venta del mes.
  const atribuidas = [...clases]
    .filter(([, c]) => c === "misma" || c === "sale")
    .map(([id]) => id)
    .sort((a, b) => codigoDe(a).localeCompare(codigoDe(b), "es") || a.localeCompare(b));
  const eneK = o.porMarca ? repartirVendidoGuardado({ ids: atribuidas, k: p.k, mesesBase: enCurso.base.meses, venta: (id, m) => venta.u(id, Y, m) }) : undefined;
  const tiendas: TiendaAtribuible[] = [...clases].map(([id, clase]) => {
    let real = 0;
    for (let m = 1; m <= p.k; m++) real += eneK ? (eneK.get(id)?.[m - 1] ?? 0) : venta.u(id, Y, m);
    return { id, codigo: codigoDe(id), clase, real };
  });
  const paraBase = new Map<string, number>();
  for (const t of enCurso.tiendas) if (t.para_base !== null) paraBase.set(t.t, (paraBase.get(t.t) ?? 0) + t.para_base);

  const atribucion = atribuirTiendas({
    tiendas,
    baseEnCurso: enCurso.base.vigente,
    B: siguiente.base.B,
    baseSiguiente: siguiente.base.vigente,
    vigenteSinB: siguiente.base.vigente_sin_B,
    paraBase,
    anio: Y,
    k: p.k,
    mesesBaseEnCurso: enCurso.base.meses,
    mesesBaseSiguiente: siguiente.base.meses,
    historia,
    ...(eneK ? { eneK } : {}),
  });

  // Por tienda: lo atribuido más sus filas de tienda (exactas).
  const porTienda = new Map<string, { enCurso: CifraTienda; siguiente: CifraTienda }>();
  const de = (id: string) => {
    let x = porTienda.get(id);
    if (!x) {
      x = { enCurso: cifraVacia(), siguiente: cifraVacia() };
      porTienda.set(id, x);
    }
    return x;
  };
  for (const [id, t] of atribucion.enCurso.porTienda) de(id).enCurso = sumarCifra(de(id).enCurso, t.anual, t.meses, true);
  for (const [id, t] of atribucion.siguiente.porTienda) de(id).siguiente = sumarCifra(de(id).siguiente, t.anual, t.meses, true);
  for (const t of enCurso.tiendas) de(t.t).enCurso = sumarCifra(de(t.t).enCurso, t.vigente, t.meses, false);
  for (const t of siguiente.tiendas) de(t.t).siguiente = sumarCifra(de(t.t).siguiente, t.vigente, t.meses, false);

  const sinAtribuir = {
    enCurso: atribucion.enCurso.sinAtribuir,
    siguiente: atribucion.siguiente.sinAtribuir,
    mesEnCurso: atribucion.enCurso.sinAtribuirMes,
    mesSiguiente: atribucion.siguiente.sinAtribuirMes as (number | null)[],
  };

  if (!o.conjunto.recortado) {
    // Sin recorte de tienda todo es exacto: la suma de `meses` y el vigente de lo guardado.
    const tiendasY = enCurso.tiendas.reduce((a, t) => sumaMeses(a, t.meses), doce(() => 0));
    const tiendasS = siguiente.tiendas.reduce((a, t) => sumaMeses(a, t.meses), doce(() => 0));
    return {
      enCurso: { meses: sumaMeses(enCurso.base.meses, tiendasY), total: enCurso.base.vigente + enCurso.tiendas.reduce((a, t) => a + t.vigente, 0), estimado: false },
      siguiente: { meses: sumaMeses(siguiente.base.meses, tiendasS), total: siguiente.base.vigente + siguiente.tiendas.reduce((a, t) => a + t.vigente, 0), estimado: false },
      estimado: false,
      porTienda,
      sinAtribuir,
      atribucion,
      clases,
    };
  }

  // Con recorte: la suma de las tiendas del conjunto; con un bloque entero, además su «sin atribuir» (el total del bloque es exacto).
  const conjunto = o.conjunto.ids ?? new Set<string>();
  let totalY = 0;
  let totalS = 0;
  let mesesY: (number | null)[] = doce(() => 0);
  let mesesS: (number | null)[] = doce(() => 0);
  let estimadoY = false;
  let estimadoS = false;
  const acumular = (a: (number | null)[], b: readonly (number | null)[]): (number | null)[] => doce((m) => (a[m - 1] === null || b[m - 1] === null ? null : (a[m - 1] as number) + (b[m - 1] as number)));
  for (const id of conjunto) {
    const t = porTienda.get(id);
    if (!t) continue;
    totalY += t.enCurso.anual;
    totalS += t.siguiente.anual;
    mesesY = acumular(mesesY, t.enCurso.meses);
    mesesS = acumular(mesesS, t.siguiente.meses);
    estimadoY = estimadoY || t.enCurso.estimado;
    estimadoS = estimadoS || t.siguiente.estimado;
  }
  if (o.conjunto.bloqueEntero && o.conjunto.bloque === "mismas") {
    // Lo que 07f no repartió entre las mismas tiendas (año en curso) y lo no asignado del año siguiente: con ellos el bloque suma `B` y la base del
    // año siguiente, exactos. Por mes solo se suma el del año siguiente (el del año en curso junta esta parte con la de las tiendas que salen).
    totalY += atribucion.anual.sinAtribuir07f;
    totalS += atribucion.siguiente.sinAtribuir;
    mesesS = acumular(mesesS, atribucion.siguiente.sinAtribuirMes);
  } else if (o.conjunto.bloqueEntero && o.conjunto.bloque === "cierres") {
    // Lo que quedó de `L` sin repartir entre las tiendas que salen.
    totalY += atribucion.anual.sinAtribuirSale;
  }
  return {
    enCurso: { meses: mesesY, total: totalY, estimado: estimadoY },
    siguiente: { meses: mesesS, total: totalS, estimado: estimadoS },
    estimado: estimadoY || estimadoS,
    porTienda,
    sinAtribuir,
    atribucion,
    clases,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo de la proyección entera («Para decidir»)
// ─────────────────────────────────────────────────────────────────────────────

export type ParteEntera = {
  puentes: (PuenteApi & { gm_clave: string; nombre: string })[];
  crecimientos: CrecimientoGMApi[];
  /** Alertas de alcance `proyeccion` que no dependen de con qué se compara ni de lo aprobado antes. */
  alertas: AlertaApi[];
  kPrima: number;
  /** Cierre del año en curso y total del año siguiente de toda la proyección. */
  enCurso: number;
  siguiente: number;
};

const nombreGm = (m: MaestrosTablero) => (g: string, mu: string): string => `${m.nombres.genero.get(g) ?? "—"} · ${m.nombres.mundo.get(mu) ?? "—"}`;

/** `k'` (1 a 12) dentro del año en curso: el mes del último publicado si es de `Y`; 12 si ya es de un año posterior; `k` si es anterior o no hay. */
export function kPrimaDe(p: Pick<ProyeccionTableroApi, "anio_en_curso" | "k">, ultimoPublicado: string | null): number {
  if (ultimoPublicado === null) return p.k;
  const anio = Number(ultimoPublicado.slice(0, 4));
  if (anio > p.anio_en_curso) return 12;
  if (anio < p.anio_en_curso) return p.k;
  return Number(ultimoPublicado.slice(5, 7));
}

const tiendasNombradas = (m: MaestrosTablero) => new Map([...m.tiendas].map(([id, t]) => [id, { id, codigo: t.codigo, fecha_apertura: t.fecha_apertura }]));

/**
 * Puente por GM, crecimientos y alertas de la proyección entera. Lo usan igual el tablero y el `POST` de aprobación (para la foto del `resumen`): no
 * depende de ningún filtro (R15).
 */
export function armarParteEntera(e: EntradaEntera): ParteEntera {
  const p = e.proyeccion;
  const Y = p.anio_en_curso;
  const doc = e.docTotal;
  const kPrima = kPrimaDe(p, e.ultimoPublicado);
  const nombre = nombreGm(e.maestros);
  const puentes = puentesPorGm(doc.por_gm, e.maestros.generosMatriz, nombre, Y);
  const crecimientos = armarCrecimientos({
    porGm: doc.por_gm,
    generosMatriz: e.maestros.generosMatriz,
    nombreDe: nombre,
    declarados: e.declarados,
    versiones: e.versiones,
    resto: { ...e.resto, pct: doc.resto?.pct ?? null, sobre_base: doc.resto?.sobre_base ?? null },
    tendencia: e.tendencia ? { tiendas: e.tendencia.tiendas, filas: e.tendencia.tendencia_gm } : null,
    mismasEnCurso: mismasDe(p.bloques, Y, Y),
    kPrima,
  });
  const [enCurso, siguiente] = doc.anios;
  const totalY = enCurso.base.vigente + enCurso.tiendas.reduce((a, t) => a + t.vigente, 0);
  const totalS = siguiente.base.vigente + siguiente.tiendas.reduce((a, t) => a + t.vigente, 0);
  const tiendas = tiendasNombradas(e.maestros);
  const alertas = [
    ...alertasContraTendencia(crecimientos, Y, kPrima),
    ...alertasDesvio(crecimientos, puentes),
    ...alertaFactorProvisional(e.factoresProvisionales, doc.por_temporada, totalS, Y),
    ...alertasTiendaNueva(doc, tiendas, "proyeccion", p.k),
    ...alertasAperturaSinHistoria(e.aperturasSinHistoria, tiendas, "proyeccion"),
    ...alertasAnomalias(crecimientos),
    ...alertaOrigenDecisiones(siguiente.decisiones, Y + 1),
    ...alertasBaseCorregida(crecimientos, Y),
    ...alertaMetodoAnterior(p.version_metodo),
    ...alertasCambios({
      propuesta_cambio: enCurso.conteos.propuesta_cambio + siguiente.conteos.propuesta_cambio,
      curva_cambio: enCurso.conteos.curva_cambio + siguiente.conteos.curva_cambio,
    }),
    ...alertaDatosMasNuevos(p.hasta_periodo, e.ultimoPublicado),
  ];
  return { puentes, crecimientos, alertas: ordenarAlertas(alertas), kPrima, enCurso: totalY, siguiente: totalS };
}

/** Lo que `diferenciaConAprobada` necesita de la proyección mostrada. */
export const actualParaDiferencia = (p: ProyeccionTableroApi, huella: string, parte: ParteEntera) => ({
  proyeccion_id: p.id,
  huella,
  anio_en_curso: p.anio_en_curso,
  en_curso: parte.enCurso,
  siguiente: parte.siguiente,
  por_gm: parte.puentes.filter((x) => x.gm_clave !== GM_CLAVE_TOTAL).map((x) => ({ gm_clave: x.gm_clave, nombre: x.nombre, siguiente: lineaPuente(x, "total_siguiente") })),
});

// ─────────────────────────────────────────────────────────────────────────────
// Resumen para decidir (§4.3)
// ─────────────────────────────────────────────────────────────────────────────

const ROTULO_ESTADO: Record<EstadoDeProyeccion["estado"], (e: EstadoDeProyeccion) => string> = {
  sin_aprobacion: () => "sin aprobación de dirección vigente",
  aprobada: (e) => `aprobada por dirección (${e.ultima?.usuario_nombre ?? "—"}, ${e.ultima ? fechaCorta(e.ultima.created_at) : "—"})`,
  con_observaciones: (e) => `aprobada con observaciones por dirección (${e.ultima?.usuario_nombre ?? "—"}, ${e.ultima ? fechaCorta(e.ultima.created_at) : "—"})`,
  rechazada: (e) => `rechazada por dirección (${e.ultima?.usuario_nombre ?? "—"}, ${e.ultima ? fechaCorta(e.ultima.created_at) : "—"}); sin aprobación vigente`,
  invalidada: (e) => `la aprobación del ${e.ultima ? fechaCorta(e.ultima.created_at) : "—"} quedó invalidada: la proyección cambió después`,
};

/**
 * Las frases del resumen, siempre de la proyección entera. La línea «N causas bloquearían el cierre» NO se arma aquí: la completa la pantalla con
 * `GET /api/direccion/bloqueos` (así el tablero no carga el contexto de cálculo de M7).
 */
export function lineasParaDecidir(o: {
  proyeccion: ProyeccionDeTablero;
  parte: ParteEntera;
  aniosNino: ReadonlySet<number>;
  /** Venta de la empresa del año anterior (`Y−1`) y si ese año está completo. */
  anterior: { total: number; completo: boolean } | null;
  alertas: readonly AlertaApi[];
  estado: EstadoDeProyeccion;
  diferencia: DiferenciaAprobadaApi | null;
}): string[] {
  const p = o.proyeccion;
  const Y = p.anio_en_curso;
  const S = Y + 1;
  const total = o.parte.puentes.find((x) => x.gm_clave === GM_CLAVE_TOTAL);
  const lineas: string[] = [];

  // 1. Qué se compra.
  const vsCierre = variacionPct(o.parte.siguiente, o.parte.enCurso);
  let que = `${S}: ${miles(o.parte.siguiente)} u`;
  if (vsCierre !== null) que += `, ${pct(vsCierre)} sobre el cierre ${Y}`;
  if (o.anterior && o.anterior.completo && o.anterior.total > 0) {
    const vsAnterior = variacionPct(o.parte.siguiente, o.anterior.total);
    const normal = !o.aniosNino.has(Y - 1) && o.aniosNino.has(Y) ? `, el último año normal (${Y} fue año del Niño)` : "";
    que += ` y ${pct(vsAnterior)} sobre ${Y - 1}${normal}`;
  }
  lineas.push(`${que}.`);

  // 2. De dónde sale.
  if (total) {
    const aumento = o.parte.siguiente - o.parte.enCurso;
    const pasos: { texto: string; u: number }[] = [
      { texto: "crecimiento declarado", u: lineaPuente(total, "crecimiento") },
      { texto: ROTULO_MANUAL_EN_FRASE, u: lineaPuente(total, "manual") },
      { texto: "otras diferencias con la propuesta", u: lineaPuente(total, "otras") },
      { texto: "filas sin base", u: lineaPuente(total, "sin_base") },
      { texto: `tiendas abiertas en ${Y}`, u: lineaPuente(total, "nuevas_anterior") },
      { texto: "aperturas", u: lineaPuente(total, "aperturas") },
      { texto: `venta de ${S} de tiendas que cierran`, u: lineaPuente(total, "cierres") },
      { texto: "corrección del Niño", u: lineaPuente(total, "nino") },
    ].filter((x) => x.u !== 0);
    const positivos = pasos.filter((x) => x.u > 0).map((x) => `${x.texto} ${conSigno(x.u)}`);
    const negativos = pasos.filter((x) => x.u < 0).map((x) => `${miles(-x.u)} de ${x.texto}`);
    const sale = lineaPuente(total, "fuera_base") + lineaPuente(total, "ajuste_base");
    if (sale < 0) negativos.push(`${miles(-sale)} de tiendas que salen de la base`);
    else if (sale > 0) positivos.push(`ajuste de la base ${conSigno(sale)}`);
    const cuerpo = [positivos.join(", "), negativos.length > 0 ? `menos ${lista(negativos)}` : ""].filter((x) => x !== "").join(", ");
    lineas.push(`${aumento >= 0 ? "El aumento" : "La baja"} de ${miles(Math.abs(aumento))} u sale de: ${cuerpo === "" ? "sin cambios en ningún paso" : cuerpo}.`);
  }

  // 3. Riesgo.
  const importantes = o.alertas.filter((a) => a.nivel === "importante" && a.alcance === "proyeccion");
  lineas.push(
    importantes.length === 0
      ? "Sin alertas importantes."
      : `${importantes.length} ${importantes.length === 1 ? "alerta importante" : "alertas importantes"}; la primera: ${importantes[0].detalle.replace(/\.$/, "")}.`
  );

  // 4. Frente a lo aprobado.
  const d = o.diferencia;
  if (d === null) lineas.push("No hay aprobaciones anteriores.");
  else if (d.identica) lineas.push(d.misma_proyeccion ? `Sin cambios desde lo aprobado el ${fechaCorta(d.fecha, false)}.` : `Idéntica a lo aprobado el ${fechaCorta(d.fecha, false)} (${d.proyeccion_nombre}).`);
  else {
    const mayor = d.por_gm.find((g) => g.u !== 0);
    lineas.push(
      `Frente a lo aprobado el ${fechaCorta(d.fecha, false)} (${d.proyeccion_nombre}): ${S} ${conSigno(d.siguiente.u)} u${d.siguiente.pct === null ? "" : ` (${pct(d.siguiente.pct)})`}${mayor ? `; el mayor cambio, ${mayor.nombre} ${conSigno(mayor.u)} u` : ""}.`
    );
  }

  // 5. Quién y cómo.
  const direccion = ROTULO_ESTADO[o.estado.estado](o.estado);
  if (p.estado === "cerrada") lineas.push(`Cerrada por ${p.cerrada_por_nombre ?? "—"}${p.cerrada_at ? ` el ${fechaCorta(p.cerrada_at)}` : ""}; ${direccion}.`);
  else if (p.estado === "archivada") lineas.push(`Archivada: solo lectura; ${direccion}.`);
  else lineas.push(`En trabajo: las cifras pueden cambiar; ${direccion}.`);
  return lineas.map(frase);
}

// ─────────────────────────────────────────────────────────────────────────────
// Desglose (§4.8 y §3.4 F)
// ─────────────────────────────────────────────────────────────────────────────

const NOMBRE_TEMPORADA: Record<string, string> = { invierno: "Invierno", verano: "Verano", todo_el_ano: "Todo el año", sin_temporada: "Sin temporada" };
export const TEMPORADAS_NOMBRADAS: { id: TemporadaTablero; nombre: string }[] = [
  { id: "invierno", nombre: "Invierno" },
  { id: "verano", nombre: "Verano" },
  { id: "todo_el_ano", nombre: "Todo el año" },
  { id: "sin_temporada", nombre: "Sin temporada" },
];

function nombreDeDimension(dim: Desglose, id: string, m: MaestrosTablero): string {
  switch (dim) {
    case "genero":
      return m.nombres.genero.get(id) ?? "—";
    case "mundo":
      return m.nombres.mundo.get(id) ?? "—";
    case "linea":
      return m.nombres.linea.get(id) ?? "—";
    case "agrupacion_marca":
      return m.nombres.agrupacionMarca.get(id) ?? "—";
    case "marca":
      return m.nombres.marca.get(id) ?? "—";
    case "temporada":
      return id === DIM_FUERA_UNIVERSO ? "Venta sin fila en la proyección" : (NOMBRE_TEMPORADA[id] ?? id);
    case "tienda": {
      const t = m.tiendas.get(id);
      return t ? `${t.codigo} · ${t.nombre}` : "—";
    }
  }
}

/**
 * T3 (R5): en el desglose por marca, de lo atribuido a las mismas tiendas del conjunto solo se reparte entre las marcas la parte de la base que tiene
 * participación por marca (`Σ bases de las marcas ÷ base del recorte`); el resto va a la fila «Sin participación por marca». Puro.
 */
export function parteConMarca(atribuido: number, basesMarca: readonly number[], baseRecorte: number): number {
  if (!(atribuido > 0) || !(baseRecorte > 0)) return 0;
  const conMarca = sumar(basesMarca.map((x) => (x > 0 ? x : 0)));
  return Math.round(atribuido * Math.min(1, conMarca / baseRecorte));
}

type CrudoDesglose = { id: string; nombre: string; exactitud: Exactitud; filtrable: boolean; hace_tres: number; hace_dos: number; anterior: number; cierre: number; siguiente: number; ac_anterior: number; ac_en_curso: number };

function aFilaDesglose(c: CrudoDesglose, anio: number, totalSiguiente: number, incompletos: ReadonlySet<number>): FilaDesgloseApi {
  const real = (z: number, total: number) => ({ anio: z, tipo: (incompletos.has(z) ? "real_parcial" : "real") as "real" | "real_parcial", total });
  return {
    id: c.id,
    nombre: c.nombre,
    exactitud: c.exactitud,
    anios: [real(anio - 3, c.hace_tres), real(anio - 2, c.hace_dos), real(anio - 1, c.anterior), { anio, tipo: "cierre", total: c.cierre }, { anio: anio + 1, tipo: "proyectado", total: c.siguiente }],
    ac_anterior: c.ac_anterior,
    ac_en_curso: c.ac_en_curso,
    pct: {
      sig_vs_cierre: variacionPct(c.siguiente, c.cierre),
      sig_vs_anterior: variacionPct(c.siguiente, c.anterior),
      cierre_vs_anterior: variacionPct(c.cierre, c.anterior),
      ac_vs_ac: variacionPct(c.ac_en_curso, c.ac_anterior),
    },
    participacion_siguiente: totalSiguiente > 0 ? c.siguiente / totalSiguiente : null,
    filtrable: c.filtrable,
  };
}

function armarDesglose(o: {
  e: EntradaTablero;
  venta: IndiceVenta;
  conjunto: ConjuntoTiendas;
  proyectado: ProyectadoRecorte;
  kPrima: number;
  incompletos: ReadonlySet<number>;
}): TableroApi["desglose"] {
  const { e, venta, conjunto, proyectado, kPrima } = o;
  const p = e.proyeccion;
  const Y = p.anio_en_curso;
  const dim = e.filtros.desglose;
  const crudos: CrudoDesglose[] = [];
  const anual = (t: string, z: number) => sumar(MESES.map((m) => venta.u(t, z, m)));
  const acumulado = (t: string, z: number) => sumar(MESES.filter((m) => m <= kPrima).map((m) => venta.u(t, z, m)));

  if (dim === "tienda") {
    const ids = conjunto.ids ?? new Set<string>([...e.maestros.tiendas.keys()]);
    for (const id of ids) {
      if (!e.maestros.tiendas.has(id)) continue;
      const t = proyectado.porTienda.get(id);
      const fila: CrudoDesglose = {
        id,
        nombre: nombreDeDimension("tienda", id, e.maestros),
        exactitud: t && (t.enCurso.estimado || t.siguiente.estimado) ? "estimado" : "exacto",
        filtrable: true,
        hace_tres: anual(id, Y - 3),
        hace_dos: anual(id, Y - 2),
        anterior: anual(id, Y - 1),
        cierre: t?.enCurso.anual ?? 0,
        siguiente: t?.siguiente.anual ?? 0,
        ac_anterior: acumulado(id, Y - 1),
        ac_en_curso: acumulado(id, Y),
      };
      const conDato = fila.hace_tres !== 0 || fila.hace_dos !== 0 || fila.anterior !== 0 || fila.cierre !== 0 || fila.siguiente !== 0 || fila.ac_en_curso !== 0;
      if (conDato || conjunto.recortado) crudos.push(fila);
    }
    // Lo que no se asigna a ninguna tienda va en su propia fila, para que la suma sea el total (solo cuando el conjunto lo incluye).
    const sinY = proyectado.enCurso.total - sumar(crudos.map((c) => c.cierre));
    const sinS = proyectado.siguiente.total - sumar(crudos.map((c) => c.siguiente));
    if (sinY !== 0 || sinS !== 0) {
      crudos.push({ id: "sin_atribuir", nombre: "Sin atribuir a tienda", exactitud: "estimado", filtrable: false, hace_tres: 0, hace_dos: 0, anterior: 0, cierre: sinY, siguiente: sinS, ac_anterior: 0, ac_en_curso: 0 });
    }
  } else {
    const [enCurso, siguiente] = e.docRecorte.anios;
    const porDim = new Map((e.docRecorte.por_dim ?? []).map((d) => [d.d, d]));
    const ventaDim = new Map<string, readonly number[]>();
    for (const f of e.venta.por_dim?.filas ?? []) {
      const id = e.venta.por_dim?.ids[f[0]];
      if (id !== undefined) ventaDim.set(id, f);
    }
    const ids = [...new Set([...porDim.keys(), ...ventaDim.keys()])];
    const enConjunto = (pares: readonly (readonly [string, number])[]) => sumar(pares.filter(([t]) => conjunto.ids === null || conjunto.ids.has(t)).map(([, u]) => u));

    // §3.4 F: con tiendas elegidas, lo de mismas tiendas de cada elemento se estima con UNA tasa (la parte atribuida al conjunto), por mayor resto.
    let basesY = ids.map((id) => porDim.get(id)?.Y.base ?? 0);
    let basesS = ids.map((id) => porDim.get(id)?.Y1.base ?? 0);
    if (conjunto.recortado) {
      const exactoY = sumar(enCurso.tiendas.filter((t) => conjunto.ids?.has(t.t)).map((t) => t.vigente));
      const exactoS = sumar(siguiente.tiendas.filter((t) => conjunto.ids?.has(t.t)).map((t) => t.vigente));
      const atribuidoY = Math.max(0, proyectado.enCurso.total - exactoY);
      const atribuidoS = Math.max(0, proyectado.siguiente.total - exactoS);
      basesY = repartirMayorResto(dim === "marca" ? parteConMarca(atribuidoY, basesY, enCurso.base.vigente) : atribuidoY, basesY);
      basesS = repartirMayorResto(dim === "marca" ? parteConMarca(atribuidoS, basesS, siguiente.base.vigente) : atribuidoS, basesS);
    }
    ids.forEach((id, i) => {
      const d = porDim.get(id);
      const v = ventaDim.get(id);
      const baseEstimada = conjunto.recortado && (basesY[i] !== 0 || basesS[i] !== 0);
      crudos.push({
        id,
        nombre: nombreDeDimension(dim, id, e.maestros),
        exactitud: dim === "marca" || e.filtros.unidadMarcaId !== null || baseEstimada ? "estimado" : "exacto",
        filtrable: id !== DIM_FUERA_UNIVERSO,
        hace_tres: v?.[1] ?? 0,
        hace_dos: v?.[2] ?? 0,
        anterior: v?.[3] ?? 0,
        cierre: basesY[i] + enConjunto(d?.Y.tiendas ?? []),
        siguiente: basesS[i] + enConjunto(d?.Y1.tiendas ?? []),
        ac_anterior: v?.[4] ?? 0,
        ac_en_curso: v?.[5] ?? 0,
      });
    });
    const sinY = proyectado.enCurso.total - sumar(crudos.map((c) => c.cierre));
    const sinS = proyectado.siguiente.total - sumar(crudos.map((c) => c.siguiente));
    if (dim === "marca") {
      // T3 (R5): lo proyectado de las filas cuya fila base no trae `por_marca` (y el redondeo de repartir por participación) no es de ninguna marca:
      // va en su propia fila, no elegible como filtro, para que el total cuadre con las tarjetas. Solo si no es cero.
      if (sinY !== 0 || sinS !== 0) {
        crudos.push({ id: DIM_SIN_MARCA, nombre: "Sin participación por marca", exactitud: "estimado", filtrable: false, hace_tres: 0, hace_dos: 0, anterior: 0, cierre: sinY, siguiente: sinS, ac_anterior: 0, ac_en_curso: 0 });
      }
    } else if (conjunto.recortado && (sinY !== 0 || sinS !== 0)) {
      // T3d (R5): con tiendas o bloque, lo atribuido que no se pudo repartir entre los elementos (un «sin atribuir» negativo del bloque, que no se
      // reparte, o un recorte sin base en ningún elemento) va en la misma fila que en el desglose por tienda, para que el total sea el de las tarjetas.
      crudos.push({ id: "sin_atribuir", nombre: "Sin atribuir a tienda", exactitud: "estimado", filtrable: false, hace_tres: 0, hace_dos: 0, anterior: 0, cierre: sinY, siguiente: sinS, ac_anterior: 0, ac_en_curso: 0 });
    }
  }

  crudos.sort((a, b) => b.siguiente - a.siguiente || b.cierre - a.cierre || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
  const total: CrudoDesglose = {
    id: "total",
    nombre: "Total",
    exactitud: crudos.some((c) => c.exactitud === "estimado") ? "estimado" : "exacto",
    filtrable: false,
    hace_tres: sumar(crudos.map((c) => c.hace_tres)),
    hace_dos: sumar(crudos.map((c) => c.hace_dos)),
    anterior: sumar(crudos.map((c) => c.anterior)),
    cierre: sumar(crudos.map((c) => c.cierre)),
    siguiente: sumar(crudos.map((c) => c.siguiente)),
    ac_anterior: sumar(crudos.map((c) => c.ac_anterior)),
    ac_en_curso: sumar(crudos.map((c) => c.ac_en_curso)),
  };
  return { dimension: dim, filas: crudos.map((c) => aFilaDesglose(c, Y, total.siguiente, o.incompletos)), total: aFilaDesglose(total, Y, total.siguiente, o.incompletos) };
}

// ─────────────────────────────────────────────────────────────────────────────
// «Sin atribuir a tienda» al pie de la tabla mensual (§3.4 C)
// ─────────────────────────────────────────────────────────────────────────────

type FilaTabla = TableroApi["tabla_mensual"]["filas"][number];
const conSignoOCero = (n: number): string => (n === 0 ? "0" : conSigno(n));

/**
 * T3: las filas `sin_atribuir_<año>` de la tabla mensual y su nota. Puro. Cada fila lleva como `total` la suma de sus meses (lo que se ve) y solo sale
 * si algún mes no es cero. La nota (o `null`) explica los meses negativos con el texto de §3.4 C y, si el «sin atribuir» del año no es la suma de sus
 * meses, de dónde sale la diferencia (unidades sin curva mensual y, en el año en curso, los meses de enero a `k`, que son venta real).
 */
export function armarFilasSinAtribuir(o: {
  k: number;
  /** T3d: con una unidad de marca, enero a `k` no es venta real sino lo vendido guardado × participación repartido entre las tiendas. */
  porMarca?: boolean;
  anios: readonly { anio: number; meses: readonly (number | null)[]; anual: number; sinCurva: number }[];
}): { filas: FilaTabla[]; nota: string | null } {
  const filas: FilaTabla[] = [];
  const negativos: string[] = [];
  const diferencias: string[] = [];
  o.anios.forEach(({ anio, meses, anual, sinCurva }, i) => {
    if (!meses.some((x) => x !== null && x !== 0)) return;
    const total = sumaNula(meses) ?? 0;
    filas.push({ clave: `sin_atribuir_${anio}`, etiqueta: `Sin atribuir a tienda ${anio}`, meses: [...meses], total, tipo: "proyectado", exactitud: "estimado" });
    meses.forEach((x, m) => {
      if (x !== null && x < 0) negativos.push(`${conSigno(x)} u en ${MESES_CORTOS[m]} ${anio}`);
    });
    if (anual !== total) {
      const causas: string[] = [];
      if (sinCurva > 0) causas.push(`${miles(sinCurva)} u del año ${sinCurva === 1 ? "no tiene" : "no tienen"} curva mensual (${sinCurva === 1 ? "suma" : "suman"} al total del año, no a los meses)`);
      else if (sinCurva < 0) causas.push(`la curva mensual guardada suma ${miles(-sinCurva)} u más que el total del año`);
      if (i === 0 && o.k > 0) {
        const eneK = rangoMeses(1, Math.min(12, o.k));
        causas.push(
          o.porMarca
            ? `los meses de ${eneK} son lo vendido guardado por la participación de la marca, repartido entre las tiendas, y no tienen «sin atribuir» por mes`
            : `los meses de ${eneK} son venta real de cada tienda y no tienen «sin atribuir» por mes`
        );
      }
      diferencias.push(`En ${anio}, lo sin atribuir del año es ${conSignoOCero(anual)} u y la suma de sus meses ${conSignoOCero(total)} u${causas.length > 0 ? `: ${lista(causas)}` : ""}.`);
    }
  });
  const partes: string[] = [];
  if (negativos.length > 0) {
    partes.push(
      `${lista(negativos)}: lo atribuido a las tiendas ${negativos.length === 1 ? "ese mes" : "esos meses"} supera lo proyectado para el bloque (la base anual y la curva guardada difieren; ver la línea «diferencia» del puente). Nunca se resta de una tienda.`
    );
  }
  partes.push(...diferencias);
  return { filas, nota: partes.length > 0 ? frase(partes.join(" ")) : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cómo se decidió
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_CLASE: Record<ClaseDecision, string> = {
  lote: "en bloque",
  ia: "IA",
  propuesta: "aceptada tal cual",
  manual: "a mano",
  escalada: "escalada por tienda",
  sin_decidir: "sin decidir",
};
const CLASES: ClaseDecision[] = ["lote", "ia", "propuesta", "manual", "escalada", "sin_decidir"];

export function decisionesDeAnio(anio: number, d: DecisionesSql): DecisionesAnioApi {
  const total = CLASES.reduce((a, c) => a + (d[c]?.u ?? 0), 0);
  return {
    anio,
    por_origen: CLASES.map((c) => ({ clave: c, etiqueta: ETIQUETA_CLASE[c], n: d[c]?.n ?? 0, u: d[c]?.u ?? 0, pct_u: total > 0 ? ((d[c]?.u ?? 0) / total) * 100 : 0 })),
    autores: (d.autores ?? []).map((a) => ({ nombre: a.nombre, n: a.n, u: a.u, desde: a.desde, hasta: a.hasta })),
    dia_pico: d.dia_pico ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El tablero
// ─────────────────────────────────────────────────────────────────────────────

const aApi = (p: ProyeccionDeTablero): ProyeccionTableroApi => ({
  id: p.id,
  nombre: p.nombre,
  estado: p.estado,
  anio_en_curso: p.anio_en_curso,
  anio_siguiente: p.anio_siguiente,
  hasta_periodo: p.hasta_periodo,
  k: p.k,
  version_metodo: p.version_metodo,
  cerrada_at: p.cerrada_at,
  cerrada_por_nombre: p.cerrada_por_nombre,
  usa_compras: p.usa_compras,
});

export function armarTablero(e: EntradaTablero): TableroApi {
  const p = e.proyeccion;
  const Y = p.anio_en_curso;
  const S = Y + 1;
  const k = p.k;
  const aniosNino = new Set(e.aniosNino);
  const parte = armarParteEntera(e);
  const kPrima = parte.kPrima;
  const ultimoPublicado = e.ultimoPublicado ?? p.hasta_periodo;

  const venta = indiceVenta(e.venta);
  const ventaTotal = e.ventaTotal === e.venta ? venta : indiceVenta(e.ventaTotal);
  const conjunto = conjuntoTiendas(p.bloques, Y, e.filtros.bloque, e.filtros.tiendas);
  const porMarca = e.filtros.unidadMarcaId !== null;
  const proyectado = proyectadoDeRecorte({ proyeccion: p, doc: e.docRecorte, venta, maestros: e.maestros, conjunto, porMarca });
  const [enCurso, siguiente] = e.docRecorte.anios;
  const idsVenta = [...e.maestros.tiendas.keys()].filter((id) => conjunto.ids === null || conjunto.ids.has(id));

  // ── Real por año y mes del conjunto de tiendas.
  const hastaReal = periodo(Y, kPrima);
  const faltantes = venta.faltantes(Y - 3, hastaReal > ultimoPublicado ? ultimoPublicado : hastaReal);
  const incompletos = new Set(faltantes.map((m) => Number(m.slice(0, 4))).filter((z) => z < Y));
  const real = (z: number): (number | null)[] => doce((m) => (venta.publicado(z, m) && (z < Y || m <= kPrima) ? sumar(idsVenta.map((t) => venta.u(t, z, m))) : null));
  const reales = new Map<number, (number | null)[]>([Y - 3, Y - 2, Y - 1, Y].map((z) => [z, real(z)]));
  const totalReal = (z: number): number => sumaNula(reales.get(z) ?? []) ?? 0;
  const acReal = (z: number): number => sumar(MESES.filter((m) => m <= kPrima).map((m) => reales.get(z)?.[m - 1] ?? 0));

  // ── Proyectado del año en curso: cierre (12 meses) y resto (de k+1 a diciembre).
  const cierreMeses = proyectado.enCurso.meses;
  const restoMeses = doce((m) => (m > k ? cierreMeses[m - 1] : null));
  // T3d (B1): `real_ac` es enero a `k` de la fila del cierre y `proyectado_resto` es lo que le falta para el cierre anual, SIEMPRE (también si el
  // reparto mensual por tienda no se pudo hacer y los meses de `k+1` a diciembre van en `null`): `cierre = real_ac + proyectado_resto` exacto.
  const realAc = sumar(MESES.filter((m) => m <= k).map((m) => cierreMeses[m - 1] ?? 0));
  const restoAnual = proyectado.enCurso.total - realAc;
  // La fila y la serie del resto llevan la suma de sus meses (lo que se ve); sin reparto mensual, el resto anual.
  const proyectadoResto = sumaNula(restoMeses) ?? restoAnual;
  const exactitud: Exactitud = proyectado.estimado || porMarca ? "estimado" : "exacto";
  const exactitudY: Exactitud = proyectado.enCurso.estimado || porMarca ? "estimado" : "exacto";
  const exactitudS: Exactitud = proyectado.siguiente.estimado || porMarca ? "estimado" : "exacto";

  // ── Comparativos (R7).
  const completa = (id: string, z: number): boolean => {
    const f = fechasDe(p.bloques, e.maestros)(id);
    return periodoCompleto(f.apertura, f.cierre, z, 12);
  };
  const codigos = (ids: readonly string[]) => ids.map((id) => e.maestros.tiendas.get(id)?.codigo ?? id).sort((a, b) => a.localeCompare(b, "es"));
  const enConjunto = (ids: Iterable<string>) => [...ids].filter((id) => e.maestros.tiendas.has(id) && (conjunto.ids === null || conjunto.ids.has(id)));
  const ventaAnual = (ids: readonly string[], z: number) => sumar(ids.map((id) => sumar(MESES.map((m) => venta.u(id, z, m)))));
  const ventaAc = (ids: readonly string[], z: number) => sumar(ids.map((id) => sumar(MESES.filter((m) => m <= kPrima).map((m) => venta.u(id, z, m)))));
  const atribuidoY = (ids: readonly string[]) => sumar(ids.map((id) => proyectado.atribucion.anual.enCurso.get(id) ?? 0));
  const atribuidoS = (ids: readonly string[]) => sumar(ids.map((id) => proyectado.atribucion.anual.siguiente.get(id) ?? 0));
  const incompletoAnio = (z: number) => incompletos.has(z);
  const incompletoAc = (z: number) => faltantes.some((m) => Number(m.slice(0, 4)) === z && Number(m.slice(5, 7)) <= kPrima);

  const mismasS = enConjunto(mismasDe(p.bloques, Y, S));
  const mismasY = enConjunto(mismasDe(p.bloques, Y, Y));
  const mismasAnterior = enConjunto(mismasDe(p.bloques, Y, Y - 1));
  const todasLasMismasS = !conjunto.recortado || (conjunto.bloqueEntero && e.filtros.bloque === "mismas");
  const todasLasMismasY = !conjunto.recortado;
  const ladoMismas = (clave: ComparativoApi["clave"]): (LadoComparativo & { tiendas: string[]; anteriorCorregido?: number | null }) | null => {
    switch (clave) {
      case "sig_vs_cierre": {
        if (siguiente.base.B === null) return null;
        const Bc = siguiente.base.B_corr;
        // Con todas las mismas tiendas es `Σ vigente con B ÷ Σ B − 1`, exacto; con un subconjunto, lo atribuido a esas tiendas (y su parte de la
        // base corregida, en la misma proporción que la base real).
        if (todasLasMismasS) return { actual: siguiente.base.vigente_con_B, anterior: siguiente.base.B, anteriorCorregido: Bc, tiendas: codigos(mismasS), incompleto: false };
        const baseReal = atribuidoY(mismasS);
        return { actual: atribuidoS(mismasS), anterior: baseReal, anteriorCorregido: Bc !== null && siguiente.base.B > 0 ? (baseReal * Bc) / siguiente.base.B : null, tiendas: codigos(mismasS), incompleto: false };
      }
      case "sig_vs_anterior": {
        const ids = mismasS.filter((id) => completa(id, Y - 1));
        return { actual: atribuidoS(ids), anterior: ventaAnual(ids, Y - 1), tiendas: codigos(ids), incompleto: incompletoAnio(Y - 1) };
      }
      case "cierre_vs_anterior":
        return { actual: todasLasMismasY ? enCurso.base.vigente : atribuidoY(mismasY), anterior: ventaAnual(mismasY, Y - 1), tiendas: codigos(mismasY), incompleto: incompletoAnio(Y - 1) };
      case "cierre_vs_hace_dos": {
        const ids = mismasY.filter((id) => completa(id, Y - 2));
        return { actual: ids.length === mismasY.length && todasLasMismasY ? enCurso.base.vigente : atribuidoY(ids), anterior: ventaAnual(ids, Y - 2), tiendas: codigos(ids), incompleto: incompletoAnio(Y - 2) };
      }
      case "ac_vs_ac":
        return { actual: ventaAc(mismasY, Y), anterior: ventaAc(mismasY, Y - 1), tiendas: codigos(mismasY), incompleto: incompletoAc(Y) || incompletoAc(Y - 1) };
      case "anterior_vs_hace_dos":
        return { actual: ventaAnual(mismasAnterior, Y - 1), anterior: ventaAnual(mismasAnterior, Y - 2), tiendas: codigos(mismasAnterior), incompleto: incompletoAnio(Y - 1) || incompletoAnio(Y - 2) };
    }
  };
  const ladoTotal = (clave: ComparativoApi["clave"]): LadoComparativo => {
    switch (clave) {
      case "sig_vs_cierre":
        return { actual: proyectado.siguiente.total, anterior: proyectado.enCurso.total, incompleto: false };
      case "sig_vs_anterior":
        return { actual: proyectado.siguiente.total, anterior: totalReal(Y - 1), incompleto: incompletoAnio(Y - 1) };
      case "cierre_vs_anterior":
        return { actual: proyectado.enCurso.total, anterior: totalReal(Y - 1), incompleto: incompletoAnio(Y - 1) };
      case "cierre_vs_hace_dos":
        return { actual: proyectado.enCurso.total, anterior: totalReal(Y - 2), incompleto: incompletoAnio(Y - 2) };
      case "ac_vs_ac":
        return { actual: acReal(Y), anterior: acReal(Y - 1), incompleto: incompletoAc(Y) || incompletoAc(Y - 1) };
      case "anterior_vs_hace_dos":
        return { actual: totalReal(Y - 1), anterior: totalReal(Y - 2), incompleto: incompletoAnio(Y - 1) || incompletoAnio(Y - 2) };
    }
  };
  const comparativos = CLAVES_COMPARATIVO.map((clave) =>
    comparativo({ clave, etiqueta: etiquetaComparativo(clave, Y, kPrima, aniosNino), nino: parConNino(clave, Y, aniosNino), total: ladoTotal(clave), mismas: ladoMismas(clave), advertencia: advertenciaMarca(clave, Y, porMarca) })
  );

  // ── Series y tabla mensual.
  const rotuloNino = (z: number) => (aniosNino.has(z) ? " (Niño)" : "");
  const series: SerieMensualApi[] = [];
  for (const z of [Y - 3, Y - 2, Y - 1]) {
    series.push({ clave: `real_${z}`, etiqueta: `${z}${rotuloNino(z)}`, anio: z, tipo: incompletoAnio(z) ? "real_parcial" : "real", nino: aniosNino.has(z), meses: reales.get(z) ?? [], total: sumaNula(reales.get(z) ?? []), exactitud: "exacto" });
  }
  series.push({ clave: `real_${Y}`, etiqueta: `${Y} real${rotuloNino(Y)}`, anio: Y, tipo: "real_parcial", nino: aniosNino.has(Y), meses: reales.get(Y) ?? [], total: sumaNula(reales.get(Y) ?? []), exactitud: "exacto" });
  series.push({ clave: `proyectado_${Y}`, etiqueta: `${Y} proyectado${rotuloNino(Y)}`, anio: Y, tipo: "proyectado", nino: aniosNino.has(Y), meses: restoMeses, total: proyectadoResto, exactitud: exactitudY });
  const conSinNino = !conjunto.recortado && enCurso.base.meses_sin_nino !== null;
  const sinNinoMeses = conSinNino
    ? sumaMeses(enCurso.base.meses_sin_nino, enCurso.tiendas.reduce((a, t) => sumaMeses(a, t.meses), doce(() => 0))).map((x) => Math.round(x * 100) / 100)
    : null;
  if (sinNinoMeses) {
    series.push({ clave: `sin_nino_${Y}`, etiqueta: `${Y} sin Niño (derivado)`, anio: Y, tipo: "sin_nino", nino: false, meses: sinNinoMeses, total: Math.round(sumar(sinNinoMeses) * 100) / 100, exactitud: porMarca ? "estimado" : "exacto" });
  }
  series.push({ clave: `proyectado_${S}`, etiqueta: `${S}`, anio: S, tipo: "proyectado", nino: aniosNino.has(S), meses: proyectado.siguiente.meses, total: proyectado.siguiente.total, exactitud: exactitudS });

  // La comparada, con los mismos filtros y el mismo conjunto de tiendas, alineada por año calendario.
  let comparadaApi: TableroApi["comparada"] = null;
  const filasComparada: { clave: string; etiqueta: string; meses: (number | null)[]; total: number | null; tipo: SerieMensualApi["tipo"]; exactitud: Exactitud }[] = [];
  if (e.comparada) {
    const c = e.comparada;
    const pc = proyectadoDeRecorte({ proyeccion: c.proyeccion, doc: c.doc, venta, maestros: e.maestros, conjunto, porMarca });
    const tipo: SerieMensualApi["tipo"] = c.motivo === "aprobada" ? "aprobada" : "comparada";
    const exactitudC: Exactitud = pc.estimado || e.filtros.unidadMarcaId !== null ? "estimado" : "exacto";
    const rotulo = `${c.proyeccion.nombre}${c.motivo === "aprobada" ? " (aprobada)" : ""}`;
    const dos = [
      { anio: c.proyeccion.anio_en_curso, etiqueta: `${c.proyeccion.anio_en_curso} cierre · ${rotulo}`, datos: pc.enCurso },
      { anio: c.proyeccion.anio_siguiente, etiqueta: `${c.proyeccion.anio_siguiente} · ${rotulo}`, datos: pc.siguiente },
    ];
    for (const x of dos) {
      series.push({ clave: `comparada_${x.anio}`, etiqueta: x.etiqueta, anio: x.anio, tipo, nino: aniosNino.has(x.anio), meses: x.datos.meses, total: x.datos.total, exactitud: exactitudC });
      filasComparada.push({ clave: `comparada_${x.anio}`, etiqueta: x.etiqueta, meses: x.datos.meses, total: x.datos.total, tipo, exactitud: exactitudC });
    }
    comparadaApi = { ...aApi(c.proyeccion), motivo: c.motivo, huella_igual_a_aprobada: c.huella_igual_a_aprobada };
  }

  const variacionMensual = (a: readonly (number | null)[], b: readonly (number | null)[]) => doce((m) => variacionPct(a[m - 1], b[m - 1]));
  const filasTabla: TableroApi["tabla_mensual"]["filas"] = [
    ...series.filter((s) => s.tipo === "real" || s.clave.startsWith("real_")).map((s) => ({ clave: s.clave, etiqueta: s.etiqueta, meses: s.meses, total: s.total, tipo: s.tipo, exactitud: s.exactitud })),
    { clave: `proyectado_${Y}`, etiqueta: `${Y} proyectado`, meses: restoMeses, total: proyectadoResto, tipo: "proyectado", exactitud: exactitudY },
    { clave: `cierre_${Y}`, etiqueta: `${Y} cierre${rotuloNino(Y)}`, meses: cierreMeses, total: proyectado.enCurso.total, tipo: "proyectado", exactitud: exactitudY },
    ...(sinNinoMeses ? [{ clave: `sin_nino_${Y}`, etiqueta: `${Y} sin Niño`, meses: sinNinoMeses as (number | null)[], total: Math.round(sumar(sinNinoMeses) * 100) / 100, tipo: "sin_nino" as const, exactitud: (porMarca ? "estimado" : "exacto") as Exactitud }] : []),
    { clave: `proyectado_${S}`, etiqueta: `${S}`, meses: proyectado.siguiente.meses, total: proyectado.siguiente.total, tipo: "proyectado", exactitud: exactitudS },
    ...filasComparada,
  ];
  let notaTabla: string | null = null;
  if (conjunto.recortado) {
    // «Sin atribuir» va al pie con su signo; nunca se resta de una tienda (§3.4 C). T3: el total de cada fila es la suma de sus meses y la fila solo
    // sale si algún mes no es cero; lo que explica la diferencia con el «sin atribuir» anual va en `nota`.
    const sinAtribuir = armarFilasSinAtribuir({
      k,
      porMarca,
      anios: [
        { anio: Y, meses: doce((m) => (m > k ? proyectado.sinAtribuir.mesEnCurso[m - 1] : null)), anual: proyectado.sinAtribuir.enCurso, sinCurva: enCurso.base.sin_meses },
        { anio: S, meses: proyectado.sinAtribuir.mesSiguiente, anual: proyectado.sinAtribuir.siguiente, sinCurva: siguiente.base.sin_meses },
      ],
    });
    filasTabla.push(...sinAtribuir.filas);
    notaTabla = sinAtribuir.nota;
  }
  filasTabla.push(
    { clave: "var_sig_vs_cierre", etiqueta: `${S} vs ${Y} cierre (%)`, meses: variacionMensual(proyectado.siguiente.meses, cierreMeses), total: variacionPct(proyectado.siguiente.total, proyectado.enCurso.total), tipo: "variacion", exactitud },
    { clave: "var_sig_vs_anterior", etiqueta: `${S} vs ${Y - 1} (%)`, meses: variacionMensual(proyectado.siguiente.meses, reales.get(Y - 1) ?? []), total: variacionPct(proyectado.siguiente.total, totalReal(Y - 1)), tipo: "variacion", exactitud },
    { clave: "var_cierre_vs_anterior", etiqueta: `${Y} vs ${Y - 1} (%)`, meses: variacionMensual(cierreMeses, reales.get(Y - 1) ?? []), total: variacionPct(proyectado.enCurso.total, totalReal(Y - 1)), tipo: "variacion", exactitud }
  );

  // ── Aprobación y diferencia con lo último aprobado (siempre de la proyección entera).
  const huella = e.docTotal.huella;
  const estado = estadoDeProyeccion(e.aprobaciones, huella);
  const diferencia = e.ultimaAprobada ? diferenciaConAprobada(e.ultimaAprobada.fila, e.ultimaAprobada.proyeccion_nombre, actualParaDiferencia(p, huella, parte)) : null;

  // ── Alertas: las de la proyección entera más las del recorte.
  const tiendas = tiendasNombradas(e.maestros);
  const hayRecorte = e.filtros.hayFiltroProducto || conjunto.recortado;
  const sinMeses = siguiente.base.sin_meses + siguiente.tiendas.reduce((a, t) => a + t.sin_meses, 0);
  const totalRecorteSiguiente = siguiente.base.vigente + siguiente.tiendas.reduce((a, t) => a + t.vigente, 0);
  const paresConProyeccion = e.docRecorte.por_par.filas.filter((f) => f[3] > 0).length;
  const porCodigo = (a: string, b: string) => (e.maestros.tiendas.get(a)?.codigo ?? a).localeCompare(e.maestros.tiendas.get(b)?.codigo ?? b, "es");
  const elegidasConParte = [...(conjunto.ids ?? [])].filter((id) => proyectado.clases.get(id) === "misma" || proyectado.clases.get(id) === "entra").sort(porCodigo);
  const elegidasQueSalen = [...(conjunto.ids ?? [])].filter((id) => proyectado.clases.get(id) === "sale").sort(porCodigo);
  const B = siguiente.base.B ?? 0;
  const atribucionTiendas = elegidasConParte.map((id) => ({
    tienda_id: id,
    codigo: e.maestros.tiendas.get(id)?.codigo ?? id,
    participacion_anual: B > 0 ? (proyectado.atribucion.anual.enCurso.get(id) ?? 0) / B : 0,
    participacion_mes: proyectado.atribucion.siguiente.participacionMes.get(id) ?? doce(() => null),
  }));
  const alertasRecorte: AlertaApi[] = [
    ...alertaConcentracion(e.docRecorte.mayores, paresConProyeccion, totalRecorteSiguiente, S),
    ...alertaSinCurva(sinMeses, S),
    ...alertaMesesFaltantes(faltantes),
    ...(hayRecorte ? alertasTiendaNueva(e.docRecorte, tiendas, "recorte", k, conjunto.ids) : []),
    ...(hayRecorte ? alertasAperturaSinHistoria(e.aperturasSinHistoria.filter((a) => siguiente.tiendas.some((t) => t.t === a.tienda_id && t.vigente !== 0) && (conjunto.ids === null || conjunto.ids.has(a.tienda_id))), tiendas, "recorte") : []),
    ...(conjunto.recortado && elegidasConParte.length + elegidasQueSalen.length > 0
      ? alertasAtribucion({ anio: Y, k, tiendas: conjunto.bloqueEntero ? [] : atribucionTiendas, salen: conjunto.bloqueEntero ? [] : elegidasQueSalen.map((id) => ({ codigo: e.maestros.tiendas.get(id)?.codigo ?? id, u: proyectado.atribucion.anual.enCurso.get(id) ?? 0 })), sinAtribuir: { en_curso: proyectado.sinAtribuir.enCurso, siguiente: proyectado.sinAtribuir.siguiente }, filasSinB: proyectado.atribucion.anual.filasSinB && siguiente.base.B !== null, mensual: proyectado.atribucion.enCurso.mensual })
      : []),
    ...(e.filtros.unidadMarcaId !== null || e.filtros.desglose === "marca"
      ? alertaMarcaEstimada({ nombre: e.filtros.unidadMarcaId ? (e.maestros.nombres.marca.get(e.filtros.unidadMarcaId) ?? null) : null, sinParticipacion: e.docRecorte.sin_participacion_marca, proyectado: totalRecorteSiguiente })
      : []),
  ];
  const alertas = ordenarAlertas([
    ...parte.alertas,
    ...alertaComparadaDistintaK(p.hasta_periodo, e.comparada ? e.comparada.proyeccion.hasta_periodo : null),
    ...alertaDistintaDeAprobada(diferencia, S),
    ...alertasRecorte,
  ]);
  const importantes = alertas.filter((a) => a.nivel === "importante" && a.alcance === "proyeccion").length;

  // ── Soles y cobertura.
  const solesAnio = new Map<number, number>();
  for (const z of [Y - 3, Y - 2, Y - 1, Y]) solesAnio.set(z, sumar(MESES.filter((m) => venta.publicado(z, m) && (z < Y || m <= kPrima)).map((m) => sumar(idsVenta.map((t) => venta.s(t, z, m))))));
  const solesHastaK = sumar(MESES.filter((m) => m <= k && venta.publicado(Y, m)).map((m) => sumar(idsVenta.map((t) => venta.s(t, Y, m)))));
  // Los 12 meses que siguen a `k'`: lo que queda del año en curso y el arranque del siguiente (`null` si falta el reparto mensual).
  const siguientes12 = [...MESES.filter((m) => m > kPrima).map((m) => cierreMeses[m - 1]), ...MESES.filter((m) => m <= kPrima).map((m) => proyectado.siguiente.meses[m - 1])];
  const proyectado12 = siguientes12.some((x) => x === null) ? null : sumar(siguientes12 as number[]);
  const real12 = sumar([...MESES.filter((m) => m > kPrima).map((m) => sumar(idsVenta.map((t) => venta.u(t, Y - 1, m)))), ...MESES.filter((m) => m <= kPrima).map((m) => sumar(idsVenta.map((t) => venta.u(t, Y, m))))]);
  const apoyo = armarApoyo({
    anio: Y,
    k,
    kPrima,
    ultimoPublicado: periodo(Y, kPrima),
    solesAnio,
    solesEnCursoHastaK: solesHastaK,
    pares: e.docRecorte.por_par,
    precios: e.venta.precios,
    unidadesConjunto: conjunto.recortado ? { enCursoResto: sumaNula(restoMeses) ?? Math.max(0, restoAnual), siguiente: proyectado.siguiente.total } : null,
    stock: { por_tienda: e.venta.stock?.por_tienda ?? [], cd: e.venta.stock?.cd ?? null },
    proyectado12,
    real12,
    exactitud,
  });

  // ── Resumen para decidir (empresa entera).
  const idsEmpresa = [...e.maestros.tiendas.keys()];
  const anteriorEmpresa = sumar(idsEmpresa.map((t) => sumar(MESES.map((m) => ventaTotal.u(t, Y - 1, m)))));
  const anteriorCompleto = MESES.every((m) => ventaTotal.publicado(Y - 1, m));
  const lineas = lineasParaDecidir({ proyeccion: p, parte, aniosNino, anterior: { total: anteriorEmpresa, completo: anteriorCompleto }, alertas, estado, diferencia });

  // ── Puente del recorte (no se recorta por tienda).
  const sinFiltros = !hayRecorte;
  const total = parte.puentes.find((x) => x.gm_clave === GM_CLAVE_TOTAL);
  const puenteRecorte: PuenteApi | null = conjunto.recortado ? null : sinFiltros && total ? { lineas: total.lineas, pct: total.pct } : armarPuente(cifrasDeRecorte(enCurso, siguiente), Y);

  // ── Texto del recorte y conjunto de tiendas.
  const codigosConjunto = conjunto.ids ? codigos([...conjunto.ids].filter((id) => e.maestros.tiendas.has(id))) : [];
  const partesTexto = [...e.filtros.partesTexto];
  if (conjunto.recortado) partesTexto.push(`tiendas: ${codigosConjunto.length > 0 ? codigosConjunto.join(", ") : "ninguna"}`);
  if (exactitud === "estimado") partesTexto.push(conjunto.recortado && proyectado.estimado ? `cifras de ${codigosConjunto.length <= 3 && codigosConjunto.length > 0 ? codigosConjunto.join(", ") : "tienda"} estimadas` : "lo proyectado por marca es estimado");
  const situaciones: { tienda_id: string; situacion: SituacionTienda }[] = [...e.maestros.tiendas.keys()]
    .map((id) => ({ tienda_id: id, situacion: situacionTienda(p.bloques, Y, id) }))
    .sort((a, b) => (e.maestros.tiendas.get(a.tienda_id)?.codigo ?? "").localeCompare(e.maestros.tiendas.get(b.tienda_id)?.codigo ?? "", "es"));

  const mayores = e.docRecorte.mayores.slice(0, FILAS_MAYORES).map((m) => ({
    fila: `${e.maestros.nombres.linea.get(m.gml_id) ?? "—"} · ${e.maestros.nombres.agrupacionMarca.get(m.am_id) ?? "—"}`,
    vigente: m.Y1,
    participacion: totalRecorteSiguiente > 0 ? m.Y1 / totalRecorteSiguiente : 0,
    crecimiento_pct: m.B === null ? null : variacionPct(m.Y1, m.B),
  }));

  return {
    proyeccion: aApi(p),
    comparada: comparadaApi,
    datos: {
      k_prima: kPrima,
      ultimo_publicado: ultimoPublicado,
      meses_faltantes: faltantes,
      anios_nino: [...aniosNino].sort((a, b) => a - b),
      tiendas: situaciones,
      fuera_universo: (e.venta.fuera_universo ?? []).map(([anio, u]) => ({ anio, u })),
    },
    filtros: {
      texto: partesTexto.join(" · "),
      exactitud,
      conjunto_tiendas: conjunto.recortado ? { etiqueta: `${ROTULO_BLOQUE[e.filtros.bloque](Y)} (${codigosConjunto.length})${codigosConjunto.length > 0 ? `: ${codigosConjunto.join(", ")}` : ""}`, codigos: codigosConjunto } : null,
    },
    decidir: {
      lineas,
      estado: estado.estado,
      vigente: estado.vigente,
      ultima: estado.ultima,
      diferencia,
      precision: { desvio_prueba_anterior_pct: p.desvio_prueba_anterior_pct, rotulo: "dentro de muestra" },
      objetivo_pct: p.objetivo_pct,
      puede_aprobar: e.puedeAprobar && p.estado !== "archivada",
      alertas_importantes: importantes,
    },
    puente: { recorte: puenteRecorte, por_gm: parte.puentes },
    alertas,
    kpis: {
      siguiente: proyectado.siguiente.total,
      cierre: proyectado.enCurso.total,
      real_ac: realAc,
      real_ac_exactitud: porMarca ? "estimado" : "exacto",
      real_ac_k_prima: e.ultimoPublicado === null ? null : acReal(Y),
      proyectado_resto: restoAnual,
      anterior: totalReal(Y - 1),
      hace_dos: totalReal(Y - 2),
      hace_tres: totalReal(Y - 3),
      comparativos,
      exactitud,
    },
    series,
    tabla_mensual: { filas: filasTabla, nota: notaTabla },
    desglose: armarDesglose({ e, venta, conjunto, proyectado, kPrima, incompletos }),
    crecimientos: parte.crecimientos,
    decisiones: [decisionesDeAnio(Y, enCurso.decisiones), decisionesDeAnio(S, siguiente.decisiones)],
    apoyo,
    mayores,
    atribucion: conjunto.recortado
      ? { tiendas: atribucionTiendas, sin_atribuir: { en_curso: proyectado.sinAtribuir.enCurso, siguiente: proyectado.sinAtribuir.siguiente }, mensual: proyectado.atribucion.enCurso.mensual }
      : null,
    huella,
  };
}

/**
 * T3: por qué no hay comparada (D6, sin cambiar la regla). Puro. `pedida`: `"ninguna"` (`comparar_id=ninguna`), `"elegida"` (un id) o
 * `"por_defecto"` (ausente).
 */
export function motivoSinComparada(o: { hayComparada: boolean; pedida: "ninguna" | "elegida" | "por_defecto"; mostradaId: string; ultimaAprobadaId: string | null }): MotivoSinComparada | null {
  if (o.hayComparada) return null;
  if (o.pedida === "ninguna") return "no_pedida";
  if (o.pedida === "por_defecto") {
    if (o.ultimaAprobadaId === null) return "sin_aprobada";
    if (o.ultimaAprobadaId === o.mostradaId) return "es_la_ultima_aprobada";
  }
  return "comparada_sin_cifras";
}

/** Texto de un periodo para los mensajes: «set 2026». */
export const textoPeriodo = mesAnio;
/** Rango de meses para los mensajes: «ene–oct». */
export const textoRango = rangoMeses;
/** Para quien necesite el estado sin armar el tablero entero. */
export { aAprobacionApi };
