import { describe, expect, it } from "vitest";
import { camposFaltantes } from "@/lib/proveedores/completitud";
import { buscarParecidos, nombreLimpio } from "@/lib/proveedores/parecidos";
import {
  cambiaIntercompanySinPermiso,
  mensajeCodigoRepetido,
  mensajeNombreRepetido,
  normalizarContactos,
  permisosProveedor,
  puedeCambiarIntercompany,
  puedeDesactivarProveedor,
} from "@/lib/proveedores/reglas";
import { cambiosDeProveedor, historialDeProveedor } from "@/lib/proveedores/historial";
import { similitud } from "@/lib/ventas/sugerir-mapeo";
import { PROVEEDORES_PRUEBA } from "./proveedores.fixture";

const SUR = PROVEEDORES_PRUEBA[1];
const DELTA = PROVEEDORES_PRUEBA[2];

describe("R12 · nombre limpio y parecidos", () => {
  it("quita las palabras de razón social desde el final", () => {
    expect(nombreLimpio("Textiles Delta Ltd.")).toBe("TEXTILES_DELTA");
    expect(nombreLimpio("Hilados Andinos S.A.C.")).toBe("HILADOS_ANDINOS");
    expect(nombreLimpio("Hilados Andinos SAC")).toBe("HILADOS_ANDINOS");
    expect(nombreLimpio("Norte Trading Co. Ltd")).toBe("NORTE");
    expect(nombreLimpio("Proveedor Norte")).toBe("PROVEEDOR_NORTE");
    expect(nombreLimpio("Ltd")).toBe("LTD");
    expect(nombreLimpio("   ")).toBe("");
  });

  it("«Textil Delta» frente a «Textiles Delta Ltd.» da 0,83 limpio (crudo daría 0,71) y avisa", () => {
    expect(similitud("Textil Delta", "Textiles Delta Ltd.")).toBe(0.71);
    expect(similitud("TEXTIL_DELTA", "TEXTILES_DELTA")).toBe(0.83);
    expect(buscarParecidos("Textil Delta", [DELTA])).toEqual([{ id: DELTA.id, nombre: DELTA.nombre, similitud: 0.83, motivo: "similar" }]);
  });

  it("«Feria Sur SAC» frente a «Feria Sur» y «Proveedor Norte» frente a «Proveedor Norte Ltd.» → misma_razon_social", () => {
    expect(buscarParecidos("Feria Sur SAC", [SUR])[0]).toMatchObject({ id: SUR.id, motivo: "misma_razon_social", similitud: 1 });
    const conLtd = { id: "x", nombre: "Proveedor Norte Ltd.", activo: true };
    expect(buscarParecidos("Proveedor Norte", [conLtd])[0]).toMatchObject({ motivo: "misma_razon_social" });
  });

  it("«Proveedor Norte» frente a «Proveedor Sur» (0,69) y «Feria Sur» frente a «Feria Norte» (0,56) no avisan", () => {
    const prov = { id: "p", nombre: "Proveedor Sur", activo: true };
    expect(similitud("PROVEEDOR_NORTE", "PROVEEDOR_SUR")).toBe(0.69);
    expect(buscarParecidos("Proveedor Norte", [prov])).toEqual([]);
    expect(similitud("FERIA_SUR", "FERIA_NORTE")).toBe(0.56);
    expect(buscarParecidos("Feria Sur", [{ id: "n", nombre: "Feria Norte", activo: true }])).toEqual([]);
  });

  it("solo compara contra activos, excluye al propio proveedor y devuelve hasta 3 de mayor a menor", () => {
    expect(buscarParecidos("Feria Sur SAC", [{ ...SUR, activo: false }])).toEqual([]);
    expect(buscarParecidos("Feria Sur SAC", [SUR], SUR.id)).toEqual([]);
    const muchos = ["Feria Sur", "Feria Sur Ltd", "Feria Sur Co", "Feria Sur Corp", "Feria Sure"].map((nombre, i) => ({ id: `m${i}`, nombre, activo: true }));
    const r = buscarParecidos("Feria Sur", muchos);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.similitud)).toEqual([...r.map((x) => x.similitud)].sort((a, b) => b - a));
  });
});

describe("R13 · contactos", () => {
  const c = (nombre: string, es_principal = false) => ({ nombre, cargo: null, telefono: null, correo: null, es_principal });

  it("si el usuario no marca principal, el primero lo es; si marca uno, se respeta", () => {
    expect(normalizarContactos([c("A"), c("B")]).map((x) => x.es_principal)).toEqual([true, false]);
    expect(normalizarContactos([c("A"), c("B", true)]).map((x) => x.es_principal)).toEqual([false, true]);
    expect(normalizarContactos([])).toEqual([]);
  });
});

