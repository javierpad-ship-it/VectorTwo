import { huellaConfig, llaveDiferencia, diferenciaMaximaPp } from "./huellas";
import type { InternoAnalisis } from "./modelo";
import { puedeAprobar, requiereNota, alcanceVacio, type MotivoNoAprobable } from "./reparto";
import { repartirProporcional } from "./resto";
import {
  MAX_NOTA_REPARTO,
  TEMPORADAS_DEFECTO,
  type AlcanceApi,
  type AnalisisMarcaApi,
  type EstadoReparto,
  type FilaVersionApi,
  type FuenteReparto,
  type ModoEntrada,
  type ModoReparto,
  type MotivoObsoleto,
  type RepartoApi,
  type Temporada,
  type TemporadasConfig,
  type VeredictoError,
} from "./tipos-api";
import { claveG, type ClaveG, type LlaveVector } from "./tipos";
import { veredictoError } from "./error";
import { motivoTemporadasInvalidas } from "./temporadas";

/**
 * Reglas de la aprobación de un reparto y de su lectura (ficha 12, regla 10 y regla 12). Puras: los handlers y el servicio las
 * llaman, no las reimplementan. Aprobar es SIEMPRE una decisión del planner o del administrador: nada aquí aprueba solo, y un
 * reparto obsoleto solo se marca (nunca se recalcula ni se reemplaza por la recomendación del sistema).
 */

// ─── Errores de la aprobación (el handler los traduce a 409 con su código) ───

export type CodigoRechazo = "suma_invalida" | "nota_requerida" | "sin_cerrada" | "fila_desconocida" | "sin_venta_barrer";

export type RechazoAprobacion = { codigo: CodigoRechazo; mensaje: string };

export const MENSAJE_SIN_VENTA = "La marca no tiene venta al barrer en la ventana (o el alcance la deja fuera): no hay reparto que aprobar.";
export const MENSAJE_SUMA = "Las participaciones de cada temporada deben sumar 100 %: ajusta el resto o vuelve a lo calculado.";
export const MENSAJE_NOTA = "Escribe una nota: es obligatoria cuando hay ajustes, la ventana no es la de 24 meses, la fuente es la cerrada o hay alcance.";
export const MENSAJE_SIN_CERRADA = "No hay una proyección cerrada con participaciones de esta marca: elige la fuente histórica.";

// ─── Armado de las filas de una versión ───

/** Una fila lista para `reparto_marca_barrido_gml` (sin `reparto_id`). */
export type FilaVersionNueva = {
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  temporada: Temporada | null;
  grupo_resto: string | null;
  unidades_ventana: number;
  participacion_calculada: number;
  participacion_ajustada: number | null;
  participacion_vigente: number;
};

export type CuerpoAprobacion = {
  ventana_meses: number;
  modo: ModoEntrada;
  fuente: FuenteReparto;
  alcance: AlcanceApi;
  filas: readonly { genero_mundo_linea_id: string; equivalencia_id?: string | null; temporada?: Temporada | null; participacion_ajustada: number | null }[];
  nota?: string;
};

