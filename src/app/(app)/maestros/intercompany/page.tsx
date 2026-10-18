import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { IntercompanyPanel } from "./intercompany-panel";

export const metadata = { title: "Intercompany" };

export default async function IntercompanyPage() {
  const r = await perfilActual();
  // Solo admin y planner: toda la API de M13 es de planificación; el comprador ve el efecto en el flujo (M8), no la tabla.
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // El panel lee la pestaña, el mes y los filtros de la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <IntercompanyPanel />
    </Suspense>
  );
}
