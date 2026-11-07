import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { proveedorCreacionSchema, proveedoresQuerySchema } from "@/lib/proveedores/esquemas";
import { crearProveedor, listarProveedores } from "@/lib/proveedores/servicio";

/**
 * `GET /api/compras/proveedores?activos=1&q=` (`requireUser`; solo lectura): los proveedores con sus contactos, cuántas compras no
 * canceladas tienen y si su ficha está completa. `activos=1` deja fuera los inactivos (el autocompletado).
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, proveedoresQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarProveedores(supabaseAdmin(), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `POST /api/compras/proveedores` (`requireUser`, decisión 28: cualquiera crea): `{ modo: "ficha", … }` crea con la ficha completa y
 * `{ modo: "rapido", nombre, pais?, confirmar_parecido? }` es el alta al vuelo. `201` con la ficha. `409 nombre_repetido` (con
 * `conflicto`), `409 codigo_repetido`, `409 nombre_parecido` (con `parecidos`, solo en modo rápido) y `403 solo_planner_intercompany`.
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, proveedorCreacionSchema);
  if (respuesta) return respuesta;
  const r = await crearProveedor(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
