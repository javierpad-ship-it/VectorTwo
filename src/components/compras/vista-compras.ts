import type {
  AvisoLineaCompra,
  AvisoRecepcion,
  CompraApi,
  EntregaLineaApi,
  EstadoCompra,
  LineaCompraApi,
  OrigenCompra,
  RecepcionLineaApi,
} from "@/lib/compras/tipos-api";
import { ESTADOS_COMPRA, ORIGENES_COMPRA } from "@/lib/compras/tipos";
import type { FiltrosCompras } from "@/lib/compras/use-compras";
import { dinero, mesCorto, mesLargo, sumarMes, ultimoDiaDelMes, unidades } from "./formato";

/**
 * Lógica de la pantalla Compras (`/compras/registro`, ficha 08 §4.4 y §4.7): parámetros de la URL, filtros, textos y valores por defecto
 * de «Confirmar ingreso», y los textos de los `confirm`. Pura. En `0.13.0` la pantalla es la lista y el detalle (cabecera, líneas, entregas
 * con su pendiente, recepciones e historial) más las acciones de admin y planner: importar la carga inicial, confirmar ingreso, quitar un
 * ingreso y cancelar. «Ingreso» es el nombre en pantalla de lo que la base y la API llaman recepción.
 */

export type ParametrosCompras = {
  /** La compra abierta (detalle), o `null` para la lista. */
  compra: string | null;
  estado: EstadoCompra | null;
  proveedor: string | null;
  origen: OrigenCompra | null;
  /** Mes de entrega (`aaaa-mm`): compras con alguna entrega entre `desde` y `hasta`, ambos incluidos. */
  desde: string | null;
  hasta: string | null;
  /** Ids del árbol de producto y de la marca (viajan al servidor). */
  genero: string | null;
  mundo: string | null;
  linea: string | null;
  marca: string | null;
  porConfirmar: boolean;
  q: string;
  importar: boolean;
};

