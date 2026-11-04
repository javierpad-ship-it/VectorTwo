import { abortable } from "./rpc-abortable";
import { NextResponse } from "next/server";
import type { PeticionIa, ProveedorIA, RespuestaIa } from "@/lib/ia/proveedor";
import { ProveedorFalso, type RespuestaGuionada, USO_BASE, valida } from "./ia.proveedor-falso";
import { clienteFalso, estado, reiniciar as reiniciarBase, sembrar, type Fila } from "./proyeccion.fake-db";

/**
 * Base falsa de la propuesta con IA (ficha 07e). Envuelve la base falsa de M7 (`proyeccion.fake-db.ts`) y le añade: los valores por defecto y los únicos
 * de las tablas `ia_*` de la 0030, las funciones `venta_lineas_ia` y `registrar_propuesta_ia_gm` (con sus errores `IA001` a `IA003`) y un proveedor
 * falso DINÁMICO que contesta lo que pide la entrada (así se prueban GM de cualquier tamaño). Nunca toca la red ni datos reales.
 */

export { estado, sembrar, type Fila };

type ErrorDb = { code: string; message: string; details: null; hint: null };
const err = (code: string, message: string): ErrorDb => ({ code, message, details: null, hint: null });

export type EstadoIa = {
  /** Lo que devuelve `venta_lineas_ia`; por defecto, vacío. */
  ventaLineas: (args: { p_gml_ids: string[]; p_grupos: Record<string, string>; p_desde: string; p_hasta: string }) => unknown;
  llamadasVentaIa: number;
  /** Hace fallar la próxima llamada al `rpc` `registrar_propuesta_ia_gm` con ese código (una vez). */
  fallaRegistro: string | null;
  /** Reloj (ISO) para los valores por defecto de las filas nuevas. */
  ahora: () => string;
};

export const estadoIa: EstadoIa = {
  ventaLineas: () => ({ dic: { filas: [], claves: [], desde: "2023-01-01" }, f: [], c: [], p: [], u: [], cargas: {} }),
  llamadasVentaIa: 0,
  fallaRegistro: null,
  ahora: () => new Date().toISOString(),
};

export function reiniciar() {
  reiniciarBase();
  estadoIa.ventaLineas = () => ({ dic: { filas: [], claves: [], desde: "2023-01-01" }, f: [], c: [], p: [], u: [], cargas: {} });
  estadoIa.llamadasVentaIa = 0;
  estadoIa.fallaRegistro = null;
  estadoIa.ahora = () => new Date().toISOString();
}

// ─── Defectos y únicos de la 0030 ───

const DEFECTOS: Record<string, () => Fila> = {
  ia_configuraciones: () => ({ estado: "vigente", capacidades: [], aprobada_at: estadoIa.ahora(), activo: true, terminos_extra: [], nota: null, evaluacion_id: null, incluir_cola_larga: false, presupuesto_razonamiento: 0, max_filas_llamada: 60, tope_usd_corrida: 10, tope_usd_mes: 60, tope_usd_dia_usuario: 15 }),
  ia_evaluaciones: () => ({ estado: "en_curso", iniciada_at: estadoIa.ahora(), activo: true, resultados: null, veredicto: null, terminada_at: null }),
  ia_corridas: () => ({ estado: "en_curso", iniciada_at: estadoIa.ahora(), ultima_actividad_at: estadoIa.ahora(), activo: true, terminada_at: null, motivo_fin: null, proyeccion_id: null, evaluacion_id: null, configuracion_id: null }),
  ia_corrida_gms: () => ({ estado: "pendiente", pliegue: "", parcial: {}, bloque_ids: [], plan: null, modo: null, huella_gm: null, candado_token: null, candado_desde: null, propuesta_gm_id: null, referencia: null, error_codigo: null }),
  ia_llamadas: () => ({ tokens_entrada: 0, tokens_entrada_cache: 0, tokens_salida: 0, costo_usd: 0, esperar_ms: null, error_codigo: null, error_detalle: null, modelo_respuesta: null, id_solicitud: null, entrada_bloque_id: null, entrada_sufijo_id: null, created_at: estadoIa.ahora() }),
  ia_entradas: () => ({}),
};

