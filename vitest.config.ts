import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` lanza fuera de un entorno de servidor de React; en los tests es un no-op.
      "server-only": path.resolve(__dirname, "tests/server-only.vacio.ts"),
    },
  },
});
