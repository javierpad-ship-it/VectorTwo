import { describe, expect, it } from "vitest";
import {
  aplicarPlanAsignacion,
  avisoResponsabilidades,
  clasificarCombinaciones,
  contarPorPerfil,
  deduplicarCombinaciones,
  motivoRechazoAsignacion,
  motivoRechazoPerfil,
  planificarAsignacion,
  planificarBloque,
  type AsignacionActual,
} from "@/lib/responsables/reglas";
import { motivoRechazo } from "@/lib/usuarios/reglas";
import { ADMIN, ANA, LUIS, PLANNER, asignacion, generos, matriz, mundos, perfiles, uuid } from "./responsables.fixture";

const comprador = { nombre: "ANA RAMOS", email: "ana@lukers.pe", rol: "comprador", activo: true };
const generoOk = { nombre: "HOMBRE", activo: true };
const mundoOk = { nombre: "URBANO", activo: true };

describe("regla 6 · motivoRechazoAsignacion", () => {
  const base = { perfilId: ANA, perfil: comprador, genero: generoOk, mundo: mundoOk };

  it("todo bien → null", () => {
    expect(motivoRechazoAsignacion(base)).toBeNull();
  });
  it("usuario inexistente → 404", () => {
    expect(motivoRechazoAsignacion({ ...base, perfil: null })).toEqual({ status: 404, mensaje: "Usuario no encontrado." });
    expect(motivoRechazoAsignacion({ ...base, perfil: undefined })?.status).toBe(404);
  });
  it("género o mundo inexistente → 404", () => {
    expect(motivoRechazoAsignacion({ ...base, genero: null })).toEqual({ status: 404, mensaje: "Género no encontrado." });
    expect(motivoRechazoAsignacion({ ...base, mundo: null })).toEqual({ status: 404, mensaje: "Mundo no encontrado." });
  });
  it("admin o planner → 409 'no es comprador', aunque estén activos", () => {
    expect(motivoRechazoAsignacion({ ...base, perfil: { ...comprador, rol: "admin" } })).toEqual({
      status: 409,
      mensaje: "ANA RAMOS no es comprador: solo los compradores pueden ser responsables.",
    });
    expect(motivoRechazoAsignacion({ ...base, perfil: { ...comprador, rol: "planner" } })?.status).toBe(409);
  });
  it("comprador desactivado → 409", () => {
    expect(motivoRechazoAsignacion({ ...base, perfil: { ...comprador, activo: false } })).toEqual({
      status: 409,
      mensaje: "ANA RAMOS está desactivado. Reactívalo o elige otro.",
    });
  });
  it("no comprador y desactivado a la vez → gana 'no es comprador'", () => {
    expect(motivoRechazoAsignacion({ ...base, perfil: { ...comprador, rol: "planner", activo: false } })?.mensaje).toMatch(
      /no es comprador/
    );
  });
  it("sin nombre usa el correo en el mensaje", () => {
    expect(
      motivoRechazoAsignacion({ ...base, perfil: { ...comprador, nombre: null, activo: false } })?.mensaje
    ).toBe("ana@lukers.pe está desactivado. Reactívalo o elige otro.");
  });
  it("género o mundo inactivo → 409", () => {
    expect(motivoRechazoAsignacion({ ...base, genero: { nombre: "HOMBRE", activo: false } })).toEqual({
      status: 409,
      mensaje: "HOMBRE está inactivo: no se puede asignar responsable.",
    });
    expect(motivoRechazoAsignacion({ ...base, mundo: { nombre: "URBANO", activo: false } })?.mensaje).toBe(
      "URBANO está inactivo: no se puede asignar responsable."
    );
  });
  it("quitar (perfilId null) no evalúa el perfil ni la vigencia", () => {
    expect(
      motivoRechazoAsignacion({
        perfilId: null,
        perfil: null,
        genero: { nombre: "HOMBRE", activo: false },
        mundo: { nombre: "URBANO", activo: false },
      })
    ).toBeNull();
  });
  it("quitar sigue exigiendo que el género y el mundo existan", () => {
    expect(motivoRechazoAsignacion({ perfilId: null, perfil: null, genero: null, mundo: mundoOk })?.status).toBe(404);
  });
  it("motivoRechazoPerfil es la parte del destino (la usa el bloque)", () => {
    expect(motivoRechazoPerfil(comprador)).toBeNull();
    expect(motivoRechazoPerfil(undefined)?.status).toBe(404);
    expect(motivoRechazoPerfil({ ...comprador, rol: "admin" })?.status).toBe(409);
  });
});

