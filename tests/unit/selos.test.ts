import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { PADRAO, normalizarWhatsapp, obterConfig, salvarConfig, validarConfig } from "@/lib/badges/settings";
import { montarSelos, selosPorHandle } from "@/lib/badges/public";
import { SCRIPT_SELOS } from "@/lib/badges/script";
import { acaoLabel } from "@/lib/history/labels";
import type { Product } from "@/lib/nuvemshop/types";

describe("configuração dos selos", () => {
  it("normaliza telefone brasileiro", () => {
    expect(normalizarWhatsapp("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizarWhatsapp("+55 11 91234-5678")).toBe("5511912345678");
    expect(normalizarWhatsapp("1134567890")).toBe("551134567890");
    expect(normalizarWhatsapp("12345")).toBeNull();
    expect(normalizarWhatsapp("")).toBeNull();
    expect(normalizarWhatsapp("+1 415 555 0100")).toBeNull();
  });

  it("valida limites, número e mensagem", () => {
    const base = { ...PADRAO, whatsappNumber: "" };
    expect(validarConfig({ ...base, lowStockMax: 0 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, lowStockMax: 21 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, whatsappEnabled: true })).toMatchObject({ ok: false, error: expect.stringMatching(/Informe o número/) });
    expect(validarConfig({ ...base, whatsappNumber: "abc12" })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, whatsappMessage: "x".repeat(201) })).toMatchObject({ ok: false });
    const ok = validarConfig({ ...base, enabled: true, whatsappEnabled: true, whatsappNumber: "(11) 91234-5678", whatsappMessage: "  Oi   {produto}  " });
    expect(ok).toEqual({ ok: true, value: expect.objectContaining({ enabled: true, whatsappNumber: "5511912345678", whatsappMessage: "Oi {produto}" }) });
  });
});

describe("regras dos selos", () => {
  const c = { ...PADRAO, enabled: true, lowStockMax: 3, whatsappEnabled: true, whatsappNumber: "5511912345678" };
  const p = { nome: "Vestido Azul", estoque: 2 as number | null, ilimitado: false, promoAte: null as string | null };

  it("últimas unidades: só com estoque controlado de 1 até o limite", () => {
    expect(montarSelos(c, p).ultimas).toBe(true);
    expect(montarSelos(c, { ...p, estoque: 3 }).ultimas).toBe(true);
    expect(montarSelos(c, { ...p, estoque: 4 }).ultimas).toBeUndefined();
    expect(montarSelos(c, { ...p, estoque: 0 }).ultimas).toBeUndefined();
    expect(montarSelos(c, { ...p, estoque: null }).ultimas).toBeUndefined();
    expect(montarSelos(c, { ...p, ilimitado: true }).ultimas).toBeUndefined(); // uma variação sem controle: não dá para dizer "últimas"
    expect(montarSelos({ ...c, lowStockEnabled: false }, p).ultimas).toBeUndefined();
  });

  it("contagem e WhatsApp só quando ligados", () => {
    const fim = "2026-10-20T12:00:00.000Z";
    expect(montarSelos(c, { ...p, promoAte: fim }).promoAte).toBe(fim);
    expect(montarSelos({ ...c, countdownEnabled: false }, { ...p, promoAte: fim }).promoAte).toBeUndefined();
    expect(montarSelos(c, p).whatsapp).toEqual({ numero: "5511912345678", texto: "Olá! Tenho interesse em Vestido Azul." });
    expect(montarSelos({ ...c, whatsappEnabled: false }, p).whatsapp).toBeUndefined();
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (777, 'x') RETURNING id")).rows[0]!.id;
});

const produto = (id: number, handle: string, over: Partial<Product> = {}, stocks: Array<{ stock: number | null; manage: boolean }> = [{ stock: 2, manage: true }]): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  handle: { pt: handle },
  published: true,
  variants: stocks.map((s, i) => ({ id: id * 10 + i, product_id: id, sku: `S${id}${i}`, price: "100.00", stock_management: s.manage, stock: s.stock, values: [{ pt: "U" }] })),
  updated_at: "2026-10-01T10:00:00+0000",
  ...over,
});

