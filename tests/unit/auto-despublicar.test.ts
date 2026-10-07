import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { handleWebhook, type ResourceApi, type WebhookDeps } from "@/lib/webhooks/handler";
import {
  ACAO_DESPUBLICAR,
  ATOR_AUTOMACAO,
  autoDespublicarLigado,
  contarPublicadosSemEstoque,
  despublicarSemEstoqueAgora,
  salvarAutoDespublicar,
  todasSemEstoque,
  ultimasAcoesAutomaticas,
} from "@/lib/automations/out-of-stock";
import { acaoLabel } from "@/lib/history/labels";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Category, Product } from "@/lib/nuvemshop/types";

const SECRET = "segredo-do-app";
let pg: PGlite;
let db: Db;
let storeId: string;
let clock: number;

const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const evento = (event: string, id: number) => JSON.stringify({ store_id: 1, event, id });

type V = { stock_management?: boolean; stock?: number | null };
const variantes = (id: number, vs: V[]) => vs.map((v, n) => ({ id: id * 100 + n, product_id: id, price: "10.00", stock_management: true, stock: 5, ...v }));
const produto = (id: number, vs: V[], published = true): Product =>
  ({ id, name: { pt: `Produto ${id}` }, published, categories: [], variants: variantes(id, vs), updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

/** Loja falsa: guarda os produtos, responde ao GET e aplica o PUT de publicação. */
function loja(inicial: Product[]) {
  const produtos = new Map(inicial.map((p) => [p.id, structuredClone(p)]));
  const puts: Array<{ id: number; published: boolean }> = [];
  let falhar: Error | null = null;
  const api: ResourceApi & { setPublished: (id: number, published: boolean) => Promise<Product> } = {
    getProduct: async (id) => structuredClone(produtos.get(id)!),
    getCategory: async (id) => ({ id, name: { pt: "c" } }) as Category,
    setPublished: async (id, published) => {
      if (falhar) throw falhar;
      puts.push({ id, published });
      const p = produtos.get(id)!;
      p.published = published;
      return structuredClone(p);
    },
  };
  return { api, puts, produtos, falhar: (e: Error | null) => (falhar = e) };
}

function deps(api: ResourceApi): WebhookDeps {
  return { db, clientSecret: SECRET, findStore: async (n) => (n === 1 ? { id: storeId, nuvemshop_store_id: "1" } : null), apiFor: async () => api, now: () => clock, log: () => {} };
}
const enviar = async (api: ResourceApi, event: string, id: number) => {
  clock += 10_000; // sempre fora da janela de deduplicação
  const raw = evento(event, id);
  return handleWebhook(deps(api), raw, sign(raw));
};
const publicado = async (id: number) => (await pg.query<{ published: boolean }>("SELECT published FROM products WHERE id = $1", [id])).rows[0]!.published;
const auditorias = async () => (await pg.query<{ actor_email: string; acao: string; sucesso: boolean; antes: unknown; depois: Record<string, unknown> }>("SELECT actor_email, acao, sucesso, antes, depois FROM audit_log ORDER BY id")).rows;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
  clock = 1_000_000;
});

describe("quando um produto está sem estoque", () => {
  it("só quando TODAS as variações controlam estoque e estão zeradas", () => {
    expect(todasSemEstoque(produto(1, [{ stock: 0 }, { stock: 0 }]))).toBe(true);
    expect(todasSemEstoque(produto(1, [{ stock: 0 }, { stock: -1 }]))).toBe(true);
    expect(todasSemEstoque(produto(1, [{ stock: 0 }, { stock: 2 }]))).toBe(false);
    expect(todasSemEstoque(produto(1, [{ stock: 0 }, { stock_management: false, stock: 0 }]))).toBe(false); // ilimitada
    expect(todasSemEstoque(produto(1, [{ stock: null }]))).toBe(false); // sem quantidade = ilimitada
    expect(todasSemEstoque(produto(1, []))).toBe(false);
  });
});

