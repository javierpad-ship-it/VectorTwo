import {
  PARAMETROS_POR_DEFECTO,
  type CalcularCuerpo,
  type ParametrosCurvas,
  type TratamientoAtipicos,
} from "@/lib/curvas/tipos-api";
import { esPeriodoValido } from "@/lib/ventas/periodo";

/**
 * Formulario de parámetros de «Calcular» (M6, paso 2). Los números se editan
 * como texto (así no se pierde lo que el usuario escribe a medias) y se
 * validan al calcular con los mismos rangos de `calcularSchema`. Los umbrales
 * que son fracciones (35 %, 5 %, 15 %) se muestran en porcentaje. Puro.
 */

export type FormularioParametros = {
  /** `aaaa-mm`; vacío = el último mes publicado y cerrado. */
  hasta_periodo: string;
  solo_tiendas_completas: boolean;
  exigir_venta_todo_el_ano: boolean;
  meses_tienda_nueva: string;
  /** En porcentaje (35). */
  umbral_tienda_dominante: string;
  tratamiento_atipicos: TratamientoAtipicos;
  umbral_forma: string;
  max_meses_hueco: string;
  min_unidades_ano: string;
  umbral_cambio_volumen: string;
  /** Fracción tal cual (0.25: un cuarto del ruido entre años normales). */
  margen_ruido: string;
  /** En porcentaje (5). */
  peso_minimo_diagnostico: string;
  /** En porcentaje (15). */
  umbral_liquidacion: string;
  marcar_referencia: boolean;
};

export type CampoNumerico =
  | "meses_tienda_nueva"
  | "umbral_tienda_dominante"
  | "umbral_forma"
  | "max_meses_hueco"
  | "min_unidades_ano"
  | "umbral_cambio_volumen"
  | "margen_ruido"
  | "peso_minimo_diagnostico"
  | "umbral_liquidacion";

type ReglaCampo = { etiqueta: string; min: number; max: number | null; entero: boolean; /** Factor entre lo que se escribe y lo que se envía (porcentaje → fracción). */ escala: number };

/** Rangos de `calcularSchema`, expresados en lo que ve el usuario. */
export const REGLAS_CAMPOS: Record<CampoNumerico, ReglaCampo> = {
  meses_tienda_nueva: { etiqueta: "Meses de tienda nueva", min: 0, max: 36, entero: true, escala: 1 },
  umbral_tienda_dominante: { etiqueta: "Umbral de tienda dominante (%)", min: 10, max: 90, entero: false, escala: 0.01 },
  umbral_forma: { etiqueta: "Piso del umbral de forma (pp)", min: 0.5, max: 50, entero: false, escala: 1 },
  max_meses_hueco: { etiqueta: "Máximo de meses con huecos", min: 1, max: 6, entero: true, escala: 1 },
  min_unidades_ano: { etiqueta: "Mínimo de unidades por año", min: 0, max: null, entero: true, escala: 1 },
  umbral_cambio_volumen: { etiqueta: "Umbral de cambio de volumen (veces)", min: 1.5, max: 10, entero: false, escala: 1 },
  margen_ruido: { etiqueta: "Margen sobre el ruido", min: 0, max: 1, entero: false, escala: 1 },
  peso_minimo_diagnostico: { etiqueta: "Peso mínimo para diagnosticar una tienda (%)", min: 0, max: 50, entero: false, escala: 0.01 },
  umbral_liquidacion: { etiqueta: "Umbral de liquidación (%)", min: 5, max: 50, entero: false, escala: 0.01 },
};

const redondear = (n: number) => Math.round(n * 1e6) / 1e6;
const aTexto = (n: number) => String(redondear(n));

/** El formulario con los valores de la corrida (o los por defecto). */
export function formularioDesdeParametros(p: ParametrosCurvas = PARAMETROS_POR_DEFECTO, hasta = "", marcarReferencia = false): FormularioParametros {
  return {
    hasta_periodo: hasta,
    solo_tiendas_completas: p.solo_tiendas_completas,
    exigir_venta_todo_el_ano: p.exigir_venta_todo_el_ano,
    meses_tienda_nueva: aTexto(p.meses_tienda_nueva),
    umbral_tienda_dominante: aTexto(p.umbral_tienda_dominante * 100),
    tratamiento_atipicos: p.tratamiento_atipicos,
    umbral_forma: aTexto(p.umbral_forma),
    max_meses_hueco: aTexto(p.max_meses_hueco),
    min_unidades_ano: aTexto(p.min_unidades_ano),
    umbral_cambio_volumen: aTexto(p.umbral_cambio_volumen),
    margen_ruido: aTexto(p.margen_ruido),
    peso_minimo_diagnostico: aTexto(p.peso_minimo_diagnostico * 100),
    umbral_liquidacion: aTexto(p.umbral_liquidacion * 100),
    marcar_referencia: marcarReferencia,
  };
}

