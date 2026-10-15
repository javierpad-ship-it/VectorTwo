import {
  ETIQUETA_TEMPORADA,
  PARAMETROS_POR_DEFECTO,
  type AprobarCurvaCuerpo,
  type CalcularAgrupacionCuerpo,
  type ModeloCurva,
  type ParametrosCurvas,
  type PantallaArreglo,
  type Prerrequisito,
  type TemporadaAgrupacion,
  type TratamientoAtipicos,
  type TrabajoAgrupacionApi,
} from "@/lib/curvas/tipos-api";
import { formatearDecimal } from "@/lib/formato";
import { listarMeses } from "@/lib/ventas/periodo";

/**
 * Lógica pura de la vista de trabajo de una agrupación (M6b): armado de los
 * cuerpos de `calcular` y `PUT`, parámetros distintos del valor por defecto,
 * cuándo la nota es obligatoria, textos de los `409` con su acción sugerida y
 * enlaces de los prerrequisitos. Sin React ni acceso a la API: las prueba vitest.
 */

// ─── Parámetros ───

export const OPCIONES_TRATAMIENTO: { valor: TratamientoAtipicos; etiqueta: string; ayuda: string }[] = [
  { valor: "auto", etiqueta: "Automático", ayuda: "El sistema decide por año: incluye, imputa o descarta según cuánto cambia la forma frente al ruido." },
  { valor: "incluir", etiqueta: "Incluir tal cual", ayuda: "Los años del Niño entran al ajuste con su curva real." },
  { valor: "imputar", etiqueta: "Imputar con la referencia", ayuda: "Los meses atípicos se reemplazan con la forma de los años normales." },
  { valor: "descartar", etiqueta: "Descartar", ayuda: "Los años del Niño quedan fuera del ajuste." },
];

export const ETIQUETA_TRATAMIENTO_ATIPICOS: Record<TratamientoAtipicos, string> = {
  auto: "automático",
  incluir: "incluir tal cual",
  imputar: "imputar con la referencia",
  descartar: "descartar",
};

const ETIQUETA_UMBRAL: Partial<Record<keyof ParametrosCurvas, string>> = {
  solo_tiendas_completas: "solo tiendas completas",
  exigir_venta_todo_el_ano: "exigir venta todo el año",
  meses_tienda_nueva: "meses de tienda nueva",
  umbral_tienda_dominante: "umbral de tienda dominante",
  umbral_forma: "piso de forma",
  max_meses_hueco: "máximo de meses con huecos",
  min_unidades_ano: "mínimo de unidades por año",
  umbral_cambio_volumen: "umbral de cambio de volumen",
  margen_ruido: "margen sobre el ruido",
  peso_minimo_diagnostico: "peso mínimo de diagnóstico",
  umbral_liquidacion: "umbral de liquidación",
};

/** Una copia de los parámetros con solo las claves del contrato (el cuerpo de `calcular` es estricto). */
export function soloParametros(p: ParametrosCurvas): ParametrosCurvas {
  const salida = { ...PARAMETROS_POR_DEFECTO } as Record<string, unknown>;
  for (const clave of Object.keys(PARAMETROS_POR_DEFECTO) as (keyof ParametrosCurvas)[]) {
    const v = p[clave];
    if (v !== undefined) salida[clave] = Array.isArray(v) ? [...v] : v;
  }
  return salida as ParametrosCurvas;
}

/** Los parámetros por defecto (listas vacías propias, para no compartir el objeto congelado). */
export function parametrosPorDefecto(): ParametrosCurvas {
  return soloParametros(PARAMETROS_POR_DEFECTO);
}

