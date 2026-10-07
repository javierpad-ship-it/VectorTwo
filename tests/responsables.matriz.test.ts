import { describe, expect, it } from "vitest";
import {
  armarMatriz,
  combinacionVigente,
  compradoresAsignables,
  motivoFaltante,
  type PerfilEntrada,
} from "@/lib/responsables/matriz";
import {
  ADMIN,
  ANA,
  LUIS,
  PLANNER,
  asignacion,
  generos,
  lineas,
  matriz,
  mundos,
  nodo,
  perfiles,
  uuid,
} from "./responsables.fixture";

const responsable = (activo: boolean, rol: string) => ({ activo, rol });

describe("regla 1 · producto cartesiano", () => {
  it("8 × 5 = 40 celdas sin asignaciones ni nodos, todas faltantes", () => {
    const m = matriz();
    expect(m.celdas).toHaveLength(40);
    expect(m.celdas.every((c) => c.faltante && c.motivo_faltante === "sin_responsable" && c.lineas === 0)).toBe(true);
    expect(m.resumen.combinaciones).toBe(40);
    expect(m.resumen.faltantes).toBe(40);
    expect(m.resumen.con_responsable).toBe(0);
  });

  it("siguen siendo 40 con asignaciones y con nodos", () => {
    const m = matriz({
      asignaciones: [asignacion(1, 1, ANA), asignacion(8, 5, LUIS)],
      nodos: [nodo(1, 1, 1), nodo(1, 1, 2)],
    });
    expect(m.celdas).toHaveLength(40);
    expect(m.resumen.faltantes).toBe(38);
  });

  it("sin compradores en el sistema (solo el admin): 40 faltantes y compradores []", () => {
    const soloAdmin: PerfilEntrada[] = [perfiles.find((p) => p.id === ADMIN)!];
    const m = matriz({ perfiles: soloAdmin });
    expect(m.resumen.faltantes).toBe(40);
    expect(m.resumen.por_responsable).toEqual([]);
    expect(compradoresAsignables(soloAdmin)).toEqual([]);
  });

  it("ordena por género y mundo (orden, nombre) aunque lleguen desordenados", () => {
    const m = matriz({ generos: [...generos].reverse(), mundos: [...mundos].reverse() });
    expect(m.generos.map((g) => g.nombre)).toEqual(generos.map((g) => g.nombre));
    expect(m.celdas[0]).toMatchObject({ genero_id: generos[0].id, mundo_id: mundos[0].id });
    expect(m.celdas[1]).toMatchObject({ genero_id: generos[0].id, mundo_id: mundos[1].id });
    expect(m.celdas[5]).toMatchObject({ genero_id: generos[1].id, mundo_id: mundos[0].id });
  });

  it("a igualdad de orden, desempata por nombre", () => {
    const m = matriz({
      generos: [
        { ...generos[0], id: uuid(21), nombre: "ZETA", orden: 1 },
        { ...generos[1], id: uuid(22), nombre: "ALFA", orden: 1 },
      ],
    });
    expect(m.generos.map((g) => g.nombre)).toEqual(["ALFA", "ZETA"]);
  });

  it("sin incluirInactivos, solo géneros y mundos activos; con él, todos", () => {
    const gs = generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g));
    const ms = mundos.map((x, i) => (i === 0 ? { ...x, activo: false } : x));
    expect(matriz({ generos: gs, mundos: ms }).celdas).toHaveLength(7 * 4);
    expect(matriz({ generos: gs, mundos: ms, incluirInactivos: true }).celdas).toHaveLength(40);
  });

  it("un mundo nuevo agrega una columna de celdas sin responsable sin escribir nada", () => {
    const nuevo = { id: uuid(110), codigo: "NUEVO", nombre: "NUEVO", orden: 60, activo: true };
    const m = matriz({ mundos: [...mundos, nuevo], asignaciones: [asignacion(1, 1, ANA)] });
    expect(m.celdas).toHaveLength(48);
    expect(m.celdas.filter((c) => c.mundo_id === nuevo.id).every((c) => c.motivo_faltante === "sin_responsable")).toBe(true);
  });

  it("devuelve los catálogos con la forma del contrato", () => {
    const m = matriz();
    expect(m.generos[0]).toEqual({ id: generos[0].id, codigo: "HOMBRE", nombre: "HOMBRE", orden: 10, activo: true });
  });
});

