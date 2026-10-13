import { ErrorApiVentas } from "@/lib/ventas/cliente-api";
import type {
  CrearMapeosPeticion,
  CrearMapeosRespuesta,
  EditarMapeoPeticion,
  ImportarMapeosPeticion,
  ImportarMapeosRespuesta,
  MapeoApi,
  MapeosRespuesta,
  SugerirPeticion,
  SugerirRespuesta,
} from "@/lib/ventas/tipos-mapeo";

/**
 * Cliente de `/api/ventas/mapeos` (ficha M5b, "Contratos de API"). Como el de
 * la carga, el error conserva el `status` y el cuerpo (`ErrorApiVentas`):
 * la pantalla distingue un `409` ("ese origen ya tiene otro destino") de un
 * fallo de red. Solo navegador; no importa nada del servidor.
 */
export async function llamar<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
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
    throw new ErrorApiVentas(typeof cuerpo.error === "string" ? cuerpo.error : `Error ${res.status}`, res.status, cuerpo);
  }
  return cuerpo.data as T;
}

export const apiMapeos = {
  listar: () => llamar<MapeosRespuesta>("GET", "/api/ventas/mapeos"),
  crear: (c: CrearMapeosPeticion) => llamar<CrearMapeosRespuesta>("POST", "/api/ventas/mapeos", c),
  editar: (id: string, c: EditarMapeoPeticion) => llamar<MapeoApi>("PATCH", `/api/ventas/mapeos/${id}`, c),
  eliminar: (id: string) => llamar<{ id: string }>("DELETE", `/api/ventas/mapeos/${id}`),
  sugerir: (c: SugerirPeticion) => llamar<SugerirRespuesta>("POST", "/api/ventas/mapeos/sugerir", c),
  importar: (c: ImportarMapeosPeticion) => llamar<ImportarMapeosRespuesta>("POST", "/api/ventas/mapeos/importar", c),
};

/**
 * ¿Es el `409` de "ese origen ya existe con otro destino"? La ficha lo llama
 * `origen_repetido`; se reconoce por `codigo` o, si el servidor solo manda
 * texto, por el mensaje.
 */
export function esConflictoOrigenRepetido(e: unknown): boolean {
  if (!(e instanceof ErrorApiVentas) || e.status !== 409) return false;
  if (e.cuerpo.codigo === "origen_repetido") return true;
  return /repetid|otro destino|ya tiene|ya existe/i.test(e.message) && !/árbol|arbol/i.test(e.message);
}
