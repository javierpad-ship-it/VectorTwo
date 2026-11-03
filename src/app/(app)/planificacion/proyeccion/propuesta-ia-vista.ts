// Lógica de vista de la pestaña «Propuesta IA» (ficha 07e, §4.1). Pura, sin React: la prueban vitest con datos sintéticos.
// Aquí viven los textos, los tonos, el orden, el cuerpo de la corrida y el resumen. Nada de esto calcula cifras de negocio: las
// cifras (meta, natural, IA con meta, absorbido, brecha) las calcula el servidor. Los textos de la IA (razones) NO pasan por aquí:
// se pintan tal cual, como texto, en los componentes. Formato es-PE (`@/lib/formato`).

import { formatearDecimal } from "@/lib/formato";
import {
  UMBRAL_BRECHA_CEDE_PCT,
  UMBRAL_BRECHA_FORZADA_PCT,
  UMBRAL_BRECHA_MUY_FORZADA_PCT,
  UMBRAL_ESFUERZO_EXIGENTE_PCT,
  UMBRAL_ESFUERZO_HOLGADO_PCT,
  UMBRAL_META_MOVIDA_PCT,
  type AbsorcionApi,
  type AvisoIa,
  type BanderaIa,
  type CorridaApi,
  type EstadoCorridaGM,
  type EstadoMetaFila,
  type EstadoPropuestaGM,
  type EstimacionApi,
  type GMIaDetalleApi,
  type GMIaResumenApi,
  type MetaGMApi,
  type MotivoDesactualizadaIa,
  type MotivoIa,
  type SenalIa,
  type ServicioIaApi,
} from "@/lib/ia/tipos-api";
import type { IndiceLineaApi } from "@/lib/proyeccion/tipos-api";
import { formatearMomento, formatearPct, unidades } from "./vista";

// ─── Contratos de §3.1 que `tipos-api.ts` no declara (los define la ficha en prosa) ───

/** `GET …/[id]/ia` (§3.1). */
export type EstadoIaProyeccionApi = {
  servicio: ServicioIaApi;
  prerrequisitos: { bloquea: MotivoIa[]; avisa: MotivoIa[] };
  corrida_en_curso: CorridaApi | null;
  gms: GMIaResumenApi[];
  estimacion_pendientes: EstimacionApi;
};

/** Un GM del plan de una corrida (§3.1, `201` de `…/ia/corridas`). */
export type PlanGmApi = { gm_clave: string; modo: "directo" | "jerarquico" | null; llamadas: number; reusa: boolean };
export type RespuestaIniciarCorridaApi = { corrida: CorridaApi; plan: PlanGmApi[]; estimacion: EstimacionApi };

/** Qué GM pide el planner: los pendientes o desactualizados (por defecto), todos, o los que elija (`gm_clave`). */
export type SeleccionGms = "pendientes" | "todos" | string[];

// ─── Formato ───

/** `US$ 3.20`; un gasto menor a un centavo se dice como tal. */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.01) return "< US$ 0.01";
  return `US$ ${formatearDecimal(n, 2)}`;
}