export type VersionNueva = {
  filas: FilaVersionNueva[];
  /** Los vectores vigentes por llave, en fracción (para validar la suma). */
  hay_ajuste: boolean;
  requiere_nota: boolean;
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const AJUSTE_MINIMO = 0.00005;
const llaveDe = (t: Temporada | null | undefined): LlaveVector => (t ?? "anual");

/**
 * Regla 10. Arma las filas de la versión a partir del análisis y de lo que el planner ajustó, y la valida:
 *   - cada `(g, temporada)` del cuerpo debe existir en el reparto calculado (`fila_desconocida`); no se agregan `g` nuevas;
 *   - `calculado` es el `p2` de la FUENTE elegida (histórico o según la cerrada; `sin_cerrada` si no hay);
 *   - `vigente = ajustado ?? calculado` por fila y temporada; un ajuste igual al calculado (± 0,00005) no cuenta como ajuste;
 *   - cada vector suma 1 ± `TOLERANCIA_SUMA` (`suma_invalida`) y hay al menos una fila con participación > 0;
 *   - nota obligatoria si hay ajuste, ventana ≠ 24, fuente `cerrada` o alcance (`nota_requerida`);
 *   - se guarda una fila por `g` (los restos ya llegan expandidos), con `grupo_resto` informativo.
 * Los números se redondean a 4 decimales con SUMA EXACTA por temporada (el método del mayor resto), de modo que M8 reparte
 * siempre un vector que suma 1,0000.
 */
export function armarVersion(
  interno: InternoAnalisis,
  cuerpo: CuerpoAprobacion
): { ok: true; version: VersionNueva } | { ok: false; rechazo: RechazoAprobacion } {
  const fuente = cuerpo.fuente;
  const vectores = fuente === "cerrada" ? interno.cerrada?.vectores : interno.historico.vectores;
  if (fuente === "cerrada" && !interno.cerrada) {
    return { ok: false, rechazo: { codigo: "sin_cerrada", mensaje: MENSAJE_SIN_CERRADA } };
  }
  if (!vectores) return { ok: false, rechazo: { codigo: "sin_venta_barrer", mensaje: MENSAJE_SIN_VENTA } };

  // Lo que el planner envió, por (llave, g). Una clave repetida cuenta una sola vez (la última manda, como un formulario).
  const enviado = new Map<string, number | null>();
  for (const f of cuerpo.filas) {
    const clave = claveG(f.genero_mundo_linea_id, f.equivalencia_id ?? null);
    const llave = llaveDe(f.temporada);
    const vec = vectores.get(llave);
    if (!vec || !(vec.get(clave) !== undefined)) {
      return {
        ok: false,
        rechazo: {
          codigo: "fila_desconocida",
          mensaje: "Una fila no pertenece al reparto calculado (cambió la configuración o la temporada). Vuelve a cargar el análisis.",
        },
      };
    }
    enviado.set(`${llave}|${clave}`, f.participacion_ajustada);
  }

  const llaves = [...vectores.keys()].sort();
  type Celda = { llave: LlaveVector; clave: ClaveG; calculado: number; ajustada: number | null; vigente: number };
  const porLlave = new Map<LlaveVector, Celda[]>();
  let hayAjuste = false;
  for (const llave of llaves) {
    const vec = vectores.get(llave);
    const celdas: Celda[] = [];
    for (const [clave, calculado] of [...(vec ?? new Map<ClaveG, number>())].filter(([, p]) => p > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const pedido = enviado.get(`${llave}|${clave}`);
      let ajustada = pedido === undefined ? null : pedido;
      if (ajustada !== null && Math.abs(ajustada - calculado) <= AJUSTE_MINIMO) ajustada = null;
      if (ajustada !== null) hayAjuste = true;
      celdas.push({ llave, clave, calculado, ajustada, vigente: ajustada ?? calculado });
    }
    porLlave.set(llave, celdas);
  }

  const datos = {
    vectores: new Map<LlaveVector, number[]>([...porLlave].map(([llave, celdas]) => [llave, celdas.map((c) => c.vigente)])),
    nota: cuerpo.nota,
    hay_ajuste: hayAjuste,
    ventana_meses: cuerpo.ventana_meses,
    fuente,
    alcance_vacio: alcanceVacio(cuerpo.alcance),
  };
  const motivo: MotivoNoAprobable | null = puedeAprobar(datos);
  if (motivo === "sin_filas") return { ok: false, rechazo: { codigo: "suma_invalida", mensaje: MENSAJE_SIN_VENTA } };
  if (motivo === "suma_invalida") return { ok: false, rechazo: { codigo: "suma_invalida", mensaje: MENSAJE_SUMA } };
  if (motivo === "nota_requerida") return { ok: false, rechazo: { codigo: "nota_requerida", mensaje: MENSAJE_NOTA } };
  if (cuerpo.nota !== undefined && cuerpo.nota.length > MAX_NOTA_REPARTO) {
    return { ok: false, rechazo: { codigo: "nota_requerida", mensaje: `La nota no puede superar ${MAX_NOTA_REPARTO} caracteres.` } };
  }

  const filas: FilaVersionNueva[] = [];
  for (const [llave, celdas] of porLlave) {
    if (celdas.length === 0) continue;
    const calc = repartirProporcional(1, celdas.map((c) => c.calculado), 4);
    const redondeados = celdas.map((c) => r4(c.vigente));
    const sumaExacta = Math.round(redondeados.reduce((a, b) => a + b, 0) * 1e4) === 1e4;
    const vigente = sumaExacta ? redondeados : repartirProporcional(1, celdas.map((c) => c.vigente), 4);
    celdas.forEach((c, i) => {
      const interna = interno.filas.get(c.clave);
      const gml = c.clave.slice(0, c.clave.indexOf("|"));
      const eq = c.clave.slice(c.clave.indexOf("|") + 1);
      filas.push({
        genero_mundo_linea_id: gml,
        equivalencia_id: eq === "" ? null : eq,
        temporada: llave === "anual" ? null : llave,
        grupo_resto: interna?.grupo_resto ?? null,
        unidades_ventana: interna?.unidades_ventana ?? 0,
        participacion_calculada: calc[i],
        participacion_ajustada: c.ajustada === null ? null : r4(c.ajustada),
        participacion_vigente: vigente[i],
      });
    });
  }
  return { ok: true, version: { filas, hay_ajuste: hayAjuste, requiere_nota: requiereNota(datos) } };
}

// ─── Lectura de una versión (de la base a la API) ───

export type FilaVersionLeida = {
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  temporada: string | null;
  grupo_resto: string | null;
  unidades_ventana: number;
  participacion_calculada: number;
  participacion_ajustada: number | null;
  participacion_vigente: number;
};

export type VersionLeida = {
  id: string;
  marca_id: string;
  version: number;
  vigente: boolean;
  ventana_meses: number;
  modo: string;
  fuente: string;
  alcance: unknown;
  hasta_periodo: string;
  normaliza_nino: boolean;
  huella_cargas: string;
  huella_config: string;
  factores_usados: unknown;
  /** `jsonb` tal cual está en la base; `temporadasDeVersion` lo lee. */
  temporadas_usadas: unknown;
  share_barrido: number | null;
  eat_pp: number | null;
  error_reparto_pp: number | null;
  nota: string | null;
  aprobada_por_id: string | null;
  aprobada_por_nombre: string | null;
  aprobada_at: string;
  filas: FilaVersionLeida[];
};

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));
const esTemporada = (t: string | null): t is Temporada => t === "verano" || t === "invierno";

