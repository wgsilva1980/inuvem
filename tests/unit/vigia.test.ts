import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { salvarConfigAlertas } from "@/lib/alerts/service";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/handler";
import { estadoDoVigia, lerWebhooks, rodarVigia } from "@/lib/vigia/service";
import { CATALOGO_AVISO_H, ROTULO_ITEM, verificarCatalogo, verificarConexao, verificarEmail, verificarIa, verificarPedidos, verificarPermissoes, verificarWebhooks } from "@/lib/vigia/verificacoes";

const AGORA = Date.parse("2026-10-11T12:00:00Z");
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();
const APP = "https://painel.exemplo.com";
const URL_WH = `${APP}/api/webhooks/nuvemshop`;
const todos = WEBHOOK_EVENTS.map((event) => ({ event, url: URL_WH }));

describe("verificações puras", () => {
  it("catálogo: falha, atraso e parada", () => {
    expect(verificarCatalogo(null, AGORA)).toMatchObject({ status: "aviso" });
    expect(verificarCatalogo({ status: "failed", quando: horasAtras(2) }, AGORA)).toMatchObject({ status: "erro", detalhe: expect.stringContaining("falhou") });
    expect(verificarCatalogo({ status: "completed", quando: horasAtras(30) }, AGORA).status).toBe("ok");
    expect(verificarCatalogo({ status: "completed", quando: horasAtras(CATALOGO_AVISO_H + 1) }, AGORA)).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("2 dias") });
    expect(verificarCatalogo({ status: "completed", quando: horasAtras(100) }, AGORA)).toMatchObject({ status: "erro", detalhe: expect.stringContaining("4 dias") });
    expect(verificarCatalogo({ status: "running", quando: horasAtras(100) }, AGORA).status).toBe("ok");
  });

  it("pedidos: nunca lidos não é problema; atraso e parada são", () => {
    expect(verificarPedidos(null, AGORA).status).toBe("inativo");
    expect(verificarPedidos(horasAtras(20), AGORA).status).toBe("ok");
    expect(verificarPedidos(horasAtras(40), AGORA).status).toBe("aviso");
    expect(verificarPedidos(horasAtras(100), AGORA).status).toBe("erro");
  });

  it("permissões", () => {
    expect(verificarPermissoes([]).status).toBe("aviso");
    const todas = ["read_products", "write_products", "read_orders", "write_orders", "read_customers", "read_coupons", "write_coupons"];
    expect(verificarPermissoes(todas).status).toBe("ok");
    expect(verificarPermissoes(todas.filter((x) => x !== "write_orders"))).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("Marcar pedidos como enviados") });
  });

  it("conexão: token revogado é erro; falha passageira é só atenção", () => {
    expect(verificarConexao({ ok: true, webhooks: [] }).status).toBe("ok");
    expect(verificarConexao({ ok: false, status: 401, webhooks: [] })).toMatchObject({ status: "erro", acao: expect.stringContaining("Reconecte") });
    expect(verificarConexao({ ok: false, status: 503, mensagem: "fora do ar", webhooks: [] })).toMatchObject({ status: "aviso", detalhe: "fora do ar" });
  });

  it("webhooks: todos, faltando, endereço errado e pedido pago", () => {
    const v = (webhooks: Array<{ event: string; url: string }>, precisaPedidoPago = false) => verificarWebhooks({ ok: true, webhooks }, { appUrl: `${APP}/`, precisaPedidoPago });
    expect(v(todos).status).toBe("ok");
    expect(v(todos.filter((w) => w.event !== "product/updated"))).toMatchObject({ status: "erro", detalhe: expect.stringContaining("product/updated") });
    expect(v(todos.map((w) => (w.event === "category/created" ? { ...w, url: "https://velho.com/x" } : w)))).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("outro endereço") });
    expect(v(todos, true)).toMatchObject({ status: "aviso", acao: expect.stringContaining("Ativar aviso de pedido pago") });
    expect(v([...todos, { event: "order/paid", url: URL_WH }], true).status).toBe("ok");
    expect(verificarWebhooks({ ok: false, webhooks: [] }, { appUrl: APP, precisaPedidoPago: false }).status).toBe("aviso");
  });

  it("e-mail e IA", () => {
    expect(verificarEmail({ emUso: false, chaveConfigurada: false, ultimoErro: null }).status).toBe("inativo");
    expect(verificarEmail({ emUso: true, chaveConfigurada: false, ultimoErro: null })).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("RESEND_API_KEY") });
    expect(verificarEmail({ emUso: true, chaveConfigurada: true, ultimoErro: "domínio não verificado" })).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("domínio não verificado") });
    expect(verificarEmail({ emUso: true, chaveConfigurada: true, ultimoErro: null }).status).toBe("ok");
    expect(verificarIa(true).status).toBe("ok");
    expect(verificarIa(false)).toMatchObject({ status: "aviso", detalhe: expect.stringContaining("ANTHROPIC_API_KEY") });
  });

  it("todo item tem rótulo", () => {
    expect(Object.keys(ROTULO_ITEM).sort()).toEqual(["catalogo", "email", "ia", "nuvemshop", "pedidos", "permissoes", "webhooks"]);
  });
});

