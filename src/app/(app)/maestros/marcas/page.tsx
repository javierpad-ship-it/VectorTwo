import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { MarcasPanel } from "./marcas-panel";

export const metadata = { title: "Agrupaciones y marcas" };

export default async function MarcasPage() {
  const r = await perfilActual();
  // Admin y planner (decisión M2: el comprador no ve marcas; pregunta abierta 7).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  return <MarcasPanel rol={r.rol} />;
}
