import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { checkoutSchema, type Checkout } from "@/lib/nuvemshop/checkouts";
import { carrinhosParaTrabalhar, idadeTexto, linkEmail, linkWhatsapp, normalizarCarrinho } from "@/lib/carts/logic";
import { completarMensagem, criarGeradorMensagem, mensagemPadrao } from "@/lib/carts/message";
import { CarrinhoNaoEncontradoError, contatosDosCarrinhos, listarCarrinhos, marcarContatado, prepararMensagem } from "@/lib/carts/service";
import { acaoLabel } from "@/lib/history/labels";

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

const minAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const checkout = (id: number, over: Record<string, unknown> = {}): Checkout =>
  checkoutSchema.parse({
    id,
    contact_name: "maria SOUZA",
    contact_email: "Maria@X.com",
    contact_phone: "+55 (11) 98888-7777",
    total: "199.80",
    created_at: minAtras(120),
    abandoned_checkout_url: `https://loja.com/checkout/${id}`,
    products: [{ product_id: 1, name: { pt: "Vestido Azul" }, quantity: 2, price: "99.90" }],
    ...over,
  });

describe("carrinho normalizado", () => {
  it("nome, WhatsApp com DDI, peças e link; ignora o que não dá para contatar", () => {
    const c = normalizarCarrinho(checkout(1))!;
    expect(c).toMatchObject({ id: 1, nome: "maria SOUZA", primeiroNome: "Maria", email: "maria@x.com", whatsapp: "5511988887777", total: 199.8, url: "https://loja.com/checkout/1" });
    expect(c.itens).toEqual([{ nome: "Vestido Azul", quantidade: 2, preco: 99.9 }]);
    expect(normalizarCarrinho(checkout(2, { completed_at: minAtras(5) }))).toBeNull(); // concluído
    expect(normalizarCarrinho(checkout(3, { created_at: "ontem" }))).toBeNull();
    expect(normalizarCarrinho(checkout(4, { contact_phone: null, contact_email: null }))).toBeNull(); // sem contato
    expect(normalizarCarrinho(checkout(5, { contact_phone: "123" }))!.whatsapp).toBeNull(); // só e-mail
    expect(normalizarCarrinho(checkout(6, { abandoned_checkout_url: "javascript:alert(1)" }))!.url).toBeNull(); // só https
    expect(normalizarCarrinho(checkout(7, { total: null }))!.total).toBe(199.8); // soma dos itens
    expect(normalizarCarrinho(checkout(8, { contact_name: null }))!.primeiroNome).toBeNull();
  });

  it("links do WhatsApp e do e-mail levam o texto codificado", () => {
    expect(linkWhatsapp("5511988887777", "Oi, tudo bem?\nLink: https://x.com/a?b=1")).toBe("https://wa.me/5511988887777?text=Oi%2C%20tudo%20bem%3F%0ALink%3A%20https%3A%2F%2Fx.com%2Fa%3Fb%3D1");
    expect(linkEmail("a@b.com", "Seu carrinho", "Oi & tchau")).toBe("mailto:a@b.com?subject=Seu%20carrinho&body=Oi%20%26%20tchau");
  });

  it("idade em minutos, horas e dias", () => {
    const agora = Date.parse("2026-10-10T12:00:00Z");
    expect(idadeTexto("2026-10-10T11:40:00Z", agora)).toBe("20 min");
    expect(idadeTexto("2026-10-10T09:00:00Z", agora)).toBe("3 h");
    expect(idadeTexto("2026-10-07T12:00:00Z", agora)).toBe("3 dias");
  });

  it("para trabalhar: espera a cliente parar, descarta o muito velho, uma vez por cliente (o mais recente), do mais valioso", () => {
    const agora = Date.now();
    const mk = (id: number, minutos: number, over: Record<string, unknown> = {}) => normalizarCarrinho(checkout(id, { created_at: minAtras(minutos), ...over }))!;
    const lista = [
      mk(1, 10), // ainda comprando
      mk(2, 120, { contact_phone: "11 97777-0001", contact_email: "a@a.com", total: "50.00", products: [] }),
      mk(3, 200, { contact_phone: "11 97777-0001", contact_email: "a@a.com", total: "500.00", products: [] }), // mesma cliente que o 2, mais antigo
      mk(4, 300, { contact_phone: "11 97777-0002", contact_email: "b@b.com", total: "300.00", products: [] }),
      mk(5, 20 * 24 * 60, { contact_phone: "11 97777-0003", contact_email: "c@c.com" }), // 20 dias: velho demais
    ];
    const r = carrinhosParaTrabalhar(lista, { minMinutos: 60, maxDias: 14, agora });
    expect(r.map((c) => c.id)).toEqual([4, 2]); // 4 vale 300; da cliente "a" fica o 2 (mais recente)
  });
});

