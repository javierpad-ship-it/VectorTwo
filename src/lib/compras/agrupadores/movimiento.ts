import { repartirEntero } from "@/lib/proyeccion/reparto";
import { temporadaDe } from "@/lib/marcas-barrer/temporadas";
import { TEMPORADAS_DEFECTO } from "@/lib/marcas-barrer/tipos-api";
import { repartirLinea, type FilaRepartoGuardar, type NodoAlcance, type RepartoParaLinea } from "@/lib/compras/reparto";
import { etiquetaMesCorta, mesDe, tieneSaldoCerrado } from "@/lib/compras/reglas";
import { pendientesPorEntrega } from "@/lib/compras/pendientes";
import {
  MAX_ENTREGAS,
  MAX_RESUMEN_EVENTO,
  type CompraRegistro,
  type EntregaRegistro,
  type LineaRegistro,
  type Mes,
  type OrigenEntrega,
  type RecepcionRegistro,
  type RepartoRegistro,
} from "@/lib/compras/tipos";
import { embarqueAdmiteComoDestino, embarqueAdmiteOperacion } from "./estados";
import { diasEntre, etiquetaDiaMes, etiquetaMes, integridadDeHitos, ordenDeFechasRoto, rangoConfirmado, type AhoraLima } from "./fechas";
import type { AvisoDetalleApi, CambioFechaApi, MovimientoApi, PlanFechasApi, PlanMovimientoApi, UbicacionMovimientoApi } from "./tipos-api";
import {
  ORIGEN_ENTREGA_EMBARQUE,
  type AccionAgrupadorEvento,
  type AsignacionRegistro,
  type CausaFecha,
  type EmbarqueRegistro,
  type HitoConfirmable,
  type MotivoFuncionAgrupador,
  type OperacionMovimiento,
  type PaqueteRegistro,
  type ViajeRegistro,
} from "./tipos";

/**
 * Movimientos de entregas entre embarques, paquetes y meses (ficha 08b, §2.6, §2.9, §3.4, §3.5; R1 a R6, R12 y R20). PURO: sin
 * Supabase, sin reloj y sin importar `src/lib/flujo/`. Es el ESPEJO en TypeScript de `aplicar_movimiento_agrupador` (la función SQL
 * que escribe): sirve para la vista previa (`?previsualizar=1`), para la huella del plan (R19), para calcular los repartos de los lotes
 * (que la base no sabe hacer: necesitan los vectores de M12) y para probar las invariantes sin base. La API la llama y no la
 * reimplementa; la base repite las comprobaciones y es la última barrera.
 *
 * Modelo (§2.1 y §2.6): una ENTREGA `(línea, mes, unidades)` es de M8 y el flujo solo lee esas. Una ASIGNACIÓN reparte unidades de una
 * entrega entre embarques y paquetes; las unidades que ninguna asignación cubre están «sin embarque» en el mes de la entrega. Mover
 * mercadería de mes es mover unidades entre entregas de la misma línea (`origen = 'embarque'` si la entrega se crea).
 *
 * Todo movimiento se reduce a una lista de `MovimientoPlan` elementales (qué unidades salen de dónde y a dónde van) que
 * `aplicarMovimientos` ejecuta sobre una copia del estado verificando I1 (Σ asignaciones ≤ entrega) e I3 (Σ entregas = unidades de la
 * línea, ≤ `MAX_ENTREGAS`). I2 (alineación de lo que toca el plan) se verifica en `verificarAlineacion`.
 */

// ─── Meses y la columna `periodo_llegada` ───

/**
 * Mes `aaaa-mm` de `coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`: EXACTAMENTE la regla de la columna
 * generada `compra_embarques.periodo_llegada` desde la 0038 (08b-1b §2.4, decisión 115; antes de ella eran dos argumentos): el ingreso
 * real si ya llegó; si no, el ingreso al stock que fijó una persona; si no, el día del Ingreso CD (`fecha_llegada_estimada`).
 */
export function periodoLlegada(fechaReal: string | null | undefined, fechaIngreso: string | null | undefined, fechaIngresoCd: string): Mes {
  return mesDe(fechaReal ? fechaReal : fechaIngreso ? fechaIngreso : fechaIngresoCd);
}

/**
 * Mes de destino de una asignación (08b-1b §2.4 bis, decisión 115): `coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)`, es decir
 * el mes del ingreso propio de su paquete si lo tiene y, si no, el del embarque (que ya es el del ingreso al stock). UNA SOLA REGLA: todo
 * lector del mes de una asignación (los planes, `cerrarPlan`, los avisos, los importadores, la línea de tiempo) pasa por aquí; una prueba
 * estática impide comparar entregas contra `periodo_llegada` por otro camino. Como el ingreso propio nunca queda antes de la llegada (I9),
 * basta un `coalesce`. En SQL, la misma forma en línea: `coalesce(pq.periodo_ingreso, b.periodo_llegada)`.
 */
export function mesDeDestino(embarque: Pick<EmbarqueRegistro, "periodo_llegada">, paquete: Pick<PaqueteRegistro, "periodo_ingreso"> | null | undefined): Mes {
  return paquete?.periodo_ingreso ?? embarque.periodo_llegada;
}

/**
 * Piso del ingreso propio de un paquete (§2.5, I9): `coalesce(fecha_llegada_real, fecha_llegada_estimada)` de su embarque. El ingreso de un
 * paquete nunca queda antes (se compara por día; el mes tampoco).
 */
export const pisoDePaquete = (e: Pick<EmbarqueRegistro, "fecha_llegada_real" | "fecha_llegada_estimada">): string => e.fecha_llegada_real ?? e.fecha_llegada_estimada;

/** El mes que sigue a `aaaa-mm` (`2026-12` → `2027-01`). */
export function mesSiguiente(mes: Mes): Mes {
  const [anio, numero] = mes.split("-").map(Number);
  return numero === 12 ? `${anio + 1}-01` : `${anio}-${String(numero + 1).padStart(2, "0")}`;
}

// ─── Asignación histórica (R12) ───

export type ClasificacionAsignacion = {
  /** Compra recibida o cancelada, línea inactiva o línea con `recibidas + canceladas = unidades`: no se mueve ni es pendiente. */
  historica: boolean;
  /** Línea recibida al 100 % en una compra todavía `confirmada` (aviso `linea_recibida`). */
  linea_recibida: boolean;
};

/** R12 (§2.6). `activa = !historica`. */
export function clasificarAsignacion(
  compra: Pick<CompraRegistro, "estado">,
  linea: Pick<LineaRegistro, "activo" | "unidades" | "unidades_recibidas" | "unidades_canceladas">,
): ClasificacionAsignacion {
  const completa = linea.unidades_recibidas + linea.unidades_canceladas >= linea.unidades;
  const historica = compra.estado === "recibida" || compra.estado === "cancelada" || !linea.activo || completa;
  return { historica, linea_recibida: compra.estado === "confirmada" && linea.activo && completa };
}

// ─── Contexto ───

/** Una versión de reparto de un lote tal como la lee `leerRepartosPorId` (M12): el contrato de R6. */
export type RepartoDeLote = RepartoParaLinea;

/**
 * Todo lo que necesitan los planes, ya leído (lo arma `consultas.ts` de T3b; `tests/agrupadores.fixture.ts` da los casos). Debe traer
 * todas las asignaciones de los embarques implicados, y de cada una su entrega, línea y compra; las entregas, repartos y recepciones
 * de las líneas implicadas; los viajes de esos embarques y de sus compras.
 */
export type ContextoMovimiento = {
  /** Último mes publicado `k'`; `null` si no hay ninguno (no hay aviso `fecha_en_mes_cerrado`). */
  k_prima: Mes | null;
  viajes: readonly ViajeRegistro[];
  embarques: readonly EmbarqueRegistro[];
  paquetes: readonly PaqueteRegistro[];
  asignaciones: readonly AsignacionRegistro[];
  compras: readonly CompraRegistro[];
  lineas: readonly LineaRegistro[];
  entregas: readonly EntregaRegistro[];
  /** Reparto guardado de las entregas de los lotes (`compra_linea_repartos`). */
  repartos: readonly RepartoRegistro[];
  recepciones: readonly RecepcionRegistro[];
  /** `compras.viaje_id` por compra. */
  viaje_de_compra: Readonly<Record<string, string | null>>;
  /** Versiones de M12 por `reparto_id` (sin filtrar por vigente ni activo; `leerRepartosPorId`). */
  repartos_por_id: ReadonlyMap<string, RepartoDeLote>;
  nodos: ReadonlyMap<string, NodoAlcance>;
  /** Unidades de recepciones vinculadas por asignación (08b-2). Ausente = 0 en todas (08b-1). */
  recepciones_vinculadas?: ReadonlyMap<string, number>;
  /** Texto corto de cada línea («DENIM · ALFA») para vistas previas y avisos. */
  etiquetas_linea?: ReadonlyMap<string, string>;
};

// ─── Plan aplicable (contrato con `aplicar_movimiento_agrupador`) ───

/**
 * Un movimiento elemental. Saca `unidades` de la entrega `entrega_id` (de la asignación `asignacion_id`, o de lo que ninguna asignación
 * cubre si es `null`) y las lleva al mes `destino.periodo` de la MISMA línea: si el mes cambia, las unidades pasan de la entrega de
 * origen a la entrega de ese mes (se crea con `origen = 'embarque'` o se funde con la existente) y la de origen se borra si queda en 0
 * sin asignaciones. Si `destino.embarque_id` no es nulo, las unidades quedan asignadas a `(entrega de destino, embarque, paquete)`,
 * sumándose a la fila que ya exista con esa clave; si es nulo, quedan sin embarque. Cubre todo: asignar (`asignacion_id` nulo), quitar
 * (mismo mes y `embarque_id` nulo), mover a paquete (mismo mes y embarque), cambiar fecha, pasar pendientes y mover un paquete.
 */
export type MovimientoPlan = {
  asignacion_id: string | null;
  entrega_id: string;
  linea_id: string;
  compra_id: string;
  unidades: number;
  destino: { periodo: Mes; embarque_id: string | null; paquete_id: string | null };
};

export type FilaRepartoPlan = Omit<FilaRepartoGuardar, "entrega_periodo">;

/**
 * Lo que se manda a `aplicar_movimiento_agrupador(p_plan, p_actor)`. Los meses van como `aaaa-mm` (la función los lleva a `aaaa-mm-01`).
 * La función bloquea viajes → embarques → compras, compara `revision` de cada embarque y de cada compra de la lista (`compra_cambio`,
 * `agrupador_cambio`), comprueba pertenencia, ejecuta `movimientos`, escribe `repartos` de las entregas tocadas (origen y destino),
 * verifica I1 a I3 e I5 contra `entregas` (estado final esperado) y registra los eventos.
 */
export type PlanAplicable = {
  operacion: OperacionMovimiento;
  /** Acción del evento de agrupador que deja la operación. */
  accion: AccionAgrupadorEvento;
  motivo: string | null;
  /** Cabecera del evento (≤ 300). */
  resumen: string;
  /**
   * Causa de la reprogramación (08b-1b §2.6): la de `cambiar_fecha`, `mover_a_paquete` que cambia de mes y, si se da, `mover_paquete`.
   * AUSENTE (no `null`) en un plan «viejo» de `cambiar_fecha` con solo `fecha_llegada_estimada` (la función lo distingue por la clave).
   */
  causa?: CausaFecha | null;
  /** Embarques implicados, por id. En `cambiar_fecha` solo `embarques[0]` trae claves de fecha: presente = valor nuevo, `null` = vaciar, ausente = conserva. */
  embarques: PlanEmbarque[];
  /** Solo `mover_paquete`: se actualiza `compra_paquetes.embarque_id` (la clave compuesta arrastra sus asignaciones) antes de los movimientos. */
  paquete_a_mover: { paquete_id: string; embarque_destino_id: string } | null;
  /** Compras afectadas: dueñas de lo que mueve el plan y de toda asignación activa de los embarques implicados; con la revisión vista. */
  compras: { id: string; revision: number }[];
  movimientos: MovimientoPlan[];
  /**
   * Ingreso propio de paquetes (08b-1b §2.5): en `cambiar_fecha`, los que cambian (incluidos los subidos al piso, `ajustado`); en
   * `mover_paquete`, el movido si el piso del destino lo ajusta. `fecha_ingreso_estimada` nulo = hereda el del embarque. Ausente = nada.
   */
  paquetes?: PlanPaquete[];
  /** Estado final de las entregas tocadas; `unidades = 0` ⇒ se borra. La función lo contrasta con lo que dejó. */
  entregas: { linea_id: string; periodo: Mes; unidades: number }[];
  /** Reparto completo de cada entrega tocada de un lote que sigue existiendo (R6). */
  repartos: { linea_id: string; periodo: Mes; filas: FilaRepartoPlan[] }[];
};

