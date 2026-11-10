import { correccionMaterial } from "@/lib/proyeccion/factor-nino";
import {
  GM_CLAVE_RESTO,
  GM_CLAVE_TOTAL,
  UMBRAL_DESVIO_PP,
  UMBRAL_TENDENCIA_PP,
  type CrecimientoGMApi,
  type PorGmSql,
  type SobreBaseTablero,
  type TendenciaGmSql,
} from "./tipos-api";
import { agruparGm, type CifrasPuente } from "./puente";
import { fechaLima, variacionPct } from "./textos";

/**
 * Crecimiento declarado, implícito y tendencia por género × mundo (ficha 14, §4.8 y §4.5 «Tendencia corregida del Niño», I-E). Puro. Siempre de la
 * proyección entera: una fila por GM de los géneros de la matriz, la del Resto y, al final, la del Total.
 */

/** Lo declarado que aplicó el cálculo a un GM (`proyeccion_crecimientos` activo) con su versión de `crecimientos_genero_mundo`. */
export type DeclaradoGm = {
  genero_id: string;
  mundo_id: string;
  pct: number;
  sobre_base: SobreBaseTablero | null;
  version: number | null;
  crecimiento_id: string | null;
};

/** Una versión de `crecimientos_genero_mundo` del año siguiente (vigente o reemplazada). */
export type VersionCrecimiento = {
  id: string;
  alcance: string;
  genero_id: string | null;
  mundo_id: string | null;
  version: number;
  estado: string;
  aprobada_at: string | null;
  usuario_nombre: string | null;
  nota: string | null;
  base_valor: number | null;
};

/** El Resto que aplicó el último cálculo (`parametros.crecimiento_resto_usado`); `pct` y `sobre_base` son los de `tablero_proyeccion.resto`. */
export type RestoDeclarado = {
  pct: number | null;
  sobre_base: SobreBaseTablero | null;
  version: number | null;
  crecimiento_id: string | null;
  por_nombre: string | null;
  at: string | null;
};

export type EntradaCrecimientos = {
  porGm: readonly PorGmSql[];
  generosMatriz: ReadonlySet<string>;
  nombreDe: (generoId: string, mundoId: string) => string;
  declarados: readonly DeclaradoGm[];
  versiones: readonly VersionCrecimiento[];
  resto: RestoDeclarado;
  /** `tendencia_gm` de `tablero_venta` con `solo_tendencia` (sin filtros) y su índice de tiendas; `null` si no se pudo leer. */
  tendencia: { tiendas: readonly string[]; filas: readonly TendenciaGmSql[] } | null;
  /** `M(Y)`: las tiendas que cuentan en la tendencia de mismas tiendas. */
  mismasEnCurso: ReadonlySet<string>;
  /** Último mes publicado del año en curso (`k'`, 1 a 12): la tendencia va de enero a `k'`. */
  kPrima: number;
};

const sumaHasta = (v: readonly number[] | undefined, hasta: number): number => {
  let s = 0;
  for (let i = 0; i < hasta && i < (v?.length ?? 0); i++) s += Number(v?.[i] ?? 0);
  return s;
};

/** Tendencia de mismas tiendas de un conjunto de GM: enero a `k'` de `Y` frente a los mismos meses de `Y−1`, en `M(Y)`. */
function acumulados(e: EntradaCrecimientos, gms: readonly PorGmSql[]): { actual: number; anterior: number } | null {
  if (!e.tendencia) return null;
  const claves = new Set(gms.map((g) => `${g.g}|${g.m}`));
  let actual = 0;
  let anterior = 0;
  for (const [g, m, iT, cur, ant] of e.tendencia.filas) {
    if (!claves.has(`${g}|${m}`)) continue;
    const tienda = e.tendencia.tiendas[iT];
    if (tienda === undefined || !e.mismasEnCurso.has(tienda)) continue;
    actual += cur;
    anterior += ant;
  }
  return { actual, anterior };
}

/**
 * Factor medio del Niño de enero a `k'` de un conjunto de GM: `φ̄ = Σ base_meses ÷ Σ base_meses_sin_nino` (ponderado por sus propios meses).
 * `null` si no hay meses que corregir.
 */
function factorMedio(gms: readonly PorGmSql[], kPrima: number): number | null {
  let conNino = 0;
  let sinNino = 0;
  for (const g of gms) {
    conNino += sumaHasta(g.Y.base_meses, kPrima);
    sinNino += sumaHasta(g.Y.base_meses_sin_nino, kPrima);
  }
  return conNino > 0 && sinNino > 0 ? conNino / sinNino : null;
}