describe("mensagem", () => {
  const c = normalizarCarrinho(checkout(1))!;
  const cupom = { codigo: "VOLTEABC123", percent: 10, validade: "válido até 13/10" };

  it("completa o link do carrinho e o cupom que a mensagem esqueceu", () => {
    const m = completarMensagem("Oi, Maria! Posso ajudar?", c, cupom);
    expect(m).toContain("VOLTEABC123");
    expect(m).toContain("https://loja.com/checkout/1");
    // não duplica o que já está
    const ja = completarMensagem("Oi! Use VOLTEABC123 e volte em https://loja.com/checkout/1", c, cupom);
    expect(ja.match(/VOLTEABC123/g)).toHaveLength(1);
    expect(ja.match(/checkout\/1/g)).toHaveLength(1);
  });

  it("texto padrão sem IA", () => {
    const m = mensagemPadrao(c, null);
    expect(m).toContain("Oi, Maria!");
    expect(m).toContain("Vestido Azul");
    expect(m).toContain(c.url!);
  });

  it("o gerador real manda ao Claude só primeiro nome, peças, link e cupom (sem telefone, e-mail nem valores)", async () => {
    const pedidos: Array<Record<string, any>> = [];
    const client = { beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify({ mensagem: "Oi, Maria!" }) }] }) } } } as never;
    const m = await criarGeradorMensagem(client)(c, cupom);
    const enviado = pedidos[0]!.messages[0].content[0].text as string;
    expect(JSON.parse(enviado)).toMatchObject({ primeiro_nome: "Maria", pecas: [{ nome: "Vestido Azul", quantidade: 2 }], link_do_carrinho: c.url, cupom: { codigo: "VOLTEABC123" } });
    expect(enviado).not.toMatch(/5511|maria@|199|99\.9/i);
    expect(m).toContain("VOLTEABC123");
  });
});

