import type {
  AbrirCargaPeticion,
  AbrirCargaRespuesta,
  CargasRespuesta,
  DescartarCargaRespuesta,
  DetalleCargaRespuesta,
  LimpiarRespuesta,
  MarcasNuevasPeticion,
  MarcasNuevasRespuesta,
  PrevisualizarPeticion,
  PrevisualizarRespuesta,
  PublicarPeticion,
  PublicarRespuesta,
  TandaPeticion,
  TandaRespuesta,
} from "./tipos-api";

/**
 * Cliente de la API de M5 para el navegador. A diferencia de `api-client.ts`,
 * el error conserva el `status` HTTP y el cuerpo, porque la carga decide qué
 * hacer según él: red (`status` 0) y `5xx` se reintentan; `4xx` descarta el
 * mes (docs/modulos/05-venta-stock.md, "Una tanda…").
 *
 * No importa nada de React ni de módulos `"use client"`.
 */

export class ErrorApiVentas extends Error {
  constructor(
    mensaje: string,
    /** Código HTTP; 0 si no hubo respuesta (red caída, corte). */
    readonly status: number,
    /** Cuerpo JSON de la respuesta de error (`codigo`, `esperado`, `medido`, `diferencias`…). */
    readonly cuerpo: Record<string, unknown> = {}
  ) {
    super(mensaje);
    this.name = "ErrorApiVentas";
  }
}

async function llamar<T>(metodo: "GET" | "POST" | "DELETE", url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ErrorApiVentas("No hubo respuesta del servidor (¿se cortó la conexión?).", 0);
  }

  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = (await res.json()) as Record<string, unknown>;
  } catch {
    // sin cuerpo
  }
  if (!res.ok) {
    const mensaje = typeof cuerpo.error === "string" ? cuerpo.error : `Error ${res.status}`;
    throw new ErrorApiVentas(mensaje, res.status, cuerpo);
  }
  return cuerpo.data as T;
}

/** La parte de la API que usa la carga; los tests la sustituyen por una falsa. */
export type ApiVentas = {
  previsualizar(cuerpo: PrevisualizarPeticion): Promise<PrevisualizarRespuesta>;
  marcasNuevas(cuerpo: MarcasNuevasPeticion): Promise<MarcasNuevasRespuesta>;
  abrirCarga(cuerpo: AbrirCargaPeticion): Promise<AbrirCargaRespuesta>;
  /** `signal` corta la petición en vuelo (cancelar). Publicar NO lleva `signal`: una vez iniciado no se cancela. */
  enviarTanda(cargaId: string, cuerpo: TandaPeticion, signal?: AbortSignal): Promise<TandaRespuesta>;
  publicar(cargaId: string, cuerpo: PublicarPeticion): Promise<PublicarRespuesta>;
  /** `soloEnCurso` (lo usa el flujo de carga): nunca retira una carga ya publicada (`409`). */
  descartar(cargaId: string, soloEnCurso?: boolean): Promise<DescartarCargaRespuesta>;
  limpiar(): Promise<LimpiarRespuesta>;
  cargas(verificar?: boolean): Promise<CargasRespuesta>;
  detalle(cargaId: string): Promise<DetalleCargaRespuesta>;
};

export const apiVentas: ApiVentas = {
  previsualizar: (c) => llamar("POST", "/api/ventas/previsualizar", c),
  marcasNuevas: (c) => llamar("POST", "/api/ventas/marcas-nuevas", c),
  abrirCarga: (c) => llamar("POST", "/api/ventas/cargas", c),
  enviarTanda: (id, c, signal) => llamar("POST", `/api/ventas/cargas/${id}/filas`, c, signal),
  publicar: (id, c) => llamar("POST", `/api/ventas/cargas/${id}/publicar`, c),
  descartar: (id, soloEnCurso = false) => llamar("DELETE", `/api/ventas/cargas/${id}${soloEnCurso ? "?solo=en_curso" : ""}`),
  limpiar: () => llamar("POST", "/api/ventas/cargas/limpiar", {}),
  cargas: (verificar = false) => llamar("GET", `/api/ventas/cargas${verificar ? "?verificar=1" : ""}`),
  detalle: (id) => llamar("GET", `/api/ventas/cargas/${id}`),
};
