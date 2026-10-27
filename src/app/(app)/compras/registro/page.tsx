import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { RegistroPanel } from "./registro-panel";

export const metadata = { title: "Compras" };

export default async function RegistroPage() {
  const r = await perfilActual();
  // Los tres roles leen las compras (lista, detalle e historial). Los botones de escritura se ocultan al comprador en el panel y la API los
  // exige con requirePlanner: ocultarlos es comodidad, no seguridad.
  if (r.estado !== "ok") redirect("/");
  // El panel guarda los filtros y la compra abierta en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <RegistroPanel rol={r.rol} />
    </Suspense>
  );
}
