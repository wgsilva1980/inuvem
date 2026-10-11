import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { contarPosVenda, marcarAvisada, pedidosParaPosVenda, resultadoDoPosVenda } from "@/lib/postsale/repo";
import { ESPERA_PADRAO, ehTipo, esperaValida, mensagemDePosVenda } from "@/lib/postsale/rules";
import { PosVendaErro, mensagemDoPedido, registrarAvisoPosVenda } from "@/lib/postsale/service";
import { acaoLabel } from "@/lib/history/labels";

describe("regras do pós-venda (puras)", () => {
  it("só aceita as esperas conhecidas e os tipos de mensagem", () => {
    expect(esperaValida("10")).toBe(10);
    expect(esperaValida("3")).toBe(ESPERA_PADRAO);
    expect(esperaValida(undefined)).toBe(ESPERA_PADRAO);
    expect(ehTipo("avaliacao") && ehTipo("tudo-certo") && !ehTipo("promocao")).toBe(true);
  });

  it("mensagens fixas: citam o pedido e o envio, sem cupom, desconto, prazo ou valor", () => {
    const a = mensagemDePosVenda({ tipo: "tudo-certo", primeiroNome: "Ana", numero: 1234, diasDesdeEnvio: 8 });
    expect(a).toMatch(/^Oi, Ana!/);
    expect(a).toContain("pedido #1234");
    expect(a).toContain("foi enviado há 8 dias");
    const b = mensagemDePosVenda({ tipo: "avaliacao", primeiroNome: null, numero: null, diasDesdeEnvio: 1 });
    expect(b).toMatch(/^Olá!/);
    expect(b).toContain("Seu pedido foi enviado ontem");
    for (const m of [a, b, mensagemDePosVenda({ tipo: "avaliacao", primeiroNome: "Bia", numero: 5, diasDesdeEnvio: 0 })]) expect(m).not.toMatch(/R\$|cupom|desconto|%|grátis/i);
    expect(mensagemDePosVenda({ tipo: "tudo-certo", primeiroNome: "X", numero: 1, diasDesdeEnvio: 0 })).toContain("foi enviado hoje");
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

const ago = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
async function cliente(id: number, over: { marketing?: boolean | null; phone?: string | null; ignored?: boolean } = {}) {
  await pg.query("INSERT INTO customers (store_id, id, name, email, phone, accepts_marketing, ignored, city, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Belo Horizonte', 'MG')", [
    storeId, id, `Ana Souza ${id}`, `c${id}@x.com`, over.phone === undefined ? "11912345678" : over.phone, over.marketing === undefined ? true : over.marketing, over.ignored ?? false,
  ]);
}
async function pedido(id: number, cliente: number, o: { enviadoHa?: number | null; total?: number; status?: string; pagamento?: string; envio?: string | null; criadoHa?: number } = {}) {
  const enviadoHa = o.enviadoHa === undefined ? 10 : o.enviadoHa;
  await pg.query(
    "INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status, shipping_status, customer_id, updated_at_remote) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [storeId, id, 1000 + id, ago(o.criadoHa ?? (enviadoHa ?? 0) + 3), o.total ?? 100, o.status ?? "open", o.pagamento ?? "paid", o.envio === undefined ? "delivered" : o.envio, cliente, enviadoHa === null ? null : ago(enviadoHa)],
  );
}
const ids = async (dias = 7) => (await pedidosParaPosVenda(db, storeId, dias)).map((p) => p.orderId);

describe("quem entra no pós-venda", () => {
  it("só pedidos pagos, não cancelados, enviados na faixa, de clientes que aceitam contato", async () => {
    for (const c of [1, 2, 3, 5, 6]) await cliente(c);
    await cliente(4, { marketing: false });
    await pedido(101, 1, { enviadoHa: 10 }); // entra
    await pedido(102, 2, { enviadoHa: 3 }); // enviado há pouco
    await pedido(103, 3, { enviadoHa: 60 }); // velho demais
    await pedido(104, 4, { enviadoHa: 10 }); // recusou contato
    await pedido(105, 5, { enviadoHa: 10, envio: "unpacked" }); // ainda não enviado
    await pedido(106, 6, { enviadoHa: 10, status: "cancelled" }); // cancelado
    expect(await ids(7)).toEqual(["101"]);
    expect(await ids(15)).toEqual([]); // enviado há 10 dias não chega a 15
    expect(await contarPosVenda(db, storeId, 7)).toBe(1);
  });

  it("um pedido por cliente (o enviado mais recentemente) e das maiores compras para as menores", async () => {
    for (const c of [7, 8, 9]) await cliente(c);
    await pedido(701, 7, { enviadoHa: 12, total: 100 });
    await pedido(702, 7, { enviadoHa: 8, total: 300, criadoHa: 12 });
    await pedido(801, 8, { enviadoHa: 9, total: 500 });
    await pedido(901, 9, { enviadoHa: 9, total: 50 });
    const l = await pedidosParaPosVenda(db, storeId, 7);
    expect(l.map((p) => [p.orderId, p.numero, p.total])).toEqual([["801", 1801, 500], ["702", 1702, 300], ["901", 1901, 50]]);
    expect(l.find((p) => p.orderId === "702")).toMatchObject({ diasDesdeEnvio: 8, temWhatsapp: true, temEmail: true, cidade: "Belo Horizonte", uf: "MG" });
  });

  it("quem já comprou de novo depois não precisa de pós-venda", async () => {
    await cliente(1);
    await pedido(101, 1, { enviadoHa: 15, criadoHa: 20 });
    await pedido(102, 1, { enviadoHa: null, criadoHa: 5, envio: null });
    expect(await ids()).toEqual([]);
  });

  it("o dia do envio vem do Histórico quando o painel marcou o envio (a Nuvemshop pode não atualizar o pedido)", async () => {
    await cliente(10);
    await pedido(1001, 10, { enviadoHa: 50, criadoHa: 52 });
    expect(await ids()).toEqual([]); // pela atualização do pedido, 50 dias: velho demais
    await pg.query("INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, sucesso, created_at) VALUES ($1, 'a@b.com', 'pedido.enviar', 'pedido', '1001', true, $2)", [storeId, ago(9)]);
    expect((await pedidosParaPosVenda(db, storeId, 7)).map((p) => [p.orderId, p.diasDesdeEnvio])).toEqual([["1001", 9]]);
  });

  it("ignorada em Contatos e já avisada nos últimos 30 dias ficam de fora", async () => {
    await cliente(1);
    await cliente(2, { ignored: true });
    await cliente(3);
    await pedido(101, 1);
    await pedido(102, 2);
    await pedido(103, 3);
    expect(await ids()).toEqual(expect.arrayContaining(["101", "103"]));
    expect(await ids()).toHaveLength(2);
    await marcarAvisada(db, storeId, "101", "1", actor);
    expect(await ids()).toEqual(["103"]);
    await pg.query("UPDATE postsale_contacts SET contacted_at = $1 WHERE order_id = 101", [ago(31)]);
    expect((await ids()).sort()).toEqual(["101", "103"]); // depois de 30 dias volta
  });
});

describe("mensagem, aviso e resultado", () => {
  it("monta o texto com o pedido e os links de contato; recusou contato não gera mensagem", async () => {
    await cliente(1);
    await cliente(2, { marketing: false });
    await pedido(101, 1, { enviadoHa: 10 });
    await pedido(102, 2, { enviadoHa: 10 });
    const m = await mensagemDoPedido(db, { storeId, orderId: "101", tipo: "tudo-certo" });
    expect(m.mensagem).toContain("pedido #1101");
    expect(m.mensagem).toContain("foi enviado há 10 dias");
    expect(m.whatsapp).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=/);
    expect(m.email).toMatch(/^mailto:c1@x\.com\?subject=/);
    await expect(mensagemDoPedido(db, { storeId, orderId: "102", tipo: "avaliacao" })).rejects.toThrow(/não aceita/);
    await expect(mensagemDoPedido(db, { storeId, orderId: "999", tipo: "avaliacao" })).rejects.toBeInstanceOf(PosVendaErro);
  });

  it("marcar como feito registra só o fato no Histórico (sem nome nem contato)", async () => {
    await cliente(1);
    await pedido(101, 1);
    await registrarAvisoPosVenda(db, { storeId, actor, orderId: "101" });
    const log = (await pg.query("SELECT acao, entidade_id, depois FROM audit_log WHERE acao = 'posvenda.avisar'")).rows;
    expect(log).toEqual([{ acao: "posvenda.avisar", entidade_id: "101", depois: {} }]);
    expect(acaoLabel("posvenda.avisar")).toMatch(/Pós-venda/);
    await expect(registrarAvisoPosVenda(db, { storeId, actor, orderId: "999" })).rejects.toBeInstanceOf(PosVendaErro);
  });

  it("resultado: quantas avisadas fizeram um novo pedido pago depois do aviso", async () => {
    for (const c of [1, 2]) await cliente(c);
    await pedido(101, 1, { enviadoHa: 20, criadoHa: 25 });
    await pedido(201, 2, { enviadoHa: 20, criadoHa: 25 });
    await marcarAvisada(db, storeId, "101", "1", actor);
    await marcarAvisada(db, storeId, "201", "2", actor);
    await pg.query("UPDATE postsale_contacts SET contacted_at = $1", [ago(10)]);
    await pedido(102, 1, { enviadoHa: null, criadoHa: 2, envio: null, total: 250 });
    expect(await resultadoDoPosVenda(db, storeId)).toEqual({ avisadas: 2, voltaram: 1, faturamento: 250 });
  });
});
