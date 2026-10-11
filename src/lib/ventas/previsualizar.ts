import type { Acumulador } from "./acumulador";
import type { PrevisualizarPeticion } from "./tipos-api";

/**
 * Arma la petición de `POST /api/ventas/previsualizar` desde el acumulador:
 * solo los valores DISTINTOS (≈ 15 tiendas, ≈ 300 marcas, unos miles de
 * combinaciones; menos de 1 MB), en el mismo orden que sus diccionarios, que es
 * el que la respuesta conserva y el que espera `construirInforme`.
 */
export function crearPeticionPrevisualizar(acum: Acumulador): PrevisualizarPeticion {
  const d = acum.diccionarios;
  return {
    tiendas: [...d.tiendas],
    combinaciones: d.combinaciones.map((c) => ({
      genero: c.genero,
      mundo: c.mundo,
      linea: c.linea,
      equivalencia: c.equivalencia,
    })),
    marcas: [...d.marcas],
    periodos: [...d.periodos].sort(),
  };
}
