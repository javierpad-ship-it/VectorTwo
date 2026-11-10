import { NextRequest } from "next/server";

/** Ayudas de las pruebas de rutas del tablero de dirección (sin datos). */

export const URL_BASE = "http://localhost/api/direccion";

export const pedir = (ruta: string, consulta: Record<string, string | undefined> = {}): NextRequest => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(consulta)) if (v !== undefined) q.set(k, v);
  const texto = q.toString();
  return new NextRequest(`${URL_BASE}${ruta}${texto ? `?${texto}` : ""}`);
};

export const enviar = (ruta: string, cuerpo: unknown): NextRequest =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });

export const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;

/** Hoy en Lima para las pruebas (lo lee el `hoyLima` simulado): fija cuál es el último mes publicado y terminado. */
export const relojDePrueba = { hoy: "2026-11-10" };
