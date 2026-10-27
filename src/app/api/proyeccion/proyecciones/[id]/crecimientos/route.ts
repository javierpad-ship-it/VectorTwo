import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { errorConCodigo } from "@/lib/curvas/lectura";
import { leerCrecimientosDeProyeccion } from "@/lib/proyeccion/servicio-crecimientos";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Proyección no encontrada.";

/** Texto del `410` del `PUT` (06d §3.2): los crecimientos ya no se escriben en la proyección. */
const MENSAJE_CRECIMIENTOS_GLOBALES = "Los crecimientos se aprueban en Curvas de estacionalidad → Crecimiento por género × mundo.";

/**
 * Resumen de SOLO LECTURA de los crecimientos que aplicó la proyección (`requirePlanner`; el comprador recibe `403`): por GM de HOMBRE y MUJER
 * y para el Resto, el % aplicado (de la foto, con su versión, quién y cuándo), el aprobado hoy en el global, la base `B`, el resultado, el
 * rebote del Niño y los conteos de filas fijadas a mano; el Total ponderado (`calcularPromedio`), el puente al Total del año siguiente, el
 * objetivo global, los que cambiaron después de calcular y lo que falta aprobar para cerrar. No lee `historico`, `factores_mes` ni venta.
 * `404` si la proyección no existe.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await leerCrecimientosDeProyeccion(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Retirado en `0.12.1` (06d §3.2): responde `410 crecimientos_globales` después de `requirePlanner` y SIN leer el cuerpo (un cuerpo roto también
 * da `410`). Así una pestaña vieja abierta no escribe nada. El comprador sigue recibiendo `403` y sin sesión, `401`.
 */
export async function PUT() {
  const { response } = await requirePlanner();
  if (response) return response;

  return errorConCodigo(MENSAJE_CRECIMIENTOS_GLOBALES, 410, "crecimientos_globales");
}
