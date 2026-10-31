import type { Json } from "@/lib/supabase/database.types";
import type { LineaBaseIa } from "./entrada";
import type { PayloadRegistroIa } from "./consultas";
import { asignarMeta, avisoBrechaExtrema, banderasEsfuerzo, escalarASubMetas, esfuerzoGM, type PesoFilaMeta } from "./meta";
import type { BloqueGMIa, MetaEntradaIa } from "./tipos";
import type { AvisoIa, BanderaIa, EstadoMetaFila, MetaGMApi, SenalIa } from "./tipos-api";
import type { ResultadoLineas, ResultadoNatural, ResultadoReparto } from "./validar";

/**
 * Composición de la propuesta de un GM a partir de lo que devolvió cada paso (ficha 07e, §3.8, §5.1 y §5.2). Pura: no lee ni escribe nada. El
 * código es quien garantiza la exactitud de la meta: la IA aporta pesos y el reparto por mayor resto (`asignarMeta`) hace que `Σ A = Meta_libre`.
 * Sirve igual a una propuesta de producción y a un GM de evaluación.
 */

/** Una fila base del GM al planificar: libre o fija (las de cola larga y sin base no se guardan por fila). */
export type FilaBaseFinal = {
  /** Id corto con que viajó (`f001`); `null` si la fila no viajó al proveedor. */
  f: string | null;
  fila_id: string | null;
  fila_clave: string;
  estado_meta: Extract<EstadoMetaFila, "libre" | "fija_decidida" | "fija_pct">;
  base: number | null;
  base_corregida: number | null;
  /** `P^GM_f`. */
  p_gm: number | null;
  /** Solo fijas: su vigente de `Y+1`. */
  aporte_fijo: number | null;
  /** `B^s`: base de la meta (corregida o bruta). */
  base_s: number | null;
};

/** Línea del modo jerárquico con lo que hace falta para su sub-meta de respaldo. */
export type LineaBasePlan = LineaBaseIa & { p_gm: number; base_s: number };

/** Lo que el primer paso (o `preparar`, en una evaluación) deja en `ia_corrida_gms.parcial._`: la foto del GM al planificar. */
export type EstadoPlanIa = {
  v: 1;
  genero_id: string;
  mundo_id: string;
  es_resto: boolean;
  version_metodo: number;
  huella_historia: string;
  meta: MetaGMApi | null;
  meta_entrada: Omit<MetaEntradaIa, "del_lote"> | null;
  filas: FilaBaseFinal[];
  lineas_base: LineaBasePlan[];
  avisos_plan: AvisoIa[];
  /** El lote ya se partió una vez por un corte de salida (solo se parte una vez). */
  partido: boolean;
  /** Resumen de errores (sin datos) para el único reintento por salida inválida del paso `paso`. */
  correccion: { paso: string; resumen: string } | null;
};

export const SIN_RAZON = undefined;

/** `meta.libre > 0`: hay algo que repartir. Sin meta (o con las fijas por encima), solo se pide el natural. */
export const hayReparto = (e: Pick<EstadoPlanIa, "meta">): boolean => e.meta !== null && e.meta.meta_libre > 0;

/** Resultados validados de los pasos de un GM. */
export type SalidasPasos = {
  naturales: readonly ResultadoNatural[];
  repartos: readonly ResultadoReparto[];
  lineas: (ResultadoLineas & { sub_metas: Record<string, number> }) | null;
};

export type PropuestaCompuesta = {
  payload: Omit<NonNullable<PayloadRegistroIa["propuesta"]>, "huella_gm" | "capacidades" | "modo" | "perfil_id" | "usuario_nombre">;
  filas: NonNullable<PayloadRegistroIa["filas"]>;
  /** `fila_clave → meta_y1_al_generar` (el reparto vigente al generar). */
  reparto: Map<string, number>;
};

const unicos = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compone la propuesta del GM. `modo` directo: el peso de cada fila es su `meta_y1` del reparto; jerárquico: su `meta_y1` escalado a la sub-meta de su
 * línea (la de la llamada `lineas`, o `Σ P^GM` de sus libres si faltó). Una fila sin cifra queda con `meta_y1_modelo = null` (peso `P^GM` al leer).
 */
