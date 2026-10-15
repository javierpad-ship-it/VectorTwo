import { aPeriodo, recortarPeriodo } from "@/lib/ventas/periodo";
import { ruidoNormal } from "./atipicos";
import { anioDe, mesesDelAnio, participacion, redondear, sumar } from "./anios";
import { eat } from "./backtesting";
import type { MotivoRed, ParametrosCurvas, RedAnio, RedTiendaAnio } from "./tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "./tipos";

/**
 * Red comparable por año, por fechas y por datos (docs/modulos/06-curvas-estacionalidad.md,
 * "Red comparable por año" y reglas 4 a 4d). Funciones puras: sin base, sin HTTP.
 *
 * Para la participación del año `Y` solo cuentan las tiendas que estuvieron TODO
 * el año. Se decide una vez por corrida, por tienda y año, sobre la venta TOTAL
 * de la tienda (nunca por agrupación).
 */

export type ParametrosRed = Pick<
  ParametrosCurvas,
  | "solo_tiendas_completas"
  | "exigir_venta_todo_el_ano"
  | "meses_tienda_nueva"
  | "umbral_tienda_dominante"
  | "umbral_forma"
  | "peso_minimo_diagnostico"
>;

export const TIPO_TIENDA = "Tienda";

const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

const dos = (n: number) => String(n).padStart(2, "0");

/** Último día de un mes `aaaa-mm` como `aaaa-mm-dd` (sin `Date`). */
export function ultimoDiaDelMes(periodo: string): string {
  const [a, m] = recortarPeriodo(periodo).split("-").map(Number);
  const dias = m === 2 && esBisiesto(a) ? 29 : DIAS_MES[m - 1];
  return `${a}-${dos(m)}-${dos(dias)}`;
}

/** `aaaa-mm-dd` más `n` meses; el día se recorta al último del mes de llegada. */
export function sumarMesesAFecha(fecha: string, n: number): string {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const indice = a * 12 + (m - 1) + n;
  const anio = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  const tope = mes === 2 && esBisiesto(anio) ? 29 : DIAS_MES[mes - 1];
  return `${anio}-${dos(mes)}-${dos(Math.min(d, tope))}`;
}

/** Primer año `Y` tal que `fecha ≤ Y-01-01`. */
function primerAnioDesde(fecha: string): number {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  return m === 1 && d === 1 ? a : a + 1;
}

type VentaIndexada = Map<string, Map<string, number>>;

function indexarVenta(venta: readonly VentaTiendaMes[]): VentaIndexada {
  const indice: VentaIndexada = new Map();
  for (const v of venta) {
    const porMes = indice.get(v.tienda_id) ?? new Map<string, number>();
    const periodo = recortarPeriodo(v.periodo);
    porMes.set(periodo, (porMes.get(periodo) ?? 0) + v.unidades);
    indice.set(v.tienda_id, porMes);
  }
  return indice;
}

/** Valores `max(0, u)` de los doce meses de un año de una tienda (0 donde no hay fila o no se exige). */
function seriesDeTienda(porMes: Map<string, number> | undefined, anio: number, habilitados: ReadonlySet<string>): number[] {
  return mesesDelAnio(anio).map((m) => (habilitados.has(m) ? Math.max(0, porMes?.get(m) ?? 0) : 0));
}

// ─── Diagnóstico de tiendas que se comportan distinto ───

/**
 * Diagnóstico `tienda_distinta` (requisito de Javier): para cada tienda, su
 * participación mensual, `eat_vs_red = EAT(p(t), p(agregado))` y su peso;
 * `distinta` si `eat_vs_red > max(umbral_forma, ruido ?? 0)` Y la tienda pesa al
 * menos `pesoMinimo`. Es diagnóstico: no cambia ninguna curva. Sirve para la red
 * (sobre la venta total) y para el detalle de una agrupación (sobre su venta).
 */
export function diagnosticarTiendas<T extends { unidades: readonly number[] }>(
  tiendas: readonly T[],
  participacionAgregada: readonly number[] | null,
  umbralForma: number,
  ruido: number | null,
  pesoMinimo: number
): {
  tienda: T;
  unidades: number;
  peso: number;
  participacion: number[] | null;
  eat_vs_red: number | null;
  distinta: boolean;
}[] {
  const totales = tiendas.map((t) => sumar(t.unidades));
  const total = sumar(totales);
  const umbral = Math.max(umbralForma, ruido ?? 0);
  return tiendas.map((tienda, i) => {
    const p = participacion(tienda.unidades);
    const peso = total > 0 ? totales[i] / total : 0;
    const distancia = p && participacionAgregada ? eat(p, participacionAgregada) : null;
    return {
      tienda,
      unidades: totales[i],
      peso,
      participacion: p,
      eat_vs_red: distancia,
      distinta: distancia !== null && distancia > umbral && peso >= pesoMinimo,
    };
  });
}

