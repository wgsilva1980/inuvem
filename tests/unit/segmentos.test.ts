import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { csvDoSegmento } from "@/lib/segments/exportar";
import { SEGMENTO_IDS, alcancavel, classificar, ehSegmento, limiteDoTicket, resumir, type ClienteAgregada } from "@/lib/segments/regras";
import { clientesAgregadas } from "@/lib/segments/repo";
import { acaoLabel } from "@/lib/history/labels";

const AGORA = new Date("2026-10-11T12:00:00Z");
const ago = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000).toISOString();
const c = (id: number, o: Partial<ClienteAgregada> = {}): ClienteAgregada => ({
  id: String(id), nome: `Cliente ${id}`, email: `c${id}@x.com`, telefone: "11912345678", cidade: "Belo Horizonte", uf: "MG", recusouContato: false,
  pedidos: 2, gasto: 200, primeiraCompra: ago(200), ultimaCompra: ago(100), mesesComCompra6: 1, ...o,
});

describe("classificação", () => {
  it("frequentes: 3 ou mais meses com compra nos últimos 6", () => {
    const por = classificar([c(1, { mesesComCompra6: 3 }), c(2, { mesesComCompra6: 2 })], AGORA);
    expect(por.frequentes.map((x) => x.id)).toEqual(["1"]);
  });

  it("uma compra só: um pedido e há mais de 30 dias", () => {
    const por = classificar([c(1, { pedidos: 1, ultimaCompra: ago(45) }), c(2, { pedidos: 1, ultimaCompra: ago(10) }), c(3, { pedidos: 2, ultimaCompra: ago(90) })], AGORA);
    expect(por["uma-compra"].map((x) => x.id)).toEqual(["1"]);
  });

  it("novas: primeira compra nos últimos 60 dias", () => {
    const por = classificar([c(1, { primeiraCompra: ago(59) }), c(2, { primeiraCompra: ago(61) })], AGORA);
    expect(por.novas.map((x) => x.id)).toEqual(["1"]);
  });

  it("maior ticket: ticket médio no topo 10%, e só com clientes suficientes para o percentil valer", () => {
    expect(limiteDoTicket([c(1), c(2)])).toBeNull();
    expect(classificar([c(1, { gasto: 9999 }), c(2)], AGORA)["maior-ticket"]).toEqual([]);
    const dez = Array.from({ length: 10 }, (_, i) => c(i + 1, { pedidos: 1, gasto: (i + 1) * 100, primeiraCompra: ago(300), ultimaCompra: ago(300) }));
    expect(limiteDoTicket(dez)).toBe(1000);
    expect(classificar(dez, AGORA)["maior-ticket"].map((x) => x.id)).toEqual(["10"]);
    // ticket médio, não o total: muitos pedidos pequenos não entram
    const mix = [...dez.slice(0, 9), c(10, { pedidos: 20, gasto: 2000 })];
    expect(classificar(mix, AGORA)["maior-ticket"].map((x) => x.id)).toEqual(["9"]);
  });

  it("uma cliente pode estar em mais de um grupo; cada grupo vem das que mais gastaram", () => {
    const por = classificar([c(1, { pedidos: 1, gasto: 50, primeiraCompra: ago(40), ultimaCompra: ago(40) }), c(2, { pedidos: 1, gasto: 300, primeiraCompra: ago(35), ultimaCompra: ago(35) })], AGORA);
    expect(por.novas.map((x) => x.id)).toEqual(["2", "1"]);
    expect(por["uma-compra"].map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("resumo: clientes, total, ticket e quantas dá para contatar", () => {
    const por = classificar([c(1, { pedidos: 1, gasto: 100, primeiraCompra: ago(40), ultimaCompra: ago(40) }), c(2, { pedidos: 1, gasto: 300, primeiraCompra: ago(40), ultimaCompra: ago(40), recusouContato: true }), c(3, { pedidos: 1, gasto: 200, primeiraCompra: ago(40), ultimaCompra: ago(40), email: null, telefone: null })], AGORA);
    expect(resumir(por).find((r) => r.id === "novas")).toEqual({ id: "novas", clientes: 3, gasto: 600, ticket: 200, alcancaveis: 1 });
    expect(SEGMENTO_IDS).toHaveLength(4);
    expect(ehSegmento("novas") && !ehSegmento("vip")).toBe(true);
    expect(alcancavel(c(9, { recusouContato: true }))).toBe(false);
  });
});

describe("exportação em CSV", () => {
  const lista = [c(1, { nome: "=HYPERLINK(\"x\")", gasto: 300, pedidos: 2 }), c(2, { recusouContato: true }), c(3, { email: null, telefone: null }), c(4, { email: null, telefone: "11999990000" })];

  it("sem contatos não leva nenhum dado pessoal", () => {
    const r = csvDoSegmento("novas", lista, { contatos: false });
    expect(r.linhas).toBe(4);
    const [cab, primeira] = r.conteudo.replace("﻿", "").split("\r\n");
    expect(cab).toBe("Segmento;ID da cliente;Pedidos;Total gasto;Ticket médio;Primeira compra;Última compra");
    expect(primeira).toContain("Novas clientes;1;2;300,00;150,00;");
    expect(r.conteudo).not.toMatch(/@x\.com|11912345678|HYPERLINK|Belo Horizonte/);
  });

  it("com contatos leva só quem aceita contato e tem telefone ou e-mail, e protege contra fórmulas do Excel", () => {
    const r = csvDoSegmento("frequentes", lista, { contatos: true });
    expect(r.linhas).toBe(2);
    const linhas = r.conteudo.replace("﻿", "").trim().split("\r\n");
    expect(linhas[0]).toBe("Segmento;ID da cliente;Nome;E-mail;Telefone;Cidade;UF;Pedidos;Total gasto;Ticket médio;Primeira compra;Última compra");
    expect(linhas[1]).toContain("'=HYPERLINK");
    expect(linhas[2]).toContain("Compram com frequência;4;Cliente 4;;11999990000;");
    expect(r.conteudo).not.toMatch(/c2@x\.com|cpf/i);
  });

  it("corta em 10.000 linhas e avisa", () => {
    const muitas = Array.from({ length: 10_005 }, (_, i) => c(i + 1));
    const r = csvDoSegmento("novas", muitas, { contatos: false });
    expect(r).toMatchObject({ linhas: 10_000, truncado: true });
  });

  it("o Histórico tem rótulo para a exportação", () => {
    expect(acaoLabel("segmentos.exportar")).toMatch(/segmento/i);
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
});

describe("agregação dos pedidos por cliente", () => {
  const pedido = (id: number, cliente: number, dias: number, total: number, over: { status?: string; pagamento?: string } = {}) =>
    pg.query("INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status, customer_id) VALUES ($1, $2, $8, $3, $4, $5, $6, $7)", [storeId, id, new Date(Date.now() - dias * 86_400_000).toISOString(), total, over.status ?? "closed", over.pagamento ?? "paid", cliente, 1000 + id]);

  it("soma só pedidos pagos e não cancelados, conta os meses distintos e liga ao cadastro; ignoradas ficam de fora", async () => {
    await pg.query("INSERT INTO customers (store_id, id, name, email, phone, accepts_marketing, ignored, city, state) VALUES ($1, 1, 'Ana', 'a@x.com', '11912345678', true, false, 'BH', 'MG'), ($1, 2, 'Bia', NULL, NULL, false, false, NULL, NULL), ($1, 3, 'Cris', 'c@x.com', NULL, true, true, NULL, NULL)", [storeId]);
    await pedido(1, 1, 5, 100);
    await pedido(2, 1, 40, 200);
    await pedido(3, 1, 75, 300);
    await pedido(4, 1, 20, 999, { status: "cancelled" }); // não conta
    await pedido(5, 1, 10, 999, { pagamento: "pending" }); // não conta
    await pedido(6, 2, 90, 80);
    await pedido(7, 3, 10, 50); // ignorada
    await pg.query("INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status, customer_id) VALUES ($1, 8, 1008, now(), 70, 'closed', 'paid', NULL)", [storeId]); // sem cliente
    const l = await clientesAgregadas(db, storeId);
    expect(l.map((x) => x.id)).toEqual(["1", "2"]);
    expect(l[0]).toMatchObject({ nome: "Ana", email: "a@x.com", telefone: "11912345678", cidade: "BH", uf: "MG", pedidos: 3, gasto: 600, recusouContato: false });
    expect(l[0]!.mesesComCompra6).toBeGreaterThanOrEqual(2);
    expect(l[1]).toMatchObject({ nome: "Bia", email: null, telefone: null, recusouContato: true, pedidos: 1, gasto: 80 });
    expect(Date.parse(l[0]!.primeiraCompra)).toBeLessThan(Date.parse(l[0]!.ultimaCompra));
  });

  it("cliente sem cadastro sincronizado aparece sem nome e sem contato", async () => {
    await pedido(1, 77, 5, 100);
    const [x] = await clientesAgregadas(db, storeId);
    expect(x).toMatchObject({ id: "77", nome: "Cliente 77", email: null, telefone: null, recusouContato: false });
    expect(alcancavel(x!)).toBe(false);
  });
});
