import type {
  AsignacionRecepcion,
  EntregaConPendiente,
  EntregaParaPendientes,
  LineaParaPendientes,
  Mes,
  RecepcionParaPendientes,
  ResultadoPendientes,
} from "./tipos";

/**
 * Pendiente de cada entrega de una línea (ficha 08, regla 4 y §0.11). Pura y compartida por el flujo (T2a) y las compras (T2b).
 *
 *  - Las recepciones no apuntan a una entrega: se asignan FIFO al leer. Las recepciones, de la más antigua a la más reciente
 *    (`recibida_periodo`, `fecha_recepcion`, id), consumen las entregas de la más temprana a la más tardía.
 *  - Lo cancelado al cerrar el saldo se descuenta desde la ÚLTIMA entrega hacia atrás, sobre lo que las recepciones no ocuparon.
 *  - `pendiente_e = max(0, unidades_e − asignadas_e − canceladas_e)`; con datos coherentes, `Σ pendiente = unidades − recibidas −
 *    canceladas`.
 */

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Cantidad entera y positiva; cualquier otra cosa (negativos, NaN) no aporta. */
const positivo = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function pendientesPorEntrega(
  linea: LineaParaPendientes,
  entregas: readonly EntregaParaPendientes[],
  recepciones: readonly RecepcionParaPendientes[],
): ResultadoPendientes {
  const ordenadas = [...entregas].sort((a, b) => comparar(a.periodo, b.periodo) || comparar(a.id, b.id));
  const filas: EntregaConPendiente[] = ordenadas.map((e) => ({
    id: e.id,
    periodo: e.periodo,
    unidades: positivo(e.unidades),
    asignadas: 0,
    canceladas: 0,
    pendiente: 0,
  }));

  const recibidasOrdenadas = [...recepciones]
    .filter((r) => positivo(r.unidades) > 0)
    .sort(
      (a, b) =>
        comparar(a.recibida_periodo, b.recibida_periodo) ||
        comparar(a.fecha_recepcion ?? "", b.fecha_recepcion ?? "") ||
        comparar(a.id, b.id),
    );

  const asignaciones: AsignacionRecepcion[] = [];
  let recibidas = 0;
  let sinAsignar = 0;
  let cursor = 0;
  for (const r of recibidasOrdenadas) {
    let resto = positivo(r.unidades);
    recibidas += resto;
    while (resto > 0 && cursor < filas.length) {
      const e = filas[cursor];
      const libre = e.unidades - e.asignadas;
      if (libre <= 0) {
        cursor += 1;
        continue;
      }
      const toma = Math.min(libre, resto);
      e.asignadas += toma;
      resto -= toma;
      const previa = asignaciones[asignaciones.length - 1];
      if (previa && previa.recepcion_id === r.id && previa.entrega_id === e.id) previa.unidades += toma;
      else asignaciones.push({ recepcion_id: r.id, entrega_id: e.id, unidades: toma });
    }
    sinAsignar += resto;
  }

  const canceladas = positivo(linea.unidades_canceladas);
  let porCancelar = canceladas;
  for (let i = filas.length - 1; i >= 0 && porCancelar > 0; i--) {
    const e = filas[i];
    const toma = Math.min(e.unidades - e.asignadas, porCancelar);
    if (toma <= 0) continue;
    e.canceladas = toma;
    porCancelar -= toma;
  }
  sinAsignar += porCancelar;

  let pendiente = 0;
  for (const e of filas) {
    e.pendiente = Math.max(0, e.unidades - e.asignadas - e.canceladas);
    pendiente += e.pendiente;
  }

  return { entregas: filas, asignaciones, recibidas, canceladas, pendiente, sin_asignar: sinAsignar };
}

/**
 * Una entrega con `periodo ≤ k'` y pendiente > 0 está vencida: el flujo la sigue esperando en `k'+1` hasta que una persona confirme
 * su ingreso o cancele el saldo (§0.5). `kPrima` es el último mes publicado (`aaaa-mm`).
 */
export function esEntregaVencida(entrega: { periodo: Mes; pendiente: number }, kPrima: Mes): boolean {
  return entrega.pendiente > 0 && entrega.periodo.slice(0, 7) <= kPrima.slice(0, 7);
}
