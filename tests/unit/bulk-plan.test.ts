import { describe, expect, it } from "vitest";
import {
  applyRounding,
  countVariantChanges,
  describeOperation,
  operationSchema,
  planOperation,
  validateOperation,
  type BulkOperation,
  type MirrorProduct,
} from "@/lib/bulk/operations";

const v = (id: number, over: Partial<MirrorProduct["variants"][number]> = {}) => ({
  id,
  sku: `S${id}`,
  label: `Var ${id}`,
  price: 100,
  promotional_price: null as number | null,
  stock_management: true,
  stock: 10 as number | null,
  ...over,
});
const product = (id: number, over: Partial<MirrorProduct> = {}): MirrorProduct => ({
  id,
  name: `Produto ${id}`,
  published: true,
  categoryIds: [1],
  variants: [v(id * 10), v(id * 10 + 1)],
  ...over,
});
const op = (o: unknown): BulkOperation => operationSchema.parse(o);

describe("arredondamento", () => {
  it.each([
    [10037, "90", 9990],
    [10050, "90", 10090],
    [9990, "90", 9990],
    [10037, "00", 10000],
    [10050, "00", 10100],
    [10037, "nenhum", 10037],
  ])("%i centavos, %s -> %i", (cents, r, expected) => {
    expect(applyRounding(cents, r as "nenhum")).toBe(expected);
  });
});

describe("validação da operação", () => {
  it("rejeita o que não faz sentido", () => {
    expect(operationSchema.safeParse({ type: "preco", mode: "percentual", value: Number.NaN }).success).toBe(false);
    expect(operationSchema.safeParse({ type: "estoque", mode: "definir", value: 1.5 }).success).toBe(false);
    expect(operationSchema.safeParse({ type: "promocao", mode: "desconto", percent: 100 }).success).toBe(false);
    expect(operationSchema.safeParse({ type: "apagar" }).success).toBe(false);
    expect(validateOperation(op({ type: "promocao", mode: "desconto" }))).toMatch(/percentual/);
    expect(validateOperation(op({ type: "preco", mode: "percentual", value: -100 }))).toMatch(/100%/);
    expect(validateOperation(op({ type: "preco", mode: "definir", value: 0 }))).toMatch(/maior que zero/);
    expect(validateOperation(op({ type: "preco", mode: "valor", value: 0 }))).toMatch(/diferente de zero/);
    expect(validateOperation(op({ type: "estoque", mode: "definir", value: -1 }))).toMatch(/negativo/);
    expect(validateOperation(op({ type: "preco", mode: "percentual", value: 10 }))).toBeNull();
  });

  it("descreve a operação em português", () => {
    expect(describeOperation(op({ type: "preco", mode: "percentual", value: 10, rounding: "90" }))).toBe("Aumentar o preço em 10%, arredondando para terminar em ,90");
    expect(describeOperation(op({ type: "preco", mode: "valor", value: -5 }))).toMatch(/Diminuir o preço em R\$\s5,00/);
    expect(describeOperation(op({ type: "estoque", mode: "somar", value: -3 }))).toBe("Subtrair 3 unidades do estoque");
    expect(describeOperation(op({ type: "categoria", mode: "adicionar", categoryId: 7 }), () => "Vestidos")).toBe('Adicionar à categoria "Vestidos"');
    expect(describeOperation(op({ type: "publicar", published: false }))).toMatch(/Despublicar/);
  });
});

describe("planOperation: preço", () => {
  it("aumenta em percentual, em todas as variantes", () => {
    const plan = planOperation(op({ type: "preco", mode: "percentual", value: 10 }), [product(1)]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.changes.variants.map((c) => c.price)).toEqual([
      { antes: "100.00", depois: "110.00" },
      { antes: "100.00", depois: "110.00" },
    ]);
    expect(countVariantChanges(plan.items)).toBe(2);
  });

  it("soma/subtrai valor fixo e define valor, com arredondamento", () => {
    const m = [product(1, { variants: [v(1, { price: 89.9 })] })];
    expect(planOperation(op({ type: "preco", mode: "valor", value: -10 }), m).items[0]!.changes.variants[0]!.price).toEqual({ antes: "89.90", depois: "79.90" });
    expect(planOperation(op({ type: "preco", mode: "definir", value: 120.37, rounding: "90" }), m).items[0]!.changes.variants[0]!.price).toEqual({ antes: "89.90", depois: "119.90" });
    expect(planOperation(op({ type: "preco", mode: "percentual", value: 7, rounding: "00" }), m).items[0]!.changes.variants[0]!.price).toEqual({ antes: "89.90", depois: "96.00" });
  });

  it("não deixa o preço ficar abaixo do promocional, zero ou negativo", () => {
    const m = [product(1, { variants: [v(1, { price: 100, promotional_price: 80 }), v(2, { price: 5 })] })];
    const plan = planOperation(op({ type: "preco", mode: "percentual", value: -30 }), m);
    expect(plan.items).toHaveLength(1);
    expect(plan.ignorados.map((i) => i.motivo)).toEqual(["o preço ficaria menor ou igual ao preço promocional"]);
    const neg = planOperation(op({ type: "preco", mode: "valor", value: -10 }), [product(2, { variants: [v(3, { price: 5 })] })]);
    expect(neg.items).toEqual([]);
    expect(neg.ignorados[0]!.motivo).toMatch(/zero ou negativo/);
  });

  it("alvo promocional só mexe em quem tem promoção e mantém promo < preço", () => {
    const m = [product(1, { variants: [v(1, { price: 100, promotional_price: 80 }), v(2, { price: 100 })] })];
    const plan = planOperation(op({ type: "preco", mode: "percentual", value: 10, target: "promocional" }), m);
    expect(plan.items[0]!.changes.variants).toHaveLength(1);
    expect(plan.items[0]!.changes.variants[0]!.promotional_price).toEqual({ antes: "80.00", depois: "88.00" });
    expect(plan.ignorados).toEqual([expect.objectContaining({ variant: "Var 2", motivo: "sem preço promocional" })]);
    const tooHigh = planOperation(op({ type: "preco", mode: "percentual", value: 30, target: "promocional" }), m);
    expect(tooHigh.ignorados.some((i) => /maior ou igual ao preço/.test(i.motivo))).toBe(true);
  });

  it("ignora o que não muda", () => {
    const plan = planOperation(op({ type: "preco", mode: "definir", value: 100 }), [product(1)]);
    expect(plan.items).toEqual([]);
    expect(plan.ignorados.every((i) => i.motivo === "sem alteração")).toBe(true);
  });
});

