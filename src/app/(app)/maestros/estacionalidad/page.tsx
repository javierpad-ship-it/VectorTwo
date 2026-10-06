import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { esPestanaEstacionalidad } from "@/lib/estacionalidad/pestanas";
import { EstacionalidadPanel } from "./estacionalidad-panel";

export const metadata = { title: "Agrupaciones de estacionalidad" };

export default async function EstacionalidadPage({ searchParams }: { searchParams: Promise<{ pestana?: string | string[] }> }) {
  const r = await perfilActual();
  // Admin y planner (M3: la estacionalidad es trabajo del planner; el comprador no la ve ni por URL).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // `?pestana=faltantes` abre directamente esa pestaña (enlace desde el resumen del árbol).
  const { pestana } = await searchParams;
  return <EstacionalidadPanel rol={r.rol} pestanaInicial={esPestanaEstacionalidad(pestana) ? pestana : undefined} />;
}
