import { Suspense } from "react";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { HuecosPanel } from "./huecos-panel";

export const metadata = { title: "Huecos" };

export default async function HuecosPage() {
  const r = await perfilActual();
  // Los tres roles ven los huecos (lectura); el layout ya resolvió sesión y perfil, aquí solo se obtiene el rol para el panel.
  if (r.estado !== "ok") redirect("/");
  // El panel guarda sus filtros en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <HuecosPanel rol={r.rol} />
    </Suspense>
  );
}
