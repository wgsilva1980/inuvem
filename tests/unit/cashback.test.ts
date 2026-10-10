import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { LIMITES, PRECISA_CONFERIR, sinaisDeRisco, sinaisDoPedido } from "@/lib/risk/signals";
import { PADRAO, cabeNoOrcamento, mensagemDoCashback, validarConfig, valorDoCashback } from "@/lib/cashback/rules";
import { gastoDoMes, listarGrants, obterConfig, pedidosElegiveis, salvarConfig } from "@/lib/cashback/repo";
import { cancelarCupom, contatoDoPedido, emitirCashback, mensagemDoCupom, situacaoDosCupons } from "@/lib/cashback/service";
import { acaoLabel } from "@/lib/history/labels";

describe("regras do cashback (puras)", () => {
  it("valor: percentual para baixo em reais inteiros, com teto e mínimo de R$ 1", () => {
    expect(valorDoCashback(200, { percent: 5, maxValue: 100 })).toBe(10);
    expect(valorDoCashback(259.9, { percent: 5, maxValue: 100 })).toBe(12); // 12,99 -> 12
    expect(valorDoCashback(5000, { percent: 5, maxValue: 100 })).toBe(100);
    expect(valorDoCashback(10, { percent: 5, maxValue: 100 })).toBe(1);
  });

  it("valida os limites das regras", () => {
    const base = { ...PADRAO };
    expect(validarConfig({ ...base })).toMatchObject({ ok: true });
    expect(validarConfig({ ...base, percent: 0 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, percent: 31 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, maxValue: 0.5 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, validDays: 0 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, validDays: 366 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, waitDays: 1.5 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, monthBudget: -1 })).toMatchObject({ ok: false });
    expect(validarConfig({ ...base, percent: "7,5", monthBudget: "1000,00" })).toEqual({ ok: true, value: expect.objectContaining({ percent: 7.5, monthBudget: 1000 }) });
  });

  it("orçamento é conta de centavos e a mensagem usa os números reais", () => {
    expect(cabeNoOrcamento(490, 10, { monthBudget: 500 })).toBe(true);
    expect(cabeNoOrcamento(490, 10.01, { monthBudget: 500 })).toBe(false);
    const m = mensagemDoCashback({ primeiroNome: "Ana", codigo: "CASHABC234", valor: 12, validade: "30/11/2026", compraMinima: 150 });
    expect(m).toMatch(/Oi, Ana!/);
    expect(m).toMatch(/CASHABC234/);
    expect(m).toMatch(/R\$\s?12,00/);
    expect(m).toMatch(/até 30\/11\/2026/);
    expect(m).toMatch(/a partir de R\$\s?150,00/);
    expect(mensagemDoCashback({ primeiroNome: null, codigo: "C", valor: 5, validade: "x", compraMinima: 0 })).not.toMatch(/a partir de/);
  });
});

