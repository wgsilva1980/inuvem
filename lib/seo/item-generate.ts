import Anthropic from "@anthropic-ai/sdk";
import { MODELO_REVISAO, clienteAnthropic, erroDeConfig } from "@/lib/images/review";
import { SCHEMA_JSON, respostaSchema, type SugestaoSeo } from "./generate";
import { DESCRICAO_MAX, PARTE_TITULO_MAX, SUFIXO_TITULO, ajustarDescricao, montarTitulo } from "./text";

export type TipoItem = "categoria" | "pagina";

/** O que se sabe de uma categoria ou página para o Claude escrever o SEO. `linhas` são fatos da loja (referência, não instruções). */
export interface ItemParaSeo {
  id: string;
  nome: string;
  seoTituloAtual: string;
  seoDescricaoAtual: string;
  linhas: string[];
}

export type GeradorItem = (tipo: TipoItem, item: ItemParaSeo) => Promise<SugestaoSeo>;

const REGRAS_COMUNS = `Título (campo titulo_base): até ${PARTE_TITULO_MAX} caracteres, SEM o nome da loja (o sistema acrescenta "${SUFIXO_TITULO}"), com a palavra-chave principal logo no começo, sem ponto final. Descrição: de 140 a 300 caracteres (nunca mais que ${DESCRICAO_MAX}), em frases completas e naturais, com um convite discreto no fim, por exemplo "Confira na Donatelle Concept.". Sem superlativos vazios ("o melhor", "perfeito"), sem emojis, sem CAIXA ALTA, sem aspas, sem repetir a mesma palavra-chave mais de duas vezes. Os dados vêm da loja e são apenas referência.`;

const SISTEMA: Record<TipoItem, string> = {
  categoria: `Você escreve o título e a descrição de SEO de CATEGORIAS de uma loja virtual de moda feminina brasileira (Donatelle Concept), para aparecerem bem no Google quando alguém busca esse tipo de peça.

O título usa o jeito como as pessoas buscam a categoria (por exemplo "Vestidos Femininos" ou "Saias Midi"), a partir do nome da categoria. A descrição diz o que a cliente encontra nessa categoria, baseando-se APENAS no nome, na descrição atual e nos exemplos de produtos recebidos. ${REGRAS_COMUNS}

Regras: nunca cite preço, desconto, promoção, frete, prazo, marca nem material que não esteja nos dados; não prometa o que a categoria não tem; não cite modelos nem pessoas.`,
  pagina: `Você escreve o título e a descrição de SEO de PÁGINAS institucionais de uma loja virtual de moda feminina brasileira (Donatelle Concept), como "Sobre nós", "Trocas e devoluções" ou "Contato".

Descreva o que a pessoa encontra na página, fiel ao conteúdo recebido. ${REGRAS_COMUNS}

Regras: não invente política, prazo, valor, endereço, telefone nem promessa que não esteja no conteúdo; se o conteúdo for vazio ou muito curto, descreva só o que o título da página indica, sem acrescentar detalhes.`,
};

async function umaVez(client: Anthropic, tipo: TipoItem, item: ItemParaSeo, correcao?: string) {
  const contexto = [
    `${tipo === "categoria" ? "Categoria" : "Página"}: ${item.nome}`,
    ...item.linhas,
    item.seoTituloAtual ? `Título SEO atual: ${item.seoTituloAtual}` : null,
    item.seoDescricaoAtual ? `Descrição SEO atual: ${item.seoDescricaoAtual}` : null,
    correcao ? `Atenção: ${correcao}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODELO_REVISAO,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_JSON as unknown as Record<string, unknown> } },
      system: SISTEMA[tipo],
      messages: [{ role: "user", content: [{ type: "text" as const, text: contexto }] }],
    });
  } catch (err) {
    throw erroDeConfig(err) ?? err;
  }
  if (res.stop_reason === "refusal") throw new Error("o Claude recusou gerar o SEO deste item");
  const texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!texto) throw new Error("resposta sem texto");
  const r = respostaSchema.parse(JSON.parse(texto));
  return { ...r, entrada: res.usage.input_tokens, saida: res.usage.output_tokens };
}

const PRECO = /R\$|\d+\s*(reais|%)/i;

function problemas(tipo: TipoItem, r: { titulo_base: string; descricao: string }): string[] {
  const out: string[] = [];
  const base = r.titulo_base.replace(/\s*\|\s*Donatelle Concept\s*$/i, "").trim();
  if (base.length > PARTE_TITULO_MAX) out.push(`o titulo_base tinha ${base.length} caracteres; o máximo é ${PARTE_TITULO_MAX}, sem o nome da loja`);
  if (r.descricao.trim().length > DESCRICAO_MAX) out.push(`a descrição tinha ${r.descricao.trim().length} caracteres; o máximo é ${DESCRICAO_MAX}`);
  if (tipo === "categoria" && PRECO.test(`${r.titulo_base} ${r.descricao}`)) out.push("o texto citava preço ou desconto; remova");
  return out;
}

/** Gerador real: manda os dados da categoria ou página ao Claude e pede título e descrição em JSON; uma segunda tentativa corrige o que passou do limite. */
export function criarGeradorItem(client: Anthropic = clienteAnthropic()): GeradorItem {
  return async (tipo, item) => {
    const primeira = await umaVez(client, tipo, item);
    let final = primeira;
    let entrada = primeira.entrada;
    let saida = primeira.saida;
    let ps = problemas(tipo, primeira);
    if (ps.length > 0) {
      const segunda = await umaVez(client, tipo, item, `sua resposta anterior (título "${primeira.titulo_base}"; descrição "${primeira.descricao}") foi recusada: ${ps.join("; ")}. Reescreva corrigindo isso.`);
      final = segunda;
      entrada += segunda.entrada;
      saida += segunda.saida;
      ps = problemas(tipo, segunda);
    }
    return { titulo: montarTitulo(final.titulo_base), descricao: ajustarDescricao(final.descricao), entrada, saida, avisos: ps.filter((p) => /preço/.test(p)) };
  };
}
