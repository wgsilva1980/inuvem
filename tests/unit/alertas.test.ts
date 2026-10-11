import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { AlertaConfigError, MAX_POR_HORA, alertasRecentes, avisarSyncFalhou, enviarAlertaTeste, obterConfigAlertas, salvarConfigAlertas } from "@/lib/alerts/service";
import { alertaPedidoPago } from "@/lib/alerts/montar";
import { ALERT_WEBHOOK_EVENTS, handleWebhook, type ResourceApi, type WebhookDeps } from "@/lib/webhooks/handler";
import { ensureWebhooks } from "@/lib/webhooks/register";
import type { Product } from "@/lib/nuvemshop/types";
import type { Order } from "@/lib/nuvemshop/orders";

let pg: PGlite;
let db: Db;
let storeId: string;
let enviados: Array<{ to: string[]; subject: string; text: string }>;
let falhar: boolean;

const fetchFalso = (async (_url: string, init: { body: string }) => {
  const b = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
  if (falhar) return new Response(JSON.stringify({ message: "recusado" }), { status: 403 });
  enviados.push({ to: b.to, subject: b.subject, text: b.text });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;
const ctx = { appUrl: "https://painel.exemplo.com", config: { apiKey: "k", from: "INuvem <a@b.com>" }, fetchImpl: fetchFalso };

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await pg.query("INSERT INTO admins (email) VALUES ('dona@loja.com'), ('socio@loja.com')");
  enviados = [];
  falhar = false;
});

const ligar = (over: Partial<Parameters<typeof salvarConfigAlertas>[1]> = {}) =>
  salvarConfigAlertas(db, { storeId, actor: "dona@loja.com", enabled: true, recipients: ["dona@loja.com"], onPaidOrder: true, onOutOfStock: true, onSyncFailure: true, ...over });

describe("configuração", () => {
  it("começa desligada e salva só administradores", async () => {
    expect(await obterConfigAlertas(db, storeId)).toMatchObject({ enabled: false, recipients: [], onPaidOrder: true });
    expect(await ligar({ recipients: ["Dona@Loja.com", "dona@loja.com"] })).toMatchObject({ enabled: true, recipients: ["dona@loja.com"] });
    await expect(ligar({ recipients: ["estranho@x.com"] })).rejects.toThrow(/administradores/);
    await expect(ligar({ recipients: ["nao-e-email"] })).rejects.toThrow(/não parece válido/);
    await expect(ligar({ recipients: [] })).rejects.toBeInstanceOf(AlertaConfigError);
    await expect(ligar({ onPaidOrder: false, onOutOfStock: false, onSyncFailure: false })).rejects.toThrow(/ao menos um tipo/);
  });
});

describe("e-mail de pedido pago", () => {
  it("traz número, total e itens, sem dados de cliente", () => {
    const a = alertaPedidoPago({ numero: 1234, total: 289.9, itens: [{ nome: "Vestido Azul", quantidade: 2 }, { nome: "Saia", quantidade: 1 }], appUrl: "https://p.com/" });
    expect(a.assunto).toBe("Pedido #1234 pago — R$ 289,90");
    expect(a.linhas).toEqual(["3 peças:", "2× Vestido Azul", "1× Saia", "Já pode separar e embalar."]);
    expect(a.link!.url).toBe("https://p.com/expedicao");
  });
});

