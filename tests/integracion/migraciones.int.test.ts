import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HAY_BASE, abrir, escalar, filas } from "./ayudas";

/**
 * Registro de migraciones (0035) contra la base realmente migrada: cada archivo de `supabase/migrations/` esta registrado en
 * `public.migraciones_aplicadas` y no hay registros sin archivo; y desde la 0035 toda migracion termina registrandose a si misma
 * (la convencion que fija la propia 0035). Las pruebas se saltan si la base no tiene la 0035 (el registro todavia no existe).
 */
const CARPETA = path.resolve(__dirname, "../../supabase/migrations");
const archivos = readdirSync(CARPETA)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const nombres = archivos.map((f) => f.replace(/\.sql$/, ""));

describe("archivos de supabase/migrations/ (no necesita base)", () => {
  it("nombres con cuatro digitos y snake_case, numeracion sin repetidos y creciente (los huecos 0026 y 0028 estan reservados)", () => {
    for (const f of archivos) expect(f, `nombre de archivo ${f}`).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    const numeros = archivos.map((f) => Number(f.slice(0, 4)));
    expect(new Set(numeros).size).toBe(numeros.length);
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    const huecos = Array.from({ length: numeros[numeros.length - 1] + 1 }, (_, i) => i).filter((i) => !numeros.includes(i));
    expect(huecos.filter((h) => ![26, 28].includes(h)), "numeros que faltan sin estar reservados").toEqual([]);
  });

  it("desde la 0035, cada migracion se registra a si misma en migraciones_aplicadas (convencion de la 0035)", () => {
    const sinRegistro = archivos
      .filter((f) => Number(f.slice(0, 4)) >= 35)
      .filter((f) => {
        const nombre = f.replace(/\.sql$/, "");
        const sql = readFileSync(path.join(CARPETA, f), "utf8");
        return !new RegExp(`insert\\s+into\\s+public\\.migraciones_aplicadas[\\s\\S]*?'${nombre}'`).test(sql);
      });
    expect(sinRegistro, "Migraciones sin su insert en migraciones_aplicadas").toEqual([]);
  });
});

describe.skipIf(!HAY_BASE)("registro de migraciones en la base (Postgres real)", () => {
  let c: Client;
  let hay0035: boolean;
  beforeAll(async () => {
    c = await abrir();
    hay0035 = await escalar<boolean>(c, "select to_regclass('public.migraciones_aplicadas') is not null");
  });
  afterAll(async () => {
    await c?.end();
  });

  it("la base migrada tiene registrada exactamente cada migracion del repositorio (ni faltan ni sobran)", async (ctx) => {
    if (!hay0035) ctx.skip();
    const registradas = (await filas<{ nombre: string }>(c, "select nombre from public.migraciones_aplicadas order by nombre")).map((x) => x.nombre);
    const faltan = nombres.filter((n) => !registradas.includes(n));
    const sobran = registradas.filter((n) => !nombres.includes(n));
    expect({ faltan, sobran }).toEqual({ faltan: [], sobran: [] });
  });

  it("el registro es de solo insercion para service_role y el check de formato rechaza nombres sueltos", async (ctx) => {
    if (!hay0035) ctx.skip();
    await c.query("begin");
    try {
      await c.query("savepoint sp");
      await expect(c.query("insert into public.migraciones_aplicadas (nombre) values ('mal nombre')")).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint sp");
      await c.query("savepoint sp2");
      await c.query("set local role service_role");
      await expect(c.query("update public.migraciones_aplicadas set nota = 'x'")).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint sp2");
      await c.query("savepoint sp3");
      await c.query("set local role service_role");
      await expect(c.query("delete from public.migraciones_aplicadas")).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint sp3");
    } finally {
      await c.query("rollback");
    }
  });
});
