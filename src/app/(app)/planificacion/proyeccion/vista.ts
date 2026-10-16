// Lógica de vista de la pantalla de M7 (proyección anual). Pura, sin React: la prueban vitest con datos sintéticos.
// Aquí viven los textos, el estado en la URL, la lectura de lo que escribe el planner, la geometría del gráfico de
// barras, la jerarquía de la matriz y las celdas de la vista mensual. Nada de esto calcula cifras de negocio: las
// cifras vienen del servidor (la lógica de `src/lib/proyeccion/`).

import { formatearDecimal, formatearNumero, plural } from "@/lib/formato";
import { colorAnio, escalaBonita, MESES_CORTOS } from "@/lib/reportes/histograma";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import {
  RAMPA_MAX,
  RATIO_MAX,
  RATIO_MIN,
  SOLO_MATRIZ,
  type AnioFilaApi,
  type AvisoFila,
  type BloquesAnioApi,
  type BloquesApi,
  type ClaseAnioFila,
  type ColaLargaApi,
  type EstadoLinea,
  type FilaApi,
  type FilaDetalleApi,
  type FilaMensualApi,
  type NodoMatrizApi,
  type OrigenMes,
  type ProyeccionApi,
  type RespuestaLineasApi,
  type SoloMatriz,
  type TiendaBloqueApi,
  type TiendaProyeccionApi,
  type VeredictoColaLarga,
} from "@/lib/proyeccion/tipos-api";

// ─── Pestañas y estado en la URL ───

export type Pestana = "factores" | "tiendas" | "linea" | "matriz" | "mensual";

/** En el orden de trabajo de la ficha: primero los factores, después las tiendas (alimentan la base de cada línea). */
export const PESTANAS: readonly { id: Pestana; etiqueta: string }[] = [
  { id: "factores", etiqueta: "Factores del Niño" },
  { id: "tiendas", etiqueta: "Tiendas nuevas y cierres" },
  { id: "linea", etiqueta: "Por línea" },
  { id: "matriz", etiqueta: "Matriz" },
  { id: "mensual", etiqueta: "Mensual" },
];

export function esPestana(valor: unknown): valor is Pestana {
  return typeof valor === "string" && PESTANAS.some((p) => p.id === valor);
}

/** Los filtros que comparten Por línea (los tres primeros), Matriz y Mensual. Cadena vacía = sin filtro. */
export type FiltroVista = {
  genero: string;
  mundo: string;
  linea: string;
  temporada: string;
  agrupacion_estacionalidad: string;
  agrupacion_marca: string;
  solo: string;
};

export const FILTRO_VISTA_VACIO: FiltroVista = {
  genero: "",
  mundo: "",
  linea: "",
  temporada: "",
  agrupacion_estacionalidad: "",
  agrupacion_marca: "",
  solo: "",
};

export const CLAVES_FILTRO: readonly (keyof FiltroVista)[] = ["genero", "mundo", "linea", "temporada", "agrupacion_estacionalidad", "agrupacion_marca", "solo"];

const TEMPORADAS_FILTRO = ["invierno", "verano", "todo_el_ano"] as const;
const ID_VALIDO = /^[0-9A-Za-z-]{1,64}$/;

/** Lee los filtros de la URL; un valor que no corresponde (id raro, `solo` desconocido) se descarta. */
export function leerFiltro(params: { get: (k: string) => string | null }): FiltroVista {
  const id = (k: string) => {
    const v = params.get(k);
    return v !== null && ID_VALIDO.test(v) ? v : "";
  };
  const temporada = params.get("temporada");
  const solo = params.get("solo");
  return {
    genero: id("genero"),
    mundo: id("mundo"),
    linea: id("linea"),
    temporada: temporada !== null && (TEMPORADAS_FILTRO as readonly string[]).includes(temporada) ? temporada : "",
    agrupacion_estacionalidad: id("agrupacion_estacionalidad"),
    agrupacion_marca: id("agrupacion_marca"),
    solo: solo !== null && (SOLO_MATRIZ as readonly string[]).includes(solo) ? solo : "",
  };
}

/** Los filtros como query de la API (`genero` → `genero_id`…); lo vacío no se manda. */
export function filtroAQuery(f: FiltroVista, solo: readonly (keyof FiltroVista)[] = CLAVES_FILTRO): URLSearchParams {
  const q = new URLSearchParams();
  const mapa: Record<keyof FiltroVista, string> = {
    genero: "genero_id",
    mundo: "mundo_id",
    linea: "linea_id",
    temporada: "temporada",
    agrupacion_estacionalidad: "agrupacion_estacionalidad_id",
    agrupacion_marca: "agrupacion_marca_id",
    solo: "solo",
  };
  for (const k of solo) if (f[k] !== "") q.set(mapa[k], f[k]);
  return q;
}

/** ¿Hay algún filtro puesto? */
export function hayFiltro(f: FiltroVista): boolean {
  return CLAVES_FILTRO.some((k) => f[k] !== "");
}

/**
 * Aplica cambios a una query string de la URL: `null` o `""` quita el parámetro, un valor lo pone. Conserva el
 * resto y el orden en que ya estaban. Devuelve la query sin `?` (vacía si no queda nada).
 */
export function aplicarCambiosUrl(search: string, cambios: Record<string, string | null>): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  return q.toString();
}

/** Los cambios de URL que quitan todo lo que depende de la proyección abierta (al cambiar de proyección). */
export const CAMBIOS_AL_CAMBIAR_PROYECCION: Record<string, string | null> = { fila: null, tienda: null };

// ─── Fechas y formatos ───

const MESES_TEXTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

/** `2026-09-01` o `2026-09` → `2026-09`. */
export function mesAaaaMm(periodo: string): string {
  return periodo.slice(0, 7);
}

/** `2026-09-01` → 9 (el último mes cerrado `k`). */
export function indiceMes(periodo: string): number {
  return Number(periodo.slice(5, 7));
}

/** 1 a 12 → `ene` … `dic`. */
export function nombreMes(mes: number): string {
  return MESES_TEXTO[mes - 1] ?? "?";
}

/** `2026-09-01` → `set-2026`. */
export function mesAnioTexto(periodo: string): string {
  return `${nombreMes(indiceMes(periodo))}-${periodo.slice(0, 4)}`;
}

export const unidades = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : formatearNumero(Math.round(n)));

/** `+4.9 %`, `-1.9 %`, `0.0 %`; `—` si no hay valor. Siempre con punto decimal (formato compartido). */
export function formatearPct(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10 ** decimales) / 10 ** decimales;
  const texto = formatearDecimal(Math.abs(r), decimales);
  if (r === 0) return `${texto} %`;
  return `${r > 0 ? "+" : "-"}${texto} %`;
}

/** Fracción (0 a 1) como `71.3 %`. */
export function formatearAvance(fraccion: number | null | undefined): string {
  return fraccion === null || fraccion === undefined ? "—" : `${formatearDecimal(fraccion * 100, 1)} %`;
}

