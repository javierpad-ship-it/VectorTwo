/**
 * Punto de color (p. ej. el color de una agrupación de estacionalidad) para
 * poner delante de un nombre. Sin `color` sale en el `tono` pedido: gris
 * ("sin color asignado") o alerta ("falta"). El color llega como valor (viene
 * de datos, no de una clase fija), por eso va en `style`.
 */
export function Punto({
  color,
  tono = "gris",
  className = "",
}: {
  color?: string | null;
  tono?: "gris" | "alerta";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color ? "" : tono === "alerta" ? "bg-alerta" : "bg-tinta-suave/40"} ${className}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