describe("webhooks de alerta", () => {
  const SECRET = "segredo";
  const body = (event: string, id: number) => JSON.stringify({ store_id: 1, event, id });
  const sign = (b: string) => createHmac("sha256", SECRET).update(b).digest("hex");
  let clock = 1_000_000;
  let produto: Product;
  const pedido: Order = { id: 77, number: 1001, total: "199.90", products: [{ name: { pt: "Vestido Azul" }, quantity: 1, price: "199.90" }], customer: { email: "cliente@x.com" } } as Order;
  const api = (): ResourceApi => ({
    getProduct: async () => produto,
    getCategory: async () => { throw new Error("x"); },
    getOrder: async () => pedido,
  });
  const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({ db, clientSecret: SECRET, findStore: async () => ({ id: storeId, nuvemshop_store_id: "1" }), apiFor: async () => api(), now: () => (clock += 10_000), log: () => undefined, alertas: ctx, ...over });
  const send = (event: string, id: number, over?: Partial<WebhookDeps>) => {
    const b = body(event, id);
    return handleWebhook(deps(over), b, sign(b));
  };
  const prod = (stock: number, published = true): Product => ({ id: 5, name: { pt: "Vestido Azul" }, published, variants: [{ id: 500, product_id: 5, sku: "V", price: "10", stock, stock_management: true }], updated_at: "2026-10-01T10:00:00+0000" }) as Product;

  it("order/paid avisa uma vez e não repete em reenvio; o texto não tem dados da cliente", async () => {
    await ligar();
    expect((await send("order/paid", 77)).status).toBe(200);
    expect((await send("order/paid", 77)).status).toBe(200); // reenvio fora da janela de deduplicação do webhook
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ to: ["dona@loja.com"], subject: "Pedido #1001 pago — R$ 199,90" });
    expect(enviados[0]!.text).not.toContain("cliente@x.com");
    const [l] = await alertasRecentes(db, storeId);
    expect(l).toMatchObject({ kind: "pedido_pago", enviados: 1, erro: null });
  });

  it("com alertas desligados, ou para este tipo desligado, não envia nada", async () => {
    await send("order/paid", 77);
    await ligar({ onPaidOrder: false });
    await send("order/paid", 78);
    expect(enviados).toHaveLength(0);
    expect(await alertasRecentes(db, storeId)).toHaveLength(0);
  });

  it("falha no e-mail não derruba o webhook e fica registrada", async () => {
    await ligar();
    falhar = true;
    expect((await send("order/paid", 77)).status).toBe(200);
    const [l] = await alertasRecentes(db, storeId);
    expect(l!.erro).toMatch(/recusou \(403\)/);
  });

  it("sem o contexto de alertas o webhook de pedido não faz nada", async () => {
    await ligar();
    expect((await send("order/paid", 77, { alertas: undefined })).status).toBe(200);
    expect(enviados).toHaveLength(0);
  });

  it("produto esgotado avisa uma vez, reavisa depois que o estoque volta e zera de novo, e ignora não publicado", async () => {
    await ligar();
    produto = prod(0);
    await send("product/updated", 5);
    await send("product/updated", 5);
    expect(enviados.map((e) => e.subject)).toEqual(["Esgotou: Vestido Azul"]);
    produto = prod(4);
    await send("product/updated", 5);
    produto = prod(0);
    await send("product/updated", 5);
    expect(enviados).toHaveLength(2);
    produto = { ...prod(0), id: 6, published: false } as Product;
    await send("product/updated", 6);
    expect(enviados).toHaveLength(2);
  });

  it("passa de MAX_POR_HORA alertas e os excedentes são registrados como suprimidos", async () => {
    await ligar();
    for (let i = 1; i <= MAX_POR_HORA + 2; i++) {
      produto = { ...prod(0), id: 100 + i, variants: [{ id: 9000 + i, product_id: 100 + i, sku: `V${i}`, price: "10", stock: 0, stock_management: true }] } as Product;
      await send("product/updated", 100 + i);
    }
    expect(enviados).toHaveLength(MAX_POR_HORA);
    const linhas = await alertasRecentes(db, storeId, 50);
    expect(linhas.filter((l) => l.suprimido)).toHaveLength(2);
  });
});

describe("sincronização e teste", () => {
  it("avisa a falha uma vez por dia", async () => {
    await ligar();
    expect(await avisarSyncFalhou(db, storeId, "token expirado", ctx)).toBe("enviado");
    expect(await avisarSyncFalhou(db, storeId, "token expirado", ctx)).toBe("repetido");
    expect(enviados[0]!.text).toContain("token expirado");
  });

  it("o teste funciona com os alertas desligados e exige destinatário", async () => {
    await expect(enviarAlertaTeste(db, { storeId, appUrl: ctx.appUrl, config: ctx.config, fetchImpl: ctx.fetchImpl })).rejects.toThrow(/destinatário/);
    await ligar({ enabled: false });
    expect(await enviarAlertaTeste(db, { storeId, appUrl: ctx.appUrl, config: ctx.config, fetchImpl: ctx.fetchImpl })).toEqual({ enviados: 1 });
    expect(enviados[0]!.subject).toMatch(/^\[teste\]/);
    falhar = true;
    await expect(enviarAlertaTeste(db, { storeId, appUrl: ctx.appUrl, config: ctx.config, fetchImpl: ctx.fetchImpl })).rejects.toThrow(/recusou/);
  });
});

describe("assinatura do aviso de pedido pago", () => {
  it("registra só order/paid e é idempotente", async () => {
    const criados: string[] = [];
    const registro = { list: async () => criados.map((event, id) => ({ id, event, url: "u" })), create: async (i: { event: string }) => void criados.push(i.event) };
    expect((await ensureWebhooks(registro, "u", undefined, ALERT_WEBHOOK_EVENTS)).created).toEqual(["order/paid"]);
    expect((await ensureWebhooks(registro, "u", undefined, ALERT_WEBHOOK_EVENTS)).existing).toEqual(["order/paid"]);
  });
});

