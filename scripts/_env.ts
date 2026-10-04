import { existsSync } from "node:fs";

/** Carrega .env.local (se existir) para scripts executados fora do Next. */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/**
 * Connection string para scripts. Normaliza `sslmode=require` para `verify-full` (comportamento atual do
 * driver `pg`) e evita o aviso de depreciação; `channel_binding` não é necessário aqui.
 */
export function scriptConnectionString(): string | undefined {
  const raw = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  const mode = url.searchParams.get("sslmode");
  if (!mode || ["require", "prefer", "verify-ca"].includes(mode)) url.searchParams.set("sslmode", "verify-full");
  url.searchParams.delete("channel_binding");
  return url.toString();
}
