import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { AgrupacionGmlePanel } from "./agrupacion-gmle-panel";

export const metadata = { title: "Reporte agrupación GMLE" };

export default async function AgrupacionGmlePage() {
  const r = await perfilActual();
  // Admin y planner (M11: revisión de la planificación; el comprador no la ve ni por URL).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  return <AgrupacionGmlePanel />;
}
