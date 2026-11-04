import { TIPO_TIENDA } from "@/lib/curvas/red";
import { textoMotivoTienda } from "./bloques";
import { diasDelMes, soloFecha } from "./calendario";
import { agregarFilas, type FilaCrecimiento } from "./crecimientos";
import { claveBaseDe } from "./tipos";
import type {
  BloquesAnioApi,
  CifraVentaApi,
  EstadoTiendaVenta,
  MotivoVariacion,
  PeriodoVentaApi,
  TiendaBloqueApi,
  TiendaVentaApi,
  TotalVentaApi,
  VentaPorTiendaApi,
} from "./tipos-api";

/**
 * Venta por tienda y año de un género × mundo (o del Resto) dentro de Crecimientos (ficha 07f, §3). Lógica PURA: sin base, sin HTTP y sin reloj. La importan el
 * servicio (`servicio-venta-por-tienda.ts`) y las pruebas; `variacionVenta`, `periodoCompleto` y `variacionesDeCifras` también la pantalla.
 *
 * Todo lo que muestra sale de dos fuentes: la venta publicada por tienda × mes de la función `venta_tienda_nodos` (solo tiendas de tipo Tienda) y lo que
 * la proyección guardó al calcular (`parametros.bloques`, las filas base de `Y+1` y las filas de tienda de `Y`). Nada de esto escribe ni cambia un cálculo.
 */

/** Años completos hacia atrás que se leen: `p_desde` = enero de `Y − ANIOS_ATRAS_VENTA_TIENDA` (la ficha prevé bajar a 2 si el Resto pasa de 3 s en frío). */
export const ANIOS_ATRAS_VENTA_TIENDA = 3;

/** `aaaa-mm` del primer mes que se pide para el año en curso `Y`. */
export const desdeVentaTienda = (anio: number): string => `${anio - ANIOS_ATRAS_VENTA_TIENDA}-01`;

/** Una serie de `venta_tienda_nodos`: `t` tienda, `p` periodo `aaaa-mm`, `u` unidades netas y `s` soles netos de IGV. */
export type SerieVentaTienda = { t: string; p: string; u: number; s: number };
/** Lo que devuelve `venta_tienda_nodos` (una serie por tienda × periodo con venta; `cargas`: `aaaa-mm → carga_id` publicada del rango). */
export type VentaTiendaNodos = { series: SerieVentaTienda[]; cargas: Record<string, string> };

/** La tienda tal como está hoy en M4: solo da nombre y código actuales, el tipo (para no dejar pasar un CD) y las fechas de una tienda sin `bloques`. */
export type TiendaMaestroVenta = { id: string; codigo: string; nombre: string; tipo: string; fecha_apertura: string | null; fecha_cierre: string | null };

// ─── Texto ───

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dos = (n: number) => String(n).padStart(2, "0");
const claveMes = (anio: number, mes: number) => `${anio}-${dos(mes)}`;
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** `2025-11-15` → `nov 2025`. */
function mesAnio(fecha: string): string {
  const f = soloFecha(fecha);
  return `${MESES_CORTOS[Number(f.slice(5, 7)) - 1] ?? f.slice(5, 7)} ${f.slice(0, 4)}`;
}

/** `2027-06-30` → `30 jun 2027`. */
function fechaCorta(fecha: string): string {
  const f = soloFecha(fecha);
  return `${Number(f.slice(8, 10))} ${MESES_CORTOS[Number(f.slice(5, 7)) - 1] ?? f.slice(5, 7)} ${f.slice(0, 4)}`;
}

/** `2024-03` → `mar 2024`. */
export const nombreMes = (periodo: string): string => mesAnio(`${periodo}-01`);

// ─── Periodos (columnas) ───

/** Clave de la columna «mismos meses ene–k» de un año: `2026-ac`. */
export const clavePeriodoAc = (anio: number): string => `${anio}-ac`;

