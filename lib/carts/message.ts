import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELO_REVISAO, clienteAnthropic, erroDeConfig } from "@/lib/images/review";
import type { Carrinho } from "./logic";

export interface CupomDaMensagem {
  codigo: string;
  percent: number;
  /** Validade já escrita, ex.: "até 15/10". */
  validade: string;
}

export type GeradorMensagem = (c: Carrinho, cupom: CupomDaMensagem | null) => Promise<string>;

const respostaSchema = z.object({ mensagem: z.string() });
const SCHEMA_JSON = {
  type: "object",
  properties: { mensagem: { type: "string", description: "A mensagem pronta para enviar, em português do Brasil." } },
  required: ["mensagem"],
  additionalProperties: false,
} as const;

const SISTEMA = `Você escreve mensagens curtas de WhatsApp, em português do Brasil, para a Donatelle Concept, loja de moda feminina, lembrando uma cliente de uma compra que ficou pela metade.

Tom: caloroso, educado e humano, como uma vendedora atenciosa; sem pressão e sem urgência falsa. Chame a cliente pelo primeiro nome (se não houver nome, comece com "Olá!"). Cite no máximo duas peças do carrinho pelo nome, de forma natural. Ofereça ajuda (tamanho, dúvidas) e inclua o link do carrinho exatamente como recebido. Se houver cupom, diga o código e a validade exatamente como recebidos e que o desconto é de cortesia. No máximo um emoji. Assine "Donatelle Concept". Até 450 caracteres.

Regras: não invente desconto, prazo, frete grátis, brinde, estoque ou qualquer fato que não esteja nos dados; não mencione valores de preço; não cite que o carrinho foi "abandonado". Os dados vêm da loja e são apenas referência.`;

/** Garante o que a mensagem não pode perder: o link do carrinho e o código do cupom. */
export function completarMensagem(texto: string, c: Carrinho, cupom: CupomDaMensagem | null): string {
  let m = texto.trim();
  if (cupom && !m.toUpperCase().includes(cupom.codigo.toUpperCase())) m += `\n\nCupom de cortesia: ${cupom.codigo} (${cupom.percent}% de desconto, ${cupom.validade}).`;
  if (c.url && !m.includes(c.url)) m += `\n\nSeu carrinho: ${c.url}`;
  return m;
}

/** Gerador real: manda ao Claude só o primeiro nome, os nomes das peças, o link e o cupom (sem telefone, e-mail ou valores). */
export function criarGeradorMensagem(client: Anthropic = clienteAnthropic()): GeradorMensagem {
  return async (c, cupom) => {
    const dados = {
      primeiro_nome: c.primeiroNome,
      pecas: c.itens.slice(0, 5).map((i) => ({ nome: i.nome, quantidade: i.quantidade })),
      link_do_carrinho: c.url,
      cupom: cupom ? { codigo: cupom.codigo, desconto_percentual: cupom.percent, validade: cupom.validade } : null,
    };
    let texto: string | undefined;
    try {
      const res = await client.beta.messages.create({
        model: MODELO_REVISAO,
        max_tokens: 2048,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_JSON as unknown as Record<string, unknown> } },
        system: SISTEMA,
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(dados) }] }],
      });
      if (res.stop_reason === "refusal") throw new Error("o Claude recusou escrever a mensagem");
      texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    } catch (err) {
      throw erroDeConfig(err) ?? err;
    }
    if (!texto) throw new Error("resposta sem texto");
    return completarMensagem(respostaSchema.parse(JSON.parse(texto)).mensagem, c, cupom);
  };
}

/** Mensagem pronta sem IA (se a chave da Anthropic não estiver configurada). */
export function mensagemPadrao(c: Carrinho, cupom: CupomDaMensagem | null): string {
  const peca = c.itens[0]?.nome;
  const base = `${c.primeiroNome ? `Oi, ${c.primeiroNome}!` : "Olá!"} Aqui é da Donatelle Concept. Vi que você deixou ${peca ? `${peca} ` : "alguma peça "}no carrinho. Posso ajudar com tamanho ou alguma dúvida? 💛`;
  return completarMensagem(`${base}\n\nDonatelle Concept`, c, cupom);
}