describe("clasificarCombinaciones", () => {
  const gs = [
    { id: uuid(1), activo: true },
    { id: uuid(2), activo: false },
  ];
  const ms = [
    { id: uuid(101), activo: true },
    { id: uuid(102), activo: false },
  ];
  const par = (g: number, m: number) => ({ genero_id: uuid(g), mundo_id: uuid(m) });

  it("separa válidas, no encontradas y no vigentes, y deduplica", () => {
    const r = clasificarCombinaciones(
      [par(1, 101), par(1, 101), par(9, 101), par(1, 109), par(2, 101), par(1, 102)],
      gs,
      ms,
      { soloVigentes: true }
    );
    expect(r.validas).toEqual([par(1, 101)]);
    expect(r.no_encontradas).toEqual([par(9, 101), par(1, 109)]);
    expect(r.no_vigentes).toEqual([par(2, 101), par(1, 102)]);
  });
  it("al quitar, las no vigentes sí pasan (quitar siempre se permite)", () => {
    const r = clasificarCombinaciones([par(2, 101), par(1, 102), par(9, 101)], gs, ms, { soloVigentes: false });
    expect(r.validas).toEqual([par(2, 101), par(1, 102)]);
    expect(r.no_vigentes).toEqual([]);
    expect(r.no_encontradas).toEqual([par(9, 101)]);
  });
  it("deduplicarCombinaciones conserva el orden de la primera aparición", () => {
    expect(deduplicarCombinaciones([par(1, 101), par(1, 102), par(1, 101)])).toEqual([par(1, 101), par(1, 102)]);
  });
});

