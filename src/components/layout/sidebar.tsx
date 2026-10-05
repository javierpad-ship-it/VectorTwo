"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ETIQUETA_ROL, type PerfilCliente } from "@/lib/auth/roles";
import { esActivo, seccionesVisibles } from "@/lib/nav";
import { APP_VERSION } from "@/lib/version";
import { BotonSalir } from "./boton-salir";

export function Sidebar({
  perfil,
  abierto,
  onCerrar,
}: {
  perfil: PerfilCliente;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const pathname = usePathname();
  const secciones = seccionesVisibles(perfil.rol);

  return (
    <>
      {abierto && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={onCerrar}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-borde bg-superficie transition-transform lg:static lg:translate-x-0 ${
          abierto ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center border-b border-borde px-4">
          <Link href="/" className="flex items-center" aria-label="Vector Two, inicio">
            <Image
              src="/marca/logo-horizontal.png"
              alt="Vector Two"
              width={1200}
              height={340}
              priority
              className="h-9 w-auto"
            />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {secciones.map((s) => (
            <div key={s.title} className="mb-5">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">
                {s.title}
              </div>
              <ul className="space-y-0.5">
                {s.links.map((l) => {
                  const activo = esActivo(pathname, l);
                  if (l.pendiente) {
                    return (
                      <li key={l.href}>
                        <span
                          className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-tinta-suave/60"
                          title={`Se construye en el módulo ${l.pendiente}`}
                        >
                          {l.label}
                          <span className="rounded bg-neutro-suave px-1.5 text-[10px] font-medium">{l.pendiente}</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={onCerrar}
                        className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                          activo
                            ? "bg-marca-suave font-medium text-marca-oscura"
                            : "text-tinta hover:bg-neutro-suave"
                        }`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-borde px-4 py-3">
          <div className="truncate text-sm font-medium" title={perfil.email}>
            {perfil.nombre || perfil.email}
          </div>
          <div className="mb-2 text-xs text-tinta-suave">{ETIQUETA_ROL[perfil.rol]}</div>
          <div className="flex items-center justify-between">
            <BotonSalir />
            <span className="font-mono text-[10px] text-tinta-suave">v{APP_VERSION}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
