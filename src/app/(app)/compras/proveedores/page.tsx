import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { ProveedoresPanel } from "./proveedores-panel";

export const metadata = { title: "Proveedores" };

export default async function ProveedoresPage() {
  const r = await perfilActual();
  // Los tres roles ven y editan proveedores (decisión 28 de la ficha 08c); desactivar, eliminar y marcar intercompany son del planner y se
  // ocultan al comprador en el panel. La API los exige con requirePlanner / 403: ocultarlos es comodidad, no seguridad.
  if (r.estado !== "ok") redirect("/");
  return <ProveedoresPanel rol={r.rol} />;
}