describe("webhook de produto com a regra", () => {
  it("desligada (padrão): não mexe em nada", async () => {
    const l = loja([produto(1, [{ stock: 0 }])]);
    await upsertProducts(db, storeId, [produto(1, [{ stock: 5 }])]);
    expect((await enviar(l.api, "product/updated", 1)).status).toBe(200);
    expect(l.puts).toEqual([]);
    expect(await publicado(1)).toBe(true);
    expect(await autoDespublicarLigado(db, storeId)).toBe(false);
  });

  it("ligada: todas as variações zeradas -> despublica na loja, no espelho e registra no Histórico", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }, { stock: 0 }])]);
    expect((await enviar(l.api, "product/updated", 1)).status).toBe(200);
    expect(l.puts).toEqual([{ id: 1, published: false }]);
    expect(await publicado(1)).toBe(false);
    expect(await auditorias()).toEqual([
      { actor_email: ATOR_AUTOMACAO, acao: ACAO_DESPUBLICAR, sucesso: true, antes: { published: true }, depois: { published: false, motivo: "todas as variações estão sem estoque", variacoes: 2 } },
    ]);
  });

  it("vale também para produto recém-criado", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(2, [{ stock: 0 }])]);
    await enviar(l.api, "product/created", 2);
    expect(l.puts).toEqual([{ id: 2, published: false }]);
  });

  it("não despublica se alguma variação tem estoque, é ilimitada ou o produto já está despublicado", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }, { stock: 1 }]), produto(2, [{ stock: 0 }, { stock_management: false }]), produto(3, [{ stock: 0 }], false)]);
    for (const id of [1, 2, 3]) await enviar(l.api, "product/updated", id);
    expect(l.puts).toEqual([]);
    expect(await auditorias()).toEqual([]);
  });

  it("sem laço: o evento que o próprio PUT gera chega com o produto já despublicado e nada acontece", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    await enviar(l.api, "product/updated", 1); // despublica
    await enviar(l.api, "product/updated", 1); // o evento gerado pelo PUT
    await enviar(l.api, "product/updated", 1);
    expect(l.puts).toHaveLength(1);
    expect((await auditorias()).length).toBe(1);
  });

  it("falha ao despublicar: o webhook responde 200, a falha fica no Histórico e a próxima atualização tenta de novo", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    l.falhar(new NuvemshopError("erro", 500, "x", "fora do ar"));
    const r = await enviar(l.api, "product/updated", 1);
    expect(r.status).toBe(200);
    expect(await publicado(1)).toBe(true); // o espelho segue o que a loja tem
    const [a] = await auditorias();
    expect(a).toMatchObject({ acao: ACAO_DESPUBLICAR, sucesso: false });
    l.falhar(null);
    await enviar(l.api, "product/updated", 1);
    expect(l.puts).toEqual([{ id: 1, published: false }]);
  });

  it("evento de outro tipo (categoria) não aplica a regra", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }])]);
    await enviar(l.api, "category/updated", 10);
    expect(l.puts).toEqual([]);
  });

  it("o Histórico mostra um texto próprio para a ação", () => {
    expect(acaoLabel(ACAO_DESPUBLICAR, "produto")).toBe("Produto despublicado automaticamente (sem estoque)");
  });
});

