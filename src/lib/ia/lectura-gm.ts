import { calcularAbsorcion, type FilaAbsorcion } from "./absorcion";
import { baseMovida, configuracionCambiada, estadoPropuestaGM } from "./estado";
import { asignarMeta, contarForzadas, esfuerzoGM, indicadoresFila, ordenarPorContraMetodo, type FilaMeta, type PesoFilaMeta, type PlanMeta } from "./meta";
import type {
  AvisoIa,
  BanderaIa,
  ConfianzaIa,
  EstadoMetaFila,
  EstadoPropuestaGM,
  GMIaDetalleApi,
  GMIaResumenApi,
  IaFilaApi,
  MetaGMApi,
  MotivoDesactualizadaIa,
  SenalIa,
} from "./tipos-api";

/**
 * Lectura de la propuesta de un GM (ficha 07e, §3.1, §5.1 y §5.3). Pura: junta la propuesta guardada (inmutable) con el estado de HOY de las filas y
 * devuelve lo que ve la pantalla. El reparto se recalcula en cada lectura (`asignarMeta` con la meta y las fijas de hoy, D7): la salida del modelo no
 * se reescribe nunca. Los textos de la IA salen como texto plano; la pantalla los pinta como texto.
 */

/** Una fila base del GM tal como está HOY. */
export type FilaHoy = {
  fila_id: string;
  clave: string;
  linea: string;
  equivalencia: string | null;
  agrupacion_marca: string;
  meta: FilaMeta;
  vigente_y1: number | null;
  decidida_y1: boolean;
  vigente_y: number | null;
  decidida_y: boolean;
  /** Solo si quien lee trae el `historico` de la fila. */
  aporte_entrantes?: number | null;
  aporte_salientes?: number | null;
};

export type PropuestaGuardada = {
  id: string;
  created_at: string;
  usuario_nombre: string | null;
  proveedor: string;
  modelo: string;
  version_prompt: string;
  razon_gm: string | null;
  version_metodo: number;
  huella_historia: string;
  meta: MetaGMApi | null;
  costo_usd: number;
  filas: {
    id: string;
    fila_id: string | null;
    fila_clave: string;
    estado_meta: string;
    base_corregida_al_generar: number | null;
    aporte_fijo_al_generar: number | null;
    natural_y1: number | null;
    razon_natural: string | null;
    meta_y1_modelo: number | null;
    meta_y1_al_generar: number | null;
    razon: string | null;
    banderas: string[];
    senales: string[];
    avisos: string[];
    confianza: string | null;
  }[];
};

export type ArgsLecturaGM = {
  gm: { gm_clave: string; genero: string; mundo: string; es_resto: boolean };
  filas: readonly FilaHoy[];
  /** Meta, fijas y libres de HOY. */
  plan: PlanMeta;
  propuesta: PropuestaGuardada | null;
  anteriores: { id: string; created_at: string; proveedor: string; modelo: string; version_prompt: string }[];
  /** El último intento del GM terminó sin propuesta porque el control de salida bloqueó el envío, o falló. */
  ultimo_intento: "bloqueado_privacidad" | "fallido" | null;
  huella_historia_hoy: string;
  version_metodo_hoy: number;
  capacidad_encendida: boolean;
  /** El servicio de IA está disponible hoy (entorno, configuración, clave y topes). */
  servicio_disponible: boolean;
  config: { modelo: string; version_prompt: string } | null;
  contexto: { aperturas_y1: number; cierres_y1: number };
};

export type LecturaGM = { resumen: GMIaResumenApi; detalle: GMIaDetalleApi; porFila: Map<string, IaFilaApi> };

const CONFIANZAS: readonly string[] = ["alta", "media", "baja"];
const confianzaDe = (c: string | null): ConfianzaIa | null => (c !== null && CONFIANZAS.includes(c) ? (c as ConfianzaIa) : null);
const unicos = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Motivo (en castellano llano) por el que «Aceptar IA» no está disponible; `null` si lo está. */
export function motivoNoAceptable(a: { capacidad_encendida: boolean; servicio_disponible: boolean; estado: EstadoPropuestaGM; estado_meta: EstadoMetaFila; meta_y1: number | null }): string | null {
  if (!a.capacidad_encendida) return "La IA está apagada para esta capacidad.";
  if (!a.servicio_disponible) return "El servicio de IA no está disponible ahora.";
  if (a.estado === "desactualizada") return "La propuesta está desactualizada: regenera este género y mundo.";
  if (a.estado === "fallida" || a.estado === "bloqueado_privacidad") return "La última propuesta de este género y mundo no se pudo generar.";
  if (a.estado === "sin_propuesta" || a.estado === "sin_filas_libres") return "Este género y mundo no tiene propuesta de IA.";
  if (a.estado_meta !== "libre") return "La fila es fija: ya está decidida, tiene su propio porcentaje o es de cola larga.";
  if (a.meta_y1 === null) return "La IA no dio una cifra para esta fila.";
  return null;
}

