import { toEdit } from "@/lib/catalog/edit";
import { getProductDetail } from "@/lib/catalog/query";
import { updateProduct, type ProductApi } from "@/lib/catalog/update";
import { MODELO_REVISAO, RevisaoConfigError, baixarFoto, prepararFoto, type Baixador } from "@/lib/images/review";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Db } from "@/lib/sync/repo";
import type { ContextoSeo, GeradorSeo, SugestaoSeo } from "./generate";
import { DESCRICAO_MAX, TITULO_MAX, textoDaDescricao } from "./text";

export interface ProdutoParaSeo extends ContextoSeo {
  product_id: string;
  /** Foto principal (a de menor posição), se houver. */
  foto: string | null;
}

/** Produtos sem sugestão (ou com erro de mais de 10 min). `ignorar` = já tentados nesta rodada. */
export async function produtosParaSeo(db: Db, storeId: string, limite: number, ignorar: string[] = []): Promise<ProdutoParaSeo[]> {
  const rows = await db.query<{
    product_id: string; produto: string; descricao: string | null; seo_titulo: string; seo_descricao: string; categorias: string[]; variacoes: string[]; foto: string | null;
  }>(
    `SELECT p.id::text AS product_id, p.name AS produto, p.description AS descricao,
            coalesce(p.raw_json->'seo_title'->>'pt', '') AS seo_titulo, coalesce(p.raw_json->'seo_description'->>'pt', '') AS seo_descricao,
            coalesce((SELECT array_agg(c->'name'->>'pt') FROM jsonb_array_elements(p.categories) c WHERE c->'name'->>'pt' IS NOT NULL), '{}') AS categorias,
            coalesce((SELECT array_agg(DISTINCT coalesce((SELECT string_agg(v2->>'pt', ' / ') FROM jsonb_array_elements(v.values) v2), '')) FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id), '{}') AS variacoes,
            (SELECT i->>'src' FROM jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
             WHERE (i->>'src') IS NOT NULL ORDER BY nullif(i->>'position', '')::int NULLS LAST, t.n LIMIT 1) AS foto
     FROM products p
     LEFT JOIN seo_suggestion s ON s.store_id = p.store_id AND s.product_id = p.id
     WHERE p.store_id = $1::uuid
       AND (s.product_id IS NULL OR (s.error IS NOT NULL AND s.generated_at < now() - interval '10 minutes'))
       AND NOT (p.id::text = ANY($3::text[]))
     ORDER BY p.id
     LIMIT $2`,
    [storeId, limite, ignorar],
  );
  return rows.map((r) => ({
    product_id: r.product_id,
    produto: r.produto,
    categorias: r.categorias.filter(Boolean),
    variacoes: r.variacoes.filter(Boolean),
    descricaoAtual: textoDaDescricao(r.descricao),
    seoTituloAtual: r.seo_titulo,
    seoDescricaoAtual: r.seo_descricao,
    foto: r.foto,
  }));
}

export async function gravarSeo(db: Db, storeId: string, productId: string, r: { sugestao?: SugestaoSeo; erro?: string }): Promise<void> {
  const s = r.sugestao;
  await db.query(
    `INSERT INTO seo_suggestion (store_id, product_id, title, description, edited, model, warning, error, input_tokens, output_tokens, generated_at)
     VALUES ($1::uuid, $2::bigint, $3, $4, false, $5, $6, $7, $8, $9, now())
     ON CONFLICT (store_id, product_id) DO UPDATE SET
       title = $3, description = $4, edited = false, model = $5, warning = $6, error = $7, input_tokens = $8, output_tokens = $9,
       generated_at = now(), applied_title = NULL, applied_description = NULL, applied_at = NULL`,
    [storeId, productId, s?.titulo ?? null, s?.descricao ?? null, MODELO_REVISAO, s?.avisos.join("; ") || null, r.erro ?? null, s?.entrada ?? null, s?.saida ?? null],
  );
}