/** Siembra filas de una tabla `ia_*` con los valores por defecto de la base. */
export function sembrarIa(tabla: string, filas: Fila[]): Fila[] {
  const d = DEFECTOS[tabla];
  return sembrar(tabla, filas.map((f) => ({ ...(d ? d() : {}), ...f })));
}

function comprobar(tabla: string, nuevas: Fila[]): ErrorDb | null {
  const hay = (t: string) => estado.tablas[t] ?? [];
  const propias = [...hay(tabla)];
  for (const n of nuevas) {
    if (tabla === "ia_corridas" && n.estado === "en_curso" && n.proyeccion_id && propias.some((f) => f.estado === "en_curso" && f.proyeccion_id === n.proyeccion_id)) return err("23505", 'duplicate key value violates unique constraint "ia_corridas_en_curso_proyeccion_uniq"');
    if (tabla === "ia_evaluaciones" && n.estado === "en_curso" && propias.some((f) => f.estado === "en_curso")) return err("23505", 'duplicate key value violates unique constraint "ia_evaluaciones_en_curso_uniq"');
    if (tabla === "ia_configuraciones") {
      if (propias.some((f) => f.version === n.version)) return err("23505", 'duplicate key value violates unique constraint "ia_configuraciones_version_key"');
      if (n.estado === "vigente" && propias.some((f) => f.estado === "vigente")) return err("23505", 'duplicate key value violates unique constraint "ia_configuraciones_vigente_uniq"');
      if (n.proveedor === undefined || n.proveedor === null) return err("23502", 'null value in column "proveedor" violates not-null constraint');
    }
    if (tabla === "ia_corrida_gms" && propias.some((f) => f.corrida_id === n.corrida_id && f.pliegue === n.pliegue && f.gm_clave === n.gm_clave)) return err("23505", 'duplicate key value violates unique constraint "ia_corrida_gms_corrida_pliegue_gm_key"');
    if (tabla === "ia_entradas" && propias.some((f) => f.corrida_id === n.corrida_id && f.huella === n.huella)) return err("23505", 'duplicate key value violates unique constraint "ia_entradas_corrida_huella_key"');
    propias.push(n);
  }
  return null;
}

function constructorDeError(e: ErrorDb) {
  const q = { select: () => q, single: () => q, maybeSingle: () => q, then: <A, B>(ok?: ((v: { data: null; error: ErrorDb }) => A) | null, ko?: ((r: unknown) => B) | null) => Promise.resolve({ data: null, error: e }).then(ok, ko) };
  return q;
}

function desde(tabla: string) {
  const q = clienteFalso().from(tabla);
  const defecto = DEFECTOS[tabla];
  if (!defecto) return q;
  return new Proxy(q, {
    get(objetivo, prop, receptor) {
      if (prop === "insert") {
        return (carga: Fila | Fila[]) => {
          const lista = Array.isArray(carga) ? carga : [carga];
          const completas = lista.map((f) => ({ ...defecto(), ...f }));
          const e = comprobar(tabla, completas);
          if (e) return constructorDeError(e);
          return objetivo.insert(Array.isArray(carga) ? completas : completas[0]);
        };
      }
      const v = Reflect.get(objetivo, prop, receptor) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(objetivo) : v;
    },
  });
}

// ─── registrar_propuesta_ia_gm ───

type PayloadFila = Fila & { fila_clave: string };

