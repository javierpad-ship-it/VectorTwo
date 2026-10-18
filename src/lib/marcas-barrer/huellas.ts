import { createHash } from "node:crypto";
import type { ConfigFlujo } from "@/lib/marcas/gml/flujo";
import {
  UMBRAL_OBSOLETO_PP,
  VERSION_METODO_BARRER,
  type AlcanceApi,
  type FuenteReparto,
  type ModalidadBarrer,
  type ModoEntrada,
  type MotivoObsoleto,
  type TemporadasConfig,
} from "./tipos-api";
import type { ClaveG, LlaveVector } from "./tipos";

/**
 * Huellas de M12 (ficha 12, regla 11) y la de M7 (`proyecciones.huella_flujo`). md5 hexadecimal: sirve para detectar cambios, no
 * es criptografía. Puras salvo por `node:crypto`.
 */

const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");
const corta = (texto: string) => md5(texto).slice(0, 12);

/** Huella de las cargas publicadas de la ventana (`aaaa-mm → carga_id`): cambia si cambia un `carga_id` o entra o sale un mes. */
export function huellaCargasBarrer(cargas: Readonly<Record<string, string>>): string {
  return md5(
    Object.keys(cargas)
      .sort()
      .map((mes) => `${mes}=${cargas[mes]}`)
      .join("\n")
  );
}

// ─── M7: huella de la configuración de 02b ───

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `proyecciones.huella_flujo` (ficha 12, 6.2): el hash de la configuración de 02b que decide a qué fila va cada hecho
 * (`claveFlujo`) más `VERSION_METODO_BARRER`. Cambia si cambia la modalidad, un GML relevante, el conjunto o la agrupación de una
 * marca CON tratamiento especial, o la vigencia de esas marcas. Un cambio del árbol (equivalencias, niveles) no entra: el nivel
 * tiene su propio motivo en M7 (`nivel_cambiado`) y una marca nueva sin tratamiento no cambia ninguna clave.
 */
export function huellaFlujo(config: ConfigFlujo): string {
  const marcas = [...config.marcas]
    .filter(([, m]) => m.marcada)
    .map(([id, m]) => `${id}|${m.agrupacion_marca_id}|${m.vigente ? 1 : 0}|${m.modalidad ?? ""}`)
    .sort(cmp);
  // Un conjunto cuenta solo si toca el tratamiento especial: la marca o su cabeza están marcadas. Unir dos marcas sin
  // tratamiento no cambia ninguna clave de flujo (ambas van a "otras de la agrupación").
  const conjuntos = [...config.unidadDe]
    .filter(([marca, unidad]) => marca !== unidad && (config.marcas.get(marca)?.marcada === true || config.marcas.get(unidad)?.marcada === true))
    .map(([marca, unidad]) => `${marca}>${unidad}`)
    .sort(cmp);
  const relevantes = [...config.relevantes].sort(cmp);
  return md5(["v" + VERSION_METODO_BARRER, "marcas", ...marcas, "conjuntos", ...conjuntos, "relevantes", ...relevantes].join("\n"));
}

// ─── Reparto aprobado: `huella_config` en tres partes ───

export type EntradaHuellaConfig = {
  modalidad: ModalidadBarrer;
  agrupacion_marca_id: string;
  /** Nodos con compras específicas vigentes de una mixta (vacío en una `barrido`). */
  gml_especificos: readonly string[];
  /** Ids de las marcas miembro del conjunto de la unidad (sin la cabeza). */
  miembros: readonly string[];
  temporadas: TemporadasConfig;
  modo: ModoEntrada;
  alcance: AlcanceApi;
  fuente: FuenteReparto;
  normaliza_nino: boolean;
  /** `gml_id → nivel` de cada nodo con venta al barrer. */
  niveles: ReadonlyMap<string, "GML" | "GMLE">;
  ventana_meses: number;
};

/** Ids de las marcas miembro del conjunto cuya cabeza es `marcaId` (sin la cabeza). */
export function miembrosDeUnidad(config: ConfigFlujo, marcaId: string): string[] {
  return [...config.unidadDe].filter(([marca, unidad]) => unidad === marcaId && marca !== marcaId).map(([marca]) => marca).sort(cmp);
}

export type PartesHuellaConfig = { cfg: string; niv: string; ven: string };

const rango = (r: { desde_mes: number; hasta_mes: number }) => `${r.desde_mes}-${r.hasta_mes}`;

/** Huella del nivel de cada nodo (`gml_id=nivel`, ordenado). */
export function huellaNiveles(niveles: ReadonlyMap<string, "GML" | "GMLE">): string {
  return corta(
    [...niveles]
      .map(([id, n]) => `${id}=${n}`)
      .sort(cmp)
      .join("\n")
  );
}