/** `2026-10-15T12:00:00Z` → `15/10/2026 07:00` en Lima. */
export function formatearMomento(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

// ─── Avisos ───

export type TonoAviso = "alerta" | "info";

export const TEXTO_AVISO: Record<AvisoFila, { texto: string; tono: TonoAviso }> = {
  sin_curva: { texto: "Sin curva vigente en M6: no hay propuesta ni reparto mensual. Escribe el total si lo conoces.", tono: "alerta" },
  curva_incompleta: { texto: "La curva de la agrupación está incompleta.", tono: "alerta" },
  curva_cambio: { texto: "La curva cambió: el reparto guardado usó otra versión. Revisa y aplica la curva nueva si corresponde.", tono: "alerta" },
  propuesta_cambio: { texto: "La propuesta cambió desde que decidiste; tu cifra se conservó.", tono: "alerta" },
  avance_bajo: { texto: "Con poco avance de la curva la extrapolación se desvía mucho y no hay una proyección cerrada previa que sirva de punto de partida.", tono: "alerta" },
  plan_anterior: { texto: "Con poco avance se propone el total de la última proyección cerrada; el cálculo por avance va al lado.", tono: "info" },
  sin_venta_anio: { texto: "Sin venta en el año en curso, aunque hubo venta el año anterior.", tono: "alerta" },
  sin_base: { texto: "Sin total vigente en el año en curso: no hay base para el año siguiente.", tono: "alerta" },
  sin_factor: { texto: "Hay meses del Niño sin factor calculado: se usó 1. Revisa la pestaña Factores del Niño.", tono: "alerta" },
  objetivo_atipico: { texto: "El año siguiente está marcado atípico en M6: la curva se repondera con el factor del Niño.", tono: "info" },
  temporadas_mezcladas: { texto: "El GML mezcla temporadas: el factor del Niño se pondera mes a mes.", tono: "info" },
  mes_negativo: { texto: "Un mes tenía venta neta negativa; se truncó a 0.", tono: "info" },
  quiebre: { texto: "Hay meses con quiebre de stock: la venta pudo quedar por debajo de la demanda.", tono: "info" },
  cola_larga: { texto: "Cola larga: si no la decides, se cierra con la propuesta.", tono: "info" },
  nivel_cambiado: { texto: "El nivel del nodo (GML o GMLE) cambió desde el cálculo: recalcula.", tono: "alerta" },
  bloque_cambiado: { texto: "La tienda cambió de bloque (una fecha de Tiendas); la decisión se conservó.", tono: "alerta" },
  sin_venta_esperada: { texto: "La tienda no tiene venta esperada: escribe el total o cárgala en Tiendas.", tono: "alerta" },
  sin_referente: { texto: "Sin tienda de referencia: se usa la composición promedio de las mismas tiendas.", tono: "info" },
  referente_sin_historia: { texto: "El referente no tiene doce meses cerrados: se usó el promedio de las mismas tiendas.", tono: "alerta" },
  fijadas_exceden: { texto: "Las filas fijadas a mano suman más que el total de la tienda: el resto quedó en 0.", tono: "alerta" },
  cierre_no_proyectado: { texto: "Tienda que cierra: por ahora solo se muestra su venta real; la proyección de sus meses restantes llega en una versión próxima.", tono: "info" },
  revision_cola_larga: { texto: "Cola larga con quiebres de stock: la venta pudo quedar muy por debajo de la demanda. La propuesta es la demanda corregida por disponibilidad (el avance normal va al lado) y hay que decidirla para poder cerrar.", tono: "alerta" },
  cola_larga_con_quiebres: { texto: "Cola larga con quiebres de stock, pero la demanda corregida no supera el umbral: se cierra con la propuesta.", tono: "info" },
  sin_stock_historico: { texto: "No hay stock cargado de esta fila en los últimos doce meses: no se pudo medir la disponibilidad y se trata como cola larga normal.", tono: "info" },
  apertura_tardia: { texto: "La venta esperada cubre menos de un cuarto de un año maduro (la tienda abre tarde en el año o tiene una rampa muy baja): revisa la cifra.", tono: "info" },
  cifra_excesiva: { texto: "Una cifra del método salió fuera de rango (por ejemplo, una venta esperada que cubre casi nada del año): no se propone nada; escribe el total o revisa la venta esperada y la fecha de apertura en Tiendas.", tono: "alerta" },
  apertura_dudosa: { texto: "La tienda no vendió en un mes en que debía estar abierta: si abrió después, corrige la fecha de apertura en Tiendas.", tono: "alerta" },
  cierre_dudoso: { texto: "La tienda vendió después de su fecha de cierre o dejó de vender antes: revisa la fecha de cierre en Tiendas.", tono: "alerta" },
};

export function textoAviso(a: AvisoFila): string {
  return TEXTO_AVISO[a]?.texto ?? a;
}

export function tonoAviso(a: AvisoFila): TonoAviso {
  return TEXTO_AVISO[a]?.tono ?? "info";
}

/** Avisos únicos de una fila y sus registros, los de alerta primero. */
export function avisosDeFila(f: Pick<FilaApi, "avisos" | "anios">): AvisoFila[] {
  const todos = [...new Set<AvisoFila>([...f.avisos, ...f.anios.flatMap((a) => a.avisos)])];
  return todos.sort((a, b) => (tonoAviso(a) === tonoAviso(b) ? 0 : tonoAviso(a) === "alerta" ? -1 : 1));
}

// ─── Errores de la API: qué acción ofrecer ───

export type AccionError = "recalcular" | "recargar" | null;

/**
 * Los `409` con código de M7 y lo que se puede hacer: si se publicó un mes a mitad del cálculo, volver a calcular;
 * si hay un cálculo en marcha o la proyección cambió de estado, volver a leer.
 */
export function accionParaCodigo(codigo: string | null): AccionError {
  switch (codigo) {
    case "datos_cambiaron":
      return "recalcular";
    case "calculo_en_curso":
    case "cerrada":
    case "ya_cerrada":
    case "fila_inactiva":
      return "recargar";
    default:
      return null;
  }
}

export const ETIQUETA_ACCION: Record<Exclude<AccionError, null>, string> = {
  recalcular: "Calcular de nuevo",
  recargar: "Actualizar pantalla",
};

// ─── Estado de la línea ───

export const ETIQUETA_ESTADO_LINEA: Record<EstadoLinea, string> = {
  sin_proyectar: "Sin proyectar",
  parcial: "Parcial",
  proyectada: "Proyectada",
  curva_cambio: "La curva cambió",
  propuesta_cambio: "La propuesta cambió",
};

export const TONO_ESTADO_LINEA: Record<EstadoLinea, "neutro" | "marca" | "exito" | "alerta"> = {
  sin_proyectar: "neutro",
  parcial: "marca",
  proyectada: "exito",
  curva_cambio: "alerta",
  propuesta_cambio: "alerta",
};

export const ETIQUETA_SOLO: Record<SoloMatriz, string> = {
  con_tiendas_nuevas: "Con tiendas nuevas",
  sin_proyectar: "Sin proyectar",
  parciales: "Parciales",
  curva_cambio: "La curva cambió",
  propuesta_cambio: "La propuesta cambió",
  cola_larga: "Cola larga",
  para_revision: "Para revisión",
};

export const ETIQUETA_TEMPORADA_FILTRO: Record<string, string> = { invierno: "Invierno", verano: "Verano", todo_el_ano: "Toda temporada" };

// ─── Cabecera de la proyección ───

const codigos = (ts: readonly TiendaBloqueApi[], max = 6): string => {
  if (ts.length === 0) return "—";
  const c = ts.map((t) => t.codigo);
  return c.length <= max ? c.join(", ") : `${c[0]} … ${c[c.length - 1]}`;
};

/** Los bloques de un año como frases: `{ mismas: "9 mismas tiendas", nuevas…: "1 nueva del año anterior (T10)" … }`. */
export function resumenBloquesAnio(b: BloquesAnioApi | undefined) {
  const mismas = b?.mismas ?? [];
  const nuevas = b?.nuevas ?? [];
  const cierres = b?.cierres ?? [];
  const anterior = nuevas.filter((t) => t.subbloque === "nuevas_anterior");
  const aperturas = nuevas.filter((t) => t.subbloque !== "nuevas_anterior");
  return {
    mismas,
    anterior,
    aperturas,
    cierres,
    texto: {
      mismas: `${plural(mismas.length, "misma tienda", "mismas tiendas")}`,
      anterior: anterior.length > 0 ? `${plural(anterior.length, "nueva del año anterior", "nuevas del año anterior")} (${codigos(anterior)})` : null,
      aperturas: aperturas.length > 0 ? `${plural(aperturas.length, "apertura", "aperturas")} (${codigos(aperturas)})` : null,
      cierres: cierres.length > 0 ? `${plural(cierres.length, "cierre", "cierres")} (${codigos(cierres)})` : null,
    },
  };
}

/** Las piezas de la línea de cabecera del Paso 0 (se unen con " · "). */
export function resumenCabecera(p: ProyeccionApi): string[] {
  const y = p.anio_en_curso;
  const piezas: string[] = [p.nombre, `datos hasta ${mesAaaaMm(p.hasta_periodo)}`];
  for (const anio of [y, y + 1]) {
    const r = resumenBloquesAnio(p.bloques?.[anio]);
    const partes = [r.texto.mismas, r.texto.anterior, r.texto.aperturas, r.texto.cierres].filter((x): x is string => x !== null);
    piezas.push(`${anio}: ${partes.join(", ")}`);
  }
  const res = p.resumen;
  if (res) {
    piezas.push(`${plural(res.filas, "fila", "filas")}: ${formatearNumero(res.decididas?.[y] ?? 0)} decididas en ${y}, ${formatearNumero(res.decididas?.[y + 1] ?? 0)} en ${y + 1}`);
    if ((res.filas_para_revision ?? 0) > 0) piezas.push(textoParaRevision(res.filas_para_revision ?? 0));
    if (res.desvio_prueba_anterior_pct !== null && res.desvio_prueba_anterior_pct !== undefined) {
      piezas.push(`en ${y - 1} el método se desvió ${formatearPct(res.desvio_prueba_anterior_pct)} (dentro de muestra)`);
    }
  }
  return piezas;
}

/** ¿La pantalla puede editar? Solo una proyección en trabajo, y no mientras se calcula. */
export function puedeEditar(p: Pick<ProyeccionApi, "estado" | "calculando"> | null, calculandoLocal = false): boolean {
  return p !== null && p.estado === "en_trabajo" && !p.calculando && !calculandoLocal;
}

/** Todas las tiendas de todos los bloques de un año (para la hoja de composición). */
export function tiendasDeBloques(b: BloquesApi, anio: number): { bloque: "mismas" | "nuevas" | "cierres" | "fuera"; tienda: TiendaBloqueApi }[] {
  const x = b[anio];
  if (!x) return [];
  return (["mismas", "nuevas", "cierres", "fuera"] as const).flatMap((bloque) => x[bloque].map((tienda) => ({ bloque, tienda })));
}

// ─── Lo que escribe el planner ───

export type LecturaNumero = { ok: true; valor: number } | { ok: false; motivo: string };

/** Entero no negativo. Acepta espacios y comas de miles bien puestas (`17,504`); rechaza decimales. */
export function leerEntero(texto: string): LecturaNumero {
  const t = texto.trim().replace(/\s+/g, "");
  if (t === "") return { ok: false, motivo: "Escribe un número." };
  const limpio = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t;
  if (!/^\d+$/.test(limpio)) return { ok: false, motivo: "El total debe ser un número entero, sin decimales." };
  const n = Number(limpio);
  if (!Number.isSafeInteger(n)) return { ok: false, motivo: "El número es demasiado grande." };
  return { ok: true, valor: n };
}

/** Porcentaje de crecimiento entre -95 y 500; acepta coma o punto decimal. */
export function leerPorcentaje(texto: string): LecturaNumero {
  const t = texto.trim().replace(",", ".");
  if (t === "") return { ok: false, motivo: "Escribe un porcentaje." };
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return { ok: false, motivo: "El crecimiento debe ser un número." };
  const n = Number(t);
  if (n < -95) return { ok: false, motivo: "El crecimiento no puede ser menor que -95 %." };
  if (n > 500) return { ok: false, motivo: "El crecimiento no puede ser mayor que 500 %." };
  return { ok: true, valor: n };
}

/** Factor del Niño: mayor que 0.05 y como máximo 3; coma o punto decimal. Vacío = «usar el calculado» (`null`). */
export function leerFactor(texto: string): { ok: true; valor: number | null } | { ok: false; motivo: string } {
  const t = texto.trim().replace(",", ".");
  if (t === "") return { ok: true, valor: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, motivo: "El factor debe ser un número." };
  const n = Number(t);
  if (n <= RATIO_MIN) return { ok: false, motivo: `El factor debe ser mayor que ${RATIO_MIN}.` };
  if (n > RATIO_MAX) return { ok: false, motivo: `El factor no puede superar ${RATIO_MAX}.` };
  return { ok: true, valor: n };
}

/** Rampa de maduración: de 1 a 6 valores en (0, 5]. Las casillas vacías se ignoran (de derecha a izquierda). */
export function leerRampa(textos: readonly string[]): { ok: true; valor: number[] } | { ok: false; motivo: string } {
  const valores: number[] = [];
  for (const t of textos.map((x) => x.trim().replace(",", "."))) {
    if (t === "") continue;
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, motivo: "Cada valor de la rampa debe ser un número." };
    const n = Number(t);
    if (n <= 0) return { ok: false, motivo: "Cada valor de la rampa debe ser mayor que 0." };
    if (n > RAMPA_MAX) return { ok: false, motivo: `Cada valor de la rampa debe ser como máximo ${RAMPA_MAX}.` };
    valores.push(n);
  }
  if (valores.length === 0) return { ok: false, motivo: "La rampa necesita al menos un valor." };
  return { ok: true, valor: valores };
}

