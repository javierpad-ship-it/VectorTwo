import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prueba estática de la migración 0029 (M6 06e, 0.14.0), con el patrón de las de 0022 y 0025: se lee el SQL y se vigila lo que se rompe por descuido
 * (seguridad de la función, `default 'bruta'` para siempre y ninguna sentencia que `execute_sql` deje esperando una confirmación).
 */

const RAIZ = path.resolve(__dirname, "..");
const sql = readFileSync(path.join(RAIZ, "supabase", "migrations", "0029_cierre_y_base_sin_nino.sql"), "utf8");
/** Sin comentarios `--` ni cadenas (los `comment on` repiten palabras como «set default»); los cuerpos `$$ … $$` SE CONSERVAN: tampoco ahí puede haber `update`. */
const sentencias = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");

describe("migración 0029: función venta_genero_mundo(date)", () => {
  it("es security invoker y con search_path vacío", () => {
    expect(sentencias).toMatch(/create or replace function public\.venta_genero_mundo\(p_desde date\)/);
    expect(sentencias).toMatch(/security invoker/);
    expect(sentencias).toMatch(/set search_path = ''/);
    expect(sentencias).not.toMatch(/security definer/i);
  });

  it("revoca la ejecución a public, anon y authenticated y la concede solo a service_role", () => {
    expect(sentencias).toMatch(/revoke execute on function public\.venta_genero_mundo\(date\) from public, anon, authenticated;/);
    expect(sentencias).toMatch(/grant execute on function public\.venta_genero_mundo\(date\) to service_role;/);
    expect(sentencias).not.toMatch(/grant\s+[^;]*\bto\s+(public|anon|authenticated)\b/i);
  });

  it("las tablas tocadas conservan RLS activo y la migración no crea políticas", () => {
    for (const t of ["crecimientos_genero_mundo", "proyeccion_crecimientos", "factores_volumen_atipico"]) {
      expect(sentencias, t).toMatch(new RegExp(`alter table public\\.${t} enable row level security;`));
    }
    expect(sentencias).not.toMatch(/create\s+policy/i);
  });
});

describe("migración 0029: sobre_base y sentencias a nivel de migración", () => {
  it("crecimientos_genero_mundo.sobre_base nace con default 'bruta' y not null", () => {
    expect(sentencias).toMatch(/add column if not exists sobre_base text not null default ''/);
    expect(sql).toMatch(/add column if not exists sobre_base text not null default 'bruta';/);
  });

  it("no hay ningún `alter column … set default` (el default es bruta para siempre)", () => {
    expect(sentencias).not.toMatch(/\bset\s+default\b/i);
    expect(sentencias).not.toMatch(/alter\s+column/i);
  });

  it("no tiene drop, delete, truncate ni update (tampoco dentro de la función) ni bloques do $$", () => {
    expect(sentencias.match(/\b(drop|delete|truncate|update)\b/gi) ?? []).toEqual([]);
    expect(sentencias).not.toMatch(/\bdo\s+\$\$/i);
  });

  it("todo es idempotente: columnas con if not exists y la función con create or replace", () => {
    const columnas = [...sentencias.matchAll(/\badd\s+column\b(?!\s+if\s+not\s+exists)/gi)];
    expect(columnas).toEqual([]);
    expect(sentencias).not.toMatch(/create\s+function/i);
    expect(sentencias).not.toMatch(/create\s+table/i);
  });
});