export const PARAMETROS_COMPRAS_VACIOS: ParametrosCompras = {
  compra: null,
  estado: null,
  proveedor: null,
  origen: null,
  desde: null,
  hasta: null,
  genero: null,
  mundo: null,
  linea: null,
  marca: null,
  porConfirmar: false,
  q: "",
  importar: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function leerParametrosCompras(get: (clave: string) => string | null): ParametrosCompras {
  const estado = get("estado");
  const origen = get("origen");
  const uuidONulo = (k: string) => {
    const v = get(k);
    return v !== null && UUID.test(v) ? v : null;
  };
  const mesONulo = (k: string) => {
    const v = get(k);
    return v !== null && MES.test(v) ? v : null;
  };
  const desde = mesONulo("desde");
  const hasta = mesONulo("hasta");
  return {
    compra: uuidONulo("compra"),
    estado: (ESTADOS_COMPRA as readonly string[]).includes(estado ?? "") ? (estado as EstadoCompra) : null,
    proveedor: uuidONulo("proveedor"),
    origen: (ORIGENES_COMPRA as readonly string[]).includes(origen ?? "") ? (origen as OrigenCompra) : null,
    // Un rango al revés (`desde` después de `hasta`) se ignora entero: la API lo rechazaría con 400.
    desde: desde !== null && hasta !== null && desde > hasta ? null : desde,
    hasta: desde !== null && hasta !== null && desde > hasta ? null : hasta,
    genero: uuidONulo("genero"),
    mundo: uuidONulo("mundo"),
    linea: uuidONulo("linea"),
    marca: uuidONulo("marca"),
    porConfirmar: get("por_confirmar") === "1",
    q: get("q") ?? "",
    importar: get("importar") === "1",
  };
}

export function consultaCompras(p: ParametrosCompras): string {
  const q = new URLSearchParams();
  if (p.compra) q.set("compra", p.compra);
  if (p.estado) q.set("estado", p.estado);
  if (p.proveedor) q.set("proveedor", p.proveedor);
  if (p.origen) q.set("origen", p.origen);
  if (p.desde) q.set("desde", p.desde);
  if (p.hasta) q.set("hasta", p.hasta);
  if (p.genero) q.set("genero", p.genero);
  if (p.mundo) q.set("mundo", p.mundo);
  if (p.linea) q.set("linea", p.linea);
  if (p.marca) q.set("marca", p.marca);
  if (p.porConfirmar) q.set("por_confirmar", "1");
  if (p.q.trim() !== "") q.set("q", p.q);
  if (p.importar) q.set("importar", "1");
  return q.toString();
}

/** Lo que viaja al servidor; el texto libre se aplica en el navegador (`filtrarCompras`). */
export function filtrosCompras(p: ParametrosCompras): FiltrosCompras {
  return {
    estado: p.estado ?? undefined,
    proveedor_id: p.proveedor ?? undefined,
    origen: p.origen ?? undefined,
    llegada_desde: p.desde ?? undefined,
    llegada_hasta: p.hasta ?? undefined,
    genero_id: p.genero ?? undefined,
    mundo_id: p.mundo ?? undefined,
    linea_id: p.linea ?? undefined,
    marca_id: p.marca ?? undefined,
    por_confirmar: p.porConfirmar || undefined,
  };
}

export const hayFiltrosCompras = (p: ParametrosCompras): boolean =>
  p.estado !== null ||
  p.proveedor !== null ||
  p.origen !== null ||
  p.desde !== null ||
  p.hasta !== null ||
  p.genero !== null ||
  p.mundo !== null ||
  p.linea !== null ||
  p.marca !== null ||
  p.porConfirmar ||
  p.q.trim() !== "";

/** Número, proveedor, referencia y nota; sin distinguir mayúsculas ni acentos. */
export function filtrarCompras(compras: readonly CompraApi[], q: string): CompraApi[] {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
  const t = norm(q.trim());
  if (t === "") return [...compras];
  return compras.filter((c) => norm(`${c.numero} ${c.proveedor.nombre} ${c.referencia ?? ""} ${c.nota ?? ""}`).includes(t));
}

export const ETIQUETA_FILTRO_ESTADO: Record<EstadoCompra, string> = { borrador: "Borrador", confirmada: "Confirmada", recibida: "Recibida", cancelada: "Cancelada" };

// ─── Estado y totales ───

export type TonoEstado = "marca" | "exito" | "alerta" | "neutro";

export function estadoCompra(c: Pick<CompraApi, "estado" | "saldo_cerrado" | "lineas">): { texto: string; tono: TonoEstado } {
  if (c.saldo_cerrado) {
    const canceladas = c.lineas.reduce((a, l) => a + l.unidades_canceladas, 0);
    return { texto: `Recibida · saldo cancelado (${unidades(canceladas)} u)`, tono: "exito" };
  }
  switch (c.estado) {
    case "borrador":
      return { texto: "Borrador", tono: "neutro" };
    case "confirmada":
      return { texto: "Confirmada", tono: "marca" };
    case "recibida":
      return { texto: "Recibida", tono: "exito" };
    default:
      return { texto: "Cancelada", tono: "alerta" };
  }
}

export const textoCosto = (c: Pick<CompraApi, "moneda" | "totales">): string => dinero(c.moneda, c.totales.costo);

export function textoEntregas(c: Pick<CompraApi, "llegadas">): string {
  if (!c.llegadas) return "—";
  const { desde, hasta, entregas } = c.llegadas;
  return `${desde === hasta ? mesCorto(desde) : `${mesCorto(desde)} a ${mesCorto(hasta)}`} (${entregas})`;
}

/** Unidades de entregas vencidas que nadie confirmó (solo cuentan compras confirmadas). */
export function unidadesPorConfirmar(c: Pick<CompraApi, "estado" | "lineas">): number {
  if (c.estado !== "confirmada") return 0;
  return c.lineas.reduce((a, l) => a + l.entregas.filter((e) => e.vencida).reduce((b, e) => b + e.pendiente, 0), 0);
}

export const TEXTO_AVISO_LINEA: Record<AvisoLineaCompra, string> = {
  sin_reparto: "Sin reparto vigente: no cuenta en el flujo hasta que se apruebe uno en Marcas al barrer.",
  reparto_cambio: "Se aprobó un reparto nuevo: esta línea conserva el que tenía hasta que se aplique.",
  exceso: "Deja el IMI por encima del máximo en algún mes (informativo).",
  entrega_vencida: "Tiene entregas vencidas sin confirmar: el flujo las sigue esperando.",
  entrega_pasada: "Tiene una entrega en un mes ya publicado sin ingreso confirmado: quedará vencida.",
  miembro_resuelto: "Un miembro de la agrupación se resolvió automáticamente.",
  directo_con_regla:
    "Esta compra directa se suma a la reposición directa esperada. Si ya es parte de esa reposición habitual, se está contando dos veces: en ese caso no la registres o baja el % directo en Intercompany.",
  directo_sin_regla: "Compra directa de una marca intercompany sin regla vigente para ese GML.",
};

export const TEXTO_AVISO_RECEPCION: Record<AvisoRecepcion, string> = {
  recepcion_en_mes_cerrado: "Mes ya publicado: no suma al flujo futuro y la conciliación la contrasta con el inventario.",
  recibida_futura: "Mes sin publicar: suma al flujo en ese mes.",
  recepcion_sin_respaldo: "El inventario publicado no muestra este ingreso.",
  recepcion_sobre_saldo_cancelado: "Ingreso tardío sobre el saldo que se había cancelado.",
};

/** Estado de una entrega para la tabla del detalle. */
export function estadoEntrega(e: Pick<EntregaLineaApi, "vencida" | "pendiente" | "asignadas" | "canceladas" | "unidades">): { texto: string; tono: TonoEstado } {
  if (e.vencida) return { texto: "Vencida · por confirmar", tono: "alerta" };
  if (e.pendiente === 0 && e.canceladas > 0) return { texto: "Saldo cancelado", tono: "neutro" };
  if (e.pendiente === 0) return { texto: "Recibida", tono: "exito" };
  if (e.asignadas > 0) return { texto: "Parcial", tono: "marca" };
  return { texto: "Pendiente", tono: "neutro" };
}

/** Descripción de dónde cae una línea: la ruta GML(E) de una específica o «al barrer» con su alcance en un lote. */
export function descripcionLinea(l: LineaCompraApi): string {
  if (l.tipo === "especifica") return l.ruta ?? "—";
  if (l.tipo === "barrer_marca") {
    const a = l.alcance;
    const partes = a ? [...a.generos, ...a.mundos, ...a.lineas] : [];
    return partes.length > 0 ? `al barrer · alcance ${partes.join(", ")}` : "al barrer · todos los GML de la marca";
  }
  return "mezcla de varias marcas";
}

/** Lo que se puede confirmar como ingresado en una línea: todo lo que no está recibido (con saldo cerrado, hasta lo cancelado). */
export const unidadesConfirmables = (l: Pick<LineaCompraApi, "unidades" | "unidades_recibidas">): number => Math.max(0, l.unidades - l.unidades_recibidas);

// ─── Confirmar ingreso: valores por defecto (ficha 08 §4.4) ───

/** Mes X por defecto: el que sugiere la conciliación; si no hay, el de la entrega; si la entrega es futura, el mes en curso. Nunca antes de la compra. */
export function mesPorDefectoIngreso(p: { entrega: Pick<EntregaLineaApi, "periodo" | "sugerencia"> | null; fechaCompra: string; hoyMes: string }): string {
  const base = p.entrega?.sugerencia?.periodo ?? (p.entrega && p.entrega.periodo <= p.hoyMes ? p.entrega.periodo : p.hoyMes);
  const minimo = p.fechaCompra.slice(0, 7);
  return base < minimo ? minimo : base;
}

/** Fecha del ingreso por defecto: hoy si X es el mes en curso, el último día de X si ya pasó y el primero si es futuro. */
export function fechaPorDefectoIngreso(mes: string, hoyFecha: string): string {
  const hoyMes = hoyFecha.slice(0, 7);
  if (mes === hoyMes) return hoyFecha;
  return mes < hoyMes ? ultimoDiaDelMes(mes) : `${mes}-01`;
}

/** Los meses que ofrece el selector: de la compra a seis meses después de hoy (o después de la entrega, si es más tarde). */
export function mesesParaIngreso(p: { fechaCompra: string; hoyMes: string; hastaMin?: string }): string[] {
  const desde = p.fechaCompra.slice(0, 7);
  const hasta = [sumarMes(p.hoyMes, 6), p.hastaMin ?? ""].reduce((a, b) => (b > a ? b : a));
  const salida: string[] = [];
  for (let m = desde; m <= hasta && salida.length < 120; m = sumarMes(m, 1)) salida.push(m);
  return salida;
}

// ─── Textos de los `confirm` (acciones destructivas o que cambian el flujo) ───

/** Lo que se va a registrar, en una frase: la usan el diálogo de Confirmar ingreso y el `confirm` de Aceptar sugerencia. */
export function resumenIngreso(numeroCompra: string, numeroLinea: number | null, unidadesIngreso: number, mes: string): string {
  return `${unidades(unidadesIngreso)} u de ${numeroCompra}${numeroLinea !== null && numeroLinea > 0 ? `, línea ${numeroLinea}` : ""}, como ingresadas en ${mesLargo(mes)}, a tu nombre`;
}

export function textoConfirmarQuitar(c: Pick<CompraApi, "numero">, numeroLinea: number, r: Pick<RecepcionLineaApi, "unidades" | "recibida_periodo">): string {
  return `Quitar el ingreso de ${unidades(r.unidades)} u de ${mesLargo(r.recibida_periodo)} de ${c.numero}, línea ${numeroLinea}. Esas unidades vuelven a esperarse en el flujo; queda en el historial.`;
}

/** El `confirm` de cancelar: sin ingresos se cancela entera; con ingresos se cierra el saldo y la compra queda recibida (§0.11). */
export function textoConfirmarCancelar(c: Pick<CompraApi, "numero" | "totales" | "lineas">): string {
  const recibidas = c.totales.recibidas;
  if (recibidas <= 0) return `Se cancela ${c.numero}: dejará de contar en el flujo y ya no se podrá modificar. Queda en el historial.`;
  const saldo = c.lineas.reduce((a, l) => a + Math.max(0, l.unidades - l.unidades_recibidas - l.unidades_canceladas), 0);
  return `${c.numero} tiene ${unidades(recibidas)} u confirmadas de ${unidades(c.totales.unidades)}: se cancela el saldo de ${unidades(saldo)} u y la compra queda como recibida parcialmente. Los ingresos siguen valiendo.`;
}

/** Etiqueta corta de un aviso de línea (la lista de compras); el texto completo va en el detalle. */
export const ETIQUETA_CORTA_AVISO_LINEA: Record<AvisoLineaCompra, string> = {
  sin_reparto: "Sin reparto",
  reparto_cambio: "Reparto nuevo",
  exceso: "Exceso",
  entrega_vencida: "Entrega vencida",
  entrega_pasada: "Entrega pasada",
  miembro_resuelto: "Miembro resuelto",
  directo_con_regla: "Directo con regla",
  directo_sin_regla: "Directo sin regla",
};
