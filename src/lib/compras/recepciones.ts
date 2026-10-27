import { evento, type EventoNuevo } from "./eventos";
import {
  etiquetaMesCorta,
  fotoCompra,
  mesDe,
  primerDiaDelMes,
  recalcularModelo,
  ultimoDiaDelMes,
  type ModeloCompra,
  type RecepcionModelo,
} from "./reglas";
import type { ActorCompra, EstadoCompra, Mes, MotivoFuncionCompra, RecepcionNueva } from "./tipos";
import type { AvisoRecepcion } from "./tipos-api";

/**
 * «Confirmar ingreso» (recepciones) de las compras de M8 (ficha 08, §0.5, regla 13). Puro: valida antes de llamar a las funciones
 * SQL `registrar_recepciones` y `quitar_recepcion`, arma sus argumentos y calcula qué avisos lleva una recepción y cuánto entra
 * al flujo. La escritura es de la base (una transacción por llamada, `revision` y pertenencia bajo `for update`): estas funciones
 * dan el mismo veredicto, en el mismo orden, para decidir el `404`/`409` sin tomar el candado.
 */

/** Motivos de rechazo de una recepción: los de la función SQL (los de T0 más `no_confirmada` y `sin_recepciones`). */
export type MotivoRechazoRecepcion = MotivoFuncionCompra | "no_confirmada" | "sin_recepciones" | "no_encontrada";

export type RechazoRecepcion = { motivo: MotivoRechazoRecepcion; linea_id?: string; detalle?: string };

/**
 * Valida un lote de recepciones sobre una compra, con el orden de `registrar_recepciones`: `compra_cambio` (revisión distinta),
 * `no_editable` (cancelada), `no_confirmada` (borrador), `sin_recepciones`, `no_pertenece` (una `linea_id` de otra compra),
 * `recepcion_antes_de_compra` (mes anterior al de la fecha de compra) y `excede_pendiente` (`recibidas + nuevas > unidades`; en saldo
 * cerrado lo que cabe es lo cancelado: la misma cuenta). `null` si todo está bien.
 */
export function validarRecepciones(
  compra: ModeloCompra,
  revision: number,
  nuevas: readonly Pick<RecepcionNueva, "linea_id" | "recibida_periodo" | "unidades">[],
): RechazoRecepcion | null {
  if (compra.revision !== revision) return { motivo: "compra_cambio" };
  if (compra.estado === "cancelada") return { motivo: "no_editable" };
  if (compra.estado === "borrador") return { motivo: "no_confirmada" };
  if (nuevas.length === 0) return { motivo: "sin_recepciones" };

  const lineas = new Map(compra.lineas.map((l) => [l.id, l]));
  for (const r of nuevas) {
    if (!lineas.has(r.linea_id)) return { motivo: "no_pertenece", linea_id: r.linea_id };
  }
  const mesCompra = mesDe(compra.fecha_compra);
  for (const r of nuevas) {
    if (mesDe(r.recibida_periodo) < mesCompra) {
      return { motivo: "recepcion_antes_de_compra", linea_id: r.linea_id, detalle: `La compra es de ${etiquetaMesCorta(mesCompra)}.` };
    }
  }
  const nuevasPorLinea = new Map<string, number>();
  for (const r of nuevas) nuevasPorLinea.set(r.linea_id, (nuevasPorLinea.get(r.linea_id) ?? 0) + r.unidades);
  for (const [lineaId, total] of nuevasPorLinea) {
    const l = lineas.get(lineaId);
    if (l && l.unidades_recibidas + total > l.unidades) {
      const falta = Math.max(0, l.unidades - l.unidades_recibidas);
      return { motivo: "excede_pendiente", linea_id: lineaId, detalle: `A esa línea le faltan ${falta} u por recibir y se intentó confirmar ${total}.` };
    }
  }
  return null;
}

/** Valida quitar una recepción, con el orden de `quitar_recepcion`: `compra_cambio`, `no_editable`, `no_pertenece`. */
export function validarQuitarRecepcion(compra: ModeloCompra, revision: number, recepcionId: string): RechazoRecepcion | null {
  if (compra.revision !== revision) return { motivo: "compra_cambio" };
  if (compra.estado === "cancelada") return { motivo: "no_editable" };
  if (!compra.recepciones.some((r) => r.id === recepcionId)) return { motivo: "no_pertenece" };
  return null;
}

// ─── Argumentos de las funciones SQL ───

/** Elemento de `p_recepciones` tal como lo lee `registrar_recepciones`: el mes va como `aaaa-mm-01`. */
export type RecepcionParaFuncion = {
  linea_id: string;
  recibida_periodo: string;
  unidades: number;
  fecha_recepcion: string;
  nota: string | null;
  origen: RecepcionNueva["origen"];
};

