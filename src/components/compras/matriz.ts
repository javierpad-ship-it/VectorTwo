import {
  ETIQUETA_SENAL,
  senalDeCaracter,
  type FilaFlujoDetalleApi,
  type MesFlujoApi,
  type SerieFlujoApi,
  type Senal,
  type SubflujoApi,
} from "@/lib/flujo/tipos-api";
import { imi as textoImi, porcentaje, TONO_SENAL, unidades, mesCorto } from "./formato";

/**
 * Modelo de la tabla de flujo mensual de UNA fila (ficha 08 §4.3): meses en columnas y magnitudes en filas, con la historia a la
 * izquierda (venta e ingresos reales del inventario), el mes `k'` en medio y el horizonte a la derecha. Es una función pura de la
 * respuesta de la API: no calcula nada del negocio (VPM, IMI, saldo y exceso vienen hechos); solo los acomoda y marca. El render está
 * en `tabla-matriz.tsx`.
 */

export type TonoCelda = "normal" | "alerta" | "marca" | "exito" | "suave";
export type CeldaMatriz = { texto: string; tono?: TonoCelda; ayuda?: string };
export type ColumnaMatriz = { periodo: string; fase: "historia" | "k" | "horizonte" };
export type FilaMatriz = {
  clave: string;
  etiqueta: string;
  ayuda?: string;
  /** Fila principal (más peso visual). */
  fuerte?: boolean;
  celdas: CeldaMatriz[];
};

const VACIA: CeldaMatriz = { texto: "" };
const num = (n: number, tono?: TonoCelda): CeldaMatriz => ({ texto: unidades(n), tono });

/** Opciones de cuántos meses de historia (contando `k'`) se muestran a la izquierda. */
export const OPCIONES_HISTORIA = [1, 3, 6, 12] as const;
export type MesesHistoria = (typeof OPCIONES_HISTORIA)[number];

/** Columnas: los `n` últimos meses cerrados (con `k'` al final del bloque) y el horizonte. */
export function columnasDetalle(detalle: Pick<FilaFlujoDetalleApi, "meses" | "historia">, historia: number): ColumnaMatriz[] {
  const k = detalle.meses[0]?.periodo;
  if (!k) return [];
  const anteriores = detalle.historia.filter((h) => h.periodo < k).map((h) => h.periodo);
  // `slice(-0)` devolvería todo: con una sola columna de historia (solo `k'`) no queda ninguna anterior.
  const cuantos = Math.max(0, historia - 1);
  const previos = cuantos === 0 ? [] : anteriores.slice(-cuantos);
  return [
    ...previos.map<ColumnaMatriz>((periodo) => ({ periodo, fase: "historia" })),
    { periodo: k, fase: "k" },
    ...detalle.meses.slice(1).map<ColumnaMatriz>((m) => ({ periodo: m.periodo, fase: "horizonte" })),
  ];
}

/** Columnas de los subflujos y del resto: `k'` y el horizonte (no tienen historia por mes). */
export function columnasDesdeK(meses: readonly Pick<MesFlujoApi, "periodo">[]): ColumnaMatriz[] {
  return meses.map<ColumnaMatriz>((m, i) => ({ periodo: m.periodo, fase: i === 0 ? "k" : "horizonte" }));
}

export type ContextoMatriz = { imiMin: number; imiMax: number };

const celdaSenal = (s: Senal, k: boolean): CeldaMatriz => {
  if (k) return VACIA;
  if (s === "al_dia") return { texto: "—", tono: "suave" };
  const tono = TONO_SENAL[s];
  return { texto: ETIQUETA_SENAL[s].toLowerCase(), tono: tono === "neutro" ? "suave" : tono === "exito" ? "exito" : tono };
};

