import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { MarcasPanel } from "./marcas-panel";
import { esPestanaMarcas } from "./pestanas";

export const metadata = { title: "Agrupaciones y marcas" };

type Parametro = string | string[] | undefined;

const primero = (v: Parametro): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function MarcasPage({ searchParams }: { searchParams: Promise<{ pestana?: Parametro; nodo?: Parametro; marca?: Parametro }> }) {
  const r = await perfilActual();
  // Admin y planner (decisión M2: el comprador no ve marcas; pregunta abierta 7).
  if (r.estado !== "ok" || !puedeEditarMaestros(r.rol)) redirect("/");
  // `?pestana=gml&nodo=<id>` abre las marcas relevantes por GML en ese nodo (enlace desde el árbol).
  const { pestana, nodo, marca } = await searchParams;
  const p = primero(pestana);
  return <MarcasPanel rol={r.rol} pestanaInicial={esPestanaMarcas(p) ? p : undefined} nodoInicial={primero(nodo) ?? null} marcaInicial={primero(marca) ?? null} />;
}
