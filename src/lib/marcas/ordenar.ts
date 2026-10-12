import type { MarcaFila } from "./tipos-api";

export type ClaveOrdenMarca = "codigo" | "nombre" | "agrupacion" | "tratamiento" | "estado";
export type OrdenMarca = { clave: ClaveOrdenMarca; dir: "asc" | "desc" };

/** Orden inicial de la tabla: alfabético por nombre. */
export const ORDEN_MARCA_INICIAL: OrdenMarca = { clave: "nombre", dir: "asc" };

const texto = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * Compara dos marcas por la columna elegida. La agrupación se ordena por el
 * `orden` del catálogo (el valor de marca: de ULTRA LOW a PREMIUM) y no por el
 * nombre alfabético; dentro de una misma agrupación y en los empates, por nombre.
 */
function porClave(clave: ClaveOrdenMarca, a: MarcaFila, b: MarcaFila): number {
  switch (clave) {
    case "codigo":
      return texto(a.codigo, b.codigo);
    case "nombre":
      return texto(a.nombre, b.nombre);
    case "agrupacion":
      return a.agrupacion_marca.orden - b.agrupacion_marca.orden || texto(a.agrupacion_marca.nombre, b.agrupacion_marca.nombre);
    case "tratamiento":
      return Number(a.tratamiento_especial) - Number(b.tratamiento_especial);
    case "estado":
      return Number(a.activo) - Number(b.activo);
  }
}

/** Devuelve una copia ordenada; desempata siempre por nombre y luego por código para que el orden sea estable. */
export function ordenarMarcas(marcas: readonly MarcaFila[], orden: OrdenMarca): MarcaFila[] {
  const signo = orden.dir === "asc" ? 1 : -1;
  return [...marcas].sort(
    (a, b) => signo * porClave(orden.clave, a, b) || texto(a.nombre, b.nombre) || texto(a.codigo, b.codigo)
  );
}

/** Pulsar la columna vigente invierte el sentido; otra columna empieza en ascendente. */
export function alternarOrden(actual: OrdenMarca, clave: ClaveOrdenMarca): OrdenMarca {
  return actual.clave === clave ? { clave, dir: actual.dir === "asc" ? "desc" : "asc" } : { clave, dir: "asc" };
}
