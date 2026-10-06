import { Badge } from "@/components/ui/badge";

/**
 * Agrupación de estacionalidad de una equivalencia, como la ven el árbol y la
 * lista plana: tono marca con el nombre, o alerta si falta o está inactiva.
 */
export function BadgeAgrupacion({ agrupacion }: { agrupacion: { nombre: string; activo: boolean } | null }) {
  if (!agrupacion) return <Badge tono="alerta">Sin agrupación</Badge>;
  if (!agrupacion.activo) return <Badge tono="alerta">{agrupacion.nombre} · inactiva</Badge>;
  return <Badge tono="marca">{agrupacion.nombre}</Badge>;
}