describe("selos de um produto (banco)", () => {
  it("só responde com a loja conhecida, selos ligados e produto publicado", async () => {
    await upsertProducts(db, storeId, [produto(1, "vestido-azul"), produto(2, "saia-preta", { published: false })]);
    expect(await selosPorHandle(db, "777", "vestido-azul")).toBeNull(); // desligado (padrão)
    await salvarConfig(db, storeId, { ...PADRAO, enabled: true }, "a@b.c");
    expect(await selosPorHandle(db, "777", "vestido-azul")).toMatchObject({ v: 1, nome: "Produto 1", ultimas: true });
    expect(await selosPorHandle(db, "777", "saia-preta")).toBeNull(); // não publicado
    expect(await selosPorHandle(db, "999", "vestido-azul")).toBeNull(); // loja desconhecida
    expect(await selosPorHandle(db, "777", "nao-existe")).toBeNull();
    expect(await selosPorHandle(db, "777", "../etc/passwd")).toBeNull();
    expect(await selosPorHandle(db, "abc", "vestido-azul")).toBeNull();
    expect(await selosPorHandle(db, "777", "A".repeat(10))).toBeNull(); // maiúsculas não passam (a rota já baixa a caixa)
  });

  it("soma o estoque das variações e ignora produto com variação sem controle", async () => {
    await upsertProducts(db, storeId, [
      produto(1, "dois-tamanhos", {}, [{ stock: 1, manage: true }, { stock: 2, manage: true }]),
      produto(2, "muito-estoque", {}, [{ stock: 2, manage: true }, { stock: 9, manage: true }]),
      produto(3, "sem-controle", {}, [{ stock: 1, manage: true }, { stock: null, manage: false }]),
    ]);
    await salvarConfig(db, storeId, { ...PADRAO, enabled: true }, "a");
    expect((await selosPorHandle(db, "777", "dois-tamanhos"))?.ultimas).toBe(true);
    expect((await selosPorHandle(db, "777", "muito-estoque"))?.ultimas).toBeUndefined();
    expect((await selosPorHandle(db, "777", "sem-controle"))?.ultimas).toBeUndefined();
  });

  it("contagem: só promoção ativa que ainda não acabou e que inclui o produto", async () => {
    await upsertProducts(db, storeId, [produto(1, "a"), produto(2, "b")]);
    await salvarConfig(db, storeId, { ...PADRAO, enabled: true, lowStockEnabled: false }, "a");
    const promo = (status: string, fimEmHoras: number, ids: number[]) =>
      pg.query(`INSERT INTO promotions (store_id, nome, operation, product_ids, starts_at, ends_at, status, created_by) VALUES ($1, 'p', '{}'::jsonb, $2::bigint[], now() - interval '2 days', now() + ($3 || ' hours')::interval, $4, 'a')`, [storeId, `{${ids.join(",")}}`, String(fimEmHoras), status]);
    await promo("ativa", 5, [1]);
    await promo("agendada", 9, [2]);
    const r = await selosPorHandle(db, "777", "a");
    expect(new Date(r!.promoAte!).getTime() - Date.now()).toBeGreaterThan(4.9 * 3600_000);
    expect((await selosPorHandle(db, "777", "b"))?.promoAte).toBeUndefined(); // agendada ainda não vale
  });

  it("guarda e lê a configuração", async () => {
    expect(await obterConfig(db, storeId)).toEqual(PADRAO);
    await salvarConfig(db, storeId, { ...PADRAO, enabled: true, lowStockMax: 5, whatsappEnabled: true, whatsappNumber: "5511912345678" }, "a");
    expect(await obterConfig(db, storeId)).toMatchObject({ enabled: true, lowStockMax: 5, whatsappNumber: "5511912345678" });
    expect(acaoLabel("selos.configurar")).toMatch(/Selos/);
  });
});

