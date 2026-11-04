import { Client } from "pg";
import type { TestProject } from "vitest/node";

/**
 * Preparacion de las pruebas de integracion (ver vitest.integracion.config.ts).
 *
 *   1. Lee `DATABASE_URL` (la base ya migrada con scripts/validar-migraciones-local.sh). Sin ella: aviso y las pruebas se saltan; con
 *      `VT_INTEGRACION_OBLIGATORIA=1` (CI) en cambio falla, para que una CI mal configurada no pase en verde sin probar nada.
 *   2. Se niega a correr contra un host que no sea local (jamas contra Supabase) salvo `VT_PERMITIR_HOST_REMOTO=1`.
 *   3. Clona la base migrada en una temporal (`create database ... template ...`) y entrega su URL a las pruebas por `inject`.
 *      Las pruebas de concurrencia confirman datos de verdad: viven y mueren en el clon.
 *   4. Al terminar borra el clon (VT_INTEGRACION_CONSERVAR_BASE=1 lo deja, para depurar).
 */
declare module "vitest" {
  export interface ProvidedContext {
    /** URL de la base clonada para esta ejecucion; cadena vacia si no hay `DATABASE_URL` (todo se salta). */
    urlPruebas: string;
    /** Nombre de la base clonada (vacio si se salta). */
    basePruebas: string;
  }
}

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

function hostDe(url: URL): string {
  const porParametro = url.searchParams.get("host");
  if (porParametro) return porParametro;
  return url.hostname;
}

function esLocal(host: string): boolean {
  return HOSTS_LOCALES.has(host) || host.startsWith("/");
}

function conBase(url: URL, base: string): string {
  const copia = new URL(url.toString());
  copia.pathname = `/${base}`;
  return copia.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const crudo = process.env.DATABASE_URL;
  if (!crudo) {
    const mensaje =
      "Pruebas de integracion SALTADAS: no hay DATABASE_URL. Levanta un Postgres local y migralo con scripts/validar-migraciones-local.sh " +
      "(imprime el DATABASE_URL a exportar), por ejemplo: export DATABASE_URL=postgres://vt_test:vt_test@localhost:5432/vector_two_local";
    if (process.env.VT_INTEGRACION_OBLIGATORIA === "1") {
      throw new Error(`${mensaje}. VT_INTEGRACION_OBLIGATORIA=1: no se permite saltarlas.`);
    }
    console.warn(`\n[integracion] ${mensaje}\n`);
    project.provide("urlPruebas", "");
    project.provide("basePruebas", "");
    return;
  }

  const url = new URL(crudo);
  const host = hostDe(url);
  if (!esLocal(host) && process.env.VT_PERMITIR_HOST_REMOTO !== "1") {
    throw new Error(
      `El host '${host}' no es local. Las pruebas de integracion crean y borran bases y escriben datos: nunca contra un servidor remoto (jamas contra Supabase). Si es un Postgres de pruebas, exporta VT_PERMITIR_HOST_REMOTO=1.`
    );
  }
  const plantilla = url.pathname.replace(/^\//, "");
  if (!plantilla || ["postgres", "template0", "template1"].includes(plantilla)) {
    throw new Error(`DATABASE_URL debe apuntar a la base migrada (p. ej. .../vector_two_local), no a '${plantilla || "(vacio)"}'.`);
  }

  const admin = new Client({ connectionString: conBase(url, "postgres") });
  await admin.connect();
  const nombre = `vt_it_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const migrada = await new Client({ connectionString: crudo });
    await migrada.connect();
    try {
      const r = await migrada.query<{ ok: boolean }>("select to_regclass('public.compras') is not null as ok");
      if (!r.rows[0]?.ok) throw new Error(`La base '${plantilla}' no esta migrada. Corre antes scripts/validar-migraciones-local.sh`);
    } finally {
      await migrada.end();
    }

    // `create database ... template` exige que nadie mas este conectado a la plantilla: se reintenta un momento.
    let ultimo: unknown = null;
    for (let intento = 0; intento < 20; intento++) {
      try {
        await admin.query(`create database "${nombre}" template "${plantilla}"`);
        ultimo = null;
        break;
      } catch (e) {
        ultimo = e;
        await sleep(500);
      }
    }
    if (ultimo) throw ultimo;
  } catch (e) {
    await admin.end();
    throw e;
  }
  await admin.end();

  project.provide("urlPruebas", conBase(url, nombre));
  project.provide("basePruebas", nombre);

  return async () => {
    if (process.env.VT_INTEGRACION_CONSERVAR_BASE === "1") {
      console.warn(`[integracion] base temporal conservada: ${nombre}`);
      return;
    }
    const limpiador = new Client({ connectionString: conBase(url, "postgres") });
    await limpiador.connect();
    try {
      await limpiador.query(`drop database if exists "${nombre}" with (force)`);
    } finally {
      await limpiador.end();
    }
  };
}
