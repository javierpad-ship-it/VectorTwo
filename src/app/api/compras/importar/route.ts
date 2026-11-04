import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { importarComprasConAgrupadoresSchema } from "@/lib/compras/agrupadores/esquemas";
import { ganchosAgrupadoresCompras, usuarioDe } from "@/lib/compras/agrupadores/servicio";
import { importarCompras } from "@/lib/compras/servicio";
import { excesoDeLineasNuevas } from "@/lib/flujo/servicio";

/**
 * `POST /api/compras/importar` (`requirePlanner`; solo `carga_inicial` en `0.13.0`: sin ella, `400 carga_inicial_requerida`).
 * `modo = "previsualizar"` clasifica cada línea (`nueva`, `igual`, `cambiada`) por su CLAVE NATURAL (proveedor + referencia + línea) y dice
 * qué se omite y por qué; `modo = "aplicar"` llama a `importar_compra` UNA vez por compra (todo o nada por compra) y devuelve cuáles se
 * aplicaron. Idempotente: reimportar el mismo archivo da 0 nuevas. El aviso informativo `exceso` lo calcula el flujo (si no hay cerrada, no hay aviso).
 * Ficha 08b (§3.9, aditivo): las columnas `VIAJE`, `EMBARQUE` y `PAQUETE` (códigos de agrupadores que ya existen; el importador no los crea) se
 * evalúan tras clasificar cada fila como en M8 y se aplican DESPUÉS de `importar_compra`, en dos transacciones más por compra
 * (`asignar_viaje_compras` y `aplicar_movimiento_agrupador`); el reporte trae `agrupadores` con lo que hizo cada fila. El guard sigue siendo
 * `requirePlanner`: la carga inicial es de admin y planner (ver `puedeImportar`).
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarComprasConAgrupadoresSchema);
  if (respuesta) return respuesta;
  const d = supabaseAdmin();
  const usuario = usuarioDe(perfil, rol);
  const r = await importarCompras(
    d,
    usuario,
    datos,
    async (lineas) => {
      const exceso = await excesoDeLineasNuevas(d, lineas);
      return exceso.respuesta ? new Map<number, string>() : exceso.data;
    },
    ganchosAgrupadoresCompras(d, usuario),
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