/** `+1 039`, `-1 039`, `0`; `—` si no hay valor. */
export function signado(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "-"}${unidades(Math.abs(r))}`;
}

/** `2026-11-02T…` → `02/11` en Lima. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Con `formatToParts` y relleno propio: según el ICU, `es-PE` entrega «1/11» aunque se pida `2-digit`.
  const partes = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "numeric", month: "numeric" }).formatToParts(d);
  const dato = (tipo: string) => (partes.find((p) => p.type === tipo)?.value ?? "").padStart(2, "0");
  return `${dato("day")}/${dato("month")}`;
}

const PROVEEDORES: Record<string, string> = { openai: "OpenAI", anthropic: "Claude (Anthropic)" };

export function etiquetaProveedor(id: string | null | undefined): string {
  if (!id) return "—";
  return PROVEEDORES[id] ?? id;
}

/** `GENERO · MUNDO`. */
export const nombreGm = (g: { genero: string; mundo: string }): string => `${g.genero} · ${g.mundo}`;

// ─── Cabecera de servicio ───

/** El motivo por el que la IA no se ofrece, con qué hacer (§4.1). `null` si el servicio está disponible. */
export function textoServicioApagado(s: ServicioIaApi): string | null {
  if (s.disponible) return null;
  switch (s.motivo) {
    case "sin_clave":
      return "Falta la clave del proveedor en el servidor (Railway). Hasta que el administrador la ponga, no se puede generar.";
    case "sin_proveedor":
      return "El servidor no tiene proveedor de IA configurado (o el configurado no tiene adaptador).";
    case "desactivada_entorno":
      return "La IA está desactivada por el entorno del servidor.";
    case "sin_configuracion":
      return "Todavía no hay una configuración de IA aprobada. El administrador debe evaluar un modelo y guardarla en Administración → Motor de IA.";
    case "sin_capacidades": {
      const v = s.evaluacion?.veredicto.distribucion_y1;
      if (s.evaluacion && v === "no_gana") return `Sin evaluación ganadora: en la evaluación del ${fechaCorta(s.evaluacion.fecha)} la IA no superó al mejor rival (el método actual o la regla de tendencia).`;
      return "Apagada por el administrador: la configuración vigente no tiene ninguna capacidad encendida.";
    }
    case "clave_invalida":
      return "El proveedor rechazó la clave del servidor. El administrador debe revisar la variable secreta en Railway.";
    case "tope_mensual":
      return `Se alcanzó el tope de gasto del mes (${usd(s.gasto_mes_usd)} de ${s.tope_usd_mes === null ? "—" : formatearDecimal(s.tope_usd_mes, 2)}). Se libera el mes siguiente o cuando el administrador suba el tope.`;
    case "proveedor_distinto":
    case "modelo_no_permitido":
      return "La configuración vigente es de otro proveedor o de un modelo no permitido: el administrador debe evaluar y guardar una nueva.";
    default:
      return "La IA no está disponible.";
  }
}

/** «IA encendida · OpenAI · modelo … · prompt v1 · meta 2027 · evaluada el 02/11 · gasto del mes US$ 3.20 de 60 · hoy US$ 0.40 de 15». */
export function lineaServicioEncendido(s: ServicioIaApi, anioSiguiente: number): string {
  const partes = ["IA encendida", etiquetaProveedor(s.proveedor), `modelo ${s.modelo ?? "—"}`, `prompt ${s.version_prompt ?? "—"}`, `meta ${anioSiguiente}`];
  if (s.evaluacion) partes.push(`evaluada el ${fechaCorta(s.evaluacion.fecha)}`);
  partes.push(`gasto del mes ${usd(s.gasto_mes_usd)}${s.tope_usd_mes === null ? "" : ` de ${formatearDecimal(s.tope_usd_mes, 0)}`}`);
  partes.push(`hoy ${usd(s.gasto_dia_usuario_usd)}${s.tope_usd_dia_usuario === null ? "" : ` de ${formatearDecimal(s.tope_usd_dia_usuario, 0)}`}`);
  return partes.join(" · ");
}

/** Lo que queda de cada tope (corrida, mes, hoy) para el modal de generar. */
export function textoTopes(s: ServicioIaApi): string[] {
  const restante = (tope: number | null, gasto: number) => (tope === null ? "—" : usd(Math.max(0, tope - gasto)));
  return [
    `Tope por corrida: ${s.tope_usd_corrida === null ? "—" : usd(s.tope_usd_corrida)}`,
    `Queda del mes: ${restante(s.tope_usd_mes, s.gasto_mes_usd)}`,
    `Queda hoy: ${restante(s.tope_usd_dia_usuario, s.gasto_dia_usuario_usd)}`,
  ];
}

export const NOTA_CERRAR_A_MANO =
  "Para cerrar, las filas libres se deciden por línea (en Por línea) o por lotes en la pestaña Aprobación, siempre con tu confirmación. La IA propone; la columna «Desvío frente a la meta» de la Matriz es la única garantía de que lo decidido suma la meta.";

// ─── Prerrequisitos ───

const TEXTO_PRERREQUISITO: Record<MotivoIa, string> = {
  version_metodo: "La proyección es de un método anterior al 5: recalcúlala antes de generar.",
  proyeccion_desactualizada: "La proyección está desactualizada (cargas, curvas o crecimientos nuevos): recalcúlala antes de generar.",
  cerrada: "La proyección está cerrada: es solo lectura y no admite una propuesta nueva.",
  archivada: "La proyección está archivada: es solo lectura y no admite una propuesta nueva.",
  calculo_en_curso: "Hay un cálculo en curso: espera a que termine.",
  anio_siguiente_atipico: "El año siguiente está marcado como atípico (Niño) en Curvas: no hay meta que repartir hasta quitar la marca.",
  factor_y: "El factor del Niño del año en curso falta, está desfasado o sin confirmar: confírmalo en Factores del Niño y recalcula.",
  reaprobar_pendiente: "Hay un crecimiento por reaprobar (versión bruta en un GM con Niño material): reaprueba antes de generar o la meta cambiará después.",
  meta_provisional: "La meta del Resto no está aprobada: la IA reparte el % provisional.",
  sin_meta: "Hay GM sin meta aprobada: en ellos la IA solo da el natural y las razones.",
  decisiones_y_pendientes: "Decide primero el año en curso en estos GM: cada cierre mueve la meta del año siguiente y las filas libres la absorben.",
};

export function textoPrerrequisito(m: MotivoIa, gms: readonly GMIaResumenApi[] = []): string {
  const base = TEXTO_PRERREQUISITO[m] ?? m;
  if (m !== "decisiones_y_pendientes") return base;
  const conPendientes = gms.filter((g) => g.filas_y_sin_decidir > 0);
  if (conPendientes.length === 0) return base;
  return `${base} ${conPendientes.map((g) => `${nombreGm(g)} (${unidades(g.filas_y_sin_decidir)})`).join(", ")}.`;
}

/** El motivo lleva a Factores del Niño. */
export const llevaAFactores = (m: MotivoIa): boolean => m === "factor_y";

/** ¿Se puede pedir una generación ahora? */
export function permiteGenerar(estado: EstadoIaProyeccionApi, bloqueada: boolean): { ok: boolean; motivo: string | null } {
  if (!estado.servicio.disponible) return { ok: false, motivo: textoServicioApagado(estado.servicio) };
  if (bloqueada) return { ok: false, motivo: "La proyección no admite cambios (cerrada, archivada o calculándose)." };
  if (estado.prerrequisitos.bloquea.length > 0) return { ok: false, motivo: "Hay bloqueos antes de generar (ver arriba)." };
  if (estado.corrida_en_curso) return { ok: false, motivo: "Hay una corrida en curso." };
  return { ok: true, motivo: null };
}

// ─── Tabla de GM ───

/** HOMBRE y MUJER primero (por género y mundo); los GM del Resto agrupados al final. */
export function ordenarGms(gms: readonly GMIaResumenApi[]): GMIaResumenApi[] {
  return [...gms].sort((a, b) => Number(a.es_resto) - Number(b.es_resto) || a.genero.localeCompare(b.genero, "es") || a.mundo.localeCompare(b.mundo, "es") || a.gm_clave.localeCompare(b.gm_clave));
}

export type TonoIa = "marca" | "exito" | "alerta" | "neutro";

export const ESTADO_GM: Record<EstadoPropuestaGM, { texto: string; tono: TonoIa }> = {
  sin_propuesta: { texto: "sin propuesta", tono: "neutro" },
  sin_filas_libres: { texto: "sin filas libres", tono: "neutro" },
  al_dia: { texto: "al día", tono: "exito" },
  meta_movida: { texto: "meta movida", tono: "alerta" },
  desactualizada: { texto: "desactualizada", tono: "alerta" },
  fallida: { texto: "fallida", tono: "alerta" },
  bloqueado_privacidad: { texto: "bloqueado por privacidad", tono: "alerta" },
};

const TEXTO_MOTIVO: Record<MotivoDesactualizadaIa, string> = {
  historia_cambiada: "la historia cambió",
  filas_libres_nuevas: "hay filas libres nuevas",
  version_metodo: "cambió la versión del método",
  capacidad_apagada: "la capacidad está apagada",
};

export const textoMotivosGm = (motivos: readonly MotivoDesactualizadaIa[]): string => motivos.map((m) => TEXTO_MOTIVO[m] ?? m).join(", ");

/** «desactualizada (la historia cambió)». */
export function textoEstadoGm(g: Pick<GMIaResumenApi, "estado" | "motivos">): string {
  const base = ESTADO_GM[g.estado]?.texto ?? g.estado;
  return g.estado === "desactualizada" && g.motivos.length > 0 ? `${base} (${textoMotivosGm(g.motivos)})` : base;
}

/** ¿El GM pide generar de nuevo? (los «pendientes o desactualizados»). */
export const gmPendiente = (g: Pick<GMIaResumenApi, "estado">): boolean => g.estado === "sin_propuesta" || g.estado === "desactualizada" || g.estado === "fallida";

export type NivelEsfuerzo = "muy_exigente" | "exigente" | "normal" | "holgado" | "sin_dato";

/** Esfuerzo del GM: ámbar desde +10 %, rojo desde +25 %, azul por debajo de −5 % (el kit solo tiene un tono de alerta: «muy exigente» se distingue por el texto y el énfasis). */
export function nivelEsfuerzo(pct: number | null | undefined): { nivel: NivelEsfuerzo; tono: TonoIa; texto: string } {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return { nivel: "sin_dato", tono: "neutro", texto: "—" };
  if (pct >= UMBRAL_BRECHA_MUY_FORZADA_PCT) return { nivel: "muy_exigente", tono: "alerta", texto: "muy exigente" };
  if (pct >= UMBRAL_ESFUERZO_EXIGENTE_PCT) return { nivel: "exigente", tono: "alerta", texto: "exigente" };
  if (pct <= UMBRAL_ESFUERZO_HOLGADO_PCT) return { nivel: "holgado", tono: "marca", texto: "holgada" };
  return { nivel: "normal", tono: "neutro", texto: "normal" };
}

export type NivelBrecha = "muy_forzada" | "forzada" | "cede" | "normal" | "sin_dato";

/** Brecha de una fila: «forzada» desde +10 %, «muy forzada» desde +25 %, «cede» desde −10 %. */
export function nivelBrecha(pct: number | null | undefined): { nivel: NivelBrecha; tono: TonoIa; texto: string | null } {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return { nivel: "sin_dato", tono: "neutro", texto: null };
  if (pct >= UMBRAL_BRECHA_MUY_FORZADA_PCT) return { nivel: "muy_forzada", tono: "alerta", texto: "muy forzada" };
  if (pct >= UMBRAL_BRECHA_FORZADA_PCT) return { nivel: "forzada", tono: "alerta", texto: "forzada" };
  if (pct <= UMBRAL_BRECHA_CEDE_PCT) return { nivel: "cede", tono: "marca", texto: "cede" };
  return { nivel: "normal", tono: "neutro", texto: null };
}

/** «+8.00 % sobre corregido · 26 006 u». */
export function textoMeta(meta: MetaGMApi | null): string {
  if (!meta) return "sin meta";
  return `${formatearPct(meta.pct, 2)} sobre ${meta.sobre_base === "corregida" ? "corregido" : "bruto"} · ${unidades(meta.meta_gm)} u`;
}

export const metaProvisional = (meta: MetaGMApi | null): boolean => meta?.fuente === "resto_provisional";

/** «Fijas 3 386 u en 2 filas». */
export function textoFijas(meta: MetaGMApi | null): string {
  if (!meta) return "—";
  return `${unidades(meta.fijas)} u · ${unidades(meta.filas_fijas)} ${meta.filas_fijas === 1 ? "fila" : "filas"}`;
}

/** «fijas 3 386 u (decididas 3 300 · % propio 0 · cola larga 86)»: solo las partes que pesan. */
export function textoDesgloseFijas(meta: MetaGMApi): string {
  const partes: string[] = [];
  if (meta.fijas_detalle.decididas > 0) partes.push(`decididas ${unidades(meta.fijas_detalle.decididas)}`);
  if (meta.fijas_detalle.pct_propio > 0) partes.push(`% propio ${unidades(meta.fijas_detalle.pct_propio)}`);
  if (meta.fijas_detalle.cola_larga > 0) partes.push(`cola larga ${unidades(meta.fijas_detalle.cola_larga)}`);
  return `fijas ${unidades(meta.fijas)} u${partes.length > 0 ? ` (${partes.join(" · ")})` : ""}`;
}

/** La tarjeta de la meta del detalle (§4.1). */
export function textoMetaDetalle(g: GMIaResumenApi): string | null {
  const m = g.meta;
  if (!m) return null;
  const partes = [`Meta ${unidades(m.meta_gm)} u = Σ propuesta del método con ${formatearPct(m.pct, 2)} sobre ${m.sobre_base === "corregida" ? "corregido" : "bruto"}`, textoDesgloseFijas(m), `libre ${unidades(m.meta_libre)}`];
  if (g.natural_libres !== null) partes.push(`natural IA ${unidades(g.natural_libres)}`);
  const base = partes.join(" · ");
  return g.esfuerzo_pct === null ? base : `${base} → esfuerzo ${formatearPct(g.esfuerzo_pct, 1)}`;
}

/** Las dos cifras de la meta (rev. M13): la de M7 y la vista previa de Curvas. */
export function textoDosCifrasMeta(metaGm: number, vistaPrevia: number | null): string {
  const base = `en filas de M7: ${unidades(metaGm)} u`;
  if (vistaPrevia === null) return `${base} · vista previa de Curvas: no disponible`;
  return `${base} · vista previa de Curvas: ${unidades(vistaPrevia)} u (Curvas la calcula por curva y agrupación; M7, por fila con su propia base: difieren por la cola larga, filas sin curva y redondeos)`;
}

/** «Fuera de la meta: aperturas 2027 1 240 u · cierres 0 · líneas nuevas de 2027: se planifican aparte». */
export function textoFueraDeMeta(c: GMIaDetalleApi["contexto"], anioSiguiente: number): string {
  return `Fuera de la meta: aperturas ${anioSiguiente} ${unidades(c.aperturas_y1)} u · cierres ${unidades(c.cierres_y1)} u · cola larga ${unidades(c.cola_larga.unidades)} u en ${unidades(c.cola_larga.filas)} filas · líneas nuevas de ${anioSiguiente}: se planifican aparte.`;
}

/** «−1 039 u (8.9 %) desde que la IA propuso»; ámbar si pasa del 5 %. */
export function textoAbsorcionGm(a: AbsorcionApi | null): { texto: string; alerta: boolean } | null {
  if (!a) return null;
  const pct = a.absorbido_pct === null ? "" : ` (${formatearPct(a.absorbido_pct, 1)})`;
  return { texto: `${signado(a.absorbido_u)} u${pct} desde que la IA propuso`, alerta: a.absorbido_pct !== null && Math.abs(a.absorbido_pct) > UMBRAL_META_MOVIDA_PCT };
}

/** El desglose del detalle (§4.1). */
export function textoDesgloseAbsorcion(a: AbsorcionApi): string {
  return `Desde que la IA propuso: la meta cambió ${signado(a.delta_meta_u)} u; las filas fijadas después se apartaron ${signado(a.desviacion_fijadas_u)} u de lo que la IA les daba; otros ${signado(a.otros_u)} u; las libres que quedan absorbieron ${signado(a.absorbido_u)} u${a.absorbido_pct === null ? "" : ` (${formatearPct(a.absorbido_pct, 1)})`}.`;
}

type PropuestaResumen = NonNullable<GMIaResumenApi["propuesta"]>;

/** «30/10/2026 10:15 · J. Pérez · OpenAI gpt-… · prompt v1 · US$ 0.12». */
export function textoGenerada(p: PropuestaResumen | null): string {
  if (!p) return "—";
  return [formatearMomento(p.created_at), p.usuario_nombre, `${etiquetaProveedor(p.proveedor)} ${p.modelo}`, `prompt ${p.version_prompt}`, usd(p.costo_usd)].filter(Boolean).join(" · ");
}

// ─── Filas del detalle ───

export const ETIQUETA_ESTADO_META: Record<EstadoMetaFila, string> = {
  libre: "libre",
  libre_en_bloque: "libre · aprobada en bloque",
  fija_decidida: "fija: decidida",
  fija_pct: "fija: % propio",
  fija_cola_larga: "fija: cola larga",
  sin_base: "sin base",
};

type FilaDetalle = GMIaDetalleApi["filas"][number];

/** Ordenadas por `|IA con meta − método|` descendente (donde la IA más se aparta del método, primero); empate por línea y `fila_id`. */
export function ordenarFilasPorDistanciaAlMetodo(filas: readonly FilaDetalle[]): FilaDetalle[] {
  return [...filas].sort(
    (a, b) =>
      Math.abs(b.contra_metodo_u ?? 0) - Math.abs(a.contra_metodo_u ?? 0) ||
      a.linea.localeCompare(b.linea, "es") ||
      (a.fila_id < b.fila_id ? -1 : a.fila_id > b.fila_id ? 1 : 0)
  );
}

/** Totales por línea y del GM: unidades de los años en curso y siguiente y de la propuesta. Suma solo lo que existe. */
export function totalesDeFilas(filas: readonly FilaDetalle[]) {
  const suma = (f: (x: FilaDetalle) => number | null) => filas.reduce((acc, x) => acc + (f(x) ?? 0), 0);
  return {
    vigente_y: suma((x) => x.vigente_y),
    base: suma((x) => x.base),
    base_corregida: suma((x) => x.base_corregida),
    metodo_y1: suma((x) => x.metodo_y1),
    natural_y1: suma((x) => x.natural_y1),
    meta_y1: suma((x) => x.meta_y1),
    absorbido_u: suma((x) => x.absorbido_u),
    vigente_y1: suma((x) => x.vigente_y1),
  };
}

export type TotalLinea = { linea: string; filas: number; metodo_y1: number; natural_y1: number; meta_y1: number; vigente_y1: number };

export function totalesPorLinea(filas: readonly FilaDetalle[]): TotalLinea[] {
  const mapa = new Map<string, TotalLinea>();
  for (const f of filas) {
    const t = mapa.get(f.linea) ?? { linea: f.linea, filas: 0, metodo_y1: 0, natural_y1: 0, meta_y1: 0, vigente_y1: 0 };
    t.filas += 1;
    t.metodo_y1 += f.metodo_y1 ?? 0;
    t.natural_y1 += f.natural_y1 ?? 0;
    t.meta_y1 += f.meta_y1 ?? 0;
    t.vigente_y1 += f.vigente_y1 ?? 0;
    mapa.set(f.linea, t);
  }
  return [...mapa.values()].sort((a, b) => a.linea.localeCompare(b.linea, "es"));
}

const TEXTO_SENAL: Record<SenalIa, string> = {
  dato_insuficiente: "dato insuficiente",
  linea_nueva: "línea nueva",
  quiebres: "quiebres de stock",
  nino: "efecto Niño",
  temporadas_mezcladas: "temporadas mezcladas",
  avance_bajo: "avance bajo",
  plan_anterior: "plan anterior",
  revision_cola_larga: "cola larga en revisión",
  tiendas_entrantes: "tiendas que entran",
  tiendas_salientes: "tiendas que salen",
};

const TEXTO_BANDERA: Record<BanderaIa, string> = {
  dato_insuficiente: "dato insuficiente",
  linea_nueva: "línea nueva",
  en_salida: "en salida",
  quiebres: "quiebres de stock",
  nino: "efecto Niño",
  volatil: "volátil",
  tiendas_entrantes: "tiendas que entran",
  meta_exigente: "meta exigente",
  meta_holgada: "meta holgada",
  estacionalidad_atipica: "estacionalidad atípica",
};

const TEXTO_AVISO: Record<AvisoIa, string> = {
  ia_no_cuadro: "la suma de la IA no cuadró con la meta",
  ia_cifra_excesiva: "cifra de la IA descartada por excesiva",
  brecha_extrema: "brecha extrema frente al natural",
  sin_propuesta_ia: "sin cifra de la IA: se repartió con la propuesta del método",
  fijadas_exceden_meta: "las filas fijadas exceden la meta: no hay reparto",
  meta_provisional: "meta provisional (Resto sin aprobar)",
  base_movida: "la base corregida cambió desde que la IA propuso",
  meta_movida: "la meta se movió desde que la IA propuso",
  absorcion_alta: "esta fila absorbió más del 10 % de su cifra",
  bandera_desconocida: "la IA devolvió una lectura que no se reconoce",
  fila_extra: "la IA devolvió una fila que no se pidió",
  fila_duplicada: "la IA repitió esta fila",
  razon_recortada: "razón recortada",
};

const legible = (codigo: string) => codigo.replace(/_/g, " ");
export const textoSenal = (s: SenalIa): string => TEXTO_SENAL[s] ?? legible(s);
export const textoBandera = (b: BanderaIa): string => TEXTO_BANDERA[b] ?? legible(b);
export const textoAvisoIa = (a: AvisoIa): string => TEXTO_AVISO[a] ?? legible(a);
/** Avisos que se pintan en alerta; el resto, en neutro. */
export const avisoEsAlerta = (a: AvisoIa): boolean => a !== "meta_provisional" && a !== "razon_recortada" && a !== "fila_duplicada";

/** «−309 u (−4.6 %)»; ámbar si pasa del umbral por fila. */
export function textoAbsorcionFila(f: Pick<FilaDetalle, "absorbido_u" | "absorbido_pct" | "avisos">): { texto: string; alerta: boolean } | null {
  if (f.absorbido_u === null) return null;
  const pct = f.absorbido_pct === null ? "" : ` (${formatearPct(f.absorbido_pct, 1)})`;
  return { texto: `${signado(f.absorbido_u)} u${pct}`, alerta: f.avisos.includes("absorcion_alta") };
}

export function textoBrecha(f: Pick<FilaDetalle, "brecha_u" | "brecha_pct">): string {
  if (f.brecha_u === null) return "—";
  return `${signado(f.brecha_u)} u${f.brecha_pct === null ? "" : ` (${formatearPct(f.brecha_pct, 1)})`}`;
}

/** «+2 200 u por tiendas que entran» si aplica. */
export function textoAporteEntrantes(f: Pick<FilaDetalle, "aporte_entrantes">): string | null {
  return f.aporte_entrantes !== null && f.aporte_entrantes > 0 ? `+${unidades(f.aporte_entrantes)} u por tiendas que entran` : null;
}

/** Por qué una fila no se puede aceptar aquí (la aceptación vive en Por línea); texto de la decisión. */
export function textoDecision(f: Pick<FilaDetalle, "decidida_y1" | "vigente_y1">): string {
  return f.decidida_y1 ? `decidida · ${unidades(f.vigente_y1)} u` : "pendiente";
}

// ─── Navegación ───

const CLAVE_GM = /^[0-9A-Za-z-]{1,64}\.[0-9A-Za-z-]{1,64}$/;
export const claveGmValida = (v: string | null): v is string => v !== null && CLAVE_GM.test(v);

/** `<genero_id>.<mundo_id>`. */
export function idsDeGm(clave: string): { genero_id: string; mundo_id: string } | null {
  if (!claveGmValida(clave)) return null;
  const [genero_id, mundo_id] = clave.split(".");
  return { genero_id, mundo_id };
}

/** Destino de «Ir a la línea»: género, mundo y la línea por su nombre dentro del GM (el detalle no trae `linea_id`). */
export function destinoLinea(clave: string, linea: string, indice: readonly IndiceLineaApi[]): { genero_id: string; mundo_id: string; linea_id: string | null } | null {
  const ids = idsDeGm(clave);
  if (!ids) return null;
  const hallada = indice.find((i) => i.genero_id === ids.genero_id && i.mundo_id === ids.mundo_id && i.linea === linea);
  return { ...ids, linea_id: hallada?.linea_id ?? null };
}

// ─── Corrida ───

export const ETIQUETA_SELECCION_PENDIENTES = "GM pendientes o desactualizados";
export const ETIQUETA_SELECCION_TODOS = "Todos los GM";

/** El valor del `Select` del modal: `pendientes`, `todos` o `gm:<clave>`. */
export function valorSeleccion(s: SeleccionGms): string {
  if (s === "pendientes" || s === "todos") return s;
  return s.length === 1 ? `gm:${s[0]}` : "pendientes";
}

export function leerSeleccion(valor: string): SeleccionGms {
  if (valor === "todos") return "todos";
  if (valor.startsWith("gm:") && claveGmValida(valor.slice(3))) return [valor.slice(3)];
  return "pendientes";
}

/** Cuerpo de `POST …/ia/corridas` (`iniciarCorridaSchema`, §3.1). */
export function cuerpoIniciarCorrida(seleccion: SeleccionGms, regenerar: boolean, costoConfirmadoUsd: number) {
  return { gms: seleccion, regenerar, costo_confirmado_usd: costoConfirmadoUsd };
}

/** La estimación que trae un `409 costo_no_confirmado` (contrato supuesto: el cuerpo del error lleva `estimacion`). */
export function estimacionDeError(detalle: Record<string, unknown> | null | undefined): EstimacionApi | null {
  const e = detalle?.estimacion;
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const numeros = ["gms", "llamadas", "filas", "tokens_entrada", "tokens_salida", "costo_usd", "tope_usd", "reusables"] as const;
  if (!numeros.every((k) => typeof o[k] === "number" && Number.isFinite(o[k]))) return null;
  return o as unknown as EstimacionApi;
}

/** ¿La estimación pasa del tope de la corrida? */
export const superaTope = (e: EstimacionApi): boolean => e.tope_usd > 0 && e.costo_usd > e.tope_usd;

/** Líneas del modal: GM, llamadas, filas, tokens, costo y cuántos se reusan. */
export function lineasEstimacion(e: EstimacionApi): string[] {
  return [
    `${unidades(e.gms)} GM · ${unidades(e.reusables)} se reusan sin llamar al proveedor`,
    `${unidades(e.llamadas)} ${e.llamadas === 1 ? "llamada" : "llamadas"} · ${unidades(e.filas)} filas`,
    `${unidades(e.tokens_entrada)} tokens de entrada · ${unidades(e.tokens_salida)} de salida (estimados)`,
    `Costo estimado ${usd(e.costo_usd)}`,
  ];
}

export type AvanceGm = { estado: EstadoCorridaGM; pasos_hechos: number; pasos_total: number };

/** Avance de un GM, de 0 a 1 (la barra por pasos). */
export function fraccionAvance(a: Pick<AvanceGm, "pasos_hechos" | "pasos_total"> | undefined): number {
  if (!a || a.pasos_total <= 0) return 0;
  return Math.max(0, Math.min(1, a.pasos_hechos / a.pasos_total));
}

const GM_TERMINADOS: readonly EstadoCorridaGM[] = ["hecho", "reusado", "fallido", "sin_filas_libres", "bloqueado_privacidad"];
export const gmTerminado = (e: EstadoCorridaGM): boolean => GM_TERMINADOS.includes(e);

export const ETIQUETA_ESTADO_CORRIDA_GM: Record<EstadoCorridaGM, string> = {
  pendiente: "en cola",
  en_proceso: "en proceso",
  hecho: "hecho",
  reusado: "reusado",
  fallido: "fallido",
  sin_filas_libres: "sin filas libres",
  bloqueado_privacidad: "bloqueado por privacidad",
};

/** «27 GM al día · 1 fallido · 1 sin filas libres · US$ 3.12». Cuenta lo que quedó en cada GM de la corrida. */
export function textoResumenCorrida(porGm: Record<string, AvanceGm>, corrida: Pick<CorridaApi, "costo_usd"> | null): string {
  const estados = Object.values(porGm).map((a) => a.estado);
  const cuenta = (e: EstadoCorridaGM) => estados.filter((x) => x === e).length;
  const alDia = cuenta("hecho") + cuenta("reusado");
  const partes: string[] = [`${alDia} GM al día`];
  const fallidos = cuenta("fallido");
  if (fallidos > 0) partes.push(`${fallidos} ${fallidos === 1 ? "fallido" : "fallidos"}`);
  const sinFilas = cuenta("sin_filas_libres");
  if (sinFilas > 0) partes.push(`${sinFilas} sin filas libres`);
  const bloqueados = cuenta("bloqueado_privacidad");
  if (bloqueados > 0) partes.push(`${bloqueados} bloqueado${bloqueados === 1 ? "" : "s"} por privacidad`);
  const sinTerminar = estados.filter((e) => !gmTerminado(e)).length;
  if (sinTerminar > 0) partes.push(`${sinTerminar} sin terminar`);
  if (corrida) partes.push(usd(corrida.costo_usd));
  return partes.join(" · ");
}

export const TEXTO_CORRIDA_ESTADO: Record<string, string> = {
  en_curso: "en curso",
  completa: "completa",
  parcial: "parcial",
  detenida: "detenida",
  cancelada: "cancelada",
  abandonada: "abandonada",
};

export const textoEstadoCorrida = (estado: string): string => TEXTO_CORRIDA_ESTADO[estado] ?? estado;

/** «Corrida en curso de J. Pérez: 3 de 27 GM · US$ 0.40». */
export function textoCorridaEnCurso(c: CorridaApi): string {
  const hechos = c.gm_hechos + c.gm_reusados + c.gm_fallidos;
  return `Hay una corrida ${textoEstadoCorrida(c.estado)}${c.usuario_nombre ? ` de ${c.usuario_nombre}` : ""}: ${unidades(hechos)} de ${unidades(c.gm_total)} GM · ${usd(c.costo_usd)}. Mientras siga abierta no se puede iniciar otra (caduca sola tras 30 minutos sin actividad).`;
}
