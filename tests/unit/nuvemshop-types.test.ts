import { describe, expect, it } from "vitest";
import { productSchema } from "@/lib/nuvemshop/types";

const base = { id: 1, name: { pt: "Vestido" } };
const image = { id: 10, product_id: 1, src: "https://cdn.example/a.jpg", position: 1 };

describe("productSchema.images[].alt", () => {
  it.each([
    ["objeto multi-idioma", { pt: "Vestido azul" }],
    ["objeto vazio", {}],
    ["lista (formato da documentação)", ["Vestido azul"]],
    ["lista vazia", []],
    ["null", null],
  ])("aceita alt como %s", (_nome, alt) => {
    expect(productSchema.safeParse({ ...base, images: [{ ...image, alt }] }).success).toBe(true);
  });

  it("aceita imagem sem alt", () => {
    expect(productSchema.safeParse({ ...base, images: [image] }).success).toBe(true);
  });
});
