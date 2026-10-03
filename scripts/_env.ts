import { existsSync } from "node:fs";

/** Carrega .env.local (se existir) para scripts executados fora do Next. */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