describe("regla 7 · planificarAsignacion", () => {
  const par = (g: number, m: number) => ({ genero_id: uuid(g), mundo_id: uuid(100 + m) });
  const fila = (g: number, m: number, perfil: string, activo = true): AsignacionActual => ({
    id: uuid(3000 + g * 10 + m),
    ...asignacion(g, m, perfil, activo),
  });
  // Fila HOMBRE: 5 mundos. 1: ANA, 2: LUIS, 3: PLANNER (ya no comprador), 4: sin fila, 5: sin fila.
  const filaHombre = [par(1, 1), par(1, 2), par(1, 3), par(1, 4), par(1, 5)];
  const actuales = [fila(1, 1, ANA), fila(1, 2, LUIS), fila(1, 3, PLANNER)];

  it("asignar sin solo_faltantes pisa todo menos lo que ya es de ese perfil", () => {
    const plan = planificarAsignacion(actuales, filaHombre, ANA, { soloFaltantes: false }, perfiles);
    expect(plan.asignar).toEqual([par(1, 2), par(1, 3), par(1, 4), par(1, 5)]);
    expect(plan.sin_cambio).toBe(1);
    expect(plan.con_responsable).toBe(0);
    expect(plan.quitar).toEqual([]);
  });

  it("con solo_faltantes respeta al responsable válido distinto y reemplaza al no válido", () => {
    const plan = planificarAsignacion(actuales, filaHombre, ANA, { soloFaltantes: true }, perfiles);
    // 1 ya es de ANA → sin_cambio; 2 es de LUIS (válido) → respetada; 3 es de un planner → se reemplaza.
    expect(plan.asignar).toEqual([par(1, 3), par(1, 4), par(1, 5)]);
    expect(plan.sin_cambio).toBe(1);
    expect(plan.con_responsable).toBe(1);
  });

  it("con solo_faltantes, un responsable desactivado sí se reemplaza", () => {
    const desactivados = perfiles.map((p) => (p.id === LUIS ? { ...p, activo: false } : p));
    const plan = planificarAsignacion(actuales, filaHombre, ANA, { soloFaltantes: true }, desactivados);
    expect(plan.asignar).toContainEqual(par(1, 2));
    expect(plan.con_responsable).toBe(0);
  });

  it("deduplica las combinaciones repetidas", () => {
    const plan = planificarAsignacion([], [par(1, 1), par(1, 1), par(1, 1)], ANA, { soloFaltantes: false }, perfiles);
    expect(plan.asignar).toEqual([par(1, 1)]);
  });

  it("quitar: las celdas con fila van a quitar (con su id) y las demás a sin_cambio", () => {
    const plan = planificarAsignacion(actuales, filaHombre, null, { soloFaltantes: false }, perfiles);
    expect(plan.quitar.map((f) => f.id)).toEqual([uuid(3011), uuid(3012), uuid(3013)]);
    expect(plan.sin_cambio).toBe(2);
    expect(plan.asignar).toEqual([]);
  });

  it("una fila con activo = false se reasigna aunque ya apunte a ese perfil", () => {
    const plan = planificarAsignacion([fila(1, 1, ANA, false)], [par(1, 1)], ANA, { soloFaltantes: true }, perfiles);
    expect(plan.asignar).toEqual([par(1, 1)]);
    expect(plan.sin_cambio).toBe(0);
  });

  it("idempotencia al asignar: planificar sobre el estado resultante no escribe nada", () => {
    for (const soloFaltantes of [false, true]) {
      const plan = planificarAsignacion(actuales, filaHombre, ANA, { soloFaltantes }, perfiles);
      const despues = aplicarPlanAsignacion(actuales, plan, ANA);
      const otra = planificarAsignacion(despues, filaHombre, ANA, { soloFaltantes }, perfiles);
      expect(otra.asignar).toEqual([]);
      expect(otra.quitar).toEqual([]);
      // Aplicar dos veces el mismo plan produce el mismo estado.
      const dosVeces = aplicarPlanAsignacion(despues, plan, ANA);
      const ordenar = (xs: AsignacionActual[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
      expect(ordenar(dosVeces)).toEqual(ordenar(despues));
    }
  });

  it("idempotencia al quitar: tras quitar no queda nada por quitar", () => {
    const plan = planificarAsignacion(actuales, filaHombre, null, { soloFaltantes: false }, perfiles);
    const despues = aplicarPlanAsignacion(actuales, plan, null);
    expect(despues).toEqual([]);
    const otra = planificarAsignacion(despues, filaHombre, null, { soloFaltantes: false }, perfiles);
    expect(otra.quitar).toEqual([]);
    expect(otra.sin_cambio).toBe(5);
  });

  it("un bloque que falló a medias se completa repitiéndolo", () => {
    const todas = generos.flatMap((_, g) => mundos.map((__, m) => par(g + 1, m + 1)));
    const plan = planificarAsignacion([], todas, ANA, { soloFaltantes: true }, perfiles);
    expect(plan.asignar).toHaveLength(40);
    // Solo se escribió la primera mitad.
    const parcial = aplicarPlanAsignacion([], { asignar: plan.asignar.slice(0, 20), quitar: [] }, ANA);
    const reintento = planificarAsignacion(parcial, todas, ANA, { soloFaltantes: true }, perfiles);
    expect(reintento.asignar).toHaveLength(20);
    expect(reintento.sin_cambio).toBe(20);
    const final = aplicarPlanAsignacion(parcial, reintento, ANA);
    expect(final).toHaveLength(40);
  });
});

describe("regla 9 · planificarBloque", () => {
  // HOMBRE (género 1): mundos 1 y 2 asignados a compradores válidos.
  const m = matriz({ asignaciones: [asignacion(1, 1, ANA), asignacion(1, 2, LUIS)] });

  it("una fila de 5 con 2 asignadas válidas: con soloFaltantes son 3 y 2 se respetan", () => {
    const plan = planificarBloque(m.celdas, { genero_id: uuid(1) }, { soloFaltantes: true });
    expect(plan.combinaciones).toHaveLength(5);
    expect(plan.a_asignar).toBe(3);
    expect(plan.respetadas).toBe(2);
  });
  it("sin soloFaltantes se asignan las 5 y no se respeta ninguna", () => {
    const plan = planificarBloque(m.celdas, { genero_id: uuid(1) }, { soloFaltantes: false });
    expect(plan.a_asignar).toBe(5);
    expect(plan.respetadas).toBe(0);
  });
  it("una columna son 8 combinaciones", () => {
    const plan = planificarBloque(m.celdas, { mundo_id: uuid(101) }, { soloFaltantes: true });
    expect(plan.combinaciones).toHaveLength(8);
    expect(plan.respetadas).toBe(1);
  });
  it("'todas' cubre las 40", () => {
    const plan = planificarBloque(m.celdas, "todas", { soloFaltantes: true });
    expect(plan.combinaciones).toHaveLength(40);
    expect(plan.a_asignar).toBe(38);
    expect(plan.respetadas).toBe(2);
  });
  it("una celda con responsable desactivado o no comprador no se respeta", () => {
    const desactivado = matriz({
      asignaciones: [asignacion(1, 1, ANA), asignacion(1, 2, PLANNER)],
      perfiles: perfiles.map((p) => (p.id === ANA ? { ...p, activo: false } : p)),
    });
    const plan = planificarBloque(desactivado.celdas, { genero_id: uuid(1) }, { soloFaltantes: true });
    expect(plan.respetadas).toBe(0);
    expect(plan.a_asignar).toBe(5);
  });
  it("las celdas no vigentes nunca entran", () => {
    const inactivo = matriz({
      generos: generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g)),
      mundos: mundos.map((x, i) => (i === 1 ? { ...x, activo: false } : x)),
      incluirInactivos: true,
    });
    expect(planificarBloque(inactivo.celdas, { genero_id: uuid(1) }, { soloFaltantes: false }).combinaciones).toEqual([]);
    const columna = planificarBloque(inactivo.celdas, { mundo_id: uuid(102) }, { soloFaltantes: false });
    expect(columna.combinaciones).toEqual([]);
    expect(planificarBloque(inactivo.celdas, "todas", { soloFaltantes: false }).combinaciones).toHaveLength(7 * 4);
  });
  it("coincide con lo que haría el servidor sobre el mismo estado", () => {
    const plan = planificarBloque(m.celdas, { genero_id: uuid(1) }, { soloFaltantes: true });
    const actuales: AsignacionActual[] = [asignacion(1, 1, ANA), asignacion(1, 2, LUIS)].map((a, i) => ({
      id: uuid(4000 + i),
      ...a,
    }));
    const servidor = planificarAsignacion(actuales, plan.combinaciones, uuid(950), { soloFaltantes: true }, perfiles);
    expect(servidor.asignar).toHaveLength(plan.a_asignar);
    expect(servidor.con_responsable).toBe(plan.respetadas);
  });
});