// ─── Regla 4: red comparable ───

export type OpcionesRed = {
  /** Años cuya participación de red mide el ruido para `distinta` (por defecto, todos los años completos con red). */
  aniosNormales?: readonly number[];
  /** Meses publicados en M5; sin esto se supone que todos los meses hasta `hastaPeriodo` lo están. */
  mesesPublicados?: Iterable<string>;
};

type Evaluada = {
  tienda: TiendaMaestro;
  entra: boolean;
  motivos: MotivoRed[];
  meses_sin_venta: string[];
  primer_mes_con_venta: string | null;
  entra_desde: number | null;
  mensual: number[];
};

/**
 * Regla 4. Decide, por año y tienda, quién forma la red comparable (condiciones
 * 1 a 4 de la ficha) y calcula pesos, participaciones, dominante y diagnóstico.
 *
 *   1. `tipo = 'Tienda'` y activa (`centro_distribucion`, `tienda_desactivada`);
 *   2. fechas de M4 (`no_abierta_todo_el_ano`; sin apertura entra con `tienda_sin_apertura`);
 *   3. tienda nueva (`tienda_nueva`, solo con `meses_tienda_nueva > 0`);
 *   4. datos de M5: unidades > 0 en cada mes exigido (`meses_sin_venta`, con los
 *      avisos `apertura_dudosa` / `cierre_dudoso`). Solo se mira si pasó 1 a 3.
 *
 * Los años posteriores a `hastaPeriodo` se ignoran. Una tienda desactivada sin
 * ninguna venta registrada no aparece (no hay hechos que mostrar).
 */
