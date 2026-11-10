import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { TableroPanel } from "./tablero-panel";

export const metadata = { title: "Aprobación de dirección" };

export default async function AprobacionDireccionPage() {
  const r = await perfilActual();
  // Solo admin y planner (decisión 113): el tablero muestra venta, soles y proyección; toda la API va con `requirePlanner` y decidir, con `requireAdmin`.
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // El panel guarda la proyección, la comparada y los filtros en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <TableroPanel esAdmin={r.rol === "admin"} />
    </Suspense>
  );
}
