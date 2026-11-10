import type { Celda, Hoja } from "@/lib/proyeccion/excel";
import type { TableroApi } from "./tipos-api";

/**
 * Hojas del Excel del tablero de aprobación de dirección (ficha 14, §4.9). Puro: solo arma filas y cabeceras a partir de la respuesta ya cargada de
 * `GET /api/direccion/tablero`; el libro se escribe en el navegador con `descargarLibro` (SheetJS bajo demanda), sin ninguna ruta de descarga.
 * No lee datos, no escribe en ninguna tabla y no calcula cifras de negocio: las cifras van como números (unidades enteras, % con un decimal) y los
 * textos que la pantalla ya armó (estado, fechas en hora de Lima, rótulos del puente, lo que bloquearía el cierre) llegan hechos en `EntradaExcelDireccion`,
 * para que el Excel diga exactamente lo mismo que la pantalla.
 */

export type EntradaExcelDireccion = {
  tablero: TableroApi;
  /** Textos de la cabecera y del resumen, tal como se ven en la pantalla. */
  textos: {
    cabecera: string;
    estado: string;
    cerrada_por: string;
    vigente: string;
    /** Las líneas del resumen para decidir (más la del cierre, si la proyección está en trabajo). */
    lineas: string[];
    comparada: string;
    datos_hasta: string;
    ultimo_publicado: string;
    descargado: string;
    nota_exactitud: string;
    recorte: string;
  };
  /** Los filtros de la pantalla en texto: `[filtro, valor]`. */
  filtros: [string, string][];
  /** Rótulo de cada paso del puente total, en su orden. */
  pasos: string[];
  /** Lo que bloquearía el cierre (solo en trabajo), ya en texto. */
  bloqueos: { nivel: string; codigo: string; texto: string }[];
  /** Textos de cada fila de `tablero.crecimientos`, en el mismo orden. */
  crecimientos: { declarado: string; version: string; tendencia: string; semaforo: string; anomalias: string }[];
  /** El historial de aprobaciones, de la más reciente a la más antigua. */
  historial: { fecha: string; quien: string; resultado: string; motivo: string; comentario: string; sobre: string; invalidada: string }[];
  /** Notas de la atribución por tienda (participación usada y lo que quedó sin atribuir). */
  atribucion: string[];
  /** La nota del servidor bajo la tabla mensual (T3: por qué «Sin atribuir a tienda» trae negativos); `null` o ausente si no hay. */
  nota_mensual?: string | null;
  /** Advertencia de cada comparativo que la trae (T3: mezcla venta real de la marca con cifras estimadas), por clave. */
  advertencias?: Partial<Record<TableroApi["kpis"]["comparativos"][number]["clave"], string>>;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

/** Un % con un decimal, como número; `null` (celda vacía) si no hay dato. */
const pct = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
/** Una participación (fracción) como % con un decimal. */
const parte = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 1000) / 10);
const numero = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : n);

const MOTIVO: Record<string, string> = { sin_base: "sin base", incompleto: "año incompleto", nueva: "nueva" };

const rango = (desde: number, hasta: number): string => (desde === hasta ? MESES[desde - 1] : `${MESES[desde - 1]}–${MESES[hasta - 1]}`);

/** ¿Es la fila del cierre del año en curso (real de enero a `k` más proyectado de `k+1` a diciembre)? */
const esCierre = (clave: string): boolean => /^cierre[_-]\d{4}$/.test(clave);

/**
 * `TIPO` de la hoja `MENSUAL` (§4.9): real, proyectado, sin_nino, variacion o comparada. La fila del cierre del año en curso (`cierre_<Y>`) no es
 * proyectada entera: con `fila` y `k`, dice «real ene–set + proyectado oct–dic».
 */
export function tipoMensual(tipo: TableroApi["tabla_mensual"]["filas"][number]["tipo"], fila?: { clave: string; k: number }): string {
  if (tipo === "proyectado" && fila && esCierre(fila.clave) && fila.k >= 1) return fila.k >= 12 ? "real" : `real ${rango(1, fila.k)} + proyectado ${rango(fila.k + 1, 12)}`;
  if (tipo === "real" || tipo === "real_parcial") return "real";
  if (tipo === "comparada" || tipo === "aprobada") return "comparada";
  return tipo;
}

