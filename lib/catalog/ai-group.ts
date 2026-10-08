import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELO_REVISAO, clienteAnthropic, erroDeConfig } from "@/lib/images/review";
import { MAX_FOTOS_IA, MAX_FOTOS_LOTE } from "./ai-draft-shared";
import type { FotoParaIA } from "./ai-draft";

export interface GrupoFotos {
  /** Posições (0-based) das fotos enviadas que formam esta peça. */
  indices: number[];
  /** Nome curto da peça ("Saia midi plissada azul"). */
  rotulo: string;
}

export interface Agrupamento {
  grupos: GrupoFotos[];
  entrada: number;
  saida: number;
}

export type Agrupador = (fotos: FotoParaIA[]) => Promise<Agrupamento>;

const respostaSchema = z.object({ grupos: z.array(z.object({ fotos: z.array(z.number()), rotulo: z.string() })) });

const SCHEMA_JSON = {
  type: "object",
  properties: {
    grupos: {
      type: "array",
      description: "Um item para cada peça diferente. Toda foto aparece em exatamente um grupo.",
      items: {
        type: "object",
        properties: {
          fotos: { type: "array", items: { type: "integer" }, description: "Números das fotos (1 = primeira enviada) que mostram esta peça." },
          rotulo: { type: "string", description: "Nome curto da peça, até 60 caracteres (tipo, cor e um detalhe), sem ponto final." },
        },
        required: ["fotos", "rotulo"],
        additionalProperties: false,
      },
    },
  },
  required: ["grupos"],
  additionalProperties: false,
} as const;

const SISTEMA = `Você organiza fotos de uma loja virtual de moda feminina (Donatelle Concept). Recebe várias fotos numeradas, de peças variadas misturadas, e deve agrupar as fotos que mostram a MESMA peça, para cadastrar um produto por grupo.

Regras: ângulos diferentes, fotos de detalhe (decote, costas, tecido, barra) e fotos da peça vestida ou solta pertencem ao mesmo grupo quando é a mesma peça. O mesmo modelo em cores diferentes fica no MESMO grupo (vira um produto com variações de cor). Peças diferentes (tipo, modelagem, estampa ou tecido diferentes) ficam em grupos separados, mesmo que a cor seja parecida. Na dúvida entre juntar e separar, separe: é mais fácil a pessoa juntar depois. Toda foto aparece em exatamente um grupo; não invente números. Dê a cada grupo um rótulo curto e descritivo, só sobre a peça (nunca fale de modelo ou pessoa).`;

/**
 * Valida o agrupamento que veio do modelo: ignora números inexistentes e repetidos, põe as fotos que ficaram de fora em grupos próprios
 * (uma por foto, para a pessoa decidir) e divide grupos com mais fotos que o máximo da análise (a continuação vira outro grupo).
 */
export function normalizarGrupos(brutos: Array<{ fotos: number[]; rotulo: string }>, total: number, maximoPorGrupo = MAX_FOTOS_IA): GrupoFotos[] {
  const usadas = new Set<number>();
  const grupos: GrupoFotos[] = [];
  const nomeLimpo = (r: string) => r.replace(/\s+/g, " ").trim().slice(0, 60);
  for (const g of brutos) {
    const indices: number[] = [];
    for (const n of g.fotos) {
      const i = Math.round(n) - 1;
      if (i >= 0 && i < total && !usadas.has(i)) {
        usadas.add(i);
        indices.push(i);
      }
    }
    if (indices.length === 0) continue;
    indices.sort((a, b) => a - b);
    const rotulo = nomeLimpo(g.rotulo) || `Peça ${grupos.length + 1}`;
    for (let k = 0; k < indices.length; k += maximoPorGrupo) {
      grupos.push({ indices: indices.slice(k, k + maximoPorGrupo), rotulo: k === 0 ? rotulo : `${rotulo} (continuação)` });
    }
  }
  for (let i = 0; i < total; i++) if (!usadas.has(i)) grupos.push({ indices: [i], rotulo: `Foto ${i + 1} (sem grupo)` });
  return grupos;
}

/** Agrupador real: manda todas as miniaturas numeradas ao Claude e pede os grupos em JSON. */
export function criarAgrupador(client: Anthropic = clienteAnthropic()): Agrupador {
  return async (fotos) => {
    if (fotos.length === 0) throw new Error("Envie ao menos uma foto.");
    if (fotos.length > MAX_FOTOS_LOTE) throw new Error(`Envie no máximo ${MAX_FOTOS_LOTE} fotos de cada vez.`);
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
              ...fotos.flatMap((f, i) => [
                { type: "text" as const, text: `Foto ${i + 1}:` },
                { type: "image" as const, source: { type: "base64" as const, media_type: f.mediaType, data: f.bytes.toString("base64") } },
              ]),
              { type: "text" as const, text: `São ${fotos.length} fotos. Agrupe por peça.` },
            ],
          },
        ],
      });
    } catch (err) {
      throw erroDeConfig(err) ?? err;
    }
    if (res.stop_reason === "refusal") throw new Error("o Claude recusou analisar estas fotos");
    const texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!texto) throw new Error("resposta sem texto");
    const r = respostaSchema.parse(JSON.parse(texto));
    return { grupos: normalizarGrupos(r.grupos, fotos.length), entrada: res.usage.input_tokens, saida: res.usage.output_tokens };
  };
}
