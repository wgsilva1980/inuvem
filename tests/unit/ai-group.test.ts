import { describe, expect, it } from "vitest";
import { criarAgrupador, normalizarGrupos } from "@/lib/catalog/ai-group";
import { MAX_FOTOS_IA, MAX_FOTOS_LOTE, rascunhoParaForm, type RascunhoIA } from "@/lib/catalog/ai-draft-shared";

const foto = { bytes: Buffer.from("x"), mediaType: "image/jpeg" as const };
const cliente = (resposta: unknown) => {
  const pedidos: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = {
    beta: {
      messages: {
        create: async (p: Record<string, unknown>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 5000, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify(resposta) }] }),
      },
    },
  } as never;
  return { c, pedidos };
};

describe("normalizarGrupos", () => {
  it("converte para índices 0-based, ordena e limpa o rótulo", () => {
    const g = normalizarGrupos([{ fotos: [3, 1], rotulo: "  Saia   midi \n azul  " }, { fotos: [2], rotulo: "Blusa" }], 3);
    expect(g).toEqual([
      { indices: [0, 2], rotulo: "Saia midi azul" },
      { indices: [1], rotulo: "Blusa" },
    ]);
  });

  it("ignora números inexistentes e repetidos (a primeira vez vale) e grupos vazios", () => {
    const g = normalizarGrupos([{ fotos: [1, 9, 0, -2, 1.2], rotulo: "A" }, { fotos: [1, 2], rotulo: "B" }, { fotos: [99], rotulo: "Vazio" }], 3);
    expect(g.map((x) => x.indices)).toEqual([[0], [1], [2]]);
    expect(g[0]!.rotulo).toBe("A");
    expect(g[1]!.rotulo).toBe("B");
  });

  it("fotos que ficaram de fora viram grupos próprios, para a pessoa decidir", () => {
    const g = normalizarGrupos([{ fotos: [1, 2], rotulo: "A" }], 4);
    expect(g.map((x) => x.indices)).toEqual([[0, 1], [2], [3]]);
    expect(g[1]!.rotulo).toBe("Foto 3 (sem grupo)");
  });

  it("divide grupos com mais fotos que o máximo da análise", () => {
    const g = normalizarGrupos([{ fotos: [1, 2, 3, 4, 5, 6, 7, 8], rotulo: "Vestido" }], 8, MAX_FOTOS_IA);
    expect(g).toHaveLength(2);
    expect(g[0]!.indices).toHaveLength(MAX_FOTOS_IA);
    expect(g[1]).toEqual({ indices: [6, 7], rotulo: "Vestido (continuação)" });
  });

  it("rótulo vazio ganha um nome provisório e é cortado em 60 caracteres", () => {
    const g = normalizarGrupos([{ fotos: [1], rotulo: "   " }, { fotos: [2], rotulo: "x".repeat(100) }], 2);
    expect(g[0]!.rotulo).toBe("Peça 1");
    expect(g[1]!.rotulo).toHaveLength(60);
  });
});

describe("criarAgrupador", () => {
  it("manda as fotos numeradas e devolve os grupos normalizados com o uso de tokens", async () => {
    const { c, pedidos } = cliente({ grupos: [{ fotos: [1, 3], rotulo: "Saia azul" }, { fotos: [2], rotulo: "Blusa branca" }] });
    const r = await criarAgrupador(c)([foto, foto, foto]);
    expect(r.grupos).toEqual([
      { indices: [0, 2], rotulo: "Saia azul" },
      { indices: [1], rotulo: "Blusa branca" },
    ]);
    expect(r.entrada).toBe(5000);
    const conteudo = pedidos[0]!.messages[0].content as Array<{ type: string; text?: string }>;
    expect(conteudo.filter((b) => b.type === "image")).toHaveLength(3);
    expect(conteudo.filter((b) => b.type === "text").map((b) => b.text)).toContain("Foto 3:");
    expect(pedidos[0]!.system).toContain("MESMO grupo");
  });

  it("sem fotos, fotos demais e recusa do Claude dão erro claro", async () => {
    const { c } = cliente({ grupos: [] });
    await expect(criarAgrupador(c)([])).rejects.toThrow("ao menos uma foto");
    await expect(criarAgrupador(c)(Array(MAX_FOTOS_LOTE + 1).fill(foto))).rejects.toThrow("no máximo");
    const recusa = { beta: { messages: { create: async () => ({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) } } } as never;
    await expect(criarAgrupador(recusa)([foto])).rejects.toThrow("recusou");
  });
});

describe("rascunhoParaForm", () => {
  const base: RascunhoIA = {
    nome: "Vestido Midi Azul",
    descricaoHtml: "<p>Texto</p>",
    categoriaIds: [10],
    tags: "vestido, midi",
    cores: ["Azul"],
    seoTitulo: "Vestido Midi Azul | Donatelle Concept",
    seoDescricao: "Descrição",
    fotos: [],
    fotoPrincipal: 0,
    preco: "189,90",
    promocional: "",
    tamanhos: ["P", "M"],
    pesoKg: "",
    avisos: [],
    entrada: 1,
    saida: 1,
  };

  it("preenche o formulário e marca como sugerido pela IA o que veio dela", () => {
    const f = rascunhoParaForm(base);
    expect(f).toMatchObject({ name: "Vestido Midi Azul", modo: "variacoes", cores: "Azul", tamanhos: "P, M", preco: "189,90", categorias: [10], peso: "", controlar: true });
    expect(f.iaMarcados).toEqual(expect.arrayContaining(["name", "description", "seo_title", "seo_description", "tags", "categories", "cores", "tamanhos", "preco"]));
    expect(f.iaMarcados).not.toContain("peso");
    expect(f.iaMarcados).not.toContain("promocional");
  });

  it("sem cores nem tamanhos, é produto simples", () => {
    const f = rascunhoParaForm({ ...base, cores: [], tamanhos: [], tags: "", categoriaIds: [] });
    expect(f.modo).toBe("simples");
    expect(f.iaMarcados).not.toContain("tags");
    expect(f.iaMarcados).not.toContain("categories");
  });
});
