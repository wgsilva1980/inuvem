import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "@/lib/sync/repo";

/** Modelo da revisão de fotos (leitura de imagem + texto curto): o padrão da API para novos códigos. */
export const MODELO_REVISAO = "claude-opus-5-5";
/** Preço por milhão de tokens, só para estimar o custo na tela. */
const PRECO_ENTRADA = 4;
const PRECO_SAIDA = 20;
export const estimarCustoUsd = (entrada: number, saida: number) => (entrada * PRECO_ENTRADA + saida * PRECO_SAIDA) / 1_000_000;

import { ALT_MAX } from "./alt";
export { ALT_MAX };
export const PROBLEMAS_VISUAIS = ["desfocada", "escura", "estourada", "cortada", "fundo_poluido", "peca_nao_aparece", "marca_dagua_ou_texto", "baixa_resolucao", "outro"] as const;
export type ProblemaVisual = (typeof PROBLEMAS_VISUAIS)[number];
export const PROBLEMA_VISUAL_LABEL: Record<ProblemaVisual, string> = {
  desfocada: "Desfocada",
  escura: "Escura",
  estourada: "Estourada (muita luz)",
  cortada: "Peça cortada",
  fundo_poluido: "Fundo poluído",
  peca_nao_aparece: "Peça não aparece bem",
  marca_dagua_ou_texto: "Marca d'água/texto",
  baixa_resolucao: "Baixa resolução",
  outro: "Outro problema",
};

export interface ContextoFoto {
  produto: string;
  categorias: string[];
  variacoes: string[];
  posicao: number;
  total: number;
}

export interface Revisao {
  alt: string;
  qualidade: number;
  problemas: ProblemaVisual[];
  observacao: string;
  entrada: number;
  saida: number;
}

/** Erro que não adianta tentar de novo foto a foto (chave inválida, sem permissão): interrompe a revisão. */
export class RevisaoConfigError extends Error {}

export type Revisor = (imagem: { bytes: Buffer; mediaType: "image/jpeg" }, contexto: ContextoFoto) => Promise<Revisao>;

const respostaSchema = z.object({
  alt: z.string(),
  qualidade: z.number().int().min(1).max(5),
  problemas: z.array(z.string()),
  observacao: z.string(),
});

const SCHEMA_JSON = {
  type: "object",
  properties: {
    alt: { type: "string", description: "Texto alternativo em português do Brasil, até 125 caracteres." },
    qualidade: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1 = inutilizável, 3 = aceitável, 5 = pronta para a loja." },
    problemas: { type: "array", items: { type: "string", enum: [...PROBLEMAS_VISUAIS] } },
    observacao: { type: "string", description: "Uma frase curta sobre a foto (o que melhorar ou por que a nota)." },
  },
  required: ["alt", "qualidade", "problemas", "observacao"],
  additionalProperties: false,
} as const;

