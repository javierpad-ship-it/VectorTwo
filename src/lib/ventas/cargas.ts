import { centimosASoles, aCentimos } from "./numeros";
import { esMesCerrado } from "./periodo";
import {
  CADUCIDAD_CARGA_MIN,
  FILAS_XLS_TRUNCADO,
  TANDA_CLIENTE,
  type Consolidado,
  type FilaCargable,
  type HuellaMes,
  type InformeMes,
  type MedidasCarga,
} from "./tipos";
import type { DiferenciaMedida, EstadoCarga, TandaPeticion } from "./tipos-api";

/**
 * Estado y tandas de las cargas (docs/modulos/05-venta-stock.md, regla 31 y
 * 32). Funciones puras: las usan los handlers (transiciones, caducidad,
 * conciliación) y el navegador (partir en meses y tandas, saltar meses ya
 * cargados, reintentos).
 */

// ─── Estados ───

/** Las seis transiciones válidas; no hay otras. */
export const TRANSICIONES: Readonly<Record<EstadoCarga, readonly EstadoCarga[]>> = {
  en_curso: ["publicada", "abandonada", "fallida"],
  publicada: ["reemplazada", "retirada"],
  reemplazada: [],
  retirada: [],
  abandonada: [],
  fallida: [],
};

/** Estados terminales: sus filas se limpian después. */
export const ESTADOS_TERMINALES: readonly EstadoCarga[] = ["reemplazada", "retirada", "abandonada", "fallida"];

export function transicionPermitida(de: EstadoCarga, a: EstadoCarga): boolean {
  return TRANSICIONES[de].includes(a);
}

/** Regla 31: cualquier transición que no sea de la lista lanza error. */
export function exigirTransicion(de: EstadoCarga, a: EstadoCarga): void {
  if (!transicionPermitida(de, a)) throw new Error(`Transición de carga no permitida: ${de} → ${a}.`);
}

export function esEstadoCarga(valor: unknown): valor is EstadoCarga {
  return typeof valor === "string" && valor in TRANSICIONES;
}

/** Una carga `en_curso` sin tandas hace más de 30 minutos está caducada (29 no, 31 sí). */
export function cargaCaducada(updatedAt: string | Date, ahora: Date = new Date(), minutos = CADUCIDAD_CARGA_MIN): boolean {
  const t = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : updatedAt.getTime();
  return ahora.getTime() - t > minutos * 60_000;
}

export type MotivoRechazoAbrir = { codigo: "mes_ya_cargado" | "mes_abierto"; mensaje: string };

/**
 * Regla 31: reemplazar una `publicada` exige `reemplazar`; un mes que no ha
 * cerrado (según la fecha de Lima) exige `mes_abierto`.
 */
export function motivoRechazoAbrir(datos: {
  hayPublicada: boolean;
  reemplazar: boolean;
  periodo: string;
  mesAbierto: boolean;
  hoyLima: string;
}): MotivoRechazoAbrir | null {
  if (datos.hayPublicada && !datos.reemplazar) {
    return {
      codigo: "mes_ya_cargado",
      mensaje: `${datos.periodo} ya está cargado. Confirma el reemplazo para cargarlo de nuevo.`,
    };
  }
  if (!esMesCerrado(datos.periodo, datos.hoyLima) && !datos.mesAbierto) {
    return {
      codigo: "mes_abierto",
      mensaje: `${datos.periodo} todavía no cerró: su venta está incompleta. Confirma para cargarlo igual.`,
    };
  }
  return null;
}

const formatoHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Hora de Lima `HH:mm` de un instante. */
export function horaLima(instante: string | Date): string {
  return formatoHora.format(typeof instante === "string" ? new Date(instante) : instante);
}

/** "Carga en curso de ese mes por Ana desde las 10:42." */
export function mensajeCargaEnCurso(usuario: string | null, desde: string | Date): string {
  return `Carga en curso de ese mes por ${usuario ?? "otra persona"} desde las ${horaLima(desde)}.`;
}

// ─── Meses y tandas ───

/** Regla 32: reparte cada fila en el mes que le toca, sin perder ni duplicar ninguna y en orden. */
export function partirEnMeses<T extends { periodo: string }>(filas: readonly T[]): Map<string, T[]> {
  const meses = new Map<string, T[]>();
  for (const f of filas) {
    const l = meses.get(f.periodo);
    if (l) l.push(f);
    else meses.set(f.periodo, [f]);
  }
  return meses;
}