/**
 * Las columnas de periodo (§3.2). `publicados` son los `aaaa-mm` con carga publicada dentro del rango leído. Años completos de `Y − ANIOS_ATRAS` a `Y − 1` con al
 * menos un mes publicado, después el mismo corte ene–`k` del año anterior y el del año en curso (siempre). `meses_faltantes` lista los meses del periodo sin carga
 * publicada (también los de antes del primer mes cargado: un primer año que empieza en marzo tiene enero y febrero faltantes).
 */
export function periodosVenta(anio: number, k: number, publicados: ReadonlySet<string>): PeriodoVentaApi[] {
  const meses = (z: number, hasta: number) => Array.from({ length: hasta }, (_, i) => claveMes(z, i + 1));
  const periodo = (clave: string, z: number, hasta: number): PeriodoVentaApi => ({ clave, anio: z, hasta_mes: hasta, meses_faltantes: meses(z, hasta).filter((m) => !publicados.has(m)) });
  const salida: PeriodoVentaApi[] = [];
  for (let z = anio - ANIOS_ATRAS_VENTA_TIENDA; z <= anio - 1; z++) {
    if (meses(z, 12).some((m) => publicados.has(m))) salida.push(periodo(String(z), z, 12));
  }
  salida.push(periodo(clavePeriodoAc(anio - 1), anio - 1, k));
  salida.push(periodo(clavePeriodoAc(anio), anio, k));
  return salida;
}

/**
 * Suma las series por tienda y periodo. Un mes cuenta en todos los periodos que lo contienen (diciembre de 2025 está en «2025» y no en «2025-ac»); un mes fuera de
 * todos (octubre de 2026 con `k = 9`) no cuenta en ninguno. Los soles se suman en centavos y se devuelven con dos decimales. Solo trae las tiendas que aparecen en
 * `series` y los periodos con alguna serie: quien arma las filas completa con ceros.
 */
export function agregarSeries(series: readonly SerieVentaTienda[], periodos: readonly PeriodoVentaApi[]): Map<string, Record<string, CifraVentaApi>> {
  const acumulado = new Map<string, Map<string, { u: number; centavos: number }>>();
  for (const s of series) {
    const anio = Number(s.p.slice(0, 4));
    const mes = Number(s.p.slice(5, 7));
    for (const p of periodos) {
      if (p.anio !== anio || mes > p.hasta_mes) continue;
      const porPeriodo = acumulado.get(s.t) ?? new Map<string, { u: number; centavos: number }>();
      const x = porPeriodo.get(p.clave) ?? { u: 0, centavos: 0 };
      x.u += Number(s.u);
      x.centavos += Math.round(Number(s.s) * 100);
      porPeriodo.set(p.clave, x);
      acumulado.set(s.t, porPeriodo);
    }
  }
  const salida = new Map<string, Record<string, CifraVentaApi>>();
  for (const [t, porPeriodo] of acumulado) {
    salida.set(t, Object.fromEntries([...porPeriodo].map(([clave, x]) => [clave, { u: x.u, s: x.centavos / 100 }])));
  }
  return salida;
}

/**
 * ¿La tienda estuvo abierta todo el periodo? Un año completo exige apertura ≤ `Z-01-01` y cierre nulo o ≥ `Z-12-31`; un periodo ene–`k` exige apertura ≤ `Z-01-01` y cierre
 * nulo o ≥ el último día de `k`. Sin fecha de apertura no se puede afirmar y vale `false`.
 */
export function periodoCompleto(fechaApertura: string | null, fechaCierre: string | null, anio: number, hastaMes: number): boolean {
  if (!fechaApertura) return false;
  if (soloFecha(fechaApertura) > `${anio}-01-01`) return false;
  if (!fechaCierre) return true;
  return soloFecha(fechaCierre) >= `${claveMes(anio, hastaMes)}-${dos(diasDelMes(anio, hastaMes))}`;
}

// ─── Variaciones (§3.4) ───

export type VariacionVenta = { pct: number | null; motivo: MotivoVariacion | null };

