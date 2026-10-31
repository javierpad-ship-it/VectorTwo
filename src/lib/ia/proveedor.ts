import type { UsoTokensIa } from "./tipos-api";

/**
 * Interfaz del proveedor de IA (ficha 07e, §3.8 y §3.11): tipos de petición y respuesta NEUTRALES y errores tipados. SIN SDK: el primer
 * adaptador es OpenAI (`proveedor-openai.ts`, tanda 2) y las pruebas usan `tests/ia.proveedor-falso.ts`; Claude sería un adaptador futuro.
 * La petición no lleva ningún campo de caché. Nada de lo enviado ni lo recibido va en los mensajes de error ni en los logs.
 */

/** Motivo de fin neutral (§3.11): el adaptador traduce el del proveedor. */
export type FinIa = "normal" | "limite_salida" | "rechazo" | "otro";

export type PeticionIa = {
  modelo: string;
  /** Texto fijo del prompt: va siempre primero (prefijo estable). */
  sistema: string;
  /** JSON canónico del bloque del lote, después del texto fijo (idéntico en `natural` y `reparto`: prefijo estable). */
  bloque: string;
  /** JSON canónico del sufijo de la tarea; va al final. */
  sufijo: string;
  /** JSON Schema de la salida (subconjunto que admite el proveedor). */
  esquema: Record<string, unknown>;
  nombre_esquema: string;
  max_tokens: number;
  /** `null` = la temperatura mínima que admita el modelo; con razonamiento no se fija. El adaptador omite lo que el modelo no admita. */
  temperatura: number | null;
  /** Semilla fija por corrida si el proveedor la admite; `null` = no se envía. No garantiza la misma salida (determinismo parcial). */
  semilla: number | null;
  /** Presupuesto de razonamiento; 0 = sin. El adaptador lo traduce a lo que admita el modelo. */
  presupuesto_razonamiento: number;
  timeout_ms: number;
  /** Reintento por salida inválida: errores resumidos SIN datos («faltan 3 filas»). */
  correccion?: string | null;
};

export type RespuestaIa = {
  /** Lo que devolvió el modelo (el JSON de la salida estructurada). Se valida siempre con zod. */
  texto: string;
  /** Tokens disjuntos: `entrada` sin la parte servida desde caché, `entrada_cache` y `salida` (con el razonamiento si se cobra como salida). */
  uso: UsoTokensIa;
  fin: FinIa;
  /** Id de la petición en el proveedor (soporte); nunca cabeceras. */
  id_solicitud: string | null;
  modelo_respuesta: string | null;
  duracion_ms: number;
};

export interface ProveedorIA {
  llamar(peticion: PeticionIa, opciones?: { senal?: AbortSignal }): Promise<RespuestaIa>;
}

export type TipoErrorProveedor = "limite" | "servicio" | "tiempo_agotado" | "solicitud_invalida" | "clave_invalida";

/** Error base del proveedor. El mensaje es genérico: nunca lleva la clave, cabeceras ni datos. */
export class ErrorProveedorIa extends Error {
  readonly tipo: TipoErrorProveedor;
  /** Código para `ia_llamadas.error_codigo`: `429`, `500`, `503`, `tiempo`, `400`, `401` (el código HTTP que corresponda). */
  readonly codigo: string;
  /** Lo que pidió el proveedor (`retry-after` o cabeceras de límite), en milisegundos. */
  readonly esperar_ms: number | null;

  constructor(tipo: TipoErrorProveedor, codigo: string, mensaje: string, esperar_ms: number | null = null) {
    super(mensaje);
    this.name = "ErrorProveedorIa";
    this.tipo = tipo;
    this.codigo = codigo;
    this.esperar_ms = esperar_ms;
  }
}

/** `429`: no gasta intentos; el navegador espera `esperar_ms`. */
export class ErrorLimiteProveedor extends ErrorProveedorIa {
  constructor(esperar_ms: number | null = null) {
    super("limite", "429", "El proveedor está limitando las peticiones.", esperar_ms);
  }
}

/** `500`, `502`, `503`, `504`, sobrecarga del proveedor (el código que use) o error de red: hasta 3 intentos por paso. */
export class ErrorServicioProveedor extends ErrorProveedorIa {
  constructor(codigo: string = "500", esperar_ms: number | null = null) {
    super("servicio", codigo, "El proveedor no respondió bien.", esperar_ms);
  }
}

export class ErrorTiempoAgotado extends ErrorProveedorIa {
  constructor() {
    super("tiempo_agotado", "tiempo", "El proveedor tardó demasiado en responder.");
  }
}

/** `400`: sin reintento. */
export class ErrorSolicitudInvalida extends ErrorProveedorIa {
  constructor() {
    super("solicitud_invalida", "400", "El proveedor rechazó la petición.");
  }
}

/** `401` / `403`: sin reintento; el servicio queda en `clave_invalida`. */
export class ErrorClaveInvalida extends ErrorProveedorIa {
  constructor() {
    super("clave_invalida", "401", "La clave del proveedor no es válida.");
  }
}

export const esErrorProveedorIa = (e: unknown): e is ErrorProveedorIa => e instanceof ErrorProveedorIa;