describe("regla 10 · avisoResponsabilidades", () => {
  it("n = 0 → null para las tres acciones", () => {
    expect(avisoResponsabilidades("desactivar", 0)).toBeNull();
    expect(avisoResponsabilidades("eliminar", 0)).toBeNull();
    expect(avisoResponsabilidades("cambiar_rol", 0)).toBeNull();
  });
  it("desactivar: conteo en plural y nombre", () => {
    expect(avisoResponsabilidades("desactivar", 6, "ANA RAMOS")).toBe(
      "ANA RAMOS es responsable de 6 combinaciones género-mundo. Seguirán asignadas pero aparecerán como Faltantes (responsable desactivado) hasta que las reasignes. ¿Desactivar?"
    );
  });
  it("eliminar: avisa que quedan sin responsable", () => {
    const t = avisoResponsabilidades("eliminar", 6, "ANA RAMOS");
    expect(t).toMatch(/^ANA RAMOS es responsable de 6 combinaciones género-mundo\./);
    expect(t).toMatch(/sin responsable/);
    expect(t).toMatch(/Faltantes/);
    expect(t).toMatch(/¿Eliminar definitivamente\?$/);
  });
  it("cambiar_rol: avisa que dejará de ser comprador", () => {
    const t = avisoResponsabilidades("cambiar_rol", 6, "ANA RAMOS");
    expect(t).toMatch(/Solo los compradores pueden serlo/);
    expect(t).toMatch(/ya no es comprador/);
  });
  it("singular con 1", () => {
    for (const accion of ["desactivar", "eliminar", "cambiar_rol"] as const) {
      const t = avisoResponsabilidades(accion, 1, "ANA RAMOS");
      expect(t).toMatch(/de 1 combinación género-mundo/);
      expect(t).not.toMatch(/combinaciones/);
    }
    expect(avisoResponsabilidades("desactivar", 1)).toMatch(/Seguirá asignada pero aparecerá como Faltante /);
  });
  it("sin nombre usa 'Este usuario'", () => {
    expect(avisoResponsabilidades("desactivar", 2)).toMatch(/^Este usuario es responsable de 2 combinaciones/);
  });
  it("nunca rechaza: las reglas de /usuarios no miran las responsabilidades", () => {
    const admin = { id: ADMIN, rol: "admin", activo: true };
    const otroAdmin = { id: uuid(950), rol: "admin", activo: true };
    const ana = { id: ANA, rol: "comprador", activo: true };
    const todos = [admin, otroAdmin, ana];
    expect(motivoRechazo(admin, ana, todos, { activo: false })).toBeNull();
    expect(motivoRechazo(admin, ana, todos, { rol: "planner" })).toBeNull();
    expect(motivoRechazo(admin, ana, todos, { eliminar: true })).toBeNull();
  });
  it("contarPorPerfil agrupa las filas por perfil", () => {
    const conteo = contarPorPerfil([{ perfil_id: ANA }, { perfil_id: ANA }, { perfil_id: LUIS }]);
    expect(conteo.get(ANA)).toBe(2);
    expect(conteo.get(LUIS)).toBe(1);
    expect(conteo.get(PLANNER)).toBeUndefined();
  });
});