/**
 * `huella_config` = `cfg.niv.ven`: tres md5 cortos separados por punto, para que `motivosObsoleto` diga CUÁL cambió.
 *   cfg  modalidad, agrupación, GML específicos, miembros, temporadas, modo, alcance, fuente, Niño y `VERSION_METODO_BARRER`
 *   niv  el nivel (GML o GMLE) de cada nodo con venta
 *   ven  la ventana
 */
export function huellaConfig(e: EntradaHuellaConfig): string {
  const cfg = corta(
    [
      `v${VERSION_METODO_BARRER}`,
      e.modalidad,
      e.agrupacion_marca_id,
      `gml:${[...e.gml_especificos].sort(cmp).join(",")}`,
      `miembros:${[...e.miembros].sort(cmp).join(",")}`,
      `verano:${rango(e.temporadas.verano)}`,
      `invierno:${rango(e.temporadas.invierno)}`,
      `modo:${e.modo}`,
      `generos:${[...e.alcance.generos].sort(cmp).join(",")}`,
      `mundos:${[...e.alcance.mundos].sort(cmp).join(",")}`,
      `lineas:${[...e.alcance.lineas].sort(cmp).join(",")}`,
      `fuente:${e.fuente}`,
      `nino:${e.normaliza_nino ? 1 : 0}`,
    ].join("\n")
  );
  return `${cfg}.${huellaNiveles(e.niveles)}.${corta(`ventana:${e.ventana_meses}`)}`;
}

export function partesHuellaConfig(h: string): PartesHuellaConfig | null {
  const p = h.split(".");
  return p.length === 3 ? { cfg: p[0], niv: p[1], ven: p[2] } : null;
}

export type HuellasReparto = { huella_config: string; huella_cargas: string };

/**
 * Regla 11. Los motivos por los que el reparto vigente quedó obsoleto frente a lo que se calcularía hoy.
 *   `config_cambiada`, `nivel_cambiado`, `ventana_distinta`: siempre que su parte de la huella difiera (o la huella guardada no
 *   tenga la forma esperada: se trata como configuración cambiada);
 *   `cargas_nuevas`: solo si las cargas difieren Y algún `p2` se mueve más de `umbralPp` puntos (`diferenciaPp`, ya calculada por
 *   quien llama contra lo calculado entonces). Si se mueve menos, `al_dia` con la diferencia informativa.
 */
export function motivosObsoleto(
  vigente: HuellasReparto,
  actual: HuellasReparto,
  diferenciaPp: number | null,
  umbralPp: number = UMBRAL_OBSOLETO_PP
): { motivos: MotivoObsoleto[]; al_dia: boolean; diferencia_pp: number | null } {
  const motivos: MotivoObsoleto[] = [];
  const a = partesHuellaConfig(vigente.huella_config);
  const b = partesHuellaConfig(actual.huella_config);
  if (!a || !b) {
    motivos.push("config_cambiada");
  } else {
    if (a.cfg !== b.cfg) motivos.push("config_cambiada");
    if (a.niv !== b.niv) motivos.push("nivel_cambiado");
    if (a.ven !== b.ven) motivos.push("ventana_distinta");
  }
  if (vigente.huella_cargas !== actual.huella_cargas && diferenciaPp !== null && diferenciaPp > umbralPp) motivos.push("cargas_nuevas");
  return { motivos, al_dia: motivos.length === 0, diferencia_pp: diferenciaPp };
}

/**
 * Diferencia máxima, en puntos porcentuales, entre dos juegos de vectores `(g, llave) → participación` (fracciones): lo que se
 * movió el reparto. Lo que falta en un lado vale 0.
 */
export function diferenciaMaximaPp(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>
): number {
  let mayor = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) mayor = Math.max(mayor, Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)));
  return mayor * 100;
}

/** Llave `llave|clave` para `diferenciaMaximaPp`. */
export const llaveDiferencia = (llave: LlaveVector, clave: ClaveG) => `${llave}|${clave}`;

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * `huella` del análisis (la que el `POST` de aprobar devuelve para detectar que los datos cambiaron mientras el planner decidía):
 * cargas, configuración y los vectores calculados (histórico y según la cerrada) redondeados.
 */
export function huellaAnalisis(
  h: HuellasReparto,
  vectores: ReadonlyMap<string, number>,
  cerrada: ReadonlyMap<string, number> | null
): string {
  const lineas = (m: ReadonlyMap<string, number>) =>
    [...m]
      .map(([k, v]) => `${k}=${r6(v)}`)
      .sort(cmp)
      .join("\n");
  return md5([h.huella_cargas, h.huella_config, "hist", lineas(vectores), "cerrada", cerrada ? lineas(cerrada) : "-"].join("\n"));
}
