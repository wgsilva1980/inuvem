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
import { camposRecebidos, verificarCampos } from "@/lib/diagnostico/campos";
import { conferirWebhooks, executarDiagnostico, executarSonda, relatorioTexto, valoresDePedidos } from "@/lib/diagnostico/executar";
import { EXIGENCIAS, SONDAS, escopoConcedido } from "@/lib/diagnostico/sondas";
import { acaoLabel } from "@/lib/history/labels";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/handler";

describe("verificação de campos", () => {
  const e = (caminho: string, obrigatorio = true) => ({ caminho, obrigatorio, uso: "x" });

  it("acha campos simples, aninhados e dentro de listas, e informa o tipo", () => {
    const amostra = { id: 1, customer: { id: 9, name: "Ana" }, products: [{ product_id: 5, price: "10.00" }, { product_id: 6 }], vazio: "", nulo: null };
    const r = verificarCampos([amostra], [e("id"), e("customer.id"), e("customer.phone"), e("products[].price"), e("products[].quantity"), e("vazio"), e("nulo"), e("nao.existe")]);
    expect(r.map((x) => [x.caminho, x.presente, x.tipo])).toEqual([
      ["id", true, "number"],
      ["customer.id", true, "number"],
      ["customer.phone", false, null],
      ["products[].price", true, "string"],
      ["products[].quantity", false, null],
      ["vazio", false, null],
      ["nulo", false, null],
      ["nao.existe", false, null],
    ]);
  });

  it("alternativas com | e várias amostras (basta uma ter o campo)", () => {
    const r = verificarCampos([{ id: 1 }, { asunto: "Oi", content: { pt: "x" } }], [e("subject|asunto"), e("body|content"), e("type|key")]);
    expect(r.map((x) => x.presente)).toEqual([true, true, false]);
    expect(r[1]!.tipo).toBe("object");
  });

  it("nunca devolve valores, só nomes e tipos", () => {
    const r = verificarCampos([{ customer: { name: "Ana Souza", phone: "11912345678" } }], [e("customer.name"), e("customer.phone")]);
    expect(JSON.stringify(r)).not.toMatch(/Ana|Souza|912345678/);
    expect(camposRecebidos([{ b: 1, a: 2 }, { c: 3 }, null, [1]])).toEqual(["a", "b", "c"]);
  });
});

describe("permissões", () => {
  it("write cobre read, mas read não cobre write", () => {
    expect(escopoConcedido(["write_products"], "read_products")).toBe(true);
    expect(escopoConcedido(["read_products"], "write_products")).toBe(false);
    expect(escopoConcedido(["read_orders", "write_orders"], "write_orders")).toBe(true);
    expect(escopoConcedido([], "read_orders")).toBe(false);
    expect(EXIGENCIAS.length).toBeGreaterThan(5);
  });

  it("as sondas têm ids e caminhos únicos e campos obrigatórios", () => {
    expect(new Set(SONDAS.map((s) => s.id)).size).toBe(SONDAS.length);
    expect(new Set(SONDAS.map((s) => s.caminho)).size).toBe(SONDAS.length);
    for (const s of SONDAS) expect(s.esperados.some((c) => c.obrigatorio)).toBe(true);
  });
});

/** Cliente falso: `/caminho` -> lista, objeto ou erro. */
function cliente(respostas: Record<string, unknown>) {
  const chamadas: string[] = [];
  const resp = (path: string) => {
    chamadas.push(path);
    const r = respostas[path];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new NuvemshopError("404", 404, null);
    return r;
  };
  const c = {
    get: async (path: string) => resp(path),
    getPage: async (path: string) => ({ items: resp(path) as unknown[], total: null, nextPage: null }),
  } as unknown as NuvemshopClient;
  return { c, chamadas };
}
const sonda = (id: string) => SONDAS.find((s) => s.id === id)!;

