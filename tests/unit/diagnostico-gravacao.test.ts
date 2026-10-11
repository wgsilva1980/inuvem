import { describe, expect, it } from "vitest";
import { executarTesteDeGravacao, relatorioGravacaoTexto, type ApiGravacao } from "@/lib/diagnostico/gravacao";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Coupon } from "@/lib/nuvemshop/coupons";
import type { Product, Variant } from "@/lib/nuvemshop/types";

interface Opcoes {
  criarFalha?: boolean;
  criarPublicado?: boolean;
  estoqueNaoGrava?: boolean;
  apagarProdutoFalha?: boolean;
  apagarProdutoNaoApaga?: boolean;
  semDeleteDeCupom?: boolean;
}

/** Loja falsa e com estado, para ver o que o teste cria, muda e apaga. */
function lojaFalsa(o: Opcoes = {}) {
  const produtos = new Map<number, Product>();
  const cupons = new Map<number, Coupon>();
  const chamadas: string[] = [];
  let seq = 1000;
  const api: ApiGravacao = {
    criarProduto: async (input) => {
      chamadas.push("criarProduto");
      if (o.criarFalha) throw new NuvemshopError("422", 422, null, "recusado");
      const id = seq++;
      const variants = (input.variants ?? []).map((v, i) => ({ id: id * 10 + i, product_id: id, ...v })) as unknown as Variant[];
      const p = { id, name: input.name, published: o.criarPublicado ? true : input.published, variants } as unknown as Product;
      produtos.set(id, p);
      return structuredClone(p);
    },
    lerProduto: async (id) => {
      chamadas.push("lerProduto");
      const p = produtos.get(id);
      if (!p) throw new NuvemshopError("404", 404, null, "Not Found");
      return structuredClone(p);
    },
    alterarProduto: async (id, input) => {
      chamadas.push("alterarProduto");
      const novo = { ...produtos.get(id)!, ...(input as object) } as Product;
      produtos.set(id, novo);
      return structuredClone(novo);
    },
    lerVariacao: async (pid, vid) => structuredClone(produtos.get(pid)!.variants!.find((v) => v.id === vid)!),
    alterarVariacao: async (pid, vid, input) => {
      chamadas.push(`alterarVariacao ${JSON.stringify(input)}`);
      const p = produtos.get(pid)!;
      const i = p.variants!.findIndex((v) => v.id === vid);
      const { stock, ...resto } = input as { stock?: number };
      p.variants![i] = { ...p.variants![i]!, ...resto, ...(stock !== undefined && !o.estoqueNaoGrava ? { stock } : {}) } as Variant;
      return structuredClone(p.variants![i]!);
    },
    apagarProduto: async (id) => {
      chamadas.push("apagarProduto");
      if (o.apagarProdutoFalha) throw new NuvemshopError("500", 500, null, "caiu");
      if (!o.apagarProdutoNaoApaga) produtos.delete(id);
    },
    criarCupom: async (input) => {
      chamadas.push("criarCupom");
      const c = { id: seq++, ...input } as unknown as Coupon;
      cupons.set(c.id, c);
      return structuredClone(c);
    },
    alterarCupom: async (id, input) => {
      chamadas.push(`alterarCupom ${JSON.stringify(input)}`);
      const c = { ...cupons.get(id)!, ...input } as unknown as Coupon;
      cupons.set(id, c);
      return structuredClone(c);
    },
    apagarCupom: async (id) => {
      chamadas.push("apagarCupom");
      if (o.semDeleteDeCupom) throw new NuvemshopError("405", 405, null, "Method Not Allowed");
      cupons.delete(id);
    },
  };
  return { api, produtos, cupons, chamadas };
}
const status = (r: Awaited<ReturnType<typeof executarTesteDeGravacao>>) => Object.fromEntries(r.passos.map((p) => [p.id, p.status]));