function registrar(p: Fila): { data: string | null; error: ErrorDb | null } {
  if (estadoIa.fallaRegistro) {
    const code = estadoIa.fallaRegistro;
    estadoIa.fallaRegistro = null;
    return { data: null, error: err(code, "registro") };
  }
  const gms = estado.tablas.ia_corrida_gms ?? [];
  const gm = gms.find((g) => g.id === p.corrida_gm_id);
  if (!gm || gm.estado !== "en_proceso" || gm.candado_token !== p.candado_token) return { data: null, error: err("IA001", "gm_en_proceso") };
  const corrida = (estado.tablas.ia_corridas ?? []).find((c) => c.id === gm.corrida_id);
  if (!corrida || corrida.estado !== "en_curso") return { data: null, error: err("IA002", "corrida_terminada") };
  let id: string;
  if (p.reusa_propuesta_id) {
    const previa = (estado.tablas.ia_propuestas_gm ?? []).find((x) => x.id === p.reusa_propuesta_id && x.gm_clave === gm.gm_clave);
    if (!previa) return { data: null, error: err("IA003", "propuesta_no_reusable") };
    id = previa.id as string;
    gm.huella_gm = (p.huella_gm as string) ?? gm.huella_gm;
  } else {
    const prop = p.propuesta as Fila;
    const filas = (p.filas as PayloadFila[]) ?? [];
    const claves = new Set<string>();
    for (const f of filas) {
      if (claves.has(f.fila_clave)) return { data: null, error: err("23505", 'duplicate key value violates unique constraint "ia_propuestas_filas_propuesta_fila_key"') };
      claves.add(f.fila_clave);
    }
    const [creada] = sembrar("ia_propuestas_gm", [
      {
        corrida_id: gm.corrida_id,
        corrida_gm_id: gm.id,
        proyeccion_id: corrida.proyeccion_id,
        pliegue: gm.pliegue,
        gm_clave: gm.gm_clave,
        proveedor: corrida.proveedor,
        modelo: corrida.modelo,
        version_prompt: corrida.version_prompt,
        banderas_gm: [],
        avisos: [],
        razon_gm: null,
        desvio_suma_modelo: null,
        meta: null,
        perfil_id: null,
        usuario_nombre: null,
        ...prop,
      },
    ]);
    id = creada.id as string;
    sembrar(
      "ia_propuestas_filas",
      filas.map((f) => ({ fila_id: null, base_al_generar: null, base_corregida_al_generar: null, p_gm_al_generar: null, aporte_fijo_al_generar: null, natural_y1: null, razon_natural: null, meta_y1_modelo: null, meta_y1_al_generar: null, razon: null, confianza: null, ...f, propuesta_gm_id: id }))
    );
    gm.huella_gm = (prop.huella_gm as string) ?? gm.huella_gm;
  }
  gm.estado = p.reusa_propuesta_id ? "reusado" : "hecho";
  gm.propuesta_gm_id = id;
  gm.candado_token = null;
  gm.candado_desde = null;
  gm.error_codigo = null;
  corrida.ultima_actividad_at = estadoIa.ahora();
  return { data: id, error: null };
}

export function clienteIaFalso() {
  const base = clienteFalso();
  return {
    from: (t: string) => desde(t),
    rpc: (nombre: string, args: Record<string, unknown>) => {
      if (nombre === "venta_lineas_ia") {
        estadoIa.llamadasVentaIa += 1;
        return abortable(Promise.resolve({ data: estadoIa.ventaLineas(args as never), error: null }));
      }
      if (nombre === "registrar_propuesta_ia_gm") return Promise.resolve(registrar(args.p as Fila));
      return base.rpc(nombre, args);
    },
  };
}

// ─── Guards falsos (los tres roles) ───

export const ROL = { actual: "planner" as "admin" | "planner" | "comprador" | "sin_sesion" };
export const PERFIL_IA = { id: "99999999-9999-4999-8999-999999999999", email: "javier@example.com", nombre: "Javier", rol: "planner", activo: true };

const sinSesion = () => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: "No autenticado." }, { status: 401 }) });
const prohibido = (m: string) => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: m }, { status: 403 }) });
const ctx = () => ({ user: {}, perfil: { ...PERFIL_IA, rol: ROL.actual }, rol: ROL.actual, response: null });