/** Las filas de la tabla principal de una fila del flujo (la «fila completa», con subflujos incluidos como en §0.9). */
export function filasMatrizDetalle(d: FilaFlujoDetalleApi, columnas: readonly ColumnaMatriz[], ctx: ContextoMatriz): FilaMatriz[] {
  const meses = new Map(d.meses.map((m) => [m.periodo, m]));
  const historia = new Map(d.historia.map((h) => [h.periodo, h]));
  const conc = new Map(d.conciliacion.filter((c) => c.marca_id === null).map((c) => [c.periodo, c]));
  const barrer = new Map(d.al_barrer.map((b) => [b.periodo, b]));
  const horizonte = columnas.filter((c) => c.fase === "horizonte");
  const primerMes = horizonte[0]?.periodo;
  const vencidas = d.entregas.filter((e) => e.vencida).reduce((a, e) => a + e.pendiente, 0);
  const sinCurva = d.avisos.includes("sin_curva");
  const inflado = d.avisos.includes("posible_doble_conteo");
  const nota = inflado ? `Puede estar inflado: ${unidades(d.resumen.posible_doble_conteo)} u por confirmar (posible doble conteo)` : undefined;

  const porColumna = (f: (c: ColumnaMatriz) => CeldaMatriz) => columnas.map(f);
  const filas: FilaMatriz[] = [];

  filas.push({
    clave: "demanda",
    etiqueta: "Venta real / demanda proyectada",
    ayuda: "Hasta el último mes publicado, la venta real en unidades; después, la demanda de la proyección cerrada (completa: no se le descuenta nada).",
    fuerte: true,
    celdas: porColumna((c) => {
      if (c.fase === "horizonte") return num(meses.get(c.periodo)?.demanda ?? 0);
      const h = historia.get(c.periodo);
      return h ? num(h.venta) : VACIA;
    }),
  });

  const marcasBarrer = new Map<string, string>();
  for (const b of d.al_barrer) for (const m of b.marcas) marcasBarrer.set(m.marca_id, m.marca);
  for (const [marcaId, marca] of marcasBarrer) {
    const demandaPrimera = meses.get(primerMes ?? "")?.demanda ?? 0;
    const unidadesPrimera = barrer.get(primerMes ?? "")?.marcas.find((m) => m.marca_id === marcaId)?.unidades ?? 0;
    const pct = demandaPrimera > 0 ? ` ${porcentaje(Math.round((unidadesPrimera / demandaPrimera) * 100))}` : "";
    filas.push({
      clave: `barrer-${marcaId}`,
      etiqueta: `de la cual al barrer (${marca}${pct})`,
      ayuda: "Parte de la demanda que corresponde a una marca al barrer: informativa, no se resta.",
      celdas: porColumna((c) => (c.fase === "horizonte" ? num(barrer.get(c.periodo)?.marcas.find((m) => m.marca_id === marcaId)?.unidades ?? 0, "suave") : VACIA)),
    });
  }

  filas.push({
    clave: "ingreso_inferido",
    etiqueta: "Ingresos (inventario, meses cerrados)",
    ayuda: "Lo que realmente llegó: stock de fin de mes − stock del mes anterior + venta. Sale del inventario publicado, no de las compras.",
    celdas: porColumna((c) => {
      if (c.fase === "horizonte") return VACIA;
      const h = historia.get(c.periodo);
      return h && h.ingreso_inferido !== null ? num(h.ingreso_inferido) : VACIA;
    }),
  });
  filas.push({
    clave: "recepciones",
    etiqueta: "recepciones registradas",
    ayuda: "Ingresos de compras que alguien confirmó en ese mes. La diferencia con el ingreso del inventario es la conciliación.",
    celdas: porColumna((c) => {
      if (c.fase === "horizonte") return VACIA;
      const x = conc.get(c.periodo);
      if (!x) return VACIA;
      if (x.avisos.includes("ingreso_sin_registrar")) return { texto: `${unidades(x.recepciones_registradas)} · ${unidades(x.sin_registrar)} sin registrar`, tono: "alerta", ayuda: `${unidades(x.sin_registrar)} u entraron al inventario sin una recepción registrada.` };
      if (x.avisos.includes("recepcion_sin_respaldo")) return { texto: `${unidades(x.recepciones_registradas)} · ${unidades(x.sin_respaldo)} sin respaldo`, tono: "alerta", ayuda: "Hay recepciones registradas que el inventario de ese mes no muestra." };
      return num(x.recepciones_registradas, "suave");
    }),
  });

  filas.push({
    clave: "entregas",
    etiqueta: "Entregas programadas (compras confirmadas)",
    ayuda: "Lo que falta recibir de las compras confirmadas, en el mes en que llega, más los ingresos confirmados de meses sin publicar. Una entrega vencida se sigue esperando en el primer mes hasta que alguien confirme su ingreso.",
    celdas: porColumna((c) => {
      if (c.fase !== "horizonte") return VACIA;
      const m = meses.get(c.periodo);
      if (!m) return VACIA;
      if (c.periodo === primerMes && vencidas > 0) return { texto: `${unidades(m.ingresos)} · ${unidades(vencidas)} vencidas ⚠`, tono: "alerta", ayuda: `${unidades(vencidas)} u de entregas vencidas sin confirmar: si ya llegaron, se cuentan dos veces.` };
      return num(m.ingresos);
    }),
  });

  if (d.subflujos.length > 0) {
    const etiqueta = d.subflujos.map((s) => `${s.marca} ${porcentaje(s.pct_directo)}`).join(", ");
    filas.push({
      clave: "reposicion",
      etiqueta: `Reposición directa esperada (${etiqueta})`,
      ayuda: "Lo que llega directo del intercompany sin pasar por una compra: el porcentaje directo de la regla × la demanda de la marca. Cuenta como ingreso esperado y el stock de la fila lo incluye.",
      celdas: porColumna((c) => {
        if (c.fase !== "horizonte") return VACIA;
        return num(d.subflujos.reduce((a, s) => a + (s.meses.find((m) => m.periodo === c.periodo)?.reposicion_esperada ?? 0), 0));
      }),
    });
  }

  filas.push({
    clave: "stock",
    etiqueta: "Stock fin de mes (cadena)",
    ayuda: "Tiendas + CD. Proyectado: stock anterior + ingresos + reposición directa − demanda; puede ser negativo (quiebre).",
    fuerte: true,
    celdas: porColumna((c) => {
      if (c.fase === "horizonte") {
        const m = meses.get(c.periodo);
        if (!m) return VACIA;
        const tocado = inflado && primerMes !== undefined && c.periodo > primerMes;
        return { texto: unidades(m.stock_fin), tono: m.stock_fin < 0 || tocado ? "alerta" : undefined, ayuda: tocado ? nota : undefined };
      }
      const h = historia.get(c.periodo);
      return h ? num(h.stock_fin) : VACIA;
    }),
  });

  filas.push({
    clave: "vpm",
    etiqueta: "Venta promedio mensual (12 meses siguientes)",
    ayuda: "Promedio de la demanda proyectada de los doce meses siguientes: es el denominador del IMI.",
    celdas: porColumna((c) => {
      const m = meses.get(c.periodo);
      if (c.fase === "historia" || !m || m.vpm === null) return VACIA;
      return { texto: textoImi(m.vpm), ayuda: m.extendido ? "Usa demanda repetida más allá del horizonte." : undefined };
    }),
  });
  filas.push({
    clave: "vpm_real",
    etiqueta: "Venta promedio real (últimos 12 meses)",
    ayuda: "Para comparar con el VPM proyectado en el último mes publicado.",
    celdas: porColumna((c) => (c.fase === "k" && d.resumen.vpm_real_k !== null ? { texto: textoImi(d.resumen.vpm_real_k), tono: "suave" } : VACIA)),
  });

  filas.push({
    clave: "imi",
    etiqueta: "IMI sin compras sugeridas",
    ayuda: `Meses de inventario: stock ÷ venta promedio mensual. En rojo cuando sale del rango ${ctx.imiMin}–${ctx.imiMax}.`,
    fuerte: true,
    celdas: porColumna((c) => {
      const m = meses.get(c.periodo);
      if (c.fase === "historia" || !m) return VACIA;
      const tocado = inflado && c.fase === "horizonte" && primerMes !== undefined && c.periodo > primerMes;
      if (m.imi === null) return { texto: sinCurva ? "sin curva" : "—", tono: "suave" };
      return { texto: textoImi(m.imi), tono: m.fuera_de_rango || tocado ? "alerta" : undefined, ayuda: tocado ? nota : m.fuera_de_rango ? `Fuera del rango ${ctx.imiMin}–${ctx.imiMax}.` : undefined };
    }),
  });
  filas.push({
    clave: "saldo",
    etiqueta: "Saldo por comprar (debe llegar)",
    ayuda: "Lo que tiene que llegar en ese mes para cerrarlo con el IMI mínimo, contando lo ya sugerido en meses anteriores.",
    fuerte: true,
    celdas: porColumna((c) => (c.fase === "horizonte" ? num(meses.get(c.periodo)?.saldo ?? 0, (meses.get(c.periodo)?.saldo ?? 0) > 0 ? "alerta" : "suave") : VACIA)),
  });
  filas.push({
    clave: "exceso",
    etiqueta: `Exceso (sobre ${ctx.imiMax} meses)`,
    ayuda: "Unidades por encima del tope (IMI máximo × venta promedio mensual), con el stock sin sugerencias.",
    celdas: porColumna((c) => (c.fase === "horizonte" ? num(meses.get(c.periodo)?.exceso ?? 0, (meses.get(c.periodo)?.exceso ?? 0) > 0 ? "marca" : "suave") : VACIA)),
  });
  filas.push({
    clave: "senal",
    etiqueta: `Señal (IMI fuera de ${ctx.imiMin}–${ctx.imiMax})`,
    celdas: porColumna((c) => {
      const m = meses.get(c.periodo);
      return c.fase === "horizonte" && m ? celdaSenal(m.senal, false) : VACIA;
    }),
  });
  return filas;
}

