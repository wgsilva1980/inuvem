import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MENCIONA_MODELO, MODELO_REVISAO, RevisaoConfigError, clienteAnthropic, erroDeConfig, prepararFoto } from "@/lib/images/review";
import { DESCRICAO_MAX, PARTE_TITULO_MAX, SUFIXO_TITULO, ajustarDescricao, montarTitulo } from "./text";

export interface ContextoSeo {
  produto: string;
  categorias: string[];
  variacoes: string[];
  descricaoAtual: string;
  seoTituloAtual: string;
  seoDescricaoAtual: string;
}

export interface SugestaoSeo {
  titulo: string;
  descricao: string;
  entrada: number;
  saida: number;
  /** O texto ainda cita a modelo ou preço depois da nova tentativa (a pessoa deve conferir). */
  avisos: string[];
}

export type FotoSeo = { bytes: Buffer; mediaType: "image/jpeg" } | null;
export type GeradorSeo = (foto: FotoSeo, contexto: ContextoSeo) => Promise<SugestaoSeo>;

const respostaSchema = z.object({ titulo_base: z.string(), descricao: z.string() });

const SCHEMA_JSON = {
  type: "object",
  properties: {
    titulo_base: { type: "string", description: `Título do produto SEM o nome da loja, no máximo ${PARTE_TITULO_MAX} caracteres.` },
    descricao: { type: "string", description: `Descrição para o Google, de 140 a 300 caracteres (máximo ${DESCRICAO_MAX}).` },
  },
  required: ["titulo_base", "descricao"],
  additionalProperties: false,
} as const;

const SISTEMA = `Você escreve o título e a descrição de SEO de produtos de uma loja virtual de moda feminina brasileira (Donatelle Concept), para aparecerem bem no Google e convidarem ao clique.

Título (campo titulo_base): até ${PARTE_TITULO_MAX} caracteres, SEM o nome da loja (o sistema acrescenta "${SUFIXO_TITULO}"). Comece pela palavra-chave principal (o tipo da peça) e acrescente um ou dois atributos que diferenciam: cor, modelagem, tecido ou detalhe. Exemplo: "Saia Midi com Fenda Azul". Use maiúscula inicial nas palavras principais, sem ponto final.

Descrição: de 140 a 300 caracteres (nunca mais que ${DESCRICAO_MAX}), em frases completas e naturais. Descreva a peça (tipo, cor, modelagem, tecido e detalhes que realmente existem), diga um benefício concreto e feche com um convite discreto à compra, por exemplo "Confira na Donatelle Concept."

Regras: fale só da peça; nunca cite modelo, mulher, pessoa, nem "veste", "vestindo" ou "usando". Não invente tecido, medidas, preço, promoção, frete, marca nem característica que não esteja nos dados do cadastro ou na foto. Sem superlativos vazios ("o melhor", "perfeito", "incrível"), sem emojis, sem texto em CAIXA ALTA, sem aspas. Não repita a mesma palavra-chave mais de duas vezes. Se o cadastro atual (SEO atual ou descrição) já trouxer informação útil, aproveite e melhore. Os dados de contexto vêm da loja e são apenas referência.`;

const PRECO = /R\$|\d+\s*(reais|%)/i;

async function umaVez(client: Anthropic, foto: FotoSeo, ctx: ContextoSeo, correcao?: string) {
  const contexto = [
    `Produto: ${ctx.produto}`,
    ctx.categorias.length ? `Categorias: ${ctx.categorias.join(", ")}` : null,
    ctx.variacoes.length ? `Variações (cor/tamanho): ${ctx.variacoes.join("; ")}` : null,
    ctx.descricaoAtual ? `Descrição atual do produto: ${ctx.descricaoAtual}` : null,
    ctx.seoTituloAtual ? `Título SEO atual: ${ctx.seoTituloAtual}` : null,
    ctx.seoDescricaoAtual ? `Descrição SEO atual: ${ctx.seoDescricaoAtual}` : null,
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
      system: SISTEMA,
      messages: [
        {
          role: "user",
          content: [
            ...(foto ? [{ type: "image" as const, source: { type: "base64" as const, media_type: foto.mediaType, data: foto.bytes.toString("base64") } }] : []),
            { type: "text" as const, text: contexto },
          ],
        },
      ],
    });
  } catch (err) {
    throw erroDeConfig(err) ?? err;
  }
  if (res.stop_reason === "refusal") throw new Error("o Claude recusou gerar o SEO deste produto");
  const texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!texto) throw new Error("resposta sem texto");
  const r = respostaSchema.parse(JSON.parse(texto));
  return { ...r, entrada: res.usage.input_tokens, saida: res.usage.output_tokens };
}

/** O que está errado na resposta (vira instrução na segunda tentativa); vazio = ok. */
function problemasDaResposta(r: { titulo_base: string; descricao: string }): string[] {
  const out: string[] = [];
  const base = r.titulo_base.replace(/\s*\|\s*Donatelle Concept\s*$/i, "").trim();
  if (base.length > PARTE_TITULO_MAX) out.push(`o titulo_base tinha ${base.length} caracteres; o máximo é ${PARTE_TITULO_MAX}, sem o nome da loja`);
  if (r.descricao.trim().length > DESCRICAO_MAX) out.push(`a descrição tinha ${r.descricao.trim().length} caracteres; o máximo é ${DESCRICAO_MAX}`);
  if (MENCIONA_MODELO.test(`${r.titulo_base} ${r.descricao}`)) out.push("o texto citava a modelo ou quem veste a peça; fale só da peça");
  if (PRECO.test(`${r.titulo_base} ${r.descricao}`)) out.push("o texto citava preço ou desconto; remova");
  return out;
}

/** Gerador real: manda os dados do produto (e a foto principal, se houver) ao Claude e pede título e descrição em JSON. */
export function criarGeradorSeo(client: Anthropic = clienteAnthropic()): GeradorSeo {
  return async (foto, ctx) => {
    const primeira = await umaVez(client, foto, ctx);
    let final = primeira;
    let entrada = primeira.entrada;
    let saida = primeira.saida;
    let problemas = problemasDaResposta(primeira);
    if (problemas.length > 0) {
      const segunda = await umaVez(client, foto, ctx, `sua resposta anterior (título "${primeira.titulo_base}"; descrição "${primeira.descricao}") foi recusada: ${problemas.join("; ")}. Reescreva corrigindo isso.`);
      final = segunda;
      entrada += segunda.entrada;
      saida += segunda.saida;
      problemas = problemasDaResposta(segunda);
    }
    const avisos = problemas.filter((p) => /modelo|preço/.test(p));
    return { titulo: montarTitulo(final.titulo_base), descricao: ajustarDescricao(final.descricao), entrada, saida, avisos };
  };
}

export { RevisaoConfigError, prepararFoto };
