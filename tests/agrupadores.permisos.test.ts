import { describe, expect, it } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import {
  GUARD_POR_ACCION,
  accionPermisoDeEstado,
  guardDeAccionEstado,
  permisosAgrupadores,
  puedeAgrupador,
  puedeCambiarEstado,
  type AccionAgrupadorPermiso,
} from "@/lib/compras/agrupadores/permisos";
import {
  COOKIE_VIAJE_ACTIVO,
  OPCIONES_COOKIE_VIAJE_ACTIVO,
  VIAJE_ACTIVO_SIN_VIAJE,
  VIAJE_ACTIVO_TODOS,
  esValorViajeActivo,
  etiquetaViajeSelector,
  filtroDeViajeActivo,
  ordenarViajesParaSelector,
  resolverViajeActivo,
  validarViajeActivo,
  viajeActivoPorDefecto,
} from "@/lib/compras/agrupadores/viaje-activo";
import { ACCIONES_ESTADO, ACCIONES_ESTADO_SOLO_PLANNER } from "@/lib/compras/agrupadores/tipos";
import { PERFIL_AGR, VIAJE_AGR, viaje261001 } from "./agrupadores.fixture";

/** R15 (permisos por rol, decisiones 92 y 95) y R22 (viaje activo, cookie y caso 19). */

const ROLES: Rol[] = ["admin", "planner", "comprador"];
const LOS_TRES: AccionAgrupadorPermiso[] = [
  "leer",
  "excel",
  "viaje_activo",
  "guardar_viaje",
  "guardar_embarque",
  "guardar_paquete",
  "importar_agrupadores",
  "asignar_compras_viaje",
  "movimiento_entregas",
  "cambiar_fecha",
  "marcar_en_transito",
  "recibir_embarque",
];
const SOLO_PLANNER: AccionAgrupadorPermiso[] = ["cerrar_viaje", "reabrir_viaje", "cancelar", "revertir_recepcion"];

describe("R15: el comprador escribe lo suyo y lo de los demás; 403 solo en cerrar, reabrir, cancelar y revertir", () => {
  it.each(LOS_TRES)("%s: los tres roles (requireUser)", (accion) => {
    expect(GUARD_POR_ACCION[accion]).toBe("requireUser");
    for (const rol of ROLES) expect(puedeAgrupador(rol, accion), `${rol} · ${accion}`).toBe(true);
  });

  it.each(SOLO_PLANNER)("%s: solo admin y planner (requirePlanner)", (accion) => {
    expect(GUARD_POR_ACCION[accion]).toBe("requirePlanner");
    expect(puedeAgrupador("admin", accion)).toBe(true);
    expect(puedeAgrupador("planner", accion)).toBe(true);
    expect(puedeAgrupador("comprador", accion)).toBe(false);
  });

  it("toda acción está en una de las dos listas", () => {
    expect([...LOS_TRES, ...SOLO_PLANNER].sort()).toEqual(Object.keys(GUARD_POR_ACCION).sort());
  });

  it("el permiso es por rol, no por responsable: no hay forma de preguntar por el responsable", () => {
    expect(puedeAgrupador.length).toBe(2);
    expect(permisosAgrupadores.length).toBe(1);
  });

  it("los guards de las acciones de estado: cerrar, reabrir y cancelar piden planner; marcar en tránsito, cualquiera", () => {
    expect(ACCIONES_ESTADO_SOLO_PLANNER).toEqual(["cerrar", "reabrir", "cancelar"]);
    for (const a of ACCIONES_ESTADO) {
      const soloPlanner = ACCIONES_ESTADO_SOLO_PLANNER.includes(a);
      expect(guardDeAccionEstado(a), a).toBe(soloPlanner ? "requirePlanner" : "requireUser");
      expect(puedeCambiarEstado("comprador", a), a).toBe(!soloPlanner);
      expect(puedeCambiarEstado("planner", a)).toBe(true);
      expect(puedeCambiarEstado("admin", a)).toBe(true);
    }
    expect(accionPermisoDeEstado("cerrar")).toBe("cerrar_viaje");
    expect(accionPermisoDeEstado("reabrir")).toBe("reabrir_viaje");
    expect(accionPermisoDeEstado("cancelar")).toBe("cancelar");
    expect(accionPermisoDeEstado("en_transito")).toBe("marcar_en_transito");
    expect(accionPermisoDeEstado("volver_a_planificado")).toBe("marcar_en_transito");
  });

  it("caso 19a: C2 (comprador) opera sobre un viaje cerrado pero recibe 403 al reabrirlo", () => {
    expect(puedeAgrupador("comprador", "asignar_compras_viaje")).toBe(true);
    expect(puedeAgrupador("comprador", "guardar_embarque")).toBe(true);
    expect(puedeAgrupador("comprador", "reabrir_viaje")).toBe(false);
    expect(puedeCambiarEstado("comprador", "reabrir")).toBe(false);
  });

  it("caso 7: C1 recibe 403 al cancelar y el admin puede", () => {
    expect(puedeCambiarEstado("comprador", "cancelar")).toBe(false);
    expect(puedeCambiarEstado("admin", "cancelar")).toBe(true);
  });

  it("lo que muestra la pantalla a cada rol", () => {
    expect(permisosAgrupadores("comprador")).toEqual({ crear_y_editar: true, importar: true, cambiar_fechas: true, asignar: true, recibir: true, cerrar_reabrir: false, cancelar: false, revertir_recepcion: false });
    expect(permisosAgrupadores("planner")).toEqual({ crear_y_editar: true, importar: true, cambiar_fechas: true, asignar: true, recibir: true, cerrar_reabrir: true, cancelar: true, revertir_recepcion: true });
    expect(permisosAgrupadores("admin")).toEqual(permisosAgrupadores("planner"));
  });
});

