import { describe, expect, it } from "vitest";
import { MAX_FOTOS_IA, criarGeradorRascunho, montarDescricaoHtml, problemasDoRascunho, tamanhosDasAnotacoes, valorDasAnotacoes, type PedidoRascunho } from "@/lib/catalog/ai-draft";
import { SUFIXO_TITULO, TITULO_MAX } from "@/lib/seo/text";

const foto = { bytes: Buffer.from("x"), mediaType: "image/jpeg" as const };
const categorias = [
  { id: 10, name: "Vestidos" },
  { id: 20, name: "Saias" },
];

const resposta = (over: Record<string, unknown> = {}) => ({
  nome: "Saia Midi Plissada Azul",
  paragrafos: ["Saia midi plissada em tom azul, de caimento fluido.", "Combina com looks do dia a dia e ocasiões especiais."],
  detalhes: ["Cintura alta", "Comprimento midi", "Plissado em toda a peça."],
  categorias: [20, 999],
  tags: ["Saia", "plissada", "saia", "midi"],
  cores: ["azul marinho"],
  seo_titulo_base: "Saia Midi Plissada Azul",
  seo_descricao: "Saia midi plissada azul de cintura alta e caimento fluido, perfeita para compor looks elegantes no dia a dia. Confira na Donatelle Concept.",
  fotos: [
    { alt: "Saia midi plissada azul de cintura alta", qualidade: 3, observacao: "Boa, mas um pouco escura." },
    { alt: "Detalhe do plissado da saia azul", qualidade: 5, observacao: "Nítida." },
  ],
  foto_principal: 2,
  preco: "189,90",
  preco_promocional: "",
  tamanhos: ["P", "M", "XG"],
  peso_kg: "0,4",
  ...over,
});

/** Cliente falso: devolve as respostas em ordem e guarda os pedidos. */
function cliente(respostas: unknown[]) {
  const pedidos: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = {
    beta: {
      messages: {
        create: async (p: Record<string, unknown>) => (
          pedidos.push(p),
          { stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 600 }, content: [{ type: "text", text: JSON.stringify(respostas[Math.min(pedidos.length, respostas.length) - 1]) }] }
        ),
      },
    },
  } as never;
  return { c, pedidos };
}

const pedido = (over: Partial<PedidoRascunho> = {}): PedidoRascunho => ({ fotos: [foto, foto], anotacoes: "viscose, tamanhos P e M, R$ 189,90", categorias, ...over });