describe("serviço", () => {
  function clienteFalso(opts: { checkouts?: unknown[]; porId?: Record<number, unknown>; falhasCupom?: number } = {}) {
    const posts: Array<Record<string, any>> = [];
    let falhas = opts.falhasCupom ?? 0;
    const client = {
      getPage: async () => ({ items: opts.checkouts ?? [], total: (opts.checkouts ?? []).length, nextPage: null }),
      get: async (path: string) => {
        const id = Number(path.split("/").pop());
        if (!opts.porId?.[id]) throw new NuvemshopError("404", 404, null);
        return opts.porId[id];
      },
      post: async (_p: string, body: Record<string, any>) => {
        if (falhas-- > 0) throw new NuvemshopError("422", 422, null, "já existe");
        posts.push(body);
        return { id: 900 + posts.length, code: body.code };
      },
    } as unknown as NuvemshopClient;
    return { client, posts };
  }
  const args = { storeId: "" as string, actor: "admin@x.com" };

  it("lista só os carrinhos que dá para contatar", async () => {
    const { client } = clienteFalso({ checkouts: [checkout(1), checkout(2, { completed_at: minAtras(1) }), { id: "x" }] });
    const r = await listarCarrinhos(client);
    expect(r.carrinhos.map((c) => c.id)).toEqual([1]);
    expect(r.campos).toContain("contact_name");
  });

  it("monta a mensagem sem cupom (texto padrão quando não há gerador) e devolve os links", async () => {
    const { client, posts } = clienteFalso({ porId: { 1: checkout(1) } });
    const r = await prepararMensagem(db, client, { ...args, storeId, id: 1, gerador: null });
    expect(posts).toEqual([]);
    expect(r).toMatchObject({ cupom: null, geradaPorIa: false });
    expect(r.whatsapp).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
    expect(r.email).toMatch(/^mailto:maria@x\.com\?subject=/);
  });

  it("cria o cupom de cortesia (1 uso, validade), guarda o código no carrinho, registra no Histórico e reaproveita nas próximas vezes", async () => {
    const { client, posts } = clienteFalso({ porId: { 1: checkout(1) } });
    const gerador = async (_c: unknown, cupom: { codigo: string } | null) => `Oi! Use ${cupom?.codigo}`;
    const r = await prepararMensagem(db, client, { ...args, storeId, id: 1, cupom: { percent: 12, dias: 3 }, gerador });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ type: "percentage", value: "12.00", valid: true, max_uses: 1, combines_with_other_discounts: false });
    expect(posts[0]!.code).toMatch(/^VOLTE[A-Z2-9]{6}$/);
    expect(r.cupom).toMatchObject({ codigo: posts[0]!.code, percent: 12 });
    expect(r.cupom!.validade).toMatch(/^válido até \d{2}\/\d{2}$/);
    expect(r.mensagem).toContain(posts[0]!.code);
    expect((await contatosDosCarrinhos(db, storeId, [1])).get(1)).toMatchObject({ cupom: posts[0]!.code, contatadoEm: null });
    expect((await pg.query<{ acao: string; depois: Record<string, unknown> }>("SELECT acao, depois FROM audit_log")).rows).toEqual([{ acao: "carrinho.cupom", depois: { codigo: posts[0]!.code, percent: 12, validade: expect.any(String) } }]);

    const de_novo = await prepararMensagem(db, client, { ...args, storeId, id: 1, cupom: { percent: 12, dias: 3 }, gerador });
    expect(posts).toHaveLength(1); // não criou outro
    expect(de_novo.cupom!.codigo).toBe(posts[0]!.code);
  });

  it("tenta outro código se a loja recusar o primeiro, e desiste (sem guardar nada) se recusar sempre", async () => {
    const a = clienteFalso({ porId: { 1: checkout(1) }, falhasCupom: 2 });
    const r = await prepararMensagem(db, a.client, { ...args, storeId, id: 1, cupom: { percent: 10, dias: 2 }, gerador: null });
    expect(a.posts).toHaveLength(1);
    expect(r.cupom).not.toBeNull();

    const b = clienteFalso({ porId: { 2: checkout(2) }, falhasCupom: 9 });
    await expect(prepararMensagem(db, b.client, { ...args, storeId, id: 2, cupom: { percent: 10, dias: 2 }, gerador: null })).rejects.toThrow(NuvemshopError);
    expect((await contatosDosCarrinhos(db, storeId, [2])).size).toBe(0);
  });

  it("carrinho que não existe mais ou já foi concluído dá erro claro", async () => {
    const { client } = clienteFalso({ porId: { 3: checkout(3, { completed_at: minAtras(1) }) } });
    await expect(prepararMensagem(db, client, { ...args, storeId, id: 99, gerador: null })).rejects.toThrow(CarrinhoNaoEncontradoError);
    await expect(prepararMensagem(db, client, { ...args, storeId, id: 3, gerador: null })).rejects.toThrow(CarrinhoNaoEncontradoError);
  });

  it("marcar e desmarcar como contatado, sem apagar o cupom já gerado, e registrar no Histórico", async () => {
    await pg.query("INSERT INTO cart_contacts (store_id, checkout_id, coupon_code) VALUES ($1, 1, 'VOLTEXYZ')", [storeId]);
    await marcarContatado(db, { storeId, actor: "ana@x.com", id: 1, contatado: true });
    expect((await contatosDosCarrinhos(db, storeId, [1])).get(1)).toMatchObject({ por: "ana@x.com", cupom: "VOLTEXYZ" });
    expect((await contatosDosCarrinhos(db, storeId, [1])).get(1)!.contatadoEm).not.toBeNull();
    await marcarContatado(db, { storeId, actor: "ana@x.com", id: 1, contatado: false });
    expect((await contatosDosCarrinhos(db, storeId, [1])).get(1)).toMatchObject({ contatadoEm: null, por: null, cupom: "VOLTEXYZ" });
    await marcarContatado(db, { storeId, actor: "ana@x.com", id: 2, contatado: true }); // carrinho sem linha anterior
    expect((await contatosDosCarrinhos(db, storeId, [2])).get(2)!.contatadoEm).not.toBeNull();
    expect(acaoLabel("carrinho.contatar")).toBe("Carrinho abandonado marcado como contatado");
    expect(acaoLabel("carrinho.cupom")).toBe("Cupom de recuperação criado para um carrinho");
  });
});