describe("uma leitura de teste", () => {
  const pedidoCompleto = { id: 1, number: 10, created_at: "2026-10-01T00:00:00Z", total: "100.00", discount: "0", status: "open", payment_status: "paid", shipping_status: "unpacked", customer: { id: 9, name: "Ana", phone: "119", email: "a@b.c" }, products: [{ product_id: 1, variant_id: 2, quantity: 1, price: "100.00", variant_values: ["Azul"] }], shipping_tracking_number: "AB1" };

  it("ok quando tudo chega", async () => {
    const r = await executarSonda(cliente({ "/orders": [pedidoCompleto] }).c, sonda("pedidos"));
    expect(r).toMatchObject({ status: "ok", itensLidos: 1 });
  });

  it("ok com aviso de opcionais quando só faltam campos opcionais", async () => {
    const { customer, ...semCliente } = pedidoCompleto;
    void customer;
    const r = await executarSonda(cliente({ "/orders": [{ ...semCliente, customer: { id: 9 } }] }).c, sonda("pedidos"));
    expect(r.status).toBe("ok");
    expect(r.mensagem).toMatch(/opcionais não vieram.*customer\.name/);
  });

  it("aviso quando falta campo obrigatório, e mostra o que a loja devolveu", async () => {
    const { shipping_status, ...sem } = pedidoCompleto;
    void shipping_status;
    const r = await executarSonda(cliente({ "/orders": [sem] }).c, sonda("pedidos"));
    expect(r.status).toBe("aviso");
    expect(r.mensagem).toMatch(/shipping_status/);
    expect(r.recebidos).toContain("payment_status");
  });

  it("sem dados, sem permissão, inexistente e erro", async () => {
    expect((await executarSonda(cliente({ "/coupons": [] }).c, sonda("cupons"))).status).toBe("sem_dados");
    expect((await executarSonda(cliente({ "/customers": new NuvemshopError("403", 403, null) }).c, sonda("clientes"))).status).toBe("sem_permissao");
    expect((await executarSonda(cliente({}).c, sonda("emails"))).status).toBe("indisponivel");
    const erro = await executarSonda(cliente({ "/pages": new NuvemshopError("500", 500, null, "caiu") }).c, sonda("paginas"));
    expect(erro.status).toBe("erro");
    expect((await executarSonda(cliente({ "/pages": new Error("rede") }).c, sonda("paginas"))).status).toBe("erro");
  });

  it("recurso de objeto único (/store)", async () => {
    const r = await executarSonda(cliente({ "/store": { id: 1, name: { pt: "Loja" }, original_domain: "x.com" } }).c, sonda("loja"));
    expect(r.status).toBe("ok");
  });
});

describe("webhooks e diagnóstico completo", () => {
  it("lista os webhooks que faltam", async () => {
    const ok = await conferirWebhooks(cliente({ "/webhooks": WEBHOOK_EVENTS.map((event, id) => ({ id, event, url: "u" })) }).c);
    expect(ok.status).toBe("ok");
    const falta = await conferirWebhooks(cliente({ "/webhooks": [{ id: 1, event: "product/created", url: "u" }] }).c);
    expect(falta).toMatchObject({ status: "aviso" });
    expect(falta.faltando).toContain("category/deleted");
    expect((await conferirWebhooks(cliente({ "/webhooks": new NuvemshopError("403", 403, null) }).c)).status).toBe("erro");
  });

  it("roda todas as sondas só com GET, e o relatório não traz valores nem dados pessoais", async () => {
    const { c, chamadas } = cliente({
      "/store": { id: 1, name: { pt: "Minha Loja Secreta" } },
      "/orders": [{ id: 1, total: "100.00", customer: { id: 9, name: "Ana Souza", email: "ana@x.com", phone: "11912345678" } }],
      "/customers": [{ id: 3, name: "Bia Lima", email: "bia@x.com" }],
      "/webhooks": [],
    });
    const d = await executarDiagnostico(c);
    expect(d.sondas.map((s) => s.id)).toEqual(SONDAS.map((s) => s.id));
    expect(new Set(chamadas)).toEqual(new Set([...SONDAS.map((s) => s.caminho), "/webhooks"]));
    const texto = relatorioTexto(d);
    expect(texto).not.toMatch(/Ana Souza|ana@x|912345678|Bia Lima|Minha Loja Secreta/);
    expect(texto).toMatch(/\[Faltam campos\] Pedidos/);
    expect(texto).toMatch(/\[Não existe na API\] Cupons/);
    expect(acaoLabel("diagnostico.api")).toMatch(/Diagnóstico/);
  });
});

describe("valores observados nos pedidos", () => {
  let pg: PGlite;
  let db: Db;
  let storeId: string;
  beforeEach(async () => {
    pg = new PGlite();
    db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
    await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
    storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  });

  it("conta cada valor de pagamento, situação e envio", async () => {
    const p = (id: number, over: Record<string, unknown>) => ({ id, number: id, created_at: "2026-10-01T10:00:00Z", total: "10", status: "open", payment_status: "paid", shipping_status: "unpacked", products: [], ...over }) as unknown as Order;
    await gravarPedidos(db, storeId, [p(1, {}), p(2, {}), p(3, { shipping_status: "shipped" }), p(4, { payment_status: "pending", status: "cancelled" })].map(mapearPedido).filter((m): m is NonNullable<typeof m> => m !== null));
    const v = await valoresDePedidos(db, storeId);
    expect(v.pagamento).toEqual([{ valor: "paid", pedidos: 3 }, { valor: "pending", pedidos: 1 }]);
    expect(v.envio[0]).toEqual({ valor: "unpacked", pedidos: 3 });
    expect(v.situacao.map((x) => x.valor).sort()).toEqual(["cancelled", "open"]);
  });
});
