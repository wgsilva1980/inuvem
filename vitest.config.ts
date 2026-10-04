import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Os testes com Postgres em WASM (pglite) demoram para iniciar quando rodam em paralelo.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
