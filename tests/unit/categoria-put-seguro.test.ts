import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, type Db } from "@/lib/sync/repo";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { CategoriaAlteradaError, categoriaCompleta, semTextosVazios, updateCategory } from "@/lib/nuvemshop/categories";
import { PaginaAlteradaError, updateStorePage } from "@/lib/nuvemshop/pages";
import { pendentesDeRestauracao, restaurarCategorias } from "@/lib/categories/restore";
import { acaoLabel } from "@/lib/history/labels";
import type { Category } from "@/lib/nuvemshop/types";

/**
 * Loja falsa que imita o comportamento visto na loja real: o PUT SUBSTITUI a categoria (campos omitidos viram vazio).
 * `ignorarCampos` simula uma API que descarta um campo mesmo quando enviado.
 */
function lojaFalsa(inicial: Record<string, unknown>, opts: { ignorarCampos?: string[] } = {}) {
  const dados: Record<string, unknown> = structuredClone(inicial);
  const puts: Array<Record<string, unknown>> = [];
  const VAZIO: Record<string, unknown> = { name: { pt: "" }, handle: { pt: "" }, description: { pt: "" }, seo_title: { pt: "" }, seo_description: { pt: "" }, parent: 0, title: { pt: "" }, content: { pt: "" } };
  const client = {
    get: async () => structuredClone(dados),
    put: async (_p: string, body: Record<string, unknown>) => {
      // a loja real responde 422 a um campo de texto enviado vazio (o campo ausente é aceito)
      for (const [k, v] of Object.entries(body)) {
        if (v && typeof v === "object" && Object.values(v as Record<string, unknown>).every((x) => x === "" || x === null)) throw new NuvemshopError("422", 422, null, `${k} vazio`);
      }
      puts.push(structuredClone(body));
      for (const k of Object.keys(VAZIO)) if (k in dados || k in body) dados[k] = k in body && !opts.ignorarCampos?.includes(k) ? body[k] : structuredClone(VAZIO[k]);
      if ("parent" in body && body.parent === null) dados.parent = 0;
      return structuredClone(dados);
    },
  } as unknown as NuvemshopClient;
  return { client, dados, puts };
}

const original = (): Record<string, unknown> => ({
  id: 1,
  name: { pt: "Vestidos" },
  handle: { pt: "vestidos" },
  description: { pt: "Peças leves" },
  seo_title: { pt: "" },
  seo_description: { pt: "" },
  parent: 25768110,
  visibility: "visible",
});

describe("atualizar categoria sem apagar o resto", () => {
  it("o PUT só com SEO manteria nada: o painel lê a categoria e envia tudo junto", async () => {
    const l = lojaFalsa(original());
    const r = await updateCategory(l.client, 1, { seo_title: { pt: "Vestidos Femininos | Donatelle Concept" }, seo_description: { pt: "Texto." } });
    expect(l.puts[0]).toEqual({
      name: { pt: "Vestidos" },
      handle: { pt: "vestidos" },
      description: { pt: "Peças leves" },
      seo_title: { pt: "Vestidos Femininos | Donatelle Concept" },
      seo_description: { pt: "Texto." },
      parent: 25768110,
    });
    expect(r.name).toEqual({ pt: "Vestidos" });
    expect(l.dados.handle).toEqual({ pt: "vestidos" });
    expect(l.dados.parent).toBe(25768110);
  });

  it("categoria na raiz (parent 0) é enviada com parent null; editar o nome mantém o resto", async () => {
    const l = lojaFalsa({ ...original(), parent: 0 });
    await updateCategory(l.client, 1, { name: { pt: "Vestidos Novos" } });
    expect(l.puts[0]).toMatchObject({ name: { pt: "Vestidos Novos" }, handle: { pt: "vestidos" }, description: { pt: "Peças leves" }, parent: null });
    expect(l.dados.handle).toEqual({ pt: "vestidos" });
  });

  it("se a loja descarta um campo que não era para mudar, restaura o que havia e avisa", async () => {
    const l = lojaFalsa(original(), { ignorarCampos: ["handle"] });
    await expect(updateCategory(l.client, 1, { seo_title: { pt: "X" } })).rejects.toThrow(CategoriaAlteradaError);
    expect(l.puts).toHaveLength(2); // o envio e a restauração
    expect(l.puts[1]).toEqual(semTextosVazios(categoriaCompleta({ ...original() } as unknown as Category))); // restaura exatamente o que havia
  });

  it("não envia texto vazio (a loja responde 422), nem na categoria apagada nem ao limpar a descrição", async () => {
    const l = lojaFalsa({ ...original(), description: { pt: "" } });
    await updateCategory(l.client, 1, { seo_title: { pt: "Novo" } });
    expect(l.puts[0]).not.toHaveProperty("description");
    expect(l.puts[0]).not.toHaveProperty("seo_description");
    await updateCategory(l.client, 1, { description: { pt: "" } }); // limpar a descrição = omitir
    expect(l.puts[1]).not.toHaveProperty("description");
  });

  it("categoriaCompleta não inventa campos que a loja não tinha", () => {
    expect(categoriaCompleta({ id: 1, name: { pt: "A" }, parent: 0 } as unknown as Category)).toEqual({ name: { pt: "A" }, parent: null });
  });
});

