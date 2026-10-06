import { esTipoTienda, estadoTienda } from "./estado";
import type { EventoTienda, GrupoMesEventos, ReporteAperturas, TipoTienda } from "./tipos";

/**
 * Línea de tiempo de aperturas y cierres (docs/modulos/04-tiendas.md,
 * "Línea de tiempo" y reglas 10–11). Funciones puras sobre filas de
 * `tiendas` ya leídas; `hoy` es ISO `aaaa-mm-dd`.
 */

/** Lo que hace falta de cada fila de `tiendas`; `tipo` llega como texto desde la base. */
export type TiendaParaEventos = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  zona: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada_promedio: number | null;
  activo: boolean;
};

export type RangoFechas = { desde?: string | null; hasta?: string | null };

function tipoDe(t: TiendaParaEventos): TipoTienda {
  return esTipoTienda(t.tipo) ? t.tipo : "Tienda";
}

/**
 * Un evento por fecha registrada (una tienda con apertura y cierre produce
 * dos), por `fecha` y luego `codigo`. `pasado` es `fecha < hoy`: una apertura
 * o un cierre con fecha hoy todavía no pasó. `desde`/`hasta` acotan por
 * fecha (inclusive) y solo afectan a `eventos` y a los conteos de próximos;
 * `resumen.sin_fecha_apertura` cuenta tiendas activas de tipo Tienda sin
 * apertura, dentro o fuera del rango.
 */
export function eventosTiendas(tiendas: TiendaParaEventos[], hoy: string, rango: RangoFechas = {}): ReporteAperturas {
  const eventos: EventoTienda[] = [];
  let sinFechaApertura = 0;

  for (const t of tiendas) {
    const estado = estadoTienda(t, hoy);
    const tipo = tipoDe(t);
    if (tipo === "Tienda" && t.activo && !t.fecha_apertura) sinFechaApertura += 1;

    const base = {
      tienda_id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      tipo,
      zona: t.zona,
      estado,
      venta_esperada_promedio: t.venta_esperada_promedio,
    };
    if (t.fecha_apertura) {
      eventos.push({ fecha: t.fecha_apertura, evento: "apertura", pasado: t.fecha_apertura < hoy, ...base });
    }
    if (t.fecha_cierre) {
      eventos.push({ fecha: t.fecha_cierre, evento: "cierre", pasado: t.fecha_cierre < hoy, ...base });
    }
  }

  const desde = rango.desde ?? null;
  const hasta = rango.hasta ?? null;
  const acotados = eventos.filter((e) => (desde === null || e.fecha >= desde) && (hasta === null || e.fecha <= hasta));
  acotados.sort((a, b) => (a.fecha === b.fecha ? a.codigo.localeCompare(b.codigo) : a.fecha < b.fecha ? -1 : 1));

  return {
    hoy,
    eventos: acotados,
    resumen: {
      proximas_aperturas: acotados.filter((e) => e.evento === "apertura" && !e.pasado).length,
      proximos_cierres: acotados.filter((e) => e.evento === "cierre" && !e.pasado).length,
      sin_fecha_apertura: sinFechaApertura,
    },
  };
}

const formatoMes = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" });

/** `"2027-03"` → `"marzo de 2027"`. */
export function etiquetaMes(mes: string): string {
  const [anio, numero] = mes.split("-").map(Number);
  return formatoMes.format(new Date(Date.UTC(anio, numero - 1, 1)));
}

/**
 * Agrupa los eventos por mes (`aaaa-mm`), en orden cronológico y sin meses
 * vacíos; cada grupo conserva el orden de llegada de sus eventos.
 */
export function agruparPorMes(eventos: EventoTienda[]): GrupoMesEventos[] {
  const grupos = new Map<string, EventoTienda[]>();
  for (const e of eventos) {
    const mes = e.fecha.slice(0, 7);
    const lista = grupos.get(mes);
    if (lista) lista.push(e);
    else grupos.set(mes, [e]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([mes, lista]) => ({ mes, etiqueta: etiquetaMes(mes), eventos: lista }));
}
