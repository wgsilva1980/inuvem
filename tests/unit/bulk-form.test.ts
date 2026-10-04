import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { operationFromForm, parseDecimal } from "@/lib/bulk/form";
import { describeChanges } from "@/lib/bulk/format";
import { resolveSelection } from "@/lib/bulk/selection";
import type { Product } from "@/lib/nuvemshop/types";

const form = (fields: Record<string, string>) => operationFromForm((n) => fields[n] ?? "");

describe("parseDecimal", () => {
  it.each([
    ["10", 10],
    ["10,5", 10.5],
    ["1.234,56", 1234.56],
    ["49.90", 49.9],
    ["R$ 5", 5],
    ["", null],
    ["-5", null],
    ["abc", null],
    ["1e3", null],
    ["10,5,2", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });
});

describe("operationFromForm", () => {
  it("preço: aumentar/diminuir (percentual ou valor) e definir", () => {
    expect(form({ tipo: "preco", preco_modo: "aumentar", preco_unidade: "percentual", preco_valor: "10", arredondar: "90" }).op).toEqual({
      type: "preco", mode: "percentual", value: 10, target: "preco", rounding: "90",
    });
    expect(form({ tipo: "preco", preco_modo: "diminuir", preco_unidade: "valor", preco_valor: "5,50", preco_alvo: "promocional" }).op).toEqual({
      type: "preco", mode: "valor", value: -5.5, target: "promocional", rounding: "nenhum",
    });
    expect(form({ tipo: "preco", preco_modo: "definir", preco_valor: "99,90" }).op).toMatchObject({ mode: "definir", value: 99.9 });
  });

  it("estoque: definir, aumentar e diminuir", () => {
    expect(form({ tipo: "estoque", estoque_modo: "definir", estoque_valor: "7" }).op).toEqual({ type: "estoque", mode: "definir", value: 7 });
    expect(form({ tipo: "estoque", estoque_modo: "diminuir", estoque_valor: "3" }).op).toEqual({ type: "estoque", mode: "somar", value: -3 });
    expect(form({ tipo: "estoque", estoque_modo: "aumentar", estoque_valor: "3" }).op).toEqual({ type: "estoque", mode: "somar", value: 3 });
  });

  it("promoção, publicar e categoria", () => {
    expect(form({ tipo: "promocao", promo_modo: "desconto", promo_percent: "15" }).op).toMatchObject({ type: "promocao", mode: "desconto", percent: 15 });
    expect(form({ tipo: "promocao", promo_modo: "remover" }).op).toMatchObject({ mode: "remover" });
    expect(form({ tipo: "publicar", publicar_modo: "despublicar" }).op).toEqual({ type: "publicar", published: false });
    expect(form({ tipo: "categoria", categoria_modo: "remover", categoria_id: "7" }).op).toEqual({ type: "categoria", mode: "remover", categoryId: 7 });
  });

  it("recusa entradas inválidas com mensagem em português", () => {
    const err = (f: Record<string, string>) => form(f).error;
    expect(err({})).toMatch(/tipo de operação/);
    expect(err({ tipo: "preco", preco_modo: "aumentar", preco_valor: "" })).toMatch(/valor numérico/);
    expect(err({ tipo: "preco", preco_modo: "aumentar", preco_valor: "-10" })).toMatch(/valor numérico positivo/);
    expect(err({ tipo: "preco", preco_modo: "diminuir", preco_unidade: "percentual", preco_valor: "100" })).toMatch(/100%/);
    expect(err({ tipo: "preco", preco_modo: "definir", preco_valor: "0" })).toMatch(/maior que zero/);
    expect(err({ tipo: "preco", preco_modo: "aumentar", preco_valor: "0" })).toMatch(/diferente de zero/);
    expect(err({ tipo: "promocao", promo_modo: "desconto", promo_percent: "100" })).toMatch(/inválidos/);
    expect(err({ tipo: "estoque", estoque_modo: "definir", estoque_valor: "1,5" })).toMatch(/inteira/);
    expect(err({ tipo: "estoque", estoque_modo: "somar", estoque_valor: "2" })).toMatch(/definir, aumentar ou diminuir/);
    expect(err({ tipo: "categoria", categoria_modo: "adicionar", categoria_id: "" })).toMatch(/categoria/);
    expect(err({ tipo: "publicar", publicar_modo: "x" })).toMatch(/publicar ou despublicar/);
  });
});

describe("describeChanges", () => {
  it("monta as linhas antes → depois", () => {
    const lines = describeChanges(
      {
        product: { published: { antes: true, depois: false }, categories: { antes: [1], depois: [1, 2] } },
        variants: [{ id: 1, label: "P", sku: "S1", price: { antes: "100.00", depois: "110.00" }, promotional_price: { antes: null, depois: "90.00" }, stock: { antes: null, depois: 5 } }],
      },
      (id) => `Cat ${id}`,
    );
    expect(lines[0]).toBe("Situação: publicado → não publicado");
    expect(lines[1]).toBe("Categorias: Cat 1 → Cat 1, Cat 2");
    expect(lines[2]).toMatch(/^P \(S1\): preço R\$\s100,00 → R\$\s110,00, promocional sem promoção → R\$\s90,00, estoque sem quantidade → 5$/);
  });
});

describe("resolveSelection", () => {
  let db: Db;
  let storeId: string;
  beforeEach(async () => {
    const pg = new PGlite();
    db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
    await runMigrations(
      { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
      loadMigrations(join(process.cwd(), "db/migrations")),
    );
    storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
    const mk = (id: number, over: Partial<Product> = {}): Product => ({ id, name: { pt: `P${id}` }, published: true, variants: [], ...over });
    await upsertProducts(db, storeId, [mk(1), mk(2, { published: false }), mk(3)]);
  });

  it("por ids: ignora inexistentes, repetidos e lixo", async () => {
    const r = await resolveSelection(db, storeId, { ids: "1,3,3,999,abc,-4" });
    expect(r.ids.sort()).toEqual([1, 3]);
    expect(r.truncated).toBe(false);
  });

  it("por filtro: usa os mesmos filtros da lista", async () => {
    expect((await resolveSelection(db, storeId, { status: "publicados" })).ids).toEqual([1, 3]);
    expect((await resolveSelection(db, storeId, { status: "rascunhos" })).ids).toEqual([2]);
    expect((await resolveSelection(db, storeId, {})).ids).toEqual([1, 2, 3]);
  });
});
