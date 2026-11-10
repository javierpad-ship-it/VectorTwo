import { expect } from "vitest";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { estadoRol, reiniciar } from "./direccion.fake-db";
import { reiniciarNino, sembrarCaso } from "./direccion.fixture";
import { leer, pedir, relojDePrueba } from "./direccion.soporte";

/**
 * Montaje común de las pruebas del tablero de dirección que usan la base falsa: deja el caso de §6.1 sembrado, el rol en admin y el reloj en el
 * 10 de noviembre de 2026. Los `vi.mock` van en cada archivo de prueba (vitest los eleva por archivo); las rutas se importan allí.
 */
export function montarCaso(vaciarCaches: () => void): void {
  reiniciar();
  reiniciarNino();
  vaciarCaches();
  estadoRol.rol = "admin";
  estadoRol.perfil = { id: "a0000008-0000-4000-8000-000000000001", email: "admin@example.com", nombre: "Admin A.", activo: true };
  relojDePrueba.hoy = "2026-11-10";
  sembrarCaso();
}

type Ruta = (request: import("next/server").NextRequest) => Promise<Response>;

/** `GET /api/direccion/tablero` que exige `200` y devuelve el tablero. */
export const lectorDeTablero =
  (tablero: Ruta) =>
  async (consulta: Record<string, string | undefined> = {}): Promise<TableroApi> => {
    const r = await tablero(pedir("/tablero", consulta));
    const cuerpo = await leer<TableroApi>(r);
    expect(r.status, JSON.stringify(cuerpo).slice(0, 400)).toBe(200);
    return cuerpo.data;
  };
