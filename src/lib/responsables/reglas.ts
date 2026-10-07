import type { Tables } from "@/lib/supabase/database.types";
import { ROL_RESPONSABLE, type AccionUsuarioConResponsabilidades, type AmbitoBloque, type Celda, type Combinacion, type PlanBloque } from "./tipos";
import { etiquetaPerfil, motivoFaltante, responsableValido, type PerfilEntrada } from "./matriz";

/**
 * Reglas de negocio de M1b (docs/modulos/01b-responsables.md, reglas 6, 7, 9
 * y 10). Funciones puras: los handlers las llaman antes de tocar la base; el
 * único `(genero_id, mundo_id)`, las FK y el `on delete cascade` son la
 * garantía final.
 */

export type RechazoAsignacion = { status: 404 | 409; mensaje: string };

export const GENERO_NO_ENCONTRADO = "Género no encontrado.";
export const MUNDO_NO_ENCONTRADO = "Mundo no encontrado.";
export const USUARIO_NO_ENCONTRADO = "Usuario no encontrado.";

export type PerfilAsignable = Pick<PerfilEntrada, "nombre" | "email" | "rol" | "activo">;
export type CatalogoAsignable = { nombre: string; activo: boolean };

/**
 * Regla 6 (parte del perfil): solo un comprador activo puede ser responsable.
 * `undefined` / `null` → el usuario no existe (`404`). Un administrador o
 * planner nunca es asignable, aunque esté activo (respuesta 1 de Javier). Se
 * evalúa antes la falta de rol que la desactivación.
 */
export function motivoRechazoPerfil(perfil: PerfilAsignable | null | undefined): RechazoAsignacion | null {
  if (!perfil) return { status: 404, mensaje: USUARIO_NO_ENCONTRADO };
  if (perfil.rol !== ROL_RESPONSABLE) {
    return {
      status: 409,
      mensaje: `${etiquetaPerfil(perfil)} no es comprador: solo los compradores pueden ser responsables.`,
    };
  }
  if (!perfil.activo) {
    return { status: 409, mensaje: `${etiquetaPerfil(perfil)} está desactivado. Reactívalo o elige otro.` };
  }
  return null;
}

/**
 * Regla 6: por qué no se puede poner (o quitar) un responsable en una
 * combinación, con el status HTTP que corresponde. Orden: género o mundo
 * inexistente (`404`), usuario inexistente (`404`), usuario no comprador
 * (`409`), usuario desactivado (`409`), género o mundo inactivo (`409`).
 *
 * `perfilId = null` (quitar): no se evalúa el perfil ni la vigencia; solo que
 * el género y el mundo existan. `genero` / `mundo` en `null` o `undefined` =
 * no existen.
 */
export function motivoRechazoAsignacion(entrada: {
  perfilId: string | null;
  perfil: PerfilAsignable | null | undefined;
  genero: CatalogoAsignable | null | undefined;
  mundo: CatalogoAsignable | null | undefined;
}): RechazoAsignacion | null {
  const { perfilId, perfil, genero, mundo } = entrada;
  if (!genero) return { status: 404, mensaje: GENERO_NO_ENCONTRADO };
  if (!mundo) return { status: 404, mensaje: MUNDO_NO_ENCONTRADO };
  if (perfilId === null) return null;
  const rechazoPerfil = motivoRechazoPerfil(perfil);
  if (rechazoPerfil) return rechazoPerfil;
  if (!genero.activo) return { status: 409, mensaje: `${genero.nombre} está inactivo: no se puede asignar responsable.` };
  if (!mundo.activo) return { status: 409, mensaje: `${mundo.nombre} está inactivo: no se puede asignar responsable.` };
  return null;
}

// ─── Plan de la asignación en bloque (regla 7) ───

export type AsignacionActual = Pick<Tables<"responsables_genero_mundo">, "id" | "genero_id" | "mundo_id" | "perfil_id" | "activo">;

/** Una fila a borrar: con su `id`, porque el handler borra por `id` en tandas. */
export type FilaAQuitar = Pick<AsignacionActual, "id" | "genero_id" | "mundo_id">;

export type PlanAsignacion = {
  /** Combinaciones a escribir con `upsert` (`onConflict: "genero_id,mundo_id"`, `activo: true`). */
  asignar: Combinacion[];
  /** Filas a borrar. */
  quitar: FilaAQuitar[];
  /** Ya tenían ese responsable (o no tenían y se pidió quitar). */
  sin_cambio: number;
  /** Saltadas por `solo_faltantes`: ya tienen un responsable válido distinto. */
  con_responsable: number;
};