describe("regla 2 · vigencia", () => {
  it("combinacionVigente exige género y mundo activos", () => {
    expect(combinacionVigente({ activo: true }, { activo: true })).toBe(true);
    expect(combinacionVigente({ activo: false }, { activo: true })).toBe(false);
    expect(combinacionVigente({ activo: true }, { activo: false })).toBe(false);
  });

  it("una celda no vigente no es faltante aunque no tenga responsable, y conserva su asignación", () => {
    const gs = generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g));
    const m = matriz({ generos: gs, asignaciones: [asignacion(1, 1, ANA)], incluirInactivos: true });
    const sinResp = m.celdas.find((c) => c.genero_id === uuid(1) && c.mundo_id === uuid(102))!;
    expect(sinResp).toMatchObject({ vigente: false, faltante: false, motivo_faltante: null, responsable: null });
    const conResp = m.celdas.find((c) => c.genero_id === uuid(1) && c.mundo_id === uuid(101))!;
    expect(conResp).toMatchObject({ vigente: false, faltante: false, responsable: { id: ANA } });
    // El resumen solo cuenta las vigentes: 7 × 5.
    expect(m.resumen.combinaciones).toBe(35);
    expect(m.resumen.faltantes).toBe(35);
    expect(m.resumen.por_responsable).toEqual([]);
  });

  it("reactivar el género devuelve la asignación a la cuenta", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, ANA)] });
    expect(m.resumen.por_responsable).toMatchObject([{ perfil_id: ANA, combinaciones: 1, valido: true }]);
  });
});

describe("regla 3 · motivoFaltante", () => {
  it("vigente sin responsable → sin_responsable", () => {
    expect(motivoFaltante({ vigente: true, responsable: null })).toBe("sin_responsable");
  });
  it("vigente con responsable activo y comprador → null", () => {
    expect(motivoFaltante({ vigente: true, responsable: responsable(true, "comprador") })).toBeNull();
  });
  it("responsable desactivado → responsable_inactivo", () => {
    expect(motivoFaltante({ vigente: true, responsable: responsable(false, "comprador") })).toBe("responsable_inactivo");
  });
  it("responsable que ya no es comprador → responsable_no_comprador", () => {
    expect(motivoFaltante({ vigente: true, responsable: responsable(true, "planner") })).toBe("responsable_no_comprador");
    expect(motivoFaltante({ vigente: true, responsable: responsable(true, "admin") })).toBe("responsable_no_comprador");
  });
  it("desactivado y no comprador a la vez → gana responsable_inactivo", () => {
    expect(motivoFaltante({ vigente: true, responsable: responsable(false, "planner") })).toBe("responsable_inactivo");
  });
  it("no vigente → nunca faltante", () => {
    expect(motivoFaltante({ vigente: false, responsable: null })).toBeNull();
    expect(motivoFaltante({ vigente: false, responsable: responsable(false, "planner") })).toBeNull();
  });
  it("una fila con activo = false cuenta como sin responsable", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, ANA, false)] });
    expect(m.celdas[0]).toMatchObject({ responsable: null, motivo_faltante: "sin_responsable" });
  });
  it("una fila cuyo perfil no existe cuenta como sin responsable", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, uuid(999))] });
    expect(m.celdas[0]).toMatchObject({ responsable: null, motivo_faltante: "sin_responsable" });
  });
  it("la celda trae nombre, correo, rol y activo del responsable", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, LUIS)] });
    expect(m.celdas[0].responsable).toEqual({
      id: LUIS,
      nombre: null,
      email: "luis@lukers.pe",
      rol: "comprador",
      activo: true,
    });
  });
});

