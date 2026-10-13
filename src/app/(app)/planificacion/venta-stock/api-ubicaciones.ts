import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { CrearUbicacionIgnoradaPeticion, EditarUbicacionIgnoradaPeticion, UbicacionIgnoradaApi } from "@/lib/tiendas/tipos-api";
import { ErrorApiVentas } from "@/lib/ventas/cliente-api";
import { llamar } from "./api-mapeos";

/**
 * Atajo "Ignorar esta ubicación" del reporte previo (ficha M5c): alta en
 * `/api/tiendas/ubicaciones-ignoradas`. Solo navegador; no importa nada del servidor.
 */

const URL_UBICACIONES = "/api/tiendas/ubicaciones-ignoradas";

/**
 * Guarda la ubicación y devuelve su fila. Un `409` de nombre repetido se trata como éxito (ya estaba
 * en la lista: se busca su fila para tener el `id`, y si no tenía nota se guarda la escrita); el `409 nombre_es_tienda` y cualquier otro error
 * suben tal cual, con la sugerencia de volver a leer cuando alguien creó la tienda entre la lectura
 * y el clic.
 */
export async function ignorarUbicacion(nombre: string, nota: string): Promise<UbicacionIgnoradaApi> {
  const cuerpo: CrearUbicacionIgnoradaPeticion = { nombre, ...(nota.trim() === "" ? {} : { nota: nota.trim() }) };
  try {
    return await llamar<UbicacionIgnoradaApi>("POST", URL_UBICACIONES, cuerpo);
  } catch (e) {
    if (!(e instanceof ErrorApiVentas) || e.status !== 409) throw e;
    if (e.cuerpo.codigo === "nombre_es_tienda") {
      throw new ErrorApiVentas(`${e.message} Vuelve a leer el archivo para que el reporte la tome como tienda.`, e.status, e.cuerpo);
    }
    const lista = await llamar<UbicacionIgnoradaApi[]>("GET", URL_UBICACIONES).catch(() => null);
    const nombreNormal = normalizarNombre(nombre);
    const ya = lista?.find((u) => u.nombre === nombreNormal && u.sin_efecto === null);
    if (!ya) throw e;
    // La fila ya existía. Si no tenía nota y el usuario escribió una, se guarda en vez de perderla; si tenía otra, se conserva la anterior.
    const notaNueva = nota.trim();
    if (notaNueva !== "" && ya.nota === null) {
      const cambio: EditarUbicacionIgnoradaPeticion = { nota: notaNueva };
      return await llamar<UbicacionIgnoradaApi>("PATCH", `${URL_UBICACIONES}/${ya.id}`, cambio).catch(() => ya);
    }
    return ya;
  }
}
