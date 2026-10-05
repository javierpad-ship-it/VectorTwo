/**
 * Seed de `agrupaciones_marca` (docs/modulos/02-marcas.md, "Modelo de datos"
 * y regla 5). Es la misma lista, en el mismo orden, que inserta
 * `supabase/migrations/0002_marcas.sql`; el test `tests/marcas.seed.test.ts`
 * comprueba que nombres y códigos siguen las convenciones del árbol
 * (`normalizarNombre`, `aCodigo`) y que `orden` es estrictamente creciente.
 *
 * El "1 · 2 · 3 · 4 · 5" con que Javier numera las agrupaciones es `orden / 10`.
 */
export const SEED_AGRUPACIONES_MARCA = [
  { codigo: "ULTRA_LOW", nombre: "ULTRA LOW", orden: 10 },
  { codigo: "MID_VALUE", nombre: "MID VALUE", orden: 20 },
  { codigo: "VALOR", nombre: "VALOR", orden: 30 },
  { codigo: "RECONOCIDO", nombre: "RECONOCIDO", orden: 40 },
  { codigo: "PREMIUM", nombre: "PREMIUM", orden: 50 },
] as const;

export type SeedAgrupacionMarca = (typeof SEED_AGRUPACIONES_MARCA)[number];
