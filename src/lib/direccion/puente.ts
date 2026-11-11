import { GM_CLAVE_RESTO, GM_CLAVE_TOTAL, type AnioEnCursoSql, type AnioSiguienteSql, type ClavePuente, type PorGmSql, type PuenteApi } from "./tipos-api";
import { variacionPct } from "./textos";

/**
 * Puente del año en curso al siguiente (ficha 14, §4.4 y R4). Puro. Todas las líneas salen de sumas de lo guardado (`por_gm` y `anios` de
 * `tablero_proyeccion`): nada se recalcula. Los pasos suman EXACTAMENTE el total del año siguiente y parten exactamente del cierre del año en curso.
 */

/** Las cifras de las que sale un puente (de un GM, del Resto, del total o de un recorte). */
export type CifrasPuente = {
  /** Cierre del año en curso, todas las tiendas (filas base y de tienda). */
  cierre: number;
  /** Vigente de las filas de tienda del año en curso que no entra en la base del siguiente. */
  fuera_base: number;
  /** `Σ B`; `null` si ningún registro tiene base (método anterior). */
  B: number | null;
  /** `Σ B'` con dos decimales; `null` como `B`. */
  B_corr: number | null;
  propuesto_con_B: number;
  vigente_con_B: number;
  vigente_sin_B: number;
  delta_manual: number;
  delta_otras: number;
  nuevas_anterior: number;
  aperturas: number;
  cierres: number;
};

export const cifrasVacias = (): CifrasPuente => ({
  cierre: 0,
  fuera_base: 0,
  B: null,
  B_corr: null,
  propuesto_con_B: 0,
  vigente_con_B: 0,
  vigente_sin_B: 0,
  delta_manual: 0,
  delta_otras: 0,
  nuevas_anterior: 0,
  aperturas: 0,
  cierres: 0,
});

export const cifrasDeGm = (g: PorGmSql): CifrasPuente => ({
  cierre: g.Y.cierre,
  fuera_base: g.Y.fuera_base_exacto,
  B: g.Y1.B,
  B_corr: g.Y1.B_corr,
  propuesto_con_B: g.Y1.propuesto_con_B,
  vigente_con_B: g.Y1.vigente_con_B,
  vigente_sin_B: g.Y1.vigente_sin_B,
  delta_manual: g.Y1.delta_manual,
  delta_otras: g.Y1.delta_otras,
  nuevas_anterior: g.Y1.nuevas_anterior,
  aperturas: g.Y1.aperturas,
  cierres: g.Y1.cierres,
});

/** Las cifras del puente de un recorte, de `anios` de `tablero_proyeccion` (los registros de tienda se clasifican sin huecos, como `por_gm.Y1`). */
export function cifrasDeRecorte(enCurso: AnioEnCursoSql, siguiente: AnioSiguienteSql): CifrasPuente {
  const tiendasY = enCurso.tiendas.reduce((a, t) => a + t.vigente, 0);
  const paraBase = enCurso.tiendas.reduce((a, t) => a + (t.para_base ?? 0), 0);
  const c = cifrasVacias();
  c.cierre = enCurso.base.vigente + tiendasY;
  c.fuera_base = tiendasY - paraBase;
  c.B = siguiente.base.B;
  c.B_corr = siguiente.base.B_corr;
  c.propuesto_con_B = siguiente.base.propuesto_con_B;
  c.vigente_con_B = siguiente.base.vigente_con_B;
  c.vigente_sin_B = siguiente.base.vigente_sin_B;
  c.delta_manual = siguiente.base.delta_manual;
  c.delta_otras = siguiente.base.delta_otras;
  for (const t of siguiente.tiendas) {
    if (t.bloque === "cierres") c.cierres += t.vigente;
    else if (t.subbloque === "nuevas_anterior") c.nuevas_anterior += t.vigente;
    else c.aperturas += t.vigente;
  }
  return c;
}