/** `[1, 1, 1]` → `1 · 1 · 1`; `[0.7, 0.85, 1]` → `0.7 · 0.85 · 1`. */
export function textoRampa(rampa: readonly number[]): string {
  return rampa.map((v) => formatearDecimal(v, Number.isInteger(v) ? 0 : 2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")).join(" · ");
}

/** El mínimo que se puede decidir: en el año en curso, lo ya vendido; en el siguiente, 0. */
export function minimoDecision(anio: number, anioEnCurso: number, vendido: number): number {
  return anio === anioEnCurso ? vendido : 0;
}

/** Motivo por el que una cifra no se puede enviar (antes de llamar a la API), o `null`. */
export function motivoCifraInvalida(texto: string, minimo: number): string | null {
  const l = leerEntero(texto);
  if (!l.ok) return l.motivo;
  if (l.valor < minimo) return `En el año en curso el mínimo es lo ya vendido (${formatearNumero(minimo)}).`;
  return null;
}

// ─── Cerrar ───

/** Lo que resume el diálogo de cierre: filas decididas y sin decidir por año, cola larga, cambios pendientes y motivos. */
export function lineasDeCierre(p: Pick<ProyeccionApi, "anio_en_curso" | "resumen" | "desactualizada">): string[] {
  const y = p.anio_en_curso;
  const r = p.resumen;
  const lineas: string[] = [];
  if (r) {
    for (const anio of [y, y + 1]) {
      const total = r.filas_por_anio?.[anio] ?? r.filas;
      const dec = r.decididas?.[anio] ?? 0;
      lineas.push(`${anio}: ${plural(dec, "fila decidida", "filas decididas")} y ${plural(Math.max(0, total - dec), "sin decidir", "sin decidir")}`);
    }
    if ((r.filas_para_revision ?? 0) > 0) lineas.push(`${textoParaRevision(r.filas_para_revision ?? 0)}: cola larga con quiebres de stock; hay que decidirlas para cerrar`);
    const cola = r.avisos?.cola_larga ?? 0;
    if (cola > 0) lineas.push(cola === 1 ? "1 registro de cola larga se cerrará con la propuesta" : `${formatearNumero(cola)} registros de cola larga se cerrarán con la propuesta`);
    const curva = r.avisos?.curva_cambio ?? 0;
    if (curva > 0) lineas.push(curva === 1 ? "1 registro con la curva nueva sin aplicar (se cierra con el reparto guardado)" : `${formatearNumero(curva)} registros con la curva nueva sin aplicar (se cierran con el reparto guardado)`);
    const cambio = r.avisos?.propuesta_cambio ?? 0;
    if (cambio > 0) lineas.push(cambio === 1 ? "1 decisión con la propuesta distinta (se cierra con tu cifra)" : `${formatearNumero(cambio)} decisiones con la propuesta distinta (se cierran con tu cifra)`);
  }
  if (p.desactualizada.length > 0) lineas.push(`Desactualizada: ${p.desactualizada.map(textoMotivoDesactualizada).join("; ")}`);
  return lineas;
}

/** Máximo de filas sin decidir que lista el diálogo de cierre (el resto se cuenta). */
export const MAX_SIN_DECIDIR = 50;

export type ItemSinDecidir = { clave?: string; anio?: number; propuesto?: number | null; motivo?: "umbral" | "revision_cola_larga"; demanda_corregida?: number | null; disponibilidad?: number | null; genero?: string | null; mundo?: string | null; linea?: string | null; agrupacion_marca?: string | null; equivalencia?: string | null; nombre?: string };

/** `1 fila para revisión` / `12 filas para revisión`. */
export function textoParaRevision(n: number): string {
  return plural(n, "fila para revisión", "filas para revisión");
}

/** Motivo de «desactualizada» en palabras: el del método nuevo se explica aparte; el resto, tal como lo dice el servidor. */
export function textoMotivoDesactualizada(m: { codigo: string; mensaje: string }): string {
  if (m.codigo === "version_metodo") return "El método de cálculo cambió (método nuevo): recalcula para aplicarlo. Tus decisiones se conservan.";
  return m.mensaje;
}

/** Nombre legible de una fila sin decidir: el que mande el servidor o, si solo hay `clave`, una forma corta para no dejar la fila anónima. */
export function nombreFilaSinDecidir(i: ItemSinDecidir): string {
  if (i.nombre) return i.nombre;
  const arbol = [i.genero, i.mundo, i.linea].filter(Boolean).join(" · ");
  if (arbol) return [arbol, i.equivalencia, i.agrupacion_marca].filter(Boolean).join(" · ");
  const partes = (i.clave ?? "").split("|");
  return partes.length >= 2 && partes[1] ? `Fila ${partes[1].slice(0, 8)}${partes[3] ? ` · ${partes[3].slice(0, 8)}` : ""}` : "Fila sin nombre";
}

export type GrupoSinDecidir = { lineas: string[]; total: number };

/**
 * Las filas sin decidir de un `409 filas_sin_decidir`, legibles y separadas por motivo: las de propuesta mayor o igual al
 * umbral de cola larga y las «para revisión» (cola larga con quiebres), estas con su demanda corregida y disponibilidad. Cada
 * grupo lista hasta `MAX_SIN_DECIDIR` (las de mayor propuesta) y lleva su total.
 */
export function listaSinDecidir(detalle: Record<string, unknown> | null | undefined): { umbral: GrupoSinDecidir; revision: GrupoSinDecidir } | null {
  const crudo = detalle?.filas_sin_decidir;
  if (!Array.isArray(crudo) || crudo.length === 0) return null;
  const items = crudo as ItemSinDecidir[];
  const esRevision = (i: ItemSinDecidir) => i.motivo === "revision_cola_larga";
  /** Una línea por FILA (no por año): sus años van juntos, para que el conteo sea de filas. */
  const porFila = (xs: ItemSinDecidir[]): { propuesta: number; texto: string }[] => {
    const grupos = new Map<string, ItemSinDecidir[]>();
    xs.forEach((i, n) => grupos.set(i.clave ?? `#${n}`, [...(grupos.get(i.clave ?? `#${n}`) ?? []), i]));
    return [...grupos.values()].map((g) => {
      const ordenados = g.slice().sort((a, b) => (a.anio ?? 0) - (b.anio ?? 0));
      const anios = ordenados.map((i) => `${i.anio ?? "—"}: ${unidades(i.propuesto)}`).join(" · ");
      const rev = ordenados.find((i) => esRevision(i) && (i.demanda_corregida != null || i.disponibilidad != null));
      const extra = rev ? [rev.demanda_corregida == null ? null : `demanda corregida ${unidades(rev.demanda_corregida)}`, rev.disponibilidad == null ? null : `disponibilidad ${formatearAvance(rev.disponibilidad)}`].filter(Boolean) : [];
      return { propuesta: Math.max(...ordenados.map((i) => i.propuesto ?? 0)), texto: `${nombreFilaSinDecidir(ordenados[0])} · propuesta ${anios}${extra.length > 0 ? ` (${extra.join(" · ")})` : ""}` };
    });
  };
  const deRevision = porFila(items.filter(esRevision)).sort((a, b) => b.propuesta - a.propuesta);
  const deUmbral = porFila(items.filter((i) => !esRevision(i))).sort((a, b) => b.propuesta - a.propuesta);
  const totalRevision = typeof detalle?.total_filas_para_revision === "number" ? detalle.total_filas_para_revision : 0;
  const totalTodas = typeof detalle?.total_filas_sin_decidir === "number" ? detalle.total_filas_sin_decidir : 0;
  return {
    umbral: { total: Math.max(deUmbral.length, totalTodas - totalRevision), lineas: deUmbral.slice(0, MAX_SIN_DECIDIR).map((x) => x.texto) },
    revision: { total: Math.max(deRevision.length, totalRevision), lineas: deRevision.slice(0, MAX_SIN_DECIDIR).map((x) => x.texto) },
  };
}

/** Las tiendas nuevas sin decidir de un `409 tiendas_sin_decidir`, con su código de los bloques de la proyección. */
export function listaTiendasSinDecidir(detalle: Record<string, unknown> | null | undefined, bloques: BloquesApi): string[] | null {
  const crudo = detalle?.tiendas_sin_decidir;
  if (!Array.isArray(crudo) || crudo.length === 0) return null;
  return (crudo as { tienda_id: string; anio: number }[]).map((t) => {
    const hallada = (["nuevas", "mismas", "cierres"] as const).flatMap((b) => bloques[t.anio]?.[b] ?? []).find((x) => x.tienda_id === t.tienda_id);
    return `${hallada ? `${hallada.codigo} · ${hallada.nombre}` : "Tienda nueva"} · ${t.anio}`;
  });
}

/** La tendencia del último año completo como referencia del crecimiento; `null` si el dato no está disponible. */
export function textoTendencia(pct: number | null | undefined, anioEnCurso: number): string | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return `Referencia: la tendencia de ${anioEnCurso - 1} frente a ${anioEnCurso - 2} fue ${formatearPct(pct)}.`;
}

// ─── Cola larga con disponibilidad (0.10.1) ───

export const ETIQUETA_VEREDICTO: Record<VeredictoColaLarga, string> = {
  cierra: "Sin quiebre relevante: se cierra con la propuesta",
  cierra_con_quiebres: "Con quiebres, pero la demanda corregida no supera el umbral: se cierra con la propuesta",
  revision: "Para revisión: hay que decidirla para cerrar",
  sin_dato: "Sin stock cargado: no se pudo medir la disponibilidad",
};

/** El aviso que acompaña a una fila de cola larga: una línea que solo llevan algunas tiendas sale con disponibilidad baja y `A_f` inflada. */
export const ADVERTENCIA_SURTIDO_PARCIAL =
  "Ojo: si esta línea la llevan solo algunas tiendas, la disponibilidad sale baja (una tienda sin stock no siempre es un quiebre) y la demanda corregida queda inflada. Contrástala con el avance normal antes de decidir.";

/** Texto corto de la validación de una fila para la tabla; `null` si no hay nada que decir (cierra sin quiebres o sin dato). */
export function resumenColaLarga(c: ColaLargaApi | null | undefined): string | null {
  if (!c || c.veredicto === "cierra" || c.veredicto === "sin_dato") return null;
  const partes = [c.veredicto === "revision" ? "Para revisión" : "Cola larga con quiebres"];
  if (c.disponibilidad !== null) partes.push(`disponibilidad ${formatearAvance(c.disponibilidad)}`);
  if (c.demanda_corregida !== null) partes.push(`corregida ${unidades(c.demanda_corregida)}`);
  return partes.join(" · ");
}

/** Las cifras de la validación de disponibilidad, rotuladas, para el detalle. */
export function datosColaLarga(c: ColaLargaApi): { rotulo: string; valor: string }[] {
  return [
    { rotulo: "Disponibilidad", valor: formatearAvance(c.disponibilidad) },
    { rotulo: "Tienda-meses con stock", valor: `${formatearNumero(c.tienda_meses_con_stock)} de ${formatearNumero(c.tienda_meses)}` },
    { rotulo: "Ritmo (u por tienda-mes con stock)", valor: c.ritmo === null ? "—" : formatearDecimal(c.ritmo, 1) },
    { rotulo: "Meses sin stock en ninguna tienda", valor: formatearNumero(c.meses_tiendas_sin_stock) },
    { rotulo: "Venta corregida (A_f)", valor: c.demanda_corregida === null ? "—" : formatearDecimal(c.demanda_corregida, 1) },
  ];
}

/** ¿La fila está para revisión? (aviso del registro o de la fila). */
export function esParaRevision(f: Pick<FilaApi, "avisos" | "anios">): boolean {
  return f.avisos.includes("revision_cola_larga") || f.anios.some((a) => a.avisos.includes("revision_cola_larga"));
}

/** Umbral de disponibilidad: número de 0 a 1 (coma o punto decimal). */
export function leerUmbralDisponibilidad(texto: string): LecturaNumero {
  const t = texto.trim().replace(",", ".");
  if (t === "") return { ok: false, motivo: "Escribe el umbral de disponibilidad (entre 0 y 1)." };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, motivo: "El umbral de disponibilidad debe ser un número." };
  const n = Number(t);
  if (n > 1) return { ok: false, motivo: "El umbral de disponibilidad debe estar entre 0 y 1." };
  return { ok: true, valor: n };
}

