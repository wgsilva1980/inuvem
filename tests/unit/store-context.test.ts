import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { exemplosDeTom, ordenarTamanhos, percentil, sugestoesPorCategoria, tagsUsadas } from "@/lib/catalog/store-context";
import { criarGeradorRascunho } from "@/lib/catalog/ai-draft";
import type { Product } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

let seq = 1;
/** Produto com uma variante por tamanho (propriedades COR e TAMANHO), todas com o mesmo preço e peso. */
function produto(over: { nome?: string; cat?: number; tamanhos?: string[]; preco?: string; peso?: string; publicado?: boolean; extra?: Partial<Product> } = {}): Product {
  const id = seq++;
  return {
    id,
    name: { pt: over.nome ?? `Produto ${id}` },
    description: { pt: "<p>desc</p>" },
    published: over.publicado ?? true,
    categories: [{ id: over.cat ?? 10, name: { pt: "Vestidos" } }],
    attributes: [{ pt: "COR" }, { pt: "TAMANHO" }],
    images: [],
    variants: (over.tamanhos ?? ["P", "M", "G"]).map((t, i) => ({
      id: id * 100 + i,
      product_id: id,
      price: over.preco ?? "100.00",
      weight: over.peso ?? "0.400",
      stock_management: false,
      values: [{ pt: "Azul" }, { pt: t }],
    })),
    updated_at: "2026-10-01T10:00:00+0000",
    ...over.extra,
  } as unknown as Product;
}

describe("auxiliares", () => {
  it("percentil por interpolação", () => {
    expect(percentil([100, 120, 140, 200], 0.5)).toBe(130);
    expect(percentil([100, 120, 140, 200], 0.25)).toBe(115);
    expect(percentil([10], 0.5)).toBe(10);
    expect(percentil([], 0.5)).toBeNaN();
  });

  it("tamanhos na ordem da loja: PP…GG, depois números, depois o resto", () => {
    expect(ordenarTamanhos(["GG", "M", "PP", "G", "P"])).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(ordenarTamanhos(["42", "38", "40"])).toEqual(["38", "40", "42"]);
    expect(ordenarTamanhos(["ÚNICO", "M", "40"])).toEqual(["M", "40", "ÚNICO"]);
  });
});

describe("sugestoesPorCategoria", () => {
  it("preço (mediana e faixa), tamanhos mais usados e peso, só de produtos publicados da categoria", async () => {
    await upsertProducts(db, storeId, [
      produto({ preco: "100.00", peso: "0.300" }),
      produto({ preco: "120.00", peso: "0.400" }),
      produto({ preco: "140.00", peso: "0.400" }),
      produto({ preco: "200.00", peso: "0.500", tamanhos: ["M", "G"] }),
      produto({ preco: "999.00", publicado: false }), // não publicado: fora
      produto({ preco: "5.00", cat: 20 }), // outra categoria: fora
    ]);
    const r = await sugestoesPorCategoria(db, storeId, [10]);
    expect(r.produtos).toBe(4);
    expect(r.preco).toEqual({ mediana: "130,00", minimo: "115,00", maximo: "155,00", produtos: 4 });
    expect(r.tamanhos).toEqual({ lista: ["P", "M", "G"], produtos: 3, de: 4 });
    expect(r.pesoKg).toEqual({ valor: "0,4", produtos: 4 });
  });

  it("usa o menor preço de cada produto e junta várias categorias", async () => {
    const a = produto({ preco: "100.00" });
    a.variants!.push({ id: 99999, product_id: a.id, price: "300.00", stock_management: false, values: [{ pt: "Azul" }, { pt: "GG" }] } as never);
    await upsertProducts(db, storeId, [a, produto({ preco: "110.00" }), produto({ preco: "120.00", cat: 20 })]);
    const so10 = await sugestoesPorCategoria(db, storeId, [10]);
    expect(so10.preco).toBeNull(); // só 2 produtos: pouca base
    const ambas = await sugestoesPorCategoria(db, storeId, [10, 20]);
    expect(ambas.produtos).toBe(3);
    expect(ambas.preco?.mediana).toBe("110,00");
  });

  it("pouca base não gera sugestão; sem categoria devolve vazio", async () => {
    await upsertProducts(db, storeId, [produto({ preco: "100.00" })]);
    const r = await sugestoesPorCategoria(db, storeId, [10]);
    expect(r).toEqual({ produtos: 1, preco: null, tamanhos: null, pesoKg: null });
    expect(await sugestoesPorCategoria(db, storeId, [])).toEqual({ produtos: 0, preco: null, tamanhos: null, pesoKg: null });
    expect(await sugestoesPorCategoria(db, storeId, [Number.NaN, -3])).toEqual({ produtos: 0, preco: null, tamanhos: null, pesoKg: null });
  });

  it("reconhece a propriedade tamanho mesmo na ordem invertida", async () => {
    const p = (peso: string) => {
      const x = produto({ peso });
      (x as unknown as { attributes: unknown }).attributes = [{ pt: "Tamanho" }, { pt: "Cor" }];
      for (const v of x.variants!) (v as unknown as { values: unknown }).values = [(v.values as unknown as Array<{ pt: string }>)[1], (v.values as unknown as Array<{ pt: string }>)[0]];
      return x;
    };
    await upsertProducts(db, storeId, [p("0.4"), p("0.4"), p("0.4")]);
    const r = await sugestoesPorCategoria(db, storeId, [10]);
    expect(r.tamanhos?.lista).toEqual(["P", "M", "G"]);
  });
});

