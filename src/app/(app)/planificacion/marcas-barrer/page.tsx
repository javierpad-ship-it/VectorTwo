import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { MarcasBarrerPanel } from "./marcas-barrer-panel";

export const metadata = { title: "Marcas al barrer por GML" };

export default async function MarcasBarrerPage() {
  const r = await perfilActual();
  // Solo admin y planner: el análisis sale de la venta y el reparto lo aprueba planificación (M12, requirePlanner en toda la API).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // El panel lee la marca abierta, la ventana, el modo y el alcance de la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <MarcasBarrerPanel />
    </Suspense>
  );
}
