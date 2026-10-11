import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, type Db } from "@/lib/sync/repo";
import { MIN_LETRAS, buscar, numeroDoPedido } from "@/lib/search/busca";
import { buscarPaginas, paginasDoPerfil } from "@/lib/search/paginas";
import { ADMIN_LINKS, NAV_LINKS } from "@/lib/nav";

describe("páginas do painel na busca", () => {
  const admin = paginasDoPerfil("admin");
  const nomes = (l: Array<{ label: string }>) => l.map((p) => p.label);

  it("o administrador procura em todas as páginas do menu, cada uma com palavras extras", () => {
    expect(admin).toHaveLength(NAV_LINKS.length + ADMIN_LINKS.length);
    expect(admin.every((p) => p.palavras.length > 0)).toBe(true); // página nova no menu precisa de sinônimos aqui
  });

  it("o perfil restrito só vê as suas páginas", () => {
    expect(nomes(paginasDoPerfil("expedicao"))).toEqual(["Expedição", "Estoque"]);
    expect(nomes(buscarPaginas(paginasDoPerfil("expedicao"), "custos"))).toEqual([]);
  });

  it("acha pelo nome, sem acento e por sinônimo, com o nome na frente", () => {
    expect(nomes(buscarPaginas(admin, "promocoes"))[0]).toBe("Promoções");
    expect(nomes(buscarPaginas(admin, "black friday"))).toEqual(["Campanhas"]);
    expect(nomes(buscarPaginas(admin, "margem"))).toEqual(expect.arrayContaining(["Custos", "Simulador"]));
    expect(nomes(buscarPaginas(admin, "envio"))[0]).toBe("Expedição");
    expect(nomes(buscarPaginas(admin, "estoque"))[0]).toBe("Estoque");
    expect(buscarPaginas(admin, "zzzz")).toEqual([]);
  });

  it("sem texto mostra as primeiras páginas, no limite pedido", () => {
    expect(buscarPaginas(admin, "", 3)).toHaveLength(3);
    expect(buscarPaginas(admin, "   ", 3)).toHaveLength(3);
  });
});

describe("número do pedido", () => {
  it("aceita 1234 e #1234, e nada mais", () => {
    expect(numeroDoPedido("1234")).toBe(1234);
    expect(numeroDoPedido(" #1234 ")).toBe(1234);
    expect(numeroDoPedido("12a")).toBeNull();
    expect(numeroDoPedido("1234567890")).toBeNull();
    expect(MIN_LETRAS).toBe(2);
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
  await pg.query("INSERT INTO products (store_id, id, name, published, raw_json) VALUES ($1, 1, 'Vestido Azul Midi', true, '{}'::jsonb), ($1, 2, 'Saia Azul', false, '{}'::jsonb), ($1, 3, 'Blusa 100% Seda', true, '{}'::jsonb), ($1, 4, 'Calça Preta', true, '{}'::jsonb)", [storeId]);
  await pg.query("INSERT INTO variants (store_id, id, product_id, sku, price, raw_json) VALUES ($1, 11, 1, 'VA-AZ-P', 100, '{}'::jsonb), ($1, 41, 4, 'CP-PRETA-M', 100, '{}'::jsonb)", [storeId]);
  await upsertCategories(db, storeId, [{ id: 10, name: { pt: "Vestidos" } }, { id: 20, name: { pt: "Saias" } }]);
  await pg.query("INSERT INTO customers (store_id, id, name, email, city, state, ignored) VALUES ($1, 1, 'Ana Souza', 'ana.souza@x.com', 'Belo Horizonte', 'MG', false), ($1, 2, 'Bianca Azul', 'bia@x.com', NULL, NULL, false), ($1, 3, 'Ana Oculta', 'oculta@x.com', NULL, NULL, true)", [storeId]);
  const o = (id: number, numero: number, diasAtras: number, pag: string, envio: string | null, status = "open") =>
    pg.query("INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status, shipping_status, customer_id) VALUES ($1, $2, $3, now() - make_interval(days => $7::int), 150, $4, $5, $6, 1)", [storeId, id, numero, status, pag, envio, diasAtras]);
  await o(1, 1234, 1, "paid", "unpacked"); // o mais recente dos que começam por 12
  await o(2, 12, 30, "paid", "delivered", "closed");
  await o(3, 1299, 5, "pending", null);
});

describe("buscar", () => {
  it("produtos por nome ou SKU, com os que começam pelo texto na frente e sem tratar % como coringa", async () => {
    const r = await buscar(db, storeId, "azul");
    expect(r.produtos.map((p) => p.nome)).toEqual(["Vestido Azul Midi", "Saia Azul"]); // publicado primeiro
    expect(r.produtos[1]).toMatchObject({ publicado: false });
    expect((await buscar(db, storeId, "va-az")).produtos).toEqual([{ id: "1", nome: "Vestido Azul Midi", publicado: true, sku: "VA-AZ-P" }]);
    expect((await buscar(db, storeId, "100%")).produtos.map((p) => p.nome)).toEqual(["Blusa 100% Seda"]);
    expect((await buscar(db, storeId, "%%")).produtos).toEqual([]);
    expect((await buscar(db, storeId, "va")).produtos.map((p) => p.id)).toContain("1");
  });

  it("pedidos pelo número (exato primeiro, depois os que começam), sem nenhum dado pessoal", async () => {
    const r = await buscar(db, storeId, "#12");
    expect(r.pedidos.map((o) => o.numero)).toEqual([12, 1234, 1299]); // o número exato primeiro, depois os que começam por ele, dos mais recentes
    expect(r.pedidos[1]).toMatchObject({ id: "1", total: 150, pagamento: "paid", envio: "unpacked", aEnviar: true });
    expect(r.pedidos[0]).toMatchObject({ aEnviar: false });
    expect(r.pedidos[2]).toMatchObject({ aEnviar: false }); // não pago
    expect(Object.keys(r.pedidos[0]!).sort()).toEqual(["aEnviar", "criadoEm", "envio", "id", "numero", "pagamento", "total"]);
    expect((await buscar(db, storeId, "1234")).pedidos.map((o) => o.numero)).toEqual([1234]);
    expect(r.produtos).toEqual([]); // número só procura pedidos
    expect(r.clientes).toEqual([]);
  });

  it("clientes por nome ou começo do e-mail, sem as ignoradas, só nome e cidade", async () => {
    const r = await buscar(db, storeId, "ana");
    expect(r.clientes).toEqual([{ id: "1", nome: "Ana Souza", local: "Belo Horizonte/MG" }]);
    expect((await buscar(db, storeId, "ana.s")).clientes.map((c) => c.id)).toEqual(["1"]);
    expect((await buscar(db, storeId, "azul")).clientes.map((c) => c.nome)).toEqual(["Bianca Azul"]);
    expect(JSON.stringify(r)).not.toMatch(/@x\.com/);
  });

  it("categorias por nome", async () => {
    expect((await buscar(db, storeId, "vest")).categorias).toEqual([{ id: "10", nome: "Vestidos" }]);
  });

  it("texto curto ou vazio não busca nada, e o texto é limitado", async () => {
    const vazio = { produtos: [], pedidos: [], clientes: [], categorias: [] };
    expect(await buscar(db, storeId, "")).toEqual(vazio);
    expect(await buscar(db, storeId, "a")).toEqual(vazio);
    expect(await buscar(db, storeId, "   ")).toEqual(vazio);
    expect(await buscar(db, storeId, "x".repeat(500))).toEqual(vazio);
  });
});
