import { Client } from "pg";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "../lib/db/migrate";
import { loadLocalEnv, scriptConnectionString } from "./_env";

loadLocalEnv();

const url = scriptConnectionString();
if (!url) {
  console.error("Defina DATABASE_URL_UNPOOLED (ou DATABASE_URL) em .env.local");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  const applied = await runMigrations(
    {
      exec: async (sql) => void (await client.query(sql)),
      query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
    },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  console.log(applied.length ? `Migrations aplicadas: ${applied.join(", ")}` : "Banco já está atualizado.");
} catch (err) {
  console.error("Falha ao migrar:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