describe("criarGeradorRascunho", () => {
  it("monta o cadastro: textos limpos, categoria só da lista, cores padronizadas, principal sugerida", async () => {
    const { c, pedidos } = cliente([resposta()]);
    const r = await criarGeradorRascunho(c)(pedido());
    expect(r.nome).toBe("Saia Midi Plissada Azul");
    expect(r.descricaoHtml).toBe("<p>Saia midi plissada em tom azul, de caimento fluido.</p><p>Combina com looks do dia a dia e ocasiões especiais.</p><ul><li>Cintura alta</li><li>Comprimento midi</li><li>Plissado em toda a peça</li></ul>");
    expect(r.categoriaIds).toEqual([20]); // 999 não existe
    expect(r.tags).toBe("saia, plissada, midi");
    expect(r.cores).toEqual(["Azul Marinho"]);
    expect(r.seoTitulo.endsWith(SUFIXO_TITULO)).toBe(true);
    expect(r.seoTitulo.length).toBeLessThanOrEqual(TITULO_MAX);
    expect(r.fotos).toHaveLength(2);
    expect(r.fotoPrincipal).toBe(1);
    expect(r.entrada).toBe(3000);
    // o pedido leva as duas fotos, numeradas, e a lista de categorias
    const conteudo = pedidos[0]!.messages[0].content as Array<{ type: string; text?: string }>;
    expect(conteudo.filter((b) => b.type === "image")).toHaveLength(2);
    expect(conteudo.at(-1)!.text).toContain("20: Saias");
    expect(conteudo.at(-1)!.text).toContain("R$ 189,90");
  });

  it("preço, tamanhos e peso só valem se estão escritos nas anotações", async () => {
    const { c } = cliente([resposta()]);
    const r = await criarGeradorRascunho(c)(pedido());
    expect(r.preco).toBe("189,90");
    expect(r.tamanhos).toEqual(["P", "M"]); // XG não estava nas anotações
    expect(r.pesoKg).toBe(""); // 0,4 não estava nas anotações

    const { c: c2 } = cliente([resposta()]);
    const sem = await criarGeradorRascunho(c2)(pedido({ anotacoes: "" }));
    expect(sem.preco).toBe("");
    expect(sem.tamanhos).toEqual([]);
    expect(sem.pesoKg).toBe("");
  });

  it("texto que cita a modelo: refaz uma vez apontando o problema e usa a segunda resposta", async () => {
    const ruim = resposta({ paragrafos: ["Modelo veste saia midi azul."] });
    const { c, pedidos } = cliente([ruim, resposta()]);
    const r = await criarGeradorRascunho(c)(pedido());
    expect(pedidos).toHaveLength(2);
    const ultimo = (pedidos[1]!.messages[0].content as Array<{ text?: string }>).at(-1)!.text!;
    expect(ultimo).toContain("recusada");
    expect(r.descricaoHtml).not.toMatch(/veste/);
    expect(r.avisos).toEqual([]);
    expect(r.entrada).toBe(6000);
  });

  it("se a segunda resposta continua citando a modelo, devolve com aviso para conferir", async () => {
    const ruim = resposta({ paragrafos: ["Modelo veste saia midi azul."] });
    const { c } = cliente([ruim, ruim]);
    const r = await criarGeradorRascunho(c)(pedido());
    expect(r.avisos.length).toBeGreaterThan(0);
    expect(r.avisos[0]).toContain("Confira os textos");
  });

  it("pedido de ajuste leva o rascunho atual e a instrução", async () => {
    const { c, pedidos } = cliente([resposta()]);
    await criarGeradorRascunho(c)(pedido({ ajuste: "mais curta", atual: { nome: "Saia X", descricao: "Texto antigo", seoTitulo: "T", tags: "a" } }));
    const texto = (pedidos[0]!.messages[0].content as Array<{ text?: string }>).at(-1)!.text!;
    expect(texto).toContain("Pedido de ajuste: mais curta");
    expect(texto).toContain("Nome: Saia X");
    expect(texto).toContain("Texto antigo");
  });

  it("sem fotos, fotos demais e recusa do Claude dão erro claro", async () => {
    const { c } = cliente([resposta()]);
    await expect(criarGeradorRascunho(c)(pedido({ fotos: [] }))).rejects.toThrow("ao menos uma foto");
    await expect(criarGeradorRascunho(c)(pedido({ fotos: Array(MAX_FOTOS_IA + 1).fill(foto) }))).rejects.toThrow("no máximo");
    const recusa = { beta: { messages: { create: async () => ({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) } } } as never;
    await expect(criarGeradorRascunho(recusa)(pedido())).rejects.toThrow("recusou");
  });

  it("foto principal fora do intervalo vira a primeira; menos entradas de foto que o enviado ficam em branco", async () => {
    const { c } = cliente([resposta({ foto_principal: 9, fotos: [{ alt: "Saia azul", qualidade: 4, observacao: "" }] })]);
    const r = await criarGeradorRascunho(c)(pedido());
    expect(r.fotoPrincipal).toBe(0);
    expect(r.fotos).toHaveLength(2);
    expect(r.fotos[1]!.alt).toBe("");
  });
});

describe("conferência das respostas", () => {
  it("valorDasAnotacoes aceita milhar e vírgula e recusa o que não está escrito", () => {
    expect(valorDasAnotacoes("1299,90", "preço R$ 1.299,90 à vista")).toBe("1299,90");
    expect(valorDasAnotacoes("189,90", "R$ 189,90")).toBe("189,90");
    expect(valorDasAnotacoes("189", "custa 189 reais")).toBe("189");
    expect(valorDasAnotacoes("0,4", "peso 0,4 kg")).toBe("0,40");
    expect(valorDasAnotacoes("99,90", "R$ 189,90")).toBe("");
    expect(valorDasAnotacoes("abc", "R$ 189,90")).toBe("");
  });

  it("tamanhosDasAnotacoes exige o tamanho como palavra inteira", () => {
    expect(tamanhosDasAnotacoes(["P", "M", "G"], "tamanhos PP, M e G")).toEqual(["M", "G"]); // "P" só aparece dentro de "PP"
    expect(tamanhosDasAnotacoes(["único"], "tamanho unico")).toEqual(["ÚNICO"]);
    expect(tamanhosDasAnotacoes(["P"], "")).toEqual([]);
  });

  it("montarDescricaoHtml escapa HTML e limita a lista", () => {
    expect(montarDescricaoHtml(["Peça <b>linda</b> & leve"], [])).toBe("<p>Peça &lt;b&gt;linda&lt;/b&gt; &amp; leve</p>");
    expect(montarDescricaoHtml([], ["a", "b", "c", "d", "e", "f", "g"])).toBe("<ul><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li><li>f</li></ul>");
    expect(montarDescricaoHtml([" "], [])).toBe("");
  });

  it("problemasDoRascunho pega modelo, preço e tamanhos de texto fora do limite", () => {
    const base = resposta() as never;
    expect(problemasDoRascunho(base)).toEqual([]);
    expect(problemasDoRascunho(resposta({ nome: "Saia por R$ 99" }) as never).some((p) => /preço/.test(p))).toBe(true);
    expect(problemasDoRascunho(resposta({ fotos: [{ alt: "Mulher usando saia", qualidade: 3, observacao: "" }] }) as never).some((p) => /modelo/.test(p))).toBe(true);
    expect(problemasDoRascunho(resposta({ seo_titulo_base: "x".repeat(60) }) as never).some((p) => /seo_titulo_base/.test(p))).toBe(true);
  });
});