describe("sinais de risco (puros)", () => {
  const base = { total: 200, desconto: 0, clienteConhecida: true, maiorQuantidade: 1 };
  const ctx = { mediana: 150, anteriores: 2, em24h: 1 };
  it("não destaca um pedido comum", () => expect(sinaisDoPedido(base, ctx)).toEqual([]));
  it("cada regra dispara no seu limite", () => {
    expect(sinaisDoPedido({ ...base, total: 450 }, { ...ctx, anteriores: 0 })[0]).toMatch(/Primeira compra de valor alto/);
    expect(sinaisDoPedido({ ...base, total: 449 }, { ...ctx, anteriores: 0 })).toEqual([]);
    expect(sinaisDoPedido({ ...base, total: 450 }, { ...ctx, anteriores: 1 })).toEqual([]); // já comprou antes
    expect(sinaisDoPedido({ ...base, total: 450 }, { mediana: null, anteriores: 0, em24h: 1 })).toEqual([]); // poucos pedidos: sem mediana
    expect(sinaisDoPedido(base, { ...ctx, em24h: LIMITES.pedidosEm24h })[0]).toMatch(/3 pedidos da mesma cliente/);
    expect(sinaisDoPedido({ ...base, total: 100, desconto: 100 }, ctx)[0]).toMatch(/Desconto de 50%/);
    expect(sinaisDoPedido({ ...base, maiorQuantidade: 5 }, ctx)[0]).toMatch(/5 unidades da mesma peça/);
    expect(sinaisDoPedido({ ...base, clienteConhecida: false, total: 450 }, { ...ctx, anteriores: 0, em24h: 9 })).toEqual([]); // sem cliente identificada, só as regras do pedido
  });
  it("dois sinais pedem conferência", () => {
    expect(sinaisDoPedido({ ...base, maiorQuantidade: 6, total: 100, desconto: 120 }, ctx)).toHaveLength(PRECISA_CONFERIR);
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const pedido = (id: number, over: Record<string, unknown> = {}, linhas = [{ product_id: 1, variant_id: 1, quantity: 1, price: "100" }]): Order =>
  ({ id, number: 1000 + id, created_at: diasAtras(10), total: "200.00", discount: "0", status: "open", payment_status: "paid", shipping_status: "delivered", customer: { id: 500 + id, name: "Ana Souza", email: "ana@x.com", phone: "11912345678" }, products: linhas, ...over }) as unknown as Order;
const gravar = (os: Order[]) => gravarPedidos(db, storeId, os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));

describe("pedidos elegíveis", () => {
  it("só pagos, não cancelados, com valor mínimo, depois da espera e dentro de 60 dias", async () => {
    await gravar([
      pedido(1),
      pedido(2, { payment_status: "pending" }),
      pedido(3, { status: "cancelled" }),
      pedido(4, { total: "149.99" }),
      pedido(5, { created_at: diasAtras(3) }), // ainda na espera de 7 dias
      pedido(6, { created_at: diasAtras(61) }), // velho demais
      pedido(7, { customer: null }), // sem cliente identificada
    ]);
    const r = await pedidosElegiveis(db, storeId, PADRAO);
    expect(r.map((p) => p.numero)).toEqual([1001]);
    expect(r[0]).toMatchObject({ valor: 10, retido: false });
  });

  it("uma cliente com dois pedidos aparece uma vez; quem já ganhou cupom há pouco fica de fora (cancelado libera)", async () => {
    await gravar([pedido(1, { customer: { id: 9 } }), pedido(2, { customer: { id: 9 }, created_at: diasAtras(9) })]);
    expect((await pedidosElegiveis(db, storeId, PADRAO)).map((p) => p.numero)).toEqual([1001]); // o mais antigo (10 dias) primeiro; o outro pedido da mesma cliente espera
    await pg.query(`INSERT INTO cashback_grants (store_id, order_id, coupon_id, coupon_code, value, expires_on, issued_by) VALUES ($1, 1, 1, 'CASHX', 10, current_date + 30, 'a')`, [storeId]);
    expect(await pedidosElegiveis(db, storeId, PADRAO)).toEqual([]); // o pedido 1 já recebeu; o 2 é da mesma cliente
    await pg.query(`UPDATE cashback_grants SET cancelled_at = now()`);
    expect((await pedidosElegiveis(db, storeId, PADRAO)).map((p) => p.numero)).toEqual([1002]); // cupom cancelado libera a cliente
  });

  it("pedido com dois sinais de risco fica retido", async () => {
    await gravar([pedido(1, { total: "100", discount: "120" }, [{ product_id: 1, variant_id: 1, quantity: 6, price: "10" }])]);
    const r = await pedidosElegiveis(db, storeId, { ...PADRAO, minOrder: 50 });
    expect(r[0]).toMatchObject({ retido: true });
    expect(r[0]!.sinais.length).toBeGreaterThanOrEqual(2);
  });

  it("risco no banco: primeira compra alta, vários pedidos em 24 h", async () => {
    const comuns = Array.from({ length: 25 }, (_, i) => pedido(100 + i, { total: "100", customer: { id: 1000 + i }, created_at: diasAtras(20 + i) }));
    await gravar([...comuns, pedido(1, { total: "400", customer: { id: 77 } })]);
    expect([...(await sinaisDeRisco(db, storeId, ["1"])).get("1") ?? []][0]).toMatch(/Primeira compra de valor alto/);
    await gravar([pedido(2, { customer: { id: 78 }, created_at: diasAtras(2) }), pedido(3, { customer: { id: 78 }, created_at: diasAtras(2) }), pedido(4, { customer: { id: 78 }, created_at: diasAtras(2) })]);
    expect((await sinaisDeRisco(db, storeId, ["3"])).get("3")?.join(" ")).toMatch(/3 pedidos da mesma cliente em 24 horas/);
    expect((await sinaisDeRisco(db, storeId, ["100"])).size).toBe(0);
  });
});

/** Loja falsa: pedidos, cupons e as chamadas feitas. */
function lojaFalsa(opts: { pedidos?: Record<number, Order>; falhaCupom?: NuvemshopError } = {}) {
  const cupons: Array<Record<string, unknown>> = [];
  const puts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let proximo = 900;
  const client = {
    get: async (path: string) => {
      const id = Number(path.split("/").pop());
      const p = opts.pedidos?.[id];
      if (!p) throw new NuvemshopError("404", 404, null);
      return structuredClone(p);
    },
    post: async (path: string, body: Record<string, unknown>) => {
      if (opts.falhaCupom) throw opts.falhaCupom;
      expect(path).toBe("/coupons");
      const c = { ...body, id: proximo++, used: 0 };
      cupons.push(c);
      return structuredClone(c);
    },
    put: async (path: string, body: Record<string, unknown>) => {
      puts.push({ path, body });
      const id = Number(path.split("/").pop());
      const c = cupons.find((x) => x.id === id);
      if (c) Object.assign(c, body);
      return structuredClone(c ?? { id, code: "X" });
    },
    getPage: async () => ({ items: structuredClone(cupons), total: cupons.length, nextPage: null }),
  } as unknown as NuvemshopClient;
  return { client, cupons, puts };
}

describe("emitir cashback", () => {
  it("cria o cupom (valor fixo, uso único, validade e compra mínima), grava, audita e conta no orçamento", async () => {
    const os = [pedido(1)];
    await gravar(os);
    const loja = lojaFalsa({ pedidos: { 1: os[0]! } });
    const r = await emitirCashback(db, loja.client, { storeId, actor, ids: ["1"] });
    expect(r).toEqual([{ orderId: "1", ok: true, codigo: expect.stringMatching(/^CASH[A-Z2-9]{6}$/), valor: 10 }]);
    expect(loja.cupons[0]).toMatchObject({ type: "absolute", value: "10.00", valid: true, max_uses: 1, min_price: "150.00", first_consumer_purchase: false, combines_with_other_discounts: false });
    expect(await gastoDoMes(db, storeId)).toBe(10);
    expect((await listarGrants(db, storeId))[0]).toMatchObject({ order_number: 1001, coupon_id: "900" });
    expect((await pg.query("SELECT acao, depois FROM audit_log WHERE acao = 'cashback.emitir'")).rows).toHaveLength(1);
    expect(JSON.stringify((await pg.query("SELECT depois FROM audit_log")).rows)).not.toMatch(/Ana|ana@x|11912345678/); // nenhum dado pessoal no Histórico
    // emitir de novo o mesmo pedido: não é mais elegível, nada novo na loja
    const de_novo = await emitirCashback(db, loja.client, { storeId, actor, ids: ["1"] });
    expect(de_novo[0]).toMatchObject({ ok: false, erro: expect.stringMatching(/não é mais elegível/) });
    expect(loja.cupons).toHaveLength(1);
    expect(acaoLabel("cashback.emitir")).toMatch(/cashback/i);
  });

  it("respeita o orçamento do mês e para os seguintes", async () => {
    const os = [pedido(1), pedido(2), pedido(3)];
    await gravar(os);
    await salvarConfig(db, storeId, { ...PADRAO, monthBudget: 25 }, actor);
    const loja = lojaFalsa({ pedidos: Object.fromEntries(os.map((o) => [o.id, o])) });
    const r = await emitirCashback(db, loja.client, { storeId, actor, ids: ["1", "2", "3"] });
    expect(r.map((x) => x.ok)).toEqual([true, true, false]); // 10 + 10 = 20; o terceiro passaria de 25
    expect(r[2]!.erro).toMatch(/orçamento/);
    expect(await gastoDoMes(db, storeId)).toBe(20);
  });

  it("não emite para pedido retido, nem se a loja diz que o pedido não está mais pago", async () => {
    const retido = pedido(1, { total: "100", discount: "120" }, [{ product_id: 1, variant_id: 1, quantity: 6, price: "10" }]);
    const cancelado = pedido(2);
    await gravar([retido, cancelado]);
    await salvarConfig(db, storeId, { ...PADRAO, minOrder: 50 }, actor);
    const loja = lojaFalsa({ pedidos: { 1: retido, 2: { ...cancelado, status: "cancelled" } as Order } });
    const r = await emitirCashback(db, loja.client, { storeId, actor, ids: ["1", "2"] });
    expect(r[0]!.erro).toMatch(/Retido para conferência/);
    expect(r[1]!.erro).toMatch(/já não está pago/);
    expect(loja.cupons).toEqual([]);
    expect(await listarGrants(db, storeId)).toEqual([]);
  });

  it("sem permissão para cupons: para e não grava", async () => {
    const os = [pedido(1), pedido(2)];
    await gravar(os);
    const loja = lojaFalsa({ pedidos: { 1: os[0]!, 2: os[1]! }, falhaCupom: new NuvemshopError("403", 403, null) });
    const r = await emitirCashback(db, loja.client, { storeId, actor, ids: ["1", "2"] });
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(r[1]!.erro).toMatch(/permitiu/);
    expect(await listarGrants(db, storeId)).toEqual([]);
  });

  it("limita a 5 pedidos por chamada", async () => {
    const os = Array.from({ length: 7 }, (_, i) => pedido(i + 1));
    await gravar(os);
    await salvarConfig(db, storeId, { ...PADRAO, monthBudget: 1000 }, actor);
    const loja = lojaFalsa({ pedidos: Object.fromEntries(os.map((o) => [o.id, o])) });
    const r = await emitirCashback(db, loja.client, { storeId, actor, ids: os.map((o) => String(o.id)) });
    expect(r).toHaveLength(5);
  });
});

describe("depois de emitir", () => {
  async function emitido() {
    const o = pedido(1);
    await gravar([o]);
    const loja = lojaFalsa({ pedidos: { 1: o } });
    await emitirCashback(db, loja.client, { storeId, actor, ids: ["1"] });
    return { o, loja };
  }

  it("mensagem: nome e contato vêm do pedido na loja agora e nada é guardado", async () => {
    const { loja } = await emitido();
    const m = await mensagemDoCupom(db, loja.client, { storeId, orderId: "1" });
    expect(m.mensagem).toMatch(/Oi, Ana!/);
    expect(m.mensagem).toMatch(/CASH[A-Z2-9]{6}/);
    expect(m.whatsapp).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=/);
    expect(m.email).toMatch(/^mailto:ana@x\.com/);
    expect(JSON.stringify((await pg.query("SELECT * FROM cashback_grants")).rows)).not.toMatch(/Ana|ana@x|912345678/);
  });

  it("contato sem telefone nem e-mail devolve null nos links", () => {
    expect(contatoDoPedido({ id: 1, customer: { id: 1 } } as unknown as Order)).toEqual({ primeiroNome: null, whatsapp: null, email: null });
  });

  it("situação lida da loja: ativo, usado, e cancelado vem do banco", async () => {
    const { loja } = await emitido();
    let g = await listarGrants(db, storeId);
    expect((await situacaoDosCupons(loja.client, g)).porPedido.get("1")).toEqual({ situacao: "ativo", usado: false });
    loja.cupons[0]!.used = 1;
    expect((await situacaoDosCupons(loja.client, g)).porPedido.get("1")).toEqual({ situacao: "esgotado", usado: true });
    await cancelarCupom(db, loja.client, { storeId, actor, orderId: "1" });
    expect(loja.puts[0]).toMatchObject({ path: "/coupons/900", body: { valid: false } });
    g = await listarGrants(db, storeId);
    expect((await situacaoDosCupons(loja.client, g)).porPedido.get("1")?.situacao).toBe("cancelado");
    expect(await gastoDoMes(db, storeId)).toBe(0); // cancelado sai do orçamento
    await cancelarCupom(db, loja.client, { storeId, actor, orderId: "1" }); // idempotente
    expect(loja.puts).toHaveLength(1);
  });

  it("guarda e lê as regras", async () => {
    expect(await obterConfig(db, storeId)).toEqual(PADRAO);
    await salvarConfig(db, storeId, { ...PADRAO, percent: 7.5, monthBudget: 1000 }, actor);
    expect(await obterConfig(db, storeId)).toMatchObject({ percent: 7.5, monthBudget: 1000 });
  });
});
