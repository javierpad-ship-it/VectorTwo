import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Las pruebas contra Postgres real (`npm run test:integracion`) tienen su propia configuracion: las unitarias no necesitan base.
    exclude: ["**/node_modules/**", "tests/integracion/**"],
    environment: "node",
    // Ninguna prueba toca la red: un `fetch` a `openai.com` o a `anthropic.com` lanza (ficha 07e, §5.7).
    setupFiles: ["tests/setup-sin-red.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` lanza fuera de un entorno de servidor de React; en los tests es un no-op.
      "server-only": path.resolve(__dirname, "tests/server-only.vacio.ts"),
    },
  },
});
