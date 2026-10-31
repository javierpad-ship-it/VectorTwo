import type { UsoTokensIa } from "./tipos-api";

/**
 * Interfaz del proveedor de IA (ficha 07e, §3 y §3.8): tipos de petición y respuesta y errores tipados. SIN SDK: el primer adaptador es
 * OpenAI (`proveedor-openai.ts`, tanda 2); Claude quedaría como adaptador futuro y las pruebas usan `tests/ia.proveedor-falso.ts`. Nada de lo enviado ni lo recibido
 * va en los mensajes de error ni en los logs.
 */

export type StopReasonIa = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "refusal" | "pause_turn" | "otro";

export type PeticionIa = {
  modelo: string;
  /** Texto fijo del prompt (punto de caché 1). */
  sistema: string;
  /** JSON canónico del bloque del lote (punto de caché 2: idéntico en `natural` y `reparto`). */
  bloque: string;
  /** JSON canónico del sufijo de la tarea; va sin caché. */
  sufijo: string;
  /** JSON Schema de la salida (subconjunto que admite el proveedor). */
  esquema: Record<string, unknown>;
  nombre_esquema: string;
  max_tokens: number;
  /** `null` = la temperatura mínima que admita el modelo; con razonamiento extendido no se fija. */
  temperatura: number | null;
  /** Tokens de razonamiento extendido; 0 = sin. */
  presupuesto_razonamiento: number;
  timeout_ms: number;
  /** Reintento por salida inválida: errores resumidos SIN datos («faltan 3 filas»). */
  correccion?: string | null;
};

export type RespuestaIa = {
  /** Lo que devolvió el modelo (el JSON de la salida estructurada). Se valida siempre con zod. */
  texto: string;
  uso: UsoTokensIa;
  stop_reason: StopReasonIa;
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
  /** Código para `ia_llamadas.error_codigo`: `429`, `529`, `500`, `tiempo`, `400`, `401`. */
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

/** `500`, `502`, `503`, `504`, `529` o error de red: hasta 3 intentos por paso. */
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
