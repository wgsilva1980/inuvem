import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { AdminUserError, addAdmin, listAdmins, removeAdmin, setPerfil } from "@/lib/auth/admin-users";
import { LINKS_RESTRITOS, PERFIS, PERFIS_LISTA, ehPerfil, inicioDoPerfil, podeAcessar } from "@/lib/auth/perfis";
import { administradoresEntre } from "@/lib/digest/service";

describe("regras de acesso por perfil", () => {
  it("administrador entra em tudo; restrito só nas áreas pedidas; sem área = negado", () => {
    expect(podeAcessar("admin")).toBe(true);
    expect(podeAcessar("admin", "estoque")).toBe(true);
    expect(podeAcessar("expedicao", "expedicao")).toBe(true);
    expect(podeAcessar("expedicao", "estoque")).toBe(true);
    expect(podeAcessar("expedicao")).toBe(false);
  });

  it("o início de cada perfil é aberto para o próprio perfil (sem laço de redirecionamento)", () => {
    for (const p of PERFIS_LISTA) {
      const inicio = inicioDoPerfil(p);
      if (p === "admin") continue;
      expect(LINKS_RESTRITOS[p].some((l) => l.href === inicio)).toBe(true);
    }
    expect(ehPerfil("admin") && ehPerfil("expedicao") && !ehPerfil("root") && !ehPerfil(undefined)).toBe(true);
    expect(Object.keys(PERFIS)).toEqual(PERFIS_LISTA);
  });
});

/** Trava de segurança: só as páginas e rotas de Expedição e Estoque podem declarar uma área; todo o resto fica restrito a administradores. */
describe("quem declara uma área", () => {
  const raiz = process.cwd();
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  it("requireAdmin/requireAdminApi com área só aparecem em expedição e estoque", () => {
    const usos = [...arquivos(join(raiz, "app")), ...arquivos(join(raiz, "lib"))]
      .filter((f) => /require(Admin|AdminApi)\(\s*["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(raiz, f).replaceAll("\\", "/"))
      .filter((f) => f !== "lib/auth/admin.ts" && f !== "lib/auth/perfis.ts") // definição e comentários de exemplo
      .sort();
    expect(usos).toEqual([
      "app/(panel)/estoque/page.tsx",
      "app/(panel)/expedicao/conferir/page.tsx",
      "app/(panel)/expedicao/page.tsx",
      "app/(panel)/expedicao/separacao/page.tsx",
      "app/api/estoque/exportar/route.ts",
      "app/api/expedicao/enviar/route.ts",
    ]);
  });
});

let pg: PGlite;
let db: Db;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  await pg.query("INSERT INTO admins (email) VALUES ('dono@exemplo.com')");
});
const perfis = async () => Object.fromEntries((await listAdmins(db)).map((a) => [a.email, a.perfil]));

describe("perfis dos usuários", () => {
  it("quem já existia continua administrador; novo usuário escolhe o perfil", async () => {
    expect(await perfis()).toEqual({ "dono@exemplo.com": "admin" });
    await addAdmin(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", storeId: null, perfil: "expedicao" });
    await addAdmin(db, { actor: "dono@exemplo.com", email: "bia@exemplo.com", storeId: null });
    expect(await perfis()).toEqual({ "dono@exemplo.com": "admin", "ana@exemplo.com": "expedicao", "bia@exemplo.com": "admin" });
    await expect(addAdmin(db, { actor: "dono@exemplo.com", email: "x@exemplo.com", storeId: null, perfil: "root" as never })).rejects.toThrow(/Perfil inválido/);
  });

  it("troca o perfil de outra pessoa, registra no histórico e recusa mudar o próprio", async () => {
    const storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
    await addAdmin(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", storeId: null });
    expect(await setPerfil(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", perfil: "expedicao", storeId })).toEqual({ mudou: true });
    expect(await setPerfil(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", perfil: "expedicao", storeId })).toEqual({ mudou: false });
    expect((await perfis())["ana@exemplo.com"]).toBe("expedicao");
    const log = (await pg.query("SELECT acao, entidade_id, depois FROM audit_log")).rows;
    expect(log).toEqual([{ acao: "usuario.perfil", entidade_id: "ana@exemplo.com", depois: { email: "ana@exemplo.com", perfil: "expedicao", perfil_antes: "admin" } }]);
    await expect(setPerfil(db, { actor: "dono@exemplo.com", email: "dono@exemplo.com", perfil: "expedicao", storeId })).rejects.toThrow(/próprio perfil/);
    await expect(setPerfil(db, { actor: "dono@exemplo.com", email: "ninguem@exemplo.com", perfil: "admin", storeId })).rejects.toThrow(/não está na lista/);
  });

  it("nunca deixa o painel sem administrador", async () => {
    await addAdmin(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", storeId: null, perfil: "expedicao" });
    // a única administradora é "dono": outro admin tentando rebaixá-lo não existe; simulamos com ator diferente
    await expect(setPerfil(db, { actor: "ana@exemplo.com", email: "dono@exemplo.com", perfil: "expedicao", storeId: null })).rejects.toThrow(/último administrador/);
    await expect(removeAdmin(db, { actor: "ana@exemplo.com", email: "dono@exemplo.com", storeId: null })).rejects.toThrow(/último administrador/);
    expect(await perfis()).toMatchObject({ "dono@exemplo.com": "admin" });
    await expect(removeAdmin(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", storeId: null })).resolves.toBeUndefined();
  });

  it("perfil restrito não pode receber resumo nem alertas", async () => {
    await addAdmin(db, { actor: "dono@exemplo.com", email: "ana@exemplo.com", storeId: null, perfil: "expedicao" });
    expect(await administradoresEntre(db, ["dono@exemplo.com", "ana@exemplo.com"])).toEqual(["dono@exemplo.com"]);
  });

  it("o banco recusa um perfil inventado", async () => {
    await expect(pg.query("INSERT INTO admins (email, perfil) VALUES ('z@exemplo.com', 'root')")).rejects.toThrow();
    expect(AdminUserError).toBeDefined();
  });
});
