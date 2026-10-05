import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { AdminUserError, addAdmin, listAdmins, normalizeEmail, removeAdmin } from "@/lib/auth/admin-users";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
  await pg.query("INSERT INTO admins (email) VALUES ('dono@exemplo.com')");
});

const emails = async () => (await listAdmins(db)).map((a) => a.email);
const audits = async () => (await pg.query<{ acao: string; entidade: string; entidade_id: string; actor_email: string }>("SELECT acao, entidade, entidade_id, actor_email FROM audit_log ORDER BY id")).rows;

describe("usuários do painel", () => {
  it("normaliza o e-mail e recusa o que não parece e-mail", () => {
    expect(normalizeEmail("  Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
    expect(normalizeEmail("sem-arroba")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("adiciona (em minúsculas), não duplica e registra no histórico", async () => {
    const r = await addAdmin(db, { actor: "dono@exemplo.com", email: " Maria@Exemplo.com ", storeId });
    expect(r).toEqual({ email: "maria@exemplo.com", created: true });
    expect(await emails()).toEqual(["dono@exemplo.com", "maria@exemplo.com"]);
    expect(await addAdmin(db, { actor: "dono@exemplo.com", email: "maria@exemplo.com", storeId })).toMatchObject({ created: false });
    expect(await audits()).toEqual([{ acao: "usuario.adicionar", entidade: "usuario", entidade_id: "maria@exemplo.com", actor_email: "dono@exemplo.com" }]);
  });

  it("e-mail inválido é recusado", async () => {
    await expect(addAdmin(db, { actor: "dono@exemplo.com", email: "oi", storeId })).rejects.toBeInstanceOf(AdminUserError);
  });

  it("remove outro usuário e registra; não remove a si mesmo nem o último", async () => {
    await addAdmin(db, { actor: "dono@exemplo.com", email: "maria@exemplo.com", storeId: null });
    await expect(removeAdmin(db, { actor: "dono@exemplo.com", email: "DONO@exemplo.com", storeId })).rejects.toThrow(/próprio acesso/);
    await removeAdmin(db, { actor: "dono@exemplo.com", email: "maria@exemplo.com", storeId });
    expect(await emails()).toEqual(["dono@exemplo.com"]);
    expect((await audits()).map((a) => a.acao)).toEqual(["usuario.remover"]);
    await expect(removeAdmin(db, { actor: "maria@exemplo.com", email: "dono@exemplo.com", storeId })).rejects.toThrow(/último usuário/);
    expect(await emails()).toEqual(["dono@exemplo.com"]);
  });

  it("remover e-mail que não está na lista avisa", async () => {
    await addAdmin(db, { actor: "dono@exemplo.com", email: "maria@exemplo.com", storeId: null });
    await expect(removeAdmin(db, { actor: "dono@exemplo.com", email: "outra@exemplo.com", storeId })).rejects.toThrow(/não está na lista/);
  });
});
