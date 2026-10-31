import { redirect } from "next/navigation";
import { perfilActual } from "@/lib/auth/guard";
import { IaPanel } from "./ia-panel";

export const metadata = { title: "Motor de IA" };

export default async function MotorIaPage() {
  const r = await perfilActual();
  // Solo admin: la configuración, las evaluaciones y el uso del proveedor son del administrador (`requireAdmin` en `/api/ia/*`).
  if (r.estado !== "ok" || r.rol !== "admin") redirect("/");
  return <IaPanel />;
}