const SISTEMA = `Você revisa fotos de produtos de uma loja virtual de moda feminina (Donatelle Concept) e escreve o texto alternativo (alt) de cada foto. O foco é sempre a PEÇA DE ROUPA (ou o acessório), nunca a modelo.

Texto alternativo: descreva só a peça, como numa ficha de produto, em português do Brasil, em uma frase de até ${ALT_MAX} caracteres. Diga o tipo da peça, a cor, a modelagem e os detalhes que se veem (comprimento, decote, alças, fenda, botões, bolsos, costura, textura, estampa, acabamento). Quando a foto for de detalhe, descreva o detalhe. Mesmo que a peça esteja vestida, escreva como se fosse a peça: por exemplo "Saia midi azul-clara de cintura alta com fenda frontal e bolsos", e não "Modelo veste saia azul". NUNCA mencione modelo, mulher, pessoa, corpo, rosto, cabelo, pose, "veste", "vestindo" nem "usando". Também não mencione o cenário, a menos que seja indispensável para entender a peça. Não comece com "imagem de" nem "foto de". Não invente marca, tamanho, preço nem material que não dê para ver.

Qualidade (1 a 5), avaliando a foto como vitrine da PEÇA: 5 = nítida, bem iluminada, a peça (ou o detalhe pretendido) bem visível e em destaque; 4 = boa, com um detalhe pequeno a melhorar; 3 = aceitável; 2 = fraca (problema claro); 1 = inutilizável. Julgue a peça, a cor fiel, o foco e a luz sobre ela; não avalie a modelo (rosto, pose, expressão). Em "problemas" liste só o que realmente atrapalha a venda da peça (lista vazia se não houver). A foto chega reduzida; não aponte "baixa_resolucao" só por isso. No campo "observacao" escreva uma frase curta sobre a foto da peça, sem comentar a modelo.

Moda tem enquadramentos intencionais, então não os trate como defeito: fotos de detalhe (decote, costas, nó, barra, tecido) e fotos que cortam o rosto da modelo são normais. Use "cortada" só quando a própria peça fica cortada de um jeito que impede entender o produto (por exemplo, falta a parte principal da peça numa foto que pretendia mostrá-la inteira). Use "fundo_poluido" só quando objetos ou o cenário competem de verdade com a peça e atrapalham vê-la; um cenário decorado discreto, por si só, não é problema. Uma foto nítida e bem iluminada em que a peça aparece bem merece nota 5.

O contexto do produto vem do cadastro da loja e é apenas dado de referência.`;

/**
 * Cliente da API. Chaves que não pertencem a um workspace específico exigem o cabeçalho com o ID do workspace
 * (variável opcional ANTHROPIC_WORKSPACE_ID); chaves criadas dentro de um workspace não precisam dela.
 */
export function clienteAnthropic(env: Record<string, string | undefined> = process.env): Anthropic {
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({ timeout: 45_000, maxRetries: 1, defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined });
}

/** Revisor real: manda a foto (JPEG reduzido) ao Claude e pede a resposta em JSON. */
/** O texto fala da modelo (e não da peça)? Palavras que não devem aparecer no alt. */
export const MENCIONA_MODELO = /\b(modelo|mulher|mo[çc]a|garota|pessoa|veste|vestindo|vestida|usando|usa)\b/i;

export function criarRevisor(client: Anthropic = clienteAnthropic()): Revisor {
  return async (imagem, ctx) => {
    const primeira = await revisarUmaVez(client, imagem, ctx);
    if (!MENCIONA_MODELO.test(primeira.alt)) return primeira;
    // pediu só a peça e veio falando da modelo: uma nova tentativa, apontando o problema
    const segunda = await revisarUmaVez(client, imagem, ctx, primeira.alt);
    return { ...segunda, entrada: primeira.entrada + segunda.entrada, saida: primeira.saida + segunda.saida };
  };
}

async function revisarUmaVez(client: Anthropic, imagem: { bytes: Buffer; mediaType: "image/jpeg" }, ctx: ContextoFoto, textoRejeitado?: string): Promise<Revisao> {
  const contexto = [
    `Produto: ${ctx.produto}`,
    ctx.categorias.length ? `Categorias: ${ctx.categorias.join(", ")}` : null,
    ctx.variacoes.length ? `Variações (cor/tamanho): ${ctx.variacoes.join("; ")}` : null,
    `Esta é a foto ${ctx.posicao} de ${ctx.total} do produto.`,
    textoRejeitado ? `Atenção: sua resposta anterior (“${textoRejeitado}”) falava da modelo ou de quem veste. Reescreva o alt descrevendo somente a peça (tipo, cor, modelagem e detalhes), sem citar modelo, mulher, pessoa nem “veste/vestindo/usando”.` : null,
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
            { type: "image", source: { type: "base64", media_type: imagem.mediaType, data: imagem.bytes.toString("base64") } },
            { type: "text", text: contexto },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new RevisaoConfigError("A chave da API da Anthropic (ANTHROPIC_API_KEY) é inválida ou não tem permissão.");
    }
    if (err instanceof Anthropic.BadRequestError && /credit|balance/i.test(err.message)) {
      throw new RevisaoConfigError("A conta da Anthropic está sem crédito.");
    }
    if (err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message)) {
      throw new RevisaoConfigError("A chave da Anthropic não está ligada a um workspace. Cadastre também a variável ANTHROPIC_WORKSPACE_ID (o ID do workspace) na Vercel e faça um novo deploy, ou crie a chave dentro de um workspace.");
    }
    throw err;
  }
  if (res.stop_reason === "refusal") throw new Error("o Claude recusou analisar esta foto");
  const texto = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!texto) throw new Error("resposta sem texto");
  const r = respostaSchema.parse(JSON.parse(texto));
  return {
    alt: r.alt.trim().replace(/\s+/g, " ").slice(0, ALT_MAX),
    qualidade: r.qualidade,
    problemas: r.problemas.filter((p): p is ProblemaVisual => (PROBLEMAS_VISUAIS as readonly string[]).includes(p)),
    observacao: r.observacao.trim().slice(0, 300),
    entrada: res.usage.input_tokens,
    saida: res.usage.output_tokens,
  };
}