describe("despublicar agora os que já estão sem estoque", () => {
  it("confere cada produto na loja: despublica os que continuam sem estoque e mantém os que já têm", async () => {
    await upsertProducts(db, storeId, [produto(1, [{ stock: 0 }]), produto(2, [{ stock: 0 }]), produto(3, [{ stock: 4 }]), produto(4, [{ stock: 0 }], false)]);
    expect(await contarPublicadosSemEstoque(db, storeId)).toBe(2);
    // na loja, o produto 2 já recebeu estoque (o espelho estava velho)
    const l = loja([produto(1, [{ stock: 0 }]), produto(2, [{ stock: 7 }]), produto(3, [{ stock: 4 }]), produto(4, [{ stock: 0 }], false)]);
    const r = await despublicarSemEstoqueAgora(db, l.api, { storeId, ator: "admin@x.com", budgetMs: 10_000 });
    expect(r).toMatchObject({ despublicados: 1, jaOk: 1, falhas: [], restantes: false });
    expect(l.puts).toEqual([{ id: 1, published: false }]);
    expect(await publicado(1)).toBe(false);
    expect(await publicado(2)).toBe(true);
    expect(await contarPublicadosSemEstoque(db, storeId)).toBe(0); // o espelho do 2 foi atualizado
    expect((await auditorias()).map((a) => [a.actor_email, a.sucesso])).toEqual([["admin@x.com", true]]);
  });

  it("não depende da opção estar ligada (é uma ação manual)", async () => {
    await upsertProducts(db, storeId, [produto(1, [{ stock: 0 }])]);
    const l = loja([produto(1, [{ stock: 0 }])]);
    expect(await autoDespublicarLigado(db, storeId)).toBe(false);
    expect((await despublicarSemEstoqueAgora(db, l.api, { storeId, ator: "a@b.c", budgetMs: 10_000 })).despublicados).toBe(1);
  });

  it("falha num produto não trava os outros e o produto vai para a lista de falhas", async () => {
    await upsertProducts(db, storeId, [produto(1, [{ stock: 0 }]), produto(2, [{ stock: 0 }])]);
    const l = loja([produto(1, [{ stock: 0 }]), produto(2, [{ stock: 0 }])]);
    const original = l.api.getProduct;
    l.api.getProduct = async (id) => (id === 1 ? Promise.reject(new NuvemshopError("erro", 500, "x", "fora do ar")) : original(id));
    const r = await despublicarSemEstoqueAgora(db, l.api, { storeId, ator: "a@b.c", budgetMs: 10_000 });
    expect(r.despublicados).toBe(1);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]).toMatchObject({ productId: "1", produto: "Produto 1" });
  });

  it("para no orçamento de tempo e continua depois", async () => {
    const todos = [1, 2, 3, 4].map((n) => produto(n, [{ stock: 0 }]));
    await upsertProducts(db, storeId, todos);
    const l = loja(todos);
    let t = 0;
    const r1 = await despublicarSemEstoqueAgora(db, l.api, { storeId, ator: "a@b.c", budgetMs: 150, now: () => (t += 100) });
    expect(r1.restantes).toBe(true);
    expect(r1.despublicados).toBeGreaterThan(0);
    const r2 = await despublicarSemEstoqueAgora(db, l.api, { storeId, ator: "a@b.c", budgetMs: 10_000 });
    expect(r1.despublicados + r2.despublicados).toBe(4);
    expect(r2.restantes).toBe(false);
  });
});

describe("configuração e últimas ações", () => {
  it("liga e desliga por loja", async () => {
    expect(await autoDespublicarLigado(db, storeId)).toBe(false);
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    expect(await autoDespublicarLigado(db, storeId)).toBe(true);
    await salvarAutoDespublicar(db, storeId, false, "a@b.c");
    expect(await autoDespublicarLigado(db, storeId)).toBe(false);
  });

  it("lista as últimas ações automáticas, mais recentes primeiro, com sucesso e falha", async () => {
    await salvarAutoDespublicar(db, storeId, true, "a@b.c");
    const l = loja([produto(1, [{ stock: 0 }]), produto(2, [{ stock: 0 }])]);
    await enviar(l.api, "product/updated", 1);
    l.falhar(new NuvemshopError("erro", 500, "x", "fora do ar"));
    await enviar(l.api, "product/updated", 2);
    const acoes = await ultimasAcoesAutomaticas(db, storeId);
    expect(acoes.map((a) => [a.product_id, a.produto, a.sucesso])).toEqual([["2", "Produto 2", false], ["1", "Produto 1", true]]);
    expect(acoes[0]!.mensagem).toBe("fora do ar");
  });
});