describe("script da vitrine", () => {
  it("não usa innerHTML nem eval e engole erros", () => {
    expect(SCRIPT_SELOS).not.toMatch(/innerHTML|outerHTML|eval\(|document\.write|insertAdjacentHTML/);
    expect(SCRIPT_SELOS).toMatch(/catch/);
  });

  /** DOM mínimo para rodar o script de verdade. */
  function rodar(opts: { pathname: string; resposta: unknown; anchor?: boolean; src?: string }) {
    const criados: Array<{ tag: string; textContent: string; style: { cssText: string }; children: unknown[]; href?: string; rel?: string; id?: string }> = [];
    const mk = (tag: string) => {
      const n: Record<string, unknown> = { tag, textContent: "", style: { cssText: "" }, children: [] as unknown[], appendChild(c: unknown) { (n.children as unknown[]).push(c); } };
      criados.push(n as never);
      return n;
    };
    let inserido: unknown = null;
    const pai = { insertBefore: (n: unknown) => void (inserido = n) };
    const doc = {
      currentScript: { src: opts.src ?? "https://painel.example/api/loja/selos.js?store=777" },
      getElementById: () => null,
      createElement: mk,
      querySelector: (sel: string) => (opts.anchor !== false && sel === ".js-addtocart" ? { parentNode: pai } : null),
    };
    const pedidos: string[] = [];
    const fetchFalso = (url: string) => (pedidos.push(url), Promise.resolve({ ok: true, json: () => Promise.resolve(opts.resposta) }));
    new Function("document", "location", "fetch", "window", "setInterval", "clearInterval", "URL", "encodeURIComponent", "decodeURIComponent", SCRIPT_SELOS)(
      doc,
      { pathname: opts.pathname, href: `https://loja.example${opts.pathname}` },
      fetchFalso,
      {},
      () => 1,
      () => undefined,
      URL,
      encodeURIComponent,
      decodeURIComponent,
    );
    return { criados, pedidos, inserido: () => inserido };
  }
  const espera = () => new Promise((r) => setTimeout(r, 5));

  it("em página de produto pede os selos ao painel e desenha com textContent", async () => {
    const r = rodar({ pathname: "/produtos/Vestido-Azul/", resposta: { v: 1, ultimas: true, whatsapp: { numero: "5511912345678", texto: "Oi <b>x</b>" } } });
    await espera();
    expect(r.pedidos).toEqual(["https://painel.example/api/loja/selos?s=777&h=vestido-azul"]);
    const textos = r.criados.map((n) => n.textContent);
    expect(textos).toContain("Últimas unidades!");
    const link = r.criados.find((n) => n.tag === "a")!;
    expect(link.href).toBe("https://wa.me/5511912345678?text=Oi%20%3Cb%3Ex%3C%2Fb%3E%20https%3A%2F%2Floja.example%2Fprodutos%2FVestido-Azul%2F");
    expect(link.rel).toBe("noopener noreferrer");
    expect(r.inserido()).not.toBeNull();
  });

  it("fora de página de produto não pede nada; resposta vazia não desenha; número estranho não vira link", async () => {
    expect(rodar({ pathname: "/carrinho", resposta: {} }).pedidos).toEqual([]);
    const vazio = rodar({ pathname: "/produtos/x/", resposta: {} });
    await espera();
    expect(vazio.criados.filter((n) => n.tag === "div")).toEqual([]);
    const ruim = rodar({ pathname: "/produtos/x/", resposta: { v: 1, whatsapp: { numero: "javascript:alert(1)", texto: "x" } } });
    await espera();
    expect(ruim.criados.filter((n) => n.tag === "a")).toEqual([]);
  });
});