function filaDe(
  e: EntradaCrecimientos,
  gm_clave: string,
  nombre: string,
  cifras: CifrasPuente,
  origen: readonly PorGmSql[],
  declarado: { pct: number | null; sobre_base: SobreBaseTablero | null; version: number | null; autor: string | null; aprobada_at: string | null; nota: string | null },
  anomalias: CrecimientoGMApi["anomalias"]
): CrecimientoGMApi {
  const B = cifras.B;
  const Bc = cifras.B_corr;
  const conNino = B !== null && Bc !== null && correccionMaterial(B, Bc);
  const implicitoReal = B === null ? null : variacionPct(cifras.vigente_con_B, B);
  const implicitoCorregida = Bc === null ? null : variacionPct(cifras.vigente_con_B, Bc);
  const implicito = declarado.sobre_base === "corregida" ? implicitoCorregida : declarado.sobre_base === "bruta" ? implicitoReal : null;
  const desvio = declarado.pct === null || implicito === null ? null : implicito - declarado.pct;

  const ac = acumulados(e, origen);
  const bruta = ac === null ? null : variacionPct(ac.actual, ac.anterior);
  let corregida = bruta;
  if (ac !== null && bruta !== null && conNino) {
    const phi = factorMedio(origen, e.kPrima);
    if (phi !== null && phi > 0) corregida = variacionPct(ac.actual / phi, ac.anterior);
  }
  const afectada = bruta !== null && corregida !== null && bruta < 0 && corregida >= 0;

  let semaforo: CrecimientoGMApi["semaforo"] = "sin_dato";
  if (declarado.pct !== null && (desvio !== null || corregida !== null)) {
    if (corregida !== null && corregida < 0 && declarado.pct - corregida >= UMBRAL_TENDENCIA_PP) semaforo = "contra_tendencia";
    else if (desvio === null) semaforo = "sin_dato";
    else semaforo = Math.abs(desvio) >= UMBRAL_DESVIO_PP ? "revisar" : "coincide";
  }

  return {
    gm_clave,
    nombre,
    declarado_pct: declarado.pct,
    sobre_base: declarado.sobre_base,
    version: declarado.version,
    autor: declarado.autor,
    aprobada_at: declarado.aprobada_at,
    nota: declarado.nota,
    base_real: B,
    base_corregida: Bc,
    con_nino: conNino,
    siguiente_mismas: cifras.vigente_con_B + cifras.vigente_sin_B,
    implicito_sobre_real_pct: implicitoReal,
    implicito_sobre_corregida_pct: implicitoCorregida,
    desvio_pp: desvio,
    tendencia_mismas_pct: bruta,
    tendencia_mismas_corregida_pct: corregida,
    tendencia_afectada_nino: afectada,
    semaforo,
    anomalias,
  };
}

/** Anomalías de la versión aplicada (§4.5): sin base, reemplazó a otra el mismo día (Lima) o no tiene nota. */
function anomaliasDe(version: VersionCrecimiento | undefined, hermanas: readonly VersionCrecimiento[], B: number | null): CrecimientoGMApi["anomalias"] {
  const salida: CrecimientoGMApi["anomalias"] = [];
  if (!version) return salida;
  if (!((B ?? 0) > 0) || version.base_valor === null) salida.push("sin_base");
  const dia = version.aprobada_at ? fechaLima(version.aprobada_at) : null;
  if (dia !== null && hermanas.some((v) => v.id !== version.id && v.estado !== "vigente" && v.aprobada_at !== null && fechaLima(v.aprobada_at) === dia)) salida.push("reemplazada_mismo_dia");
  if (version.nota === null || version.nota.trim() === "") salida.push("sin_nota");
  return salida;
}

export function armarCrecimientos(e: EntradaCrecimientos): CrecimientoGMApi[] {
  const { filas, total } = agruparGm(e.porGm, e.generosMatriz, e.nombreDe);
  const porId = new Map(e.versiones.map((v) => [v.id, v]));
  const salida: CrecimientoGMApi[] = [];
  for (const f of filas) {
    if (f.gm_clave === GM_CLAVE_RESTO) {
      const version = e.resto.crecimiento_id ? porId.get(e.resto.crecimiento_id) : undefined;
      const hermanas = e.versiones.filter((v) => v.alcance === "resto");
      salida.push(
        filaDe(
          e,
          f.gm_clave,
          f.nombre,
          f.cifras,
          f.origen,
          // Sin `crecimiento_resto_usado` el tablero dice «sin dato»: no inventa el provisional.
          { pct: e.resto.pct, sobre_base: e.resto.sobre_base, version: e.resto.version, autor: e.resto.por_nombre, aprobada_at: e.resto.at, nota: version?.nota ?? null },
          // El Resto provisional (`crecimiento_id` nulo) no tiene versión: sin anomalías de versión.
          anomaliasDe(version, hermanas, f.cifras.B).filter((a) => a !== "sin_nota")
        )
      );
      continue;
    }
    const [g, m] = f.gm_clave.split("|");
    const d = e.declarados.find((x) => x.genero_id === g && x.mundo_id === m);
    const version = d?.crecimiento_id ? porId.get(d.crecimiento_id) : undefined;
    const hermanas = e.versiones.filter((v) => v.alcance === "gm" && v.genero_id === g && v.mundo_id === m);
    salida.push(
      filaDe(
        e,
        f.gm_clave,
        f.nombre,
        f.cifras,
        f.origen,
        {
          pct: d ? d.pct : null,
          sobre_base: d ? (d.sobre_base ?? "bruta") : null,
          version: d?.version ?? version?.version ?? null,
          autor: version?.usuario_nombre ?? null,
          aprobada_at: version?.aprobada_at ?? null,
          nota: version?.nota ?? null,
        },
        anomaliasDe(version, hermanas, f.cifras.B)
      )
    );
  }
  salida.push(
    filaDe(e, GM_CLAVE_TOTAL, "Total", total, e.porGm, { pct: null, sobre_base: null, version: null, autor: null, aprobada_at: null, nota: null }, [])
  );
  return salida;
}