describe("teste de gravação", () => {
  it("tudo certo: cria, muda, confere e apaga; a loja volta ao que era e só se mexe no que o teste criou", async () => {
    const { api, produtos, cupons, chamadas } = lojaFalsa();
    const r = await executarTesteDeGravacao(api);
    expect(r.tudoCerto).toBe(true);
    expect(status(r)).toEqual({ "criar-produto": "ok", "ler-produto": "ok", estoque: "ok", preco: "ok", produto: "ok", cupom: "ok", "apagar-cupom": "ok", "apagar-produto": "ok" });
    expect(r.sobras).toEqual([]);
    expect(produtos.size).toBe(0);
    expect(cupons.size).toBe(0);
    expect(chamadas[0]).toBe("criarProduto");
    expect(chamadas.slice(-2)).toEqual(["apagarProduto", "lerProduto"]); // apaga e confere que sumiu
    expect(r.produtoDeTesteId).toBeGreaterThan(0);
  });

  it("o produto nasce oculto, com nome e SKU de teste, e o cupom nasce desativado", async () => {
    const vistos: unknown[] = [];
    const { api } = lojaFalsa();
    const criar = api.criarProduto;
    api.criarProduto = async (i) => (vistos.push(i), criar(i));
    const criarCupom = api.criarCupom;
    api.criarCupom = async (i) => (vistos.push(i), criarCupom(i));
    await executarTesteDeGravacao(api);
    expect(vistos[0]).toMatchObject({ published: false, name: { pt: expect.stringMatching(/^ZZ TESTE INUVEM \d{14} \(pode apagar\)$/) }, variants: [{ sku: expect.stringMatching(/^INUVEM-TESTE-\d{14}$/), stock: 1 }] });
    expect(vistos[1]).toMatchObject({ code: expect.stringMatching(/^INUVEMTESTE[A-Z2-9]{6}$/), type: "absolute", value: "1.00", valid: false, max_uses: 1 });
  });

  it("se não consegue criar o produto, pula o que depende dele, testa o cupom e não tenta apagar produto", async () => {
    const { api, chamadas } = lojaFalsa({ criarFalha: true });
    const r = await executarTesteDeGravacao(api);
    expect(status(r)).toEqual({ "criar-produto": "falha", "ler-produto": "pulado", estoque: "pulado", preco: "pulado", produto: "pulado", cupom: "ok", "apagar-cupom": "ok" });
    expect(r.passos[0]!.mensagem).toMatch(/recusou os dados|422/);
    expect(chamadas).not.toContain("apagarProduto");
    expect(r.tudoCerto).toBe(false);
    expect(r.produtoDeTesteId).toBeNull();
  });

  it("um passo que falha não impede a limpeza", async () => {
    const { api, produtos } = lojaFalsa({ estoqueNaoGrava: true });
    const r = await executarTesteDeGravacao(api);
    expect(status(r).estoque).toBe("falha");
    expect(r.passos.find((p) => p.id === "estoque")!.mensagem).toMatch(/devolveu 1/);
    expect(status(r)["apagar-produto"]).toBe("ok");
    expect(produtos.size).toBe(0);
    expect(r.tudoCerto).toBe(false);
  });

  it("resposta estranha na criação (veio publicado): acusa, mas ainda apaga o produto", async () => {
    const { api, produtos } = lojaFalsa({ criarPublicado: true });
    const r = await executarTesteDeGravacao(api);
    expect(status(r)["criar-produto"]).toBe("falha");
    expect(r.passos[0]!.mensagem).toMatch(/veio publicado/);
    expect(produtos.size).toBe(0);
  });

  it("produto que não apaga: avisa com o nome para a pessoa apagar à mão", async () => {
    const { api } = lojaFalsa({ apagarProdutoFalha: true });
    const r = await executarTesteDeGravacao(api);
    expect(r.sobras).toHaveLength(1);
    expect(r.sobras[0]).toMatchObject({ tipo: "produto", situacao: "ainda existe", nome: expect.stringMatching(/ZZ TESTE INUVEM/) });
    expect(r.passos.at(-1)).toMatchObject({ id: "apagar-produto", status: "falha" });
    expect(r.passos.at(-1)!.mensagem).toMatch(/Apague “ZZ TESTE INUVEM/);
    expect(r.tudoCerto).toBe(false);
    const naoApaga = await executarTesteDeGravacao(lojaFalsa({ apagarProdutoNaoApaga: true }).api); // diz que apagou, mas a leitura ainda acha
    expect(naoApaga.sobras[0]).toMatchObject({ tipo: "produto" });
  });

  it("cupom sem DELETE: fica desativado e é avisado", async () => {
    const { api, cupons } = lojaFalsa({ semDeleteDeCupom: true });
    const r = await executarTesteDeGravacao(api);
    expect(r.sobras).toMatchObject([{ tipo: "cupom", situacao: "desativado (não foi possível apagar)", nome: expect.stringMatching(/^INUVEMTESTE/) }]);
    expect([...cupons.values()][0]!.valid).toBe(false);
    expect(status(r)["apagar-cupom"]).toBe("falha");
    expect(status(r)["apagar-produto"]).toBe("ok");
    expect(r.tudoCerto).toBe(false);
  });

  it("acabou o tempo: pula o que falta, mas a limpeza roda", async () => {
    const { api, produtos, cupons } = lojaFalsa();
    let t = 0;
    const r = await executarTesteDeGravacao(api, { budgetMs: 25, agora: () => (t += 10) });
    expect(r.passos.some((p) => p.status === "pulado" && /acabou o tempo/.test(p.mensagem))).toBe(true);
    expect(produtos.size).toBe(0);
    expect(cupons.size).toBe(0);
  });

  it("o relatório em texto lista os passos e o que ficou para trás", async () => {
    const r = await executarTesteDeGravacao(lojaFalsa({ apagarProdutoFalha: true }).api);
    const txt = relatorioGravacaoTexto(r);
    expect(txt).toMatch(/COM PROBLEMAS/);
    expect(txt).toMatch(/\[OK\] Criar um produto de teste/);
    expect(txt).toMatch(/FICOU PARA TRÁS NA LOJA/);
    expect(relatorioGravacaoTexto(await executarTesteDeGravacao(lojaFalsa().api))).toMatch(/tudo certo/);
  });
});
