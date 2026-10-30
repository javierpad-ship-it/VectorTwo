import { ErrorClaveInvalida, ErrorLimiteProveedor, ErrorServicioProveedor, ErrorTiempoAgotado, type PeticionIa, type ProveedorIA, type RespuestaIa } from "@/lib/ia/proveedor";
import type { UsoTokensIa } from "@/lib/ia/tipos-api";

/**
 * Proveedor falso para las pruebas (ficha 07e, §5.7): implementa `ProveedorIA` con respuestas guionadas, cuenta las llamadas y guarda las
 * peticiones recibidas. Nunca toca la red.
 */

export type RespuestaGuionada = RespuestaIa | Error;

export const USO_BASE: UsoTokensIa = { entrada: 4200, salida: 1900, cache_escritura: 0, cache_lectura: 5400 };

export const respuesta = (texto: string, extra: Partial<RespuestaIa> = {}): RespuestaIa => ({
  texto,
  uso: USO_BASE,
  stop_reason: "end_turn",
  id_solicitud: "req_falso",
  modelo_respuesta: "modelo-falso",
  duracion_ms: 10,
  ...extra,
});

export const valida = (salida: unknown, extra: Partial<RespuestaIa> = {}): RespuestaIa => respuesta(JSON.stringify(salida), extra);
export const jsonInvalido = (): RespuestaIa => respuesta("{ esto no es json");
export const truncada = (): RespuestaIa => respuesta('{"version_salida":2,"filas":[', { stop_reason: "max_tokens" });
export const negativa = (): RespuestaIa => respuesta("", { stop_reason: "refusal" });
export const limite429 = (esperar_ms: number | null = 1500): Error => new ErrorLimiteProveedor(esperar_ms);
export const error529 = (): Error => new ErrorServicioProveedor("529");
export const tiempoAgotado = (): Error => new ErrorTiempoAgotado();
export const claveInvalida401 = (): Error => new ErrorClaveInvalida();

export class ProveedorFalso implements ProveedorIA {
  llamadas = 0;
  readonly peticiones: PeticionIa[] = [];
  private guion: RespuestaGuionada[];

  constructor(guion: RespuestaGuionada[] = []) {
    this.guion = [...guion];
  }

  encolar(...r: RespuestaGuionada[]): this {
    this.guion.push(...r);
    return this;
  }

  async llamar(peticion: PeticionIa): Promise<RespuestaIa> {
    this.llamadas += 1;
    this.peticiones.push(peticion);
    const siguiente = this.guion.shift();
    if (siguiente === undefined) throw new Error("ProveedorFalso: sin respuestas guionadas.");
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  }
}