// ─── Gráfico de barras por año (Parte 1) ───

export type BarraAnual = {
  anio: number;
  tipo: "historico" | "en_curso" | "siguiente";
  /** Unidades reales (el vendido a la fecha en el año en curso). */
  real: number;
  /** Resto proyectado del año en curso (vigente − vendido). */
  resto: number;
  /** Total del año siguiente. */
  siguiente: number;
  total: number;
  /** Tiendas de `M(año)`; `null` si no se sabe. */
  tiendas: number | null;
  clase: ClaseAnioFila | null;
};

const vigenteDeRegistro = (a: AnioFilaApi | undefined): number => a?.vigente ?? a?.decidido ?? a?.propuesto ?? 0;

/**
 * Una barra por año: histórico real de `M(año)`, el año en curso (vendido + resto) y el siguiente. Cada año con su
 * propia red de mismas tiendas (la cuenta sale de `historico_linea` o, para el año siguiente, de los bloques).
 */
export function construirBarras(args: {
  anioEnCurso: number;
  lineas: Pick<RespuestaLineasApi, "filas" | "historico_linea" | "totales_por_anio">;
  bloques?: BloquesApi;
}): BarraAnual[] {
  const y = args.anioEnCurso;
  const { filas, historico_linea: hist, totales_por_anio: tot } = args.lineas;
  const base = filas.filter((f) => f.tienda_id === null && f.activo);
  const tiendasDe = (anio: number) => hist.find((h) => h.anio === anio)?.tiendas ?? args.bloques?.[anio]?.mismas.length ?? null;
  const barras: BarraAnual[] = [];

  for (const h of [...hist].filter((x) => x.anio < y).sort((a, b) => a.anio - b.anio)) {
    barras.push({ anio: h.anio, tipo: "historico", real: h.unidades, resto: 0, siguiente: 0, total: h.unidades, tiendas: h.tiendas, clase: h.clase });
  }

  const vendido = base.length > 0 ? base.reduce((s, f) => s + (f.anios.find((a) => a.anio === y)?.vendido ?? 0), 0) : (hist.find((h) => h.anio === y)?.unidades ?? 0);
  const totalY = tot.find((t) => t.anio === y)?.vigente ?? base.reduce((s, f) => s + vigenteDeRegistro(f.anios.find((a) => a.anio === y)), 0);
  const resto = Math.max(0, totalY - vendido);
  barras.push({ anio: y, tipo: "en_curso", real: vendido, resto, siguiente: 0, total: vendido + resto, tiendas: tiendasDe(y), clase: hist.find((h) => h.anio === y)?.clase ?? null });

  const totalSig = tot.find((t) => t.anio === y + 1)?.vigente ?? base.reduce((s, f) => s + vigenteDeRegistro(f.anios.find((a) => a.anio === y + 1)), 0);
  barras.push({ anio: y + 1, tipo: "siguiente", real: 0, resto: 0, siguiente: totalSig, total: totalSig, tiendas: tiendasDe(y + 1), clase: null });
  return barras;
}