export function modoDe(m: string): ModoReparto {
  return m === "anual" || m === "por_mes" ? m : "por_temporada";
}

export const fuenteDe = (f: string): FuenteReparto => (f === "cerrada" ? "cerrada" : "historico");

/** El alcance guardado (`jsonb`) en la forma de la API. */
export function alcanceDe(json: unknown): AlcanceApi {
  const o = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").sort() : []);
  return { generos: lista(o.generos), mundos: lista(o.mundos), lineas: lista(o.lineas) };
}

const copiaTemporadas = (t: TemporadasConfig): TemporadasConfig => ({
  verano: { desde_mes: t.verano.desde_mes, hasta_mes: t.verano.hasta_mes },
  invierno: { desde_mes: t.invierno.desde_mes, hasta_mes: t.invierno.hasta_mes },
});

/** Las temporadas por defecto (copia: quien llama puede mutarla sin tocar la constante). */
export const temporadasPorDefecto = (): TemporadasConfig => copiaTemporadas(TEMPORADAS_DEFECTO);

/**
 * `temporadas_usadas` de una versión (columna `repartos_marca_barrido.temporadas_usadas`, 0024): las fechas de temporada con las
 * que se calculó. Se lee tal cual se guardó, de modo que cambiar las fechas después no reescribe lo aprobado. Solo si el valor no
 * tiene la forma esperada (no es un objeto con `verano` e `invierno` válidos, que cubran los doce meses sin solaparse) vale el
 * defecto.
 */
