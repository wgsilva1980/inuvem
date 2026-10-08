import { describe, expect, it } from "vitest";
import { avaliarProntidao } from "@/lib/catalog/readiness";
import type { ProductDetail } from "@/lib/catalog/query";
import type { ProdutoAuditado } from "@/lib/images/audit";

type V = ProductDetail["variants"][number];
const variante = (over: Partial<V> = {}): V => ({
  id: "1", sku: "1001", price: "189.90", promotional_price: null, weight: "0.400", depth: "20", width: "30", height: "5", mpn: null,
  age_group: "adult", gender: "female", stock: 3, stock_management: true, values: [{ pt: "Azul" }, { pt: "P" }], image_id: null, ...over,
});

const completo = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: "1",
  name: "Vestido Midi Azul",
  description: `<p>${"Vestido midi azul de caimento fluido, ótimo para o dia a dia e para ocasiões especiais. ".repeat(2)}</p>`,
  tags: "vestido, midi",
  published: false,
  categories: [{ id: 10, name: "Vestidos" }],
  seo_title: "Vestido Midi Azul | Donatelle Concept",
  seo_description: "Vestido midi azul de caimento fluido, ótimo para o dia a dia e ocasiões especiais, com acabamento delicado e conforto. Confira na Donatelle Concept.",
  updated_at_remote: null,
  attributes: ["COR", "TAMANHO"],
  variants: [variante({ id: "1" }), variante({ id: "2", sku: "1002", values: [{ pt: "Azul" }, { pt: "M" }] })],
  ...over,
});

const auditoriaOk = (n: number): ProdutoAuditado => ({
  id: "1",
  name: "x",
  proporcoesMisturadas: false,
  imagens: Array.from({ length: n }, (_, i) => ({ id: String(i), position: i + 1, src: "u", medida: { width: 1024, height: 1024, bytes: 100_000, format: "jpeg", error: null }, problemas: [] })),
});

const item = (c: ReturnType<typeof avaliarProntidao>, chave: string) => c.itens.find((i) => i.chave === chave)!;

describe("avaliarProntidao", () => {
  it("produto completo: pronto e tudo ok", () => {
    const c = avaliarProntidao(completo(), 4, auditoriaOk(4));
    expect(c.pronto).toBe(true);
    expect(c.obrigatoriosFaltando).toBe(0);
    expect(c.recomendadosFaltando).toBe(0);
    expect(c.ok).toBe(c.total);
  });

  it("obrigatórios: foto, preço, categoria, descrição e estoque", () => {
    const c = avaliarProntidao(
      completo({
        categories: [],
        description: "<p>curta</p>",
        variants: [variante({ price: null, sku: "A", values: [{ pt: "Azul" }, { pt: "P" }] }), variante({ price: "0.00", id: "2", values: [{ pt: "Azul" }, { pt: "M" }] })],
      }),
      0,
      null,
    );
    expect(c.pronto).toBe(false);
    expect(c.obrigatoriosFaltando).toBe(4); // foto, preço, categoria, descrição (estoque está ok)
    expect(item(c, "foto").status).toBe("falta");
    expect(item(c, "preco").detalhe).toContain("Azul / P");
    expect(item(c, "preco").detalhe).toContain("Azul / M");
    expect(item(c, "categoria").status).toBe("falta");
    expect(item(c, "descricao").detalhe).toContain("Muito curta");
    expect(item(c, "estoque").status).toBe("ok");
  });

  it("estoque: sem controle e com saldo são ok; tudo zerado falta e avisa da automação", () => {
    const sem = avaliarProntidao(completo({ variants: [variante({ stock_management: false, stock: null })] }), 3, auditoriaOk(3));
    expect(item(sem, "estoque").status).toBe("ok");
    const um = avaliarProntidao(completo({ variants: [variante({ stock: 0 }), variante({ id: "2", stock: 2, values: [{ pt: "Azul" }, { pt: "M" }] })] }), 3, auditoriaOk(3));
    expect(item(um, "estoque").status).toBe("ok");
    const zerado = avaliarProntidao(completo({ variants: [variante({ stock: 0 }), variante({ id: "2", stock: null, values: [{ pt: "Azul" }, { pt: "M" }] })] }), 3, auditoriaOk(3));
    expect(item(zerado, "estoque").status).toBe("falta");
    expect(item(zerado, "estoque").detalhe).toContain("Automações");
    expect(zerado.pronto).toBe(false);
  });

  it("fotos: menos de 3 é recomendação; sem medida vira 'não conferido'; problemas viram atenção", () => {
    const poucas = avaliarProntidao(completo(), 2, auditoriaOk(2));
    expect(poucas.pronto).toBe(true);
    expect(item(poucas, "fotos_mais").status).toBe("atencao");
    const semMedida = avaliarProntidao(completo(), 3, { id: "1", name: "x", proporcoesMisturadas: false, imagens: [{ id: "1", position: 1, src: "u", medida: null, problemas: [] }] });
    expect(item(semMedida, "fotos_padrao").status).toBe("info");
    expect(avaliarProntidao(completo(), 3, null).itens.find((i) => i.chave === "fotos_padrao")!.status).toBe("info");
    const aud = auditoriaOk(3);
    aud.imagens[0]!.problemas = ["proporcao"];
    expect(item(avaliarProntidao(completo(), 3, aud), "fotos_padrao").status).toBe("atencao");
    const mist = auditoriaOk(3);
    mist.proporcoesMisturadas = true;
    expect(item(avaliarProntidao(completo(), 3, mist), "fotos_padrao").detalhe).toContain("proporções misturadas");
    expect(avaliarProntidao(completo(), 0, null).itens.some((i) => i.chave === "fotos_padrao")).toBe(false);
  });

  it("recomendados: SEO, SKU, propriedades, frete, Google e tags", () => {
    const c = avaliarProntidao(
      completo({
        seo_title: "",
        seo_description: "curta",
        tags: "",
        attributes: ["Cor", "Tam"],
        variants: [
          variante({ sku: "", weight: null, gender: null }),
          variante({ id: "2", sku: "1002", height: null, age_group: "", values: [{ pt: "Azul" }, { pt: "" }] }),
        ],
      }),
      3,
      auditoriaOk(3),
    );
    expect(c.pronto).toBe(true); // nada obrigatório faltando
    expect(item(c, "seo_titulo").status).toBe("atencao");
    expect(item(c, "seo_descricao").detalhe).toContain("5 caracteres");
    expect(item(c, "sku").detalhe).toContain("Azul / P");
    expect(item(c, "propriedades").detalhe).toContain("padrão da loja");
    expect(item(c, "frete").detalhe).toContain("1 sem peso");
    expect(item(c, "frete").detalhe).toContain("1 sem altura");
    expect(item(c, "google").detalhe).toContain("2 variações");
    expect(item(c, "tags").status).toBe("atencao");
    expect(c.recomendadosFaltando).toBe(7);
  });

  it("produto com uma variante só não cobra COR e TAMANHO", () => {
    const c = avaliarProntidao(completo({ attributes: [], variants: [variante({ values: [] })] }), 3, auditoriaOk(3));
    expect(c.itens.some((i) => i.chave === "propriedades")).toBe(false);
    expect(c.pronto).toBe(true);
  });

  it("produto sem variações não está pronto", () => {
    const c = avaliarProntidao(completo({ variants: [] }), 3, auditoriaOk(3));
    expect(item(c, "preco").status).toBe("falta");
    expect(c.pronto).toBe(false);
  });
});
