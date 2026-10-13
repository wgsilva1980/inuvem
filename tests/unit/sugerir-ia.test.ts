import { describe, expect, it } from "vitest";
import { juntarTags } from "@/app/(panel)/produtos/[id]/sugerir-ia";

describe("juntarTags", () => {
  it("campo vazio recebe as tags novas", () => {
    expect(juntarTags("", "bolsa, palha,verão")).toBe("bolsa, palha, verão");
  });
  it("mantém as que já estavam (na ordem) e acrescenta só as novas, sem repetir nem diferenciar maiúsculas", () => {
    expect(juntarTags("Bolsa, praia", "bolsa, palha, PRAIA, verão")).toBe("Bolsa, praia, palha, verão");
  });
  it("ignora vazios e espaços", () => {
    expect(juntarTags(" , a ,", " ,b,, a")).toBe("a, b");
    expect(juntarTags("", "")).toBe("");
  });
});