function valorTexto(v: unknown): string {
  if (typeof v === "number") return formatearDecimal(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

/**
 * Los parámetros que no tienen su valor por defecto, en texto de pantalla
 * («años excluidos: 2023», «2 tiendas excluidas», «tratamiento del Niño: descartar»).
 * `nombresTiendas` (id → código) pone el código de las tiendas excluidas.
 */
export function parametrosDistintos(p: ParametrosCurvas, nombresTiendas?: ReadonlyMap<string, string>): string[] {
  const d = PARAMETROS_POR_DEFECTO;
  const salida: string[] = [];
  if (p.anios_excluidos.length > 0) salida.push(`años excluidos: ${[...p.anios_excluidos].sort((a, b) => a - b).join(", ")}`);
  if (p.tiendas_excluidas.length > 0) {
    const codigos = p.tiendas_excluidas.map((id) => nombresTiendas?.get(id) ?? null);
    salida.push(
      codigos.every((c) => c !== null)
        ? `tiendas excluidas: ${codigos.join(", ")}`
        : `${p.tiendas_excluidas.length} ${p.tiendas_excluidas.length === 1 ? "tienda excluida" : "tiendas excluidas"}`
    );
  }
  if (p.tratamiento_atipicos !== d.tratamiento_atipicos) salida.push(`tratamiento del Niño: ${ETIQUETA_TRATAMIENTO_ATIPICOS[p.tratamiento_atipicos]}`);
  if (p.sin_periodos_confirmado !== d.sin_periodos_confirmado) salida.push("confirmado: esta temporada no tiene años atípicos");
  for (const clave of Object.keys(ETIQUETA_UMBRAL) as (keyof ParametrosCurvas)[]) {
    if (p[clave] !== d[clave]) salida.push(`${ETIQUETA_UMBRAL[clave]}: ${valorTexto(p[clave])}`);
  }
  return salida;
}

/** ¿Los parámetros son los de por defecto? */
export function sonParametrosPorDefecto(p: ParametrosCurvas): boolean {
  return parametrosDistintos(p).length === 0;
}

/** Cuerpo de `POST …/calcular`: todos los parámetros y, si el planner eligió uno, `hasta_periodo` (vacío = el defecto del servidor). */
export function cuerpoCalcular(p: ParametrosCurvas, hasta: string): CalcularAgrupacionCuerpo {
  const cuerpo: CalcularAgrupacionCuerpo = soloParametros(p);
  if (hasta !== "") cuerpo.hasta_periodo = hasta;
  return cuerpo;
}

/** Cuerpo del primer cálculo al abrir: parte de los parámetros de la última aprobación (nunca su `hasta_periodo`). */
export const CUERPO_APERTURA: CalcularAgrupacionCuerpo = { partir_de_vigente: true };

/** Cambia un año de la lista de excluidos (ordenada, sin repetidos). */
export function alternarAnioExcluido(p: ParametrosCurvas, anio: number, excluir: boolean): ParametrosCurvas {
  const sin = p.anios_excluidos.filter((a) => a !== anio);
  return { ...p, anios_excluidos: (excluir ? [...sin, anio] : sin).sort((a, b) => a - b) };
}

/** Cambia una tienda de la lista de excluidas. */
export function alternarTiendaExcluida(p: ParametrosCurvas, tiendaId: string, excluir: boolean): ParametrosCurvas {
  const sin = p.tiendas_excluidas.filter((t) => t !== tiendaId);
  return { ...p, tiendas_excluidas: excluir ? [...sin, tiendaId] : sin };
}

// ─── Aprobar ───

/**
 * Por qué la nota es obligatoria (vacío = no hace falta): candidata distinta de la
 * recomendada, años o tiendas excluidos a mano, o tratamiento del Niño que no es `auto`.
 * Es la misma regla que aplica el servidor (`409 nota_requerida`).
 */
export function motivosNotaRequerida(p: ParametrosCurvas, modelo: ModeloCurva | null, recomendada: ModeloCurva | null): string[] {
  const motivos: string[] = [];
  if (modelo !== null && recomendada !== null && modelo !== recomendada) motivos.push(`elegiste ${modelo} y el sistema recomienda ${recomendada}`);
  if (p.anios_excluidos.length > 0) motivos.push(`excluiste ${p.anios_excluidos.length === 1 ? "el año" : "los años"} ${p.anios_excluidos.join(", ")}`);
  if (p.tiendas_excluidas.length > 0) motivos.push(`excluiste ${p.tiendas_excluidas.length === 1 ? "una tienda" : `${p.tiendas_excluidas.length} tiendas`}`);
  if (p.tratamiento_atipicos !== "auto") motivos.push(`fijaste el tratamiento del Niño en «${ETIQUETA_TRATAMIENTO_ATIPICOS[p.tratamiento_atipicos]}»`);
  return motivos;
}

/** Mensaje de la nota obligatoria, con los motivos. */
export function mensajeNotaRequerida(motivos: readonly string[]): string {
  return `Escribe la nota / motivo antes de aprobar: ${motivos.join("; ")}.`;
}

/**
 * Cuerpo de `PUT /api/curvas/agrupaciones/[id]` a partir del último cálculo: los
 * parámetros que vio el planner con `hasta_periodo` EXPLÍCITO (`datos.hasta_periodo`),
 * la huella de ese cálculo y la versión vigente que vio. `null` si no hay `hasta_periodo`
 * (no hay nada que aprobar).
 */
export function cuerpoAprobar(t: Pick<TrabajoAgrupacionApi, "parametros" | "datos" | "huella_calculo" | "vigente">, modelo: ModeloCurva, nota: string): AprobarCurvaCuerpo | null {
  const hasta = t.datos.hasta_periodo;
  if (hasta === null) return null;
  const cuerpo: AprobarCurvaCuerpo = {
    modelo,
    parametros: { ...soloParametros(t.parametros), hasta_periodo: hasta },
    huella_calculo: t.huella_calculo,
    version_vigente: t.vigente?.version ?? null,
  };
  if (nota.trim() !== "") cuerpo.nota = nota.trim();
  return cuerpo;
}

// ─── Errores 409 ───

export type AccionSugerida =
  /** Volver a calcular con lo que hay en pantalla (los datos cambiaron o la vigente es otra). */
  | { tipo: "recargar"; etiqueta: string }
  /** Ir a otra pantalla a arreglarlo. */
  | { tipo: "enlace"; etiqueta: string; href: string }
  /** Ir a una pestaña de esta misma pantalla. */
  | { tipo: "pestana"; etiqueta: string; pestana: "periodos" }
  /** Enfocar el campo de la nota. */
  | { tipo: "nota"; etiqueta: string }
  /** Elegir otra candidata en la tabla. */
  | { tipo: "candidata"; etiqueta: string };

export type ErrorAprobar = { mensaje: string; accion: AccionSugerida | null };

/**
 * Orden en que el servidor evalúa los `409` del PUT (y `hasta_periodo_sin_cargar` del cálculo):
 * `hasta_periodo_sin_cargar`, `agrupacion_inactiva`, `prerrequisitos`, `sin_curva_posible`,
 * `candidata_no_disponible`, `datos_cambiados`, `vigente_cambiada`, `sin_cambio`, `nota_requerida`.
 */
export const ORDEN_409_APROBAR = [
  "hasta_periodo_sin_cargar",
  "agrupacion_inactiva",
  "prerrequisitos",
  "sin_curva_posible",
  "candidata_no_disponible",
  "datos_cambiados",
  "vigente_cambiada",
  "sin_cambio",
  "nota_requerida",
] as const;

/**
 * Mensaje claro y acción sugerida de cada error de negocio. Si el servidor mandó su
 * propio texto (`mensajeServidor`) se muestra él, que ya es castellano llano; la acción
 * es lo que añade la pantalla. Un código desconocido (o sin código) se muestra tal cual.
 */
export function errorDeAprobar(codigo: string | null, mensajeServidor: string): ErrorAprobar {
  switch (codigo) {
    case "hasta_periodo_sin_cargar":
      return {
        mensaje: `${mensajeServidor} Elige otro mes en «Calcular hasta» o carga ese mes en Venta y stock.`,
        accion: { tipo: "enlace", etiqueta: "Ir a Venta y stock", href: "/planificacion/venta-stock" },
      };
    case "agrupacion_inactiva":
      return {
        mensaje: `${mensajeServidor} Una agrupación inactiva no puede tener curva: reactívala en Agrupaciones de estacionalidad para aprobarla.`,
        accion: { tipo: "enlace", etiqueta: "Ir a Agrupaciones de estacionalidad", href: "/maestros/estacionalidad" },
      };
    case "prerrequisitos":
      return { mensaje: `${mensajeServidor} Corrige lo que indica la tarjeta «Antes de calcular» y vuelve a intentar.`, accion: { tipo: "recargar", etiqueta: "Volver a calcular" } };
    case "sin_curva_posible":
      return {
        mensaje: `${mensajeServidor} Ni la agrupación ni su temporada tienen años utilizables: revisa los avisos y los meses cargados en Venta y stock.`,
        accion: { tipo: "enlace", etiqueta: "Ir a Venta y stock", href: "/planificacion/venta-stock" },
      };
    case "candidata_no_disponible":
      return { mensaje: `${mensajeServidor} Elige otra candidata de la tabla.`, accion: { tipo: "candidata", etiqueta: "Elegir otra candidata" } };
    case "datos_cambiados":
      return {
        // El texto del servidor ya dice «vuelve a cargar»: aquí solo se añade qué pudo cambiar, sin repetir la instrucción.
        mensaje: `${mensajeServidor} Pudo cambiar una carga, una tienda, una equivalencia o un periodo.`,
        accion: { tipo: "recargar", etiqueta: "Volver a calcular" },
      };
    case "vigente_cambiada":
      return {
        // El servidor ya explica que otra persona aprobó o retiró y pide recargar: no se repite.
        mensaje: mensajeServidor,
        accion: { tipo: "recargar", etiqueta: "Volver a cargar" },
      };
    case "sin_cambio":
      return { mensaje: `${mensajeServidor} La vigente ya es esa misma candidata con los mismos datos: no hay nada que aprobar.`, accion: null };
    case "nota_requerida":
      return { mensaje: mensajeServidor, accion: { tipo: "nota", etiqueta: "Escribir la nota" } };
    default:
      return { mensaje: mensajeServidor, accion: null };
  }
}

// ─── Prerrequisitos ───

const RUTA_ARREGLO: Record<Exclude<PantallaArreglo, "periodos">, { href: string; etiqueta: string }> = {
  venta_stock: { href: "/planificacion/venta-stock", etiqueta: "Venta y stock" },
  tiendas: { href: "/maestros/tiendas", etiqueta: "Tiendas" },
  agrupaciones: { href: "/maestros/estacionalidad", etiqueta: "Agrupaciones de estacionalidad" },
};

export type EnlaceArreglo = { tipo: "pestana"; pestana: "periodos"; etiqueta: string } | { tipo: "ruta"; href: string; etiqueta: string };

/** Adónde lleva el enlace de un prerrequisito (`null` si no trae). «Periodos atípicos» es una pestaña de esta pantalla; el resto, otra ruta. */
export function enlaceDePrerrequisito(p: Pick<Prerrequisito, "enlace">): EnlaceArreglo | null {
  if (!p.enlace) return null;
  if (p.enlace.pantalla === "periodos") return { tipo: "pestana", pestana: "periodos", etiqueta: "Periodos atípicos" };
  const r = RUTA_ARREGLO[p.enlace.pantalla];
  return { tipo: "ruta", href: r.href, etiqueta: r.etiqueta };
}

// ─── Cabecera ───

/** `Calculado en 1.8 s (datos hasta 2026-09 · la vigente usó datos hasta 2026-08)`. */
export function textoCalculado(duracionMs: number | null, hasta: string | null, hastaVigente: string | null): string {
  const partes: string[] = [];
  if (hasta) partes.push(`datos hasta ${hasta}`);
  if (hastaVigente && hastaVigente !== hasta) partes.push(`la vigente usó datos hasta ${hastaVigente}`);
  const tiempo = duracionMs === null ? "" : `Calculado en ${formatearDecimal(duracionMs / 1000, 1)} s`;
  const detalle = partes.length > 0 ? `(${partes.join(" · ")})` : "";
  return [tiempo, detalle].filter(Boolean).join(" ");
}

/** `Red: 8 · 9 · 9 · 10 tiendas` con las tiendas que entran en cada año (el año en curso incluido). */
export function textoRedPorAnio(red: readonly { tiendas: readonly { entra: boolean }[] }[]): string {
  if (red.length === 0) return "";
  return `Red: ${red.map((r) => r.tiendas.filter((t) => t.entra).length).join(" · ")} tiendas`;
}

/** `Toda temporada` / `Invierno`… para frases. */
export function nombreTemporada(t: TemporadaAgrupacion): string {
  return ETIQUETA_TEMPORADA[t];
}

/** Meses publicados entre `desde` y `hasta` (`aaaa-mm`), sin los faltantes: las opciones de «Calcular hasta». */
export function mesesParaHasta(desde: string | null, hasta: string | null, faltantes: readonly string[]): string[] {
  if (!desde || !hasta || hasta < desde) return [];
  const f = new Set(faltantes);
  return listarMeses(desde, hasta).filter((m) => !f.has(m));
}

// ─── Cuándo se puede aprobar ───

/**
 * Por qué «Aprobar esta curva» está deshabilitado (`null` = se puede): mientras recalcula o lo que se ve no es lo
 * que hay en los parámetros, si algún prerrequisito bloquea, si la agrupación está inactiva o si la candidata
 * elegida no tiene curva. Que falte la nota NO lo deshabilita: al pulsar se pide con el motivo (y el servidor
 * responde `409 nota_requerida` si se salta).
 */
export function motivoNoSePuedeAprobar(e: {
  datos: Pick<TrabajoAgrupacionApi, "agrupacion" | "prerrequisitos" | "datos"> | null;
  recalculando: boolean;
  desactualizado: boolean;
  /** El último cálculo falló (la pantalla muestra el error). */
  fallo?: boolean;
  tieneCandidata: boolean;
}): string | null {
  if (!e.datos) return "Todavía no hay un cálculo que aprobar.";
  if (e.recalculando) return "Recalculando con los parámetros nuevos: espera a que termine.";
  if (e.desactualizado) return e.fallo ? "El último cálculo falló: cambia el parámetro o vuelve a calcular antes de aprobar." : "Lo que se ve no es lo que hay en los parámetros: espera el cálculo.";
  if (e.datos.prerrequisitos.bloquea.length > 0) return "Hay prerrequisitos que bloquean el cálculo (tarjeta «Antes de calcular»).";
  if (!e.datos.agrupacion.activo) return "La agrupación está inactiva: reactívala para aprobar su curva.";
  if (e.datos.datos.hasta_periodo === null) return "No hay un mes publicado y cerrado hasta el que calcular.";
  if (!e.tieneCandidata) return "La candidata elegida no tiene curva: elige otra.";
  return null;
}

// ─── Cambios sin aprobar ───

/** ¿Son iguales los parámetros? (listas ordenadas; solo las claves del contrato). */
export function parametrosIguales(a: ParametrosCurvas, b: ParametrosCurvas): boolean {
  const norm = (p: ParametrosCurvas) => {
    const s = soloParametros(p);
    return JSON.stringify({ ...s, anios_excluidos: [...s.anios_excluidos].sort((x, y) => x - y), tiendas_excluidas: [...s.tiendas_excluidas].sort() });
  };
  return norm(a) === norm(b);
}

/**
 * ¿Hay trabajo sin guardar en la vista? Una nota escrita, «Calcular hasta» elegido, o parámetros distintos de los
 * con que se abrió la agrupación. Cambiar de agrupación con esto pide confirmación.
 */
export function hayCambiosSinAprobar(e: { nota: string; hasta: string; parametros: ParametrosCurvas | null; iniciales: ParametrosCurvas | null }): boolean {
  if (e.nota.trim() !== "" || e.hasta !== "") return true;
  return e.parametros !== null && e.iniciales !== null && !parametrosIguales(e.parametros, e.iniciales);
}