function hojaResumen(e: EntradaExcelDireccion): Hoja {
  const t = e.tablero;
  const filas: Hoja = [["SECCIÓN", "DATO", "VALOR", "MISMAS TIENDAS", "NOTA"]];
  filas.push(["PROYECCIÓN", "Proyección", e.textos.cabecera, null, null]);
  filas.push(["PROYECCIÓN", "Estado de dirección", e.textos.estado, null, null]);
  filas.push(["PROYECCIÓN", "Cerrada por", e.textos.cerrada_por, null, null]);
  filas.push(["PROYECCIÓN", "Aprobación vigente", e.textos.vigente, null, null]);
  filas.push(["PROYECCIÓN", "Recorte", e.textos.recorte, null, null]);
  e.textos.lineas.forEach((linea, i) => filas.push(["RESUMEN PARA DECIDIR", String(i + 1), linea, null, "siempre de la proyección entera"]));
  for (const c of t.kpis.comparativos) {
    filas.push([
      "COMPARATIVO (%)",
      c.etiqueta,
      c.total.pct !== null ? pct(c.total.pct) : c.total.motivo ? (MOTIVO[c.total.motivo] ?? c.total.motivo) : null,
      c.mismas.pct !== null ? pct(c.mismas.pct) : c.mismas.motivo ? (MOTIVO[c.mismas.motivo] ?? c.mismas.motivo) : null,
      [c.nino ? "algún año del par es del Niño" : null, c.mismas.tiendas.length > 0 ? `mismas tiendas: ${c.mismas.tiendas.join(", ")}` : null, e.advertencias?.[c.clave] ?? null].filter(Boolean).join(" · ") || null,
    ]);
  }
  for (const f of t.datos.fuera_universo) filas.push(["FUERA DE LA PROYECCIÓN", `Venta de filas que ya no se proyectan: ${f.anio}`, f.u, null, "unidades del recorte sin fila en la proyección"]);
  return filas;
}

function hojaPuente(e: EntradaExcelDireccion): Hoja {
  const porGm = e.tablero.puente.por_gm;
  const total = porGm[porGm.length - 1];
  const filas: Hoja = [["PASO", "TIPO", ...porGm.map((g) => g.nombre), "ACUMULADO TOTAL"]];
  if (!total) return filas;
  total.lineas.forEach((l, i) => {
    const celdas: Celda[] = porGm.map((g) => {
      const x = g.lineas.find((y) => y.clave === l.clave);
      return x ? (x.subtotal ? x.acumulado : x.u) : null;
    });
    filas.push([e.pasos[i] ?? l.etiqueta, l.subtotal ? "subtotal" : "paso", ...celdas, l.acumulado]);
  });
  return filas;
}

function hojaAlertas(e: EntradaExcelDireccion): Hoja {
  const filas: Hoja = [["CÓDIGO", "NIVEL", "ALCANCE", "TÍTULO", "TEXTO"]];
  for (const b of e.bloqueos) filas.push([b.codigo, b.nivel, "proyección", null, b.texto]);
  for (const a of e.tablero.alertas) filas.push([a.codigo, a.nivel === "importante" ? "Importante" : "Informativo", a.alcance === "proyeccion" ? "proyección" : "recorte", a.titulo, a.detalle]);
  return filas;
}

function hojaFrenteAprobada(e: EntradaExcelDireccion): Hoja {
  const d = e.tablero.decidir.diferencia;
  const p = e.tablero.proyeccion;
  const filas: Hoja = [["GÉNERO × MUNDO", "APROBADO", "ACTUAL", "DIFERENCIA U", "DIFERENCIA %", "NOTA"]];
  if (d === null) {
    filas.push(["Todavía no hay ninguna proyección aprobada", null, null, null, null, null]);
    return filas;
  }
  const nota = `${d.resultado === "aprobada" ? "Aprobada" : "Aprobada con observaciones"} por ${d.usuario_nombre} en ${d.proyeccion_nombre}${d.identica ? " · idéntica a lo aprobado" : ""}`;
  for (const g of [...d.por_gm].sort((a, b) => Math.abs(b.u) - Math.abs(a.u))) filas.push([g.nombre, g.aprobado, g.actual, g.u, pct(g.pct), `${p.anio_siguiente}`]);
  filas.push([`Total ${p.anio_siguiente}`, d.siguiente.aprobado, d.siguiente.actual, d.siguiente.u, pct(d.siguiente.pct), nota]);
  filas.push([`${p.anio_en_curso} cierre`, d.en_curso.aprobado, d.en_curso.actual, d.en_curso.u, pct(d.en_curso.pct), nota]);
  return filas;
}

