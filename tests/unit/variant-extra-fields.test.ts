import { describe, expect, it } from "vitest";
import { buildVariantInput, changedVariantFields, parseDimension, variantEditSchema, variantFormInput, variantToEdit } from "@/lib/catalog/variants";

const base = { sku: "", price: "10,00", promotional_price: "", stock_management: false, stock: "", image_id: "" };

describe("medidas e dados do Google Shopping da variante", () => {
  it.each([
    ["12,5", "12.50"],
    ["12.5", "12.50"],
    ["", null],
    ["abc", undefined],
    ["1,234", undefined],
  ])("parseDimension(%s)", (raw, esperado) => expect(parseDimension(raw)).toBe(esperado));

  it("lê comprimento, largura, altura, MPN, faixa etária e sexo", () => {
    const r = variantEditSchema.parse({ ...base, depth: "30", width: "20,5", height: "", mpn: " AB-1 ", age_group: "adult", gender: "female" });
    expect(r).toMatchObject({ depth: "30.00", width: "20.50", height: null, mpn: "AB-1", age_group: "adult", gender: "female" });
  });

  it("recusa faixa etária ou sexo fora da lista e medida inválida", () => {
    const r = variantEditSchema.safeParse({ ...base, age_group: "idoso", gender: "x", depth: "1,234" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["age_group", "depth", "gender"]);
  });

  it("campos ausentes não contam como edição; presentes e diferentes sim", () => {
    const antes = variantToEdit({ price: "10.00", depth: "30", mpn: "A", age_group: "adult" });
    const sem = variantEditSchema.parse(base);
    expect(changedVariantFields(antes, { ...antes, ...sem, price: "10.00" })).toEqual([]);
    const depois = variantEditSchema.parse({ ...base, depth: "31", mpn: "", age_group: "adult", gender: "male" });
    const campos = changedVariantFields(antes, depois);
    expect(campos).toEqual(expect.arrayContaining(["depth", "mpn", "gender"]));
    expect(campos).not.toContain("age_group");
    expect(buildVariantInput(depois, campos)).toEqual({ depth: "31.00", mpn: null, gender: "male" });
  });

  it("variantFormInput lê os campos novos do formulário do produto", () => {
    const f = new FormData();
    f.append("v7_depth", "10");
    f.append("v7_mpn", "X");
    f.append("v7_gender", "unisex");
    expect(variantFormInput(f, 7)).toMatchObject({ depth: "10", mpn: "X", gender: "unisex", age_group: "" });
  });
});