// ─── R22 · viaje activo ───

describe("R22: viaje activo (§3.8)", () => {
  const abiertoC1 = viaje261001();
  const viajes = [
    abiertoC1,
    { ...viaje261001(), id: "b0a30000-0000-4000-8000-000000000002", codigo: "261002", estado: "abierto" as const, fecha_inicio: "2026-11-02", responsable_id: PERFIL_AGR.c2 },
    { ...viaje261001(), id: "b0a30000-0000-4000-8000-000000000003", codigo: "260901", estado: "cerrado" as const, fecha_inicio: "2026-09-01", responsable_id: PERFIL_AGR.c1 },
    { ...viaje261001(), id: "b0a30000-0000-4000-8000-000000000004", codigo: "260801", estado: "cancelado" as const, fecha_inicio: "2026-08-01", responsable_id: PERFIL_AGR.c1 },
  ];

  it("la cookie es v2_viaje_activo, un año, path=/, lax y sin httpOnly (no es secreta)", () => {
    expect(COOKIE_VIAJE_ACTIVO).toBe("v2_viaje_activo");
    expect(OPCIONES_COOKIE_VIAJE_ACTIVO).toEqual({ path: "/", sameSite: "lax", maxAge: 31_536_000, httpOnly: false });
  });

  it("valores válidos: un uuid, `todos` o `sin_viaje`; todo lo demás se ignora", () => {
    expect(esValorViajeActivo(VIAJE_AGR.v261001)).toBe(true);
    expect(esValorViajeActivo("todos")).toBe(true);
    expect(esValorViajeActivo("sin_viaje")).toBe(true);
    for (const basura of ["", "basura", "<script>", "../../etc", "TODOS ", "1234", undefined, null, 5, "' or 1=1"]) expect(esValorViajeActivo(basura), String(basura)).toBe(false);
  });

  it("validarViajeActivo: un viaje existente no cancelado vale (también el cerrado, se eligió a propósito); uno cancelado o inexistente, no", () => {
    expect(validarViajeActivo(abiertoC1.id, viajes)).toBe(abiertoC1.id);
    expect(validarViajeActivo("b0a30000-0000-4000-8000-000000000003", viajes)).toBe("b0a30000-0000-4000-8000-000000000003");
    expect(validarViajeActivo("b0a30000-0000-4000-8000-000000000004", viajes)).toBeNull();
    expect(validarViajeActivo("b0a30000-0000-4000-8000-0000000000ff", viajes)).toBeNull();
    expect(validarViajeActivo("todos", viajes)).toBe("todos");
    expect(validarViajeActivo("sin_viaje", viajes)).toBe("sin_viaje");
    expect(validarViajeActivo("basura", viajes)).toBeNull();
    expect(validarViajeActivo(undefined, viajes)).toBeNull();
  });

  it("por defecto: el último viaje abierto (por fecha de inicio) del que el usuario es responsable; si no tiene, todos", () => {
    expect(viajeActivoPorDefecto(viajes, PERFIL_AGR.c1)).toBe(abiertoC1.id);
    expect(viajeActivoPorDefecto(viajes, PERFIL_AGR.c2)).toBe("b0a30000-0000-4000-8000-000000000002");
    expect(viajeActivoPorDefecto(viajes, PERFIL_AGR.a)).toBe(VIAJE_ACTIVO_TODOS);
    expect(viajeActivoPorDefecto(viajes, null)).toBe(VIAJE_ACTIVO_TODOS);
    // entre dos abiertos del mismo responsable, el de fecha de inicio más reciente
    const dos = [abiertoC1, { ...abiertoC1, id: "b0a30000-0000-4000-8000-000000000009", fecha_inicio: "2026-12-01" }];
    expect(viajeActivoPorDefecto(dos, PERFIL_AGR.c1)).toBe("b0a30000-0000-4000-8000-000000000009");
  });

  it("caso 19a: al cerrar 261001 deja de ser el viaje activo por defecto", () => {
    const cerrado = [viaje261001({ estado: "cerrado" })];
    expect(viajeActivoPorDefecto(cerrado, PERFIL_AGR.c1)).toBe(VIAJE_ACTIVO_TODOS);
  });

  it("caso 19: una cookie con texto basura se ignora y se usa el valor por defecto; una de un viaje cancelado, también", () => {
    expect(resolverViajeActivo("texto basura", viajes, PERFIL_AGR.c1)).toBe(abiertoC1.id);
    expect(resolverViajeActivo(undefined, viajes, PERFIL_AGR.c1)).toBe(abiertoC1.id);
    expect(resolverViajeActivo("b0a30000-0000-4000-8000-000000000004", viajes, PERFIL_AGR.a)).toBe(VIAJE_ACTIVO_TODOS);
    expect(resolverViajeActivo("sin_viaje", viajes, PERFIL_AGR.c1)).toBe(VIAJE_ACTIVO_SIN_VIAJE);
    expect(resolverViajeActivo("b0a30000-0000-4000-8000-000000000002", viajes, PERFIL_AGR.c1)).toBe("b0a30000-0000-4000-8000-000000000002");
  });

  it("filtro: todos no manda nada; sin_viaje o un uuid van como viaje_id explícito (la API nunca lee la cookie)", () => {
    expect(filtroDeViajeActivo("todos")).toEqual({});
    expect(filtroDeViajeActivo("sin_viaje")).toEqual({ viaje_id: "sin_viaje" });
    expect(filtroDeViajeActivo(VIAJE_AGR.v261001)).toEqual({ viaje_id: VIAJE_AGR.v261001 });
  });

  it("selectores: abiertos primero, cerrados al final y marcados «(cerrado)»; los cancelados no se ofrecen", () => {
    const lista = ordenarViajesParaSelector(viajes);
    expect(lista.map((v) => v.codigo)).toEqual(["261002", "261001", "260901"]);
    expect(etiquetaViajeSelector(lista[2])).toBe("260901 · Feria Sur · oct-2026 (cerrado)");
    expect(etiquetaViajeSelector(lista[0])).toBe("261002 · Feria Sur · oct-2026");
    expect(viajes).toHaveLength(4); // no modifica la lista recibida
  });
});
