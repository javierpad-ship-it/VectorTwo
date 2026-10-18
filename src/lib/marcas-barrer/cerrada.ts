import { temporadaDe } from "./temporadas";
import { vectorSobre } from "./reparto";
import { TEMPORADAS, TEMPORADAS_DEFECTO, type AvisoBarrer, type ModoEntrada, type TemporadasConfig } from "./tipos-api";
import { claveG, type ClaveG, type LlaveVector, type Mes } from "./tipos";

/**
 * `p2` según la cerrada (ficha 12, regla 7): la mezcla que M7 YA proyecta para la marca. Puro.
 *
 *   D^b_{B,g,m} = D_{g,a_B,m} × part_{barrido B,g}      para m = k+1 … k+12
 *   p2^cerrada_{B,g,T} = Σ_{m∈T} D^b ÷ Σ_{g∈G_A} Σ_{m∈T} D^b
 *
 * `D_{g,a_B,m}` es la demanda de la celda GML × agrupación de marca de `B` (todas las filas de esa celda de la cerrada, las de las
 * mismas tiendas y las de tiendas nuevas y cierres) y `part_{barrido B,g}` la participación `barrido:<marca>` de la fila base
 * (`participaciones_historicas`). Es un CANDIDATO de reparto (`fuente = 'cerrada'`): ya lleva el crecimiento por GML y la curva de
 * cada línea. Sin cerrada, o sin participación de la marca → `null` y aviso `sin_cerrada`.
 */

/** Una fila de `GET /api/proyeccion/cerrada` (solo lo que este módulo lee). */
export type FilaCerrada = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  tienda_id: string | null;
  anio: number;
  meses: readonly number[] | null;
  participaciones_historicas: { por_clave_flujo: { clave_flujo: string; participacion: number }[] } | null;
};

/** Los doce meses siguientes a `hasta` (`aaaa-mm`). */
export function mesesSiguientes(hasta: Mes): Mes[] {
  const [a, m] = hasta.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const idx = a * 12 + (m - 1) + 1 + i;
    return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
  });
}

/** Los años que cubren los doce meses siguientes a `hasta` (uno o dos): los que hay que pedir a la cerrada. */
export function aniosDeLaCerrada(hasta: Mes): number[] {
  return [...new Set(mesesSiguientes(hasta).map((m) => Number(m.slice(0, 4))))];
}

export type EntradaCerrada = {
  filas: readonly FilaCerrada[];
  marcaId: string;
  agrupacionMarcaId: string;
  /** El `k`: último mes cerrado de la ventana. */
  hasta: Mes;
  /** El modo EFECTIVO del reparto histórico (si cayó a `anual` por temporada corta, la cerrada también). */
  modo: ModoEntrada;
  temporadas?: TemporadasConfig;
  /** ¿La `g` entra en el reparto? (alcance, y no ser un GML específico de una mixta). */
  incluir: (clave: ClaveG) => boolean;
};

export type ResultadoCerrada = {
  vectores: Map<LlaveVector, Map<ClaveG, number> | null> | null;
  /** `g` con participación `barrido` de la marca en la cerrada (aunque no estén en el alcance). */
  claves: Set<ClaveG>;
  avisos: AvisoBarrer[];
};

export function repartoSegunCerrada(e: EntradaCerrada): ResultadoCerrada {
  const temporadas = e.temporadas ?? TEMPORADAS_DEFECTO;
  const futuros = mesesSiguientes(e.hasta);
  const clavePart = `barrido:${e.marcaId}`;

  // Participación de la marca al barrer en cada `g` (fila base de la celda GML × agrupación de la marca).
  const parte = new Map<ClaveG, number>();
  for (const f of e.filas) {
    if (f.tienda_id !== null || f.agrupacion_marca_id !== e.agrupacionMarcaId) continue;
    const p = f.participaciones_historicas?.por_clave_flujo.find((x) => x.clave_flujo === clavePart)?.participacion;
    if (typeof p === "number" && p > 0) parte.set(claveG(f.gml_id, f.equivalencia_id), p);
  }
  if (parte.size === 0) return { vectores: null, claves: new Set(), avisos: ["sin_cerrada"] };

  // Demanda de la celda en cada mes futuro, sumando todas las filas (bloques) de la celda.
  const demanda = new Map<ClaveG, Map<Mes, number>>();
  for (const f of e.filas) {
    if (f.agrupacion_marca_id !== e.agrupacionMarcaId || !f.meses) continue;
    const clave = claveG(f.gml_id, f.equivalencia_id);
    if (!parte.has(clave)) continue;
    const m = demanda.get(clave) ?? new Map<Mes, number>();
    for (let i = 0; i < f.meses.length; i++) {
      const mes = `${String(f.anio).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
      if (futuros.includes(mes)) m.set(mes, (m.get(mes) ?? 0) + Math.max(0, f.meses[i] ?? 0));
    }
    demanda.set(clave, m);
  }

  const db = new Map<ClaveG, Map<Mes, number>>();
  for (const [clave, meses] of demanda) {
    const p = parte.get(clave) ?? 0;
    db.set(clave, new Map([...meses].map(([mes, d]) => [mes, d * p])));
  }
  const claves = [...db.keys()].filter(e.incluir);
  const llaves: LlaveVector[] = e.modo === "anual" ? ["anual"] : [...TEMPORADAS];
  const vectores = new Map<LlaveVector, Map<ClaveG, number> | null>();
  for (const llave of llaves) {
    const meses = llave === "anual" ? futuros : futuros.filter((m) => temporadaDe(Number(m.slice(5, 7)), temporadas) === llave);
    vectores.set(llave, vectorSobre(db, claves, meses));
  }
  if ([...vectores.values()].every((v) => v === null)) return { vectores: null, claves: new Set(parte.keys()), avisos: ["sin_cerrada"] };
  return { vectores, claves: new Set(parte.keys()), avisos: [] };
}
