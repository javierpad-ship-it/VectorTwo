import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { VentaStockPanel } from "./venta-stock-panel";

export const metadata = { title: "Carga de venta y stock" };

export default async function VentaStockPage() {
  const r = await perfilActual();
  // Solo admin y planner: venta y costo son cifras de planificación (M5, requirePlanner en toda la API).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  return <VentaStockPanel />;
}
