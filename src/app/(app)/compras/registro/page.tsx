import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { COOKIE_VIAJE_ACTIVO, parsearViajeActivo } from "@/components/compras/agrupadores/vista-agrupadores";
import { RegistroPanel } from "./registro-panel";

export const metadata = { title: "Compras" };

export default async function RegistroPage() {
  const r = await perfilActual();
  // Los tres roles leen las compras (lista, detalle e historial) y asignan su viaje y su embarque (decisión 92 de la ficha 08b). Los demás
  // botones de escritura se ocultan al comprador en el panel y la API los exige con requirePlanner: ocultarlos es comodidad, no seguridad.
  if (r.estado !== "ok") redirect("/");
  // El viaje activo es una preferencia por navegador (cookie sin httpOnly): aquí solo se valida su formato; el panel descarta el que ya no
  // existe o está cancelado. Ninguna ruta de la API la lee (R22) y no da ni quita permisos.
  const guardado = parsearViajeActivo((await cookies()).get(COOKIE_VIAJE_ACTIVO)?.value);
  // El panel guarda los filtros y la compra abierta en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <RegistroPanel rol={r.rol} perfilId={r.perfil.id} viajeActivoInicial={guardado} />
    </Suspense>
  );
}