/** Filas de un subflujo intercompany (o del resto de la fila): mismas magnitudes, con la reposición directa propia. */
export function filasMatrizSubflujo(s: SubflujoApi, columnas: readonly ColumnaMatriz[]): FilaMatriz[] {
  const meses = new Map(s.meses.map((m) => [m.periodo, m]));
  const f = (c: ColumnaMatriz) => meses.get(c.periodo);
  const hor = (g: (m: SubflujoApi["meses"][number]) => CeldaMatriz) => columnas.map((c) => (c.fase === "horizonte" && f(c) ? g(f(c)!) : VACIA));
  return [
    { clave: "demanda", etiqueta: `demanda ${s.marca} (${porcentaje(Math.round(s.part * 1000) / 10)})`, celdas: columnas.map((c) => (f(c) ? num(f(c)!.demanda) : VACIA)) },
    { clave: "reposicion", etiqueta: `reposición directa esperada (${porcentaje(s.pct_directo)})`, celdas: hor((m) => num(m.reposicion_esperada)) },
    { clave: "entregas", etiqueta: `entregas de ${s.marca} (compras)`, celdas: hor((m) => num(m.ingresos)) },
    { clave: "stock", etiqueta: `stock ${s.marca}`, celdas: columnas.map((c) => (f(c) ? num(f(c)!.stock_fin, f(c)!.stock_fin < 0 ? "alerta" : undefined) : VACIA)) },
    {
      clave: "imi",
      etiqueta: `IMI ${s.marca} (rango ${s.imi_min}–${s.imi_max})`,
      celdas: columnas.map((c) => {
        const m = f(c);
        if (!m) return VACIA;
        return m.imi === null ? { texto: "—", tono: "suave" as const } : { texto: textoImi(m.imi), tono: m.fuera_de_rango ? ("alerta" as const) : undefined };
      }),
    },
    { clave: "saldo", etiqueta: `saldo ${s.marca} (debe llegar)`, celdas: hor((m) => num(m.saldo, m.saldo > 0 ? "alerta" : "suave")) },
    { clave: "senal", etiqueta: "señal", celdas: hor((m) => celdaSenal(m.senal, false)) },
  ];
}

