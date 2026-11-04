import type {
  AvisoImportacionCompraAgrupador,
  AgrupadorImportacionCompraApi,
  EntregaSinEmbarqueApi,
  OpcionEmbarqueApi,
  ViajeResumenApi,
} from "@/lib/compras/agrupadores/tipos-api";
import type { AsignacionEntregaApi, CompraApi, EntregaLineaApi, LineaCompraApi } from "@/lib/compras/tipos-api";
import { consultaAgrupadores, PARAMETROS_AGRUPADORES_VACIOS } from "./agrupadores/vista-agrupadores";
import { mesCorto, unidades } from "./formato";

/**
 * Lógica pura de la integración de los agrupadores (ficha 08b, §4.5) en la pantalla Compras: el viaje y los embarques de cada compra, los
 * chips de cada entrega, lo que queda sin embarque, los enlaces al detalle del embarque y los textos del reporte del importador. Sin React ni
 * red. Las compras de M8 que no traen agrupadores (`viaje`, `asignaciones`, `sin_embarque` opcionales en el tipo) se leen como «sin nada».
 */

// ─── Qué compra admite asignar ───

/**
 * Se asigna (viaje o embarque) en compras `borrador` o `confirmada` y sin el saldo cerrado: es la misma regla de la pestaña Sin agrupador y
 * de `planAsignar` (ficha 08b §3.4). La API es la que manda; aquí solo se ocultan los botones que darían `409`.
 */
export const admiteAsignarAgrupador = (c: Pick<CompraApi, "estado" | "saldo_cerrado">): boolean => (c.estado === "borrador" || c.estado === "confirmada") && !c.saldo_cerrado;

/** Cualquier compra no cancelada admite cambiar su viaje (la función solo rechaza la cancelada: `no_editable`). */
export const admiteCambiarViaje = (c: Pick<CompraApi, "estado">): boolean => c.estado !== "cancelada";

// ─── Viaje ───

/** `261001 · Feria Sur`, con «(cerrado)» si el viaje está cerrado. */
export const textoViajeCompra = (v: Pick<ViajeResumenApi, "codigo" | "nombre" | "estado">): string => `${v.codigo} · ${v.nombre}${v.estado === "cerrado" ? " (cerrado)" : ""}`;

/** `/compras/agrupadores?pestana=viajes&viaje=<id>`: el detalle del viaje en Viajes y embarques. */
export const hrefViaje = (id: string): string => `/compras/agrupadores?${consultaAgrupadores({ ...PARAMETROS_AGRUPADORES_VACIOS, pestana: "viajes", viaje: id })}`;

/** `/compras/agrupadores?embarque=<id>`: el detalle del embarque en Viajes y embarques (la pestaña por defecto). */
export const hrefEmbarque = (id: string): string => `/compras/agrupadores?${consultaAgrupadores({ ...PARAMETROS_AGRUPADORES_VACIOS, embarque: id })}`;

// ─── Embarques de una compra ───

export type EmbarqueDeCompra = { id: string; codigo: string; unidades: number; paquetes: string[] };

