import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { Order } from "@/lib/nuvemshop/orders";
import { mapearPedido } from "@/lib/orders/map";
import { gravarPedidos } from "@/lib/orders/sync";
import { clientesInativas, contarInativas, resultadoDaReativacao } from "@/lib/reactivation/repo";
import { DIAS_PADRAO, diasValidos, mensagemDeReativacao, primeiroNome } from "@/lib/reactivation/rules";
import { ClienteNaoEncontradaError, mensagemParaCliente, registrarAviso } from "@/lib/reactivation/service";
import { acaoLabel } from "@/lib/history/labels";

describe("regras da reativação (puras)", () => {
  it("só aceita as faixas de dias conhecidas", () => {
    expect(diasValidos("120")).toBe(120);
    expect(diasValidos("7")).toBe(DIAS_PADRAO);
    expect(diasValidos(undefined)).toBe(DIAS_PADRAO);
    expect(diasValidos("abc")).toBe(DIAS_PADRAO);
  });

  it("primeiro nome: capitaliza e descarta o que não parece nome", () => {
    expect(primeiroNome("  ANA   souza ")).toBe("Ana");
    expect(primeiroNome("maria.silva@x.com")).toBeNull();
    expect(primeiroNome("Cliente 123")).toBe("Cliente");
    expect(primeiroNome("")).toBeNull();
    expect(primeiroNome(null)).toBeNull();
  });

  it("mensagem fixa: sem cupom, sem prazo e sem valor", () => {
    const m = mensagemDeReativacao({ primeiroNome: "Ana" });
    expect(m).toMatch(/^Oi, Ana!/);
    expect(m).not.toMatch(/R\$|cupom|desconto|%/i);
    expect(mensagemDeReativacao({ primeiroNome: null })).toMatch(/^Olá!/);
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
const pedido = (id: number, cliente: number, dias: number, over: Record<string, unknown> = {}): Order =>
  ({ id, number: 1000 + id, created_at: diasAtras(dias), total: "100.00", discount: "0", status: "open", payment_status: "paid", shipping_status: "delivered", customer: { id: cliente }, products: [{ product_id: 1, variant_id: 1, quantity: 1, price: "100" }], ...over }) as unknown as Order;
const gravar = (os: Order[]) => gravarPedidos(db, storeId, os.map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
const cliente = (id: number, over: { name?: string; email?: string | null; phone?: string | null; marketing?: boolean | null; ignored?: boolean } = {}) =>
  pg.query(`INSERT INTO customers (store_id, id, name, email, phone, accepts_marketing, ignored, city, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Belo Horizonte', 'MG')`, [
    storeId, id, over.name ?? `Cliente ${id}`, over.email === undefined ? `c${id}@x.com` : over.email, over.phone === undefined ? "11912345678" : over.phone, over.marketing === undefined ? true : over.marketing, over.ignored ?? false,
  ]);

describe("clientes inativas", () => {
  it("só quem comprou e passou do prazo, das que mais gastaram para as que menos", async () => {
    await gravar([
      pedido(1, 10, 200), pedido(2, 10, 150, { total: "300.00" }), // 10: última há 150 dias, gastou 400
      pedido(3, 11, 100), // 11: há 100 dias, gastou 100
      pedido(4, 12, 20), // 12: comprou há 20 dias (ativa)
      pedido(5, 13, 300, { payment_status: "pending" }), // pedido não pago não conta como compra
      pedido(6, 14, 300, { status: "cancelled" }), // cancelado também não
      pedido(7, 15, 300, { customer: null }), // sem cliente identificada
    ]);
    for (const id of [10, 11, 12, 13, 14]) await cliente(id);
    const r = await clientesInativas(db, storeId, 90);
    expect(r.map((c) => c.id)).toEqual(["10", "11"]);
    expect(r[0]).toMatchObject({ pedidos: 2, totalGasto: 400, diasSemComprar: 150, cidade: "Belo Horizonte", uf: "MG", temWhatsapp: true, temEmail: true });
    expect(await contarInativas(db, storeId, 90)).toBe(2);
    expect((await clientesInativas(db, storeId, 120)).map((c) => c.id)).toEqual(["10"]);
  });

  it("não lista quem recusou contato nem quem foi ignorada em Contatos; sem cadastro ainda aparece", async () => {
    await gravar([pedido(1, 10, 200), pedido(2, 11, 200), pedido(3, 12, 200), pedido(4, 13, 200)]);
    await cliente(10, { marketing: false });
    await cliente(11, { ignored: true });
    await cliente(12, { marketing: null }); // não informado: pode
    // 13 não está no espelho de clientes
    const r = await clientesInativas(db, storeId, 90);
    expect(r.map((c) => c.id).sort()).toEqual(["12", "13"]);
    expect(r.find((c) => c.id === "13")).toMatchObject({ nome: "Cliente 13", temWhatsapp: false, temEmail: false });
  });

  it("avisada some da lista por 30 dias e depois volta", async () => {
    await gravar([pedido(1, 10, 200)]);
    await cliente(10);
    expect((await clientesInativas(db, storeId, 90)).length).toBe(1);
    await registrarAviso(db, { storeId, actor, customerId: "10" });
    expect(await clientesInativas(db, storeId, 90)).toEqual([]);
    expect(await contarInativas(db, storeId, 90)).toBe(0);
    await pg.query("UPDATE reactivation_contacts SET contacted_at = now() - interval '31 days'");
    expect((await clientesInativas(db, storeId, 90)).length).toBe(1);
  });
});

describe("resultado", () => {
  it("conta quem fez pedido pago depois do aviso", async () => {
    await gravar([pedido(1, 10, 200), pedido(2, 11, 200), pedido(3, 11, 2, { total: "250.00" }), pedido(4, 12, 200), pedido(5, 12, 2, { payment_status: "pending" })]);
    for (const id of [10, 11, 12]) await cliente(id);
    await pg.query(`INSERT INTO reactivation_contacts (store_id, customer_id, contacted_at) VALUES ($1, 10, now() - interval '5 days'), ($1, 11, now() - interval '5 days'), ($1, 12, now() - interval '5 days')`, [storeId]);
    // o pedido 3 (cliente 11) é de 2 dias atrás, depois do aviso; o 5 (cliente 12) não foi pago
    expect(await resultadoDaReativacao(db, storeId)).toEqual({ avisadas: 3, voltaram: 1, faturamento: 250 });
  });

  it("aviso antigo (mais de 90 dias) não entra", async () => {
    await pg.query(`INSERT INTO reactivation_contacts (store_id, customer_id, contacted_at) VALUES ($1, 10, now() - interval '100 days')`, [storeId]);
    expect(await resultadoDaReativacao(db, storeId)).toEqual({ avisadas: 0, voltaram: 0, faturamento: 0 });
  });
});

describe("mensagem e aviso", () => {
  it("monta o texto e os links com o contato do espelho; não guarda nada", async () => {
    await cliente(10, { name: "ANA SOUZA" });
    const m = await mensagemParaCliente(db, { storeId, customerId: "10" });
    expect(m.mensagem).toMatch(/^Oi, Ana!/);
    expect(m.whatsapp).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=/);
    expect(m.email).toMatch(/^mailto:c10@x\.com\?subject=/);
    expect((await pg.query("SELECT count(*)::int AS n FROM reactivation_contacts")).rows[0]).toEqual({ n: 0 });
  });

  it("sem telefone ou e-mail devolve só o que existe", async () => {
    await cliente(10, { phone: null, email: null });
    expect(await mensagemParaCliente(db, { storeId, customerId: "10" })).toMatchObject({ whatsapp: null, email: null });
  });

  it("recusa quem não aceita marketing, quem foi ignorada e quem não existe", async () => {
    await cliente(10, { marketing: false });
    await cliente(11, { ignored: true });
    await expect(mensagemParaCliente(db, { storeId, customerId: "10" })).rejects.toBeInstanceOf(ClienteNaoEncontradaError);
    await expect(mensagemParaCliente(db, { storeId, customerId: "11" })).rejects.toBeInstanceOf(ClienteNaoEncontradaError);
    await expect(mensagemParaCliente(db, { storeId, customerId: "99" })).rejects.toBeInstanceOf(ClienteNaoEncontradaError);
    await expect(registrarAviso(db, { storeId, actor, customerId: "99" })).rejects.toBeInstanceOf(ClienteNaoEncontradaError);
  });

  it("o Histórico registra só o fato, sem nome nem contato", async () => {
    await cliente(10, { name: "Ana Souza", email: "ana@x.com" });
    await registrarAviso(db, { storeId, actor, customerId: "10" });
    const rows = (await pg.query("SELECT acao, entidade, entidade_id, depois FROM audit_log")).rows;
    expect(rows).toEqual([{ acao: "reativacao.avisar", entidade: "cliente", entidade_id: "10", depois: {} }]);
    expect(JSON.stringify(rows)).not.toMatch(/Ana|ana@x/);
    expect(acaoLabel("reativacao.avisar")).toMatch(/avisada/);
  });
});