const clave = (c: Combinacion) => `${c.genero_id}|${c.mundo_id}`;

/** Quita las combinaciones repetidas conservando el orden de la primera aparición. */
export function deduplicarCombinaciones<T extends Combinacion>(combinaciones: T[]): T[] {
  const vistas = new Set<string>();
  const salida: T[] = [];
  for (const c of combinaciones) {
    const k = clave(c);
    if (vistas.has(k)) continue;
    vistas.add(k);
    salida.push(c);
  }
  return salida;
}

export type ClasificacionCombinaciones = {
  validas: Combinacion[];
  no_encontradas: Combinacion[];
  no_vigentes: Combinacion[];
};

/**
 * Separa las combinaciones pedidas (regla 7, paso 2 del contrato): deduplica;
 * las de un género o mundo que ya no existe van a `no_encontradas`; con
 * `soloVigentes` (al asignar), las de un género o mundo inactivo van a
 * `no_vigentes`. Quitar (`soloVigentes: false`) siempre se permite en las que
 * existen. Ninguna de las dos listas aborta la petición.
 */
export function clasificarCombinaciones(
  combinaciones: Combinacion[],
  generos: Array<{ id: string; activo: boolean }>,
  mundos: Array<{ id: string; activo: boolean }>,
  opciones: { soloVigentes: boolean }
): ClasificacionCombinaciones {
  const generoPorId = new Map(generos.map((g) => [g.id, g]));
  const mundoPorId = new Map(mundos.map((m) => [m.id, m]));
  const salida: ClasificacionCombinaciones = { validas: [], no_encontradas: [], no_vigentes: [] };
  for (const c of deduplicarCombinaciones(combinaciones)) {
    const par = { genero_id: c.genero_id, mundo_id: c.mundo_id };
    const genero = generoPorId.get(c.genero_id);
    const mundo = mundoPorId.get(c.mundo_id);
    if (!genero || !mundo) salida.no_encontradas.push(par);
    else if (opciones.soloVigentes && !(genero.activo && mundo.activo)) salida.no_vigentes.push(par);
    else salida.validas.push(par);
  }
  return salida;
}

/**
 * Regla 7: qué escribir para llevar `combinaciones` al estado pedido.
 *
 * - Deduplica.
 * - `perfilId` no nulo: una celda cuyo responsable ya es ese perfil (con la
 *   fila activa) va a `sin_cambio`; con `soloFaltantes`, una celda con
 *   responsable válido distinto (activo y comprador) va a `con_responsable` y
 *   no se toca; el resto (sin fila, con responsable desactivado o que ya no es
 *   comprador, o con la fila en `activo = false`) va a `asignar`.
 * - `perfilId = null`: las celdas con fila van a `quitar` (también una fila en
 *   `activo = false`, que así se limpia) y las demás a `sin_cambio`.
 *
 * Idempotente: planificar de nuevo sobre el estado resultante da
 * `asignar = []` y `quitar = []`.
 */
export function planificarAsignacion(
  actuales: AsignacionActual[],
  combinaciones: Combinacion[],
  perfilId: string | null,
  opciones: { soloFaltantes: boolean },
  perfiles: PerfilEntrada[]
): PlanAsignacion {
  const actualPorCelda = new Map(actuales.map((a) => [clave(a), a]));
  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));
  const plan: PlanAsignacion = { asignar: [], quitar: [], sin_cambio: 0, con_responsable: 0 };

  for (const c of deduplicarCombinaciones(combinaciones)) {
    const actual = actualPorCelda.get(clave(c));
    if (perfilId === null) {
      if (actual) plan.quitar.push({ id: actual.id, genero_id: actual.genero_id, mundo_id: actual.mundo_id });
      else plan.sin_cambio++;
      continue;
    }
    if (actual?.activo && actual.perfil_id === perfilId) {
      plan.sin_cambio++;
      continue;
    }
    if (opciones.soloFaltantes && actual?.activo) {
      const actualPerfil = perfilPorId.get(actual.perfil_id);
      if (actualPerfil && responsableValido({ activo: actualPerfil.activo, rol: actualPerfil.rol })) {
        plan.con_responsable++;
        continue;
      }
    }
    plan.asignar.push({ genero_id: c.genero_id, mundo_id: c.mundo_id });
  }
  return plan;
}

