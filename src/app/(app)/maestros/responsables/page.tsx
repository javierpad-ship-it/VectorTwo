import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { leerResponsableParam } from "@/lib/responsables/pantalla";
import { ResponsablesPanel } from "./responsables-panel";

export const metadata = { title: "Responsables género-mundo" };

export default async function ResponsablesPage({ searchParams }: { searchParams: Promise<{ responsable?: string | string[] }> }) {
  const r = await perfilActual();
  // Los tres roles entran (el comprador ve todo: el responsable es un filtro, no un permiso).
  if (r.estado !== "ok") redirect("/");
  // `?responsable=<id>` abre la matriz filtrada por ese usuario (enlace desde /usuarios).
  const { responsable } = await searchParams;
  return <ResponsablesPanel rol={r.rol} usuarioId={r.perfil.id} responsableInicial={leerResponsableParam(responsable)} />;
}
