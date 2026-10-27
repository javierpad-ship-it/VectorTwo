import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { FlujoPanel } from "./flujo-panel";

export const metadata = { title: "Flujo mensual" };

export default async function FlujoPage() {
  const r = await perfilActual();
  // Los tres roles leen el flujo; los Parámetros y «Aceptar sugerencia» se ocultan al comprador en el panel y la API los exige con requirePlanner.
  if (r.estado !== "ok") redirect("/");
  // El panel guarda la pestaña, los filtros y la fila abierta en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <FlujoPanel rol={r.rol} />
    </Suspense>
  );
}
