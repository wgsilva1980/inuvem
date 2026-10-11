import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { dadosDoMes, enviarRelatorioMensal, mesAnterior, mesDe, montarRelatorioMensal, relatorioDoMes, variacao } from "@/lib/digest/mensal";
import { obterConfigResumo, salvarConfigResumo } from "@/lib/digest/service";
import { acaoLabel } from "@/lib/history/labels";

describe("meses", () => {
  it("mês anterior ao dia de hoje, com virada de ano e fevereiro bissexto", () => {
    expect(mesAnterior("2026-10-01")).toEqual({ chave: "2026-09", rotulo: "setembro de 2026", periodo: { de: "2026-09-01", ate: "2026-09-30" } });
    expect(mesAnterior("2026-01-15").periodo).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
    expect(mesAnterior("2028-03-02").periodo).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
    expect(mesDe(2026, 12).periodo.ate).toBe("2026-12-31");
  });
  it("variação percentual; sem base não compara", () => {
    expect(variacao(300, 100)).toBe(200);
    expect(variacao(50, 100)).toBe(-50);
    expect(variacao(10, 0)).toBeNull();
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await pg.query("INSERT INTO admins (email) VALUES ('dona@loja.com'), ('socio@loja.com')");
});

async function pedidos() {
  await pg.query("INSERT INTO products (store_id, id, name, published, raw_json) VALUES ($1, 1, 'Vestido <Azul>', true, '{}'::jsonb), ($1, 2, 'Saia', true, '{}'::jsonb)", [storeId]);
  await pg.query("INSERT INTO product_costs (store_id, product_id, cost) VALUES ($1, 1, 40)", [storeId]);
  const o = (id: number, data: string, total: number, desconto: number, pagamento: string, status: string) =>
    pg.query("INSERT INTO orders (store_id, id, number, created_at_remote, total, discount, status, payment_status) VALUES ($1, $2, $8, $3, $4, $5, $6, $7)", [storeId, id, data, total, desconto, status, pagamento, id]);
  await o(1, "2026-09-10T15:00:00Z", 200, 20, "paid", "closed");
  await o(2, "2026-09-20T15:00:00Z", 100, 0, "paid", "open");
  await o(3, "2026-09-25T15:00:00Z", 500, 0, "paid", "cancelled"); // cancelado: não conta
  await o(4, "2026-09-26T15:00:00Z", 700, 0, "pending", "open"); // não pago: não conta
  await o(5, "2026-08-15T15:00:00Z", 100, 0, "paid", "closed");
  const i = (order: number, product: number, qtd: number, preco: number) =>
    pg.query("INSERT INTO order_items (store_id, order_id, seq, product_id, name, quantity, unit_price) VALUES ($1, $2, 1, $3, 'x', $4, $5)", [storeId, order, product, qtd, preco]);
  await i(1, 1, 2, 100);
  await i(2, 2, 1, 100);
  await i(5, 1, 1, 100);
  const g = (order: number, valor: number, quando: string, cancelado = false) =>
    pg.query("INSERT INTO cashback_grants (store_id, order_id, coupon_code, value, expires_on, issued_at, issued_by, cancelled_at) VALUES ($1, $2, $3, $4, '2027-01-01', $5, 'a', $6)", [storeId, order, `C${order}`, valor, quando, cancelado ? quando : null]);
  await g(1, 15, "2026-09-12T15:00:00Z");
  await g(2, 30, "2026-09-13T15:00:00Z", true); // cancelado
  await g(5, 50, "2026-10-02T15:00:00Z"); // outro mês
}

describe("dados e e-mail do mês", () => {
  it("soma só vendas pagas e não canceladas e compara com o mês anterior", async () => {
    await pedidos();
    const d = await dadosDoMes(db, storeId, mesAnterior("2026-10-01"));
    expect(d.vendas).toEqual({ pedidos: 2, faturamento: 300, unidades: 3, ticket: 150 });
    expect(d.vendasAnterior).toMatchObject({ pedidos: 1, faturamento: 100 });
    expect(d.margem).toMatchObject({ receita: 300, custo: 80, lucroBruto: 120, margem: 60, cobertura: 66.7 });
    expect(d.margemAnterior).toMatchObject({ lucroBruto: 60, margem: 60 });
    expect(d.descontos).toEqual({ valor: 20, pedidos: 1 });
    expect(d.cashback).toEqual({ cupons: 1, valor: 15 });
    expect(d.produtos.map((p) => [p.nome, p.valor])).toEqual([["Vestido <Azul>", 200], ["Saia", 100]]);
    expect(d.melhorDia).toEqual({ dia: "2026-09-10", faturamento: 200, pedidos: 1 });
    expect(d.lidoApartirDe).toBeNull();
  });

  it("monta assunto, texto e HTML sem dados de cliente, escapando nomes", async () => {
    await pedidos();
    const r = await relatorioDoMes(db, storeId, "https://painel.exemplo.com/", mesAnterior("2026-10-01"));
    expect(r.assunto).toBe("INuvem · setembro de 2026: R$ 300,00 em 2 pedidos");
    expect(r.texto).toContain("Faturamento: R$ 300,00 (+200% sobre agosto)");
    expect(r.texto).toContain("Lucro bruto estimado: R$ 120,00 (+100% sobre agosto)");
    expect(r.texto).toContain("Margem estimada: 60% (agosto: 60%)");
    expect(r.texto).toContain("Descontos dados nos pedidos: R$ 20,00 (em 1 pedido, 6,3% do valor antes dos descontos)");
    expect(r.texto).toContain("Cashback emitido: R$ 15,00 (1 cupom");
    expect(r.texto).toContain("1. Vestido <Azul>: 2 peças · R$ 200,00");
    expect(r.texto).toContain("Melhor dia: 10/09/2026, R$ 200,00 em 1 pedido.");
    expect(r.texto).toContain("https://painel.exemplo.com/vendas");
    expect(r.html).toContain("Vestido &lt;Azul&gt;");
    expect(r.html).not.toContain("<Azul>");
  });

  it("sem pedidos lidos avisa; pedidos lidos só a partir de meio do mês avisam que o mês pode estar incompleto", async () => {
    const vazio = await relatorioDoMes(db, storeId, "https://p.com", mesAnterior("2026-10-01"));
    expect(vazio.texto).toContain("ainda não foram lidos");
    expect(vazio.texto).toContain("Sem custos informados");
    await pg.query("INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status) VALUES ($1, 9, 9, '2026-09-18T15:00:00Z', 80, 'closed', 'paid')", [storeId]);
    const parcial = await relatorioDoMes(db, storeId, "https://p.com", mesAnterior("2026-10-01"));
    expect(parcial.texto).toContain("lidos só a partir de 18/09/2026");
  });

  it("montar é puro: mesmos dados, mesmo e-mail", async () => {
    await pedidos();
    const d = await dadosDoMes(db, storeId, mesAnterior("2026-10-01"));
    expect(montarRelatorioMensal(d, { appUrl: "https://p.com" })).toEqual(montarRelatorioMensal(d, { appUrl: "https://p.com" }));
  });
});

describe("envio do relatório mensal", () => {
  const enviados: Array<{ para: string[]; assunto: string }> = [];
  let status = 200;
  const fetchFalso = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string) as { to: string[]; subject: string };
    if (status !== 200) return new Response(JSON.stringify({ message: "recusado" }), { status });
    enviados.push({ para: b.to, assunto: b.subject });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const config = { apiKey: "k", from: "INuvem <a@b.com>" };
  const enviar = (agora: string, extra: Record<string, unknown> = {}) => enviarRelatorioMensal(db, { storeId, actor: "cron", appUrl: "https://p.com", agora: new Date(agora), config, fetchImpl: fetchFalso, ...extra });
  const ligar = (monthly = true) => salvarConfigResumo(db, { storeId, actor: "dona@loja.com", enabled: false, recipients: ["dona@loja.com", "socio@loja.com"], onlyIfAction: false, monthly });
  beforeEach(() => {
    enviados.length = 0;
    status = 200;
  });

  it("desligado não envia; ligado envia nos dias 1 a 3, uma vez por mês", async () => {
    expect(await enviar("2026-10-01T10:00:00Z")).toEqual({ enviado: false, motivo: "Relatório mensal desligado." });
    await ligar();
    expect(await enviar("2026-10-10T10:00:00Z")).toMatchObject({ enviado: false, motivo: expect.stringMatching(/Fora dos dias/) });
    expect(await enviar("2026-10-01T10:00:00Z")).toMatchObject({ enviado: true, destinatarios: 2, mes: "2026-09" });
    expect(enviados.map((e) => e.para)).toEqual([["dona@loja.com"], ["socio@loja.com"]]);
    expect(enviados[0]!.assunto).toMatch(/^INuvem · setembro de 2026/);
    expect((await obterConfigResumo(db, storeId)).monthlyLastMonth).toBe("2026-09");
    expect(await enviar("2026-10-02T10:00:00Z")).toEqual({ enviado: false, motivo: "Já enviado para este mês." });
    expect(await enviar("2026-11-03T10:00:00Z")).toMatchObject({ enviado: true, mes: "2026-10" }); // se o dia 1º falhou, o dia 3 ainda envia
    expect(enviados).toHaveLength(4);
    expect(acaoLabel("relatorio_mensal.enviar")).toMatch(/Relatório mensal/);
    expect(JSON.stringify((await pg.query("SELECT depois FROM audit_log")).rows)).not.toMatch(/dona@loja|socio@loja/);
  });

  it("o teste manual ignora o calendário e não conta como o envio do mês", async () => {
    await ligar(false);
    expect(await enviar("2026-10-15T10:00:00Z", { manual: true })).toMatchObject({ enviado: true });
    expect(enviados[0]!.assunto).toMatch(/^\[teste\]/);
    expect((await obterConfigResumo(db, storeId)).monthlyLastMonth).toBeNull();
  });

  it("falha total registra o erro e tenta de novo no dia seguinte", async () => {
    await ligar();
    status = 403;
    await expect(enviar("2026-10-01T10:00:00Z")).rejects.toThrow(/recusou/);
    const cfg = await obterConfigResumo(db, storeId);
    expect(cfg.monthlyLastMonth).toBeNull();
    expect(cfg.monthlyLastError).toMatch(/recusou/);
    status = 200;
    expect(await enviar("2026-10-02T10:00:00Z")).toMatchObject({ enviado: true });
    expect((await obterConfigResumo(db, storeId)).monthlyLastError).toBeNull();
  });

  it("salvar o resumo sem mexer no mensal mantém o que estava; ligar o mensal exige destinatário", async () => {
    await ligar();
    await salvarConfigResumo(db, { storeId, actor: "dona@loja.com", enabled: true, recipients: ["dona@loja.com"], onlyIfAction: false });
    expect((await obterConfigResumo(db, storeId)).monthly).toBe(true);
    await expect(salvarConfigResumo(db, { storeId, actor: "dona@loja.com", enabled: false, recipients: [], onlyIfAction: false, monthly: true })).rejects.toThrow(/relatório mensal/);
  });
});
