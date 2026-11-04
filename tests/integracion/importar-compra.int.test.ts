import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAY_BASE,
  abrirConTransaccion,
  actor,
  cargaImportar,
  cerrarConRollback,
  contar,
  escalar,
  filas,
  foto,
  revisionCompra,
  rpc,
  sembrarBase,
  sembrarCompra,
  type Base,
} from "./ayudas";

/**
 * `importar_compra` (0025, corregida en 0034) contra Postgres real: la restriccion del comprador (`restringido`, 0034), el orden de los
 * motivos, que un rechazo no escriba nada y el todo-o-nada ante un error de la base (FK). Los humos SQL ya cubren la logica; aqui se
 * prueba la llamada tal como la hace la API (rol `service_role`, jsonb por parametro) y con los errores de Postgres de verdad.
 */
describe.skipIf(!HAY_BASE)("importar_compra (Postgres real)", () => {
  let c: Client;
  let b: Base;
  const TIPOS = ["jsonb", "jsonb"];

  beforeEach(async () => {
    c = await abrirConTransaccion();
    b = await sembrarBase(c, 11);
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  it("comprador restringido + compra confirmada ajena: compra_no_borrador y no escribe nada", async () => {
    await sembrarCompra(c, b, { n: 1, referencia: "R-CONF", estado: "confirmada", perfil: b.admin });
    const antes = await foto(c);
    const r = await rpc(c, "importar_compra", [cargaImportar(b, "R-CONF", "IT-001"), actor(b.comprador1, "C1", true)], TIPOS);
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ ok: false, motivo: "compra_no_borrador" });
    expect(await foto(c)).toBe(antes);
  });

  it("defensa en profundidad: un comprador sin la clave restringido, o con restringido=false, sigue restringido (lo decide el rol del perfil)", async () => {
    await sembrarCompra(c, b, { n: 1, referencia: "R-C2", estado: "borrador", perfil: b.comprador2 });
    const antes = await foto(c);
    const sinClave = await rpc(c, "importar_compra", [cargaImportar(b, "R-C2", "IT-002"), actor(b.comprador1, "C1")], TIPOS);
    const conFalso = await rpc(c, "importar_compra", [cargaImportar(b, "R-C2", "IT-003"), actor(b.comprador1, "C1", false)], TIPOS);
    expect(sinClave.data?.motivo).toBe("compra_no_borrador");
    expect(conFalso.data?.motivo).toBe("compra_no_borrador");
    expect(await foto(c)).toBe(antes);
  });

  it("un actor restringido sin perfil_id no es dueño de nada, ni siquiera de un borrador sin dueño", async () => {
    await sembrarCompra(c, b, { n: 1, referencia: "R-HUER", estado: "borrador", perfil: null });
    const antes = await foto(c);
    const r = await rpc(c, "importar_compra", [cargaImportar(b, "R-HUER", "IT-004"), { nombre: "anonimo", restringido: true }], TIPOS);
    expect(r.data?.motivo).toBe("compra_no_borrador");
    expect(await foto(c)).toBe(antes);
  });

  it("comprador + su propio borrador: agrega la linea, la revision sube 1, sigue en borrador y deja un evento importar", async () => {
    const { compra } = await sembrarCompra(c, b, { n: 1, referencia: "R-C1", estado: "borrador", perfil: b.comprador1 });
    const rev0 = await revisionCompra(c, compra);
    const r = await rpc(c, "importar_compra", [cargaImportar(b, "R-C1", "IT-010"), actor(b.comprador1, "C1", true)], TIPOS);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ ok: true, creada: false, compra_id: compra, estado: "borrador" });
    expect(await revisionCompra(c, compra)).toBe(rev0 + 1);
    expect(await contar(c, "compra_lineas", "compra_id = $1", [compra])).toBe(2);
    expect(await contar(c, "compra_eventos", "compra_id = $1 and accion = 'importar'", [compra])).toBe(1);
  });

  it("admin y planner agregan a cualquier compra viva (confirmada o de otro): sin restriccion", async () => {
    const conf = await sembrarCompra(c, b, { n: 1, referencia: "R-CONF", estado: "confirmada", perfil: b.admin });
    const ajeno = await sembrarCompra(c, b, { n: 2, referencia: "R-C2", estado: "borrador", perfil: b.comprador2 });
    const a = await rpc(c, "importar_compra", [cargaImportar(b, "R-CONF", "IT-020"), actor(b.admin, "Admin")], TIPOS);
    const p = await rpc(c, "importar_compra", [cargaImportar(b, "R-C2", "IT-021"), actor(b.planner, "Planner", false)], TIPOS);
    expect(a.data).toMatchObject({ ok: true, creada: false, compra_id: conf.compra });
    expect(p.data).toMatchObject({ ok: true, creada: false, compra_id: ajeno.compra });
  });

  it("saldo cerrado va antes que compra_no_borrador, y una compra cancelada se ignora (se crea una nueva)", async () => {
    await sembrarCompra(c, b, { n: 1, referencia: "R-SALDO", estado: "recibida", perfil: b.admin, canceladaAt: true });
    const cancelada = await sembrarCompra(c, b, { n: 2, referencia: "R-CANC", estado: "cancelada", perfil: b.comprador1 });
    const saldo = await rpc(c, "importar_compra", [cargaImportar(b, "R-SALDO", "IT-030"), actor(b.comprador1, "C1", true)], TIPOS);
    expect(saldo.data?.motivo).toBe("saldo_cerrado");
    const nueva = await rpc(c, "importar_compra", [cargaImportar(b, "R-CANC", "IT-031"), actor(b.comprador1, "C1", true)], TIPOS);
    expect(nueva.data).toMatchObject({ ok: true, creada: true });
    expect(nueva.data?.compra_id).not.toBe(cancelada.compra);
    expect(await revisionCompra(c, cancelada.compra)).toBe(0);
  });

  it("clave_existente: el mismo archivo dos veces no duplica lineas; la segunda no escribe nada", async () => {
    const carga = cargaImportar(b, "R-DUP", "IT-040");
    const primera = await rpc(c, "importar_compra", [carga, actor(b.admin, "Admin")], TIPOS);
    expect(primera.data).toMatchObject({ ok: true, creada: true });
    const antes = await foto(c);
    const segunda = await rpc(c, "importar_compra", [carga, actor(b.admin, "Admin")], TIPOS);
    expect(segunda.data).toEqual({ ok: false, motivo: "clave_existente" });
    expect(await foto(c)).toBe(antes);
  });

  it("todo o nada ante un error de la base: una FK inexistente en la 2.a linea deshace la compra, el proveedor y la 1.a linea", async () => {
    const carga = cargaImportar(b, "R-ATOM", "IT-050") as { lineas: Record<string, unknown>[] } & Record<string, unknown>;
    carga.proveedor_nombre = "PROVEEDOR NUEVO ATOMICO";
    carga.lineas.push({
      clave_importacion: "IT-051",
      tipo: "especifica",
      genero_mundo_linea_id: "00000000-0000-4000-8000-00000000ffff",
      unidades: 5,
      entregas: [{ periodo: "2026-12-01", unidades: 5 }],
    });
    const antes = await foto(c);
    const r = await rpc(c, "importar_compra", [carga, actor(b.admin, "Admin")], TIPOS);
    expect(r.data).toBeNull();
    expect(r.error?.codigo).toBe("23503");
    expect(await foto(c)).toBe(antes);
    expect(await contar(c, "proveedores", "nombre = 'PROVEEDOR NUEVO ATOMICO'")).toBe(0);
  });

  it("validaciones previas devuelven motivo sin tocar nada: sin_lineas, entregas_no_cuadran, proveedor_requerido, proveedor_inexistente", async () => {
    const antes = await foto(c);
    const sinLineas = await rpc(c, "importar_compra", [{ proveedor_nombre: b.proveedorNombre, lineas: [] }, actor(b.admin, "A")], TIPOS);
    const cuadran = cargaImportar(b, "R-X", "IT-060") as { lineas: { unidades: number }[] } & Record<string, unknown>;
    cuadran.lineas[0].unidades = 11;
    const noCuadran = await rpc(c, "importar_compra", [cuadran, actor(b.admin, "A")], TIPOS);
    const sinProv = await rpc(c, "importar_compra", [cargaImportar(b, "R-X", "IT-061", 10, { proveedor_nombre: null }), actor(b.admin, "A")], TIPOS);
    const provFalso = await rpc(
      c,
      "importar_compra",
      [cargaImportar(b, "R-X", "IT-062", 10, { proveedor_id: "00000000-0000-4000-8000-00000000fffe" }), actor(b.admin, "A")],
      TIPOS
    );
    expect(sinLineas.data?.motivo).toBe("sin_lineas");
    expect(noCuadran.data?.motivo).toBe("entregas_no_cuadran");
    expect(sinProv.data?.motivo).toBe("proveedor_requerido");
    expect(provFalso.data?.motivo).toBe("proveedor_inexistente");
    expect(await foto(c)).toBe(antes);
  });

  it("la compra nueva de un comprador queda a su nombre, en borrador, sin confirmar", async () => {
    const r = await rpc(c, "importar_compra", [cargaImportar(b, "R-NUEVA", "IT-070"), actor(b.comprador1, "C1", true)], TIPOS);
    expect(r.data).toMatchObject({ ok: true, creada: true });
    const f = await filas<{ estado: string; perfil_id: string; confirmada_at: string | null }>(
      c,
      "select estado, perfil_id, confirmada_at from public.compras where id = $1",
      [r.data?.compra_id]
    );
    expect(f[0]).toMatchObject({ estado: "borrador", perfil_id: b.comprador1, confirmada_at: null });
    expect(await escalar<string>(c, "select numero from public.compras where id = $1", [r.data?.compra_id])).toMatch(/^C-\d{6}$/);
  });
});