export function guardIaFalso() {
  return {
    requireUser: async () => (ROL.actual === "sin_sesion" ? sinSesion() : ctx()),
    requirePlanner: async () => (ROL.actual === "sin_sesion" ? sinSesion() : ROL.actual === "comprador" ? prohibido("Tu rol es de solo lectura.") : ctx()),
    requireAdmin: async () => (ROL.actual === "sin_sesion" ? sinSesion() : ROL.actual !== "admin" ? prohibido("Requiere permisos de administrador.") : ctx()),
  };
}

// ─── Proveedor falso dinámico ───

type SalidaFilas = { filas: { f: string; y1: { pedir: boolean; base_corregida: number | null; base: number | null } }[] };

/**
 * Contesta lo que pide la entrada: `natural` con `natural_y1 ≈ B' × 1,02`; `reparto` con pesos proporcionales a los naturales que suman `del_lote`
 * (por defecto exactos); `lineas` con la sub-meta proporcional al natural de cada línea. Antes consume el guion (errores, JSON roto, cortes…).
 */
export class ProveedorDinamico extends ProveedorFalso implements ProveedorIA {
  /** Cambia la suma que devuelve el reparto (1,2 = +20 %). */
  factorSuma = 1;
  /** Después de esta cantidad de llamadas, la dinámica se detiene con un error (para probar a medias). */
  constructor(guion: RespuestaGuionada[] = []) {
    super(guion);
  }

  override async llamar(peticion: PeticionIa): Promise<RespuestaIa> {
    if ((this as unknown as { guion: unknown[] }).guion.length > 0) return super.llamar(peticion);
    this.llamadas += 1;
    this.peticiones.push(peticion);
    return valida(this.contestar(peticion), { uso: USO_BASE });
  }

  private contestar(p: PeticionIa): unknown {
    const sufijo = JSON.parse(p.sufijo) as { tarea: string; meta?: { del_lote: number }; naturales?: { f: string; natural_y1: number | null }[] };
    const bloque = JSON.parse(p.bloque) as SalidaFilas & { lineas?: { l: string; natural_y1: number }[]; meta?: { libre: number } };
    if (sufijo.tarea === "natural") {
      return {
        version_salida: 2,
        filas: bloque.filas.filter((f) => f.y1.pedir).map((f) => ({ f: f.f, natural_y1: Math.round((f.y1.base_corregida ?? f.y1.base ?? 0) * 1.02), razon_natural: "Crece 2 % sobre su base.", banderas: [], confianza: "media" })),
      };
    }
    if (sufijo.tarea === "lineas") {
      const lineas = bloque.lineas ?? [];
      const total = lineas.reduce((s, l) => s + l.natural_y1, 0);
      const meta = bloque.meta?.libre ?? 0;
      return { version_salida: 2, razon_gm: "Se reparte por línea según su natural.", banderas_gm: [], lineas: repartir(meta * this.factorSuma, lineas.map((l) => l.natural_y1 / (total || 1))).map((v, i) => ({ l: lineas[i].l, meta_y1: v, razon: "Proporcional a su natural." })) };
    }
    const naturales = sufijo.naturales ?? [];
    const total = naturales.reduce((s, n) => s + (n.natural_y1 ?? 0), 0);
    const delLote = sufijo.meta?.del_lote ?? 0;
    return {
      version_salida: 2,
      razon_gm: "La meta se reparte sobre los naturales.",
      banderas_gm: [],
      filas: repartir(delLote * this.factorSuma, naturales.map((n) => (n.natural_y1 ?? 0) / (total || 1))).map((v, i) => ({ f: naturales[i].f, meta_y1: v, razon: "Proporcional a su natural.", banderas: [] })),
    };
  }
}

/** Reparte `total` en enteros según pesos que suman 1 (el último absorbe el redondeo). */
function repartir(total: number, pesos: number[]): number[] {
  const r = pesos.map((w) => Math.floor(total * w));
  const resto = Math.round(total) - r.reduce((s, x) => s + x, 0);
  if (r.length > 0) r[r.length - 1] += resto;
  return r;
}