function hojaMensual(e: EntradaExcelDireccion): Hoja {
  const filas: Hoja = [["FILA", "TIPO", "EXACTITUD", ...MESES, "TOTAL"]];
  const k = e.tablero.proyeccion.k;
  for (const f of e.tablero.tabla_mensual.filas) {
    const valor = f.tipo === "variacion" ? pct : numero;
    // EXACTITUD de cada fila tal cual la manda el servidor (con unidad de marca, lo real de la marca puede ser exacto y lo proyectado, estimado).
    filas.push([f.etiqueta, tipoMensual(f.tipo, { clave: f.clave, k }), f.exactitud, ...Array.from({ length: 12 }, (_, i) => valor(f.meses[i])), valor(f.total)]);
  }
  if (e.nota_mensual) filas.push(["NOTA", null, null, e.nota_mensual, ...Array.from({ length: 12 }, () => null)]);
  return filas;
}

const ROTULO_ANIO: Record<string, string> = { real: "REAL", real_parcial: "REAL PARCIAL", cierre: "CIERRE", proyectado: "PROYECTADO" };

function hojaDesglose(e: EntradaExcelDireccion): Hoja {
  const d = e.tablero.desglose;
  const anios = [...d.total.anios].sort((a, b) => a.anio - b.anio);
  const filas: Hoja = [
    ["DIMENSIÓN", "ELEMENTO", "EXACTITUD", ...anios.map((a) => `${a.anio} ${ROTULO_ANIO[a.tipo] ?? a.tipo}`), "ACUMULADO AÑO ANTERIOR", "ACUMULADO AÑO EN CURSO", "% SIGUIENTE VS CIERRE", "% SIGUIENTE VS ANTERIOR", "% CIERRE VS ANTERIOR", "% ACUMULADO", "PARTICIPACIÓN SIGUIENTE %"],
  ];
  for (const f of [...d.filas, d.total]) {
    filas.push([
      d.dimension,
      f === d.total ? "TOTAL" : f.nombre,
      f.exactitud,
      ...anios.map((a) => numero(f.anios.find((x) => x.anio === a.anio && x.tipo === a.tipo)?.total)),
      numero(f.ac_anterior),
      numero(f.ac_en_curso),
      pct(f.pct.sig_vs_cierre),
      pct(f.pct.sig_vs_anterior),
      pct(f.pct.cierre_vs_anterior),
      pct(f.pct.ac_vs_ac),
      parte(f.participacion_siguiente),
    ]);
  }
  return filas;
}

function hojaCrecimientos(e: EntradaExcelDireccion): Hoja {
  const filas: Hoja = [
    ["GÉNERO × MUNDO", "DECLARADO %", "DECLARADO", "VERSIÓN", "NOTA", "BASE REAL", "BASE CORREGIDA", "NIÑO", "SIGUIENTE MISMAS TIENDAS", "IMPLÍCITO SOBRE REAL %", "IMPLÍCITO SOBRE CORREGIDA %", "DESVÍO PP", "TENDENCIA MISMAS TIENDAS", "SEMÁFORO", "ANOMALÍAS"],
  ];
  e.tablero.crecimientos.forEach((c, i) => {
    const x = e.crecimientos[i];
    filas.push([
      c.nombre,
      pct(c.declarado_pct),
      x?.declarado ?? null,
      x?.version ?? null,
      c.nota,
      numero(c.base_real),
      numero(c.base_corregida),
      c.con_nino ? "sí" : "no",
      numero(c.siguiente_mismas),
      pct(c.implicito_sobre_real_pct),
      pct(c.implicito_sobre_corregida_pct),
      pct(c.desvio_pp),
      x?.tendencia ?? null,
      x?.semaforo ?? null,
      x?.anomalias ?? null,
    ]);
  });
  return filas;
}

function hojaDecisiones(e: EntradaExcelDireccion): Hoja {
  const filas: Hoja = [["AÑO", "TIPO", "NOMBRE", "REGISTROS", "UNIDADES", "DESDE", "HASTA"]];
  for (const d of e.tablero.decisiones) {
    for (const o of d.por_origen) filas.push([d.anio, "origen", o.etiqueta, o.n, o.u, null, null]);
    for (const a of d.autores) filas.push([d.anio, "autor", a.nombre === "" ? "(sin nombre)" : a.nombre, a.n, a.u, a.desde, a.hasta]);
    if (d.dia_pico) filas.push([d.anio, "día con más decisiones", d.dia_pico.fecha, d.dia_pico.n, null, d.dia_pico.fecha, d.dia_pico.fecha]);
  }
  return filas;
}