/**
 * Aplica un plan a un estado en memoria (para probar la idempotencia sin
 * base): reemplaza o crea las filas de `asignar` con `perfilId` y `activo`
 * verdadero, y borra las de `quitar`. Las filas nuevas llevan un `id`
 * sintético.
 */
export function aplicarPlanAsignacion(
  actuales: AsignacionActual[],
  plan: Pick<PlanAsignacion, "asignar" | "quitar">,
  perfilId: string | null
): AsignacionActual[] {
  const borrar = new Set(plan.quitar.map((f) => f.id));
  const resultado = new Map(actuales.filter((a) => !borrar.has(a.id)).map((a) => [clave(a), a]));
  if (perfilId !== null) {
    for (const c of plan.asignar) {
      const existente = resultado.get(clave(c));
      resultado.set(clave(c), {
        id: existente?.id ?? `nuevo-${clave(c)}`,
        genero_id: c.genero_id,
        mundo_id: c.mundo_id,
        perfil_id: perfilId,
        activo: true,
      });
    }
  }
  return [...resultado.values()];
}

// ─── Bloque desde la pantalla (regla 9) ───

function enAmbito(celda: Pick<Celda, "genero_id" | "mundo_id">, ambito: AmbitoBloque): boolean {
  if (ambito === "todas") return true;
  if ("genero_id" in ambito) return celda.genero_id === ambito.genero_id;
  return celda.mundo_id === ambito.mundo_id;
}

/**
 * Regla 9: qué hará un "Asignar…" sobre una fila (`{ genero_id }`), una
 * columna (`{ mundo_id }`) o toda la matriz (`"todas"`). `combinaciones` son
 * las vigentes del ámbito (las no vigentes nunca entran); con `soloFaltantes`,
 * las que ya tienen un responsable válido se respetan (`respetadas`) y el
 * resto se asignan (`a_asignar`); sin él, se asignan todas. El servidor
 * recalcula todo con `planificarAsignacion`: esto solo alimenta el texto del
 * panel.
 */
export function planificarBloque(celdas: Celda[], ambito: AmbitoBloque, opciones: { soloFaltantes: boolean }): PlanBloque {
  const vigentes = celdas.filter((c) => c.vigente && enAmbito(c, ambito));
  const respetadas = opciones.soloFaltantes ? vigentes.filter((c) => motivoFaltante(c) === null).length : 0;
  return {
    combinaciones: vigentes.map((c) => ({ genero_id: c.genero_id, mundo_id: c.mundo_id })),
    a_asignar: vigentes.length - respetadas,
    respetadas,
  };
}

// ─── /usuarios (regla 10) ───

/** Filas de asignación por perfil (vigentes o no). */
export function contarPorPerfil(asignaciones: Array<{ perfil_id: string }>): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const a of asignaciones) conteo.set(a.perfil_id, (conteo.get(a.perfil_id) ?? 0) + 1);
  return conteo;
}

/**
 * Regla 10: texto del `confirm` de `/usuarios` cuando el usuario tiene
 * combinaciones asignadas. `n = 0` → `null` (no se pregunta nada). Nunca es un
 * rechazo: `/usuarios` avisa y no bloquea. `nombre` es cómo se llama al usuario
 * en el texto (por defecto, "Este usuario").
 */
export function avisoResponsabilidades(
  accion: AccionUsuarioConResponsabilidades,
  n: number,
  nombre = "Este usuario"
): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const una = n === 1;
  const cuantas = `${n} ${una ? "combinación" : "combinaciones"}`;
  const inicio = `${nombre} es responsable de ${cuantas} género-mundo.`;
  const seguiran = una ? "Seguirá asignada pero aparecerá" : "Seguirán asignadas pero aparecerán";
  const reasignar = una ? "la reasignes" : "las reasignes";

  switch (accion) {
    case "desactivar":
      return `${inicio} ${seguiran} como Faltante${una ? "" : "s"} (responsable desactivado) hasta que ${reasignar}. ¿Desactivar?`;
    case "eliminar":
      return `${inicio} Al eliminar el usuario quedará${una ? "" : "n"} sin responsable y aparecerá${una ? "" : "n"} en Faltantes. ¿Eliminar definitivamente?`;
    case "cambiar_rol":
      return `${inicio} Solo los compradores pueden serlo: ${seguiran.toLowerCase()} como Faltante${una ? "" : "s"} (ya no es comprador) hasta que el rol vuelva a comprador o ${reasignar}. ¿Cambiar el rol?`;
  }
}
