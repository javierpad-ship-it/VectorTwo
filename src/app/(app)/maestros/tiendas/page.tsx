import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { TiendasPanel } from "./tiendas-panel";

export const metadata = { title: "Tiendas y aperturas" };

export default async function TiendasPage() {
  const r = await perfilActual();
  // Admin y planner (decisión M2–M4: el comprador no ve tiendas; pregunta abierta 9 de la ficha).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  return <TiendasPanel rol={r.rol} />;
}