/**
 * `variacionVenta(anterior, actual, { parcial, incompleto })`: un `%` o el motivo por el que no se puede dar. Precedencia: `incompleto` (falta un mes publicado en uno
 * de los dos periodos: ninguna cifra es fiable), `nueva` (el anterior es 0 y el actual es mayor que 0), `sin_dato` (los dos son 0, o el anterior es negativo),
 * `parcial` (la tienda no estuvo abierta todo uno de los dos periodos) y, si nada de eso, `(actual − anterior) ÷ anterior × 100`.
 */
export function variacionVenta(anterior: number, actual: number, opciones: { parcial?: boolean; incompleto?: boolean } = {}): VariacionVenta {
  if (opciones.incompleto) return { pct: null, motivo: "incompleto" };
  if (anterior === 0 && actual > 0) return { pct: null, motivo: "nueva" };
  if (anterior < 0 || (anterior === 0 && actual <= 0)) return { pct: null, motivo: "sin_dato" };
  if (opciones.parcial) return { pct: null, motivo: "parcial" };
  return { pct: ((actual - anterior) / anterior) * 100, motivo: null };
}

/** Las comparaciones de la tabla (§3.4) que existen en `periodos`: `2024 ÷ 2023`, `2025 ÷ 2024`, `2026-ac ÷ 2025-ac` y el vigente frente al año anterior completo. */
export function paresVariacion(anio: number, periodos: readonly PeriodoVentaApi[]): { clave: string; contra: string }[] {
  const hay = new Set(periodos.map((p) => p.clave));
  const pares = [
    { clave: String(anio - 2), contra: String(anio - 3) },
    { clave: String(anio - 1), contra: String(anio - 2) },
    { clave: clavePeriodoAc(anio), contra: clavePeriodoAc(anio - 1) },
    { clave: "vigente", contra: String(anio - 1) },
  ];
  return pares.filter((p) => (p.clave === "vigente" || hay.has(p.clave)) && hay.has(p.contra));
}

export type VariacionDePar = { clave: string; contra: string; u: VariacionVenta; s: VariacionVenta | null };

/**
 * Las variaciones de una fila (o de un subtotal) en unidades y en soles. `cifras` trae `u` y `s` por clave de periodo y `vigente` (solo unidades; sin él, el par
 * `vigente` no sale). `completo(clave)` dice si la tienda estuvo abierta todo ese periodo (`vigente` = todo el año en curso). El `vigente` no lleva soles (`s = null`).
 */
export function variacionesDeCifras(args: {
  anio: number;
  periodos: readonly PeriodoVentaApi[];
  cifras: Readonly<Record<string, CifraVentaApi>>;
  vigente?: number | null;
  completo: (clave: string) => boolean;
}): VariacionDePar[] {
  const faltantes = new Map(args.periodos.map((p) => [p.clave, p.meses_faltantes.length > 0]));
  const salida: VariacionDePar[] = [];
  for (const par of paresVariacion(args.anio, args.periodos)) {
    const antes = args.cifras[par.contra] ?? { u: 0, s: 0 };
    // El vigente es el real ene–k del año en curso más lo proyectado: si faltan meses de ese real, tampoco es fiable.
    const clavePropia = par.clave === "vigente" ? clavePeriodoAc(args.anio) : par.clave;
    const incompleto = (faltantes.get(par.contra) ?? false) || (faltantes.get(clavePropia) ?? false);
    const parcial = !args.completo(par.contra) || !args.completo(par.clave);
    if (par.clave === "vigente") {
      if (args.vigente === null || args.vigente === undefined) continue;
      salida.push({ ...par, u: variacionVenta(antes.u, args.vigente, { parcial, incompleto }), s: null });
      continue;
    }
    const ahora = args.cifras[par.clave] ?? { u: 0, s: 0 };
    salida.push({
      ...par,
      u: variacionVenta(antes.u, ahora.u, { parcial, incompleto }),
      s: variacionVenta(antes.s, ahora.s, { parcial, incompleto }),
    });
  }
  return salida;
}

