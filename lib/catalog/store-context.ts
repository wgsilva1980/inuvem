import { padronizarTamanho } from "@/lib/bulk/operations";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import { textoDaDescricao } from "@/lib/seo/text";
import type { Db } from "@/lib/sync/repo";

/** Exemplo de produto da loja, usado só como referência de tom e estrutura dos textos. */
export interface ExemploLoja {
  nome: string;
  descricao: string;
  tags: string;
  seoTitulo: string;
  seoDescricao: string;
}

/**
 * Os produtos mais bem cadastrados da loja (publicados, com fotos, descrição, tags e SEO nos limites): servem de exemplo de como a
 * loja escreve. Os mais completos primeiro; desempate pelos atualizados mais recentemente.
 */
export async function exemplosDeTom(db: Db, storeId: string, limite = 3): Promise<ExemploLoja[]> {
  const rows = await db.query<{ name: string; description: string | null; tags: string | null; seo_title: string; seo_description: string }>(
    `SELECT p.name, p.description, p.tags,
            coalesce(p.raw_json->'seo_title'->>'pt', '') AS seo_title, coalesce(p.raw_json->'seo_description'->>'pt', '') AS seo_description
     FROM products p
     WHERE p.store_id = $1::uuid AND p.published AND p.image_count >= 2
       AND length(btrim(coalesce(p.description, ''))) >= 200
       AND length(coalesce(p.raw_json->'seo_title'->>'pt', '')) BETWEEN 20 AND 70
       AND length(coalesce(p.raw_json->'seo_description'->>'pt', '')) BETWEEN 100 AND 320
     ORDER BY (length(coalesce(p.tags, '')) > 0) DESC, p.image_count DESC, p.updated_at_remote DESC NULLS LAST, p.id DESC
     LIMIT ${Math.max(1, Math.min(limite, 5))}`,
    [storeId],
  );
  return rows.map((r) => ({ nome: r.name, descricao: textoDaDescricao(r.description, 700), tags: r.tags ?? "", seoTitulo: r.seo_title, seoDescricao: r.seo_description }));
}

/** As tags mais usadas na loja (para a IA reaproveitar o vocabulário em vez de inventar variações). */
export async function tagsUsadas(db: Db, storeId: string, limite = 40): Promise<string[]> {
  const rows = await db.query<{ tag: string }>(
    `SELECT lower(btrim(t)) AS tag
     FROM products p, unnest(string_to_array(coalesce(p.tags, ''), ',')) AS t
     WHERE p.store_id = $1::uuid AND btrim(t) <> '' AND length(btrim(t)) <= 40
     GROUP BY lower(btrim(t)) HAVING count(*) >= 2
     ORDER BY count(*) DESC, lower(btrim(t))
     LIMIT ${Math.max(1, Math.min(limite, 100))}`,
    [storeId],
  );
  return rows.map((r) => r.tag);
}

/* ---------- sugestões por categoria ---------- */

export interface SugestoesCategoria {
  /** Produtos publicados das categorias escolhidas (a base das sugestões). */
  produtos: number;
  preco: { mediana: string; minimo: string; maximo: string; produtos: number } | null;
  tamanhos: { lista: string[]; produtos: number; de: number } | null;
  pesoKg: { valor: string; produtos: number } | null;
}

const MIN_PRECO = 3;
const MIN_PESO = 3;
const MIN_TAMANHOS = 2;

/** Mediana e quartis por interpolação linear (lista já ordenada). */
export function percentil(ordenada: number[], p: number): number {
  if (ordenada.length === 0) return NaN;
  const pos = (ordenada.length - 1) * p;
  const i = Math.floor(pos);
  const f = pos - i;
  return ordenada[i]! + (i + 1 < ordenada.length ? (ordenada[i + 1]! - ordenada[i]!) * f : 0);
}

const numerica = (n: number) => n.toFixed(2).replace(".", ",");
const pesoTexto = (n: number) => String(Number(n.toFixed(3))).replace(".", ",");

const ORDEM_TAMANHO = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EXG", "EXGG"];

/** Tamanhos na ordem em que a loja os mostra: PP < P < M < G < GG…, depois números crescentes, depois o resto. */
export function ordenarTamanhos(tamanhos: string[]): string[] {
  const rank = (t: string) => {
    const i = ORDEM_TAMANHO.indexOf(t);
    if (i >= 0) return [0, i, t] as const;
    if (/^\d+$/.test(t)) return [1, Number(t), t] as const;
    return [2, 0, t] as const;
  };
  return [...tamanhos].sort((a, b) => {
    const [ga, na, ta] = rank(a);
    const [gb, nb, tb] = rank(b);
    return ga - gb || na - nb || ta.localeCompare(tb, "pt-BR");
  });
}