describe("referência de tom", () => {
  const longa = "<p>" + "Vestido elegante de caimento fluido, ótimo para o dia a dia e para ocasiões especiais. ".repeat(4) + "</p>";
  const completo = (nome: string, extra: Partial<Product> = {}) =>
    produto({
      nome,
      extra: {
        description: { pt: longa },
        tags: "vestido, midi",
        images: [{ id: seq * 1000, product_id: 0, src: "https://x/a.jpg", position: 1 }, { id: seq * 1000 + 1, product_id: 0, src: "https://x/b.jpg", position: 2 }],
        seo_title: { pt: `${nome} | Donatelle Concept` },
        seo_description: { pt: "Vestido midi elegante de caimento fluido para o dia a dia, com acabamento delicado e conforto. Confira na Donatelle Concept." },
        ...extra,
      } as never,
    });

  it("escolhe só produtos bem cadastrados (publicados, fotos, descrição, SEO nos limites)", async () => {
    await upsertProducts(db, storeId, [
      completo("Vestido Bom"),
      produto({ nome: "Sem nada" }),
      completo("Rascunho", { published: false }),
      completo("SEO curto", { seo_description: { pt: "curta" } } as never),
    ]);
    const ex = await exemplosDeTom(db, storeId, 3);
    expect(ex.map((e) => e.nome)).toEqual(["Vestido Bom"]);
    expect(ex[0]!.descricao).toContain("Vestido elegante");
    expect(ex[0]!.descricao).not.toContain("<p>");
    expect(ex[0]!.seoTitulo).toContain("Donatelle Concept");
  });

  it("tagsUsadas: só as que aparecem em 2+ produtos, mais usadas primeiro, em minúsculas", async () => {
    await upsertProducts(db, storeId, [
      produto({ extra: { tags: "Vestido, midi, festa" } as never }),
      produto({ extra: { tags: "vestido, Midi" } as never }),
      produto({ extra: { tags: "vestido, rara" } as never }),
    ]);
    expect(await tagsUsadas(db, storeId)).toEqual(["vestido", "midi"]);
  });

  it("o gerador leva os exemplos e as tags da loja no pedido, com aviso de que são só referência", async () => {
    const pedidos: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const resposta = {
      nome: "Vestido Midi Azul", paragrafos: ["Vestido midi azul."], detalhes: [], categorias: [], tags: ["vestido"], cores: ["azul"],
      seo_titulo_base: "Vestido Midi Azul", seo_descricao: "Vestido midi azul de caimento fluido, ótimo para o dia a dia e ocasiões especiais. Confira na Donatelle Concept e escolha o seu.",
      fotos: [{ alt: "Vestido midi azul", qualidade: 4, observacao: "" }], foto_principal: 1, preco: "", preco_promocional: "", tamanhos: [], peso_kg: "",
    };
    const c = { beta: { messages: { create: async (p: Record<string, unknown>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(resposta) }] }) } } } as never;
    await criarGeradorRascunho(c)({
      fotos: [{ bytes: Buffer.from("x"), mediaType: "image/jpeg" }],
      anotacoes: "",
      categorias: [],
      contextoLoja: { exemplos: [{ nome: "Vestido Bom", descricao: "Texto de exemplo", tags: "vestido", seoTitulo: "T | Donatelle Concept", seoDescricao: "D" }], tagsUsadas: ["vestido", "midi"] },
    });
    const texto = (pedidos[0]!.messages[0].content as Array<{ text?: string }>).at(-1)!.text!;
    expect(texto).toContain("Exemplos de produtos da loja");
    expect(texto).toContain("Texto de exemplo");
    expect(texto).toContain("Tags já usadas na loja: vestido, midi");
    expect(pedidos[0]!.system).toContain("NUNCA copie fatos");
  });
});