/** Gera sugestões de SEO para os produtos pendentes até estourar o orçamento de tempo (ou `maxProdutos`), `concorrencia` por vez. */
export async function gerarSeoPendentes(
  db: Db,
  args: { storeId: string; budgetMs: number; gerador: GeradorSeo; baixar?: Baixador; concorrencia?: number; maxProdutos?: number; ignorar?: string[]; now?: () => number },
): Promise<{ geradas: number; erros: number; restantes: boolean; tentados: string[] }> {
  const now = args.now ?? Date.now;
  const baixar = args.baixar ?? baixarFoto;
  const concorrencia = args.concorrencia ?? 4;
  const inicio = now();
  const tentados = new Set(args.ignorar ?? []);
  let geradas = 0;
  let erros = 0;
  while (now() - inicio < args.budgetMs && (args.maxProdutos === undefined || geradas + erros < args.maxProdutos)) {
    const faltam = args.maxProdutos === undefined ? concorrencia * 2 : Math.min(concorrencia * 2, args.maxProdutos - geradas - erros);
    const lote = await produtosParaSeo(db, args.storeId, faltam, [...tentados]);
    if (lote.length === 0) return { geradas, erros, restantes: false, tentados: [...tentados] };
    for (const p of lote) tentados.add(p.product_id);
    let proximo = 0;
    let config: RevisaoConfigError | null = null;
    await Promise.all(
      Array.from({ length: Math.min(concorrencia, lote.length) }, async () => {
        while (proximo < lote.length && !config) {
          const p = lote[proximo++]!;
          try {
            // a foto ajuda a descrever a peça; se não baixar, o texto sai só com os dados do cadastro
            const foto = p.foto ? await baixar(p.foto).then((b) => prepararFoto(b)).catch(() => null) : null;
            const sugestao = await args.gerador(foto, p);
            await gravarSeo(db, args.storeId, p.product_id, { sugestao });
            geradas++;
          } catch (err) {
            if (err instanceof RevisaoConfigError) {
              config = err;
              return;
            }
            await gravarSeo(db, args.storeId, p.product_id, { erro: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
            erros++;
          }
        }
      }),
    );
    if (config) throw config;
  }
  const restam = await produtosParaSeo(db, args.storeId, 1, [...tentados]);
  return { geradas, erros, restantes: restam.length > 0, tentados: [...tentados] };
}

/* ---------- resumo e lista ---------- */

export interface ResumoSeo {
  produtos: number;
  geradas: number;
  comErro: number;
  aplicadas: number;
  /** Produtos que hoje não têm título ou descrição de SEO na loja. */
  semSeo: number;
  entrada: number;
  saida: number;
}

export async function resumoSeo(db: Db, storeId: string): Promise<ResumoSeo> {
  const [r] = await db.query<{ produtos: string; geradas: string; erros: string; aplicadas: string; sem_seo: string; entrada: string; saida: string }>(
    `SELECT count(*)::text AS produtos,
            count(s.product_id) FILTER (WHERE s.error IS NULL)::text AS geradas,
            count(s.product_id) FILTER (WHERE s.error IS NOT NULL)::text AS erros,
            count(s.product_id) FILTER (WHERE s.applied_at IS NOT NULL)::text AS aplicadas,
            count(*) FILTER (WHERE coalesce(p.raw_json->'seo_title'->>'pt', '') = '' OR coalesce(p.raw_json->'seo_description'->>'pt', '') = '')::text AS sem_seo,
            coalesce(sum(s.input_tokens), 0)::text AS entrada, coalesce(sum(s.output_tokens), 0)::text AS saida
     FROM products p LEFT JOIN seo_suggestion s ON s.store_id = p.store_id AND s.product_id = p.id
     WHERE p.store_id = $1::uuid`,
    [storeId],
  );
  return {
    produtos: Number(r?.produtos ?? 0),
    geradas: Number(r?.geradas ?? 0),
    comErro: Number(r?.erros ?? 0),
    aplicadas: Number(r?.aplicadas ?? 0),
    semSeo: Number(r?.sem_seo ?? 0),
    entrada: Number(r?.entrada ?? 0),
    saida: Number(r?.saida ?? 0),
  };
}

export interface LinhaSeo {
  product_id: string;
  produto: string;
  foto: string | null;
  seo_titulo: string;
  seo_descricao: string;
  titulo: string | null;
  descricao: string | null;
  aviso: string | null;
  editado: boolean;
  erro: string | null;
  aplicado: boolean;
  /** A sugestão já é igual ao que está na loja. */
  igual: boolean;
}

export async function listarSeo(db: Db, storeId: string): Promise<LinhaSeo[]> {
  return db.query<LinhaSeo>(
    `SELECT p.id::text AS product_id, p.name AS produto,
            (SELECT i->>'src' FROM jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
             WHERE (i->>'src') IS NOT NULL ORDER BY nullif(i->>'position', '')::int NULLS LAST, t.n LIMIT 1) AS foto,
            coalesce(p.raw_json->'seo_title'->>'pt', '') AS seo_titulo, coalesce(p.raw_json->'seo_description'->>'pt', '') AS seo_descricao,
            s.title AS titulo, s.description AS descricao, s.warning AS aviso, coalesce(s.edited, false) AS editado, s.error AS erro,
            (s.applied_at IS NOT NULL) AS aplicado,
            (s.title IS NOT NULL AND s.title = coalesce(p.raw_json->'seo_title'->>'pt', '') AND s.description = coalesce(p.raw_json->'seo_description'->>'pt', '')) AS igual
     FROM products p LEFT JOIN seo_suggestion s ON s.store_id = p.store_id AND s.product_id = p.id
     WHERE p.store_id = $1::uuid
     ORDER BY lower(p.name), p.id`,
    [storeId],
  );
}

/* ---------- aplicar na loja ---------- */

export class SeoInvalidoError extends Error {}

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Grava título e descrição de SEO no produto (só esses dois campos; confere conflito e registra no Histórico, como a edição de produto). */
export async function aplicarSeo(
  db: Db,
  api: ProductApi,
  args: { storeId: string; actor: string; productId: number; titulo: string; descricao: string; editado?: boolean },
): Promise<{ changed: boolean }> {
  const titulo = limpar(args.titulo);
  const descricao = limpar(args.descricao);
  if (!titulo) throw new SeoInvalidoError("O título de SEO não pode ficar vazio.");
  if (!descricao) throw new SeoInvalidoError("A descrição de SEO não pode ficar vazia.");
  if (titulo.length > TITULO_MAX) throw new SeoInvalidoError(`O título de SEO tem ${titulo.length} caracteres; o máximo é ${TITULO_MAX}.`);
  if (descricao.length > DESCRICAO_MAX) throw new SeoInvalidoError(`A descrição de SEO tem ${descricao.length} caracteres; o máximo é ${DESCRICAO_MAX}.`);
  const detail = await getProductDetail(db, args.storeId, args.productId);
  if (!detail) throw new SeoInvalidoError("Produto não encontrado no espelho. Sincronize o catálogo e tente de novo.");

  const r = await updateProduct(db, api, { storeId: args.storeId, actor: args.actor, productId: args.productId, after: { ...toEdit(detail), seo_title: titulo, seo_description: descricao } });
  await db.query(
    `INSERT INTO seo_suggestion (store_id, product_id, title, description, edited, applied_title, applied_description, applied_at)
     VALUES ($1::uuid, $2::bigint, $3, $4, $5, $3, $4, now())
     ON CONFLICT (store_id, product_id) DO UPDATE SET
       title = $3, description = $4, edited = seo_suggestion.edited OR $5, error = NULL, applied_title = $3, applied_description = $4, applied_at = now()`,
    [args.storeId, args.productId, titulo, descricao, args.editado ?? false],
  );
  return { changed: r.changed };
}

export type ModoAplicar = "vazios" | "todos";

const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

/**
 * Envia à loja as sugestões ainda não aplicadas, até estourar o orçamento de tempo. `vazios`: só produtos sem título e sem descrição de SEO
 * hoje; `todos`: também substitui o SEO que já existe. Pula produtos que falharam nesta rodada (`ignorar`).
 */
export async function aplicarSeoPendentes(
  db: Db,
  api: ProductApi,
  args: { storeId: string; actor: string; budgetMs: number; modo: ModoAplicar; ignorar?: string[]; now?: () => number },
): Promise<{ aplicados: number; falhas: Array<{ productId: string; produto: string; mensagem: string }>; restantes: boolean }> {
  const now = args.now ?? Date.now;
  const inicio = now();
  const ignorar = new Set(args.ignorar ?? []);
  const out = { aplicados: 0, falhas: [] as Array<{ productId: string; produto: string; mensagem: string }>, restantes: false };
  while (true) {
    const [prox] = await db.query<{ product_id: string; produto: string; title: string; description: string }>(
      `SELECT p.id::text AS product_id, p.name AS produto, s.title, s.description
       FROM seo_suggestion s JOIN products p ON p.store_id = s.store_id AND p.id = s.product_id
       WHERE s.store_id = $1::uuid AND s.error IS NULL AND s.title IS NOT NULL AND s.description IS NOT NULL AND s.applied_at IS NULL
         AND ($2 = 'todos' OR (coalesce(p.raw_json->'seo_title'->>'pt', '') = '' AND coalesce(p.raw_json->'seo_description'->>'pt', '') = ''))
         AND NOT (s.product_id::text = ANY($3::text[]))
       ORDER BY s.product_id LIMIT 1`,
      [args.storeId, args.modo, [...ignorar]],
    );
    if (!prox) return out;
    if (now() - inicio >= args.budgetMs) return { ...out, restantes: true };
    ignorar.add(prox.product_id);
    try {
      await aplicarSeo(db, api, { storeId: args.storeId, actor: args.actor, productId: Number(prox.product_id), titulo: prox.title, descricao: prox.description });
      out.aplicados++;
    } catch (err) {
      out.falhas.push({ productId: prox.product_id, produto: prox.produto, mensagem: mensagemDe(err) });
      if (out.falhas.length >= 5 && out.aplicados === 0) return out; // algo sistemático: para em vez de tentar o catálogo todo
    }
  }
}

/** Quantos produtos cada modo de aplicação atingiria agora (para o texto do botão e da confirmação). */
export async function contarParaAplicar(db: Db, storeId: string): Promise<{ vazios: number; todos: number }> {
  const [r] = await db.query<{ vazios: string; todos: string }>(
    `SELECT count(*) FILTER (WHERE coalesce(p.raw_json->'seo_title'->>'pt', '') = '' AND coalesce(p.raw_json->'seo_description'->>'pt', '') = '')::text AS vazios,
            count(*)::text AS todos
     FROM seo_suggestion s JOIN products p ON p.store_id = s.store_id AND p.id = s.product_id
     WHERE s.store_id = $1::uuid AND s.error IS NULL AND s.title IS NOT NULL AND s.description IS NOT NULL AND s.applied_at IS NULL`,
    [storeId],
  );
  return { vazios: Number(r?.vazios ?? 0), todos: Number(r?.todos ?? 0) };
}