const sumaNula = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function sumarCifras(lista: readonly CifrasPuente[]): CifrasPuente {
  const s = cifrasVacias();
  for (const c of lista) {
    s.cierre += c.cierre;
    s.fuera_base += c.fuera_base;
    s.B = sumaNula(s.B, c.B);
    s.B_corr = sumaNula(s.B_corr, c.B_corr);
    s.propuesto_con_B += c.propuesto_con_B;
    s.vigente_con_B += c.vigente_con_B;
    s.vigente_sin_B += c.vigente_sin_B;
    s.delta_manual += c.delta_manual;
    s.delta_otras += c.delta_otras;
    s.nuevas_anterior += c.nuevas_anterior;
    s.aperturas += c.aperturas;
    s.cierres += c.cierres;
  }
  return s;
}

/** Total del año siguiente de unas cifras (= `por_gm.Y1.total`). */
/**
 * La línea `manual` del puente es `delta_manual` de la migración 0041: `vigente − propuesta` de los registros base con `B` CLASIFICADOS `manual` con la
 * misma clasificación excluyente de «Cómo se decidió» (los fijó una persona: `origen = 'manual'`, sin lote ni propuesta de IA). Las cifras de IA
 * aceptadas y lo aceptado en bloque caen en «Otras diferencias con la propuesta» (`delta_otras`).
 */
export const ROTULO_MANUAL = "Fijado a mano";
/** El mismo rótulo dentro de una frase. */
export const ROTULO_MANUAL_EN_FRASE = "fijado a mano";
const AYUDA_MANUAL =
  "Lo que el planner o el admin escribieron a mano por encima o por debajo de la propuesta (las filas «a mano» de «Cómo se decidió»). Lo aceptado en bloque o de la IA no cuenta aquí: si su propuesta cambió después, va en «Otras diferencias con la propuesta».";

export const totalSiguiente = (c: CifrasPuente): number => c.vigente_con_B + c.vigente_sin_B + c.nuevas_anterior + c.aperturas + c.cierres;

/** Texto de ayuda de cada línea (`title` y lector de pantalla). */
export function ayudaPuente(anio: number): Record<ClavePuente, string> {
  const Y = anio;
  const S = anio + 1;
  return {
    cierre_en_curso: `Lo vendido de ${Y} hasta el último mes cerrado más lo proyectado para el resto del año, en todas las tiendas.`,
    fuera_base: `El ${Y} de las tiendas con filas propias que no entran en la base de ${S}: las que abrieron en ${Y} y siguen aparte, y las que cerraron en ${Y}.`,
    ajuste_base: `Incluye el ${Y} que la proyección resta de la base por las tiendas que cierran en ${S}, las filas sin base y cualquier diferencia entre la base y el cierre de esas tiendas, por ejemplo, por decisiones sobre ${Y} tomadas después de calcular la base.`,
    base: `La venta de ${Y} de las tiendas que son «mismas tiendas» en ${S}: sobre ella se aplica el crecimiento.`,
    nino: `Lo que sube (o baja) la base al quitarle el efecto del Niño de ${Y}: base corregida menos base real.`,
    crecimiento: `El crecimiento declarado aplicado: la propuesta del método menos la base corregida.`,
    manual: AYUDA_MANUAL,
    otras: `Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular (se aceptó una propuesta anterior), y filas escaladas por tienda: no son decisiones a mano, pero hacen que lo vigente no sea la propuesta de hoy.`,
    sin_base: `Filas de mismas tiendas proyectadas por otro método, sin base de ${Y}.`,
    mismas_siguiente: `${S} de las mismas tiendas: las filas sin tienda.`,
    nuevas_anterior: `${S} de las tiendas que abrieron en ${Y} y todavía no forman parte de la base.`,
    aperturas: `${S} de las tiendas que abren en ${S}.`,
    cierres: `Lo que venderán en ${S}, hasta su cierre, las tiendas que cierran ese año.`,
    total_siguiente: `Todo ${S}: mismas tiendas, tiendas abiertas en ${Y}, aperturas y tiendas que cierran.`,
  };
}