// ─── Grupos de tiendas (§3.1) ───

export type ClasificacionVenta = Pick<TiendaVentaApi, "tienda_id" | "codigo" | "nombre" | "grupo" | "estado" | "estado_texto" | "fecha_apertura" | "fecha_cierre">;

type EnBloque = { lista: "mismas" | "nuevas" | "cierres" | "fuera"; item: TiendaBloqueApi };

function indiceDeBloques(b: BloquesAnioApi | undefined): Map<string, EnBloque> {
  const salida = new Map<string, EnBloque>();
  if (!b) return salida;
  for (const lista of ["mismas", "nuevas", "cierres", "fuera"] as const) for (const item of b[lista] ?? []) salida.set(item.tienda_id, { lista, item });
  return salida;
}

/** Los ids de las tiendas de la base: `bloques[Y+1].mismas`, también las que no vendieron nada. */
export const idsDeBase = (bloquesSig: BloquesAnioApi | undefined): string[] => (bloquesSig?.mismas ?? []).map((t) => t.tienda_id);

/**
 * Clasifica tiendas con los `bloques` que la proyección guardó al calcular (no con M4 de hoy): `misma` y `entra` van a la base; `sale`, `abrio_en_curso`, `cerro`, `otra`
 * y `sin_bloque` van fuera. `maestro` solo pone el nombre y el código actuales y, para `sin_bloque`, las fechas. Una tienda que está en `Y+1.mismas` y no en `Y.mismas`
 * ni en `Y.nuevas` (no pasa si ambos años se calcularon juntos) se lee como `misma`.
 */
export function clasificarTiendasVenta(args: {
  anio: number;
  bloquesY: BloquesAnioApi | undefined;
  bloquesSig: BloquesAnioApi | undefined;
  ids: Iterable<string>;
  maestro: ReadonlyMap<string, TiendaMaestroVenta>;
}): Map<string, ClasificacionVenta> {
  const { anio } = args;
  const enY = indiceDeBloques(args.bloquesY);
  const enSig = indiceDeBloques(args.bloquesSig);
  const salida = new Map<string, ClasificacionVenta>();
  for (const id of args.ids) {
    const y = enY.get(id);
    const s = enSig.get(id);
    const item = s?.item ?? y?.item;
    const m = args.maestro.get(id);
    const apertura = item ? item.fecha_apertura : (m?.fecha_apertura ?? null);
    const cierre = item ? item.fecha_cierre : (m?.fecha_cierre ?? null);
    const base = {
      tienda_id: id,
      codigo: m?.codigo ?? item?.codigo ?? id.slice(0, 8),
      nombre: m?.nombre ?? item?.nombre ?? "Tienda",
      fecha_apertura: apertura ? soloFecha(apertura) : null,
      fecha_cierre: cierre ? soloFecha(cierre) : null,
    };
    const poner = (grupo: "base" | "fuera", estado: EstadoTiendaVenta, estado_texto: string) => salida.set(id, { ...base, grupo, estado, estado_texto });

    if (!y && !s) {
      poner("fuera", "sin_bloque", "No existía al calcular: recalcula");
    } else if (s?.lista === "mismas") {
      if (y?.lista === "nuevas") poner("base", "entra", `Abrió en ${base.fecha_apertura ? mesAnio(base.fecha_apertura) : "el año anterior"}: entra en la base de ${anio + 1} con su ${anio} vigente`);
      else poner("base", "misma", `Misma tienda de ${anio} y de ${anio + 1}`);
    } else if (y?.lista === "mismas" && s?.lista === "cierres") {
      poner("fuera", "sale", `Cierra el ${base.fecha_cierre ? fechaCorta(base.fecha_cierre) : `de ${anio + 1}`}: su ${anio} sale de la base`);
    } else if (y?.lista === "nuevas") {
      const abrio = base.fecha_apertura ? mesAnio(base.fecha_apertura) : `${anio}`;
      poner(
        "fuera",
        "abrio_en_curso",
        s?.lista === "cierres"
          ? `Abrió en ${abrio} y cierra el ${base.fecha_cierre ? fechaCorta(base.fecha_cierre) : `de ${anio + 1}`}: no entra en la base de ${anio + 1}`
          : `Abrió en ${abrio}: en ${anio + 1} va aparte (nueva del año anterior); entra en la base de ${anio + 2}`
      );
    } else if (s?.item.motivo === "cerrada_antes" || y?.lista === "cierres") {
      poner("fuera", "cerro", base.fecha_cierre ? `Cerró el ${fechaCorta(base.fecha_cierre)}` : textoMotivoTienda("cerrada_antes", anio + 1));
    } else {
      poner("fuera", "otra", textoMotivoTienda((s ?? y)?.item.motivo ?? "otra", anio + 1));
    }
  }
  return salida;
}