/* ---------- foto -> JPEG reduzido ---------- */

export type Baixador = (url: string) => Promise<Buffer>;

const baixarPadrao: Baixador = async (url) => {
  if (!/^https:\/\//i.test(url)) throw new Error("endereço da foto não é https");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`a loja respondeu ${res.status} ao baixar a foto`);
  return Buffer.from(await res.arrayBuffer());
};

/** Reduz para até 768 px no lado maior (menos tokens, sem perder o necessário para descrever a peça). */
export async function prepararFoto(bytes: Buffer): Promise<{ bytes: Buffer; mediaType: "image/jpeg" }> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(bytes, { failOn: "none" }).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  return { bytes: out, mediaType: "image/jpeg" };
}

/* ---------- lote de revisão (retomável) ---------- */

export interface FotoPendente {
  image_id: string;
  product_id: string;
  src: string;
  produto: string;
  categorias: string[];
  variacoes: string[];
  posicao: number;
  total: number;
}

/**
 * Fotos principais (a primeira de cada produto, pela posição) ainda sem revisão (ou com endereço novo, ou com erro de mais de 10 min).
 * Só a principal é revisada: é a que aparece nas buscas e na vitrine, e a que mais vale ter um texto alternativo. `ignorar` = já tentadas nesta rodada.
 */
export async function fotosPendentes(db: Db, storeId: string, limite: number, ignorar: string[] = []): Promise<FotoPendente[]> {
  return db.query<FotoPendente>(
    `WITH fotos AS (
       SELECT p.id, p.store_id, p.name, p.categories, i, t.n,
              row_number() OVER (PARTITION BY p.id ORDER BY nullif(i->>'position', '')::int NULLS LAST, t.n) AS rn,
              jsonb_array_length(p.raw_json->'images') AS total
       FROM products p
       CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
       WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL)
     SELECT (f.i->>'id') AS image_id, f.id::text AS product_id, (f.i->>'src') AS src, f.name AS produto,
            coalesce((SELECT array_agg(c->'name'->>'pt') FROM jsonb_array_elements(f.categories) c WHERE c->'name'->>'pt' IS NOT NULL), '{}') AS categorias,
            coalesce((SELECT array_agg(coalesce((SELECT string_agg(v2->>'pt', ' / ') FROM jsonb_array_elements(v.values) v2), '')) FROM variants v WHERE v.store_id = f.store_id AND v.product_id = f.id), '{}') AS variacoes,
            coalesce(nullif(f.i->>'position', '')::int, f.n::int) AS posicao, f.total
     FROM fotos f
     LEFT JOIN image_review r ON r.store_id = f.store_id AND r.image_id = (f.i->>'id')::bigint
     WHERE f.rn = 1
       AND (r.image_id IS NULL OR r.src <> (f.i->>'src') OR (r.error IS NOT NULL AND r.reviewed_at < now() - interval '10 minutes'))
       AND NOT ((f.i->>'id') = ANY($3::text[]))
     ORDER BY f.id
     LIMIT $2`,
    [storeId, limite, ignorar],
  );
}

