import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerEntradaIa } from "@/lib/ia/servicio";

type Params = { params: Promise<{ id: string }> };

/** El JSON canónico enviado al proveedor (descomprimido, con alias) y su diccionario, para auditar una llamada (`requireAdmin`). Ninguna pantalla del planner lo usa. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Entrada no encontrada.");
  if (respuesta) return respuesta;
  const r = await leerEntradaIa(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