export function etiquetasPuente(anio: number): Record<ClavePuente, string> {
  const Y = anio;
  const S = anio + 1;
  return {
    cierre_en_curso: `${Y} cierre, todas las tiendas`,
    fuera_base: `− ${Y} de tiendas que no forman la base de ${S} (aperturas de ${Y} aún fuera, cierres de ${Y})`,
    ajuste_base: `− ${Y} de tiendas que cierran en ${S}, filas sin base y diferencia`,
    base: `Base ${S} (B): ${Y} de las mismas tiendas de ${S}`,
    nino: "+ Corrección del Niño (B′ − B)",
    crecimiento: "+ Crecimiento declarado aplicado (propuesta − B′)",
    manual: `+ ${ROTULO_MANUAL}`,
    otras: "+ Otras diferencias con la propuesta",
    sin_base: "+ Filas de mismas tiendas sin base B (otro método)",
    mismas_siguiente: `Mismas tiendas ${S}`,
    nuevas_anterior: `+ Tiendas abiertas en ${Y} (aún fuera de la base)`,
    aperturas: `+ Aperturas de ${S}`,
    cierres: `+ Venta de ${S} de tiendas que cierran en ${S}`,
    total_siguiente: `${S}`,
  };
}

/**
 * Arma el puente de unas cifras. Enteros: la base corregida (que trae dos decimales) se redondea UNA vez y la línea del crecimiento absorbe el
 * redondeo, de modo que `Σ pasos = total` exacto. Sin base (`B` nulo: método anterior) la base es 0, la línea del Niño es 0 con `pct.nino = null`
 * y todo lo de mismas tiendas va en «sin base».
 *
 * `pct` (cada paso sobre el acumulado ANTERIOR a él): `base_sobre_real` = base ÷ cierre − 1 (qué parte del cierre forma la base);
 * `nino` = (B′ − B) ÷ B; `crecimiento` = (propuesta − B′) ÷ B′; `manual` y `otras`, sobre el acumulado previo; `total_vs_cierre` = total ÷ cierre − 1.
 */
export function armarPuente(c: CifrasPuente, anio: number): PuenteApi {
  const etiquetas = etiquetasPuente(anio);
  const ayudas = ayudaPuente(anio);
  const lineas: PuenteApi["lineas"] = [];
  let acumulado = 0;
  const paso = (clave: ClavePuente, u: number) => {
    acumulado += u;
    lineas.push({ clave, etiqueta: etiquetas[clave], u, acumulado, subtotal: false, ayuda: ayudas[clave] });
  };
  const subtotal = (clave: ClavePuente, esperado: number) => {
    // Un subtotal no suma: repite el acumulado. `esperado` es la misma cifra por otro camino (si difieren hay un error de datos y se ve en la prueba).
    lineas.push({ clave, etiqueta: etiquetas[clave], u: esperado, acumulado, subtotal: true, ayuda: ayudas[clave] });
  };

  const B = c.B ?? 0;
  const Bc = c.B === null ? 0 : Math.round(c.B_corr ?? c.B);

  acumulado = c.cierre;
  lineas.push({ clave: "cierre_en_curso", etiqueta: etiquetas.cierre_en_curso, u: c.cierre, acumulado, subtotal: true, ayuda: ayudas.cierre_en_curso });
  paso("fuera_base", 0 - c.fuera_base);
  paso("ajuste_base", B - acumulado);
  subtotal("base", B);
  paso("nino", Bc - B);
  const antesDeCrecimiento = acumulado;
  paso("crecimiento", c.propuesto_con_B - Bc);
  const antesDeManual = acumulado;
  paso("manual", c.delta_manual);
  const antesDeOtras = acumulado;
  paso("otras", c.delta_otras);
  paso("sin_base", c.vigente_sin_B);
  subtotal("mismas_siguiente", c.vigente_con_B + c.vigente_sin_B);
  paso("nuevas_anterior", c.nuevas_anterior);
  paso("aperturas", c.aperturas);
  paso("cierres", c.cierres);
  subtotal("total_siguiente", totalSiguiente(c));

  return {
    lineas,
    pct: {
      base_sobre_real: c.B === null ? null : variacionPct(B, c.cierre),
      nino: c.B === null || c.B_corr === null ? null : variacionPct(Bc, B),
      crecimiento: c.B === null ? null : variacionPct(c.propuesto_con_B, antesDeCrecimiento),
      manual: c.B === null ? null : variacionPct(antesDeManual + c.delta_manual, antesDeManual),
      otras: c.B === null ? null : variacionPct(antesDeOtras + c.delta_otras, antesDeOtras),
      total_vs_cierre: variacionPct(totalSiguiente(c), c.cierre),
    },
  };
}