describe("lerWebhooks", () => {
  it("devolve ok com a lista, ou o status do erro sem lançar", async () => {
    expect(await lerWebhooks(async () => [{ event: "a", url: "u" }, { event: undefined, url: "x" }])).toEqual({ ok: true, webhooks: [{ event: "a", url: "u" }] });
    expect(await lerWebhooks(async () => { throw new NuvemshopError("x", 401, null); })).toMatchObject({ ok: false, status: 401 });
    expect(await lerWebhooks(async () => { throw new Error("rede"); })).toMatchObject({ ok: false, mensagem: expect.any(String) });
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
let enviados: Array<{ to: string[]; subject: string; text: string }>;
const fetchFalso = (async (_u: string, init: { body: string }) => {
  const b = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
  enviados.push({ to: b.to, subject: b.subject, text: b.text });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;
const ENV = { RESEND_API_KEY: "k", ANTHROPIC_API_KEY: "a" };
const TODAS = "read_products,write_products,read_orders,write_orders,read_customers,read_coupons,write_coupons";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await pg.query("INSERT INTO admins (email) VALUES ('dona@loja.com')");
  await pg.query("INSERT INTO sync_runs (store_id, tipo, status, finished_at) VALUES ($1, 'incremental', 'completed', $2)", [storeId, horasAtras(5)]);
  await pg.query("INSERT INTO store_settings (store_id, orders_synced_at) VALUES ($1, $2)", [storeId, horasAtras(5)]);
  enviados = [];
});

const ligarAlertas = (extra: { onIntegrations?: boolean; onSyncFailure?: boolean } = {}) => salvarConfigAlertas(db, { storeId, actor: "dona@loja.com", enabled: true, recipients: ["dona@loja.com"], onPaidOrder: false, onOutOfStock: false, onSyncFailure: false, onIntegrations: true, ...extra });
const vigia = (listar: () => Promise<Array<{ event?: string; url?: string }>>, extra: Record<string, unknown> = {}) =>
  rodarVigia(db, { storeId, scope: TODAS, appUrl: APP, listarWebhooks: listar, agora: new Date(AGORA), env: ENV, email: { config: { apiKey: "k", from: "INuvem <a@b.com>" }, fetchImpl: fetchFalso }, ...extra });
const ok = async () => todos;
const revogado = async () => { throw new NuvemshopError("401", 401, null); };
const porId = (itens: Awaited<ReturnType<typeof vigia>>) => Object.fromEntries(itens.map((i) => [i.id, i.status]));

describe("rodarVigia", () => {
  it("tudo em dia: nada de erro, nada enviado, estado guardado", async () => {
    await ligarAlertas();
    const itens = await vigia(ok);
    expect(porId(itens)).toEqual({ nuvemshop: "ok", webhooks: "ok", catalogo: "ok", pedidos: "ok", permissoes: "ok", email: "ok", ia: "ok" });
    expect(enviados).toHaveLength(0);
    const estado = await estadoDoVigia(db, storeId);
    expect(estado).toHaveLength(7);
    expect(estado.every((e) => e.status === "ok")).toBe(true);
  });

  it("avisa uma vez quando o problema começa, não repete, e volta a avisar se recuperar e falhar de novo", async () => {
    await ligarAlertas();
    expect(porId(await vigia(revogado))).toMatchObject({ nuvemshop: "erro" });
    expect(enviados.map((e) => e.subject)).toEqual(["Integração com problema: Conexão com a Nuvemshop"]);
    expect(enviados[0]!.text).toContain("Reconecte a loja");
    expect(enviados[0]!.to).toEqual(["dona@loja.com"]);
    await vigia(revogado); // continua com problema: não repete
    expect(enviados).toHaveLength(1);
    await vigia(ok); // recuperou
    expect((await pg.query("SELECT resolvido_em FROM alert_log WHERE kind = 'integracao'")).rows[0]).not.toMatchObject({ resolvido_em: null });
    await vigia(revogado); // falhou de novo
    expect(enviados).toHaveLength(2);
    expect((await pg.query("SELECT count(*)::int AS n FROM alert_log WHERE kind = 'integracao'")).rows[0]).toEqual({ n: 2 });
  });

  it("guarda desde quando o item está no mesmo estado", async () => {
    await vigia(revogado);
    const [antes] = (await estadoDoVigia(db, storeId)).filter((e) => e.id === "nuvemshop");
    await pg.query("UPDATE integration_checks SET since = $1 WHERE check_id = 'nuvemshop'", [horasAtras(48)]);
    await vigia(revogado);
    const [depois] = (await estadoDoVigia(db, storeId)).filter((e) => e.id === "nuvemshop");
    expect(Date.parse(depois!.desde)).toBe(Date.parse(horasAtras(48)));
    expect(antes!.status).toBe("erro");
    await vigia(ok);
    const [volta] = (await estadoDoVigia(db, storeId)).filter((e) => e.id === "nuvemshop");
    expect(volta!.status).toBe("ok");
    expect(Date.parse(volta!.desde)).toBeGreaterThan(Date.parse(horasAtras(48)));
  });

  it("webhook de produto sumindo é erro; sem alertas ligados, ou com 'alertar: false', ou com o tipo desligado, não envia", async () => {
    const semUm = async () => todos.filter((w) => w.event !== "product/created");
    expect(porId(await vigia(semUm))).toMatchObject({ webhooks: "erro" });
    expect(enviados).toHaveLength(0); // alertas ainda desligados
    await ligarAlertas({ onIntegrations: false, onSyncFailure: true });
    await pg.query("UPDATE integration_checks SET status = 'ok'");
    await vigia(semUm);
    expect(enviados).toHaveLength(0); // tipo desligado
    await ligarAlertas();
    await pg.query("UPDATE integration_checks SET status = 'ok'");
    await vigia(semUm, { alertar: false });
    expect(enviados).toHaveLength(0);
    await pg.query("UPDATE integration_checks SET status = 'ok'");
    await vigia(semUm);
    expect(enviados).toHaveLength(1);
  });

  it("rotinas paradas: catálogo antigo e sincronização falha viram erro", async () => {
    await pg.query("UPDATE sync_runs SET finished_at = $1", [horasAtras(120)]);
    await pg.query("UPDATE store_settings SET orders_synced_at = $1", [horasAtras(120)]);
    const r = porId(await vigia(ok));
    expect(r).toMatchObject({ catalogo: "erro", pedidos: "erro" });
    await pg.query("INSERT INTO sync_runs (store_id, tipo, status, finished_at, started_at) VALUES ($1, 'incremental', 'failed', now(), now() + interval '1 second')", [storeId]);
    expect(porId(await vigia(ok, { agora: new Date() }))).toMatchObject({ catalogo: "erro" });
  });

  it("e-mail em uso sem chave, e IA sem chave, aparecem como atenção sem mandar e-mail", async () => {
    await ligarAlertas();
    const r = porId(await vigia(ok, { env: {} }));
    expect(r).toMatchObject({ email: "aviso", ia: "aviso" });
    expect(enviados).toHaveLength(0);
  });

  it("falha recente de envio de e-mail vira atenção", async () => {
    await ligarAlertas();
    await pg.query("INSERT INTO alert_log (store_id, kind, chave, titulo, erro, enviados) VALUES ($1, 'pedido_pago', '1', 'x', 'O serviço de e-mail recusou (403)', 0)", [storeId]);
    expect(porId(await vigia(ok))).toMatchObject({ email: "aviso" });
  });

  it("o estado vem do mais grave para o menos", async () => {
    await vigia(revogado, { env: {} });
    const ordem = (await estadoDoVigia(db, storeId)).map((e) => e.status);
    expect(ordem).toEqual([...ordem].sort((a, b) => ["erro", "aviso", "ok", "inativo"].indexOf(a) - ["erro", "aviso", "ok", "inativo"].indexOf(b)));
    expect(ordem[0]).toBe("erro");
  });
});