describe("R16 · permisos", () => {
  it("cambiar intercompany, desactivar y eliminar son de planner y admin", () => {
    expect([puedeCambiarIntercompany("admin"), puedeCambiarIntercompany("planner"), puedeCambiarIntercompany("comprador")]).toEqual([true, true, false]);
    expect([puedeDesactivarProveedor("admin"), puedeDesactivarProveedor("planner"), puedeDesactivarProveedor("comprador")]).toEqual([true, true, false]);
    expect(permisosProveedor("comprador")).toEqual({ editar: true, cambiar_intercompany: false, desactivar: false, eliminar: false });
    expect(permisosProveedor("planner")).toEqual({ editar: true, cambiar_intercompany: true, desactivar: true, eliminar: true });
  });

  it("un comprador que cambia es_intercompany (al crear o editar) es rechazado; mantener o no mandar el valor está bien", () => {
    expect(cambiaIntercompanySinPermiso("comprador", true, false)).toBe(true);
    expect(cambiaIntercompanySinPermiso("comprador", false, true)).toBe(true);
    expect(cambiaIntercompanySinPermiso("comprador", true, true)).toBe(false);
    expect(cambiaIntercompanySinPermiso("comprador", undefined, true)).toBe(false);
    expect(cambiaIntercompanySinPermiso("planner", true, false)).toBe(false);
  });
});

describe("R11 · mensajes de repetido", () => {
  it("si el existente está inactivo, el mensaje pide reactivarlo", () => {
    expect(mensajeNombreRepetido({ nombre: "Feria Sur", activo: true })).toBe("Ya existe un proveedor con el nombre «Feria Sur».");
    expect(mensajeNombreRepetido({ nombre: "Feria Sur", activo: false })).toBe("Existe «Feria Sur», pero está inactivo: pide a un admin o planner que lo reactive.");
    expect(mensajeNombreRepetido(null)).toMatch(/Ya existe/);
    expect(mensajeCodigoRepetido({ nombre: "Feria Sur", activo: false })).toMatch(/inactivo/);
  });
});

describe("completitud de la ficha", () => {
  it("nombra lo que falta: país, RUC, dirección y contacto", () => {
    expect(camposFaltantes({ pais: null, identificacion: null, direccion: null, contactos: [] })).toEqual(["pais", "identificacion", "direccion", "contacto"]);
    expect(camposFaltantes({ pais: "China", identificacion: " ", direccion: "Calle 1", contactos: [{}] })).toEqual(["identificacion"]);
    expect(camposFaltantes({ pais: "China", identificacion: "X", direccion: "Calle 1", contactos: [{}] })).toEqual([]);
  });
});

describe("RP4 · historial campo a campo", () => {
  const antes = { nombre: "Feria Sur", pais: "China", es_intercompany: false, activo: true, contactos: [{ nombre: "Ana", telefono: "111", es_principal: true }] };

  it("renombrar deja el nombre anterior y el nuevo", () => {
    expect(cambiosDeProveedor(antes, { ...antes, nombre: "Feria Sur Ltd" })).toEqual([{ campo: "Nombre", antes: "Feria Sur", despues: "Feria Sur Ltd" }]);
  });

  it("cambiar el teléfono de un contacto deja el contacto anterior y el nuevo; booleanos como Sí/No", () => {
    const despues = { ...antes, es_intercompany: true, contactos: [{ nombre: "Ana", telefono: "222", es_principal: true }] };
    expect(cambiosDeProveedor(antes, despues)).toEqual([
      { campo: "Intercompany", antes: "No", despues: "Sí" },
      { campo: "Contactos", antes: "Ana · 111 (principal)", despues: "Ana · 222 (principal)" },
    ]);
  });

  it("ordena del más reciente al más antiguo y solo detalla los de editar", () => {
    const h = historialDeProveedor([
      { id: "a", accion: "crear", antes: null, despues: antes, resumen: "Proveedor creado: Feria Sur", usuario_nombre: "Ana", created_at: "2026-11-01T10:00:00Z" },
      { id: "b", accion: "editar", antes, despues: { ...antes, nombre: "Otro" }, resumen: "Cambios", usuario_nombre: "Luis", created_at: "2026-11-02T10:00:00Z" },
      { id: "c", accion: "importar", antes: null, despues: antes, resumen: "Carga desde COTV", usuario_nombre: null, created_at: "2026-10-30T10:00:00Z" },
    ]);
    expect(h.map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(h[0].cambios).toHaveLength(1);
    expect(h[1].cambios).toEqual([]);
    expect(h[0].por).toEqual({ nombre: "Luis", at: "2026-11-02T10:00:00Z" });
  });
});

describe("la regla accionEliminarProveedor de M8 sigue vigente", () => {
  it("(la base la aplica en eliminar_proveedor; aquí solo se comprueba que no se rompió)", async () => {
    const { accionEliminarProveedor } = await import("@/lib/compras/proveedores");
    expect(accionEliminarProveedor(0)).toBe("borrar");
    expect(accionEliminarProveedor(1)).toBe("desactivar");
  });
});