// ─── Vigente de las filas de tienda ───

/** Una fila de tienda activa con su registro de `Y` en el bloque `nuevas`: `vigente = decidido ?? propuesto ?? 0`. La lee el servicio, ya filtrada a los nodos del conjunto. */
export type FilaTiendaNueva = { tienda_id: string; clave: string; vigente: number };

/**
 * El vigente de `Y` de las tiendas con filas `nuevas` (§3.3, paso 1). `paraBase` solo suma las filas cuya fila base (`claveBase`: misma GML-AM, sin tienda) es una de
 * `clavesBaseConB`, las del conjunto con `B ≠ null`: es exactamente el sumando que `recalcularBaseSiguiente` agrega a `B`. Una fila sin fila base o con `B = null` no suma
 * ahí. `todas` suma todas las filas del conjunto (el vigente exacto de una apertura de `Y`, que no entra en `B`).
 */
export function vigentesDeTiendasNuevas(filas: readonly FilaTiendaNueva[], clavesBaseConB: ReadonlySet<string>): { paraBase: Map<string, number>; todas: Map<string, number> } {
  const paraBase = new Map<string, number>();
  const todas = new Map<string, number>();
  for (const f of filas) {
    todas.set(f.tienda_id, (todas.get(f.tienda_id) ?? 0) + f.vigente);
    if (clavesBaseConB.has(claveBaseDe(f.clave))) paraBase.set(f.tienda_id, (paraBase.get(f.tienda_id) ?? 0) + f.vigente);
  }
  return { paraBase, todas };
}

// ─── Atribución del vigente de la base (§3.3) ───

export type EntradaAtribucion = {
  /** `Σ B` del conjunto (las filas con `B ≠ null`). */
  total: number;
  /** Tiendas que entran → su vigente exacto de `Y`. */
  entran: ReadonlyMap<string, number>;
  /** Las `misma` con su real ene–`k` de `Y` en el conjunto. Un real negativo pesa 0. */
  mismas: readonly { tienda_id: string; codigo: string; real: number }[];
};

export type SalidaAtribucion = {
  /** Vigente de cada tienda de la base: las que entran (exacto) y las `misma` (reparto). */
  porTienda: Map<string, number>;
  /** Lo que no se pudo repartir; puede ser negativo (`R < 0`). */
  sinAtribuir: number;
  /** `R = Σ B − Σ V` de las que entran: lo que se reparte entre las `misma`. */
  resto: number;
};

/**
 * Reparte el vigente informativo de la base entre sus tiendas (§3.3). `R = Σ B − Σ V(entran)` se reparte entre las `misma` en proporción a `max(0, real)`, en enteros por
 * mayor resto y rompiendo empates por código de tienda. Si todas pesan 0, si no hay `misma` o si `R < 0`, todo `R` va a `sinAtribuir`. Invariante, exacto en enteros:
 * `Σ porTienda + sinAtribuir = total`.
 */