/** Un embarque del plan. Las claves de fecha solo viajan en el único embarque de un `cambiar_fecha` (§2.10) y solo las que traen un valor. */
export type PlanEmbarque = {
  id: string;
  revision: number;
  fecha_salida_estimada?: string | null;
  fecha_puerto_estimada?: string | null;
  /** Ingreso CD. */
  fecha_llegada_estimada?: string;
  fecha_inicio_operativo_estimada?: string | null;
  hora_inicio_operativo?: string | null;
  /** Ingreso al stock fijado; `null` = igualar al Ingreso CD. */
  fecha_ingreso_estimada?: string | null;
  hito_confirmado?: HitoConfirmable | null;
};

/** Ingreso propio de un paquete dentro de un plan (`ajustado`: lo subió al piso el propio plan, §2.5). */
export type PlanPaquete = { id: string; embarque_id: string; fecha_ingreso_estimada: string | null; ajustado?: boolean };

export type ResultadoPlanMovimiento =
  | { ok: true; vista: PlanMovimientoApi; aplicable: PlanAplicable }
  | { ok: false; motivo: MotivoFuncionAgrupador; detalle?: string };

const rechazo = (motivo: MotivoFuncionAgrupador, detalle?: string): { ok: false; motivo: MotivoFuncionAgrupador; detalle?: string } =>
  detalle === undefined ? { ok: false, motivo } : { ok: false, motivo, detalle };

// ─── Índices ───

