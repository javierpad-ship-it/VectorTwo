import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { COOKIE_VIAJE_ACTIVO, parsearViajeActivo } from "@/components/compras/agrupadores/vista-agrupadores";
import { AgrupadoresPanel } from "./agrupadores-panel";

export const metadata = { title: "Viajes y embarques" };

export default async function AgrupadoresPage() {
  const r = await perfilActual();
  // Los tres roles leen y escriben agrupadores (decisión 92); cerrar, reabrir y cancelar se ocultan al comprador en el panel y la API
  // los exige con requirePlanner: ocultarlos es comodidad, no seguridad.
  if (r.estado !== "ok") redirect("/");
  // El viaje activo es una preferencia por navegador (cookie sin httpOnly): aquí solo se valida su formato; el panel descarta el que ya no
  // existe o está cancelado. Ninguna ruta de la API la lee y no da ni quita permisos.
  const guardado = parsearViajeActivo((await cookies()).get(COOKIE_VIAJE_ACTIVO)?.value);
  // El panel guarda la pestaña, los filtros y lo abierto en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <AgrupadoresPanel rol={r.rol} perfilId={r.perfil.id} viajeActivoInicial={guardado} />
    </Suspense>
  );
}