/** El resto de la fila (lo que no es de ninguna marca con subflujo), con el rango general. */
export function filasMatrizResto(meses: readonly MesFlujoApi[], columnas: readonly ColumnaMatriz[], ctx: ContextoMatriz): FilaMatriz[] {
  const idx = new Map(meses.map((m) => [m.periodo, m]));
  const cel = (c: ColumnaMatriz, g: (m: MesFlujoApi) => CeldaMatriz) => {
    const m = idx.get(c.periodo);
    return m ? g(m) : VACIA;
  };
  return [
    { clave: "demanda", etiqueta: "demanda del resto", celdas: columnas.map((c) => cel(c, (m) => num(m.demanda))) },
    { clave: "stock", etiqueta: "stock del resto", celdas: columnas.map((c) => cel(c, (m) => num(m.stock_fin, m.stock_fin < 0 ? "alerta" : undefined))) },
    { clave: "imi", etiqueta: `IMI del resto (rango ${ctx.imiMin}–${ctx.imiMax})`, celdas: columnas.map((c) => cel(c, (m) => (m.imi === null ? { texto: "—", tono: "suave" as const } : { texto: textoImi(m.imi), tono: m.fuera_de_rango ? ("alerta" as const) : undefined }))) },
    { clave: "saldo", etiqueta: "saldo del resto (debe llegar)", celdas: columnas.map((c) => (c.fase === "horizonte" ? cel(c, (m) => num(m.saldo, m.saldo > 0 ? "alerta" : "suave")) : VACIA)) },
  ];
}

