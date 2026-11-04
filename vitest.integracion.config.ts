import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Pruebas de INTEGRACION contra un Postgres real (`npm run test:integracion`). Aparte de las unitarias (`vitest.config.ts`), que no
 * necesitan base y simulan las funciones SQL con espejos en memoria.
 *
 *   * Necesitan `DATABASE_URL` apuntando a una base ya migrada (`scripts/validar-migraciones-local.sh`). Sin ella se saltan con un
 *     aviso claro, salvo que `VT_INTEGRACION_OBLIGATORIA=1` (la CI), que entonces falla.
 *   * `tests/integracion/global-setup.ts` clona esa base en una temporal y la borra al terminar: las pruebas de concurrencia
 *     confirman datos de verdad y no ensucian la base migrada.
 *   * Un solo archivo a la vez (`fileParallelism: false`): comparten la base clonada y varias funciones toman candados globales.
 */
export default defineConfig({
  test: {
    include: ["tests/integracion/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["tests/integracion/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only.vacio.ts"),
    },
  },
});