export const FORMULARIO_POR_DEFECTO: FormularioParametros = formularioDesdeParametros();

/** Número escrito con punto o coma decimal; `null` si no es un número finito. */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type ValidacionFormulario = {
  /** El cuerpo listo para `POST /api/curvas/calcular`; `null` si hay errores. */
  cuerpo: CalcularCuerpo | null;
  errores: Partial<Record<CampoNumerico | "hasta_periodo", string>>;
};

/** Valida el formulario con los rangos del esquema de la API y arma el cuerpo con todos los parámetros. */
export function validarFormulario(f: FormularioParametros): ValidacionFormulario {
  const errores: ValidacionFormulario["errores"] = {};
  const valores: Partial<Record<CampoNumerico, number>> = {};

  for (const campo of Object.keys(REGLAS_CAMPOS) as CampoNumerico[]) {
    const r = REGLAS_CAMPOS[campo];
    const n = leerNumero(f[campo]);
    if (n === null) {
      errores[campo] = `${r.etiqueta}: escribe un número.`;
      continue;
    }
    if (r.entero && !Number.isInteger(n)) {
      errores[campo] = `${r.etiqueta}: debe ser un número entero.`;
      continue;
    }
    if (n < r.min || (r.max !== null && n > r.max)) {
      errores[campo] = `${r.etiqueta}: entre ${r.min} y ${r.max ?? "∞"}.`;
      continue;
    }
    valores[campo] = redondear(n * r.escala);
  }

  if (f.hasta_periodo !== "" && !esPeriodoValido(f.hasta_periodo)) errores.hasta_periodo = "El mes debe tener la forma aaaa-mm.";

  if (Object.keys(errores).length > 0) return { cuerpo: null, errores };

  const cuerpo: CalcularCuerpo = {
    solo_tiendas_completas: f.solo_tiendas_completas,
    exigir_venta_todo_el_ano: f.exigir_venta_todo_el_ano,
    meses_tienda_nueva: valores.meses_tienda_nueva,
    umbral_tienda_dominante: valores.umbral_tienda_dominante,
    tratamiento_atipicos: f.tratamiento_atipicos,
    umbral_forma: valores.umbral_forma,
    max_meses_hueco: valores.max_meses_hueco,
    min_unidades_ano: valores.min_unidades_ano,
    umbral_cambio_volumen: valores.umbral_cambio_volumen,
    margen_ruido: valores.margen_ruido,
    peso_minimo_diagnostico: valores.peso_minimo_diagnostico,
    umbral_liquidacion: valores.umbral_liquidacion,
    marcar_referencia: f.marcar_referencia,
  };
  if (f.hasta_periodo !== "") cuerpo.hasta_periodo = f.hasta_periodo;
  return { cuerpo, errores };
}

/**
 * Query de la vista previa de la red (`GET /api/curvas/red-comparable`): los
 * parámetros que deciden quién entra en la red y quién es «distinta». Vacío si el
 * formulario no es válido.
 */
export function consultaRedComparable(f: FormularioParametros): string | null {
  const { cuerpo } = validarFormulario(f);
  if (!cuerpo) return null;
  const q = new URLSearchParams();
  q.set("solo_tiendas_completas", String(cuerpo.solo_tiendas_completas));
  q.set("exigir_venta_todo_el_ano", String(cuerpo.exigir_venta_todo_el_ano));
  q.set("meses_tienda_nueva", String(cuerpo.meses_tienda_nueva));
  q.set("umbral_tienda_dominante", String(cuerpo.umbral_tienda_dominante));
  q.set("umbral_forma", String(cuerpo.umbral_forma));
  q.set("peso_minimo_diagnostico", String(cuerpo.peso_minimo_diagnostico));
  if (cuerpo.hasta_periodo) q.set("hasta_periodo", cuerpo.hasta_periodo);
  return q.toString();
}

/** ¿El formulario difiere de los valores por defecto o de los de una corrida? (para avisar de cambios sin calcular). */
export function formulariosIguales(a: FormularioParametros, b: FormularioParametros): boolean {
  return (Object.keys(a) as (keyof FormularioParametros)[]).every((k) => a[k] === b[k]);
}
