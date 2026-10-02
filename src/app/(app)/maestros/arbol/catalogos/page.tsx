import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { CatalogosPanel } from "./catalogos-panel";

export const metadata = { title: "Catálogos del árbol" };

export default async function CatalogosPage() {
  const r = await perfilActual();
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  return <CatalogosPanel rol={r.rol} />;
}
