import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MigrationExecutor {
  /** Executa um script SQL com múltiplos comandos. */
  exec(sql: string): Promise<void>;
  /** Executa uma consulta parametrizada. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Migration {
  name: string;
  sql: string;
}

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/** Aplica, em ordem e uma única vez, as migrations ainda não registradas. Retorna as aplicadas. */
export async function runMigrations(db: MigrationExecutor, migrations: Migration[]): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await db.exec(`BEGIN;\n${m.sql}\nINSERT INTO schema_migrations (name) VALUES ('${m.name.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(m.name);
  }
  return applied;
}