export type ArgsRegistrarRecepciones = {
  p_compra: string;
  p_revision: number;
  p_recepciones: RecepcionParaFuncion[];
  p_actor: ActorCompra;
  p_motivo: string | null;
};

/** `rpc("registrar_recepciones", args)`. Los meses pasan a `aaaa-mm-01`; `origen` por defecto `manual`. */
export function argsRegistrarRecepciones(entrada: {
  compra_id: string;
  revision: number;
  recepciones: readonly (Omit<RecepcionNueva, "nota" | "origen"> & { nota?: string | null; origen?: RecepcionNueva["origen"] })[];
  actor: ActorCompra;
  motivo?: string | null;
}): ArgsRegistrarRecepciones {
  return {
    p_compra: entrada.compra_id,
    p_revision: entrada.revision,
    p_recepciones: entrada.recepciones.map((r) => ({
      linea_id: r.linea_id,
      recibida_periodo: primerDiaDelMes(r.recibida_periodo),
      unidades: r.unidades,
      fecha_recepcion: r.fecha_recepcion,
      nota: r.nota ?? null,
      origen: r.origen ?? "manual",
    })),
    p_actor: entrada.actor,
    p_motivo: entrada.motivo ?? null,
  };
}

export type ArgsQuitarRecepcion = { p_compra: string; p_recepcion: string; p_revision: number; p_actor: ActorCompra };

/** `rpc("quitar_recepcion", args)`. */
export function argsQuitarRecepcion(entrada: { compra_id: string; recepcion_id: string; revision: number; actor: ActorCompra }): ArgsQuitarRecepcion {
  return { p_compra: entrada.compra_id, p_recepcion: entrada.recepcion_id, p_revision: entrada.revision, p_actor: entrada.actor };
}

// ─── «Aceptar sugerencia» (§0.5) ───

/**
 * La recepción que registra «Aceptar sugerencia» de la conciliación del mes X: `recibida_periodo = X`, `fecha_recepcion` = último día
 * de X, `origen = 'sugerencia'`, nota «Aceptada desde la conciliación de oct-2026». Y el `motivo` del evento `recibir`:
 * «sugerencia de conciliación oct-2026». El nombre del usuario y su perfil los pone `p_actor`.
 */
export function recepcionDeSugerencia(entrada: { linea_id: string; periodo: Mes; unidades: number }): { recepcion: RecepcionNueva; motivo: string } {
  const etiqueta = etiquetaMesCorta(entrada.periodo);
  return {
    recepcion: {
      linea_id: entrada.linea_id,
      recibida_periodo: mesDe(entrada.periodo),
      unidades: entrada.unidades,
      fecha_recepcion: ultimoDiaDelMes(entrada.periodo),
      nota: `Aceptada desde la conciliación de ${etiqueta}`,
      origen: "sugerencia",
    },
    motivo: `sugerencia de conciliación ${etiqueta}`,
  };
}

// ─── Qué entra al flujo y qué avisos lleva una recepción ───

/**
 * Lo que las recepciones aportan al flujo por mes (regla 4b): solo las de `recibida_periodo > k'` (ya están físicamente pero el
 * stock publicado aún no las trae) suman, en su mismo mes; las de `≤ k'` ya están en el stock publicado y cuentan 0. Ordenado por
 * periodo; sin meses repetidos.
 */
export function ingresosDeRecepciones(recepciones: readonly { recibida_periodo: Mes; unidades: number }[], kPrima: Mes): { periodo: Mes; unidades: number }[] {
  const por = new Map<Mes, number>();
  for (const r of recepciones) {
    const mes = mesDe(r.recibida_periodo);
    if (mes <= mesDe(kPrima) || r.unidades <= 0) continue;
    por.set(mes, (por.get(mes) ?? 0) + r.unidades);
  }
  return [...por.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([periodo, unidades]) => ({ periodo, unidades }));
}

/**
 * Avisos de una recepción (regla 13): `recepcion_en_mes_cerrado` si `recibida_periodo ≤ k'` (no suma al flujo; la conciliación la
 * contrasta); `recibida_futura` si es posterior al mes de `hoy`; `recepcion_sobre_saldo_cancelado` si la compra tenía el saldo
 * cerrado y esta recepción es un ingreso tardío. `recepcion_sin_respaldo` lo decide la conciliación (flujo), no esta función.
 * `hoy` es `aaaa-mm-dd` o `aaaa-mm`.
 */
