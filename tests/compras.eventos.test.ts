import { describe, expect, it } from "vitest";
import { aplicarCancelacion } from "@/lib/compras/cancelar";
import { canceladaPor, creadaPor, evento, historial, modificadaPor, recortar, resumenCambios, sonIguales, type EventoNuevo } from "@/lib/compras/eventos";
import { aplicarQuitarRecepcion, aplicarRecepciones } from "@/lib/compras/recepciones";
import { fotoCompra } from "@/lib/compras/reglas";
import type { EventoCompraApi } from "@/lib/compras/tipos-api";
import { COMPRA, LINEA, registrosC12 } from "./compras.fixture";
import { ACTOR, modeloDeRegistros } from "./compras.estado.fixture";

/** Regla 17b de la ficha 08 (auditoría) en `0.13.0`: importar, confirmar un ingreso, quitarlo, volver a confirmarlo y cancelar. */

const t = (min: number) => `2026-10-2${min}T09:00:00.000Z`;
const nueva = { linea_id: LINEA.c12, recibida_periodo: "2026-10", unidades: 200, fecha_recepcion: "2026-10-20", nota: null, origen: "manual" as const };

describe("regla 17b: cinco eventos en orden, con antes/despues coherentes", () => {
  const m0 = modeloDeRegistros(registrosC12({ estado: "confirmada" }));
  const base = { compra_id: COMPRA.c12, actor: ACTOR };

  const importar = evento({ ...base, accion: "importar", linea_id: null, antes: null, despues: { ...fotoCompra({ ...m0, revision: 0 }) }, resumen: "Importada: 1 linea(s) nueva(s), 500 u", ahora: t(0) });
  const r1 = aplicarRecepciones({ ...m0, revision: 0 }, 0, [nueva], { ...base, ahora: t(1), ids: ["r1"] });
  const r2 = r1.ok ? aplicarQuitarRecepcion(r1.modelo, 1, "r1", { ...base, ahora: t(2) }) : r1;
  const r3 = r2.ok ? aplicarRecepciones(r2.modelo, 2, [nueva], { ...base, ahora: t(3), ids: ["r2"] }) : r2;
  const r4 = r3.ok ? aplicarCancelacion(r3.modelo, 3, "El proveedor no entrega el saldo", { ...base, ahora: t(4) }) : r3;

  it("todas las operaciones se aplican", () => {
    expect([r1.ok, r2.ok, r3.ok, r4.ok]).toEqual([true, true, true, true]);
  });

  const eventos = (): EventoNuevo[] => {
    if (!r1.ok || !r2.ok || !r3.ok || !r4.ok) throw new Error("secuencia rota");
    return [importar, r1.evento, r2.evento, r3.evento, r4.evento];
  };

  it("deja cinco eventos en el orden de las acciones", () => {
    expect(eventos().map((e) => e.accion)).toEqual(["importar", "recibir", "quitar_recepcion", "recibir", "cancelar"]);
    expect(eventos().map((e) => e.created_at)).toEqual([t(0), t(1), t(2), t(3), t(4)]);
  });

  it("el despues de cada evento es el antes del siguiente sobre la misma compra", () => {
    const e = eventos();
    for (let i = 0; i < e.length - 1; i++) expect(e[i].despues).toEqual(e[i + 1].antes);
  });

  it("la revisión sube en uno por evento", () => {
    const revisiones = eventos().map((e) => (e.despues as { revision: number }).revision);
    expect(revisiones).toEqual([0, 1, 2, 3, 4]);
  });

  it("el motivo solo aparece en la cancelación y todos llevan el nombre de quien actuó", () => {
    const e = eventos();
    expect(e.map((x) => x.motivo)).toEqual([null, null, null, null, "El proveedor no entrega el saldo"]);
    expect(e.every((x) => x.usuario_nombre === "Planner Uno" && x.perfil_id === ACTOR.perfil_id)).toBe(true);
  });

  it("la cancelación con recepciones deja la compra recibida con saldo cerrado en el despues", () => {
    const ultimo = eventos()[4];
    expect(ultimo.despues).toMatchObject({ estado: "recibida", saldo_cerrado: true, lineas: [{ unidades: 500, unidades_recibidas: 200, unidades_canceladas: 300 }] });
  });
});