export type SegmentoBarra = { tipo: "real" | "resto" | "siguiente"; x: number; y: number; ancho: number; alto: number; valor: number };
export type BarraGeom = {
  anio: number;
  tipo: BarraAnual["tipo"];
  x: number;
  ancho: number;
  segmentos: SegmentoBarra[];
  total: number;
  yTotal: number;
  /** `34,100` o `31,980 + 12,874` en el año en curso. */
  etiquetaTotal: string;
  tiendas: number | null;
  clase: ClaseAnioFila | null;
  aria: string;
};
export type GeometriaBarras = {
  ancho: number;
  alto: number;
  area: { x: number; y: number; ancho: number; alto: number };
  ticksY: { valor: number; y: number; etiqueta: string }[];
  barras: BarraGeom[];
  /** Franja de fondo en los años atípicos (Niño). */
  bandasNino: { anio: number; x: number; ancho: number }[];
};

/** Posiciones del gráfico de barras en un `viewBox`. Pura. */
export function geometriaBarras(barras: readonly BarraAnual[], dim: { ancho?: number; alto?: number } = {}): GeometriaBarras {
  const ancho = dim.ancho ?? 720;
  const alto = dim.alto ?? 300;
  const margen = { sup: 26, der: 16, inf: 52, izq: 60 };
  const area = { x: margen.izq, y: margen.sup, ancho: ancho - margen.izq - margen.der, alto: alto - margen.sup - margen.inf };
  const escala = escalaBonita(0, Math.max(0, ...barras.map((b) => b.total)), 5, true);
  const rango = escala.max - escala.min || 1;
  const yDe = (v: number) => area.y + area.alto - ((v - escala.min) / rango) * area.alto;
  const banda = barras.length > 0 ? area.ancho / barras.length : area.ancho;
  const anchoBarra = Math.min(72, banda * 0.6);

  const geoms: BarraGeom[] = barras.map((b, i) => {
    const x = area.x + banda * i + (banda - anchoBarra) / 2;
    const segmentos: SegmentoBarra[] = [];
    let acumulado = 0;
    const partes: { tipo: SegmentoBarra["tipo"]; valor: number }[] = [
      { tipo: "real", valor: b.real },
      { tipo: "resto", valor: b.resto },
      { tipo: "siguiente", valor: b.siguiente },
    ];
    for (const p of partes) {
      if (p.valor <= 0) continue;
      const yArriba = yDe(acumulado + p.valor);
      const yAbajo = yDe(acumulado);
      segmentos.push({ tipo: p.tipo, x, y: yArriba, ancho: anchoBarra, alto: Math.max(0, yAbajo - yArriba), valor: p.valor });
      acumulado += p.valor;
    }
    const etiquetaTotal = b.tipo === "en_curso" && b.resto > 0 ? `${unidades(b.real)} + ${unidades(b.resto)}` : unidades(b.total);
    const que = b.tipo === "historico" ? "real" : b.tipo === "en_curso" ? `vendido ${unidades(b.real)} más resto proyectado ${unidades(b.resto)}` : "proyección del año siguiente";
    return {
      anio: b.anio,
      tipo: b.tipo,
      x,
      ancho: anchoBarra,
      segmentos,
      total: b.total,
      yTotal: yDe(b.total),
      etiquetaTotal,
      tiendas: b.tiendas,
      clase: b.clase,
      aria: `${b.anio}: ${unidades(b.total)} unidades (${que})${b.tiendas !== null ? `, ${plural(b.tiendas, "tienda", "tiendas")} en la base` : ""}${b.clase === "atipico" ? ", año del Niño" : ""}`,
    };
  });

  return {
    ancho,
    alto,
    area,
    ticksY: escala.ticks.map((valor) => ({ valor, y: yDe(valor), etiqueta: formatearNumero(valor) })),
    barras: geoms,
    bandasNino: barras.flatMap((b, i) => (b.clase === "atipico" ? [{ anio: b.anio, x: area.x + banda * i, ancho: banda }] : [])),
  };
}