function hojaApoyo(e: EntradaExcelDireccion): Hoja {
  const { soles, cobertura } = e.tablero.apoyo;
  const filas: Hoja = [["DATO", "PERIODO", "VALOR", "EXACTITUD", "NOTA"]];
  const nota = "Dato de apoyo: no forma parte de lo que se aprueba";
  for (const a of soles.anios) filas.push(["Soles", String(a.anio), Math.round(a.s), a.tipo === "estimado" ? "estimado" : a.tipo === "real_parcial" ? "real (parcial)" : "real", nota]);
  filas.push(["Precio medio del recorte (soles por unidad)", `${soles.ventana.desde} a ${soles.ventana.hasta}`, soles.precio_medio === null ? null : Math.round(soles.precio_medio * 100) / 100, "real", "últimos 12 meses"]);
  filas.push(["Unidades valorizadas al precio medio del recorte", null, soles.u_sin_precio, "estimado", "pares sin venta en los últimos 12 meses"]);
  filas.push(["Stock en tiendas (unidades)", cobertura.periodo, cobertura.stock_tiendas, "real", null]);
  filas.push(["Stock en el CD (unidades)", cobertura.periodo, cobertura.stock_cd, "real", cobertura.stock_cd === null ? "no aplica con tiendas elegidas" : null]);
  filas.push(["Meses de cobertura con la venta proyectada", cobertura.periodo, pct(cobertura.imi_proyectado), "estimado", "stock ÷ venta media mensual proyectada de los 12 meses siguientes"]);
  filas.push(["Meses de cobertura con la venta real", cobertura.periodo, pct(cobertura.imi_real), "real", "stock ÷ venta media mensual real de los últimos 12 meses"]);
  for (const a of e.atribucion) filas.push(["Atribución por tienda", null, a, "estimado", null]);
  return filas;
}

function hojaAprobaciones(e: EntradaExcelDireccion): Hoja {
  const filas: Hoja = [["FECHA", "QUIÉN", "RESULTADO", "MOTIVO", "COMENTARIO", "SOBRE", "INVALIDADA"]];
  for (const h of e.historial) filas.push([h.fecha, h.quien, h.resultado, h.motivo, h.comentario, h.sobre, h.invalidada]);
  return filas;
}

function hojaFiltros(e: EntradaExcelDireccion): Hoja {
  const t = e.tablero;
  const filas: Hoja = [["FILTRO", "VALOR"]];
  for (const [k, v] of e.filtros) filas.push([k, v]);
  filas.push(["comparada", e.textos.comparada]);
  filas.push(["datos de la proyección hasta (k)", e.textos.datos_hasta]);
  filas.push(["última venta publicada (k')", e.textos.ultimo_publicado]);
  filas.push(["años del Niño", t.datos.anios_nino.length > 0 ? t.datos.anios_nino.join(", ") : "—"]);
  filas.push(["huella de cifras", t.huella]);
  filas.push(["fecha de descarga", e.textos.descargado]);
  filas.push(["exactitud", e.textos.nota_exactitud]);
  return filas;
}

/** Nombres de las hojas, en su orden (§4.9). */
export const HOJAS_DIRECCION = ["RESUMEN", "PUENTE", "ALERTAS", "FRENTE_APROBADA", "MENSUAL", "DESGLOSE", "CRECIMIENTOS", "DECISIONES", "APOYO", "APROBACIONES", "FILTROS"] as const;

/** Las once hojas del Excel del tablero, cada una con su cabecera en la primera fila. */
export function hojasDireccion(e: EntradaExcelDireccion): Record<(typeof HOJAS_DIRECCION)[number], Hoja> {
  return {
    RESUMEN: hojaResumen(e),
    PUENTE: hojaPuente(e),
    ALERTAS: hojaAlertas(e),
    FRENTE_APROBADA: hojaFrenteAprobada(e),
    MENSUAL: hojaMensual(e),
    DESGLOSE: hojaDesglose(e),
    CRECIMIENTOS: hojaCrecimientos(e),
    DECISIONES: hojaDecisiones(e),
    APOYO: hojaApoyo(e),
    APROBACIONES: hojaAprobaciones(e),
    FILTROS: hojaFiltros(e),
  };
}