/** Regla 32: parte en tandas de `tamano` conservando el orden y el total. */
export function partirEnTandas<T>(filas: readonly T[], tamano = TANDA_CLIENTE): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < filas.length; i += tamano) tandas.push(filas.slice(i, i + tamano));
  return tandas;
}

/**
 * Arma la petición de una tanda: filas posicionales y diccionario con SOLO los
 * ids que esa tanda usa (≈ 40 B por fila en vez de 330).
 */
export function armarTanda(filas: readonly FilaCargable[], numero: number): TandaPeticion {
  const tiendas: string[] = [];
  const equivalencias: string[] = [];
  const marcas: string[] = [];
  const idxT = new Map<string, number>();
  const idxE = new Map<string, number>();
  const idxM = new Map<string, number>();
  const indice = (mapa: Map<string, number>, lista: string[], id: string): number => {
    const previo = mapa.get(id);
    if (previo !== undefined) return previo;
    mapa.set(id, lista.length);
    lista.push(id);
    return lista.length - 1;
  };
  return {
    tanda: numero,
    diccionario: { tiendas, equivalencias, marcas },
    filas: filas.map((f) => [
      indice(idxT, tiendas, f.tienda_id),
      indice(idxE, equivalencias, f.equivalencia_id),
      indice(idxM, marcas, f.marca_id),
      f.talla,
      f.unidades,
      f.venta_soles,
      f.costo_vendido,
      f.stock_unidades,
      f.stock_valorizado,
    ]),
  };
}

/** Las filas de un mes del consolidado como objetos (≈ 35 mil por mes), con las marcas ya sustituidas por sus ids. */
export function filasCargablesDeMes(c: Consolidado, periodo: string): FilaCargable[] {
  const m = c.meses.get(periodo);
  if (!m) return [];
  const filas: FilaCargable[] = new Array(m.filas);
  for (let i = 0; i < m.filas; i++) {
    filas[i] = {
      tienda_id: c.tiendas[m.tienda[i]],
      equivalencia_id: c.equivalencias[m.equivalencia[i]],
      marca_id: c.marcas[m.marca[i]],
      talla: m.talla[i] === 1 ? 1 : 0,
      unidades: m.unidades[i],
      venta_soles: centimosASoles(m.venta[i]),
      costo_vendido: centimosASoles(m.costo[i]),
      stock_unidades: m.stock_unidades[i],
      stock_valorizado: centimosASoles(m.stock_valorizado[i]),
    };
  }
  return filas;
}

/** Tandas de un mes, ya armadas, numeradas desde 1. */
export function tandasDeMes(c: Consolidado, periodo: string, tamano = TANDA_CLIENTE): TandaPeticion[] {
  return partirEnTandas(filasCargablesDeMes(c, periodo), tamano).map((filas, i) => armarTanda(filas, i + 1));
}

/** Lo que el cliente enviará de un mes (el `esperado` de publicar), en soles exactos. */
export function esperadoDeMes(c: Consolidado, periodo: string): MedidasCarga {
  const m = c.meses.get(periodo);
  if (!m) return { filas: 0, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 };
  let u = 0;
  let v = 0;
  let co = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < m.filas; i++) {
    u += m.unidades[i];
    v += m.venta[i];
    co += m.costo[i];
    su += m.stock_unidades[i];
    sv += m.stock_valorizado[i];
  }
  return {
    filas: m.filas,
    unidades: u,
    venta_soles: centimosASoles(v),
    costo_vendido: centimosASoles(co),
    stock_unidades: su,
    stock_valorizado: centimosASoles(sv),
  };
}

// ─── Qué meses se saltan, bloquean o reintentan ───

type Publicada = Pick<MedidasCarga, "filas" | "unidades" | "venta_soles" | "costo_vendido" | "stock_unidades" | "stock_valorizado">;

/**
 * Regla 32: un mes es "idéntico a lo ya cargado" solo si coinciden las filas,
 * las cinco medidas y la huella de stock con la carga publicada.
 */
export function esIdentico(
  cargado: MedidasCarga,
  huella: HuellaMes,
  publicada: Publicada,
  huellaPublicada: HuellaMes | null
): boolean {
  if (!huellaPublicada) return false;
  return (
    cargado.filas === publicada.filas &&
    cargado.unidades === publicada.unidades &&
    cargado.stock_unidades === publicada.stock_unidades &&
    aCentimos(cargado.venta_soles) === aCentimos(publicada.venta_soles) &&
    aCentimos(cargado.costo_vendido) === aCentimos(publicada.costo_vendido) &&
    aCentimos(cargado.stock_valorizado) === aCentimos(publicada.stock_valorizado) &&
    huella.filas_con_stock === huellaPublicada.filas_con_stock &&
    huella.stock_unidades === huellaPublicada.stock_unidades &&
    aCentimos(huella.stock_valorizado) === aCentimos(huellaPublicada.stock_valorizado)
  );
}