// ─── Parte 1: tabla y línea ───

/** Línea elegida: los tres ids del filtro coinciden con una entrada del índice. */
export function lineaElegida<T extends { genero_id: string; mundo_id: string; linea_id: string }>(indice: readonly T[], f: FiltroVista): T | null {
  if (f.genero === "" || f.mundo === "" || f.linea === "") return null;
  return indice.find((i) => i.genero_id === f.genero && i.mundo_id === f.mundo && i.linea_id === f.linea) ?? null;
}

/** El índice recortado por género, mundo y texto (el buscador acepta "DENIM"). */
export function filtrarIndice<T extends { genero_id: string; mundo_id: string; genero: string; mundo: string; linea: string }>(indice: readonly T[], f: Pick<FiltroVista, "genero" | "mundo">, q: string): T[] {
  const consulta = q.trim().toUpperCase();
  return indice.filter((i) => {
    if (f.genero !== "" && i.genero_id !== f.genero) return false;
    if (f.mundo !== "" && i.mundo_id !== f.mundo) return false;
    if (consulta !== "" && !`${i.genero} ${i.mundo} ${i.linea}`.toUpperCase().includes(consulta)) return false;
    return true;
  });
}

/** Opciones de los tres `Select` en cascada, sacadas del índice de líneas. */
export function opcionesLineas<T extends { genero_id: string; mundo_id: string; linea_id: string; genero: string; mundo: string; linea: string }>(indice: readonly T[], f: Pick<FiltroVista, "genero" | "mundo">) {
  const ordenar = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");
  const generos = new Map<string, string>();
  const mundos = new Map<string, string>();
  const lineas: { clave: string; genero_id: string; mundo_id: string; linea_id: string; nombre: string; completo: string }[] = [];
  for (const i of indice) {
    generos.set(i.genero_id, i.genero);
    if (f.genero !== "" && i.genero_id !== f.genero) continue;
    mundos.set(i.mundo_id, i.mundo);
    if (f.mundo !== "" && i.mundo_id !== f.mundo) continue;
    lineas.push({ clave: `${i.genero_id}|${i.mundo_id}|${i.linea_id}`, genero_id: i.genero_id, mundo_id: i.mundo_id, linea_id: i.linea_id, nombre: i.linea, completo: `${i.genero} · ${i.mundo} · ${i.linea}` });
  }
  return {
    generos: [...generos].map(([id, nombre]) => ({ id, nombre })).sort(ordenar),
    mundos: [...mundos].map(([id, nombre]) => ({ id, nombre })).sort(ordenar),
    lineas: lineas.sort((a, b) => a.completo.localeCompare(b.completo, "es")),
  };
}

/** La línea anterior y la siguiente en el orden del índice visible (para avanzar en orden). */
export function vecinas<T extends { genero_id: string; mundo_id: string; linea_id: string }>(visibles: readonly T[], actual: T | null): { anterior: T | null; siguiente: T | null } {
  if (!actual) return { anterior: null, siguiente: null };
  const i = visibles.findIndex((x) => x.genero_id === actual.genero_id && x.mundo_id === actual.mundo_id && x.linea_id === actual.linea_id);
  if (i < 0) return { anterior: null, siguiente: null };
  return { anterior: visibles[i - 1] ?? null, siguiente: visibles[i + 1] ?? null };
}

export const registroDe = (f: Pick<FilaApi, "anios">, anio: number): AnioFilaApi | undefined => f.anios.find((a) => a.anio === anio);

/** Unidades históricas de la fila en un año (`historico_anual`), sin los años desde el año en curso. */
export function historicoDe(f: Pick<FilaApi, "historico_anual">, anio: number): number | null {
  return f.historico_anual.find((h) => h.anio === anio)?.unidades ?? null;
}

/** Años históricos que muestra la tabla de la línea (los tres anteriores al año en curso). */
export function aniosHistoricos(anioEnCurso: number): number[] {
  return [anioEnCurso - 3, anioEnCurso - 2, anioEnCurso - 1];
}

export type TotalesLinea = { vendido: number; propuesto: number; vigente: number; decididas: number; filas: number };

/** Totales de la línea para un año: salen del servidor (`totales_por_anio`) y el vendido, de las filas. */
export function totalesDeLinea(lineas: Pick<RespuestaLineasApi, "filas" | "totales_por_anio">, anio: number): TotalesLinea {
  const t = lineas.totales_por_anio.find((x) => x.anio === anio);
  const base = lineas.filas.filter((f) => f.tienda_id === null && f.activo);
  return {
    vendido: base.reduce((s, f) => s + (registroDe(f, anio)?.vendido ?? 0), 0),
    propuesto: t?.propuesto ?? base.reduce((s, f) => s + (registroDe(f, anio)?.propuesto ?? 0), 0),
    vigente: t?.vigente ?? base.reduce((s, f) => s + vigenteDeRegistro(registroDe(f, anio)), 0),
    decididas: t?.decididas ?? base.filter((f) => registroDe(f, anio)?.decidido != null).length,
    filas: t?.filas ?? base.length,
  };
}

/** Las tiendas nuevas del año en curso que pasan a mismas tiendas del siguiente y siguen sin decidir (B2). */
export function tiendasSinDecidirQueAlimentan(lineas: Pick<RespuestaLineasApi, "tiendas_linea">, anioEnCurso: number): string[] {
  return [...new Set(lineas.tiendas_linea.filter((t) => t.anio === anioEnCurso && t.bloque === "nuevas" && t.subbloque === "nuevas_anterior" && !t.decidida).map((t) => t.tienda))];
}

/** Resumen de las tiendas de la línea para un año, en una frase corta. */
export function resumenTiendasLinea(lineas: Pick<RespuestaLineasApi, "tiendas_linea">, anio: number): string[] {
  const partes: string[] = [];
  const delAnio = lineas.tiendas_linea.filter((t) => t.anio === anio);
  const nuevas = delAnio.filter((t) => t.bloque === "nuevas" && t.subbloque === "nuevas_anterior");
  const aperturas = delAnio.filter((t) => t.bloque === "nuevas" && t.subbloque !== "nuevas_anterior");
  const cierres = delAnio.filter((t) => t.bloque === "cierres");
  const texto = (rotulo: string, ts: typeof delAnio) => {
    if (ts.length === 0) return `${rotulo}: —`;
    return `${rotulo} (${ts.map((t) => t.tienda).join(", ")}): ${ts.some((t) => t.vendido > 0) ? `vendido ${unidades(ts.reduce((s, t) => s + t.vendido, 0))} · ` : ""}vigente ${unidades(ts.reduce((s, t) => s + (t.vigente ?? 0), 0))}${ts.every((t) => t.decidida) ? " (decidida)" : ""}`;
  };
  partes.push(texto(`Nuevas del año anterior ${anio}`, nuevas), texto(`Aperturas ${anio}`, aperturas), texto(`Cierres ${anio}`, cierres));
  return partes;
}