describe("regla 4 · resumen consistente", () => {
  it("combinaciones = con_responsable + faltantes y faltantes = suma de motivos", () => {
    const desactivados = perfiles.map((p) => (p.id === LUIS ? { ...p, activo: false } : p));
    const m = matriz({
      perfiles: desactivados,
      asignaciones: [
        asignacion(1, 1, ANA),
        asignacion(1, 2, ANA),
        asignacion(2, 1, LUIS), // desactivado
        asignacion(2, 2, PLANNER), // ya no es comprador
        asignacion(3, 1, PLANNER),
      ],
      nodos: [nodo(5, 5, 1)],
    });
    const r = m.resumen;
    expect(r.combinaciones).toBe(40);
    expect(r.con_responsable).toBe(2);
    expect(r.faltantes_sin_responsable).toBe(35);
    expect(r.faltantes_responsable_inactivo).toBe(1);
    expect(r.faltantes_responsable_no_comprador).toBe(2);
    expect(r.faltantes).toBe(38);
    expect(r.combinaciones).toBe(r.con_responsable + r.faltantes);
    expect(r.faltantes).toBe(r.faltantes_sin_responsable + r.faltantes_responsable_inactivo + r.faltantes_responsable_no_comprador);
    expect(m.celdas.filter((c) => c.faltante)).toHaveLength(r.faltantes);
  });

  it("por_responsable: más combinaciones primero, luego nombre; valido = activo y comprador", () => {
    const m = matriz({
      perfiles: perfiles.map((p) => (p.id === PLANNER ? p : p)),
      asignaciones: [
        asignacion(1, 1, ANA),
        asignacion(1, 2, LUIS),
        asignacion(2, 1, LUIS),
        asignacion(2, 2, PLANNER),
        asignacion(3, 3, ADMIN),
      ],
    });
    expect(m.resumen.por_responsable.map((p) => [p.perfil_id, p.combinaciones, p.valido])).toEqual([
      [LUIS, 2, true],
      [ANA, 1, true], // empate a 1: ANA RAMOS antes que JAVIER y PAOLA
      [ADMIN, 1, false],
      [PLANNER, 1, false],
    ]);
  });

  it("por_responsable usa el correo para ordenar a quien no tiene nombre", () => {
    const m = matriz({ asignaciones: [asignacion(1, 1, ANA), asignacion(1, 2, LUIS)] });
    // "ANA RAMOS" < "luis@lukers.pe"
    expect(m.resumen.por_responsable.map((p) => p.perfil_id)).toEqual([ANA, LUIS]);
  });

  it("por_responsable cuenta solo las celdas vigentes", () => {
    const gs = generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g));
    const m = matriz({
      generos: gs,
      asignaciones: [asignacion(1, 1, ANA), asignacion(2, 1, ANA)],
      incluirInactivos: true,
    });
    expect(m.resumen.por_responsable[0]).toMatchObject({ perfil_id: ANA, combinaciones: 1 });
  });

  it("el resumen es el mismo con o sin incluirInactivos", () => {
    const gs = generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g));
    const a = matriz({ generos: gs, asignaciones: [asignacion(2, 1, ANA)] });
    const b = matriz({ generos: gs, asignaciones: [asignacion(2, 1, ANA)], incluirInactivos: true });
    expect(a.resumen).toEqual(b.resumen);
  });

  it("repartir las 40 combinaciones deja faltantes = 0 (el hito)", () => {
    const todas = generos.flatMap((_, g) => mundos.map((__, m) => asignacion(g + 1, m + 1, g % 2 ? ANA : LUIS)));
    const m = matriz({ asignaciones: todas });
    expect(m.resumen.faltantes).toBe(0);
    expect(m.resumen.con_responsable).toBe(40);
    expect(m.resumen.por_responsable.map((p) => p.combinaciones)).toEqual([20, 20]);
  });
});

describe("regla 5 · líneas por celda", () => {
  it("cuenta los nodos vigentes de la pareja; sin nodos, 0 y sigue siendo celda", () => {
    const m = matriz({ nodos: [nodo(1, 1, 1), nodo(1, 1, 2), nodo(1, 1, 3), nodo(1, 2, 1)] });
    expect(m.celdas.find((c) => c.genero_id === uuid(1) && c.mundo_id === uuid(101))!.lineas).toBe(3);
    expect(m.celdas.find((c) => c.genero_id === uuid(1) && c.mundo_id === uuid(102))!.lineas).toBe(1);
    expect(m.celdas.find((c) => c.genero_id === uuid(5) && c.mundo_id === uuid(103))).toMatchObject({
      lineas: 0,
      faltante: true,
    });
  });

  it("no cuenta nodos inactivos ni de líneas inactivas, ni de géneros o mundos inactivos", () => {
    const gs = generos.map((g) => (g.id === uuid(2) ? { ...g, activo: false } : g));
    const ls = lineas.map((l) => (l.id === uuid(502) ? { ...l, activo: false } : l));
    const m = matriz({
      generos: gs,
      lineas: ls,
      incluirInactivos: true,
      nodos: [nodo(1, 1, 1), nodo(1, 1, 2, true), nodo(1, 1, 3, false), nodo(2, 1, 1)],
    });
    expect(m.celdas.find((c) => c.genero_id === uuid(1) && c.mundo_id === uuid(101))!.lineas).toBe(1);
    expect(m.celdas.find((c) => c.genero_id === uuid(2) && c.mundo_id === uuid(101))!.lineas).toBe(0);
  });

  it("ignora nodos huérfanos (línea o género que no están en la lectura)", () => {
    const m = matriz({ nodos: [{ ...nodo(1, 1, 1), linea_id: uuid(777) }, { ...nodo(1, 1, 1), genero_id: uuid(888) }] });
    expect(m.celdas[0].lineas).toBe(0);
  });

  it("faltantes_sin_lineas cuenta solo faltantes con lineas = 0", () => {
    const m = matriz({
      asignaciones: [asignacion(1, 1, ANA)],
      nodos: [nodo(1, 1, 1), nodo(1, 2, 1)],
    });
    // 40 - 1 asignada = 39 faltantes; solo (1,2) tiene líneas entre ellas.
    expect(m.resumen.faltantes).toBe(39);
    expect(m.resumen.faltantes_sin_lineas).toBe(38);
  });
});

