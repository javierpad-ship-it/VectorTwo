import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { ArbolPanel } from "./arbol-panel";

export const metadata = { title: "Árbol de producto" };

export default async function ArbolPage() {
  const r = await perfilActual();
  if (r.estado !== "ok") redirect("/");
  return <ArbolPanel rol={r.rol} />;
}