/** Periodos que se pueden saltar por estar ya publicados con los mismos totales. */
export function mesesASaltar(meses: readonly Pick<InformeMes, "periodo" | "estado">[]): string[] {
  return meses.filter((m) => m.estado === "identico").map((m) => m.periodo);
}

/** Regla 32: un mes con errores >= 2 % está bloqueado salvo que se fuerce (queda `Incompleto`). */
export function mesBloqueado(mes: Pick<InformeMes, "bloqueado">, forzarIncompleto: boolean): boolean {
  return mes.bloqueado && !forzarIncompleto;
}

/**
 * Regla 32: red (sin respuesta o `status` 0) y `5xx` se reintentan (hasta
 * `REINTENTOS_TANDA`, la tanda es idempotente); cualquier `4xx` descarta el mes.
 */
export function esReintentable(fallo: unknown): boolean {
  const status = typeof fallo === "object" && fallo !== null && "status" in fallo ? (fallo as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status > 0) return status >= 500;
  return true;
}

// ─── Conciliación de la publicación ───

const CLAVES_MEDIDA: readonly (keyof MedidasCarga)[] = [
  "filas",
  "unidades",
  "venta_soles",
  "costo_vendido",
  "stock_unidades",
  "stock_valorizado",
];
const DINERO: readonly (keyof MedidasCarga)[] = ["venta_soles", "costo_vendido", "stock_valorizado"];

/** Medidas que no coinciden entre lo esperado y lo medido (el dinero se compara en céntimos). */
export function diferenciasMedidas(esperado: MedidasCarga, medido: MedidasCarga): DiferenciaMedida[] {
  const salida: DiferenciaMedida[] = [];
  for (const medida of CLAVES_MEDIDA) {
    const e = esperado[medida];
    const m = medido[medida];
    const dinero = DINERO.includes(medida);
    if (dinero ? aCentimos(e) !== aCentimos(m) : e !== m) {
      salida.push({ medida, esperado: e, medido: m, diferencia: dinero ? centimosASoles(aCentimos(m) - aCentimos(e)) : m - e });
    }
  }
  return salida;
}

const fmtEntero = (n: number) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** "Faltan 2 000 filas: se perdió una tanda." */
export function mensajeNoConcilia(esperado: MedidasCarga, medido: MedidasCarga): string {
  const dif = medido.filas - esperado.filas;
  if (dif < 0) return `Faltan ${fmtEntero(dif)} filas: se perdió una tanda. El mes anterior sigue intacto; vuelve a cargar este mes.`;
  if (dif > 0) return `Sobran ${fmtEntero(dif)} filas: llegó una tanda de más. El mes anterior sigue intacto; vuelve a cargar este mes.`;
  return "Las filas coinciden pero las cifras no. El mes anterior sigue intacto; vuelve a cargar este mes.";
}

// ─── Archivo truncado (regla 25) ───

/**
 * Una hoja `.xls` de exactamente 65 536 filas (cabecera incluida) está
 * posiblemente truncada: ese es el tope del formato. Un CSV (o un `.xlsx`) con
 * 65 535 filas de datos no lo dispara.
 */
export function archivoPosiblementeTruncado(nombre: string, filasHoja: number | null): boolean {
  return /\.xls$/i.test(nombre) && filasHoja === FILAS_XLS_TRUNCADO;
}

// ─── Descartar una carga (DELETE) ───

/**
 * A qué estado pasa una carga al descartarla: `en_curso` → `abandonada`,
 * `publicada` → `retirada`. Con `soloEnCurso` (el flujo de carga) una carga
 * `publicada` NO se toca: ante una publicación ambigua un descarte automático
 * jamás debe retirar un mes ya publicado. Cualquier otro estado es un `409`.
 */
export function destinoDescarte(estado: string, soloEnCurso: boolean): { a: EstadoCarga } | { mensaje: string } {
  const legible = estado.replace("_", " ");
  if (!esEstadoCarga(estado)) return { mensaje: `Esa carga está ${legible} y ya no se puede descartar.` };
  if (soloEnCurso && estado !== "en_curso") return { mensaje: `Esa carga está ${legible}: no se descarta desde la carga.` };
  if (estado === "en_curso") return { a: "abandonada" };
  if (estado === "publicada") return { a: "retirada" };
  return { mensaje: `Esa carga está ${legible} y ya no se puede descartar.` };
}