export async function gravarRevisao(db: Db, storeId: string, f: FotoPendente, r: { revisao?: Revisao; erro?: string; modelo?: string }): Promise<void> {
  const v = r.revisao;
  await db.query(
    `INSERT INTO image_review (store_id, image_id, product_id, src, model, alt_pt, alt_editado, quality, problems, note, error, input_tokens, output_tokens, reviewed_at)
     VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5, $6, false, $7, $8::text[], $9, $10, $11, $12, now())
     ON CONFLICT (store_id, image_id) DO UPDATE SET
       product_id = $3, src = $4, model = $5, alt_pt = $6, alt_editado = false, quality = $7, problems = $8::text[], note = $9, error = $10,
       input_tokens = $11, output_tokens = $12, reviewed_at = now(), alt_aplicado = NULL, alt_aplicado_at = NULL`,
    [storeId, f.image_id, f.product_id, f.src, r.modelo ?? MODELO_REVISAO, v?.alt ?? null, v?.qualidade ?? null, v?.problemas ?? [], v?.observacao ?? null, r.erro ?? null, v?.entrada ?? null, v?.saida ?? null],
  );
}

export interface ResumoRevisao {
  /** Fotos principais (uma por produto com foto). */
  fotos: number;
  revisadas: number;
  comErro: number;
  entrada: number;
  saida: number;
  porQualidade: Record<number, number>;
  comProblema: number;
}

/** Fotos principais (1 por produto) com a revisão correspondente, se houver. Base da tela, do resumo e da exportação. */
const PRINCIPAIS = `WITH fotos AS (
    SELECT p.id AS product_id, p.name AS produto, p.store_id, (i->>'id')::bigint AS image_id, (i->>'src') AS src,
           nullif(i->>'position', '')::int AS position,
           row_number() OVER (PARTITION BY p.id ORDER BY nullif(i->>'position', '')::int NULLS LAST, t.n) AS rn
    FROM products p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
    WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL),
  principais AS (SELECT * FROM fotos WHERE rn = 1)`;

export async function resumoRevisao(db: Db, storeId: string): Promise<ResumoRevisao> {
  const [r] = await db.query<{ fotos: string; revisadas: string; erros: string; com_problema: string; q1: string; q2: string; q3: string; q4: string; q5: string; entrada: string; saida: string }>(
    `${PRINCIPAIS}
     SELECT count(*)::text AS fotos,
            count(r.image_id) FILTER (WHERE r.error IS NULL)::text AS revisadas,
            count(r.image_id) FILTER (WHERE r.error IS NOT NULL)::text AS erros,
            count(*) FILTER (WHERE r.error IS NULL AND (cardinality(r.problems) > 0 OR r.quality <= 3))::text AS com_problema,
            count(*) FILTER (WHERE r.quality = 1)::text AS q1, count(*) FILTER (WHERE r.quality = 2)::text AS q2, count(*) FILTER (WHERE r.quality = 3)::text AS q3,
            count(*) FILTER (WHERE r.quality = 4)::text AS q4, count(*) FILTER (WHERE r.quality = 5)::text AS q5,
            (SELECT coalesce(sum(input_tokens), 0) FROM image_review WHERE store_id = $1::uuid)::text AS entrada,
            (SELECT coalesce(sum(output_tokens), 0) FROM image_review WHERE store_id = $1::uuid)::text AS saida
     FROM principais f LEFT JOIN image_review r ON r.store_id = f.store_id AND r.image_id = f.image_id AND r.src = f.src`,
    [storeId],
  );
  return {
    fotos: Number(r?.fotos ?? 0),
    revisadas: Number(r?.revisadas ?? 0),
    comErro: Number(r?.erros ?? 0),
    entrada: Number(r?.entrada ?? 0),
    saida: Number(r?.saida ?? 0),
    porQualidade: { 1: Number(r?.q1 ?? 0), 2: Number(r?.q2 ?? 0), 3: Number(r?.q3 ?? 0), 4: Number(r?.q4 ?? 0), 5: Number(r?.q5 ?? 0) },
    comProblema: Number(r?.com_problema ?? 0),
  };
}