/** Cabecera del CSV de la línea. */
export function cabeceraCsvLinea(anioEnCurso: number): string[] {
  return [
    "AGRUPACION_MARCA",
    "EQUIVALENCIA",
    ...aniosHistoricos(anioEnCurso).map(String),
    `VENDIDO_${anioEnCurso}`,
    "AVANCE_%",
    `PROPUESTO_${anioEnCurso}`,
    `DECIDIDO_${anioEnCurso}`,
    "CRECIMIENTO_%",
    `PROPUESTO_${anioEnCurso + 1}`,
    `DECIDIDO_${anioEnCurso + 1}`,
  ];
}

/** Una fila de CSV por fila base de la línea (lo que se ve en la tabla); lo no decidido va vacío. */
export function filasCsvLinea(filas: readonly FilaApi[], anioEnCurso: number): (string | number)[][] {
  const y = anioEnCurso;
  return filas
    .filter((f) => f.tienda_id === null && f.activo)
    .map((f) => {
      const rY = registroDe(f, y);
      const rS = registroDe(f, y + 1);
      return [
        f.agrupacion_marca,
        f.equivalencia ?? "",
        ...aniosHistoricos(y).map((h) => historicoDe(f, h) ?? ""),
        rY?.vendido ?? "",
        rY?.avance === null || rY?.avance === undefined ? "" : Math.round(rY.avance * 1000) / 10,
        rY?.propuesto ?? "",
        rY?.decidido ?? "",
        rS?.crecimiento_pct ?? "",
        rS?.propuesto ?? "",
        rS?.decidido ?? "",
      ];
    });
}

// ─── Detalle de una fila ───

/** "set 1.24, oct 1.24 …" para los meses con factor distinto de 1; `null` si todos son 1. */
export function textoFactoresMes(phi: readonly number[] | undefined | null): string | null {
  if (!phi) return null;
  const meses = phi.map((f, i) => ({ f, i })).filter((x) => Math.abs(x.f - 1) > 1e-9);
  if (meses.length === 0) return null;
  return meses.map((x) => `${nombreMes(x.i + 1)} ${formatearDecimal(x.f, 2)}`).join(", ");
}

/**
 * La EAT de M6 de la prueba, o por qué no hay (06c): `eat_m6 = null` con cobertura parcial (0 a 1: el peso de la unidad
 * cuyas agrupaciones traen backtesting) dice «sin backtesting de M6 (cubre 70 %: una agrupación tiene curva del usuario
 * o F sin backtesting honesto)»; sin cobertura o sin el dato (filas anteriores a la 06c), «sin backtesting de M6».
 */
export function textoEatM6(eat: number | null, cobertura: number | undefined, anio: number): string {
  if (eat !== null) return `M6 dejando ${anio} fuera: EAT ${formatearDecimal(eat, 1)} pp`;
  if (cobertura === undefined || !(cobertura > 0)) return "sin backtesting de M6";
  return `sin backtesting de M6 (cubre ${formatearDecimal(Math.round(cobertura * 100), 0)} %: una agrupación tiene curva del usuario o una candidata sin backtesting)`;
}

/** La prueba con el año anterior, rotulada «dentro de muestra» y con la EAT de M6 al lado. */
export function textoPruebaAnterior(
  pa: { anio: number; propuesto: number; real: number; desvio_pct: number | null; eat_m6: number | null; eat_m6_cobertura?: number },
  hastaPeriodo: string
): string {
  const mes = nombreMes(indiceMes(hastaPeriodo));
  const desvio = pa.desvio_pct === null ? "" : ` (${formatearPct(pa.desvio_pct)})`;
  const eat = textoEatM6(pa.eat_m6, pa.eat_m6_cobertura, pa.anio);
  return `A ${mes}-${pa.anio} el método habría dado ${unidades(pa.propuesto)}; el real fue ${unidades(pa.real)}${desvio} · dentro de muestra · ${eat}`;
}

/** Series del gráfico mensual de una fila: un trazo por año histórico y, discontinuos, el año en curso y el siguiente. */
export function seriesMensualesDeFila(d: Pick<FilaDetalleApi, "historico" | "anios">, anioEnCurso: number): SerieGrafico[] {
  const series: SerieGrafico[] = [];
  const meses = (valores: readonly number[]) => Array.from({ length: 12 }, (_, i) => valores[i] ?? null);
  for (const a of d.historico?.anios ?? []) {
    if (a.anio >= anioEnCurso) continue;
    const valores: (number | null)[] = Array<number | null>(12).fill(null);
    for (const m of a.meses) valores[Number(m.periodo.slice(5, 7)) - 1] = m.unidades;
    series.push({ clave: `anio-${a.anio}`, etiqueta: a.clase === "atipico" ? `${a.anio} (Niño)` : String(a.anio), valores, color: colorAnio(a.anio), trazo: a.clase === "atipico" ? "punteado" : "continuo", grosor: 1.75 });
  }
  for (const anio of [anioEnCurso, anioEnCurso + 1]) {
    const r = d.anios.find((x) => x.anio === anio);
    if (!r?.meses) continue;
    series.push({ clave: `proyectado-${anio}`, etiqueta: anio === anioEnCurso ? `${anio} (real + proyectado)` : `${anio} (proyectado)`, valores: meses(r.meses), color: colorAnio(anio), trazo: "discontinuo", grosor: 2.5 });
  }
  return series;
}

export type CeldaHistorico = { unidades: number; stock: number; quiebre: boolean; atipico: boolean; cobertura: number | null };

/** La tabla año × mes del histórico de la fila (cada año con las tiendas de su `M(Z)`); un mes sin dato queda `null`. */
export function tablaAnioMes(d: Pick<FilaDetalleApi, "historico">): { anio: number; clase: ClaseAnioFila; total: number; tiendas: string[]; meses: (CeldaHistorico | null)[] }[] {
  return (d.historico?.anios ?? []).map((a) => {
    const meses: (CeldaHistorico | null)[] = Array(12).fill(null);
    for (const m of a.meses) meses[Number(m.periodo.slice(5, 7)) - 1] = { unidades: m.unidades, stock: m.stock_fin, quiebre: m.quiebre, atipico: m.atipico, cobertura: m.cobertura };
    return { anio: a.anio, clase: a.clase, total: a.total, tiendas: a.tiendas, meses };
  });
}

export const ETIQUETA_CLASE: Record<ClaseAnioFila, string> = { normal: "Normal", atipico: "Niño", en_curso: "En curso" };

export const ETIQUETA_METODO: Record<AnioFilaApi["metodo"], string> = {
  avance: "Por avance de la curva",
  plan_anterior: "Total de la proyección cerrada anterior",
  crecimiento: "Base × crecimiento",
  apertura: "Por venta esperada y referente",
  avance_propio: "Por su propio avance",
  maduro_propio: "Total maduro × crecimiento",
  cierre: "Cierre de tienda",
  sin_propuesta: "Sin propuesta",
};

/** ¿Algún registro de la fila tiene un reparto con otra versión de curva (hay `meses_propuestos`)? */
export function hayCurvaNueva(f: Pick<FilaApi, "anios">): boolean {
  return f.anios.some((a) => a.meses_propuestos !== null && a.meses_propuestos !== undefined);
}

/** Cuántas filas de la línea tienen una curva nueva por aplicar. */
export function filasConCurvaNueva(filas: readonly Pick<FilaApi, "anios" | "tienda_id">[]): number {
  return filas.filter((f) => hayCurvaNueva(f)).length;
}