describe("regla 15 · eliminar un usuario libera sus combinaciones", () => {
  it("sin las filas de ese perfil, esas celdas pasan a sin_responsable", () => {
    const filas = [asignacion(1, 1, ANA), asignacion(1, 2, ANA), asignacion(2, 1, LUIS)];
    const antes = matriz({ asignaciones: filas });
    const despues = matriz({
      asignaciones: filas.filter((f) => f.perfil_id !== ANA),
      perfiles: perfiles.filter((p) => p.id !== ANA),
    });
    expect(despues.resumen.faltantes).toBe(antes.resumen.faltantes + 2);
    expect(despues.celdas[0]).toMatchObject({ responsable: null, motivo_faltante: "sin_responsable" });
    expect(despues.resumen.por_responsable.map((p) => p.perfil_id)).toEqual([LUIS]);
  });
});

describe("regla 16 · desactivar o cambiar el rol conserva la asignación", () => {
  const filas = [asignacion(1, 1, ANA)];
  const con = (cambio: Partial<PerfilEntrada>) =>
    matriz({ asignaciones: filas, perfiles: perfiles.map((p) => (p.id === ANA ? { ...p, ...cambio } : p)) });

  it("desactivado → responsable_inactivo; reactivado → válido otra vez, sin reasignar", () => {
    expect(con({ activo: false }).celdas[0]).toMatchObject({ faltante: true, motivo_faltante: "responsable_inactivo" });
    expect(con({ activo: true }).celdas[0]).toMatchObject({ faltante: false, motivo_faltante: null });
  });

  it("cambiado a planner → responsable_no_comprador; devuelto a comprador → válido", () => {
    expect(con({ rol: "planner" }).celdas[0]).toMatchObject({ faltante: true, motivo_faltante: "responsable_no_comprador" });
    expect(con({ rol: "comprador" }).celdas[0]).toMatchObject({ faltante: false });
  });

  it("sigue contando en por_responsable, como no válido", () => {
    const r = con({ activo: false }).resumen;
    expect(r.por_responsable).toMatchObject([{ perfil_id: ANA, combinaciones: 1, valido: false }]);
    expect(r.faltantes_responsable_inactivo).toBe(1);
  });

  it("un rol desconocido (imposible por el check de la base) no vuelve válido al responsable", () => {
    expect(con({ rol: "otro" }).celdas[0]).toMatchObject({ faltante: true, motivo_faltante: "responsable_no_comprador" });
  });
});

describe("compradoresAsignables", () => {
  it("solo compradores activos, por nombre o correo; admin y planner no aparecen", () => {
    const extra: PerfilEntrada[] = [
      ...perfiles,
      { id: uuid(910), nombre: "ZOILA", email: "z@lukers.pe", rol: "comprador", activo: true },
      { id: uuid(911), nombre: "BETO", email: "b@lukers.pe", rol: "comprador", activo: false },
    ];
    expect(compradoresAsignables(extra).map((c) => c.id)).toEqual([ANA, LUIS, uuid(910)]);
  });
});

describe("armarMatriz · no muta la entrada", () => {
  it("deja intactos los arreglos recibidos", () => {
    const gs = [...generos].reverse();
    const copia = JSON.stringify(gs);
    armarMatriz(gs, mundos, [], perfiles, [], lineas, { incluirInactivos: false });
    expect(JSON.stringify(gs)).toBe(copia);
  });
});
