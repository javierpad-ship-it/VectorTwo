import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { ProyeccionPanel } from "./proyeccion-panel";

export const metadata = { title: "Proyección de unidades" };

export default async function ProyeccionPage() {
  const r = await perfilActual();
  // Solo admin y planner: la proyección se calcula sobre venta y costo (M7, requirePlanner en toda la API). El comprador vuelve a Inicio.
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // El panel lee el estado de la vista de la URL (proyección, pestaña, filtros, fila): useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <ProyeccionPanel />
    </Suspense>
  );
}
