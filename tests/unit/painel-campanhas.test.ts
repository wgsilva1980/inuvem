import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { MAX_CAMPANHAS, tarefasDeCampanhas } from "@/lib/campaigns/tarefas";
import { painelDoDia } from "@/lib/dashboard/hoje";
import { painelDoDiaCompleto } from "@/lib/dashboard/hoje-completo";

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

const tarefas = async (hoje: string) => (await tarefasDeCampanhas(db, storeId, hoje)).map((t) => [t.id, t.tom, t.titulo]);

describe("tarefas das campanhas no painel do dia", () => {
  it("fora do período de ação, nada aparece", async () => {
    expect(await tarefas("2027-01-05")).toEqual([]);
    expect(await tarefas("2026-07-20")).toEqual([]); // só o Dia dos Pais está perto, e é de venda baixa
  });

  it("aviso antecipado: faltam até 14 dias para o prazo ideal de encomendar", async () => {
    const t = await tarefas("2027-01-22");
    expect(t).toEqual([["camp-dia-da-mulher", "info", "Dia da Mulher em 45 dias: o ideal é encomendar a mercadoria até 27/01/2027"]]);
    expect(await tarefas("2027-01-12")).toEqual([]); // ainda faltam 15 dias para o prazo
  });

  it("hora de encomendar: atenção, e some quando há um pedido de compra perto do prazo", async () => {
    const antes = await tarefas("2026-10-11");
    expect(antes.map((x) => [x[0], x[1]])).toEqual([["camp-black-friday", "warning"], ["camp-natal", "warning"]]);
    expect(antes[0]![2]).toBe("Black Friday em 47 dias: hora de encomendar a mercadoria");
    await pg.query("INSERT INTO purchase_orders (store_id, supplier, status, created_at) VALUES ($1, 'Fornecedor', 'aberto', '2026-10-01T12:00:00Z')", [storeId]);
    expect(await tarefas("2026-10-11")).toEqual([]);
  });

  it("pedido de compra cancelado, ou de muito antes do prazo, não conta", async () => {
    await pg.query("INSERT INTO purchase_orders (store_id, supplier, status, created_at) VALUES ($1, 'A', 'cancelado', '2026-10-01T12:00:00Z'), ($1, 'B', 'aberto', '2026-03-01T12:00:00Z')", [storeId]);
    expect((await tarefas("2026-10-11")).map((x) => x[0])).toEqual(["camp-black-friday", "camp-natal"]);
  });

  it("hora de montar a promoção: some quando há promoção agendada ou ativa na janela da campanha", async () => {
    await pg.query("INSERT INTO purchase_orders (store_id, supplier, status, created_at) VALUES ($1, 'A', 'aberto', '2026-10-20T12:00:00Z')", [storeId]);
    const antes = await tarefas("2026-11-10");
    expect(antes[0]).toEqual(["camp-black-friday", "warning", "Black Friday em 17 dias: monte a promoção"]);
    await pg.query("INSERT INTO promotions (store_id, nome, operation, product_ids, starts_at, ends_at, status, created_by) VALUES ($1, 'BF', '{}'::jsonb, '{1}', '2026-11-20T03:00:00Z', '2026-11-30T03:00:00Z', 'agendada', 'a@b.com')", [storeId]);
    expect((await tarefas("2026-11-10")).map((x) => x[0])).not.toContain("camp-black-friday");
    await pg.query("UPDATE promotions SET status = 'cancelada'");
    expect((await tarefas("2026-11-10")).map((x) => x[0])).toContain("camp-black-friday"); // cancelada não conta
  });

  it("durante a campanha: para saber; e no dia, 'é hoje'", async () => {
    await pg.query("INSERT INTO purchase_orders (store_id, supplier, status, created_at) VALUES ($1, 'A', 'aberto', '2026-10-20T12:00:00Z')", [storeId]);
    expect((await tarefas("2026-11-25"))[0]).toEqual(["camp-black-friday", "info", "Black Friday em andamento: termina em 2 dias"]);
    expect((await tarefas("2026-11-27"))[0]).toEqual(["camp-black-friday", "info", "Black Friday é hoje"]);
  });

  it("no máximo duas campanhas por vez", async () => {
    expect((await tarefasDeCampanhas(db, storeId, "2026-11-10")).length).toBeLessThanOrEqual(MAX_CAMPANHAS);
  });
});

describe("painel do dia completo", () => {
  const agora = new Date("2026-10-11T15:00:00Z");

  it("acrescenta campanhas e pós-venda às tarefas de sempre, sem mudar o painel básico", async () => {
    await pg.query("INSERT INTO store_settings (store_id, orders_synced_at) VALUES ($1, $2)", [storeId, new Date(agora.getTime() - 3_600_000).toISOString()]);
    await pg.query("INSERT INTO customers (store_id, id, name, accepts_marketing) VALUES ($1, 1, 'Ana', true)", [storeId]);
    await pg.query(
      "INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status, shipping_status, customer_id, updated_at_remote) VALUES ($1, 1, 1001, $2, 100, 'open', 'paid', 'delivered', 1, $3)",
      [storeId, new Date(agora.getTime() - 14 * 86_400_000).toISOString(), new Date(agora.getTime() - 10 * 86_400_000).toISOString()],
    );
    const basico = (await painelDoDia(db, storeId, agora)).tarefas.map((t) => t.id);
    expect(basico.some((i) => i.startsWith("camp-") || i === "pos-venda")).toBe(false);
    const completo = await painelDoDiaCompleto(db, storeId, agora);
    const ids = completo.tarefas.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["camp-black-friday", "pos-venda", ...basico]));
    expect(completo.tarefas.find((t) => t.id === "pos-venda")).toMatchObject({ tom: "info", quantidade: 1, titulo: "1 cliente para o pós-venda", href: "/posvenda" });
    const tons = completo.tarefas.map((t) => t.tom);
    expect(tons).toEqual([...tons].sort((a, b) => ["danger", "warning", "info"].indexOf(a) - ["danger", "warning", "info"].indexOf(b)));
  });

  it("sem pedidos lidos não há pós-venda, mas as campanhas continuam", async () => {
    const ids = (await painelDoDiaCompleto(db, storeId, agora)).tarefas.map((t) => t.id);
    expect(ids).not.toContain("pos-venda");
    expect(ids).toContain("camp-black-friday");
  });
});
