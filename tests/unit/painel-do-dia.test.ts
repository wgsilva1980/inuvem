import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import type { Product } from "@/lib/nuvemshop/types";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { painelDoDia } from "@/lib/dashboard/hoje";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

const horasAtras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const pedido = (id: number, over: Record<string, unknown> = {}, qtd = 1): Order =>
  ({ id, number: 1000 + id, created_at: horasAtras(1), total: "100.00", discount: "0", status: "open", payment_status: "paid", shipping_status: "unpacked", customer: { id: 500 + id }, products: [{ product_id: 1, variant_id: 11, quantity: qtd, price: "100" }], ...over }) as unknown as Order;
const gravar = (os: Order[]) => gravarPedidos(db, storeId, os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
const marcarPedidosLidos = (horas = 1) => pg.query("INSERT INTO store_settings (store_id, orders_synced_at) VALUES ($1, now() - ($2 || ' hours')::interval) ON CONFLICT (store_id) DO UPDATE SET orders_synced_at = EXCLUDED.orders_synced_at", [storeId, String(horas)]);
const produto = (estoque: number): Product =>
  ({ id: 1, name: { pt: "Vestido" }, published: true, variants: [{ id: 11, product_id: 1, sku: "V1", price: "100", stock_management: true, stock: estoque, values: [{ pt: "P" }] }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

const ids = (r: Awaited<ReturnType<typeof painelDoDia>>) => r.tarefas.map((t) => t.id);

describe("painel do dia", () => {
  it("sem pedidos lidos, pede para ler e não mostra vendas", async () => {
    const r = await painelDoDia(db, storeId);
    expect(ids(r)).toEqual(["pedidos-nunca"]);
    expect(r).toMatchObject({ vendas: null, pedidosLidosEm: null, pedidosDesatualizados: false });
  });

  it("tudo em dia: nenhuma tarefa", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(50)]);
    const r = await painelDoDia(db, storeId);
    expect(r.tarefas).toEqual([]);
    expect(r.vendas).toMatchObject({ hoje: { pedidos: 0 }, mediaDiaria: 0 });
  });

  it("expedição: atrasados (urgente), a enviar e a conferir, com contagens certas", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(50)]);
    await gravar([
      pedido(1, { created_at: horasAtras(24 * 4) }), // atrasado
      pedido(2, { created_at: horasAtras(24 * 3) }), // atrasado
      pedido(3), // no prazo
      pedido(4, { total: "100", discount: "120" }, 6), // desconto alto + 6 unidades iguais: conferir
      pedido(5, { shipping_status: "shipped" }), // já enviado: fora da fila
      pedido(6, { payment_status: "pending" }), // não pago: fora da fila
    ]);
    const r = await painelDoDia(db, storeId);
    const t = Object.fromEntries(r.tarefas.map((x) => [x.id, x]));
    expect(t["exp-atrasados"]).toMatchObject({ quantidade: 2, tom: "danger", href: "/expedicao?filtro=atrasados" });
    expect(t["exp-aenviar"]).toMatchObject({ quantidade: 2, tom: "info" }); // pedidos 3 e 4
    expect(t["exp-conferir"]).toMatchObject({ quantidade: 1, tom: "warning" });
    // ordenação: urgentes primeiro
    expect(r.tarefas[0]!.tom).toBe("danger");
    expect(r.tarefas.map((x) => x.tom)).toEqual([...r.tarefas.map((x) => x.tom)].sort((a, b) => ({ danger: 0, warning: 1, info: 2 })[a] - ({ danger: 0, warning: 1, info: 2 })[b]));
  });

  it("vendas de hoje, de ontem e média dos 7 dias anteriores", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(50)]);
    const agora = new Date("2026-10-10T15:00:00Z"); // 12h em Brasília
    const em = (h: number) => new Date(agora.getTime() - h * 3_600_000).toISOString();
    await gravar([
      pedido(1, { created_at: em(1), total: "300", shipping_status: "shipped" }), // hoje
      pedido(2, { created_at: em(2), total: "100", shipping_status: "shipped" }), // hoje
      pedido(3, { created_at: em(20), total: "70", shipping_status: "shipped" }), // ontem
      pedido(4, { created_at: em(24 * 3), total: "700", shipping_status: "shipped" }), // nos 7 dias antes
      pedido(5, { created_at: em(1), total: "999", status: "cancelled", shipping_status: "shipped" }), // cancelado não conta
    ]);
    const r = await painelDoDia(db, storeId, agora);
    expect(r.vendas?.hoje).toMatchObject({ pedidos: 2, faturamento: 400 });
    expect(r.vendas?.ontem).toMatchObject({ pedidos: 1, faturamento: 70 });
    expect(r.vendas?.mediaDiaria).toBe(110); // (70 + 700) / 7
  });

  it("estoque: esgotada que vendia é urgente; acabando em até 7 dias é aviso", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(0)]);
    await gravar([pedido(1, { created_at: horasAtras(24 * 5), shipping_status: "shipped" }, 3)]);
    const r = await painelDoDia(db, storeId);
    expect(r.tarefas.find((t) => t.id === "est-esgotados")).toMatchObject({ quantidade: 1, tom: "danger", href: "/estoque" });
    await upsertProducts(db, storeId, [produto(1)]); // vende 3 em 30 dias (0,1/dia): 1 unidade dura 10 dias -> fora dos 7 dias
    expect(ids(await painelDoDia(db, storeId))).not.toContain("est-acabando");
    await gravar([pedido(2, { created_at: horasAtras(24 * 2), shipping_status: "shipped" }, 30)]); // 33 em 30 dias (1,1/dia): acaba em menos de 1 dia
    expect(ids(await painelDoDia(db, storeId))).toContain("est-acabando");
  });

  it("produto despublicado pela regra e já com estoque aparece; 'manter despublicado' não", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [{ ...produto(5), published: false }]);
    await pg.query("INSERT INTO auto_unpublished (store_id, product_id) VALUES ($1, 1)", [storeId]);
    expect(ids(await painelDoDia(db, storeId))).toContain("est-voltou");
    await pg.query("UPDATE auto_unpublished SET keep_unpublished = true");
    expect(ids(await painelDoDia(db, storeId))).not.toContain("est-voltou");
  });

  it("promoções, lotes com erro, sincronização e cashback", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(50)]);
    const promo = (status: string, ini: string, fim: string) =>
      pg.query(`INSERT INTO promotions (store_id, nome, operation, product_ids, starts_at, ends_at, status, created_by) VALUES ($1, 'p', '{}'::jsonb, '{1}', now() + $2::interval, now() + $3::interval, $4, 'a')`, [storeId, ini, fim, status]);
    await promo("agendada", "-1 hour", "2 days"); // devia ter começado
    await promo("agendada", "5 hours", "2 days"); // começa em breve
    await promo("ativa", "-2 days", "6 hours"); // termina em breve
    const job = (await pg.query<{ id: string }>("INSERT INTO bulk_jobs (store_id, actor_email, operation, descricao, status, finished_at) VALUES ($1, 'a', '{}'::jsonb, 'x', 'completed', now() - interval '1 day') RETURNING id", [storeId])).rows[0]!.id;
    await pg.query("INSERT INTO bulk_job_items (job_id, seq, product_id, product_name, changes, status) VALUES ($1, 1, 1, 'p', '{}'::jsonb, 'error'), ($1, 2, 2, 'q', '{}'::jsonb, 'conflict')", [job]);
    await pg.query("INSERT INTO sync_runs (store_id, tipo, status, finished_at) VALUES ($1, 'full', 'failed', now())", [storeId]);
    await pg.query("INSERT INTO cashback_grants (store_id, order_id, coupon_code, value, expires_on, issued_by) VALUES ($1, 9, 'CASHX', 10, current_date + 20, 'a')", [storeId]);
    const t = Object.fromEntries((await painelDoDia(db, storeId)).tarefas.map((x) => [x.id, x]));
    expect(t["sync-falhou"]).toMatchObject({ tom: "danger" });
    expect(t["promo-pendentes"]).toMatchObject({ quantidade: 1, tom: "danger" });
    expect(t["promo-comecam"]).toMatchObject({ quantidade: 1 });
    expect(t["promo-terminam"]).toMatchObject({ quantidade: 1 });
    expect(t["lote-erro"]).toMatchObject({ quantidade: 1, tom: "warning" }); // um lote, mesmo com dois itens com problema
    expect(t["cash-sem-aviso"]).toMatchObject({ quantidade: 1 });
  });

  it("pedidos lidos há mais de 36 horas: avisa e marca como desatualizado", async () => {
    await marcarPedidosLidos(40);
    const r = await painelDoDia(db, storeId);
    expect(r.pedidosDesatualizados).toBe(true);
    expect(ids(r)).toContain("pedidos-velhos");
  });

  it("uma parte que falha não derruba as outras", async () => {
    await marcarPedidosLidos();
    await upsertProducts(db, storeId, [produto(50)]);
    await gravar([pedido(1, { created_at: horasAtras(24 * 4) })]);
    const quebrado: Db = { query: async (text, params) => (/FROM promotions/.test(text) ? Promise.reject(new Error("banco fora")) : db.query(text, params as never)) as never };
    const r = await painelDoDia(quebrado, storeId);
    expect(ids(r)).toContain("exp-atrasados");
    expect(ids(r).some((i) => i.startsWith("promo-"))).toBe(false);
  });
});