/** `curva_origen`: "DENIM HO v2 (100 %)" con los nombres que se conozcan. */
export function textoCurvaOrigen(origen: readonly { agrupacion_id: string; version: number; peso: number }[], nombres: ReadonlyMap<string, string>): string {
  if (origen.length === 0) return "sin curva vigente";
  return origen.map((o) => `${nombres.get(o.agrupacion_id) ?? "agrupación"} v${o.version} (${formatearDecimal(o.peso * 100, 0)} %)`).join(" + ");
}

// ─── Tiendas nuevas y cierres ───

/** De dónde sale la composición de una tienda nueva, en una frase. */
export function textoComposicion(t: Pick<TiendaProyeccionApi, "origen_composicion" | "referente">): string {
  if (t.origen_composicion === "referente" && t.referente) return `Composición de ${t.referente.codigo} · ${t.referente.nombre}`;
  if (t.origen_composicion === "propia") return "Composición propia de la tienda";
  return "Composición promedio de las mismas tiendas (sin referente)";
}

/** Qué es la «otra cifra» de una tienda según el método con que se propuso. */
export function etiquetaReferenciaAlternativa(metodo: AnioFilaApi["metodo"]): string {
  switch (metodo) {
    case "avance_propio":
    case "maduro_propio":
      return "Por venta esperada y referente";
    case "apertura":
      return "Por su propio avance";
    case "plan_anterior":
      return "Por avance de la curva";
    default:
      return "Cifra alternativa";
  }
}

/** Etiqueta del bloque de una tienda en un año. */
export function etiquetaBloqueTienda(t: Pick<TiendaProyeccionApi, "bloque" | "subbloque" | "anio">): string {
  if (t.bloque === "cierres") return `Cierre en ${t.anio}`;
  return t.subbloque === "nuevas_anterior" ? `Nueva del año anterior en ${t.anio}` : `Apertura en ${t.anio}`;
}

/** Los ratios del perfil de una apertura histórica: `×2.9 · ×1.4 · …` (el ritmo de cada mes frente al total maduro). */
export function textoPerfilApertura(ratios: readonly number[]): string {
  return ratios.map((r) => `×${formatearDecimal(r, 1)}`).join(" · ");
}

/** ¿La cifra de una fila de tienda fue fijada a mano? (las demás se escalan con el total de la tienda). */
export function filaFijada(r: Pick<AnioFilaApi, "decidido" | "origen"> | undefined): boolean {
  return r !== undefined && r.decidido !== null && r.origen === "manual";
}

/** Tiendas del bloque del año ordenadas: primero las que faltan por decidir. */
export function ordenarTiendas<T extends Pick<TiendaProyeccionApi, "anio" | "bloque" | "decidido" | "codigo">>(ts: readonly T[]): T[] {
  return [...ts].sort((a, b) => a.anio - b.anio || (a.bloque === b.bloque ? 0 : a.bloque === "nuevas" ? -1 : 1) || Number(a.decidido !== null) - Number(b.decidido !== null) || a.codigo.localeCompare(b.codigo));
}

// ─── Matriz ───

export const claveGenero = (n: NodoMatrizApi) => `g:${n.ids.genero_id ?? ""}`;
export const claveMundo = (n: NodoMatrizApi) => `m:${n.ids.genero_id ?? ""}:${n.ids.mundo_id ?? ""}`;

export function claveNodo(n: NodoMatrizApi): string {
  switch (n.nivel) {
    case "compania":
      return "c";
    case "genero":
      return claveGenero(n);
    case "mundo":
      return claveMundo(n);
    case "linea":
      return `l:${n.ids.genero_id ?? ""}:${n.ids.mundo_id ?? ""}:${n.ids.linea_id ?? ""}`;
    case "agrupacion_marca":
      return `a:${n.ids.genero_id ?? ""}:${n.ids.agrupacion_marca_id ?? ""}`;
  }
}

/** ¿Se ve el nodo con estos géneros y mundos plegados? Los desplegables son género y mundo. */
export function nodoVisible(n: NodoMatrizApi, plegados: ReadonlySet<string>): boolean {
  const g = `g:${n.ids.genero_id ?? ""}`;
  switch (n.nivel) {
    case "compania":
    case "genero":
      return true;
    case "mundo":
    case "agrupacion_marca":
      return !plegados.has(g);
    case "linea":
      return !plegados.has(g) && !plegados.has(`m:${n.ids.genero_id ?? ""}:${n.ids.mundo_id ?? ""}`);
  }
}

/** ¿El nodo se puede plegar? (los géneros y los mundos que tienen hijos). */
export function esPlegable(n: NodoMatrizApi): boolean {
  return n.nivel === "genero" || n.nivel === "mundo";
}

/** Las columnas de cierres se ocultan si son 0 en toda la matriz (ficha 07, paso 5). */
export function hayCierres(nodos: readonly NodoMatrizApi[], bloque: "en_curso" | "siguiente"): boolean {
  return nodos.some((n) => n[bloque].cierres > 0);
}

/** Pie de la matriz: «3 líneas de 41 · 6.4 % del total de 2026». */
export function textoPieMatriz(r: { lineas: number; lineas_total: number; porcentaje_total: number | null }, anioEnCurso: number): string {
  const pct = r.porcentaje_total === null ? "" : ` · ${formatearDecimal(r.porcentaje_total, 1)} % del total de ${anioEnCurso}`;
  return `${formatearNumero(r.lineas)} líneas de ${formatearNumero(r.lineas_total)}${pct}`;
}

// ─── Mensual ───

export type CeldaMes = { mes: number; valor: number | null; origen: OrigenMes };

/** Las doce celdas de un año de la vista mensual; un mes sin curva queda `null` (no 0). */
export function celdasDeAnio(a: FilaMensualApi["anios"][number]): CeldaMes[] {
  return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: a.meses[i] ?? null, origen: a.origen_meses[i] ?? "proyectado" }));
}

/** `real:9/proy:3`; `null` si el año no tiene meses (sin curva). */
export function textoOrigenMeses(a: FilaMensualApi["anios"][number]): string | null {
  if (a.meses.every((m) => m === null)) return null;
  const reales = a.origen_meses.filter((o) => o === "real").length;
  return `real:${reales}/proy:${12 - reales}`;
}

export const BLOQUES_MENSUAL = ["todas", "mismas", "nuevas", "cierres"] as const;
export type BloqueMensual = (typeof BLOQUES_MENSUAL)[number];
export const ETIQUETA_BLOQUE: Record<BloqueMensual, string> = { todas: "Todas", mismas: "Mismas tiendas", nuevas: "Tiendas nuevas", cierres: "Cierres" };

export function esBloqueMensual(v: unknown): v is BloqueMensual {
  return typeof v === "string" && (BLOQUES_MENSUAL as readonly string[]).includes(v);
}

/** Nombre del archivo de Excel: `proyeccion-2026-2027-matriz.xlsx`. */
export function nombreArchivoProyeccion(anioEnCurso: number, vista: "matriz" | "mensual"): string {
  return `proyeccion-${anioEnCurso}-${anioEnCurso + 1}-${vista}.xlsx`;
}

/** Nombre por defecto de una proyección nueva: «Proyección 2026–2027». */
export function nombrePorDefecto(anioEnCurso: number): string {
  return `Proyección ${anioEnCurso}–${anioEnCurso + 1}`;
}

/** Meses del año de `hasta` (enero hasta `hasta`), para elegir «Datos hasta»: solo se puede retroceder dentro del año en curso. */
export function mesesElegibles(ultimoMesCerrado: string): string[] {
  const anio = ultimoMesCerrado.slice(0, 4);
  const k = indiceMes(ultimoMesCerrado);
  return Array.from({ length: k }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
}

export { MESES_CORTOS };
