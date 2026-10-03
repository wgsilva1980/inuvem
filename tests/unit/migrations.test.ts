import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations, type MigrationExecutor } from "@/lib/db/migrate";

function pgliteExecutor(db: PGlite): MigrationExecutor {
  return {
    exec: async (sql) => void (await db.exec(sql)),
    query: async (sql, params) => (await db.query(sql, params)).rows as never,
  };
}

describe("migrations", () => {
  const migrations = loadMigrations(join(process.cwd(), "db/migrations"));

  it("aplica o schema inicial e é idempotente", async () => {
    const db = new PGlite();
    const exec = pgliteExecutor(db);
    const first = await runMigrations(exec, migrations);
    expect(first).toEqual(migrations.map((m) => m.name));
    expect(await runMigrations(exec, migrations)).toEqual([]);
  });

  it("liga RLS em todas as tabelas do app", async () => {
    const db = new PGlite();
    await runMigrations(pgliteExecutor(db), migrations);
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("audit_log é append-only", async () => {
    const db = new PGlite();
    await runMigrations(pgliteExecutor(db), migrations);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id`,
    );
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade) VALUES ($1, 'a@b.c', 'teste', 'produto')`,
      [rows[0]!.id],
    );
    await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/somente de inserção/);
    await expect(db.query(`UPDATE audit_log SET acao = 'x'`)).rejects.toThrow(/somente de inserção/);
    // a remoção da loja (LGPD) leva o log junto, via cascade
    await db.query(`DELETE FROM stores WHERE id = $1`, [rows[0]!.id]);
    expect((await db.query(`SELECT 1 FROM audit_log`)).rows).toHaveLength(0);
  });

  it("permite apenas uma sincronização em andamento por loja", async () => {
    const db = new PGlite();
    await runMigrations(pgliteExecutor(db), migrations);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (2, 'x') RETURNING id`,
    );
    const id = rows[0]!.id;
    await db.query(`INSERT INTO sync_runs (store_id, tipo) VALUES ($1, 'full')`, [id]);
    await expect(db.query(`INSERT INTO sync_runs (store_id, tipo) VALUES ($1, 'incremental')`, [id])).rejects.toThrow();
  });
});