const ehTamanho = (nome: string) => /^tam(anhos?|amho)?$/i.test(nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/[\s,;.:]+$/g, ""));

/**
 * O que a loja costuma fazer nas categorias escolhidas: faixa de preço (mediana e quartis do menor preço de cada produto), o conjunto
 * de tamanhos mais usado e o peso típico. Só dados da própria loja (produtos publicados); é referência, nunca preenche sozinho.
 */
export async function sugestoesPorCategoria(db: Db, storeId: string, categoriaIds: number[]): Promise<SugestoesCategoria> {
  const ids = [...new Set(categoriaIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 10);
  const vazio: SugestoesCategoria = { produtos: 0, preco: null, tamanhos: null, pesoKg: null };
  if (ids.length === 0) return vazio;
  const params: unknown[] = [storeId];
  const condicoes = ids.map((id) => {
    params.push(JSON.stringify([{ id }]));
    return `p.categories @> $${params.length}::jsonb`;
  });
  const rows = await db.query<{ id: string; atributos: unknown; price: string | null; weight: string | null; valores: unknown }>(
    `SELECT p.id::text AS id, p.raw_json->'attributes' AS atributos, v.price::text AS price, v.weight::text AS weight, v."values" AS valores
     FROM products p JOIN variants v ON v.store_id = p.store_id AND v.product_id = p.id
     WHERE p.store_id = $1::uuid AND p.published AND (${condicoes.join(" OR ")})
     LIMIT 6000`,
    params,
  );

  type Produto = { menorPreco: number | null; pesos: number[]; tamanhos: Set<string> };
  const produtos = new Map<string, Produto>();
  for (const r of rows) {
    const p = produtos.get(r.id) ?? { menorPreco: null, pesos: [], tamanhos: new Set<string>() };
    produtos.set(r.id, p);
    const preco = r.price === null ? NaN : Number(r.price);
    if (Number.isFinite(preco) && preco > 0) p.menorPreco = p.menorPreco === null ? preco : Math.min(p.menorPreco, preco);
    const peso = r.weight === null ? NaN : Number(r.weight);
    if (Number.isFinite(peso) && peso > 0) p.pesos.push(peso);
    const atributos = Array.isArray(r.atributos) ? (r.atributos as I18n[]).map((a) => pt(a)) : [];
    const idx = atributos.findIndex(ehTamanho);
    const valores = Array.isArray(r.valores) ? (r.valores as I18n[]) : [];
    const tam = idx >= 0 && valores[idx] ? padronizarTamanho(pt(valores[idx])) : "";
    if (tam) p.tamanhos.add(tam);
  }

  const lista = [...produtos.values()];
  const precos = lista.map((p) => p.menorPreco).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const preco =
    precos.length >= MIN_PRECO
      ? { mediana: numerica(percentil(precos, 0.5)), minimo: numerica(percentil(precos, 0.25)), maximo: numerica(percentil(precos, 0.75)), produtos: precos.length }
      : null;

  const pesosPorProduto = lista
    .filter((p) => p.pesos.length > 0)
    .map((p) => percentil([...p.pesos].sort((a, b) => a - b), 0.5))
    .sort((a, b) => a - b);
  const pesoKg = pesosPorProduto.length >= MIN_PESO ? { valor: pesoTexto(percentil(pesosPorProduto, 0.5)), produtos: pesosPorProduto.length } : null;

  const conjuntos = new Map<string, { lista: string[]; n: number }>();
  let comTamanho = 0;
  for (const p of lista) {
    if (p.tamanhos.size === 0) continue;
    comTamanho++;
    const ordenada = ordenarTamanhos([...p.tamanhos]);
    const chave = ordenada.join("|");
    const atual = conjuntos.get(chave);
    if (atual) atual.n++;
    else conjuntos.set(chave, { lista: ordenada, n: 1 });
  }
  const melhor = [...conjuntos.values()].sort((a, b) => b.n - a.n || b.lista.length - a.lista.length)[0];
  const tamanhos = melhor && melhor.n >= MIN_TAMANHOS ? { lista: melhor.lista, produtos: melhor.n, de: comTamanho } : null;

  return { produtos: produtos.size, preco, tamanhos, pesoKg };
}