/** Totales de la lista (`FlujoApi.totales`): la serie ya sin las filas sin curva en el IMI. `periodos` = `[k', k'+1 … H]`. */
export function columnasTotales(periodos: readonly string[]): ColumnaMatriz[] {
  return periodos.map<ColumnaMatriz>((periodo, i) => ({ periodo, fase: i === 0 ? "k" : "horizonte" }));
}

export function filasMatrizTotales(s: SerieFlujoApi, columnas: readonly ColumnaMatriz[], ctx: ContextoMatriz): FilaMatriz[] {
  const horizonte = (g: (i: number) => CeldaMatriz) => columnas.map((c, i) => (c.fase === "horizonte" ? g(i) : VACIA));
  const filas: FilaMatriz[] = [
    { clave: "demanda", etiqueta: "Venta real / demanda proyectada", fuerte: true, celdas: columnas.map((_, i) => num(s.demanda[i] ?? 0)) },
    { clave: "ingresos", etiqueta: "Ingresos (inventario en el último mes; entregas programadas después)", celdas: columnas.map((_, i) => num(s.ingresos[i] ?? 0)) },
  ];
  if (s.reposicion) filas.push({ clave: "reposicion", etiqueta: "Reposición directa esperada", celdas: horizonte((i) => num(s.reposicion![i] ?? 0)) });
  filas.push(
    { clave: "stock", etiqueta: "Stock fin de mes (cadena)", fuerte: true, celdas: columnas.map((_, i) => num(s.stock[i] ?? 0, (s.stock[i] ?? 0) < 0 ? "alerta" : undefined)) },
    {
      clave: "imi",
      etiqueta: "IMI (sin las filas sin curva)",
      ayuda: `Meses de inventario del conjunto mostrado. En rojo cuando sale del rango ${ctx.imiMin}–${ctx.imiMax}.`,
      celdas: columnas.map((_, i) => {
        const v = s.imi[i];
        if (v === null || v === undefined) return { texto: "—", tono: "suave" as const };
        return { texto: textoImi(v), tono: s.fuera_de_rango[i] === "1" ? ("alerta" as const) : undefined };
      }),
    },
    { clave: "saldo", etiqueta: "Saldo por comprar (suma de las filas)", fuerte: true, celdas: horizonte((i) => num(s.saldo[i] ?? 0, (s.saldo[i] ?? 0) > 0 ? "alerta" : "suave")) },
    { clave: "exceso", etiqueta: `Exceso (sobre ${ctx.imiMax} meses)`, celdas: horizonte((i) => num(s.exceso[i] ?? 0, (s.exceso[i] ?? 0) > 0 ? "marca" : "suave")) },
    { clave: "senal", etiqueta: "Señal", celdas: horizonte((i) => { const sn = senalDeCaracter(s.senal[i] ?? ""); return sn ? celdaSenal(sn, false) : VACIA; }) },
  );
  return filas;
}

/** Cabecera de columna: `oct-26`. */
export const encabezadoColumna = (c: ColumnaMatriz): string => mesCorto(c.periodo);
