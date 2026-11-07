import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { COOKIE_VIAJE_ACTIVO, parsearViajeActivo } from "@/components/compras/agrupadores/vista-agrupadores";
import { FotosPanel } from "./fotos-panel";

export const metadata = { title: "Fotos de las compras" };

export default async function FotosPage() {
  const r = await perfilActual();
  // Los tres roles ven las fotos y suben, quitan y editan descripción y modelo (ficha 08c, §9 B3). La limpieza de huérfanas es solo del admin: el
  // panel oculta el botón y la API la exige con requireAdmin (ocultarlo es comodidad, no seguridad).
  if (r.estado !== "ok") redirect("/");
  // El viaje activo es una preferencia por navegador (cookie sin httpOnly); aquí solo se valida su formato. La API de fotos no la lee: el
  // panel manda `viaje_id` explícito (R22).
  const guardado = parsearViajeActivo((await cookies()).get(COOKIE_VIAJE_ACTIVO)?.value);
  // Los filtros viven en la URL: useSearchParams pide Suspense.
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-tinta-suave">Cargando…</p>}>
      <FotosPanel rol={r.rol} perfilId={r.perfil.id} viajeActivoInicial={guardado} />
    </Suspense>
  );
}