describe("planOperation: promoção", () => {
  it("define desconto sobre o preço e remove promoção", () => {
    const m = [product(1, { variants: [v(1, { price: 200 }), v(2, { price: 200, promotional_price: 150 })] })];
    const d = planOperation(op({ type: "promocao", mode: "desconto", percent: 25 }), m);
    expect(d.items[0]!.changes.variants.map((c) => c.promotional_price)).toEqual([{ antes: null, depois: "150.00" }]); // a variante 2 já está em 150
    expect(d.ignorados).toEqual([expect.objectContaining({ variant: "Var 2", motivo: "sem alteração" })]);
    const r = planOperation(op({ type: "promocao", mode: "remover" }), m);
    expect(r.items[0]!.changes.variants).toEqual([expect.objectContaining({ id: 2, promotional_price: { antes: "150.00", depois: null } })]);
    expect(r.ignorados[0]!.motivo).toBe("sem preço promocional");
  });
});

describe("planOperation: estoque", () => {
  it("define e soma, só onde há controle de estoque", () => {
    const m = [product(1, { variants: [v(1, { stock: 4 }), v(2, { stock_management: false, stock: null }), v(3, { stock: null })] })];
    const set = planOperation(op({ type: "estoque", mode: "definir", value: 7 }), m);
    expect(set.items[0]!.changes.variants.map((c) => c.stock)).toEqual([{ antes: 4, depois: 7 }, { antes: null, depois: 7 }]);
    expect(set.ignorados).toEqual([expect.objectContaining({ variant: "Var 2", motivo: "sem controle de estoque" })]);
    const add = planOperation(op({ type: "estoque", mode: "somar", value: 3 }), m);
    expect(add.items[0]!.changes.variants.map((c) => c.stock?.depois)).toEqual([7, 3]); // null conta como 0
  });

  it("não deixa o estoque negativo (não faz clamp em silêncio)", () => {
    const plan = planOperation(op({ type: "estoque", mode: "somar", value: -5 }), [product(1, { variants: [v(1, { stock: 3 }), v(2, { stock: 8 })] })]);
    expect(plan.items[0]!.changes.variants).toEqual([expect.objectContaining({ id: 2, stock: { antes: 8, depois: 3 } })]);
    expect(plan.ignorados).toEqual([expect.objectContaining({ variant: "Var 1", motivo: "o estoque ficaria negativo" })]);
  });
});

describe("planOperation: publicar e categoria", () => {
  it("publica/despublica só quem muda", () => {
    const ms = [product(1, { published: true }), product(2, { published: false })];
    const off = planOperation(op({ type: "publicar", published: false }), ms);
    expect(off.items.map((i) => i.productId)).toEqual([1]);
    expect(off.items[0]!.changes.product?.published).toEqual({ antes: true, depois: false });
    expect(off.ignorados).toEqual([expect.objectContaining({ productId: 2, motivo: "já está despublicado" })]);
  });

  it("adiciona e remove categoria sem duplicar", () => {
    const ms = [product(1, { categoryIds: [1] }), product(2, { categoryIds: [1, 5] })];
    const add = planOperation(op({ type: "categoria", mode: "adicionar", categoryId: 5 }), ms);
    expect(add.items).toHaveLength(1);
    expect(add.items[0]!.changes.product?.categories).toEqual({ antes: [1], depois: [1, 5] });
    const rem = planOperation(op({ type: "categoria", mode: "remover", categoryId: 5 }), ms);
    expect(rem.items[0]!.changes.product?.categories).toEqual({ antes: [1, 5], depois: [1] });
    expect(rem.ignorados[0]!.motivo).toBe("não está nessa categoria");
  });
});
