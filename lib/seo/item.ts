import { MODELO_REVISAO, RevisaoConfigError } from "@/lib/images/review";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { CategoryInput } from "@/lib/nuvemshop/categories";
import type { PageInput, StorePage } from "@/lib/nuvemshop/pages";
import { pt, type Category } from "@/lib/nuvemshop/types";
import { upsertCategories, type Db } from "@/lib/sync/repo";
import type { SugestaoSeo } from "./generate";
import type { GeradorItem, ItemParaSeo, TipoItem } from "./item-generate";
import { DESCRICAO_MAX, TITULO_MAX, textoDaDescricao } from "./text";

export type { TipoItem, ItemParaSeo } from "./item-generate";

/** Rótulo para mensagens. */
export const TIPO_LABEL: Record<TipoItem, string> = { categoria: "a categoria", pagina: "a página" };

/* ---------- fontes ---------- */

/** Categorias do espelho, com o contexto para o Claude (quantos produtos há e exemplos de nomes). */
export async function itensDeCategorias(db: Db, storeId: string, ids?: string[]): Promise<ItemParaSeo[]> {
  const rows = await db.query<{ id: string; nome: string; pai: string | null; descricao: string; seo_titulo: string; seo_descricao: string; n: string; exemplos: string[] | null }>(
    `SELECT c.id::text AS id, c.name AS nome, par.name AS pai, coalesce(c.raw_json->'description'->>'pt', '') AS descricao,
            coalesce(c.raw_json->'seo_title'->>'pt', '') AS seo_titulo, coalesce(c.raw_json->'seo_description'->>'pt', '') AS seo_descricao,
            (SELECT count(*) FROM products pr WHERE pr.store_id = c.store_id AND pr.categories @> jsonb_build_array(jsonb_build_object('id', c.id)))::text AS n,
            (SELECT array_agg(x.name) FROM (SELECT pr.name FROM products pr WHERE pr.store_id = c.store_id AND pr.published
               AND pr.categories @> jsonb_build_array(jsonb_build_object('id', c.id)) ORDER BY pr.id DESC LIMIT 15) x) AS exemplos
     FROM categories c LEFT JOIN categories par ON par.store_id = c.store_id AND par.id = c.parent_id
     WHERE c.store_id = $1::uuid AND ($2::text[] IS NULL OR c.id::text = ANY($2::text[]))
     ORDER BY lower(c.name), c.id`,
    [storeId, ids ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    seoTituloAtual: r.seo_titulo,
    seoDescricaoAtual: r.seo_descricao,
    linhas: [
      r.pai ? `Dentro da categoria: ${r.pai}` : null,
      textoDaDescricao(r.descricao, 600) ? `Descrição atual da categoria: ${textoDaDescricao(r.descricao, 600)}` : null,
      `Produtos na categoria: ${r.n}`,
      r.exemplos?.length ? `Exemplos de produtos publicados: ${r.exemplos.join("; ")}` : null,
    ].filter((x): x is string => x !== null),
  }));
}