export function atribuirBase(e: EntradaAtribucion): SalidaAtribucion {
  const porTienda = new Map<string, number>();
  let vEntran = 0;
  for (const [id, v] of e.entran) {
    const x = Math.round(v);
    porTienda.set(id, x);
    vEntran += x;
  }
  const total = Math.round(e.total);
  const resto = total - vEntran;
  const mismas = [...e.mismas].sort((a, b) => a.codigo.localeCompare(b.codigo, "es") || a.tienda_id.localeCompare(b.tienda_id));
  const pesos = mismas.map((t) => Math.max(0, Math.round(t.real)));
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (resto <= 0 || suma === 0) {
    for (const t of mismas) porTienda.set(t.tienda_id, 0);
    return { porTienda, sinAtribuir: resto, resto };
  }
  // Mayor resto en enteros: `piso = ⌊R × w ÷ W⌋`, `fraccion = (R × w) mod W`; los que sobran van a las mayores fracciones (empate: código, ya en orden).
  const partes = mismas.map((t, i) => ({ t, piso: Math.floor((resto * pesos[i]) / suma), fraccion: (resto * pesos[i]) % suma, orden: i }));
  let sobran = resto - partes.reduce((a, p) => a + p.piso, 0);
  const porFraccion = [...partes].sort((a, b) => b.fraccion - a.fraccion || a.orden - b.orden);
  for (const p of porFraccion) {
    if (sobran <= 0) break;
    p.piso += 1;
    sobran -= 1;
  }
  for (const p of partes) porTienda.set(p.t.tienda_id, p.piso);
  return { porTienda, sinAtribuir: 0, resto };
}

// ─── Totales ───

const cifraCero = (): CifraVentaApi => ({ u: 0, s: 0 });

/** Suma de las cifras de unas tiendas por periodo; los soles en centavos para no arrastrar errores de coma flotante. */
function sumarPeriodos(tiendas: readonly TiendaVentaApi[], periodos: readonly PeriodoVentaApi[]): Record<string, CifraVentaApi> {
  const salida: Record<string, CifraVentaApi> = {};
  for (const p of periodos) {
    let u = 0;
    let centavos = 0;
    for (const t of tiendas) {
      const c = t.periodos[p.clave] ?? cifraCero();
      u += c.u;
      centavos += Math.round(c.s * 100);
    }
    salida[p.clave] = { u, s: centavos / 100 };
  }
  return salida;
}

/** Subtotal de unas tiendas: cifras por periodo y, por clave de periodo (y `vigente`), los códigos cuyo periodo no es completo (la variación comparable las excluye). */
export function totalDe(tiendas: readonly TiendaVentaApi[], periodos: readonly PeriodoVentaApi[], anio: number, vigente: number | null): TotalVentaApi {
  const noComparables: Record<string, string[]> = {};
  for (const p of periodos) {
    const codigos = tiendas.filter((t) => t.periodos[p.clave]?.completo === false).map((t) => t.codigo);
    if (codigos.length > 0) noComparables[p.clave] = codigos;
  }
  const noVigente = tiendas.filter((t) => !periodoCompleto(t.fecha_apertura, t.fecha_cierre, anio, 12)).map((t) => t.codigo);
  if (noVigente.length > 0) noComparables.vigente = noVigente;
  return { periodos: sumarPeriodos(tiendas, periodos), vigente, no_comparables: noComparables };
}

// ─── Armado de la respuesta ───

export type EntradaVentaPorTienda = {
  conjunto: VentaPorTiendaApi["conjunto"];
  anio: number;
  /** `aaaa-mm` del último mes cerrado con que se calculó la proyección. */
  hastaPeriodo: string;
  k: number;
  versionMetodo: number | null;
  series: readonly SerieVentaTienda[];
  cargas: Readonly<Record<string, string>>;
  bloquesY: BloquesAnioApi | undefined;
  bloquesSig: BloquesAnioApi | undefined;
  maestro: ReadonlyMap<string, TiendaMaestroVenta>;
  /** Las filas base activas de `Y+1` del conjunto (las mismas que agrega `GET …/crecimientos`). */
  filasBase: readonly FilaCrecimiento[];
  /** El vigente de `Y` de las tiendas con filas `nuevas` en el conjunto: ver `vigentesDeTiendasNuevas`. */
  vigentes: { paraBase: ReadonlyMap<string, number>; todas: ReadonlyMap<string, number> };
  /** `resumen.gm_fuera_base` del conjunto (filas con `B` nulo y su venta de `Y`). */
  fueraBase: { filas: number; unidades: number } | null;
};