export function redComparable(
  tiendas: readonly TiendaMaestro[],
  ventaMensualPorTienda: readonly VentaTiendaMes[],
  anios: readonly number[],
  hastaPeriodo: string,
  parametros: ParametrosRed,
  opciones: OpcionesRed = {}
): RedAnio[] {
  const hasta = recortarPeriodo(hastaPeriodo);
  const venta = indexarVenta(ventaMensualPorTienda);
  const publicados = opciones.mesesPublicados ? new Set([...opciones.mesesPublicados].map(recortarPeriodo)) : null;

  // Primer y último mes con venta positiva de cada tienda, en toda su serie.
  const rango = new Map<string, { primero: string | null; ultimo: string | null }>();
  for (const [id, porMes] of venta) {
    let primero: string | null = null;
    let ultimo: string | null = null;
    for (const [periodo, u] of porMes) {
      if (u > 0) {
        if (primero === null || periodo < primero) primero = periodo;
        if (ultimo === null || periodo > ultimo) ultimo = periodo;
      }
    }
    rango.set(id, { primero, ultimo });
  }

  const visibles = tiendas.filter((t) => t.activo || (venta.get(t.id)?.size ?? 0) > 0);
  const aniosOrdenados = [...new Set(anios)].filter((a) => a <= anioDe(hasta)).sort((a, b) => a - b);

  type Parcial = { anio: number; evaluadas: Evaluada[]; habilitados: Set<string>; completo: boolean };
  const parciales: Parcial[] = aniosOrdenados.map((anio) => {
    const habilitados = new Set(
      mesesDelAnio(anio).filter((m) => m <= hasta && (publicados === null || publicados.has(m)))
    );
    const requeridos = [...habilitados].sort();
    const ultimoDia = anio === anioDe(hasta) ? ultimoDiaDelMes(hasta) : `${anio}-12-31`;
    const primerDia = `${anio}-01-01`;

    const evaluadas = visibles.map((tienda): Evaluada => {
      const porMes = venta.get(tienda.id);
      const r = rango.get(tienda.id) ?? { primero: null, ultimo: null };
      const base = {
        tienda,
        meses_sin_venta: [] as string[],
        primer_mes_con_venta: r.primero,
        entra_desde: null as number | null,
        mensual: seriesDeTienda(porMes, anio, habilitados),
      };
      const fuera = (...motivos: MotivoRed[]): Evaluada => ({ ...base, entra: false, motivos });

      // 1. Tipo y estado.
      if (tienda.tipo !== TIPO_TIENDA) return fuera("centro_distribucion");
      if (!tienda.activo) return fuera("tienda_desactivada");

      const avisos: MotivoRed[] = [];

      // 2. Fechas de M4.
      if (parametros.solo_tiendas_completas) {
        if (!tienda.fecha_apertura) {
          avisos.push("tienda_sin_apertura");
        } else if (tienda.fecha_apertura.slice(0, 10) > primerDia) {
          return fuera("no_abierta_todo_el_ano");
        }
        if (tienda.fecha_cierre && tienda.fecha_cierre.slice(0, 10) < ultimoDia) return fuera("no_abierta_todo_el_ano");
      }

      // 3. Tienda nueva.
      if (parametros.meses_tienda_nueva > 0 && tienda.fecha_apertura) {
        const cumple = sumarMesesAFecha(tienda.fecha_apertura, parametros.meses_tienda_nueva);
        if (cumple > primerDia) {
          return { ...fuera("tienda_nueva"), entra_desde: primerAnioDesde(cumple) };
        }
      }

      // 4. Datos de M5.
      if (parametros.exigir_venta_todo_el_ano) {
        const sinVenta = requeridos.filter((m) => (porMes?.get(m) ?? 0) <= 0);
        if (sinVenta.length > 0) {
          const motivos: MotivoRed[] = ["meses_sin_venta", ...avisos];
          // Tramo contiguo desde el primer mes exigido hasta el primer mes con venta positiva.
          if (
            r.primero !== null &&
            sinVenta.join() === requeridos.filter((m) => m < (r.primero as string)).join()
          ) {
            motivos.push("apertura_dudosa");
          }
          // Tramo contiguo al final, sin volver a vender.
          else if (
            r.ultimo !== null &&
            sinVenta.join() === requeridos.filter((m) => m > (r.ultimo as string)).join()
          ) {
            motivos.push("cierre_dudoso");
          }
          return { ...base, entra: false, motivos, meses_sin_venta: sinVenta };
        }
      }

      return { ...base, entra: true, motivos: avisos };
    });

    return { anio, evaluadas, habilitados, completo: habilitados.size === 12 };
  });

  // Primera pasada: totales y participación de la red de cada año.
  const preliminares = parciales.map((p) => {
    const entran = p.evaluadas.filter((e) => e.entra);
    const mensualRed = Array.from({ length: 12 }, (_, m) => sumar(entran.map((e) => e.mensual[m])));
    return { ...p, entran, mensualRed, participacionRed: participacion(mensualRed) };
  });

  const aniosParaRuido = new Set(opciones.aniosNormales ?? preliminares.filter((p) => p.completo).map((p) => p.anio));
  const ruido = ruidoNormal(
    preliminares
      .filter((p) => p.completo && aniosParaRuido.has(p.anio) && p.participacionRed !== null)
      .map((p) => p.participacionRed as number[])
  );

  return preliminares.map((p): RedAnio => {
    const diagnostico = diagnosticarTiendas(
      p.entran.map((e) => ({ id: e.tienda.id, unidades: e.mensual })),
      p.participacionRed,
      parametros.umbral_forma,
      ruido,
      parametros.peso_minimo_diagnostico
    );
    const porId = new Map(diagnostico.map((d) => [d.tienda.id, d]));
    const totalUnidades = sumar(p.mensualRed);

    const tiendasAnio: RedTiendaAnio[] = p.evaluadas.map((e) => {
      const d = porId.get(e.tienda.id);
      return {
        tienda_id: e.tienda.id,
        entra: e.entra,
        motivos: e.motivos,
        meses_sin_venta: e.meses_sin_venta,
        primer_mes_con_venta: e.primer_mes_con_venta,
        entra_desde: e.entra_desde,
        unidades: sumar(e.mensual),
        peso: d ? d.peso : 0,
        participacion: d ? d.participacion : null,
        eat_vs_red: d ? d.eat_vs_red : null,
        distinta: d ? d.distinta : false,
      };
    });

    let mayor: RedTiendaAnio | null = null;
    for (const t of tiendasAnio) if (t.entra && (mayor === null || t.peso > mayor.peso)) mayor = t;
    const dominante = mayor && mayor.peso > parametros.umbral_tienda_dominante ? mayor.tienda_id : null;

    return {
      anio: p.anio,
      tiendas: tiendasAnio,
      total_unidades: totalUnidades,
      dominante,
      peso_mayor: mayor ? redondear(mayor.peso, 6) : null,
      sin_red: p.entran.length === 0,
      participacion: p.participacionRed,
      ruido_normal: ruido,
    };
  });
}

/** Tiendas que entran en la red de un año (los ids). */
export function tiendasQueEntran(red: RedAnio | undefined): Set<string> {
  return new Set(red ? red.tiendas.filter((t) => t.entra).map((t) => t.tienda_id) : []);
}

/** Regla 8e. Tiendas comunes de dos años: `red(Y) ∩ red(N)`. */
export function tiendasComunes(redY: RedAnio | undefined, redN: RedAnio | undefined): Set<string> {
  const a = tiendasQueEntran(redY);
  const b = tiendasQueEntran(redN);
  return new Set([...a].filter((id) => b.has(id)));
}

/** `aaaa-mm` del primer mes de un año; útil para etiquetar años de entrada ("Tienda nueva hasta 2027"). */
export function primerMesDelAnio(anio: number): string {
  return aPeriodo(anio, 1);
}
