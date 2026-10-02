import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { UsuariosPanel } from "./usuarios-panel";

export const metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  const r = await perfilActual();
  if (r.estado !== "ok" || r.rol !== "admin") redirect("/");
  return <UsuariosPanel actorId={r.perfil.id} />;
}
