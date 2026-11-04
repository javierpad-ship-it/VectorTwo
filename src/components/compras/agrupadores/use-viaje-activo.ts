"use client";

import { useState } from "react";
import { guardarViajeActivo, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import type { ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { viajeActivoEfectivo } from "./vista-agrupadores";

/**
 * El viaje activo de este navegador (ficha 08b §3.8). `inicial` es lo que leyó el server component de la cookie `v2_viaje_activo` (ya con
 * el formato validado) o `null` si no hay. El valor que se aplica sale de `viajeActivoEfectivo`: lo guardado si el viaje sigue existiendo
 * y no está cancelado; si no, el último viaje abierto del que el usuario es responsable, o «todos». `listo` es falso mientras no se sabe
 * (sin cookie y sin la lista de viajes): las listas esperan para no pedir dos veces. Cambiarlo escribe la cookie con
 * `PUT /api/compras/viaje-activo`; es una preferencia y nunca da ni quita permisos.
 */
export function useViajeActivo({ inicial, viajes, perfilId }: { inicial: string | null; viajes: readonly ViajeApi[] | null; perfilId: string }) {
  const [guardado, setGuardado] = useState<string | null>(inicial);
  const accion = useAccion();
  const valor = viajeActivoEfectivo(guardado, viajes, perfilId);
  const listo = guardado !== null || viajes !== null;

  async function cambiar(nuevo: string): Promise<boolean> {
    const r = await accion.ejecutar(() => guardarViajeActivo(nuevo));
    if (r.ok) setGuardado(nuevo);
    return r.ok;
  }

  return { valor, listo, cambiar, ocupado: accion.ocupado, error: accion.error, limpiarError: accion.limpiar };
}
