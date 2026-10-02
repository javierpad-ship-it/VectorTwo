import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import type { PerfilCliente } from "@/lib/auth/roles";

/** Perfil del usuario con sesión. Lo usa el cliente para saber quién es y qué rol tiene. */
export async function GET() {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const data: PerfilCliente = {
    id: perfil.id,
    email: perfil.email,
    nombre: perfil.nombre,
    rol,
  };
  return ok(data);
}