describe("evento", () => {
  const base = { compra_id: COMPRA.c12, actor: ACTOR, ahora: t(0) };

  it("normaliza los nulos y recorta el motivo", () => {
    expect(evento({ ...base, accion: "crear", motivo: "  " })).toMatchObject({ linea_id: null, antes: null, despues: null, motivo: null, resumen: null });
    expect(evento({ ...base, accion: "cancelar", motivo: "  por error  " }).motivo).toBe("por error");
  });

  it("lanza ante una acción desconocida o un motivo de más de 300 caracteres", () => {
    expect(() => evento({ ...base, accion: "borrar" as never })).toThrow(RangeError);
    expect(() => evento({ ...base, accion: "cancelar", motivo: "x".repeat(301) })).toThrow(RangeError);
    expect(() => evento({ ...base, accion: "cancelar", motivo: "x".repeat(300) })).not.toThrow();
  });

  it("recorta el resumen a 300 caracteres con puntos suspensivos", () => {
    const e = evento({ ...base, accion: "editar_linea", resumen: "a".repeat(400) });
    expect(e.resumen).toHaveLength(300);
    expect(e.resumen?.endsWith("…")).toBe(true);
    expect(recortar("corto", 10)).toBe("corto");
  });
});

describe("historial y autores", () => {
  const ev = (id: string, accion: EventoCompraApi["accion"], at: string, nombre: string, motivo: string | null = null): EventoCompraApi => ({
    id,
    linea_id: null,
    accion,
    antes: null,
    despues: null,
    motivo,
    resumen: null,
    usuario_nombre: nombre,
    created_at: at,
  });

  const desordenado = [ev("3", "recibir", t(3), "Ana"), ev("1", "importar", t(1), "Planner Uno"), ev("2", "recibir", t(2), "Beto"), ev("4", "cancelar", t(4), "Ana", "No llegó")];

  it("ordena de más antiguo a más reciente sin mutar la entrada", () => {
    const h = historial(desordenado);
    expect(h.map((e) => e.id)).toEqual(["1", "2", "3", "4"]);
    expect(desordenado.map((e) => e.id)).toEqual(["3", "1", "2", "4"]);
  });

  it("a igual instante respeta el orden de llegada", () => {
    expect(historial([ev("b", "recibir", t(1), "x"), ev("a", "recibir", t(1), "y")]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("creada por el primer evento, modificada por el último y cancelada por el último cancelar", () => {
    expect(creadaPor(desordenado)).toEqual({ nombre: "Planner Uno", at: t(1) });
    expect(modificadaPor(desordenado)).toEqual({ nombre: "Ana", at: t(4) });
    expect(canceladaPor(desordenado)).toEqual({ nombre: "Ana", at: t(4), motivo: "No llegó" });
  });

  it("una compra solo creada no está modificada ni cancelada; sin historial no hay autores", () => {
    const solo = [ev("1", "importar", t(1), "Planner Uno")];
    expect(modificadaPor(solo)).toBeNull();
    expect(canceladaPor(solo)).toBeNull();
    expect(creadaPor([])).toBeNull();
    expect(modificadaPor([])).toBeNull();
  });
});

describe("resumenCambios", () => {
  it("lista lo que cambió en una línea", () => {
    expect(resumenCambios({ unidades: 500, destino: "cd", nota: null }, { unidades: 600, destino: "tienda", nota: null })).toBe("unidades 500 → 600; destino cd → tienda");
  });

  it("usa las etiquetas, muestra — para lo vacío y compara estructuras sin importar el orden de claves", () => {
    expect(resumenCambios({ nota: null }, { nota: "feria" }, { nota: "nota" })).toBe("nota — → feria");
    expect(resumenCambios({ alcance: { a: 1, b: 2 } }, { alcance: { b: 2, a: 1 } })).toBe("Sin cambios");
    expect(sonIguales([1, { x: 1, y: 2 }], [1, { y: 2, x: 1 }])).toBe(true);
    expect(sonIguales([1, 2], [2, 1])).toBe(false);
  });

  it("incluye las claves que solo estaban antes o solo están después y recorta a 300", () => {
    expect(resumenCambios({ a: 1 }, { b: 2 })).toBe("b — → 2; a 1 → —");
    expect(resumenCambios(null, null)).toBe("Sin cambios");
    const largo = resumenCambios({}, Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`campo${i}`, "valor largo"])));
    expect(largo.length).toBeLessThanOrEqual(300);
  });
});