export function lecturaDeGM(a: ArgsLecturaGM): LecturaGM {
  const { plan, propuesta } = a;
  const metaHoy = plan.meta;
  const filasPorId = new Map(a.filas.map((f) => [f.fila_id, f]));
  const libresHoy = a.filas.filter((f) => plan.estados.get(f.fila_id) === "libre").sort((x, y) => (x.clave < y.clave ? -1 : x.clave > y.clave ? 1 : 0));
  const filaGuardada = new Map((propuesta?.filas ?? []).map((f) => [f.fila_clave, f]));
  const sobreCorregida = (metaHoy?.sobre_base ?? "corregida") === "corregida";

  // Reparto de HOY con la meta y las fijas de hoy; el peso de cada libre es el que guardó la IA (o su `P^GM` de respaldo).
  const pesos: PesoFilaMeta[] = libresHoy.map((f) => {
    const g = filaGuardada.get(f.clave);
    return {
      fila_id: f.fila_id,
      clave: f.clave,
      p_gm: plan.p_gm.get(f.fila_id) ?? 0,
      meta_y1_modelo: g && g.estado_meta === "libre" ? g.meta_y1_modelo : null,
      natural_y1: g?.natural_y1 ?? null,
      base_s: sobreCorregida ? f.meta.base_corregida : f.meta.base,
    };
  });
  const asignacion = propuesta && metaHoy ? asignarMeta(metaHoy.meta_libre, pesos) : null;
  const aHoy = asignacion?.a ?? null;

  // Absorción (§5.1): solo con propuesta y con meta en los dos momentos.
  let absorcion: ReturnType<typeof calcularAbsorcion> | null = null;
  if (propuesta && propuesta.meta && metaHoy) {
    const filasAbs: FilaAbsorcion[] = [];
    for (const g of propuesta.filas) {
      const hoy = [...filasPorId.values()].find((f) => f.clave === g.fila_clave);
      if (!hoy) continue;
      const libreHoy = plan.estados.get(hoy.fila_id) === "libre";
      filasAbs.push({
        fila_id: hoy.fila_id,
        a_hoy: libreHoy && aHoy ? (aHoy.get(hoy.fila_id) ?? null) : null,
        aporte_hoy: libreHoy ? null : (plan.aportes.get(hoy.fila_id) ?? null),
        meta_y1_al_generar: g.estado_meta === "libre" ? g.meta_y1_al_generar : null,
        aporte_fijo_al_generar: g.estado_meta === "libre" ? null : g.aporte_fijo_al_generar,
      });
    }
    absorcion = calcularAbsorcion({ filas: filasAbs, meta_gm_hoy: metaHoy.meta_gm, meta_gm_al_generar: propuesta.meta.meta_gm });
  }

  // Estado del GM.
  const sinCifra = libresHoy.filter((f) => {
    const g = filaGuardada.get(f.clave);
    return !g || g.estado_meta !== "libre" || g.meta_y1_modelo === null;
  });
  const { estado, motivos } = estadoPropuestaGM({
    ultimo_intento_bloqueado: a.ultimo_intento === "bloqueado_privacidad",
    ultimo_intento_fallido: a.ultimo_intento === "fallido",
    hay_propuesta: propuesta !== null,
    filas_libres: libresHoy.length,
    huella_historia_hoy: a.huella_historia_hoy,
    huella_historia_guardada: propuesta?.huella_historia ?? null,
    libres_sin_cifra_p_gm: sinCifra.reduce((s, f) => s + (plan.p_gm.get(f.fila_id) ?? 0), 0),
    meta_libre: metaHoy?.meta_libre ?? null,
    version_metodo_hoy: a.version_metodo_hoy,
    version_metodo_propuesta: propuesta?.version_metodo ?? null,
    capacidad_encendida: a.capacidad_encendida,
    absorbido_pct: absorcion?.gm.absorbido_pct ?? null,
  });

  // Por fila (solo las que están en la propuesta).
  const porFila = new Map<string, IaFilaApi>();
  const filasDetalle: GMIaDetalleApi["filas"] = [];
  const brechas: (number | null)[] = [];
  const naturalesLibres: (number | null)[] = [];
  if (propuesta) {
    for (const g of propuesta.filas) {
      const hoy = a.filas.find((f) => f.clave === g.fila_clave);
      if (!hoy) continue;
      const estadoMeta: EstadoMetaFila = plan.estados.get(hoy.fila_id) ?? "sin_base";
      const A = estadoMeta === "libre" && aHoy ? (aHoy.get(hoy.fila_id) ?? null) : null;
      const ind = A === null ? null : indicadoresFila({ a: A, natural_y1: g.natural_y1, p_metodo: hoy.meta.propuesto, base: hoy.meta.base, base_corregida: hoy.meta.base_corregida });
      const abs = absorcion?.filas.get(hoy.fila_id) ?? null;
      const avisos = unicos<AvisoIa>([...(g.avisos as AvisoIa[]), ...(abs?.avisos ?? []), ...(asignacion?.avisos_fila.get(hoy.fila_id) ?? [])]);
      const movida = baseMovida(hoy.meta.base_corregida, g.base_corregida_al_generar);
      if (movida && !avisos.includes(movida)) avisos.push(movida);
      if (g.estado_meta === "libre") {
        naturalesLibres.push(g.natural_y1);
        if (ind) brechas.push(ind.brecha_pct);
      }
      const fila: IaFilaApi = {
        fila_id: hoy.fila_id,
        propuesta_fila_id: g.id,
        estado_meta: estadoMeta,
        estado_gm: estado,
        motivos,
        natural_y1: g.natural_y1,
        razon_natural: g.razon_natural,
        meta_y1: A,
        meta_y1_al_generar: g.meta_y1_al_generar,
        absorbido_u: abs?.absorbido_u ?? null,
        absorbido_pct: abs?.absorbido_pct ?? null,
        brecha_u: ind?.brecha_u ?? null,
        brecha_pct: ind?.brecha_pct ?? null,
        contra_metodo_u: ind?.contra_metodo_u ?? null,
        pct_sobre_corregida: ind?.pct_sobre_corregida ?? null,
        pct_sobre_real: ind?.pct_sobre_real ?? null,
        razon: g.razon,
        banderas: g.banderas as BanderaIa[],
        senales: g.senales as SenalIa[],
        confianza: confianzaDe(g.confianza),
        avisos,
        aceptable: { y1: false, motivo: null },
      };
      const motivo = motivoNoAceptable({ capacidad_encendida: a.capacidad_encendida, servicio_disponible: a.servicio_disponible, estado, estado_meta: estadoMeta, meta_y1: A });
      fila.aceptable = { y1: motivo === null, motivo };
      porFila.set(hoy.fila_id, fila);
      filasDetalle.push({
        ...fila,
        linea: hoy.linea,
        equivalencia: hoy.equivalencia,
        agrupacion_marca: hoy.agrupacion_marca,
        base: hoy.meta.base,
        base_corregida: hoy.meta.base_corregida,
        aporte_entrantes: hoy.aporte_entrantes ?? null,
        aporte_salientes: hoy.aporte_salientes ?? null,
        metodo_y1: hoy.meta.propuesto,
        vigente_y1: hoy.vigente_y1,
        decidida_y1: hoy.decidida_y1,
        vigente_y: hoy.vigente_y,
        decidida_y: hoy.decidida_y,
      });
    }
  }

  const ordenadas = ordenarPorContraMetodo(filasDetalle.map((f) => ({ ...f, clave: filasPorId.get(f.fila_id)?.clave ?? "" }))).map((f) => {
    const { clave, ...resto } = f;
    void clave;
    return resto;
  });
  const { forzadas, ceden } = contarForzadas(brechas);
  const colaLarga = a.filas.filter((f) => plan.estados.get(f.fila_id) === "fija_cola_larga");
  const meta = metaHoy;
  const resumen: GMIaResumenApi = {
    gm_clave: a.gm.gm_clave,
    genero: a.gm.genero,
    mundo: a.gm.mundo,
    es_resto: a.gm.es_resto,
    meta,
    estado,
    motivos,
    configuracion_cambiada: propuesta !== null && configuracionCambiada(propuesta, a.config),
    natural_libres: propuesta && naturalesLibres.some((n) => n !== null) ? naturalesLibres.reduce<number>((s, n) => s + (n ?? 0), 0) : null,
    meta_libre: meta?.meta_libre ?? null,
    esfuerzo_pct: propuesta && meta ? esfuerzoGM(meta.meta_libre, naturalesLibres) : null,
    filas_forzadas: forzadas,
    filas_que_ceden: ceden,
    absorcion: absorcion?.gm ?? null,
    filas_y_sin_decidir: libresHoy.filter((f) => !f.decidida_y).length,
    propuesta: propuesta
      ? { id: propuesta.id, created_at: propuesta.created_at, usuario_nombre: propuesta.usuario_nombre, proveedor: propuesta.proveedor, modelo: propuesta.modelo, version_prompt: propuesta.version_prompt, razon_gm: propuesta.razon_gm, costo_usd: propuesta.costo_usd }
      : null,
  };
  const detalle: GMIaDetalleApi = {
    ...resumen,
    filas: ordenadas,
    contexto: {
      aperturas_y1: a.contexto.aperturas_y1,
      cierres_y1: a.contexto.cierres_y1,
      cola_larga: { filas: colaLarga.length, unidades: colaLarga.reduce((s, f) => s + (plan.aportes.get(f.fila_id) ?? 0), 0) },
      vista_previa_curvas: null,
    },
    anteriores: a.anteriores,
  };
  return { resumen, detalle, porFila };
}

/** Motivos de desactualización como texto para los errores (`ia_desactualizada`). */
export const textoMotivosDesactualizada = (motivos: readonly MotivoDesactualizadaIa[]): string => {
  const t: Record<MotivoDesactualizadaIa, string> = {
    historia_cambiada: "cambiaron los datos de venta, las curvas o los factores",
    filas_libres_nuevas: "hay filas libres nuevas sin cifra de la IA",
    version_metodo: "cambió la versión del método",
    capacidad_apagada: "la capacidad de IA está apagada",
  };
  return motivos.map((m) => t[m]).join("; ");
};
