"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { PerfilCliente } from "@/lib/auth/roles";
import { puedeVerRuta } from "@/lib/nav";
import { Sidebar } from "./sidebar";

export function AppShell({ perfil, children }: { perfil: PerfilCliente; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuAbierto, setMenuAbierto] = useState(false);

  // Guard de navegación: si el rol no puede ver la ruta, vuelve al inicio.
  // Es comodidad de UI; la seguridad real está en los guards de /api.
  const permitida = puedeVerRuta(perfil.rol, pathname);
  useEffect(() => {
    if (!permitida) router.replace("/");
  }, [permitida, router]);

  if (!permitida) return null;

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar perfil={perfil} abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-borde bg-superficie px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            className="rounded-md border border-borde px-2 py-1 text-sm"
          >
            ☰
          </button>
          <Image src="/marca/logo-horizontal.png" alt="Vector Two" width={1200} height={340} className="h-7 w-auto" />
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