export function temporadasDeVersion(json: unknown): TemporadasConfig {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return temporadasPorDefecto();
  const o = json as Record<string, unknown>;
  const rango = (x: unknown): { desde_mes: number; hasta_mes: number } | null => {
    if (x === null || typeof x !== "object" || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    return typeof r.desde_mes === "number" && typeof r.hasta_mes === "number" ? { desde_mes: r.desde_mes, hasta_mes: r.hasta_mes } : null;
  };
  const verano = rango(o.verano);
  const invierno = rango(o.invierno);
  if (!verano || !invierno) return temporadasPorDefecto();
  const leidas: TemporadasConfig = { verano, invierno };
  return motivoTemporadasInvalidas(leidas) === null ? leidas : temporadasPorDefecto();
}

/**
 * Las temporadas que se guardan en `temporadas_usadas` al aprobar: las del análisis (las efectivas con que se calculó), validadas.
 * `null` si no son válidas (no se guarda una versión con fechas que no se pueden leer después).
 */
export function temporadasAGuardar(efectivas: TemporadasConfig): TemporadasConfig | null {
  if (motivoTemporadasInvalidas(efectivas) !== null) return null;
  return copiaTemporadas(efectivas);
}

function factoresDe(json: unknown): { anio: number; temporada: string; ratio: number | null }[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((f): f is { anio: number; temporada: string; ratio?: number | null } => f !== null && typeof f === "object" && typeof (f as { anio?: unknown }).anio === "number")
    .map((f) => ({ anio: f.anio, temporada: String(f.temporada), ratio: f.ratio === undefined ? null : f.ratio }));
}

/** Una versión como la entrega la API (`rutaDe` da el nombre de cada `g`). */
export function aRepartoApi(v: VersionLeida, rutaDe: (gmlId: string, equivalenciaId: string | null) => string): RepartoApi {
  const filas: FilaVersionApi[] = [...v.filas]
    .map((f) => ({
      gml_id: f.genero_mundo_linea_id,
      equivalencia_id: f.equivalencia_id,
      ruta: rutaDe(f.genero_mundo_linea_id, f.equivalencia_id),
      temporada: esTemporada(f.temporada) ? f.temporada : null,
      grupo_resto: f.grupo_resto,
      unidades_ventana: f.unidades_ventana,
      participacion_calculada: Number(f.participacion_calculada),
      participacion_ajustada: num(f.participacion_ajustada),
      participacion_vigente: Number(f.participacion_vigente),
    }))
    .sort((a, b) => (a.temporada ?? "") .localeCompare(b.temporada ?? "") || b.participacion_vigente - a.participacion_vigente || a.ruta.localeCompare(b.ruta, "es") || (a.equivalencia_id ?? "").localeCompare(b.equivalencia_id ?? ""));
  return {
    id: v.id,
    marca_id: v.marca_id,
    version: v.version,
    vigente: v.vigente,
    ventana_meses: v.ventana_meses,
    modo: modoDe(v.modo),
    fuente: fuenteDe(v.fuente),
    alcance: alcanceDe(v.alcance),
    hasta_periodo: v.hasta_periodo.slice(0, 7),
    normaliza_nino: v.normaliza_nino,
    huella_cargas: v.huella_cargas,
    huella_config: v.huella_config,
    factores_usados: factoresDe(v.factores_usados),
    temporadas_usadas: temporadasDeVersion(v.temporadas_usadas),
    share_barrido: num(v.share_barrido),
    eat_pp: num(v.eat_pp),
    error_reparto_pp: num(v.error_reparto_pp),
    nota: v.nota,
    aprobada_por_id: v.aprobada_por_id,
    aprobada_por_nombre: v.aprobada_por_nombre,
    aprobada_at: v.aprobada_at,
    filas,
  };
}

// ─── El reparto vigente frente al análisis de hoy (regla 11) ───

const llaveVersion = (f: { temporada: string | null }): LlaveVector => (esTemporada(f.temporada) ? f.temporada : "anual");

/** Las participaciones `(llave, g) → valor` de una versión, sea `participacion_calculada` (lo que el sistema calculó entonces) o la vigente. */
export function vectoresDeVersion(v: Pick<VersionLeida, "filas">, cual: "calculada" | "vigente"): Map<string, number> {
  const r = new Map<string, number>();
  for (const f of v.filas) {
    const p = cual === "calculada" ? f.participacion_calculada : f.participacion_vigente;
    r.set(llaveDiferencia(llaveVersion(f), claveG(f.genero_mundo_linea_id, f.equivalencia_id)), Number(p));
  }
  return r;
}

/**
 * Cuánto se movió el reparto, en pp: el máximo de `|calculado entonces − calculado hoy|` sobre todas las `(g, temporada)` (con la
 * fuente con que se aprobó). Se compara lo CALCULADO con lo calculado, no lo ajustado a mano: un ajuste del planner no es
 * una desviación de los datos. `hoy` es el análisis hecho con los parámetros de la versión vigente.
 */
export function diferenciaConVigente(interno: InternoAnalisis, v: VersionLeida): number | null {
  const fuente = fuenteDe(v.fuente);
  // Una versión aprobada según la cerrada, sin cerrada hoy: no hay con qué comparar.
  if (fuente === "cerrada" && !interno.cerrada?.vectores) return null;
  const hoy = new Map<string, number>();
  const vectores = fuente === "cerrada" ? interno.cerrada?.vectores : interno.historico.vectores;
  for (const [llave, vec] of vectores ?? []) if (vec) for (const [c, p] of vec) hoy.set(llaveDiferencia(llave, c), p);
  return diferenciaMaximaPp(vectoresDeVersion(v, "calculada"), hoy);
}

/** `huella_config` de lo que se calcularía hoy con los parámetros de la versión (los niveles, de las `g` que la versión guardó). */
export function huellaConfigActual(
  interno: InternoAnalisis,
  v: Pick<VersionLeida, "fuente" | "filas">,
  nivelDe: (gmlId: string) => "GML" | "GMLE",
  ventanaPedida: number
): string {
  const niveles = new Map<string, "GML" | "GMLE">();
  for (const f of v.filas) niveles.set(f.genero_mundo_linea_id, nivelDe(f.genero_mundo_linea_id));
  return huellaConfig({ ...interno.entradaHuella(fuenteDe(v.fuente)), niveles, ventana_meses: ventanaPedida });
}

/** El `huella_config` que se guardará con una versión nueva: los niveles son los de las `g` que guarda. */
export function huellaConfigDeVersion(
  interno: InternoAnalisis,
  fuente: FuenteReparto,
  filas: readonly Pick<FilaVersionNueva, "genero_mundo_linea_id">[],
  nivelDe: (gmlId: string) => "GML" | "GMLE"
): string {
  const niveles = new Map<string, "GML" | "GMLE">();
  for (const f of filas) niveles.set(f.genero_mundo_linea_id, nivelDe(f.genero_mundo_linea_id));
  return huellaConfig({ ...interno.entradaHuella(fuente), niveles });
}

/** Adjunta el reparto vigente al análisis: `p2.vigente` y `p2.ajustado_vigente` de cada fila y fila de resto, y el bloque `vigente`. */
export function adjuntarVigente(
  api: AnalisisMarcaApi,
  v: VersionLeida | null,
  evaluacion: { motivos: MotivoObsoleto[]; diferencia_pp: number | null }
): AnalisisMarcaApi {
  if (v === null) {
    return { ...api, avisos: [...new Set([...api.avisos, "sin_reparto" as const])].sort() };
  }
  const porLlave = new Map<string, FilaVersionLeida>();
  for (const f of v.filas) porLlave.set(llaveDiferencia(llaveVersion(f), claveG(f.genero_mundo_linea_id, f.equivalencia_id)), f);
  const llaveDeP2 = (t: Temporada | null): LlaveVector => t ?? "anual";

  const filas = api.filas.map((fila) => ({
    ...fila,
    p2: fila.p2.map((p) => {
      const f = porLlave.get(llaveDiferencia(llaveDeP2(p.temporada), fila.clave));
      return f ? { ...p, vigente: Number(f.participacion_vigente), ajustado_vigente: num(f.participacion_ajustada) } : p;
    }),
  }));
  const restos = api.restos.map((r) => ({
    ...r,
    p2: r.p2.map((p) => {
      let vigente = 0;
      let ajustado = 0;
      let alguno = false;
      let algunAjuste = false;
      for (const clave of r.miembros) {
        const f = porLlave.get(llaveDiferencia(llaveDeP2(p.temporada), clave));
        if (!f) continue;
        alguno = true;
        vigente += Number(f.participacion_vigente);
        if (f.participacion_ajustada !== null) {
          algunAjuste = true;
          ajustado += Number(f.participacion_ajustada);
        }
      }
      return alguno ? { ...p, vigente, ajustado_vigente: algunAjuste ? ajustado : null } : p;
    }),
  }));
  return {
    ...api,
    filas,
    restos,
    vigente: {
      reparto_id: v.id,
      version: v.version,
      modo: modoDe(v.modo),
      fuente: fuenteDe(v.fuente),
      ventana_meses: v.ventana_meses,
      aprobada_at: v.aprobada_at,
      aprobada_por_nombre: v.aprobada_por_nombre,
      nota: v.nota,
      error_reparto_pp: num(v.error_reparto_pp),
      diferencia_pp: evaluacion.diferencia_pp,
    },
    obsoleto: evaluacion.motivos,
    avisos: evaluacion.motivos.includes("nivel_cambiado") ? [...new Set([...api.avisos, "nivel_cambiado" as const])].sort() : api.avisos,
  };
}

// ─── La lista ───

/** `sin_reparto` sin versión vigente; `obsoleto` si hay algún motivo; si no, `al_dia`. */
export function estadoDeReparto(tieneVigente: boolean, motivos: readonly MotivoObsoleto[]): EstadoReparto {
  if (!tieneVigente) return "sin_reparto";
  return motivos.length > 0 ? "obsoleto" : "al_dia";
}

/** El veredicto del error del último reparto aprobado (la lista no calcula backtesting). */
export function errorDeLista(pp: number | null): { pp: number | null; veredicto: VeredictoError | null } {
  return { pp, veredicto: veredictoError(pp) };
}