const mapa = <T extends { id: string }>(l: readonly T[]): Map<string, T> => new Map(l.map((x) => [x.id, x]));
const agrupar = <T>(l: readonly T[], clave: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of l) {
    const k = clave(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return m;
};

class Indice {
  readonly embarque: Map<string, EmbarqueRegistro>;
  readonly paquete: Map<string, PaqueteRegistro>;
  readonly viaje: Map<string, ViajeRegistro>;
  readonly compra: Map<string, CompraRegistro>;
  readonly linea: Map<string, LineaRegistro>;
  readonly entrega: Map<string, EntregaRegistro>;
  readonly asignacion: Map<string, AsignacionRegistro>;
  readonly asigDeEmbarque: Map<string, AsignacionRegistro[]>;
  readonly entregasDeLinea: Map<string, EntregaRegistro[]>;

  constructor(readonly ctx: ContextoMovimiento) {
    this.embarque = mapa(ctx.embarques);
    this.paquete = mapa(ctx.paquetes);
    this.viaje = mapa(ctx.viajes);
    this.compra = mapa(ctx.compras);
    this.linea = mapa(ctx.lineas);
    this.entrega = mapa(ctx.entregas);
    this.asignacion = mapa(ctx.asignaciones);
    this.asigDeEmbarque = agrupar(ctx.asignaciones, (a) => a.embarque_id);
    this.entregasDeLinea = agrupar(ctx.entregas, (e) => e.linea_id);
  }

  vinculadas(asignacionId: string): number {
    return this.ctx.recepciones_vinculadas?.get(asignacionId) ?? 0;
  }

  /** Entrega, línea y compra de una asignación; lanza si el contexto viene incompleto (es un error de quien lo arma, no del usuario). */
  deAsignacion(a: AsignacionRegistro) {
    const entrega = this.entrega.get(a.entrega_id);
    const linea = entrega ? this.linea.get(entrega.linea_id) : undefined;
    const compra = linea ? this.compra.get(linea.compra_id) : undefined;
    if (!entrega || !linea || !compra) throw new Error(`Contexto incompleto: falta la entrega, la línea o la compra de la asignación ${a.id}.`);
    return { entrega, linea, compra, ...clasificarAsignacion(compra, linea) };
  }

  etiquetaLinea(linea: LineaRegistro): string {
    return this.ctx.etiquetas_linea?.get(linea.id) ?? (linea.tipo === "especifica" ? "Línea" : "Lote");
  }

  codigoEmbarque(id: string | null): { id: string; codigo: string } | null {
    if (id === null) return null;
    const e = this.embarque.get(id);
    return e ? { id: e.id, codigo: e.codigo } : { id, codigo: id };
  }

  codigoPaquete(id: string | null): { id: string; codigo: string } | null {
    if (id === null) return null;
    const p = this.paquete.get(id);
    return p ? { id: p.id, codigo: p.codigo } : { id, codigo: id };
  }
}

// ─── Aplicar movimientos sobre una copia (I1, I3) ───

type EntregaTrabajo = {
  id: string | null;
  linea_id: string;
  periodo: Mes;
  unidades: number;
  origen: OrigenEntrega;
  /** Existía antes del plan. */
  existia: boolean;
  unidades_antes: number;
  tocada: boolean;
};
type FilaTrabajo = {
  id: string | null;
  /** Clave de su entrega: `linea|periodo`. */
  clave: string;
  embarque_id: string;
  paquete_id: string | null;
  unidades: number;
  unidades_antes: number;
  /** Clave de su entrega al empezar (para ubicar de dónde salió). */
  entrega_id_antes: string | null;
  tocada: boolean;
};

const claveEntrega = (lineaId: string, periodo: Mes) => `${lineaId}|${periodo}`;

export type EntregaFinal = {
  /** `null` en una entrega nueva (la crea la función con `origen = 'embarque'`). */
  id: string | null;
  linea_id: string;
  periodo: Mes;
  unidades: number;
  unidades_antes: number;
  origen: OrigenEntrega;
  nueva: boolean;
  /** Queda en 0 sin asignaciones: se borra. */
  borrada: boolean;
  /** Recibió unidades de otra en una entrega que ya tenía unidades (aviso `entregas_fusionadas`). */
  fusionada: boolean;
};

export type AsignacionFinal = {
  /** `null` en una fila nueva. Una fila que se mueve entera a una clave libre conserva su id. */
  id: string | null;
  entrega_id: string | null;
  linea_id: string;
  periodo: Mes;
  embarque_id: string;
  paquete_id: string | null;
  unidades: number;
  unidades_antes: number;
  nueva: boolean;
  borrada: boolean;
};

export type ResultadoAplicacion =
  | { ok: true; entregas: EntregaFinal[]; asignaciones: AsignacionFinal[] }
  | { ok: false; motivo: Extract<MotivoFuncionAgrupador, "excede_entrega" | "max_entregas" | "no_pertenece">; detalle: string };

/**
 * Ejecuta `movimientos` sobre una copia de las entregas y asignaciones de las líneas implicadas (§2.6, §3.4). Devuelve solo lo que
 * cambió. Verifica I1 (`excede_entrega`: no se asigna ni se saca más de lo que hay) e I3 (`max_entregas`: ≤ 24 entregas por línea;
 * la suma de las entregas de una línea no cambia). `paquetes_a_mover` arrastra primero las asignaciones del paquete a su embarque nuevo
 * (la clave foránea compuesta con `on update cascade`).
 */
export function aplicarMovimientos(
  base: { entregas: readonly EntregaRegistro[]; asignaciones: readonly AsignacionRegistro[] },
  movimientos: readonly MovimientoPlan[],
  paquetesAMover: readonly { paquete_id: string; embarque_destino_id: string }[] = [],
): ResultadoAplicacion {
  const lineasImplicadas = new Set(movimientos.map((m) => m.linea_id));
  const entregas = new Map<string, EntregaTrabajo>();
  const entregaPorId = new Map<string, EntregaTrabajo>();
  for (const e of base.entregas) {
    if (!lineasImplicadas.has(e.linea_id)) continue;
    const t: EntregaTrabajo = { id: e.id, linea_id: e.linea_id, periodo: mesDe(e.periodo), unidades: e.unidades, origen: e.origen, existia: true, unidades_antes: e.unidades, tocada: false };
    entregas.set(claveEntrega(e.linea_id, t.periodo), t);
    entregaPorId.set(e.id, t);
  }
  const pesoLineaAntes = new Map<string, number>();
  for (const t of entregas.values()) pesoLineaAntes.set(t.linea_id, (pesoLineaAntes.get(t.linea_id) ?? 0) + t.unidades);

  const entregaDeId = new Map(base.entregas.map((e) => [e.id, e]));
  const filas: FilaTrabajo[] = [];
  for (const a of base.asignaciones) {
    const e = entregaDeId.get(a.entrega_id);
    if (!e || !lineasImplicadas.has(e.linea_id)) continue;
    filas.push({
      id: a.id,
      clave: claveEntrega(e.linea_id, mesDe(e.periodo)),
      embarque_id: a.embarque_id,
      paquete_id: a.paquete_id,
      unidades: a.unidades,
      unidades_antes: a.unidades,
      entrega_id_antes: a.entrega_id,
      tocada: false,
    });
  }
  for (const m of paquetesAMover) {
    for (const f of filas) if (f.paquete_id === m.paquete_id) f.embarque_id = m.embarque_destino_id;
  }

  const filasDe = (clave: string) => filas.filter((f) => f.clave === clave && f.unidades > 0);
  const asignadas = (clave: string) => filasDe(clave).reduce((s, f) => s + f.unidades, 0);
  const buscarFila = (clave: string, embarqueId: string, paqueteId: string | null) =>
    filas.find((f) => f.clave === clave && f.embarque_id === embarqueId && f.paquete_id === paqueteId && f.unidades > 0);

  for (const m of movimientos) {
    const e = entregaPorId.get(m.entrega_id);
    if (!e) return { ok: false, motivo: "no_pertenece", detalle: `La entrega ${m.entrega_id} no es de la línea del movimiento.` };
    const claveOrigen = claveEntrega(e.linea_id, e.periodo);
    let r: FilaTrabajo | undefined;
    if (m.asignacion_id !== null) {
      r = filas.find((f) => f.id === m.asignacion_id && f.unidades > 0);
      if (!r || r.clave !== claveOrigen) return { ok: false, motivo: "no_pertenece", detalle: `La asignación ${m.asignacion_id} no es de esa entrega.` };
      if (r.unidades < m.unidades) return { ok: false, motivo: "excede_entrega", detalle: `Solo hay ${r.unidades} u en la asignación.` };
    } else if (e.unidades - asignadas(claveOrigen) < m.unidades) {
      return { ok: false, motivo: "excede_entrega", detalle: `Solo hay ${Math.max(0, e.unidades - asignadas(claveOrigen))} u sin asignar en esta entrega.` };
    }

    // Las unidades pasan de mes: salen de la entrega de origen y entran en la de destino.
    let d = e;
    if (m.destino.periodo !== e.periodo) {
      const claveDestino = claveEntrega(e.linea_id, m.destino.periodo);
      let existente = entregas.get(claveDestino);
      if (!existente) {
        existente = { id: null, linea_id: e.linea_id, periodo: m.destino.periodo, unidades: 0, origen: ORIGEN_ENTREGA_EMBARQUE, existia: false, unidades_antes: 0, tocada: true };
        entregas.set(claveDestino, existente);
      }
      e.unidades -= m.unidades;
      existente.unidades += m.unidades;
      e.tocada = true;
      existente.tocada = true;
      d = existente;
    }

    // Las asignaciones.
    const claveDestino = claveEntrega(d.linea_id, d.periodo);
    const objetivo = m.destino.embarque_id === null ? undefined : buscarFila(claveDestino, m.destino.embarque_id, m.destino.paquete_id);
    if (r) {
      r.tocada = true;
      if (objetivo === r) continue; // ya está donde iba
      if (m.destino.embarque_id === null) r.unidades -= m.unidades;
      else if (objetivo) {
        r.unidades -= m.unidades;
        objetivo.unidades += m.unidades;
        objetivo.tocada = true;
      } else if (r.unidades === m.unidades) {
        r.clave = claveDestino;
        r.embarque_id = m.destino.embarque_id;
        r.paquete_id = m.destino.paquete_id;
      } else {
        r.unidades -= m.unidades;
        filas.push({ id: null, clave: claveDestino, embarque_id: m.destino.embarque_id, paquete_id: m.destino.paquete_id, unidades: m.unidades, unidades_antes: 0, entrega_id_antes: null, tocada: true });
      }
    } else if (m.destino.embarque_id !== null) {
      if (objetivo) {
        objetivo.unidades += m.unidades;
        objetivo.tocada = true;
      } else {
        filas.push({ id: null, clave: claveDestino, embarque_id: m.destino.embarque_id, paquete_id: m.destino.paquete_id, unidades: m.unidades, unidades_antes: 0, entrega_id_antes: null, tocada: true });
      }
    }
  }

  // Invariantes. I1: nada asignado de más.
  for (const [clave, t] of entregas) {
    const asig = asignadas(clave);
    if (asig > t.unidades) return { ok: false, motivo: "excede_entrega", detalle: `Las asignaciones (${asig} u) superan la entrega (${t.unidades} u).` };
  }
  // I3: una línea conserva sus unidades y no pasa de MAX_ENTREGAS entregas.
  const pesoLineaDespues = new Map<string, number>();
  const cuenta = new Map<string, number>();
  for (const t of entregas.values()) {
    pesoLineaDespues.set(t.linea_id, (pesoLineaDespues.get(t.linea_id) ?? 0) + t.unidades);
    if (t.unidades > 0) cuenta.set(t.linea_id, (cuenta.get(t.linea_id) ?? 0) + 1);
  }
  for (const [lineaId, antes] of pesoLineaAntes) {
    if ((pesoLineaDespues.get(lineaId) ?? 0) !== antes) throw new Error(`I3 violada: la línea ${lineaId} cambió de unidades.`);
    if ((cuenta.get(lineaId) ?? 0) > MAX_ENTREGAS) return { ok: false, motivo: "max_entregas", detalle: `La línea llegaría a ${cuenta.get(lineaId)} entregas: el máximo es ${MAX_ENTREGAS}.` };
  }

  const entregasFinales: EntregaFinal[] = [...entregas.values()]
    .filter((t) => t.tocada)
    .map((t) => ({
      id: t.id,
      linea_id: t.linea_id,
      periodo: t.periodo,
      unidades: t.unidades,
      unidades_antes: t.unidades_antes,
      origen: t.origen,
      nueva: !t.existia,
      borrada: t.unidades === 0,
      fusionada: t.existia && t.unidades_antes > 0 && t.unidades > t.unidades_antes,
    }))
    .sort((a, b) => (a.linea_id < b.linea_id ? -1 : a.linea_id > b.linea_id ? 1 : a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));

  const claveAEntrega = new Map<string, EntregaTrabajo>(entregas);
  const asignacionesFinales: AsignacionFinal[] = filas
    .filter((f) => f.tocada || f.unidades !== f.unidades_antes)
    .map((f) => {
      const t = claveAEntrega.get(f.clave);
      if (!t) throw new Error(`Fila de asignación sin entrega: ${f.clave}`);
      return {
        id: f.id,
        entrega_id: t.id,
        linea_id: t.linea_id,
        periodo: t.periodo,
        embarque_id: f.embarque_id,
        paquete_id: f.paquete_id,
        unidades: f.unidades,
        unidades_antes: f.unidades_antes,
        nueva: f.id === null,
        borrada: f.unidades === 0,
      };
    });

  return { ok: true, entregas: entregasFinales, asignaciones: asignacionesFinales };
}

// ─── Pendientes por asignación (estimados con el FIFO de M8; 08b-1) ───

export type PendienteAsignacion = {
  asignacion_id: string;
  unidades: number;
  /** Unidades recibidas que le tocan (estimadas: el FIFO de M8 no sabe de embarques). */
  recibidas: number;
  /** 0 en una asignación histórica. */
  pendiente: number;
  historica: boolean;
  linea_recibida: boolean;
  /** Siempre `true` en 08b-1: las recepciones no están vinculadas a un embarque. */
  estimada: boolean;
};

/**
 * Pendiente de cada asignación en 08b-1 (§3.5): el FIFO de M8 (`pendientesPorEntrega`) dice cuántas unidades de cada entrega están
 * recibidas; dentro de la entrega, esas unidades cubren primero las asignaciones por `(mes de llegada del embarque, código del
 * embarque, código del paquete)` y lo que ninguna asignación cubre queda al final. Es una ESTIMACIÓN (se rotula «estimado»); en 08b-2
 * lo vinculado es exacto. Una asignación histórica no tiene pendiente.
 */
export function estimarPendientesAsignaciones(ctx: ContextoMovimiento): Map<string, PendienteAsignacion> {
  const ix = new Indice(ctx);
  const salida = new Map<string, PendienteAsignacion>();
  const porLinea = agrupar(ctx.entregas, (e) => e.linea_id);
  const asigPorEntrega = agrupar(ctx.asignaciones, (a) => a.entrega_id);

  for (const [lineaId, entregas] of porLinea) {
    const linea = ix.linea.get(lineaId);
    if (!linea) continue;
    const recepciones = ctx.recepciones.filter((r) => r.linea_id === lineaId);
    const res = pendientesPorEntrega({ unidades: linea.unidades, unidades_canceladas: linea.unidades_canceladas }, entregas.map((e) => ({ id: e.id, periodo: mesDe(e.periodo), unidades: e.unidades })), recepciones);
    for (const fe of res.entregas) {
      const filas = (asigPorEntrega.get(fe.id) ?? []).slice().sort((a, b) => {
        const ea = ix.embarque.get(a.embarque_id);
        const eb = ix.embarque.get(b.embarque_id);
        const ka = [ea?.periodo_llegada ?? "", ea?.codigo ?? "", ix.paquete.get(a.paquete_id ?? "")?.codigo ?? "", a.id];
        const kb = [eb?.periodo_llegada ?? "", eb?.codigo ?? "", ix.paquete.get(b.paquete_id ?? "")?.codigo ?? "", b.id];
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
        return 0;
      });
      let restante = fe.asignadas;
      for (const a of filas) {
        const compra = ix.compra.get(linea.compra_id);
        const clase = compra ? clasificarAsignacion(compra, linea) : { historica: false, linea_recibida: false };
        const consumido = Math.min(a.unidades, restante);
        restante -= consumido;
        salida.set(a.id, {
          asignacion_id: a.id,
          unidades: a.unidades,
          recibidas: consumido,
          pendiente: clase.historica ? 0 : a.unidades - consumido,
          historica: clase.historica,
          linea_recibida: clase.linea_recibida,
          estimada: true,
        });
      }
    }
  }
  return salida;
}

// ─── Planes ───

export type EntradaAsignar = {
  embarque_id: string;
  revision: number;
  paquete_id: string | null;
  items: { entrega_id: string; unidades: number; compra_revision: number }[];
};
export type EntradaQuitar = { embarque_id: string; revision: number; asignaciones: { id: string; compra_revision: number }[] };
/**
 * `asignaciones`: ids (la asignación entera) o `{ id, unidades }` (solo esas unidades; 08b-1b §2.5). Si algún movimiento cambia de mes
 * (el paquete destino tiene ingreso propio en otro mes), el plan exige `motivo` y `causa`.
 */
export type EntradaMoverAPaquete = {
  embarque_id: string;
  revision: number;
  paquete_id: string | null;
  asignaciones: (string | { id: string; unidades: number })[];
  motivo?: string;
  causa?: CausaFecha;
};
/** Plan «viejo» de `cambiar_fecha` (08b-1): solo la llegada al CD (= Ingreso CD) y el motivo; equivale a `/fecha`. */
export type EntradaCambiarFecha = { embarque_id: string; revision: number; fecha_llegada_estimada: string; motivo: string };
/** Un paquete cuyo ingreso al stock propio pide el cambio (`fecha_ingreso` nula = hereda el del embarque). */
export type CambioIngresoPaquete = { id: string; fecha_ingreso: string | null };
/**
 * `cambiar_fecha` completo (08b-1b §2.10). Clave AUSENTE (o `undefined`) = no cambia; clave presente = valor nuevo, `null` incluido
 * (vaciar; en `fecha_ingreso_stock`, «igualar al Ingreso CD»; en `inicio_operativo`, vaciar fecha y hora). `ahora` es la fecha y hora de
 * Lima para I7. `paquetes` son los ingresos propios que pide el cambio (el diálogo de fechas no los manda; `planIngresoPaquete` sí).
 */
export type EntradaCambiarFechas = {
  embarque_id: string;
  revision: number;
  fecha_zarpe?: string | null;
  fecha_arribo?: string | null;
  fecha_ingreso_cd?: string;
  inicio_operativo?: { fecha: string; hora: string | null } | null;
  fecha_ingreso_stock?: string | null;
  hito_confirmado?: HitoConfirmable | null;
  paquetes?: CambioIngresoPaquete[];
  motivo?: string;
  causa?: CausaFecha;
  ahora: AhoraLima;
};
export type EntradaIngresoPaquete = { paquete_id: string; revision_embarque: number; fecha_ingreso_stock: string | null; motivo?: string; causa?: CausaFecha; ahora?: AhoraLima };
export type EntradaMoverPaquete = { paquete_id: string; revision: number; embarque_destino_id: string; revision_destino: number; motivo: string; causa?: CausaFecha };
export type EntradaPasarPendientes = {
  embarque_id: string;
  revision: number;
  embarque_destino_id: string;
  revision_destino: number;
  paquete_destino_id: string | null;
  asignaciones?: string[];
  motivo: string;
};

export type SolicitudMovimiento =
  | ({ operacion: "asignar" } & EntradaAsignar)
  | ({ operacion: "quitar" } & EntradaQuitar)
  | ({ operacion: "mover_a_paquete" } & EntradaMoverAPaquete)
  | ({ operacion: "cambiar_fecha" } & EntradaCambiarFecha)
  | ({ operacion: "mover_paquete" } & EntradaMoverPaquete)
  | ({ operacion: "pasar_pendientes" } & EntradaPasarPendientes);

/** Despacha una solicitud a su plan. El resto de exportaciones (`planAsignar`, …) son lo mismo por operación. */
export function planificarMovimiento(solicitud: SolicitudMovimiento, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  switch (solicitud.operacion) {
    case "asignar":
      return planAsignar(solicitud, ctx);
    case "quitar":
      return planQuitar(solicitud, ctx);
    case "mover_a_paquete":
      return planMoverAPaquete(solicitud, ctx);
    case "cambiar_fecha":
      return planCambiarFecha(solicitud, ctx);
    case "mover_paquete":
      return planMoverPaquete(solicitud, ctx);
    case "pasar_pendientes":
      return planPasarPendientes(solicitud, ctx);
  }
}

type Rechazo = { ok: false; motivo: MotivoFuncionAgrupador; detalle?: string };

/** Embarque que existe, con la revisión vigente. */
function embarqueVigente(ix: Indice, id: string, revision: number): EmbarqueRegistro | Rechazo {
  const e = ix.embarque.get(id);
  if (!e) return rechazo("no_encontrado", "El embarque no existe.");
  if (e.revision !== revision) return rechazo("agrupador_cambio", `El embarque ${e.codigo} cambió (revisión ${e.revision}, se esperaba ${revision}).`);
  return e;
}

/** Paquete que existe, es del embarque, está abierto. `null` (sin paquete) siempre vale. */
function paqueteDelEmbarque(ix: Indice, paqueteId: string | null, embarque: EmbarqueRegistro): PaqueteRegistro | null | Rechazo {
  if (paqueteId === null) return null;
  const p = ix.paquete.get(paqueteId);
  if (!p) return rechazo("no_pertenece", "El paquete no existe.");
  if (p.embarque_id !== embarque.id) return rechazo("paquete_de_otro_embarque", `El paquete ${p.codigo} es de otro embarque.`);
  if (p.estado !== "abierto") return rechazo("no_editable", `El paquete ${p.codigo} está cancelado.`);
  return p;
}

const esRechazo = (x: unknown): x is Rechazo => typeof x === "object" && x !== null && "ok" in x && (x as { ok: unknown }).ok === false;

const sinTexto = (t: string | null | undefined) => (t ?? "").trim() === "";

/** `asignar`: unidades de entregas a un embarque (y paquete). Las que están en otro mes pasan a su mes de destino (§3.4; `mesDeDestino`). */
export function planAsignar(entrada: EntradaAsignar, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  const ix = new Indice(ctx);
  const e = embarqueVigente(ix, entrada.embarque_id, entrada.revision);
  if (esRechazo(e)) return e;
  if (!embarqueAdmiteOperacion(e.estado, "asignar")) return rechazo("embarque_no_editable");
  const p = paqueteDelEmbarque(ix, entrada.paquete_id, e);
  if (esRechazo(p)) return p;
  // 08b-1b §2.4 bis: con paquete destino, el mes es el de su ingreso propio (si lo tiene); si no, el del embarque.
  const mesDestino = mesDeDestino(e, p);

  const movimientos: MovimientoPlan[] = [];
  for (const item of entrada.items) {
    const entrega = ix.entrega.get(item.entrega_id);
    const linea = entrega ? ix.linea.get(entrega.linea_id) : undefined;
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (!entrega || !linea || !compra) return rechazo("no_pertenece", "La entrega no existe.");
    if (compra.revision !== item.compra_revision) return rechazo("compra_cambio", `La compra ${compra.numero} cambió (revisión ${compra.revision}, se esperaba ${item.compra_revision}).`);
    if (tieneSaldoCerrado(compra)) return rechazo("saldo_cerrado", `La compra ${compra.numero} tiene el saldo cerrado.`);
    const clase = clasificarAsignacion(compra, linea);
    if ((compra.estado !== "borrador" && compra.estado !== "confirmada") || clase.historica) return rechazo("compra_no_asignable", `La compra ${compra.numero} ya está recibida o cancelada.`);
    movimientos.push({
      asignacion_id: null,
      entrega_id: entrega.id,
      linea_id: linea.id,
      compra_id: compra.id,
      unidades: item.unidades,
      destino: { periodo: mesDestino, embarque_id: e.id, paquete_id: entrada.paquete_id },
    });
  }
  return cerrarPlan(ix, { operacion: "asignar", accion: "asignar", motivo: null, embarques: [e], destinoPeriodo: mesDestino, movimientos, paqueteCodigo: p?.codigo ?? null });
}

/** `quitar`: las unidades quedan sin embarque en el mismo mes; permitido en cualquier estado del embarque (B1). */
export function planQuitar(entrada: EntradaQuitar, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  const ix = new Indice(ctx);
  const e = embarqueVigente(ix, entrada.embarque_id, entrada.revision);
  if (esRechazo(e)) return e;

  const vistos = new Set<string>();
  const movimientos: MovimientoPlan[] = [];
  for (const item of entrada.asignaciones) {
    if (vistos.has(item.id)) continue;
    vistos.add(item.id);
    const a = ix.asignacion.get(item.id);
    if (!a || a.embarque_id !== e.id) return rechazo("no_pertenece", "Esa asignación no es de este embarque.");
    const { entrega, linea, compra, historica } = ix.deAsignacion(a);
    if (compra.revision !== item.compra_revision) return rechazo("compra_cambio", `La compra ${compra.numero} cambió (revisión ${compra.revision}, se esperaba ${item.compra_revision}).`);
    if (historica) return rechazo("compra_no_asignable", `La mercadería de ${compra.numero} es histórica: no se mueve.`);
    if (ix.vinculadas(a.id) > 0) return rechazo("asignacion_con_recepciones");
    movimientos.push({ asignacion_id: a.id, entrega_id: entrega.id, linea_id: linea.id, compra_id: compra.id, unidades: a.unidades, destino: { periodo: mesDe(entrega.periodo), embarque_id: null, paquete_id: null } });
  }
  return cerrarPlan(ix, { operacion: "quitar", accion: "quitar", motivo: null, embarques: [e], destinoPeriodo: null, movimientos, paqueteCodigo: null });
}

/**
 * `mover_a_paquete` (08b-1b §2.5): dentro del mismo embarque, por asignaciones enteras o por unidades. Si el paquete destino tiene ingreso
 * propio en otro mes (o se saca un lote de un paquete con ingreso propio), el movimiento CAMBIA DE MES: las unidades pasan a la entrega de
 * ese mes (y los lotes se reparten de nuevo con la temporada del mes nuevo), y el plan exige motivo y causa; sin recepciones vinculadas.
 * Un movimiento que no cambia de mes se permite con recepciones vinculadas. `paquete_id` nulo = sacarlas del paquete.
 */
export function planMoverAPaquete(entrada: EntradaMoverAPaquete, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  const ix = new Indice(ctx);
  const e = embarqueVigente(ix, entrada.embarque_id, entrada.revision);
  if (esRechazo(e)) return e;
  if (!embarqueAdmiteOperacion(e.estado, "mover_a_paquete")) return rechazo("embarque_no_editable");
  const p = paqueteDelEmbarque(ix, entrada.paquete_id, e);
  if (esRechazo(p)) return p;
  const mesDestino = mesDeDestino(e, p);

  const vistos = new Set<string>();
  const movimientos: MovimientoPlan[] = [];
  let cambiaMes = false;
  for (const item of entrada.asignaciones) {
    const id = typeof item === "string" ? item : item.id;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const a = ix.asignacion.get(id);
    if (!a || a.embarque_id !== e.id) return rechazo("no_pertenece", "Esa asignación no es de este embarque.");
    const { entrega, linea, compra, historica } = ix.deAsignacion(a);
    if (historica) return rechazo("compra_no_asignable", `La mercadería de ${compra.numero} es histórica: no se mueve.`);
    const unidades = typeof item === "string" ? a.unidades : item.unidades;
    if (unidades > a.unidades) return rechazo("excede_entrega", `La asignación de ${compra.numero} solo tiene ${a.unidades} u.`);
    if (unidades <= 0 || a.paquete_id === entrada.paquete_id) continue;
    const mesEntrega = mesDe(entrega.periodo);
    if (mesEntrega !== mesDestino) {
      if (ix.vinculadas(a.id) > 0) return rechazo("asignacion_con_recepciones");
      cambiaMes = true;
    }
    movimientos.push({ asignacion_id: a.id, entrega_id: entrega.id, linea_id: linea.id, compra_id: compra.id, unidades, destino: { periodo: mesDestino, embarque_id: e.id, paquete_id: entrada.paquete_id } });
  }
  if (cambiaMes) {
    if (sinTexto(entrada.motivo)) return rechazo("motivo_requerido");
    if (entrada.causa === undefined) return rechazo("causa_requerida");
  }
  return cerrarPlan(ix, {
    operacion: "mover_a_paquete",
    accion: "mover_a_paquete",
    motivo: sinTexto(entrada.motivo) ? null : (entrada.motivo as string).trim(),
    ...(entrada.causa === undefined || !cambiaMes ? {} : { causa: entrada.causa }),
    embarques: [e],
    destinoPeriodo: null,
    movimientos,
    paqueteCodigo: p?.codigo ?? null,
  });
}

// ─── cambiar_fecha (08b-1b §2.10) ───

export type ResultadoPlanFechas = { ok: true; vista: PlanFechasApi; aplicable: PlanAplicable } | { ok: false; motivo: MotivoFuncionAgrupador; detalle?: string };

const horaCorta = (h: string | null): string | null => (h === null ? null : h.slice(0, 5));

/**
 * `cambiar_fecha` ampliado (08b-1b §2.10; decisiones 115, 116 y 119): cualquier hito del embarque (Zarpe, Arribo, Ingreso CD, Inicio
 * operativo con hora, Ingreso al stock), `hito_confirmado` y el ingreso propio de paquetes. Espejo en TypeScript de los pasos de
 * `aplicar_movimiento_agrupador`:
 *  1. Embarque y paquetes vigentes. 2. `sin_cambios`. 3. Motivo y causa SOLO si reprograma (cambiar o vaciar un Zarpe, Arribo o Inicio
 *  operativo —fecha u hora— que tenía valor; cambiar el Ingreso CD; cambiar la fecha efectiva del ingreso al stock; cambiar el ingreso de un
 *  paquete; bajar `hito_confirmado`). Completar una fecha vacía, confirmar un hito, que el ingreso sin fijar siga al Ingreso CD o que un
 *  paquete suba a su piso NO reprograma. 4. Estados: Ingreso CD, ingreso al stock y paquetes solo en `planificado` o `en_transito`; los
 *  otros hitos también en `recibido`; en `cancelado`, nada. 5. Bloqueos: Zarpe ≤ Ingreso CD, Arribo en un `local`, I7 con los valores
 *  finales (`fecha_requerida`, `fecha_futura`). 6. El mes de CADA asignación se recalcula con `mesDeDestino` sobre los valores finales
 *  (las de paquetes con ingreso propio no se mueven si su mes no cambia); con recepciones vinculadas: `embarque_con_recepciones` (fechas del
 *  embarque) o `asignacion_con_recepciones` (paquete). 7. El ingreso propio de un paquete nunca queda antes del piso (§2.5): se sube al
 *  piso y se avisa `ingreso_paquete_ajustado`. Si ningún mes cambia, no se toca ninguna compra (I6) y no hace falta `huella_plan`.
 */
export function planCambiarFechas(entrada: EntradaCambiarFechas, ctx: ContextoMovimiento): ResultadoPlanFechas {
  return construirCambioFechas(entrada, ctx, false);
}

/**
 * `cambiar_fecha` «viejo» de 08b-1 (`POST …/fecha`): solo la llegada al CD (= Ingreso CD) y el motivo. Es `planCambiarFechas` con solo
 * `fecha_ingreso_cd` y sin hito, con `causa = 'otro'` fija (F23: el evento queda como el de `/fechas` con esa causa; el motivo sigue siendo
 * obligatorio y no se pide causa a quien llama). Se conserva por una versión (alias de `/fecha`; 08b-1b §3.2).
 */
export function planCambiarFecha(entrada: EntradaCambiarFecha, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  return construirCambioFechas({ embarque_id: entrada.embarque_id, revision: entrada.revision, fecha_ingreso_cd: entrada.fecha_llegada_estimada, motivo: entrada.motivo }, ctx, true);
}

/**
 * Ingreso al stock propio de un paquete (`POST /api/compras/paquetes/[id]/ingreso`; 08b-1b §2.5): fijarlo, cambiarlo o dejarlo heredar
 * (`fecha_ingreso_stock = null`). Es un `cambiar_fecha` que solo trae el paquete. Mueve las entregas de sus asignaciones si cambia de mes
 * (y reparte de nuevo los lotes si cambia la temporada); si queda antes de la llegada del embarque, lo sube al piso y avisa.
 */
export function planIngresoPaquete(entrada: EntradaIngresoPaquete, ctx: ContextoMovimiento): ResultadoPlanFechas {
  const p = ctx.paquetes.find((x) => x.id === entrada.paquete_id);
  if (!p) return rechazo("no_encontrado", "El paquete no existe.");
  if (p.estado !== "abierto") return rechazo("no_editable", `El paquete ${p.codigo} está cancelado.`);
  return construirCambioFechas(
    {
      embarque_id: p.embarque_id,
      revision: entrada.revision_embarque,
      paquetes: [{ id: p.id, fecha_ingreso: entrada.fecha_ingreso_stock }],
      ...(entrada.motivo === undefined ? {} : { motivo: entrada.motivo }),
      ...(entrada.causa === undefined ? {} : { causa: entrada.causa }),
    },
    ctx,
    false,
    entrada.ahora ?? null,
  );
}

function construirCambioFechas(
  entrada: Omit<EntradaCambiarFechas, "ahora"> & { ahora?: AhoraLima },
  ctx: ContextoMovimiento,
  legado: boolean,
  ahoraExterno: AhoraLima | null = null,
): ResultadoPlanFechas {
  const ix = new Indice(ctx);
  const e = embarqueVigente(ix, entrada.embarque_id, entrada.revision);
  if (esRechazo(e)) return e;
  const ahora = entrada.ahora ?? ahoraExterno;

  // 1. Paquetes pedidos: siguen en su embarque y están abiertos.
  const pedidos = new Map<string, string | null>();
  for (const c of entrada.paquetes ?? []) {
    const pq = ix.paquete.get(c.id);
    if (!pq) return rechazo("no_encontrado", "El paquete no existe.");
    if (pq.embarque_id !== e.id) return rechazo("agrupador_cambio", `El paquete ${pq.codigo} ya no es del embarque ${e.codigo}.`);
    if (pq.estado !== "abierto") return rechazo("no_editable", `El paquete ${pq.codigo} está cancelado.`);
    pedidos.set(c.id, c.fecha_ingreso);
  }

  // Valores finales del embarque: clave ausente conserva; presente es el valor nuevo (`null` incluido).
  const salida = entrada.fecha_zarpe === undefined ? e.fecha_salida_estimada : entrada.fecha_zarpe;
  const arribo = entrada.fecha_arribo === undefined ? e.fecha_puerto_estimada : entrada.fecha_arribo;
  const llegada = entrada.fecha_ingreso_cd === undefined ? e.fecha_llegada_estimada : entrada.fecha_ingreso_cd;
  let ini = e.fecha_inicio_operativo_estimada;
  let hora = horaCorta(e.hora_inicio_operativo);
  if (entrada.inicio_operativo !== undefined) {
    ini = entrada.inicio_operativo === null ? null : entrada.inicio_operativo.fecha;
    hora = entrada.inicio_operativo === null ? null : horaCorta(entrada.inicio_operativo.hora);
  }
  const ingreso = entrada.fecha_ingreso_stock === undefined ? e.fecha_ingreso_estimada : entrada.fecha_ingreso_stock;
  const hito = entrada.hito_confirmado === undefined ? e.hito_confirmado : entrada.hito_confirmado;

  // Ingreso propio de los paquetes abiertos del embarque, con el piso (§2.5).
  const piso = e.fecha_llegada_real ?? llegada;
  const ajustes: PlanPaquete[] = [];
  const avisos: AvisoDetalleApi[] = [];
  const aviso = (a: AvisoDetalleApi["aviso"], detalle?: string) => {
    if (!avisos.some((x) => x.aviso === a && x.detalle === detalle)) avisos.push(detalle === undefined ? { aviso: a } : { aviso: a, detalle });
  };
  const paquetesFinales = new Map<string, PaqueteRegistro>();
  const cambiosPaquete: CambioFechaApi[] = [];
  for (const pq of ctx.paquetes.filter((x) => x.embarque_id === e.id && x.estado === "abierto")) {
    const pedido = pedidos.has(pq.id) ? (pedidos.get(pq.id) as string | null) : pq.fecha_ingreso_estimada;
    let final = pedido;
    let ajustado = false;
    if (final !== null && final < piso) {
      aviso("ingreso_paquete_ajustado", `${pq.nombre} estaba para el ${etiquetaDiaMes(final)}, pero el embarque llega al CD el ${etiquetaDiaMes(piso)}: queda el ${etiquetaDiaMes(piso)}. Reprográmalo si quieres otra fecha.`);
      final = piso;
      ajustado = true;
    }
    paquetesFinales.set(pq.id, { ...pq, fecha_ingreso_estimada: final, periodo_ingreso: final === null ? null : mesDe(final) });
    if (final !== pq.fecha_ingreso_estimada) {
      ajustes.push({ id: pq.id, embarque_id: e.id, fecha_ingreso_estimada: final, ajustado });
      cambiosPaquete.push({ hito: "ingreso_paquete", paquete: { id: pq.id, codigo: pq.codigo }, antes: pq.fecha_ingreso_estimada, despues: final, dias: pq.fecha_ingreso_estimada !== null && final !== null ? diasEntre(pq.fecha_ingreso_estimada, final) : null });
    }
  }

  // 2. ¿Cambia algo?
  const cambiaCd = llegada !== e.fecha_llegada_estimada;
  const cambiaIngreso = ingreso !== e.fecha_ingreso_estimada;
  const cambiaPaquete = ajustes.length > 0;
  const hayCambio =
    cambiaPaquete || salida !== e.fecha_salida_estimada || arribo !== e.fecha_puerto_estimada || cambiaCd || ini !== e.fecha_inicio_operativo_estimada || hora !== horaCorta(e.hora_inicio_operativo) || cambiaIngreso || hito !== e.hito_confirmado;
  if (!hayCambio) return rechazo("sin_cambios");

  // 3. Reprogramar exige motivo y causa; completar, confirmar o seguir al Ingreso CD, no.
  const ingresoEfectivoAntes = e.fecha_ingreso_estimada ?? e.fecha_llegada_estimada;
  const reprograma =
    (e.fecha_salida_estimada !== null && salida !== e.fecha_salida_estimada) ||
    (e.fecha_puerto_estimada !== null && arribo !== e.fecha_puerto_estimada) ||
    (e.fecha_inicio_operativo_estimada !== null && ini !== e.fecha_inicio_operativo_estimada) ||
    (e.hora_inicio_operativo !== null && hora !== horaCorta(e.hora_inicio_operativo)) ||
    cambiaCd ||
    (cambiaIngreso && (ingreso ?? llegada) !== ingresoEfectivoAntes) ||
    rangoConfirmado(hito) < rangoConfirmado(e.hito_confirmado) ||
    ajustes.some((a) => a.ajustado !== true) ||
    (ajustes.some((a) => a.ajustado === true) && !cambiaCd);
  if (reprograma) {
    if (sinTexto(entrada.motivo)) return rechazo("motivo_requerido");
    if (entrada.causa === undefined && !legado) return rechazo("causa_requerida");
  }

  // 4. Estados.
  if (e.estado === "cancelado" || ((cambiaCd || cambiaIngreso || cambiaPaquete) && !embarqueAdmiteOperacion(e.estado, "cambiar_fecha"))) return rechazo("embarque_no_editable");

  // 5. Bloqueos con los valores finales.
  if (salida !== null && salida > llegada) return rechazo("salida_despues_de_llegada");
  if (e.tipo === "local" && (arribo !== null || hito === "arribo")) return rechazo("puerto_en_local");
  if (ahora !== null) {
    const roto = integridadDeHitos({ fecha_salida_estimada: salida, fecha_puerto_estimada: arribo, fecha_llegada_estimada: llegada, fecha_inicio_operativo_estimada: ini, hora_inicio_operativo: hora, hito_confirmado: hito }, ahora);
    if (roto !== null) return rechazo(roto);
  }
  if (hito !== null && e.estado === "planificado") aviso("pasa_a_en_transito", "Marcar que ya ocurrió un hito pasa el embarque a En tránsito.");
  for (const texto of ordenDeFechasRoto({ zarpe: salida, arribo, ingreso_cd: llegada, inicio_operativo: ini, ingreso_stock: ingreso })) aviso("orden_de_fechas", texto);

  // 6. El mes de CADA asignación con los valores finales.
  const eFinal: EmbarqueRegistro = {
    ...e,
    fecha_salida_estimada: salida,
    fecha_puerto_estimada: arribo,
    fecha_llegada_estimada: llegada,
    fecha_inicio_operativo_estimada: ini,
    hora_inicio_operativo: hora,
    fecha_ingreso_estimada: ingreso,
    hito_confirmado: hito,
    periodo_llegada: periodoLlegada(e.fecha_llegada_real, ingreso, llegada),
  };
  const paquetesCambiados = new Set(ajustes.map((a) => a.id));
  const movimientos: MovimientoPlan[] = [];
  let historicas = 0;
  for (const a of ix.asigDeEmbarque.get(e.id) ?? []) {
    const mesAntes = mesDeDestino(e, a.paquete_id ? ix.paquete.get(a.paquete_id) : null);
    const mesDespues = mesDeDestino(eFinal, a.paquete_id ? paquetesFinales.get(a.paquete_id) ?? ix.paquete.get(a.paquete_id) : null);
    if (mesAntes === mesDespues) continue;
    const { entrega, linea, compra, historica } = ix.deAsignacion(a);
    if (historica) {
      historicas += 1;
      continue;
    }
    if (ix.vinculadas(a.id) > 0) return rechazo(a.paquete_id !== null && paquetesCambiados.has(a.paquete_id) ? "asignacion_con_recepciones" : "embarque_con_recepciones");
    if (mesDe(entrega.periodo) === mesDespues) continue;
    movimientos.push({ asignacion_id: a.id, entrega_id: entrega.id, linea_id: linea.id, compra_id: compra.id, unidades: a.unidades, destino: { periodo: mesDespues, embarque_id: e.id, paquete_id: a.paquete_id } });
  }

  // Qué cambia, para la vista previa y el evento.
  const cambios: CambioFechaApi[] = [];
  const cambio = (h: CambioFechaApi["hito"], antes: string | null, despues: string | null) => {
    if (antes !== despues) cambios.push({ hito: h, antes, despues, dias: antes !== null && despues !== null && h !== "hito_confirmado" ? diasEntre(antes, despues) : null });
  };
  cambio("zarpe", e.fecha_salida_estimada, salida);
  cambio("arribo", e.fecha_puerto_estimada, arribo);
  cambio("ingreso_cd", e.fecha_llegada_estimada, llegada);
  cambio("inicio_operativo", e.fecha_inicio_operativo_estimada === null ? null : `${e.fecha_inicio_operativo_estimada}${e.hora_inicio_operativo ? ` ${horaCorta(e.hora_inicio_operativo)}` : ""}`, ini === null ? null : `${ini}${hora ? ` ${hora}` : ""}`);
  cambio("ingreso_stock", ingresoEfectivoAntes, ingreso ?? llegada);
  cambio("hito_confirmado", e.hito_confirmado, hito);
  cambios.push(...cambiosPaquete);

  const planEmbarque: Partial<PlanEmbarque> = {};
  if (salida !== e.fecha_salida_estimada) planEmbarque.fecha_salida_estimada = salida;
  if (arribo !== e.fecha_puerto_estimada) planEmbarque.fecha_puerto_estimada = arribo;
  if (cambiaCd) planEmbarque.fecha_llegada_estimada = llegada;
  if (ini !== e.fecha_inicio_operativo_estimada) planEmbarque.fecha_inicio_operativo_estimada = ini;
  if (hora !== horaCorta(e.hora_inicio_operativo) && ini !== null) planEmbarque.hora_inicio_operativo = hora;
  if (cambiaIngreso) planEmbarque.fecha_ingreso_estimada = ingreso;
  if (hito !== e.hito_confirmado) planEmbarque.hito_confirmado = hito;

  const mesesAgregados = new Map<string, { de: Mes; a: Mes; unidades: number }>();
  for (const m of movimientos) {
    const de = mesDe((ix.entrega.get(m.entrega_id) as EntregaRegistro).periodo);
    if (de === m.destino.periodo) continue;
    const k = `${de}|${m.destino.periodo}`;
    const previo = mesesAgregados.get(k);
    if (previo) previo.unidades += m.unidades;
    else mesesAgregados.set(k, { de, a: m.destino.periodo, unidades: m.unidades });
  }

  const resumenCambios = cambios.map((c) => (c.hito === "ingreso_paquete" ? `ingreso de ${c.paquete?.codigo ?? "un paquete"} ${c.antes ?? "—"} → ${c.despues ?? "hereda"}` : `${NOMBRE_HITO[c.hito]} ${c.antes ?? "—"} → ${c.despues ?? "—"}`)).join("; ");
  const r = cerrarPlan(ix, {
    operacion: "cambiar_fecha",
    accion: "cambiar_fecha",
    motivo: sinTexto(entrada.motivo) ? null : (entrada.motivo as string).trim(),
    // El alias `/fecha` (legado) equivale a `/fechas` con `causa = 'otro'` (F23).
    ...(legado ? { causa: "otro" as const } : entrada.causa === undefined ? {} : { causa: entrada.causa }),
    embarques: [e],
    destinoPeriodo: cambiaCd || cambiaIngreso ? eFinal.periodo_llegada : null,
    movimientos,
    paqueteCodigo: null,
    historicas,
    embarquesFinales: new Map([[e.id, eFinal]]),
    paquetesFinales,
    planEmbarque,
    ...(legado || ajustes.length === 0 ? {} : { planPaquetes: ajustes }),
    avisosExtra: avisos,
    resumenCambios,
  });
  if (!r.ok) return r;
  return { ok: true, aplicable: r.aplicable, vista: { ...r.vista, huella_plan: r.vista.huella_plan, cambios, meses: [...mesesAgregados.values()].sort((x, y) => (x.de + x.a < y.de + y.a ? -1 : 1)), reprograma } };
}

const NOMBRE_HITO: Record<CambioFechaApi["hito"], string> = {
  orden_compra: "Orden de compra",
  zarpe: "Zarpe",
  arribo: "Arribo",
  ingreso_cd: "Ingreso CD",
  inicio_operativo: "Inicio operativo",
  ingreso_stock: "Ingreso al stock",
  ingreso_paquete: "Ingreso del paquete",
  hito_confirmado: "Hito confirmado",
};

/**
 * El plan mueve entregas de mes. La `huella_plan` de la vista previa la exige el servidor SOLO si es cierto (08b-1b §2.10, MEDIO 7): si
 * ningún mes cambia (Zarpe, Arribo, Inicio operativo, confirmar un hito) se aplica sin vista previa. Con `entregas` compara el mes de cada
 * movimiento con el de su entrega (lo que necesita `mover_a_paquete`, cuyos movimientos incluyen los que no cambian de mes).
 */
export function cambiaAlgunMes(plan: Pick<PlanAplicable, "movimientos">, entregas?: readonly Pick<EntregaRegistro, "id" | "periodo">[]): boolean {
  if (entregas === undefined) return plan.movimientos.length > 0;
  // `mover_a_paquete` también lista los movimientos que solo cambian de paquete dentro del mismo mes: esos no cuentan.
  const periodoDe = new Map(entregas.map((e) => [e.id, e.periodo]));
  return plan.movimientos.some((m) => periodoDe.get(m.entrega_id) !== m.destino.periodo);
}

/**
 * `mover_paquete` (§3.5): el paquete pasa a otro embarque; solo sin recepciones vinculadas (R7). Conserva su ingreso propio (08b-1b §2.5);
 * si queda antes de la llegada del destino, el plan lo sube al piso y avisa `ingreso_paquete_ajustado`. Sus asignaciones activas se llevan
 * al mes de destino (`mesDeDestino(destino, paquete con su ingreso)`: el del propio paquete si lo tiene; si no, el del destino); las
 * históricas viajan con el paquete sin mover su entrega.
 */
export function planMoverPaquete(entrada: EntradaMoverPaquete, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  const ix = new Indice(ctx);
  const p = ix.paquete.get(entrada.paquete_id);
  if (!p) return rechazo("no_encontrado", "El paquete no existe.");
  const origen = embarqueVigente(ix, p.embarque_id, entrada.revision);
  if (esRechazo(origen)) return origen;
  const destino = embarqueVigente(ix, entrada.embarque_destino_id, entrada.revision_destino);
  if (esRechazo(destino)) return destino;
  if (origen.id === destino.id) return rechazo("no_pertenece", "El paquete ya está en ese embarque.");
  if (!embarqueAdmiteOperacion(origen.estado, "mover_paquete") || !embarqueAdmiteComoDestino(destino.estado)) return rechazo("embarque_no_editable");
  if (p.estado !== "abierto") return rechazo("no_editable", `El paquete ${p.codigo} está cancelado.`);
  if (sinTexto(entrada.motivo)) return rechazo("motivo_requerido");

  // Ingreso propio conservado y ajustado al piso del destino.
  const pisoDestino = pisoDePaquete(destino);
  let ingreso = p.fecha_ingreso_estimada;
  const avisos: AvisoDetalleApi[] = [];
  let ajustado = false;
  if (ingreso !== null && ingreso < pisoDestino) {
    avisos.push({ aviso: "ingreso_paquete_ajustado", detalle: `${p.nombre} estaba para el ${etiquetaDiaMes(ingreso)}, pero el embarque ${destino.codigo} llega al CD el ${etiquetaDiaMes(pisoDestino)}: queda el ${etiquetaDiaMes(pisoDestino)}. Reprográmalo si quieres otra fecha.` });
    ingreso = pisoDestino;
    ajustado = true;
  }
  const pFinal: PaqueteRegistro = { ...p, embarque_id: destino.id, fecha_ingreso_estimada: ingreso, periodo_ingreso: ingreso === null ? null : mesDe(ingreso) };
  const mesDestino = mesDeDestino(destino, pFinal);

  const movimientos: MovimientoPlan[] = [];
  let historicas = 0;
  for (const a of ix.asigDeEmbarque.get(origen.id) ?? []) {
    if (a.paquete_id !== p.id) continue;
    const { entrega, linea, compra, historica } = ix.deAsignacion(a);
    if (ix.vinculadas(a.id) > 0) return rechazo("asignacion_con_recepciones");
    if (historica) {
      historicas += 1;
      continue;
    }
    movimientos.push({ asignacion_id: a.id, entrega_id: entrega.id, linea_id: linea.id, compra_id: compra.id, unidades: a.unidades, destino: { periodo: mesDestino, embarque_id: destino.id, paquete_id: p.id } });
  }
  return cerrarPlan(ix, {
    operacion: "mover_paquete",
    accion: "mover_paquete",
    motivo: entrada.motivo.trim(),
    ...(entrada.causa === undefined ? {} : { causa: entrada.causa }),
    embarques: [origen, destino],
    destinoPeriodo: mesDestino,
    movimientos,
    paqueteCodigo: p.codigo,
    paqueteAMover: { paquete_id: p.id, embarque_destino_id: destino.id },
    historicas,
    paquetesFinales: new Map([[p.id, pFinal]]),
    ...(ajustado ? { planPaquetes: [{ id: p.id, embarque_id: destino.id, fecha_ingreso_estimada: ingreso, ajustado: true }] } : {}),
    avisosExtra: avisos,
  });
}

/**
 * `pasar_pendientes` (§3.5): lo pendiente de cada asignación activa (estimado con el FIFO de M8) sale a una asignación del destino, y su
 * entrega pasa al mes de destino (`mesDeDestino(destino, paquete destino)`: con un paquete de ingreso propio, el mes de la tanda; si no,
 * el del destino). El origen conserva lo recibido. Sin `asignaciones`, todas las del embarque.
 */
export function planPasarPendientes(entrada: EntradaPasarPendientes, ctx: ContextoMovimiento): ResultadoPlanMovimiento {
  const ix = new Indice(ctx);
  const origen = embarqueVigente(ix, entrada.embarque_id, entrada.revision);
  if (esRechazo(origen)) return origen;
  const destino = embarqueVigente(ix, entrada.embarque_destino_id, entrada.revision_destino);
  if (esRechazo(destino)) return destino;
  if (origen.id === destino.id) return rechazo("no_pertenece", "El destino es el mismo embarque.");
  if (!embarqueAdmiteOperacion(origen.estado, "pasar_pendientes") || !embarqueAdmiteComoDestino(destino.estado)) return rechazo("embarque_no_editable");
  const pd = paqueteDelEmbarque(ix, entrada.paquete_destino_id, destino);
  if (esRechazo(pd)) return pd;
  if (sinTexto(entrada.motivo)) return rechazo("motivo_requerido");
  const mesDestino = mesDeDestino(destino, pd);

  const propias = ix.asigDeEmbarque.get(origen.id) ?? [];
  let elegidas = propias;
  if (entrada.asignaciones !== undefined) {
    const ids = new Set(entrada.asignaciones);
    for (const id of ids) if (!propias.some((a) => a.id === id)) return rechazo("no_pertenece", "Esa asignación no es de este embarque.");
    elegidas = propias.filter((a) => ids.has(a.id));
  }

  const pendientes = estimarPendientesAsignaciones(ctx);
  const movimientos: MovimientoPlan[] = [];
  for (const a of elegidas) {
    const pend = pendientes.get(a.id)?.pendiente ?? 0;
    if (pend <= 0) continue;
    const { entrega, linea, compra } = ix.deAsignacion(a);
    movimientos.push({ asignacion_id: a.id, entrega_id: entrega.id, linea_id: linea.id, compra_id: compra.id, unidades: pend, destino: { periodo: mesDestino, embarque_id: destino.id, paquete_id: entrada.paquete_destino_id } });
  }
  if (movimientos.length === 0) return rechazo("sin_pendientes");
  return cerrarPlan(ix, {
    operacion: "pasar_pendientes",
    accion: "pasar_pendientes",
    motivo: entrada.motivo.trim(),
    embarques: [origen, destino],
    destinoPeriodo: mesDestino,
    movimientos,
    paqueteCodigo: pd?.codigo ?? null,
  });
}

// ─── Cierre de un plan: aplicar, repartir, avisar, resumir ───

type ParametrosCierre = {
  operacion: OperacionMovimiento;
  accion: AccionAgrupadorEvento;
  motivo: string | null;
  causa?: CausaFecha;
  /** El primero es el embarque de la ruta; en `mover_paquete` y `pasar_pendientes`, el segundo es el destino. */
  embarques: EmbarqueRegistro[];
  /** Mes al que quedan las asignaciones que toca el plan (para `fecha_en_mes_cerrado` y el resumen; nulo en quitar y mover a paquete). */
  destinoPeriodo: Mes | null;
  movimientos: MovimientoPlan[];
  paqueteCodigo: string | null;
  paqueteAMover?: { paquete_id: string; embarque_destino_id: string };
  historicas?: number;
  /** Estado FINAL de los embarques y paquetes que el plan cambia, para comprobar I2 con `mesDeDestino` (por defecto, lo del contexto). */
  embarquesFinales?: ReadonlyMap<string, EmbarqueRegistro>;
  paquetesFinales?: ReadonlyMap<string, PaqueteRegistro>;
  /** Claves de fecha de `embarques[0]` en un `cambiar_fecha` (solo las que cambian). */
  planEmbarque?: Partial<PlanEmbarque>;
  /** `plan.paquetes`: ingreso propio que cambia (o que sube al piso). */
  planPaquetes?: PlanPaquete[];
  avisosExtra?: AvisoDetalleApi[];
  /** «Ingreso CD 2026-11-15 → 2026-12-03; …» para el resumen del evento de un `cambiar_fecha`. */
  resumenCambios?: string;
};

function cerrarPlan(ix: Indice, p: ParametrosCierre): ResultadoPlanMovimiento {
  const ctx = ix.ctx;
  const aplicacion = aplicarMovimientos(ctx, p.movimientos, p.paqueteAMover ? [p.paqueteAMover] : []);
  if (!aplicacion.ok) return rechazo(aplicacion.motivo, aplicacion.detalle);

  // R6: los lotes tocados (origen y destino) se reparten de nuevo, completos.
  const repartos: PlanAplicable["repartos"] = [];
  for (const ef of aplicacion.entregas) {
    if (ef.unidades <= 0) continue;
    const linea = ix.linea.get(ef.linea_id);
    if (!linea || linea.tipo === "especifica") continue;
    const r = repartirLoteEntrega(ix, linea, ef.periodo, ef.unidades);
    if (!r.ok) return rechazo("reparto_sin_vector", r.detalle);
    repartos.push({ linea_id: linea.id, periodo: ef.periodo, filas: r.filas });
  }

  // I2 generalizada (08b-1b §2.4 bis): TODA asignación activa de los embarques del plan queda en su mes de destino, en toda operación.
  const mal = asignacionesDesalineadasTras(ix, p, aplicacion.asignaciones);
  if (mal.length > 0) throw new Error(`I2 violada: ${mal.length} asignación(es) de los embarques del plan no quedan en su mes de destino (${mal.map((m) => `${m.periodo}≠${m.esperado}`).join(", ")}).`);

  const vista = armarVista(ix, p, aplicacion);
  const compras = comprasAfectadas(ix, p);
  const eventoEmbarques: PlanEmbarque[] = p.embarques
    .map((e, i) => ({ id: e.id, revision: e.revision, ...(i === 0 && p.planEmbarque !== undefined ? p.planEmbarque : {}) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const aplicable: PlanAplicable = {
    operacion: p.operacion,
    accion: p.accion,
    motivo: p.motivo,
    ...(p.causa === undefined ? {} : { causa: p.causa }),
    resumen: recortarTexto(resumenDeEvento(ix, p, vista), MAX_RESUMEN_EVENTO),
    embarques: eventoEmbarques,
    paquete_a_mover: p.paqueteAMover ?? null,
    compras,
    ...(p.planPaquetes === undefined || p.planPaquetes.length === 0 ? {} : { paquetes: p.planPaquetes }),
    movimientos: p.movimientos,
    entregas: aplicacion.entregas.map((e) => ({ linea_id: e.linea_id, periodo: e.periodo, unidades: e.unidades })),
    repartos,
  };
  return { ok: true, vista: { ...vista, huella_plan: huellaPlan(vista) }, aplicable };
}

/**
 * Asignaciones activas de los embarques del plan que quedarían fuera de su mes de destino. Mira las que el plan toca y las que no (las de
 * un paquete con ingreso propio no se mueven con el embarque, pero un cambio del embarque o del paquete puede desalinearlas). Una
 * asignación que NO toca el plan y ya estaba desalineada ANTES del plan no se cuenta: no la causó este plan (la base, en cambio, la
 * rechaza con `AG002`; el humo exige que no exista).
 */
function asignacionesDesalineadasTras(ix: Indice, p: ParametrosCierre, tocadas: readonly AsignacionFinal[]): AsignacionDesalineada[] {
  const ctx = ix.ctx;
  const embarquesDelPlan = new Set(p.embarques.map((e) => e.id));
  const embarqueFinal = (id: string) => p.embarquesFinales?.get(id) ?? ix.embarque.get(id);
  const paqueteFinal = (id: string | null) => (id === null ? null : (p.paquetesFinales?.get(id) ?? ix.paquete.get(id) ?? null));
  const mesDeFinal = (a: { embarque_id: string; paquete_id?: string | null }): Mes | undefined => {
    const e = embarqueFinal(a.embarque_id);
    return e ? mesDeDestino(e, paqueteFinal(a.paquete_id ?? null)) : undefined;
  };

  const ids = new Set<string>();
  const lista: (Pick<AsignacionFinal, "embarque_id" | "periodo" | "unidades"> & { paquete_id: string | null })[] = [];
  for (const a of tocadas) {
    if (a.id !== null) ids.add(a.id);
    if (!a.borrada && a.unidades > 0 && embarquesDelPlan.has(a.embarque_id)) lista.push({ embarque_id: a.embarque_id, paquete_id: a.paquete_id, periodo: a.periodo, unidades: a.unidades });
  }
  const malTocadas = verificarAlineacion(lista, mesDeFinal);

  const malSinTocar: AsignacionDesalineada[] = [];
  for (const a of ctx.asignaciones) {
    if (ids.has(a.id)) continue;
    const embarqueId = p.paqueteAMover && a.paquete_id === p.paqueteAMover.paquete_id ? p.paqueteAMover.embarque_destino_id : a.embarque_id;
    if (!embarquesDelPlan.has(embarqueId)) continue;
    const entrega = ix.entrega.get(a.entrega_id);
    const linea = entrega ? ix.linea.get(entrega.linea_id) : undefined;
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (!entrega || !linea || !compra || clasificarAsignacion(compra, linea).historica) continue;
    const periodo = mesDe(entrega.periodo);
    const antes = ix.embarque.get(a.embarque_id);
    if (antes && periodo !== mesDeDestino(antes, a.paquete_id ? ix.paquete.get(a.paquete_id) : null)) continue; // ya estaba desalineada
    malSinTocar.push(...verificarAlineacion([{ embarque_id: embarqueId, paquete_id: a.paquete_id, periodo, unidades: a.unidades }], mesDeFinal));
  }
  return [...malTocadas, ...malSinTocar];
}

const recortarTexto = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1)}…`);

/** Compras de lo que mueve el plan y de toda asignación activa de los embarques implicados, con la revisión vista (§2.9). */
function comprasAfectadas(ix: Indice, p: ParametrosCierre): { id: string; revision: number }[] {
  // Sin movimientos (cambiar la fecha dentro del mismo mes) no se toca ninguna compra: no hay nada que bloquear ni comparar (R5).
  if (p.movimientos.length === 0) return [];
  const ids = new Set(p.movimientos.map((m) => m.compra_id));
  for (const e of p.embarques) {
    for (const a of ix.asigDeEmbarque.get(e.id) ?? []) {
      const { compra, historica } = ix.deAsignacion(a);
      if (!historica) ids.add(compra.id);
    }
  }
  return [...ids]
    .sort()
    .map((id) => ({ id, revision: ix.compra.get(id)?.revision ?? 0 }));
}

/** R6 · reparte de nuevo UNA entrega de un lote con la MISMA versión de M12 y el vector de la temporada de su mes. */
function repartirLoteEntrega(ix: Indice, linea: LineaRegistro, periodo: Mes, unidades: number): { ok: true; filas: FilaRepartoPlan[] } | { ok: false; detalle: string } {
  const propios = ix.ctx.repartos.filter((r) => r.linea_id === linea.id);
  if (linea.tipo === "barrer_mezcla") {
    // Las mezclas de M9a se reparten con sus porcentajes: la proporción que ya tiene el lote por (marca, GML, equivalencia).
    const pesos = new Map<string, { marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; peso: number }>();
    for (const r of propios) {
      const k = `${r.marca_id}|${r.genero_mundo_linea_id}|${r.equivalencia_id ?? ""}`;
      const previo = pesos.get(k);
      if (previo) previo.peso += r.unidades;
      else pesos.set(k, { marca_id: r.marca_id, genero_mundo_linea_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, peso: r.unidades });
    }
    const lista = [...pesos.values()];
    const enteros = repartirEntero(unidades, lista.map((x) => x.peso));
    if (!enteros) return { ok: false, detalle: "El lote de varias marcas no tiene reparto guardado." };
    return {
      ok: true,
      filas: lista
        .map((x, i) => ({ x, u: enteros[i] }))
        .filter(({ u }) => u > 0)
        .map(({ x, u }) => ({ marca_id: x.marca_id, genero_mundo_linea_id: x.genero_mundo_linea_id, equivalencia_id: x.equivalencia_id, unidades: u, reparto_id: null, reparto_version: null, temporada: null, error_reparto_pp: null })),
    };
  }
  // `barrer_marca`: la misma versión con que se repartió (la de más unidades si hubiera varias; nunca se cambia de versión).
  const porVersion = new Map<string, number>();
  for (const r of propios) if (r.reparto_id) porVersion.set(r.reparto_id, (porVersion.get(r.reparto_id) ?? 0) + r.unidades);
  const versiones = [...porVersion.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (versiones.length === 0 || linea.marca_id === null) return { ok: false, detalle: "El lote no tiene un reparto guardado: no se puede repartir de nuevo." };
  const reparto = ix.ctx.repartos_por_id.get(versiones[0][0]);
  if (!reparto) return { ok: false, detalle: "No se encontró la versión del reparto con que se repartió el lote." };
  const res = repartirLinea({ marca_id: linea.marca_id, alcance: linea.alcance }, [{ periodo, unidades }], reparto, ix.ctx.nodos);
  if (!res.ok) return { ok: false, detalle: res.detalle ?? "El reparto de la marca no tiene vector para ese mes." };
  const filas: FilaRepartoPlan[] = (res.por_entrega[0]?.filas ?? []).map((f) => ({
    marca_id: f.marca_id,
    genero_mundo_linea_id: f.genero_mundo_linea_id,
    equivalencia_id: f.equivalencia_id,
    unidades: f.unidades,
    reparto_id: f.reparto_id,
    reparto_version: f.reparto_version,
    temporada: f.temporada,
    error_reparto_pp: f.error_reparto_pp,
  }));
  return { ok: true, filas };
}

// ─── Vista previa, avisos y resumen ───

const ubicacion = (ix: Indice, periodo: Mes, embarqueId: string | null, paqueteId: string | null): UbicacionMovimientoApi => ({
  periodo,
  embarque: ix.codigoEmbarque(embarqueId),
  paquete: ix.codigoPaquete(paqueteId),
});

function armarVista(ix: Indice, p: ParametrosCierre, ap: Extract<ResultadoAplicacion, { ok: true }>): Omit<PlanMovimientoApi, "huella_plan"> {
  const ctx = ix.ctx;
  // Movimientos: uno por (compra, línea, de, a), sumando unidades.
  const acumulado = new Map<string, MovimientoApi>();
  for (const m of p.movimientos) {
    const entrega = ix.entrega.get(m.entrega_id);
    const linea = ix.linea.get(m.linea_id);
    const compra = ix.compra.get(m.compra_id);
    if (!entrega || !linea || !compra) throw new Error("Contexto incompleto en un movimiento.");
    const fila = m.asignacion_id === null ? undefined : ix.asignacion.get(m.asignacion_id);
    const de = ubicacion(ix, mesDe(entrega.periodo), fila?.embarque_id ?? null, fila?.paquete_id ?? null);
    const a = ubicacion(ix, m.destino.periodo, m.destino.embarque_id, m.destino.paquete_id);
    const mov: MovimientoApi = { compra_numero: compra.numero, linea: ix.etiquetaLinea(linea), de, a, unidades: m.unidades };
    const k = JSON.stringify([mov.compra_numero, mov.linea, de, a]);
    const previo = acumulado.get(k);
    if (previo) previo.unidades += m.unidades;
    else acumulado.set(k, mov);
  }
  const movimientos = [...acumulado.values()].sort((x, y) => (JSON.stringify([x.compra_numero, x.linea, x.de, x.a]) < JSON.stringify([y.compra_numero, y.linea, y.de, y.a]) ? -1 : 1));

  const avisos: AvisoDetalleApi[] = [];
  const nuevo = (aviso: AvisoDetalleApi["aviso"], detalle?: string) => {
    if (!avisos.some((a) => a.aviso === aviso && a.detalle === detalle)) avisos.push(detalle === undefined ? { aviso } : { aviso, detalle });
  };

  // viaje_cerrado: igual se registra (decisión 95).
  for (const e of p.embarques) {
    const v = e.viaje_id ? ix.viaje.get(e.viaje_id) : undefined;
    if (v?.estado === "cerrado") nuevo("viaje_cerrado", `El viaje ${v.codigo} está cerrado: igual se registra.`);
  }
  // viaje_distinto, llegada_antes_de_compra
  const compras = new Set<string>();
  for (const m of p.movimientos) {
    if (m.destino.embarque_id === null || compras.has(m.compra_id)) continue;
    compras.add(m.compra_id);
    const compra = ix.compra.get(m.compra_id);
    const e = ix.embarque.get(m.destino.embarque_id);
    if (!compra || !e) continue;
    const viajeCompra = ctx.viaje_de_compra[compra.id] ?? null;
    if (viajeCompra !== null && e.viaje_id !== null && viajeCompra !== e.viaje_id) {
      const a = ix.viaje.get(viajeCompra);
      const b = ix.viaje.get(e.viaje_id);
      nuevo("viaje_distinto", `${compra.numero} es del viaje ${a?.codigo ?? "?"} y el embarque ${e.codigo} es del viaje ${b?.codigo ?? "?"}.`);
    }
    if (m.destino.periodo < mesDe(compra.fecha_compra)) {
      nuevo("llegada_antes_de_compra", `El ingreso al stock (mes del flujo: ${etiquetaMes(m.destino.periodo)}) es anterior al mes de la orden de compra de ${compra.numero} (${etiquetaMes(mesDe(compra.fecha_compra))}): el ingreso se rechazará.`);
    }
  }
  // 08b-1b: los avisos propios del plan (`ingreso_paquete_ajustado`, `orden_de_fechas`, `pasa_a_en_transito`).
  for (const a of p.avisosExtra ?? []) nuevo(a.aviso, a.detalle);
  // fecha_en_mes_cerrado
  const destinos = new Set<Mes>(p.movimientos.filter((m) => m.destino.embarque_id !== null).map((m) => m.destino.periodo));
  if (p.destinoPeriodo !== null && p.operacion === "cambiar_fecha") destinos.add(p.destinoPeriodo);
  if (ctx.k_prima !== null) {
    const cerrados = [...destinos].filter((d) => d <= (ctx.k_prima as Mes)).sort();
    if (cerrados.length > 0) nuevo("fecha_en_mes_cerrado", `${cerrados.map(etiquetaMesCorta).join(", ")} ya está cerrado: el flujo espera lo pendiente en ${etiquetaMesCorta(mesSiguiente(ctx.k_prima))}.`);
  }
  // cambia_temporada: un lote que pasa de un mes de una temporada a un mes de la otra
  for (const m of p.movimientos) {
    const entrega = ix.entrega.get(m.entrega_id);
    const linea = ix.linea.get(m.linea_id);
    if (!entrega || !linea || linea.tipo === "especifica" || mesDe(entrega.periodo) === m.destino.periodo) continue;
    const temporadas = temporadasDeLinea(ix, linea);
    const antes = temporadaDe(Number(mesDe(entrega.periodo).slice(5, 7)), temporadas);
    const despues = temporadaDe(Number(m.destino.periodo.slice(5, 7)), temporadas);
    if (antes !== despues) nuevo("cambia_temporada", `${ix.etiquetaLinea(linea)}: ${antes} → ${despues}`);
  }
  // entregas_fusionadas
  for (const ef of ap.entregas) {
    if (!ef.fusionada) continue;
    const linea = ix.linea.get(ef.linea_id);
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    nuevo("entregas_fusionadas", `En ${etiquetaMesCorta(ef.periodo)}, ${compra?.numero ?? "la compra"} queda con una sola entrega de ${ef.unidades} u.`);
  }
  if ((p.historicas ?? 0) > 0) nuevo("asignaciones_historicas", `${p.historicas} asignación(es) histórica(s) no se mueven.`);

  const lineas = new Set(p.movimientos.map((m) => m.linea_id));
  const comprasN = new Set(p.movimientos.map((m) => m.compra_id));
  return {
    operacion: p.operacion,
    compras_afectadas: comprasN.size,
    lineas: lineas.size,
    unidades_movidas: p.movimientos.reduce((s, m) => s + m.unidades, 0),
    movimientos,
    avisos,
  };
}

function temporadasDeLinea(ix: Indice, linea: LineaRegistro) {
  const id = ix.ctx.repartos.find((r) => r.linea_id === linea.id && r.reparto_id)?.reparto_id;
  return (id ? ix.ctx.repartos_por_id.get(id)?.temporadas_usadas : undefined) ?? TEMPORADAS_DEFECTO;
}

function resumenDeEvento(ix: Indice, p: ParametrosCierre, vista: Omit<PlanMovimientoApi, "huella_plan">): string {
  const e = p.embarques[0];
  const d = p.embarques[1];
  const u = vista.unidades_movidas;
  const cuantas = `${vista.lineas} línea${vista.lineas === 1 ? "" : "s"} de ${vista.compras_afectadas} compra${vista.compras_afectadas === 1 ? "" : "s"}`;
  switch (p.operacion) {
    case "asignar":
      return `Asignó ${u} u (${cuantas}) al embarque ${e.codigo}${p.paqueteCodigo ? `, paquete ${p.paqueteCodigo}` : ""}.`;
    case "quitar":
      return `Quitó ${u} u (${cuantas}) del embarque ${e.codigo}.`;
    case "mover_a_paquete":
      return `Movió ${u} u (${cuantas}) ${p.paqueteCodigo ? `al paquete ${p.paqueteCodigo}` : "fuera de paquete"} en el embarque ${e.codigo}.`;
    case "cambiar_fecha": {
      const mueve = p.movimientos.length === 0 ? "no mueve ninguna entrega" : `mueve ${cuantas} de ${etiquetaMesCorta(vista.movimientos[0]?.de.periodo ?? e.periodo_llegada)} a ${etiquetaMesCorta(vista.movimientos[0]?.a.periodo ?? p.destinoPeriodo ?? e.periodo_llegada)}`;
      return `Cambió las fechas del embarque ${e.codigo}${p.resumenCambios ? ` (${p.resumenCambios})` : ""}: ${mueve}.`;
    }
    case "mover_paquete":
      return `Movió el paquete ${p.paqueteCodigo ?? ""} del embarque ${e.codigo} al embarque ${d?.codigo ?? "?"}: ${u} u (${cuantas}).`;
    case "pasar_pendientes":
      return `Pasó ${u} u pendientes (${cuantas}) del embarque ${e.codigo} al embarque ${d?.codigo ?? "?"}.`;
    default:
      return `${p.operacion} en el embarque ${e.codigo}.`;
  }
}

/**
 * Texto de una línea para el cuadro de vista previa: «Mueve 12 líneas de 5 compras de nov-26 a dic-26 · 2 lotes cambian de temporada
 * (BETA: verano → invierno)». `unidades_movidas = 0` ⇒ «No mueve ninguna entrega».
 */
export function resumenDePlan(vista: Pick<PlanMovimientoApi, "movimientos" | "lineas" | "compras_afectadas" | "unidades_movidas" | "avisos">): string {
  if (vista.movimientos.length === 0) return "No mueve ninguna entrega.";
  const meses = [...new Set(vista.movimientos.flatMap((m) => (m.de.periodo === m.a.periodo ? [] : [`${m.de.periodo}→${m.a.periodo}`])))];
  const cuantas = `${vista.lineas} línea${vista.lineas === 1 ? "" : "s"} de ${vista.compras_afectadas} compra${vista.compras_afectadas === 1 ? "" : "s"}`;
  const trozos = [meses.length === 1 ? `Mueve ${cuantas} de ${etiquetaMesCorta(meses[0].split("→")[0])} a ${etiquetaMesCorta(meses[0].split("→")[1])}` : `Mueve ${cuantas}`];
  const temporada = vista.avisos.filter((a) => a.aviso === "cambia_temporada");
  if (temporada.length > 0) trozos.push(`${temporada.length} lote${temporada.length === 1 ? " cambia" : "s cambian"} de temporada (${temporada.map((a) => a.detalle).join("; ")})`);
  return trozos.join(" · ");
}

// ─── Invariante I2 (R2) sobre un resultado aplicado ───

/**
 * I2 (R2; generalizada en 08b-1b §2.4 bis): cada asignación del resultado está en una entrega del MES DE DESTINO que le corresponde. Admite
 * el mapa de mes por embarque de 08b-1 (`ReadonlyMap`) o, desde 08b-1b, una función por asignación (`mesDe`: `mesDeDestino(embarque, paquete
 * de la asignación)`). Devuelve las que no (vacío = cumple). Una asignación sin mes esperado (`undefined`) no se verifica. La función SQL
 * lo exige de TODAS las asignaciones activas de los embarques del plan; `cerrarPlan` le pasa todas.
 */
export function verificarAlineacion(
  asignaciones: readonly (Pick<AsignacionFinal, "embarque_id" | "periodo" | "unidades"> & { paquete_id?: string | null })[],
  mesDe: ReadonlyMap<string, Mes> | ((a: { embarque_id: string; paquete_id?: string | null }) => Mes | undefined),
): AsignacionDesalineada[] {
  const mal: AsignacionDesalineada[] = [];
  for (const a of asignaciones) {
    const esperado = typeof mesDe === "function" ? mesDe(a) : mesDe.get(a.embarque_id);
    if (esperado !== undefined && a.unidades > 0 && a.periodo !== esperado) mal.push({ embarque_id: a.embarque_id, periodo: a.periodo, esperado });
  }
  return mal;
}
export type AsignacionDesalineada = { embarque_id: string; periodo: Mes; esperado: Mes };

/**
 * Una asignación activa está `desalineada` si su entrega no está en su mes de destino (aviso con «Realinear»): el segundo argumento es
 * `mesDeDestino(embarque, paquete de la asignación)` (08b-1b §2.4 bis), no el mes del embarque a secas.
 */
export const estaDesalineada = (periodoEntrega: Mes, mesDestino: Mes): boolean => mesDe(periodoEntrega) !== mesDestino;

// ─── Huella del plan (R19) ───

/**
 * R19: cuando una función devuelve `compra_cambio`, la API recalcula el plan y solo reintenta UNA vez si la huella nueva es idéntica
 * a la que el cliente envió. Sin `huella_plan` (no vio la vista previa) no hay reintento; si no es idéntica, `409 plan_cambio`.
 */
export const puedeReintentar = (huellaEnviada: string | undefined | null, huellaNueva: string): boolean => typeof huellaEnviada === "string" && huellaEnviada === huellaNueva;


/**
 * SHA-256 (64 hex) del resumen del plan: operación, compras, líneas, de → a y unidades. NO incluye revisiones ni avisos: la API la
 * compara después de una `compra_cambio` y solo reintenta una vez si es idéntica. Orden y texto deterministas.
 */
export function huellaPlan(vista: Pick<PlanMovimientoApi, "operacion" | "compras_afectadas" | "lineas" | "unidades_movidas" | "movimientos">): string {
  const movimientos = [...vista.movimientos]
    .map((m) => [m.compra_numero, m.linea, [m.de.periodo, m.de.embarque?.codigo ?? null, m.de.paquete?.codigo ?? null], [m.a.periodo, m.a.embarque?.codigo ?? null, m.a.paquete?.codigo ?? null], m.unidades])
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
  return sha256Hex(JSON.stringify([vista.operacion, vista.compras_afectadas, vista.lineas, vista.unidades_movidas, movimientos]));
}

// SHA-256 en JS puro y síncrono: la huella se calcula igual en servidor y navegador sin `node:crypto` (este archivo lo importa la
// pantalla). Constantes derivadas de raíces de primos, como define el estándar (FIPS 180-4).
const PRIMOS = (() => {
  const l: number[] = [];
  for (let n = 2; l.length < 64; n++) if (l.every((p) => n % p !== 0)) l.push(n);
  return l;
})();
const fracBits = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K256 = PRIMOS.map((p) => fracBits(Math.cbrt(p)));
const H0 = PRIMOS.slice(0, 8).map((p) => fracBits(Math.sqrt(p)));

export function sha256Hex(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  const largo = bytes.length;
  const total = (((largo + 9 + 63) >> 6) << 6) >>> 0;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[largo] = 0x80;
  const vista = new DataView(m.buffer);
  vista.setUint32(total - 8, Math.floor((largo * 8) / 2 ** 32), false);
  vista.setUint32(total - 4, (largo * 8) >>> 0, false);
  const h = H0.slice();
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = vista.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}
