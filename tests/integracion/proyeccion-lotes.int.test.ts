import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAY_BASE, abrirConTransaccion, cerrarConRollback, contar, escalar, filas, rpc, type Json, type Respuesta } from "./ayudas";
import { clave, iso, sembrarProyeccion, type Escenario } from "./fixture-proyeccion";

/**
 * `aplicar_lote_proyeccion` (0031, aprobacion en bloque de 07g) contra Postgres real: aprobar por metodo, las DOS pasadas (el orden de
 * los grupos no cambia el resultado), la idempotencia por `lote.id` y los errores LP001 a LP007. LP008 (`registro_no_escrito`) no se
 * puede provocar desde fuera: exige que un `update` de una fila ya bloqueada no la toque.
 *
 * Los humos SQL (scripts/humo-0031.sql) cubren ~170 casos; aqui van los que dependen de llamar la funcion como la API (jsonb por
 * parametro, `service_role`, error de Postgres con su SQLSTATE) y de leer la base despues.
 */

describe.skipIf(!HAY_BASE)("aplicar_lote_proyeccion (Postgres real)", () => {
  let c: Client;
  let e: Escenario;
  const NS = 31;
  const k = (n: number) => clave(NS, n);

  const reg = (clv: string, anio: number, objetivo: boolean, set: Record<string, Json> = {}, desfasado = false): Json => {
    const r = e.registros.get(`${clv}|${anio}`);
    if (!r) throw new Error(`sin registro ${clv}|${anio}`);
    return { id: r.id, updated_at_esperado: desfasado ? r.isoMas1 : r.iso, objetivo, set };
  };
  const setMet = (valor: number, lote: string): Record<string, Json> => ({
    decidido: valor, origen: "propuesta", propuesta_al_decidir: valor, nota: null, decidido_at: new Date().toISOString(),
    decidido_por_id: e.b.admin, decidido_por_nombre: "IT", decision_ia_fila_id: null, decision_lote_id: lote,
  });
  const setIa = (valor: number, lote: string, ipf: string): Record<string, Json> => ({
    decidido: valor, origen: "manual", propuesta_al_decidir: valor + 10, nota: null, decidido_at: new Date().toISOString(),
    decidido_por_id: e.b.admin, decidido_por_nombre: "IT", decision_ia_fila_id: ipf, decision_lote_id: lote,
  });
  const setRev: Record<string, Json> = {
    decidido: null, origen: null, propuesta_al_decidir: null, nota: null, decidido_at: null,
    decidido_por_id: null, decidido_por_nombre: null, decision_ia_fila_id: null, decision_lote_id: null,
  };
  const fila = (clv: string, anio: number, fuente: string, valor: number | null, registros: Json[], extra: Record<string, Json> = {}): Json => ({
    fila_id: undefined as unknown as Json, fila_clave: clv, anio, fuente, valor, registros, ...extra,
  });
  const filaMet = (clv: string, valor: number, lote: string, extra: Record<string, Json> = {}): Json =>
    fila(clv, 2026, "metodo", valor, [reg(clv, 2026, true, setMet(valor, lote))], { valor_esperado: valor, ...extra });
  const filaIa = (clv: string, valor: number, lote: string): Json =>
    fila(clv, 2027, "ia", valor, [reg(clv, 2027, true, setIa(valor, lote, e.propFilas.get(clv) as string))], {
      propuesta_fila_id: e.propFilas.get(clv) as string, valor_esperado: valor,
    });
  const lectura = (claves: string[]): Json[] =>
    claves.flatMap((clv) => [2026, 2027].map((a) => ({ id: e.registros.get(`${clv}|${a}`)?.id as string, updated_at_esperado: e.registros.get(`${clv}|${a}`)?.iso as string })));
  const grupo = (tipo: string, gm: string, fs: Json[], lect: Json[] = [], prop?: string): Json => ({
    tipo, gm_clave: gm, registros_lectura: lect, filas: fs, ...(prop ? { propuesta_gm_id: prop } : {}),
  });
  const lote = (id: string, tipo = "aprobar", extra: Record<string, Json> = {}): Record<string, Json> => ({
    id, confirmacion_id: randomUUID(), proyeccion_id: e.proy, tipo, anio: 2026, huella_cuerpo: `${id.replace(/-/g, "")}${"0".repeat(32)}`.slice(0, 64),
    calculado_at_esperado: e.calculadoIso, filtro: { genero: "IT" }, efecto_gm_previsto: [{ gm_clave: "GM-UNO" }], revision_confirmada: true,
    propuestas_gm: [], nota: "it", perfil_id: e.b.admin, usuario_nombre: "IT", ...extra,
  });
  /** `fila_id` real de cada fila del payload (se rellena aqui para no repetir consultas en cada prueba). */
  async function conFilaId(payload: { lote: Record<string, Json>; grupos: Json[] }): Promise<Json> {
    const ids = await filas<{ clave: string; id: string }>(c, "select clave, id from public.proyeccion_filas where proyeccion_id = $1", [e.proy]);
    const porClave = new Map(ids.map((x) => [x.clave, x.id]));
    for (const g of payload.grupos as { filas: { fila_clave: string; fila_id?: string }[] }[]) for (const f of g.filas) f.fila_id = porClave.get(f.fila_clave);
    return payload as unknown as Json;
  }
  const aplicar = (p: Json): Promise<{ data: Respuesta | null; error: { codigo: string; mensaje: string } | null }> => rpc(c, "aplicar_lote_proyeccion", [p], ["jsonb"]);
  const decididoDe = (clv: string, anio: number) =>
    escalar<number | null>(c, "select a.decidido from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id where f.clave = $1 and a.anio = $2", [clv, anio]);
  const codigoFila = (r: Respuesta | null, clv: string, anio: number) =>
    ((r?.filas as { fila_clave: string; anio: number; codigo?: string }[]).find((x) => x.fila_clave === clv && x.anio === anio)?.codigo ?? "aplicada") as string;

  beforeEach(async () => {
    c = await abrirConTransaccion();
    e = await sembrarProyeccion(c, NS);
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  it("aprobar por metodo: F1 aplicada; F2 con 1 microsegundo de desfase = cambio_concurrente (fila entera o nada); F3 rechazada por TypeScript", async () => {
    const id = randomUUID();
    const p = await conFilaId({
      lote: lote(id),
      grupos: [
        grupo("metodo", "GM-DOS", [
          filaMet(k(1), 1000, id),
          fila(k(2), 2026, "metodo", 1000, [reg(k(2), 2026, true, setMet(1000, id)), reg(k(2), 2027, false, { propuesto: 777 }, true)], { valor_esperado: 1000 }),
          fila(k(3), 2026, "metodo", null, [], { rechazo: "propuesta_cambio", valor_esperado: 1000, valor_actual: 1010 }),
        ]),
      ],
    });
    const r = await aplicar(p);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ repetido: false, lote_id: id });
    expect(codigoFila(r.data, k(1), 2026)).toBe("aplicada");
    expect(codigoFila(r.data, k(2), 2026)).toBe("cambio_concurrente");
    expect(codigoFila(r.data, k(3), 2026)).toBe("propuesta_cambio");
    expect(await decididoDe(k(1), 2026)).toBe(1000);
    expect(await decididoDe(k(2), 2026)).toBeNull();
    expect(await escalar<number>(c, "select a.propuesto from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id where f.clave = $1 and a.anio = 2027", [k(2)])).toBe(1100);
    expect(await contar(c, "proyeccion_lote_filas", "lote_id = $1", [id])).toBe(3);
    const resumen = await escalar<Record<string, unknown>>(c, "select resumen from public.proyeccion_lotes where id = $1", [id]);
    expect(resumen).toMatchObject({ pedidas: 3, aplicadas: 1, rechazadas: { cambio_concurrente: 1, propuesta_cambio: 1 } });
  });

  it("dos pasadas: el orden de los grupos NO cambia el resultado (un grupo metodo escrito antes no invalida las lecturas del grupo ia del mismo GM)", async () => {
    const resultados: string[] = [];
    for (const orden of ["metodo-primero", "ia-primero"]) {
      await c.query("savepoint orden_sp");
      const id = randomUUID();
      const gMetodo = grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)]);
      const gIa = grupo("ia", "GM-UNO", [filaIa(k(2), 1150, id), filaIa(k(3), 1050, id)], lectura([k(1), k(2), k(3), k(4)]), e.vigente);
      const p = await conFilaId({ lote: lote(id), grupos: orden === "metodo-primero" ? [gMetodo, gIa] : [gIa, gMetodo] });
      const r = await aplicar(p);
      expect(r.error).toBeNull();
      resultados.push([codigoFila(r.data, k(1), 2026), codigoFila(r.data, k(2), 2027), codigoFila(r.data, k(3), 2027)].join(","));
      await c.query("rollback to savepoint orden_sp");
      await c.query("release savepoint orden_sp");
    }
    expect(resultados).toEqual(["aplicada,aplicada,aplicada", "aplicada,aplicada,aplicada"]);
  });

  it("idempotencia: el mismo lote y cuerpo devuelve repetido=true sin escribir; otra huella u otra proyeccion es LP004 (lote_ajeno)", async () => {
    const id = randomUUID();
    const base = { lote: lote(id), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)])] };
    const p = await conFilaId(base);
    const primera = await aplicar(p);
    expect(primera.data).toMatchObject({ repetido: false });
    const lotesAntes = await contar(c, "proyeccion_lotes");
    const filasAntes = await contar(c, "proyeccion_lote_filas");
    const segunda = await aplicar(p);
    expect(segunda.error).toBeNull();
    expect(segunda.data).toMatchObject({ repetido: true, lote_id: id });
    expect(await contar(c, "proyeccion_lotes")).toBe(lotesAntes);
    expect(await contar(c, "proyeccion_lote_filas")).toBe(filasAntes);

    const otraHuella = JSON.parse(JSON.stringify(p)) as { lote: Record<string, Json> };
    otraHuella.lote.huella_cuerpo = "f".repeat(64);
    const r3 = await aplicar(otraHuella as unknown as Json);
    expect(r3.error).toMatchObject({ codigo: "LP004", mensaje: "lote_ajeno" });

    const otraProy = JSON.parse(JSON.stringify(p)) as { lote: Record<string, Json> };
    otraProy.lote.proyeccion_id = e.proyB;
    otraProy.lote.calculado_at_esperado = e.calculadoIsoB;
    const r4 = await aplicar(otraProy as unknown as Json);
    expect(r4.error?.codigo).toBe("LP004");
  });

  it("LP001: una proyeccion que no esta en trabajo rechaza el lote (proyeccion_archivada) y no escribe nada", async () => {
    await c.query("update public.proyecciones set estado = 'archivada' where id = $1", [e.proy]);
    const id = randomUUID();
    const r = await aplicar(await conFilaId({ lote: lote(id), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)])] }));
    expect(r.error).toMatchObject({ codigo: "LP001", mensaje: "proyeccion_archivada" });
    expect(await contar(c, "proyeccion_lotes", "id = $1", [id])).toBe(0);
    expect(await decididoDe(k(1), 2026)).toBeNull();
  });

  it("LP002: un calculo vivo (calculando_desde reciente) rechaza el lote; LP003: calculado_at distinto del esperado", async () => {
    const id = randomUUID();
    const p = await conFilaId({ lote: lote(id), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)])] });
    const desactualizado = JSON.parse(JSON.stringify(p)) as { lote: Record<string, Json> };
    desactualizado.lote.calculado_at_esperado = "2026-11-01T09:00:00.654320+00:00";
    const r3 = await aplicar(desactualizado as unknown as Json);
    expect(r3.error).toMatchObject({ codigo: "LP003", mensaje: "datos_cambiaron" });
    await c.query("update public.proyecciones set calculando_desde = now() where id = $1", [e.proy]);
    const r2 = await aplicar(p);
    expect(r2.error).toMatchObject({ codigo: "LP002", mensaje: "calculo_en_curso" });
    expect(await decididoDe(k(1), 2026)).toBeNull();
  });

  it("LP006 (proyeccion inexistente), LP007 (payload invalido: sin grupos, columna fuera de la lista fija, un registro en dos filas) y nada escrito", async () => {
    const id = randomUUID();
    const sinGrupos = await aplicar({ lote: lote(id) } as Json);
    expect(sinGrupos.error?.codigo).toBe("LP007");

    const inexistente = await aplicar(await conFilaId({ lote: lote(id, "aprobar", { proyeccion_id: randomUUID() }), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)])] }));
    expect(inexistente.error).toMatchObject({ codigo: "LP006", mensaje: "proyeccion_no_encontrada" });

    const columnaAjena = await aplicar(
      await conFilaId({
        lote: lote(id),
        grupos: [grupo("metodo", "GM-UNO", [fila(k(1), 2026, "metodo", 1000, [reg(k(1), 2026, true, { ...setMet(1000, id), activo: false })], { valor_esperado: 1000 })])],
      })
    );
    expect(columnaAjena.error?.codigo).toBe("LP007");
    expect(columnaAjena.error?.mensaje).toContain("lista fija");

    const repetido = await aplicar(await conFilaId({ lote: lote(id), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id), filaMet(k(1), 1000, id)])] }));
    expect(repetido.error?.codigo).toBe("LP007");

    expect(await contar(c, "proyeccion_lotes", "id = $1", [id])).toBe(0);
    expect(await decididoDe(k(1), 2026)).toBeNull();
    expect(await contar(c, "proyeccion_fila_anios", "activo = false")).toBe(0);
  });

  it("revertir: deshace lo aprobado por un lote (decidido y decision_lote_id vuelven a nulo); LP005 si el lote a revertir no existe", async () => {
    const aprobar = randomUUID();
    const a = await aplicar(await conFilaId({ lote: lote(aprobar), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, aprobar)])] }));
    expect(codigoFila(a.data, k(1), 2026)).toBe("aplicada");
    expect(await decididoDe(k(1), 2026)).toBe(1000);

    const revertir = randomUUID();
    const rev = await aplicar(
      await conFilaId({
        lote: lote(revertir, "revertir", { revierte_lote_id: aprobar }),
        grupos: [grupo("revertir", "GM-UNO", [fila(k(1), 2026, "revertir", null, [{ ...(reg(k(1), 2026, true, setRev) as Record<string, Json>), updated_at_esperado: await escalar<string>(c, `select ${iso("a.updated_at")} from public.proyeccion_fila_anios a where a.id = $1`, [e.registros.get(`${k(1)}|2026`)?.id]) }])])],
      })
    );
    expect(rev.error).toBeNull();
    expect(codigoFila(rev.data, k(1), 2026)).toBe("aplicada");
    expect(await decididoDe(k(1), 2026)).toBeNull();
    expect(await escalar<string | null>(c, "select a.decision_lote_id from public.proyeccion_fila_anios a where a.id = $1", [e.registros.get(`${k(1)}|2026`)?.id])).toBeNull();

    const fantasma = await aplicar(
      await conFilaId({ lote: lote(randomUUID(), "revertir", { revierte_lote_id: randomUUID() }), grupos: [grupo("revertir", "GM-UNO", [fila(k(1), 2026, "revertir", null, [reg(k(1), 2026, true, setRev)])])] })
    );
    expect(fantasma.error).toMatchObject({ codigo: "LP005", mensaje: "no_revertible" });
  });

  it("un grupo ia se escribe ENTERO o no se escribe: una fila ya decidida a mano deja el resto como grupo_rechazado", async () => {
    await c.query(
      "update public.proyeccion_fila_anios a set decidido = 3300, origen = 'manual', decidido_at = now(), decidido_por_nombre = 'a mano' from public.proyeccion_filas f where f.id = a.fila_id and f.clave = $1",
      [k(4)]
    );
    // El trigger set_updated_at movio el updated_at del registro 4: se vuelve a leer para que la lectura sea exacta.
    const nuevo = await filas<{ clave: string; anio: number; id: string; iso: string; iso1: string }>(
      c,
      `select f.clave, a.anio, a.id, ${iso("a.updated_at")} as iso, ${iso("a.updated_at + interval '1 microsecond'")} as iso1 from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id where f.proyeccion_id = $1`,
      [e.proy]
    );
    for (const r of nuevo) e.registros.set(`${r.clave}|${r.anio}`, { id: r.id, iso: r.iso, isoMas1: r.iso1 });
    const id = randomUUID();
    const r = await aplicar(
      await conFilaId({
        lote: lote(id),
        grupos: [grupo("ia", "GM-UNO", [filaIa(k(1), 1150, id), filaIa(k(2), 1100, id), filaIa(k(4), 1000, id)], lectura([k(1), k(2), k(3), k(4)]), e.vigente)],
      })
    );
    expect(r.error).toBeNull();
    expect(codigoFila(r.data, k(4), 2027)).toBe("ya_decidida");
    expect(codigoFila(r.data, k(1), 2027)).toBe("grupo_rechazado");
    expect(codigoFila(r.data, k(2), 2027)).toBe("grupo_rechazado");
    expect(await decididoDe(k(1), 2027)).toBeNull();
    expect(await decididoDe(k(2), 2027)).toBeNull();
  });

  it("la funcion solo la ejecuta service_role: anon y authenticated reciben permiso denegado (42501)", async () => {
    const id = randomUUID();
    const p = JSON.stringify(await conFilaId({ lote: lote(id), grupos: [grupo("metodo", "GM-UNO", [filaMet(k(1), 1000, id)])] }));
    for (const rol of ["anon", "authenticated"]) {
      await c.query("savepoint permiso_sp");
      await c.query(`set local role ${rol}`);
      await expect(c.query("select public.aplicar_lote_proyeccion($1::jsonb)", [p])).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint permiso_sp");
      await c.query("release savepoint permiso_sp");
    }
    expect(await contar(c, "proyeccion_lotes", "id = $1", [id])).toBe(0);
  });
});