/** Los embarques a los que viaja la compra, sin repetir, con las unidades de cada uno y los paquetes en que van; por código. */
export function embarquesDeCompra(c: Pick<CompraApi, "lineas">): EmbarqueDeCompra[] {
  const porId = new Map<string, EmbarqueDeCompra>();
  for (const l of c.lineas) {
    for (const e of l.entregas) {
      for (const a of e.asignaciones ?? []) {
        const x = porId.get(a.embarque.id) ?? { id: a.embarque.id, codigo: a.embarque.codigo, unidades: 0, paquetes: [] };
        x.unidades += a.unidades;
        if (a.paquete && !x.paquetes.includes(a.paquete.codigo)) x.paquetes.push(a.paquete.codigo);
        porId.set(a.embarque.id, x);
      }
    }
  }
  return [...porId.values()].map((x) => ({ ...x, paquetes: [...x.paquetes].sort() })).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/**
 * Unidades de la compra que ningún embarque cubre (la suma de `sin_embarque` de sus entregas). Solo cuentan las compras que admiten asignar:
 * en una recibida o cancelada la cifra no es un pendiente.
 */
export function unidadesSinEmbarque(c: Pick<CompraApi, "estado" | "saldo_cerrado" | "lineas">): number {
  if (!admiteAsignarAgrupador(c)) return 0;
  return c.lineas.reduce((a, l) => a + l.entregas.reduce((b, e) => b + (e.sin_embarque ?? 0), 0), 0);
}

/** El texto de un chip de entrega: `Embarque 261101 · P 261101 · 300 u` (sin el paquete si no tiene). */
export function textoChipAsignacion(a: Pick<AsignacionEntregaApi, "embarque" | "paquete" | "unidades">): string {
  return `Embarque ${a.embarque.codigo}${a.paquete ? ` · P ${a.paquete.codigo}` : ""} · ${unidades(a.unidades)} u`;
}

/** «120 u sin embarque». */
export const textoSinEmbarque = (n: number): string => `${unidades(n)} u sin embarque`;

// ─── Filtro de embarque ───

/**
 * Los embarques que ofrece el filtro de la lista (los no cancelados, más el elegido aunque esté cancelado, para que el selector lo muestre),
 * por mes de llegada y código; rotulados con el tipo.
 */
export function opcionesEmbarqueFiltro(embarques: readonly OpcionEmbarqueApi[], elegido: string | null = null): { id: string; nombre: string }[] {
  return [...embarques]
    .filter((e) => e.estado !== "cancelado" || e.id === elegido)
    .sort((a, b) => (a.periodo_llegada === b.periodo_llegada ? a.codigo.localeCompare(b.codigo) : a.periodo_llegada < b.periodo_llegada ? -1 : 1))
    .map((e) => ({ id: e.id, nombre: `Embarque ${e.codigo} · ${mesCorto(e.periodo_llegada)} · ${e.nombre}` }));
}

// ─── De una entrega de la compra a lo que pide «Asignar a embarque» ───

/**
 * Una entrega con unidades sin embarque, en la forma que usa el diálogo de asignar (`DialogoAsignar`, modo `entregas`). `null` si no hay
 * nada sin embarque o la compra no admite asignar.
 */
export function entregaComoSinEmbarque(compra: CompraApi, linea: LineaCompraApi, entrega: EntregaLineaApi): EntregaSinEmbarqueApi | null {
  const sin = entrega.sin_embarque ?? 0;
  if (sin <= 0 || !admiteAsignarAgrupador(compra)) return null;
  return {
    entrega_id: entrega.id,
    periodo: entrega.periodo,
    unidades: entrega.unidades,
    sin_asignar: sin,
    compra: {
      id: compra.id,
      numero: compra.numero,
      revision: compra.revision,
      estado: compra.estado,
      proveedor: { id: compra.proveedor.id, nombre: compra.proveedor.nombre },
      viaje_id: compra.viaje?.id ?? null,
      fecha_compra: compra.fecha_compra,
    },
    linea: {
      id: linea.id,
      tipo: linea.tipo,
      gml: linea.ruta,
      marca: linea.marca,
      agrupacion_marca: linea.agrupacion_marca,
      tallas: linea.tallas,
      costo_unitario: linea.costo_unitario,
      moneda: compra.moneda,
    },
  };
}

/** Todas las entregas de la compra con unidades sin embarque, para el botón «Asignar a embarque…» de la cabecera. */
export function entregasSinEmbarqueDeCompra(compra: CompraApi): EntregaSinEmbarqueApi[] {
  return compra.lineas.flatMap((l) => l.entregas.map((e) => entregaComoSinEmbarque(compra, l, e)).filter((x): x is EntregaSinEmbarqueApi => x !== null));
}

// ─── Importador de compras: columnas VIAJE, EMBARQUE y PAQUETE ───

export const ETIQUETA_AVISO_IMPORTACION_COMPRA_AGRUPADOR: Record<AvisoImportacionCompraAgrupador, string> = {
  viaje_cerrado: "El viaje está cerrado: igual se registra",
  agrupador_distinto: "Ya está asignada a otro embarque: no se toca (cámbiala en Viajes y embarques)",
  viaje_distinto: "El viaje de la compra es otro que el del embarque",
};

export const ETIQUETA_RESULTADO_AGRUPADOR: Record<AgrupadorImportacionCompraApi["resultado"], { aplicado: string; previsto: string; tono: "exito" | "neutro" | "alerta" }> = {
  asignado: { previsto: "Se asignará", aplicado: "Asignado", tono: "exito" },
  sin_cambio: { previsto: "Sin cambio", aplicado: "Sin cambio", tono: "neutro" },
  omitido: { previsto: "Fila omitida", aplicado: "Fila omitida", tono: "alerta" },
};

/** Cuántas filas hizo cada cosa el importador con sus columnas de agrupador. */
export function totalesAgrupadores(filas: readonly AgrupadorImportacionCompraApi[]): { asignado: number; sin_cambio: number; omitido: number; no_asignado: number } {
  return {
    asignado: filas.filter((f) => f.resultado === "asignado").length,
    sin_cambio: filas.filter((f) => f.resultado === "sin_cambio").length,
    omitido: filas.filter((f) => f.resultado === "omitido").length,
    no_asignado: filas.filter((f) => f.no_asignado !== undefined).length,
  };
}

/** Lo que dice la fila de agrupadores del reporte en una celda: «261001 · Embarque 261101 · P 261101». */
export function textoAgrupadoresFila(f: Pick<AgrupadorImportacionCompraApi, "viaje" | "embarque" | "paquete">): string {
  const partes = [f.viaje ? `Viaje ${f.viaje.codigo}` : null, f.embarque ? `Embarque ${f.embarque.codigo}` : null, f.paquete ? `P ${f.paquete.codigo}` : null].filter((x): x is string => x !== null);
  return partes.length === 0 ? "—" : partes.join(" · ");
}
