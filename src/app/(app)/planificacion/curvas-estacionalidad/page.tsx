import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { CurvasPanel } from "./curvas-panel";

export const metadata = { title: "Curvas de estacionalidad" };

export default async function CurvasEstacionalidadPage() {
  const r = await perfilActual();
  // Solo admin y planner: las curvas se calculan sobre venta y costo (M6, requirePlanner en toda la API).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // El panel lee `?agrupacion=` de la URL (la agrupación abierta sobrevive a recargar): useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <CurvasPanel />
    </Suspense>
  );
}