export function componerPropuesta(args: { plan: EstadoPlanIa; bloques: readonly BloqueGMIa[]; modo: "directo" | "jerarquico"; salidas: SalidasPasos }): PropuestaCompuesta {
  const { plan, salidas } = args;
  const filasBloque = new Map(args.bloques.flatMap((b) => b.filas.map((f) => [f.f, f] as const)));
  const lineaDeF = new Map(args.bloques.flatMap((b) => b.filas.map((f) => [f.f, f.l] as const)));
  const naturalPorF = new Map(salidas.naturales.flatMap((r) => r.filas.map((f) => [f.f, f] as const)));
  const repartoPorF = new Map(salidas.repartos.flatMap((r) => r.filas.map((f) => [f.f, f] as const)));
  const libres = plan.filas.filter((f) => f.estado_meta === "libre").sort((a, b) => porTexto(a.fila_clave, b.fila_clave));
  const conReparto = hayReparto(plan);

  // Peso de cada fila libre: la cifra del modelo (escalada a la sub-meta de su línea en el modo jerárquico).
  const pesoModelo = new Map<string, number | null>();
  const cifra = (f: FilaBaseFinal): number | null => (f.f === null ? null : (repartoPorF.get(f.f)?.meta_y1 ?? null));
  if (conReparto) {
    if (args.modo === "directo") {
      for (const f of libres) pesoModelo.set(f.fila_clave, cifra(f));
    } else {
      const subMetas = new Map(Object.entries(salidas.lineas?.sub_metas ?? {}));
      const filasPeso = libres.map((f) => ({
        fila_id: f.fila_clave,
        clave: f.fila_clave,
        l: f.f === null ? "" : (lineaDeF.get(f.f) ?? ""),
        p_gm: f.p_gm ?? 0,
        meta_y1_modelo: cifra(f),
        natural_y1: f.f === null ? null : (naturalPorF.get(f.f)?.natural_y1 ?? null),
        base_s: f.base_s,
      }));
      const escalado = escalarASubMetas(subMetas, filasPeso);
      // Una fila sin cifra del modelo conserva `null` (su peso de respaldo se aplica al leer); el resto queda con su cifra escalada.
      for (const f of libres) pesoModelo.set(f.fila_clave, cifra(f) === null ? null : (escalado.get(f.fila_clave) ?? null));
    }
  } else for (const f of libres) pesoModelo.set(f.fila_clave, null);

  // Lo que vale cada libre con la meta y las fijas de ESTE momento (referencia de la absorción).
  const pesos: PesoFilaMeta[] = libres.map((f) => ({
    fila_id: f.fila_clave,
    clave: f.fila_clave,
    p_gm: f.p_gm ?? 0,
    meta_y1_modelo: pesoModelo.get(f.fila_clave) ?? null,
    natural_y1: f.f === null ? null : (naturalPorF.get(f.f)?.natural_y1 ?? null),
    base_s: f.base_s,
  }));
  const asignacion = conReparto && plan.meta ? asignarMeta(plan.meta.meta_libre, pesos) : { a: null, avisos_fila: new Map<string, AvisoIa[]>(), avisos_gm: [] as AvisoIa[] };
  const reparto = new Map<string, number>(asignacion.a ?? []);

  const filas: NonNullable<PayloadRegistroIa["filas"]> = [];
  for (const f of plan.filas) {
    const enBloque = f.f === null ? undefined : filasBloque.get(f.f);
    const senales: SenalIa[] = enBloque?.senales.lista ?? [];
    if (f.estado_meta !== "libre") {
      filas.push({
        ...(f.fila_id === null ? {} : { fila_id: f.fila_id }),
        fila_clave: f.fila_clave,
        estado_meta: f.estado_meta,
        ...(f.base === null ? {} : { base_al_generar: f.base }),
        ...(f.base_corregida === null ? {} : { base_corregida_al_generar: f.base_corregida }),
        ...(f.p_gm === null ? {} : { p_gm_al_generar: f.p_gm }),
        ...(f.aporte_fijo === null ? {} : { aporte_fijo_al_generar: f.aporte_fijo }),
        banderas: [],
        senales,
        avisos: [],
      });
      continue;
    }
    const nat = f.f === null ? undefined : naturalPorF.get(f.f);
    const rep = f.f === null ? undefined : repartoPorF.get(f.f);
    const modelo = pesoModelo.get(f.fila_clave) ?? null;
    const a = reparto.get(f.fila_clave) ?? null;
    const avisos: AvisoIa[] = unicos([...(nat?.avisos ?? []), ...(rep?.avisos ?? []), ...(asignacion.avisos_fila.get(f.fila_clave) ?? [])]);
    if (nat?.natural_y1 !== undefined && a !== null) {
      const extrema = avisoBrechaExtrema(a, nat.natural_y1);
      if (extrema && !avisos.includes(extrema)) avisos.push(extrema);
    }
    if (nat === undefined && !avisos.includes("sin_propuesta_ia")) avisos.push("sin_propuesta_ia");
    filas.push({
      ...(f.fila_id === null ? {} : { fila_id: f.fila_id }),
      fila_clave: f.fila_clave,
      estado_meta: "libre",
      ...(f.base === null ? {} : { base_al_generar: f.base }),
      ...(f.base_corregida === null ? {} : { base_corregida_al_generar: f.base_corregida }),
      ...(f.p_gm === null ? {} : { p_gm_al_generar: f.p_gm }),
      ...(nat?.natural_y1 === undefined || nat.natural_y1 === null ? {} : { natural_y1: nat.natural_y1 }),
      ...(nat ? { razon_natural: nat.razon_natural } : {}),
      ...(modelo === null ? {} : { meta_y1_modelo: modelo }),
      ...(a === null ? {} : { meta_y1_al_generar: a }),
      ...(rep ? { razon: rep.razon } : {}),
      banderas: unicos<BanderaIa>([...(nat?.banderas ?? []), ...(rep?.banderas ?? [])]),
      senales,
      avisos,
      ...(nat ? { confianza: nat.confianza } : {}),
    });
  }

  // GM: razón, banderas, avisos y desvío de la suma del modelo.
  const directo = args.modo === "directo";
  const reparto0 = salidas.repartos[0];
  const razon_gm = !conReparto ? undefined : directo ? reparto0?.razon_gm : salidas.lineas?.razon_gm;
  const banderasModelo: readonly BanderaIa[] = !conReparto ? [] : directo ? (reparto0?.banderas_gm ?? []) : (salidas.lineas?.banderas_gm ?? []);
  const naturales = libres.map((f) => (f.f === null ? null : (naturalPorF.get(f.f)?.natural_y1 ?? null)));
  const esfuerzo = conReparto && plan.meta ? esfuerzoGM(plan.meta.meta_libre, naturales) : null;
  const avisosGM: AvisoIa[] = unicos<AvisoIa>([
    ...plan.avisos_plan,
    ...salidas.naturales.flatMap((r) => r.avisos_gm),
    ...salidas.repartos.flatMap((r) => r.avisos_gm),
    ...(salidas.lineas?.avisos_gm ?? []),
    ...asignacion.avisos_gm,
  ]);
  const desvio = conReparto ? (directo ? (reparto0?.desvio_suma_modelo ?? null) : (salidas.lineas?.desvio_suma_modelo ?? null)) : null;
  const filasValidas = libres.filter((f) => (conReparto ? pesoModelo.get(f.fila_clave) !== null : f.f !== null && naturalPorF.get(f.f)?.natural_y1 !== undefined && naturalPorF.get(f.f)?.natural_y1 !== null)).length;
  return {
    payload: {
      genero_id: plan.genero_id,
      mundo_id: plan.mundo_id,
      es_resto: plan.es_resto,
      version_metodo: plan.version_metodo,
      ...(plan.meta ? { meta: plan.meta as unknown as Json } : {}),
      huella_historia: plan.huella_historia,
      ...(razon_gm === undefined ? {} : { razon_gm }),
      banderas_gm: unicos<string>([...banderasModelo, ...banderasEsfuerzo(esfuerzo)]),
      avisos: avisosGM,
      filas_pedidas: libres.length,
      filas_validas: filasValidas,
      ...(desvio === null ? {} : { desvio_suma_modelo: Math.round(desvio * 1e4) / 1e4 }),
    },
    filas,
    reparto,
  };
}
