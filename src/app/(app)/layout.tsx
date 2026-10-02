import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { AppShell } from "@/components/layout/app-shell";
import { CuentaBloqueada } from "@/components/layout/cuenta-bloqueada";

/**
 * Layout de todo lo que requiere sesión. El proxy ya garantiza que hay
 * sesión; acá se resuelve el perfil y el rol una sola vez por navegación.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const resultado = await perfilActual();

  if (resultado.estado === "sin_sesion") redirect("/login");

  if (resultado.estado === "sin_perfil") {
    return (
      <CuentaBloqueada
        email={resultado.email}
        titulo="Tu usuario no está dado de alta"
        detalle="Tienes sesión, pero ningún administrador te ha creado un perfil en Vector2. Pide acceso al equipo de planeamiento."
      />
    );
  }

  if (resultado.estado === "inactivo") {
    return (
      <CuentaBloqueada
        email={resultado.email}
        titulo="Tu usuario está desactivado"
        detalle="Un administrador desactivó tu acceso. Si crees que es un error, pide que lo reactiven."
      />
    );
  }

  const { perfil, rol } = resultado;
  return (
    <AppShell perfil={{ id: perfil.id, email: perfil.email, nombre: perfil.nombre, rol }}>
      {children}
    </AppShell>
  );
}