/**
 * Agrupa `por_gm` como la matriz de M7: una fila por GM de los géneros de la matriz (HOMBRE y MUJER), una del Resto (los demás géneros, si hay) y
 * la del Total al final. `nombreDe` da «GÉNERO · MUNDO». El orden de los GM es el de `por_gm` (por nombre si se pasa `ordenar`).
 */
export function agruparGm(
  porGm: readonly PorGmSql[],
  generosMatriz: ReadonlySet<string>,
  nombreDe: (g: string, m: string) => string
): { filas: { gm_clave: string; nombre: string; cifras: CifrasPuente; origen: PorGmSql[] }[]; total: CifrasPuente } {
  const detalle = porGm
    .filter((g) => generosMatriz.has(g.g))
    .map((g) => ({ gm_clave: `${g.g}|${g.m}`, nombre: nombreDe(g.g, g.m), cifras: cifrasDeGm(g), origen: [g] }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.gm_clave.localeCompare(b.gm_clave));
  const resto = porGm.filter((g) => !generosMatriz.has(g.g));
  const filas = [...detalle];
  if (resto.length > 0) filas.push({ gm_clave: GM_CLAVE_RESTO, nombre: "Resto", cifras: sumarCifras(resto.map(cifrasDeGm)), origen: resto });
  return { filas, total: sumarCifras(filas.map((f) => f.cifras)) };
}

/**
 * `puente.por_gm` de la respuesta: los GM de la matriz, el Resto y, al final, el Total. El Total es la SUMA línea a línea de los anteriores (así
 * «la suma del puente por GM es el puente total» se cumple exacta, también con el redondeo de la base corregida de cada GM).
 */
export function puentesPorGm(
  porGm: readonly PorGmSql[],
  generosMatriz: ReadonlySet<string>,
  nombreDe: (g: string, m: string) => string,
  anio: number
): (PuenteApi & { gm_clave: string; nombre: string })[] {
  const { filas, total } = agruparGm(porGm, generosMatriz, nombreDe);
  const puentes = filas.map((f) => ({ ...armarPuente(f.cifras, anio), gm_clave: f.gm_clave, nombre: f.nombre }));
  return [...puentes, { ...sumarPuentes(puentes, total, anio), gm_clave: GM_CLAVE_TOTAL, nombre: "Total" }];
}

/** Suma línea a línea de varios puentes (mismas claves, mismo orden); los `pct` se recalculan sobre las sumas. */
export function sumarPuentes(puentes: readonly PuenteApi[], cifrasTotal: CifrasPuente, anio: number): PuenteApi {
  const base = armarPuente(cifrasTotal, anio);
  if (puentes.length === 0) return base;
  const lineas = base.lineas.map((l, i) => ({
    ...l,
    u: puentes.reduce((a, p) => a + p.lineas[i].u, 0),
    acumulado: puentes.reduce((a, p) => a + p.lineas[i].acumulado, 0),
  }));
  const u = (clave: ClavePuente) => lineas.find((l) => l.clave === clave)?.u ?? 0;
  const acum = (clave: ClavePuente) => lineas.find((l) => l.clave === clave)?.acumulado ?? 0;
  const sinBase = cifrasTotal.B === null;
  return {
    lineas,
    pct: {
      base_sobre_real: sinBase ? null : variacionPct(u("base"), u("cierre_en_curso")),
      nino: sinBase || cifrasTotal.B_corr === null ? null : variacionPct(acum("nino"), acum("base")),
      crecimiento: sinBase ? null : variacionPct(acum("crecimiento"), acum("nino")),
      manual: sinBase ? null : variacionPct(acum("manual"), acum("crecimiento")),
      otras: sinBase ? null : variacionPct(acum("otras"), acum("manual")),
      total_vs_cierre: variacionPct(u("total_siguiente"), u("cierre_en_curso")),
    },
  };
}

/** Unidades de una línea del puente. */
export const lineaPuente = (p: PuenteApi, clave: ClavePuente): number => p.lineas.find((l) => l.clave === clave)?.u ?? 0;
