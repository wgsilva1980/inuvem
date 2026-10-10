import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import { fulfillOrder, getOrder } from "@/lib/nuvemshop/orders";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product } from "@/lib/nuvemshop/types";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { filaDeExpedicao, lerRastreios, listaDeSeparacao } from "@/lib/shipping/queue";
import { ACAO_ENVIAR, marcarComoEnviados, type ApiExpedicao } from "@/lib/shipping/enviar";
import { acaoLabel } from "@/lib/history/labels";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000 - 3_600_000).toISOString();
type Linha = { product_id: number; variant_id?: number; quantity: number; price?: string; name?: unknown; variant_values?: unknown };
const pedido = (id: number, linhas: Linha[], over: Record<string, unknown> = {}): Order =>
  ({ id, number: 1000 + id, created_at: diasAtras(1), total: "100.00", status: "open", payment_status: "paid", shipping_status: "unpacked", products: linhas.map((l) => ({ price: "50", ...l })), ...over }) as unknown as Order;
const gravar = (os: Order[]) => gravarPedidos(db, storeId, os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
const produto = (id: number, nome: string): Product =>
  ({ id, name: { pt: nome }, published: true, categories: [], images: [{ id: id * 10, product_id: id, src: `https://x/${id}.jpg`, position: 1 }], variants: [{ id: id * 100, product_id: id, sku: `SKU${id}`, price: "50", stock_management: false, values: [{ pt: "P" }] }], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

describe("fila de expedição", () => {
  it("só pedidos pagos, abertos e não enviados, do mais antigo ao mais novo, com peças, SKU e foto", async () => {
    await upsertProducts(db, storeId, [produto(1, "Vestido Azul"), produto(2, "Saia Rosa")]);
    await gravar([
      pedido(1, [{ product_id: 1, variant_id: 100, quantity: 2, variant_values: ["P"] }], { created_at: diasAtras(5) }),
      pedido(2, [{ product_id: 2, quantity: 1 }], { created_at: diasAtras(1), shipping_status: "unshipped" }), // embalado, ainda a enviar
      pedido(3, [{ product_id: 1, quantity: 1 }], { shipping_status: "shipped" }),
      pedido(4, [{ product_id: 1, quantity: 1 }], { shipping_status: "delivered" }),
      pedido(5, [{ product_id: 1, quantity: 1 }], { payment_status: "pending" }),
      pedido(6, [{ product_id: 1, quantity: 1 }], { status: "cancelled" }),
      pedido(7, [{ product_id: 1, quantity: 1 }], { status: "closed" }),
    ]);
    const fila = await filaDeExpedicao(db, storeId, 3);
    expect(fila.map((p) => p.numero)).toEqual([1001, 1002]);
    expect(fila[0]).toMatchObject({ unidades: 2, atrasado: true, diasParado: 5, total: 100 });
    expect(fila[0]!.itens[0]).toMatchObject({ nome: "Vestido Azul", variacao: "P", sku: "SKU1", quantidade: 2, foto: "https://x/1.jpg" });
    expect(fila[1]).toMatchObject({ atrasado: false });
    expect((await filaDeExpedicao(db, storeId, 3, ["2"])).map((p) => p.numero)).toEqual([1002]);
    expect((await filaDeExpedicao(db, storeId, 1)).every((p) => p.atrasado)).toBe(true);
  });

  it("lista de separação soma as mesmas peças, ordena e lista os pedidos de cada uma", async () => {
    await upsertProducts(db, storeId, [produto(1, "Vestido Azul"), produto(2, "Saia Rosa")]);
    await gravar([
      pedido(1, [{ product_id: 1, variant_id: 100, quantity: 2, variant_values: ["P"] }, { product_id: 2, quantity: 1, variant_values: ["M"] }]),
      pedido(2, [{ product_id: 1, variant_id: 100, quantity: 3, variant_values: ["P"] }, { product_id: 1, quantity: 1, variant_values: ["G"] }]),
    ]);
    const lista = listaDeSeparacao(await filaDeExpedicao(db, storeId, 2));
    expect(lista.map((l) => [l.nome, l.variacao, l.quantidade, l.pedidos])).toEqual([
      ["Saia Rosa", "M", 1, [1001]],
      ["Vestido Azul", "G", 1, [1002]],
      ["Vestido Azul", "P", 5, [1001, 1002]],
    ]);
    expect(lista[2]!.foto).toBe("https://x/1.jpg");
  });
});

describe("lista de rastreios colada", () => {
  it("aceita ; tab vírgula e espaço, # no número, e normaliza o código", () => {
    const r = lerRastreios("1234;aa123456789br\n#1235\tBB123456789BR\n1236, cc123456789br\n1237 DD123456789BR\n\n");
    expect(r.problemas).toEqual([]);
    expect(r.validos).toEqual([
      { numero: 1234, codigo: "AA123456789BR" },
      { numero: 1235, codigo: "BB123456789BR" },
      { numero: 1236, codigo: "CC123456789BR" },
      { numero: 1237, codigo: "DD123456789BR" },
    ]);
  });
  it("aponta linha mal formada, número ou código inválido e pedido com dois códigos (nenhum dos dois vale)", () => {
    const r = lerRastreios("1234\nabc;AA123456789BR\n1236;123\n1237;AA123456789BR\n1237;BB123456789BR\n1238;CC123456789BR\n1238;CC123456789BR");
    expect(r.validos).toEqual([{ numero: 1238, codigo: "CC123456789BR" }]);
    expect(r.problemas.map((p) => p.motivo)).toEqual([
      "use “número do pedido” e “código de rastreio” na mesma linha",
      "número do pedido inválido",
      "código de rastreio inválido (5 a 40 letras e números)",
      "o pedido 1237 aparece com dois códigos diferentes",
    ]);
  });
});

describe("marcar como enviado", () => {
  function loja(pedidos: Order[], opts: { falha?: Record<number, Error> } = {}) {
    const mapa = new Map(pedidos.map((p) => [p.id, structuredClone(p)]));
    const fulfills: Array<{ id: number; codigo: string; notificar: boolean }> = [];
    const api: ApiExpedicao = {
      getOrder: async (id) => structuredClone(mapa.get(id)!),
      fulfillOrder: async (id, a) => {
        const falha = opts.falha?.[id];
        if (falha) throw falha;
        fulfills.push({ id, codigo: a.codigo, notificar: a.notificar });
        const o = mapa.get(id)!;
        o.shipping_status = "shipped";
        (o as Record<string, unknown>).shipping_tracking_number = a.codigo;
        return structuredClone(o);
      },
    };
    return { api, fulfills };
  }
  const estado = async (id: number) => (await pg.query<{ shipping_status: string; tracking_code: string | null }>("SELECT shipping_status, tracking_code FROM orders WHERE id = $1", [id])).rows[0]!;

  it("confere o pedido na loja, envia, atualiza o espelho e registra no Histórico só número e código", async () => {
    const pedidos = [pedido(1, [{ product_id: 1, quantity: 1 }]), pedido(2, [{ product_id: 1, quantity: 1 }])];
    await gravar(pedidos);
    const l = loja(pedidos);
    const r = await marcarComoEnviados(db, l.api, { storeId, actor, envios: [{ orderId: 1, codigo: "AA111111111BR" }, { orderId: 2, codigo: "BB222222222BR" }], notificar: true });
    expect(r.map((x) => [x.orderId, x.numero, x.ok])).toEqual([[1, 1001, true], [2, 1002, true]]);
    expect(l.fulfills).toEqual([{ id: 1, codigo: "AA111111111BR", notificar: true }, { id: 2, codigo: "BB222222222BR", notificar: true }]);
    expect(await estado(1)).toEqual({ shipping_status: "shipped", tracking_code: "AA111111111BR" });
    expect(await filaDeExpedicao(db, storeId, 2)).toHaveLength(0);
    const log = (await pg.query<{ acao: string; depois: Record<string, unknown>; sucesso: boolean }>("SELECT acao, depois, sucesso FROM audit_log ORDER BY id")).rows;
    expect(log[0]).toEqual({ acao: ACAO_ENVIAR, depois: { numero: 1001, rastreio: "AA111111111BR", notificou_cliente: true }, sucesso: true });
    expect(acaoLabel(ACAO_ENVIAR)).toBe("Pedido marcado como enviado");
  });

  it("pula o que a loja mostra já enviado, cancelado ou não pago, sem chamar o envio", async () => {
    const pedidos = [pedido(1, []), pedido(2, [], { status: "cancelled" }), pedido(3, [], { payment_status: "pending" })];
    await gravar(pedidos);
    const l = loja([pedido(1, [], { shipping_status: "shipped", shipping_tracking_number: "ZZ999999999BR" }), pedidos[1]!, pedidos[2]!]);
    const r = await marcarComoEnviados(db, l.api, { storeId, actor, envios: [1, 2, 3].map((id) => ({ orderId: id, codigo: "AA111111111BR" })), notificar: false });
    expect(r.map((x) => [x.ok, x.pulado])).toEqual([[false, true], [false, true], [false, true]]);
    expect(r[0]!.erro).toMatch(/já estava enviado/);
    expect(l.fulfills).toEqual([]);
    expect(await estado(1)).toEqual({ shipping_status: "shipped", tracking_code: "ZZ999999999BR" }); // o espelho foi corrigido
  });

  it("erro num pedido não trava os outros; sem permissão (403) para na hora", async () => {
    const pedidos = [pedido(1, []), pedido(2, []), pedido(3, []), pedido(4, [])];
    await gravar(pedidos);
    const l = loja(pedidos, { falha: { 2: new NuvemshopError("422", 422, null, "recusado"), 3: new NuvemshopError("403", 403, null) } });
    const r = await marcarComoEnviados(db, l.api, { storeId, actor, envios: [1, 2, 3, 4].map((id) => ({ orderId: id, codigo: "AA111111111BR" })), notificar: false });
    expect(r.map((x) => [x.orderId, x.ok])).toEqual([[1, true], [2, false], [3, false]]); // o 4 nem foi tentado
    const falhas = (await pg.query<{ sucesso: boolean }>("SELECT sucesso FROM audit_log WHERE sucesso = false")).rows;
    expect(falhas).toHaveLength(2);
    expect((await estado(4)).shipping_status).toBe("unpacked");
  });
});

describe("API de pedidos", () => {
  it("lê o pedido e marca como enviado com POST /orders/{id}/fulfill", async () => {
    const chamadas: string[] = [];
    const client = {
      get: async (p: string) => (chamadas.push(`GET ${p}`), { id: 9, number: 1009 }),
      post: async (p: string, b: unknown) => (chamadas.push(`POST ${p} ${JSON.stringify(b)}`), { id: 9, shipping_status: "shipped", shipping_tracking_number: "AA111111111BR" }),
    } as unknown as NuvemshopClient;
    expect((await getOrder(client, 9)).number).toBe(1009);
    expect((await fulfillOrder(client, 9, { codigo: "AA111111111BR", notificar: false })).shipping_status).toBe("shipped");
    await fulfillOrder(client, 9, { codigo: "AA111111111BR", url: "https://rastreio/AA", notificar: true });
    expect(chamadas).toEqual([
      "GET /orders/9",
      'POST /orders/9/fulfill {"shipping_tracking_number":"AA111111111BR","notify_customer":false}',
      'POST /orders/9/fulfill {"shipping_tracking_number":"AA111111111BR","shipping_tracking_url":"https://rastreio/AA","notify_customer":true}',
    ]);
  });

  it("o código de rastreio vindo da loja entra no espelho e não é apagado por uma atualização sem ele", async () => {
    await gravar([pedido(1, [], { shipping_tracking_number: "AA111111111BR", shipping_status: "shipped" })]);
    expect((await pg.query<{ tracking_code: string }>("SELECT tracking_code FROM orders WHERE id = 1")).rows[0]!.tracking_code).toBe("AA111111111BR");
    await gravar([pedido(1, [], { shipping_status: "shipped" })]);
    expect((await pg.query<{ tracking_code: string }>("SELECT tracking_code FROM orders WHERE id = 1")).rows[0]!.tracking_code).toBe("AA111111111BR");
  });
});
