import Link from "next/link";
import { perfilActual } from "@/lib/auth/guard";
import { ETIQUETA_ROL } from "@/lib/auth/roles";
import { puedeVerRuta } from "@/lib/nav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Modulo = {
  id: string;
  nombre: string;
  detalle: string;
  estado: "listo" | "pendiente";
  /** Pantalla principal del módulo; se enlaza si el rol puede verla. */
  href?: string;
};

const MODULOS: Modulo[] = [
  { id: "M0", nombre: "Cimientos", detalle: "Login, roles y administración de usuarios.", estado: "listo" },
  { id: "M1", nombre: "Árbol de producto", detalle: "Género · Mundo · Línea · Equivalencia · Agrupación talla.", estado: "listo", href: "/maestros/arbol" },
  { id: "M2", nombre: "Agrupaciones y marcas", detalle: "Agrupaciones de marca administrables y marcas con tratamiento especial.", estado: "listo", href: "/maestros/marcas" },
  {
    id: "M3",
    nombre: "Agrupaciones de estacionalidad",
    detalle: "Qué equivalencias comparten curva: catálogo, asignación y reporte de faltantes.",
    estado: "listo",
    href: "/maestros/estacionalidad",
  },
  {
    id: "M4",
    nombre: "Tiendas y aperturas",
    detalle: "Tiendas y CD con fechas de apertura y cierre; el estado se calcula solo.",
    estado: "listo",
    href: "/maestros/tiendas",
  },
];

export default async function InicioPage() {
  const r = await perfilActual();
  const nombre = r.estado === "ok" ? r.perfil.nombre || r.perfil.email : "";
  const rol = r.estado === "ok" ? ETIQUETA_ROL[r.rol] : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hola, {nombre}</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Entraste como <strong>{rol}</strong>. Vector2 se está construyendo módulo por módulo; este es el estado de la Fase 1.
        </p>
      </div>

      <Card titulo="Fase 1 · Cimientos y maestros">
        <ul className="divide-y divide-borde">
          {MODULOS.map((m) => {
            const enlazable = m.estado === "listo" && m.href && r.estado === "ok" && puedeVerRuta(r.rol, m.href);
            return (
              <li key={m.id} className="flex items-center gap-4 py-3">
                <span className="w-9 font-mono text-xs text-tinta-suave">{m.id}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {enlazable && m.href ? (
                      <Link href={m.href} className="text-marca-oscura underline-offset-2 hover:underline">
                        {m.nombre}
                      </Link>
                    ) : (
                      m.nombre
                    )}
                  </div>
                  <div className="text-xs text-tinta-suave">{m.detalle}</div>
                </div>
                <Badge tono={m.estado === "listo" ? "exito" : "neutro"}>{m.estado === "listo" ? "Listo" : "Pendiente"}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