export interface LinhaRevisao {
  product_id: string;
  produto: string;
  image_id: string;
  src: string;
  position: number | null;
  alt_pt: string | null;
  quality: number | null;
  problems: string[];
  note: string | null;
  error: string | null;
  revisada: boolean;
}

/** Uma linha por produto: a foto principal e a revisão dela (se já feita). */
export async function linhasRevisao(db: Db, storeId: string): Promise<LinhaRevisao[]> {
  return db.query<LinhaRevisao>(
    `${PRINCIPAIS}
     SELECT f.product_id::text, f.produto, f.image_id::text, f.src, f.position, r.alt_pt, r.quality, coalesce(r.problems, '{}') AS problems, r.note, r.error,
            (r.image_id IS NOT NULL AND r.src = f.src) AS revisada
     FROM principais f LEFT JOIN image_review r ON r.store_id = f.store_id AND r.image_id = f.image_id
     ORDER BY f.produto, f.product_id`,
    [storeId],
  );
}

const celula = (v: string | number | null) => {
  const t = v === null ? "" : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Planilha (CSV com `;` e BOM, para abrir no Excel em português) com os textos alternativos sugeridos das fotos principais revisadas. */
export function gerarCsvRevisao(linhas: LinhaRevisao[]): string {
  const cab = ["Produto", "ID do produto", "Nota (1 a 5)", "Problemas", "Texto alternativo sugerido", "Observação", "Foto (endereço)"];
  const linhasCsv = linhas
    .filter((l) => l.revisada && !l.error && l.alt_pt)
    .map((l) => [l.produto, l.product_id, l.quality, l.problems.map((p) => PROBLEMA_VISUAL_LABEL[p as ProblemaVisual] ?? p).join(", "), l.alt_pt, l.note, l.src].map(celula).join(";"));
  return `\uFEFF${[cab.join(";"), ...linhasCsv].join("\r\n")}\r\n`;
}

/** Revisa fotos pendentes até estourar o orçamento de tempo (ou `maxFotos`), `concorrencia` por vez. */
export async function revisarPendentes(
  db: Db,
  args: { storeId: string; budgetMs: number; revisor: Revisor; baixar?: Baixador; concorrencia?: number; maxFotos?: number; ignorar?: string[]; now?: () => number },
): Promise<{ revisadas: number; erros: number; restantes: boolean; tentadas: string[] }> {
  const now = args.now ?? Date.now;
  const baixar = args.baixar ?? baixarPadrao;
  const concorrencia = args.concorrencia ?? 4;
  const inicio = now();
  const tentadas = new Set(args.ignorar ?? []);
  let revisadas = 0;
  let erros = 0;
  while (now() - inicio < args.budgetMs && (args.maxFotos === undefined || revisadas + erros < args.maxFotos)) {
    const faltam = args.maxFotos === undefined ? concorrencia * 2 : Math.min(concorrencia * 2, args.maxFotos - revisadas - erros);
    const lote = await fotosPendentes(db, args.storeId, faltam, [...tentadas]);
    if (lote.length === 0) return { revisadas, erros, restantes: false, tentadas: [...tentadas] };
    for (const f of lote) tentadas.add(f.image_id);
    let proximo = 0;
    let config: RevisaoConfigError | null = null;
    await Promise.all(
      Array.from({ length: Math.min(concorrencia, lote.length) }, async () => {
        while (proximo < lote.length && !config) {
          const f = lote[proximo++]!;
          try {
            const foto = await prepararFoto(await baixar(f.src));
            const revisao = await args.revisor(foto, { produto: f.produto, categorias: f.categorias, variacoes: f.variacoes.filter(Boolean), posicao: f.posicao, total: f.total });
            await gravarRevisao(db, args.storeId, f, { revisao });
            revisadas++;
          } catch (err) {
            if (err instanceof RevisaoConfigError) {
              config = err;
              return;
            }
            await gravarRevisao(db, args.storeId, f, { erro: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
            erros++;
          }
        }
      }),
    );
    if (config) throw config;
  }
  const restam = await fotosPendentes(db, args.storeId, 1, [...tentadas]);
  return { revisadas, erros, restantes: restam.length > 0, tentadas: [...tentadas] };
}