export function avisosRecepcion(
  recepcion: { recibida_periodo: Mes },
  kPrima: Mes,
  hoy: string,
  opciones: { sobre_saldo_cancelado?: boolean } = {},
): AvisoRecepcion[] {
  const mes = mesDe(recepcion.recibida_periodo);
  const avisos: AvisoRecepcion[] = [];
  if (mes <= mesDe(kPrima)) avisos.push("recepcion_en_mes_cerrado");
  if (mes > mesDe(hoy)) avisos.push("recibida_futura");
  if (opciones.sobre_saldo_cancelado) avisos.push("recepcion_sobre_saldo_cancelado");
  return avisos;
}

// ─── Modelo en memoria de la operación (espejo de las funciones SQL, para probar secuencias) ───

export type ResultadoOperacion =
  | { ok: true; modelo: ModeloCompra; evento: EventoNuevo; avisos: AvisoRecepcion[] }
  | { ok: false; rechazo: RechazoRecepcion };

type OpcionesOperacion = { compra_id: string; actor: ActorCompra; ahora: string; motivo?: string | null };

/**
 * Lo que hace `registrar_recepciones` sobre el modelo: inserta las recepciones, recalcula `unidades_recibidas`, canceladas y estado,
 * sube `revision` y devuelve el evento `recibir` con `antes` y `despues` (la foto). Un rechazo no cambia nada. Las recepciones nuevas
 * toman `ids[i]` si se pasan, o `rec-<n>`.
 */
export function aplicarRecepciones(
  compra: ModeloCompra,
  revision: number,
  nuevas: readonly RecepcionNueva[],
  opciones: OpcionesOperacion & { ids?: readonly string[] },
): ResultadoOperacion {
  const rechazo = validarRecepciones(compra, revision, nuevas);
  if (rechazo) return { ok: false, rechazo };
  const antes = fotoCompra(compra);
  const cerrada = compra.estado === "recibida" && compra.cancelada_at !== null;
  const agregadas: RecepcionModelo[] = nuevas.map((r, i) => ({
    id: opciones.ids?.[i] ?? `rec-${compra.recepciones.length + i + 1}`,
    linea_id: r.linea_id,
    recibida_periodo: mesDe(r.recibida_periodo),
    unidades: r.unidades,
    fecha_recepcion: r.fecha_recepcion,
    origen: r.origen,
  }));
  const modelo = recalcularModelo({ ...compra, recepciones: [...compra.recepciones, ...agregadas], revision: compra.revision + 1 });
  const total = nuevas.reduce((a, r) => a + r.unidades, 0);
  return {
    ok: true,
    modelo,
    evento: evento({
      compra_id: opciones.compra_id,
      linea_id: new Set(nuevas.map((r) => r.linea_id)).size === 1 ? nuevas[0].linea_id : null,
      accion: "recibir",
      antes,
      despues: fotoCompra(modelo),
      motivo: opciones.motivo ?? null,
      resumen: `Ingreso confirmado: ${total} u en ${nuevas.length} recepcion(es)`,
      actor: opciones.actor,
      ahora: opciones.ahora,
    }),
    avisos: cerrada ? ["recepcion_sobre_saldo_cancelado"] : [],
  };
}

/** Lo que hace `quitar_recepcion`: borra la recepción y recalcula (con saldo cerrado, sin recepciones restantes pasa a `cancelada`). */
export function aplicarQuitarRecepcion(compra: ModeloCompra, revision: number, recepcionId: string, opciones: OpcionesOperacion): ResultadoOperacion {
  const rechazo = validarQuitarRecepcion(compra, revision, recepcionId);
  if (rechazo) return { ok: false, rechazo };
  const quitada = compra.recepciones.find((r) => r.id === recepcionId) as RecepcionModelo;
  const antes = fotoCompra(compra);
  const modelo = recalcularModelo({ ...compra, recepciones: compra.recepciones.filter((r) => r.id !== recepcionId), revision: compra.revision + 1 });
  return {
    ok: true,
    modelo,
    evento: evento({
      compra_id: opciones.compra_id,
      linea_id: quitada.linea_id,
      accion: "quitar_recepcion",
      antes,
      despues: fotoCompra(modelo),
      resumen: `Ingreso quitado: ${quitada.unidades} u de ${quitada.recibida_periodo}`,
      actor: opciones.actor,
      ahora: opciones.ahora,
    }),
    avisos: [],
  };
}

/** Estado en el que deja una compra el resultado de una operación (atajo para pantallas y pruebas). */
export const estadoTras = (r: ResultadoOperacion): EstadoCompra | null => (r.ok ? r.modelo.estado : null);