/** Páginas da loja (lidas da API) no formato do SEO. */
export function itensDePaginas(paginas: StorePage[], ids?: string[]): ItemParaSeo[] {
  return paginas
    .filter((p) => !ids || ids.includes(String(p.id)))
    .map((p) => ({
      id: String(p.id),
      nome: pt(p.title) || `Página ${p.id}`,
      seoTituloAtual: pt(p.seo_title),
      seoDescricaoAtual: pt(p.seo_description),
      linhas: [textoDaDescricao(pt(p.content), 1500) ? `Conteúdo da página: ${textoDaDescricao(pt(p.content), 1500)}` : "Conteúdo da página: (vazio)"],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ---------- sugestões guardadas ---------- */

export interface SugestaoGuardada {
  titulo: string | null;
  descricao: string | null;
  aviso: string | null;
  editado: boolean;
  erro: string | null;
  aplicado: boolean;
}

export async function sugestoesDe(db: Db, storeId: string, tipo: TipoItem): Promise<Map<string, SugestaoGuardada>> {
  const rows = await db.query<{ id: string } & SugestaoGuardada>(
    `SELECT item_id::text AS id, title AS titulo, description AS descricao, warning AS aviso, edited AS editado, error AS erro, (applied_at IS NOT NULL) AS aplicado
     FROM seo_item_suggestion WHERE store_id = $1::uuid AND kind = $2`,
    [storeId, tipo],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function gravar(db: Db, storeId: string, tipo: TipoItem, id: string, r: { sugestao?: SugestaoSeo; erro?: string }): Promise<void> {
  const s = r.sugestao;
  await db.query(
    `INSERT INTO seo_item_suggestion (store_id, kind, item_id, title, description, edited, model, warning, error, input_tokens, output_tokens, generated_at)
     VALUES ($1::uuid, $2, $3::bigint, $4, $5, false, $6, $7, $8, $9, $10, now())
     ON CONFLICT (store_id, kind, item_id) DO UPDATE SET
       title = $4, description = $5, edited = false, model = $6, warning = $7, error = $8, input_tokens = $9, output_tokens = $10,
       generated_at = now(), applied_title = NULL, applied_description = NULL, applied_at = NULL`,
    [storeId, tipo, id, s?.titulo ?? null, s?.descricao ?? null, MODELO_REVISAO, s?.avisos.join("; ") || null, r.erro ?? null, s?.entrada ?? null, s?.saida ?? null],
  );
}

/** Gera (ou gera de novo) o SEO dos itens recebidos, `concorrencia` por vez. Um erro de configuração (chave da API) interrompe e é relançado. */
export async function gerarSeoItens(
  db: Db,
  args: { storeId: string; tipo: TipoItem; itens: ItemParaSeo[]; gerador: GeradorItem; concorrencia?: number },
): Promise<{ geradas: number; erros: number }> {
  let geradas = 0;
  let erros = 0;
  let proximo = 0;
  let config: RevisaoConfigError | null = null;
  await Promise.all(
    Array.from({ length: Math.min(args.concorrencia ?? 3, args.itens.length) }, async () => {
      while (proximo < args.itens.length && !config) {
        const item = args.itens[proximo++]!;
        try {
          await gravar(db, args.storeId, args.tipo, item.id, { sugestao: await args.gerador(args.tipo, item) });
          geradas++;
        } catch (err) {
          if (err instanceof RevisaoConfigError) {
            config = err;
            return;
          }
          await gravar(db, args.storeId, args.tipo, item.id, { erro: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
          erros++;
        }
      }
    }),
  );
  if (config) throw config;
  return { geradas, erros };
}

/* ---------- gravar na loja ---------- */

export class SeoItemError extends Error {}

export interface ItemApis {
  categoria: { get(id: number): Promise<Category>; update(id: number, input: CategoryInput): Promise<Category> };
  pagina: { get(id: number): Promise<StorePage>; update(id: number, input: PageInput): Promise<StorePage> };
}

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();
const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

async function auditar(db: Db, e: { storeId: string; actor: string; tipo: TipoItem; id: number; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
    [e.storeId, e.actor, `${e.tipo}.seo`, e.tipo, String(e.id), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

/** Grava título e descrição de SEO na categoria ou página (só esses dois campos). Categoria: confere se mudou na loja desde a última sincronização. */
export async function aplicarSeoItem(
  db: Db,
  apis: ItemApis,
  args: { storeId: string; actor: string; tipo: TipoItem; id: number; titulo: string; descricao: string; editado?: boolean },
): Promise<{ changed: boolean }> {
  const titulo = limpar(args.titulo);
  const descricao = limpar(args.descricao);
  if (!titulo) throw new SeoItemError("O título de SEO não pode ficar vazio.");
  if (!descricao) throw new SeoItemError("A descrição de SEO não pode ficar vazia.");
  if (titulo.length > TITULO_MAX) throw new SeoItemError(`O título de SEO tem ${titulo.length} caracteres; o máximo é ${TITULO_MAX}.`);
  if (descricao.length > DESCRICAO_MAX) throw new SeoItemError(`A descrição de SEO tem ${descricao.length} caracteres; o máximo é ${DESCRICAO_MAX}.`);

  let antes: { seo_title: string; seo_description: string };
  const depois = { seo_title: titulo, seo_description: descricao };
  let changed = true;
  try {
    if (args.tipo === "categoria") {
      const [espelho] = await db.query<{ nome: string; seo_titulo: string; seo_descricao: string }>(
        `SELECT name AS nome, coalesce(raw_json->'seo_title'->>'pt', '') AS seo_titulo, coalesce(raw_json->'seo_description'->>'pt', '') AS seo_descricao
         FROM categories WHERE store_id = $1::uuid AND id = $2::bigint`,
        [args.storeId, args.id],
      );
      if (!espelho) throw new SeoItemError("Categoria não encontrada no espelho. Sincronize o catálogo e tente de novo.");
      const remota = await apis.categoria.get(args.id);
      if (pt(remota.name) !== espelho.nome || pt(remota.seo_title as never) !== espelho.seo_titulo || pt(remota.seo_description as never) !== espelho.seo_descricao) {
        await upsertCategories(db, args.storeId, [remota]);
        throw new SeoItemError("Esta categoria foi alterada na Nuvemshop depois da última sincronização. Os dados foram atualizados: revise e tente de novo.");
      }
      antes = { seo_title: espelho.seo_titulo, seo_description: espelho.seo_descricao };
      changed = antes.seo_title !== titulo || antes.seo_description !== descricao;
      if (changed) {
        const atualizada = await apis.categoria.update(args.id, { seo_title: { pt: titulo }, seo_description: { pt: descricao } });
        await upsertCategories(db, args.storeId, [atualizada]);
      }
    } else {
      const remota = await apis.pagina.get(args.id);
      antes = { seo_title: pt(remota.seo_title), seo_description: pt(remota.seo_description) };
      changed = antes.seo_title !== titulo || antes.seo_description !== descricao;
      if (changed) await apis.pagina.update(args.id, { seo_title: { pt: titulo }, seo_description: { pt: descricao } });
    }
  } catch (err) {
    if (!(err instanceof SeoItemError)) {
      await auditar(db, { storeId: args.storeId, actor: args.actor, tipo: args.tipo, id: args.id, antes: null, depois, resultado: { erro: mensagemDe(err) }, sucesso: false });
    }
    throw err;
  }
  if (changed) await auditar(db, { storeId: args.storeId, actor: args.actor, tipo: args.tipo, id: args.id, antes, depois, resultado: { status: "ok" }, sucesso: true });
  await db.query(
    `INSERT INTO seo_item_suggestion (store_id, kind, item_id, title, description, edited, applied_title, applied_description, applied_at)
     VALUES ($1::uuid, $2, $3::bigint, $4, $5, $6, $4, $5, now())
     ON CONFLICT (store_id, kind, item_id) DO UPDATE SET
       title = $4, description = $5, edited = seo_item_suggestion.edited OR $6, error = NULL, applied_title = $4, applied_description = $5, applied_at = now()`,
    [args.storeId, args.tipo, args.id, titulo, descricao, args.editado ?? false],
  );
  return { changed };
}

export type ModoAplicarItens = "vazios" | "todos";

export interface ResultadoAplicar {
  id: string;
  ok: boolean;
  pulado?: boolean;
  erro?: string;
}

/** Grava as sugestões guardadas dos `ids` (uma por vez). `vazios` pula quem já tem título ou descrição de SEO na loja. */
export async function aplicarSugestoes(
  db: Db,
  apis: ItemApis,
  args: { storeId: string; actor: string; tipo: TipoItem; ids: string[]; modo: ModoAplicarItens; atuais: Map<string, { titulo: string; descricao: string }> },
): Promise<ResultadoAplicar[]> {
  const guardadas = await sugestoesDe(db, args.storeId, args.tipo);
  const out: ResultadoAplicar[] = [];
  for (const id of args.ids) {
    const s = guardadas.get(id);
    if (!s || s.erro || !s.titulo || !s.descricao) {
      out.push({ id, ok: false, pulado: true, erro: "Sem sugestão gerada." });
      continue;
    }
    const atual = args.atuais.get(id);
    if (args.modo === "vazios" && atual && (atual.titulo !== "" || atual.descricao !== "")) {
      out.push({ id, ok: true, pulado: true });
      continue;
    }
    try {
      await aplicarSeoItem(db, apis, { storeId: args.storeId, actor: args.actor, tipo: args.tipo, id: Number(id), titulo: s.titulo, descricao: s.descricao });
      out.push({ id, ok: true });
    } catch (err) {
      out.push({ id, ok: false, erro: mensagemDe(err) });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break; // sem permissão: não adianta insistir
    }
  }
  return out;
}