describe("atualizar página sem apagar o resto", () => {
  const pagina = () => ({ id: 7, title: { pt: "Trocas" }, content: { pt: "<p>Troque em 7 dias</p>" }, handle: { pt: "trocas" }, publish: true, seo_title: { pt: "" }, seo_description: { pt: "" } });

  it("envia título, conteúdo, endereço e publicação junto com o SEO novo", async () => {
    const l = lojaFalsa(pagina());
    await updateStorePage(l.client, 7, { seo_title: { pt: "Trocas | Donatelle Concept" }, seo_description: { pt: "Como trocar." } });
    expect(l.puts[0]).toEqual({ title: { pt: "Trocas" }, content: { pt: "<p>Troque em 7 dias</p>" }, handle: { pt: "trocas" }, publish: true, seo_title: { pt: "Trocas | Donatelle Concept" }, seo_description: { pt: "Como trocar." } });
    expect(l.dados.content).toEqual({ pt: "<p>Troque em 7 dias</p>" });
  });

  it("restaura e avisa se o conteúdo foi alterado pela loja", async () => {
    const l = lojaFalsa(pagina(), { ignorarCampos: ["content"] });
    await expect(updateStorePage(l.client, 7, { seo_title: { pt: "X" } })).rejects.toThrow(PaginaAlteradaError);
    expect(l.puts).toHaveLength(2);
  });
});

describe("restaurar categorias", () => {
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
  });

  it("devolve nome, endereço, descrição e pai originais, mantém o SEO atual, atualiza o espelho e registra no Histórico", async () => {
    const apagada = { id: 1, name: { pt: "" }, handle: { pt: "" }, description: { pt: "" }, seo_title: { pt: "Vestidos Femininos | Donatelle Concept" }, seo_description: { pt: "Texto." }, parent: 0 };
    await upsertCategories(db, storeId, [apagada as unknown as Category]);
    await pg.query("INSERT INTO category_restore (store_id, category_id, name, handle, description, parent_id) VALUES ($1, 1, 'Vestidos', 'vestidos', 'Peças leves', 25768110), ($1, 2, 'Saias', NULL, NULL, NULL)", [storeId]);
    expect((await pendentesDeRestauracao(db, storeId)).map((p) => p.category_id)).toEqual(["1", "2"]);

    const l = lojaFalsa(apagada);
    const dados2 = { id: 2, name: { pt: "" }, handle: { pt: "" }, description: { pt: "" }, parent: 0 };
    const clientes: Record<number, ReturnType<typeof lojaFalsa>> = { 1: l, 2: lojaFalsa(dados2) };
    const r = await restaurarCategorias(db, { update: (id, input) => updateCategory(clientes[id]!.client, id, input) }, { storeId, actor: "admin@x.com" });
    expect(r).toEqual({ restauradas: 2, falhas: [] });
    expect(l.dados).toMatchObject({ name: { pt: "Vestidos" }, handle: { pt: "vestidos" }, description: { pt: "Peças leves" }, parent: 25768110, seo_title: { pt: "Vestidos Femininos | Donatelle Concept" } });
    expect(clientes[2]!.dados.parent).toBe(0);
    expect((await pg.query<{ name: string; parent_id: string }>("SELECT name, parent_id::text FROM categories WHERE id = 1")).rows[0]).toEqual({ name: "Vestidos", parent_id: "25768110" });
    expect(await pendentesDeRestauracao(db, storeId)).toEqual([]);
    expect((await pg.query("SELECT 1 FROM audit_log WHERE acao = 'categoria.restaurar'")).rows).toHaveLength(2);
    expect(acaoLabel("categoria.restaurar")).toMatch(/restaurada/);
    // idempotente
    expect(await restaurarCategorias(db, { update: async () => { throw new Error("não deveria chamar"); } }, { storeId, actor: "a@b.c" })).toEqual({ restauradas: 0, falhas: [] });
  });
});