const esTiendaDeVenta = (m: TiendaMaestroVenta | undefined, b: EnBloque | undefined, b2: EnBloque | undefined): boolean =>
  (m ? m.tipo === TIPO_TIENDA : true) && b?.item.motivo !== "cd" && b2?.item.motivo !== "cd";

/**
 * Arma la respuesta completa. Excluye cualquier serie que no sea de una tienda de tipo Tienda (la función SQL ya lo hace; aquí es una segunda red), completa con ceros las
 * tiendas de la base que no vendieron, clasifica con los `bloques` guardados, reparte el vigente de la base y calcula subtotales, variaciones comparables y avisos.
 */
export function armarVentaPorTienda(e: EntradaVentaPorTienda): VentaPorTiendaApi {
  const { anio, k } = e;
  const publicados = new Set(Object.keys(e.cargas));
  const periodos = periodosVenta(anio, k, publicados);
  const enY = indiceDeBloques(e.bloquesY);
  const enSig = indiceDeBloques(e.bloquesSig);
  const permitida = (id: string) => esTiendaDeVenta(e.maestro.get(id), enY.get(id), enSig.get(id));

  const series = e.series.filter((s) => permitida(s.t));
  const cifras = agregarSeries(series, periodos);
  const conVenta = new Set(series.filter((s) => s.u !== 0 || s.s !== 0).map((s) => s.t));

  const agregado = agregarFilas(e.filasBase);
  const motivoNulo: VentaPorTiendaApi["base"]["motivo_nulo"] = (e.versionMetodo ?? 0) < 4 ? "metodo_anterior" : e.filasBase.length === 0 ? "sin_filas" : null;
  const total = motivoNulo === null ? agregado.base : null;
  const corregida = motivoNulo === null ? agregado.base_normalizada : null;

  // Quién aparece: toda la base (aunque no haya vendido) y, fuera, solo quien vendió algo en el rango o tiene un vigente de `Y` distinto de 0.
  const idsBase = idsDeBase(e.bloquesSig).filter(permitida);
  const idsFuera = new Set<string>([...conVenta, ...[...e.vigentes.todas].filter(([, v]) => v !== 0).map(([id]) => id)].filter(permitida));
  const clasificadas = clasificarTiendasVenta({ anio, bloquesY: e.bloquesY, bloquesSig: e.bloquesSig, ids: new Set([...idsBase, ...idsFuera]), maestro: e.maestro });

  const claveAc = clavePeriodoAc(anio);
  const realY = (id: string) => cifras.get(id)?.[claveAc]?.u ?? 0;

  // Atribución del vigente (solo con base): las que entran van exactas; las `misma` reciben el resto por mayor resto.
  let atribuido: SalidaAtribucion | null = null;
  if (total !== null) {
    const entran = new Map<string, number>();
    const mismas: EntradaAtribucion["mismas"][number][] = [];
    for (const c of clasificadas.values()) {
      if (c.estado === "entra") entran.set(c.tienda_id, e.vigentes.paraBase.get(c.tienda_id) ?? 0);
      else if (c.estado === "misma") mismas.push({ tienda_id: c.tienda_id, codigo: c.codigo, real: realY(c.tienda_id) });
    }
    atribuido = atribuirBase({ total, entran, mismas });
  }

  const tiendas: TiendaVentaApi[] = [...clasificadas.values()].map((c) => {
    const propios = cifras.get(c.tienda_id) ?? {};
    const porPeriodo: TiendaVentaApi["periodos"] = {};
    for (const p of periodos) {
      const x = propios[p.clave] ?? cifraCero();
      porPeriodo[p.clave] = { ...x, completo: periodoCompleto(c.fecha_apertura, c.fecha_cierre, p.anio, p.hasta_mes) };
    }
    let vigente: TiendaVentaApi["vigente"] = null;
    if (total !== null && atribuido) {
      const real = realY(c.tienda_id);
      if (c.grupo === "base") {
        const u = atribuido.porTienda.get(c.tienda_id) ?? 0;
        vigente = { u, real, proyectado: u - real, exacto: c.estado === "entra" };
      } else if (c.estado !== "sale") {
        const exacto = e.vigentes.todas.get(c.tienda_id) ?? 0;
        if (c.estado === "abrio_en_curso" || exacto !== 0) vigente = { u: exacto, real, proyectado: exacto - real, exacto: true };
      }
    }
    return { ...c, periodos: porPeriodo, vigente };
  });
  const orden = (a: TiendaVentaApi, b: TiendaVentaApi) =>
    (a.grupo === b.grupo ? 0 : a.grupo === "base" ? -1 : 1) || (b.periodos[claveAc]?.u ?? 0) - (a.periodos[claveAc]?.u ?? 0) || a.codigo.localeCompare(b.codigo, "es") || a.tienda_id.localeCompare(b.tienda_id);
  tiendas.sort(orden);

  const delGrupo = (g: "base" | "fuera") => tiendas.filter((t) => t.grupo === g);
  const sinAtribuir = atribuido?.sinAtribuir ?? 0;

  // Avisos.
  const avisos: VentaPorTiendaApi["avisos"] = [];
  if (e.fueraBase && e.fueraBase.filas > 0) {
    const n = e.fueraBase.filas;
    avisos.push({
      codigo: "filas_sin_base",
      mensaje: `${n} ${n === 1 ? "fila sin curva vendió" : "filas sin curva vendieron"} ${miles(e.fueraBase.unidades)} u en ${anio}: no entran en la base y sí en el real por tienda.`,
    });
  }
  const faltantes = [...new Set(periodos.flatMap((p) => p.meses_faltantes))].sort();
  if (faltantes.length > 0) {
    avisos.push({
      codigo: "meses_faltantes",
      mensaje: `Faltan cargas de venta publicadas: ${faltantes.map(nombreMes).join(", ")}. Las variaciones que usan esos meses salen «incompleto».`,
    });
  }
  if (total !== null && sinAtribuir !== 0) {
    avisos.push({
      codigo: "sin_atribuir",
      mensaje:
        sinAtribuir > 0
          ? `${miles(sinAtribuir)} u de la base de ${anio + 1} no se pueden repartir entre las mismas tiendas porque ninguna vendió en ${anio} en este conjunto. Se muestran en «Sin atribuir a tienda».`
          : `Las tiendas que entran ya suman ${miles(-sinAtribuir)} u más que la base de ${anio + 1}. Ese exceso se muestra en «Sin atribuir a tienda».`,
    });
  }
  for (const t of tiendas.filter((x) => x.estado === "sin_bloque")) {
    avisos.push({ codigo: "sin_bloque", mensaje: `${t.codigo} no existía al calcular la proyección y queda fuera de la base. Recalcula para clasificarla.` });
  }

  return {
    conjunto: e.conjunto,
    anio_en_curso: anio,
    anio_siguiente: anio + 1,
    hasta_periodo: e.hastaPeriodo,
    k,
    periodos,
    base: {
      total,
      corregida,
      tiendas: idsBase.length,
      entran: tiendas.filter((t) => t.estado === "entra").map((t) => t.codigo).sort((a, b) => a.localeCompare(b, "es")),
      sin_atribuir: sinAtribuir,
      motivo_nulo: motivoNulo,
    },
    tiendas,
    totales: {
      base: totalDe(delGrupo("base"), periodos, anio, total),
      fuera: totalDe(delGrupo("fuera"), periodos, anio, null),
      conjunto: totalDe(tiendas, periodos, anio, null),
    },
    avisos,
  };
}
