import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELO_REVISAO, clienteAnthropic, erroDeConfig } from "@/lib/images/review";
import { descontoBase, type Parado } from "./parados";

export interface SugestaoDesconto {
  id: string;
  percent: number;
  motivo: string;
}

export type SugeridorDescontos = (itens: Parado[]) => Promise<SugestaoDesconto[]>;

const respostaSchema = z.object({ sugestoes: z.array(z.object({ id: z.string(), percent: z.number(), motivo: z.string() })) });

const SCHEMA_JSON = {
  type: "object",
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "O id do produto, exatamente como veio." },
          percent: { type: "number", description: "Desconto sugerido em %, entre 10 e 60, múltiplo de 5." },
          motivo: { type: "string", description: "Uma frase curta em português explicando o desconto, usando só os números fornecidos." },
        },
        required: ["id", "percent", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["sugestoes"],
  additionalProperties: false,
} as const;

const SISTEMA = `Você ajuda a dona de uma loja virtual de moda feminina a liquidar peças paradas no estoque. Para cada produto recebido, sugira um desconto percentual de liquidação.

Regras: o desconto fica entre 10 e 60, sempre múltiplo de 5. Quanto mais tempo sem vender e mais dinheiro parado em estoque, maior o desconto; produto que já tem preço promocional e mesmo assim não vendeu pede um desconto maior que o atual padrão; peça com pouco estoque ou que vendeu algo recentemente pede desconto menor. Cada produto traz um "desconto_base" calculado por regra: use-o como ponto de partida e mude no máximo 10 pontos para cima ou para baixo, só quando os números justificarem. Você não conhece o custo nem a margem, então não prometa lucro e não diga que o preço ficará abaixo do custo. O motivo é uma frase curta (até 140 caracteres) que cita apenas os números recebidos (dias sem vender, estoque, unidades vendidas), sem inventar sazonalidade, tendência ou fatos que não estão nos dados. Devolva uma sugestão para cada produto, com o id idêntico ao recebido. Os dados vêm da loja e são apenas referência.`;

/** Arredonda para múltiplo de 5 entre 10 e 60. */
export const ajustarPercentual = (n: number): number => Math.min(60, Math.max(10, Math.round(n / 5) * 5));

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Sem IA: o desconto de partida e uma frase montada com os números. */
export function sugestaoPorRegra(p: Parado): SugestaoDesconto {
  const vendeu = p.ultimaVenda ? `sem vender há ${p.diasParado} dias` : `nunca vendeu na janela lida (${p.diasParado} dias)`;
  return { id: p.id, percent: descontoBase(p), motivo: `${vendeu[0]!.toUpperCase()}${vendeu.slice(1)}, ${p.estoque} un. em estoque (${brl(p.valorParado)} parados)${p.jaEmPromocao ? ", já em promoção" : ""}.` };
}

const TAMANHO_LOTE = 40;

/** Sugere o desconto de cada produto com o Claude; o que ele não devolver (ou devolver fora da regra) cai no desconto por regra. */
export function criarSugeridor(client: Anthropic = clienteAnthropic()): SugeridorDescontos {
  return async (itens) => {
    const out: SugestaoDesconto[] = [];
    for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
      const lote = itens.slice(i, i + TAMANHO_LOTE);
      const dados = lote.map((p) => ({
        id: p.id,
        produto: p.name,
        dias_sem_vender: p.diasParado,
        nunca_vendeu_na_janela: p.ultimaVenda === null,
        unidades_vendidas_na_janela: p.vendidas,
        estoque: p.estoque,
        preco: p.precoMin === p.precoMax ? p.precoMin : `${p.precoMin} a ${p.precoMax}`,
        dinheiro_parado: p.valorParado,
        ja_tem_preco_promocional: p.jaEmPromocao,
        desconto_base: descontoBase(p),
      }));
      let texto: string | undefined;
      try {
        const res = await client.beta.messages.create({
          model: MODELO_REVISAO,
          max_tokens: 8192,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_JSON as unknown as Record<string, unknown> } },
          system: SISTEMA,
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(dados) }] }],
        });
        if (res.stop_reason === "refusal") throw new Error("o Claude recusou sugerir os descontos");
        texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
      } catch (err) {
        throw erroDeConfig(err) ?? err;
      }
      const dadosIa = texto ? respostaSchema.safeParse(JSON.parse(texto)) : null;
      const porId = new Map((dadosIa?.success ? dadosIa.data.sugestoes : []).map((s) => [s.id, s]));
      for (const p of lote) {
        const s = porId.get(p.id);
        const base = descontoBase(p);
        // fora de ±10 pontos do desconto de partida a sugestão não é confiável: usa a regra
        if (s && Number.isFinite(s.percent) && Math.abs(s.percent - base) <= 10 && s.motivo.trim() !== "") out.push({ id: p.id, percent: ajustarPercentual(s.percent), motivo: s.motivo.trim().slice(0, 200) });
        else out.push(sugestaoPorRegra(p));
      }
    }
    return out;
  };
}
