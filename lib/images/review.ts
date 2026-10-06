import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ProductImage } from "@/lib/nuvemshop/types";
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

/** Fotos do espelho ainda sem revisão (ou com endereço novo, ou com erro de mais de 10 min). `ignorar` = já tentadas nesta rodada. */
export async function fotosPendentes(db: Db, storeId: string, limite: number, ignorar: string[] = []): Promise<FotoPendente[]> {
  return db.query<FotoPendente>(
    `SELECT (i->>'id') AS image_id, p.id::text AS product_id, (i->>'src') AS src, p.name AS produto,
            coalesce((SELECT array_agg(c->'name'->>'pt') FROM jsonb_array_elements(p.categories) c WHERE c->'name'->>'pt' IS NOT NULL), '{}') AS categorias,
            coalesce((SELECT array_agg(coalesce((SELECT string_agg(v2->>'pt', ' / ') FROM jsonb_array_elements(v.values) v2), '')) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id), '{}') AS variacoes,
            t.n::int AS posicao, jsonb_array_length(p.raw_json->'images') AS total
     FROM products p
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
     LEFT JOIN image_review r ON r.store_id = p.store_id AND r.image_id = (i->>'id')::bigint
     WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL
       AND (r.image_id IS NULL OR r.src <> (i->>'src') OR (r.error IS NOT NULL AND r.reviewed_at < now() - interval '10 minutes'))
       AND NOT ((i->>'id') = ANY($3::text[]))
     ORDER BY p.id, t.n
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
  fotos: number;
  revisadas: number;
  comErro: number;
  entrada: number;
  saida: number;
  porQualidade: Record<number, number>;
  comProblema: number;
  semAltNaLoja: number;
  altPendentes: number;
}

export async function resumoRevisao(db: Db, storeId: string): Promise<ResumoRevisao> {
  const [r] = await db.query<{
    fotos: string; revisadas: string; erros: string; entrada: string; saida: string; com_problema: string; sem_alt: string; alt_pendentes: string; q1: string; q2: string; q3: string; q4: string; q5: string;
  }>(
    `WITH f AS (
       SELECT p.store_id, (i->>'id')::bigint AS image_id, (i->>'src') AS src,
              coalesce(i->'alt'->>'pt', CASE WHEN jsonb_typeof(i->'alt') = 'array' THEN i->'alt'->>0 END, '') AS alt_loja
       FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) i
       WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL)
     SELECT count(*)::text AS fotos,
            count(r.image_id) FILTER (WHERE r.error IS NULL)::text AS revisadas,
            count(r.image_id) FILTER (WHERE r.error IS NOT NULL)::text AS erros,
            coalesce(sum(r.input_tokens), 0)::text AS entrada, coalesce(sum(r.output_tokens), 0)::text AS saida,
            count(*) FILTER (WHERE r.error IS NULL AND (cardinality(r.problems) > 0 OR r.quality <= 3))::text AS com_problema,
            count(*) FILTER (WHERE f.alt_loja = '')::text AS sem_alt,
            count(*) FILTER (WHERE r.alt_pt IS NOT NULL AND r.error IS NULL AND r.alt_aplicado_at IS NULL AND (f.alt_loja = '' OR r.alt_editado))::text AS alt_pendentes,
            count(*) FILTER (WHERE r.quality = 1)::text AS q1, count(*) FILTER (WHERE r.quality = 2)::text AS q2, count(*) FILTER (WHERE r.quality = 3)::text AS q3,
            count(*) FILTER (WHERE r.quality = 4)::text AS q4, count(*) FILTER (WHERE r.quality = 5)::text AS q5
     FROM f LEFT JOIN image_review r ON r.store_id = f.store_id AND r.image_id = f.image_id AND r.src = f.src`,
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
    semAltNaLoja: Number(r?.sem_alt ?? 0),
    altPendentes: Number(r?.alt_pendentes ?? 0),
  };
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

/* ---------- texto alternativo na loja ---------- */

export interface AltApi {
  updateAlt(productId: number, imageId: number, alt: Record<string, string> | string[]): Promise<ProductImage>;
  getImage(productId: number, imageId: number): Promise<ProductImage>;
}

/** O alt em português que a loja devolve (aceita as duas formas: objeto por idioma ou lista). */
export function altDaImagem(img: Pick<ProductImage, "alt">): string {
  const a = img.alt;
  if (!a) return "";
  if (Array.isArray(a)) return String(a[0] ?? "");
  return String((a as Record<string, string>).pt ?? "");
}

/** Forma de envio que a loja aceitou (descoberta na primeira vez e lembrada enquanto o servidor estiver de pé). */
let formaAlt: "objeto" | "lista" | null = null;

/** Grava o alt na loja. Na primeira vez confere lendo de volta; tenta o formato de objeto por idioma e, se não pegar, o de lista. */
export async function enviarAlt(api: AltApi, productId: number, imageId: number, texto: string): Promise<void> {
  const tentativas = formaAlt ? [formaAlt] : (["objeto", "lista"] as const);
  for (const forma of tentativas) {
    const r = await api.updateAlt(productId, imageId, forma === "objeto" ? { pt: texto } : [texto]);
    if (formaAlt === forma) return; // já comprovado antes
    const lida = await api.getImage(productId, imageId).catch(() => r);
    if (altDaImagem(lida) === texto) {
      formaAlt = forma;
      return;
    }
  }
  throw new Error("a loja não gravou o texto alternativo (conferi lendo de volta)");
}

export function _resetFormaAltParaTeste() {
  formaAlt = null;
}

async function registrar(db: Db, e: { storeId: string; actor: string; productId: number; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, 'imagem.alt', 'produto', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
    [e.storeId, e.actor, String(e.productId), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

/** Atualiza o alt da foto também no espelho (sem precisar rebuscar o produto). */
async function atualizarEspelho(db: Db, storeId: string, productId: number, imageId: string, texto: string) {
  await db.query(
    `UPDATE products SET raw_json = jsonb_set(raw_json, '{images}', coalesce((
       SELECT jsonb_agg(CASE WHEN (i->>'id') = $3 THEN jsonb_set(i, '{alt}', jsonb_build_object('pt', $4::text)) ELSE i END ORDER BY n)
       FROM jsonb_array_elements(raw_json->'images') WITH ORDINALITY AS t(i, n)), '[]'::jsonb))
     WHERE store_id = $1::uuid AND id = $2::bigint`,
    [storeId, productId, imageId, texto],
  );
}

export async function aplicarAltDaFoto(db: Db, api: AltApi, args: { storeId: string; actor: string; productId: number; imageId: string; texto: string; antes: string }): Promise<void> {
  const { storeId, actor, productId, imageId, texto, antes } = args;
  try {
    await enviarAlt(api, productId, Number(imageId), texto);
    await atualizarEspelho(db, storeId, productId, imageId, texto);
    await db.query(`UPDATE image_review SET alt_aplicado = $3, alt_aplicado_at = now() WHERE store_id = $1::uuid AND image_id = $2::bigint`, [storeId, imageId, texto]);
    await registrar(db, { storeId, actor, productId, antes: { id: Number(imageId), alt: antes }, depois: { id: Number(imageId), alt: texto }, resultado: { status: "ok" }, sucesso: true });
  } catch (err) {
    await registrar(db, { storeId, actor, productId, antes: { id: Number(imageId), alt: antes }, depois: { id: Number(imageId), alt: texto }, resultado: { mensagem: err instanceof Error ? err.message : String(err) }, sucesso: false });
    throw err;
  }
}

/** Salva o texto editado por uma pessoa e envia à loja (sobrescreve o que houver). */
export async function salvarAltEditado(db: Db, api: AltApi, args: { storeId: string; actor: string; productId: number; imageId: string; texto: string }): Promise<void> {
  const texto = args.texto.trim().replace(/\s+/g, " ").slice(0, 250);
  if (!texto) throw new Error("o texto alternativo não pode ficar vazio");
  const [atual] = await db.query<{ alt_loja: string }>(
    `SELECT coalesce(i->'alt'->>'pt', CASE WHEN jsonb_typeof(i->'alt') = 'array' THEN i->'alt'->>0 END, '') AS alt_loja
     FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) i
     WHERE p.store_id = $1::uuid AND p.id = $2::bigint AND (i->>'id') = $3`,
    [args.storeId, args.productId, args.imageId],
  );
  if (!atual) throw new Error("a foto não está mais no produto");
  await db.query(
    `INSERT INTO image_review (store_id, image_id, product_id, src, alt_pt, alt_editado)
     SELECT $1::uuid, $2::bigint, $3::bigint, (i->>'src'), $4, true
     FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.raw_json->'images') i WHERE p.store_id = $1::uuid AND p.id = $3::bigint AND (i->>'id') = $2::text
     ON CONFLICT (store_id, image_id) DO UPDATE SET alt_pt = $4, alt_editado = true`,
    [args.storeId, args.imageId, args.productId, texto],
  );
  await aplicarAltDaFoto(db, api, { ...args, texto, antes: atual.alt_loja });
}

/** Envia à loja os textos sugeridos (só onde a loja está sem texto, ou o texto foi editado), até estourar o orçamento. */
export async function aplicarAltPendentes(
  db: Db,
  api: AltApi,
  args: { storeId: string; actor: string; budgetMs: number; ignorar?: string[]; now?: () => number },
): Promise<{ aplicados: number; falhas: Array<{ imageId: string; mensagem: string }>; restantes: boolean }> {
  const now = args.now ?? Date.now;
  const inicio = now();
  const ignorar = new Set(args.ignorar ?? []);
  const out = { aplicados: 0, falhas: [] as Array<{ imageId: string; mensagem: string }>, restantes: false };
  while (true) {
    const [prox] = await db.query<{ image_id: string; product_id: string; alt_pt: string; alt_loja: string }>(
      `SELECT r.image_id::text, r.product_id::text, r.alt_pt,
              coalesce(f.i->'alt'->>'pt', CASE WHEN jsonb_typeof(f.i->'alt') = 'array' THEN f.i->'alt'->>0 END, '') AS alt_loja
       FROM image_review r
       JOIN products p ON p.store_id = r.store_id AND p.id = r.product_id
       CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) f(i)
       WHERE r.store_id = $1::uuid AND (f.i->>'id') = r.image_id::text AND (f.i->>'src') = r.src
         AND r.error IS NULL AND r.alt_pt IS NOT NULL AND r.alt_pt <> '' AND r.alt_aplicado_at IS NULL
         AND (coalesce(f.i->'alt'->>'pt', CASE WHEN jsonb_typeof(f.i->'alt') = 'array' THEN f.i->'alt'->>0 END, '') = '' OR r.alt_editado)
         AND NOT (r.image_id::text = ANY($2::text[]))
       ORDER BY r.product_id, r.image_id LIMIT 1`,
      [args.storeId, [...ignorar]],
    );
    if (!prox) return out;
    if (now() - inicio >= args.budgetMs) return { ...out, restantes: true };
    ignorar.add(prox.image_id);
    try {
      await aplicarAltDaFoto(db, api, { storeId: args.storeId, actor: args.actor, productId: Number(prox.product_id), imageId: prox.image_id, texto: prox.alt_pt, antes: prox.alt_loja });
      out.aplicados++;
    } catch (err) {
      out.falhas.push({ imageId: prox.image_id, mensagem: err instanceof Error ? err.message : String(err) });
      if (out.falhas.length >= 3 && out.aplicados === 0) return out; // algo sistemático (formato recusado, permissão): para em vez de tentar tudo
    }
  }
}
