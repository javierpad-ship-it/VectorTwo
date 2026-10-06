/**
 * Estado de prueba compartido por los tests de M3. Un árbol pequeño con
 * todas las situaciones que las reglas 7–18 necesitan: nodos no vigentes por
 * cada uno de los cuatro `activo`, equivalencias inactivas, una agrupación
 * inactiva y una equivalencia que apunta a una agrupación que no está en la
 * lista (imposible con la FK, pero la regla 9 lo cubre).
 *
 * Las formas son supersets de lo que piden `aplanarEquivalencias`,
 * `armarArbol` y `planificarImportacionEstacionalidad`, así que un mismo
 * objeto sirve para las tres.
 */

export type GeneroFx = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };
export type LineaFx = { id: string; codigo: string; nombre: string; temporada: string; activo: boolean };
export type NodoFx = { id: string; genero_id: string; mundo_id: string; linea_id: string; activo: boolean };
export type EquivalenciaFx = {
  id: string;
  genero_mundo_linea_id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
  agrupacion_estacionalidad_id: string | null;
};
export type AgrupacionFx = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
  /** Géneros de la agrupación (vacío = heredada "sin género"). */
  genero_ids: string[];
};

export type EstadoFx = {
  generos: GeneroFx[];
  mundos: GeneroFx[];
  lineas: LineaFx[];
  nodos: NodoFx[];
  equivalencias: EquivalenciaFx[];
  agrupaciones: AgrupacionFx[];
};

const GENERICA = { codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true } as const;

const eq = (
  id: string,
  nodo: string,
  nombre: string,
  agrupacion: string | null,
  extra: Partial<Pick<EquivalenciaFx, "activo" | "es_generica" | "codigo">> = {}
): EquivalenciaFx => ({
  id,
  genero_mundo_linea_id: nodo,
  codigo: extra.codigo ?? nombre.replace(/ /g, "_"),
  nombre,
  es_generica: extra.es_generica ?? false,
  activo: extra.activo ?? true,
  agrupacion_estacionalidad_id: agrupacion,
});

/** Estado nuevo en cada llamada: los tests pueden mutarlo sin afectar a otros. */
export function estadoFx(): EstadoFx {
  return {
    generos: [
      { id: "g-m", codigo: "M", nombre: "MUJER", orden: 20, activo: true },
      { id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true },
      { id: "g-x", codigo: "OTROS", nombre: "OTROS", orden: 80, activo: false },
    ],
    mundos: [
      { id: "m-ur", codigo: "URBANO", nombre: "URBANO", orden: 20, activo: true },
      { id: "m-ca", codigo: "CASUAL", nombre: "CASUAL", orden: 10, activo: true },
      { id: "m-fo", codigo: "FORMAL", nombre: "FORMAL", orden: 40, activo: false },
    ],
    lineas: [
      { id: "l-pant", codigo: "PANTALON", nombre: "PANTALON", temporada: "Todo el año", activo: true },
      { id: "l-blu", codigo: "BLUSA", nombre: "BLUSA", temporada: "Verano", activo: true },
      { id: "l-abr", codigo: "ABRIGO", nombre: "ABRIGO", temporada: "Invierno", activo: false },
    ],
    nodos: [
      { id: "n1", genero_id: "g-h", mundo_id: "m-ur", linea_id: "l-pant", activo: true },
      { id: "n2", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-pant", activo: true },
      { id: "n3", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-blu", activo: true },
      { id: "n4", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-abr", activo: true }, // línea inactiva
      { id: "n5", genero_id: "g-h", mundo_id: "m-fo", linea_id: "l-pant", activo: true }, // mundo inactivo
      { id: "n6", genero_id: "g-h", mundo_id: "m-ca", linea_id: "l-blu", activo: false }, // nodo inactivo
      { id: "n7", genero_id: "g-x", mundo_id: "m-ur", linea_id: "l-pant", activo: true }, // género inactivo
    ],
    equivalencias: [
      eq("e1", "n1", GENERICA.nombre, null, GENERICA), // genérica sin agrupación → faltante
      eq("e2", "n1", "JOGGER", "a-inv"), // completa
      eq("e3", "n1", "CARGO", "a-old"), // agrupación inactiva → faltante
      eq("e4", "n1", "CHINO", null, { activo: false }), // inactiva: nunca faltante
      eq("e12", "n1", "FANTASMA", "a-no-existe"), // agrupación fuera de la lista → sin agrupación
      eq("e5", "n2", "PANTALON", null), // se llama como la línea
      eq("e6", "n2", GENERICA.nombre, "a-ver", GENERICA), // genérica con agrupación
      eq("e7", "n3", "MANGA LARGA", null),
      eq("e8", "n4", "VARIOS", null), // línea inactiva
      eq("e9", "n5", "VARIOS", null), // mundo inactivo
      eq("e10", "n6", "VARIOS", null), // nodo inactivo
      eq("e11", "n7", "VARIOS", null), // género inactivo
    ],
    agrupaciones: [
      // Las dos activas incluyen HOMBRE y MUJER (los dos géneros activos con nodos vigentes) para que las
      // pruebas anteriores al cambio "agrupaciones por género" no tengan que pensar en géneros; las pruebas
      // de género agregan las suyas con `agrupacionFx` (solo mujer, sin género…).
      { id: "a-ver", codigo: "PANTALONES_VERANO", nombre: "PANTALONES VERANO", orden: 20, activo: true, genero_ids: ["g-h", "g-m"] },
      { id: "a-inv", codigo: "PANTALONES_INVIERNO", nombre: "PANTALONES INVIERNO", orden: 10, activo: true, genero_ids: ["g-h", "g-m"] },
      { id: "a-old", codigo: "VIEJA", nombre: "VIEJA", orden: 5, activo: false, genero_ids: ["g-h"] },
    ],
  };
}

/** Ids de las equivalencias activas y vigentes, en el orden de la lista plana. */
export const ACTIVAS_VIGENTES_ORDENADAS = ["e3", "e12", "e2", "e1", "e7", "e5", "e6"];
/** De esas, las faltantes (regla 7). */
export const FALTANTES = ["e3", "e12", "e1", "e7", "e5"];

/** Agrupación activa extra para las pruebas de género (`agrupacionFx("a-solo-m", "SOLO MUJER", ["g-m"])`). */
export const agrupacionFx = (id: string, nombre: string, generoIds: string[], activo = true): AgrupacionFx => ({
  id,
  codigo: nombre.replace(/ /g, "_"),
  nombre,
  orden: 0,
  activo,
  genero_ids: generoIds,
});
