import { describe, expect, it } from "vitest";
import { parseScopes } from "@/lib/nuvemshop/scopes";

describe("parseScopes", () => {
  it("separa por vírgula, mantém a ordem e remove repetidos", () => {
    expect(parseScopes("read_content,write_content,read_products,read_content")).toEqual(["read_content", "write_content", "read_products"]);
  });

  it("aceita espaços e vírgulas misturados e ignora vazios", () => {
    expect(parseScopes(" read_orders, write_orders ,,  read_shipping ")).toEqual(["read_orders", "write_orders", "read_shipping"]);
  });

  it("vazio, nulo ou indefinido viram lista vazia", () => {
    expect(parseScopes("")).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });
});
