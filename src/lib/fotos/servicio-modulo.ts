import "server-only";
import type { Rol } from "@/lib/auth/roles";
import { nombresDeCatalogo } from "@/lib/compras/servicio";
import { fallaDb, falla, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { leerDatosModuloFotos, leerFotosEnCancelada, type DestinoParaTraer } from "./consultas";
import type { FotosQuery } from "./esquemas";
import { armarFotosModulo } from "./modulo";
import type { FotosModuloApi } from "./tipos-api";

/**
 * `GET /api/compras/fotos` (08c, §3.3 y §4.3): la pantalla Fotos. Solo servidor, solo lectura. Lee con `consultas.ts`, arma con `modulo.ts`
 * (puro) y cuenta `fotos_en_cancelada` solo para las líneas de la página que se devuelve, en una pasada por tandas (no una consulta por línea).
 * Nunca lee la cookie del viaje activo (08b, R22): `viaje_id` llega explícito o no se filtra por viaje.
 */
export async function listarFotosModulo(d: Db, rol: Rol, q: FotosQuery): Promise<Salida<FotosModuloApi>> {
  const datos = await leerDatosModuloFotos(d, {
    viaje_id: q.viaje_id === "todos" ? undefined : q.viaje_id,
    compra_id: q.compra_id,
    origen: q.origen,
    estado: q.estado,
  });
  if (datos.error) return fallaDb(datos.error, "fotos: leer la pantalla");
  const nombres = await nombresDeCatalogo(d);
  if (nombres.respuesta) return falla(nombres.respuesta);

  const api = armarFotosModulo({
    compras: datos.data.compras,
    lineas: datos.data.lineas,
    fotos: datos.data.fotos,
    proveedores: datos.data.proveedores,
    viajes: datos.data.viajes,
    nombres: nombres.data,
    rol,
    proveedor_id: q.proveedor_id,
    solo_sin_foto: q.solo_sin_foto,
    q: q.q,
    pagina: q.pagina,
    por_pagina: q.por_pagina,
  });

  // «Traer fotos de la versión cancelada» (decisión 104): solo para líneas de compras vivas de la página.
  const compraPorId = new Map(datos.data.compras.map((c) => [c.id, c]));
  const destinos: DestinoParaTraer[] = api.lineas
    .filter((t) => t.compra.estado !== "cancelada")
    .map((t) => ({ id: t.linea.id, compra_id: t.compra.id, proveedor_id: compraPorId.get(t.compra.id)?.proveedor_id ?? t.compra.proveedor.id, clave_importacion: datos.data.claves.get(t.linea.id) ?? null, activas: t.fotos.length }));
  const traibles = await leerFotosEnCancelada(d, destinos);
  if (traibles.error) return fallaDb(traibles.error, "fotos: contar las fotos de la versión cancelada");
  return listo({ ...api, lineas: api.lineas.map((t) => ({ ...t, fotos_en_cancelada: traibles.data.get(t.linea.id) ?? 0 })) });
}
