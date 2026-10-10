import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";
import { avaliarProntidao, type Checklist } from "./readiness";
import type { ProductDetail } from "./query";

/** Peso de cada verificação na nota: os obrigatórios pesam o triplo dos recomendados. */
const PESO_OBRIGATORIO = 3;
const PESO_RECOMENDADO = 1;

export interface Problema {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  detalhe: string;
}

export interface ProdutoQualidade {
  id: string;
  nome: string;
  publicado: boolean;
  /** 0 a 100. */
  nota: number;
  pronto: boolean;
  obrigatoriosFaltando: number;
  problemas: Problema[];
}

export type Faixa = "otimo" | "bom" | "regular" | "fraco";
export const FAIXAS: Array<{ faixa: Faixa; rotulo: string; min: number }> = [
  { faixa: "otimo", rotulo: "Ótimo (90 ou mais)", min: 90 },
  { faixa: "bom", rotulo: "Bom (70 a 89)", min: 70 },
  { faixa: "regular", rotulo: "Regular (50 a 69)", min: 50 },
  { faixa: "fraco", rotulo: "Fraco (abaixo de 50)", min: 0 },
];
export const faixaDaNota = (nota: number): Faixa => FAIXAS.find((f) => nota >= f.min)!.faixa;

/** Nota de 0 a 100: peso das verificações cumpridas sobre o peso das que se aplicam ("info" não conta, pois ainda não dá para saber). */
export function notaDoChecklist(c: Checklist): number {
  let total = 0;
  let ganho = 0;
  for (const i of c.itens) {
    if (i.status === "info") continue;
    const peso = i.obrigatorio ? PESO_OBRIGATORIO : PESO_RECOMENDADO;
    total += peso;
    if (i.status === "ok") ganho += peso;
  }
  return total === 0 ? 100 : Math.round((ganho / total) * 100);
}

/** Todos os produtos do espelho no formato do checklist, em duas consultas (sem uma por produto). */
export async function detalhesDosProdutos(db: Db, storeId: string): Promise<Array<{ produto: ProductDetail; fotos: number }>> {
  const produtos = await db.query<Omit<ProductDetail, "variants" | "attributes"> & { attributes_raw: unknown; image_count: number }>(
    `SELECT id::text AS id, name, description, tags, published, categories, updated_at_remote, image_count,
            coalesce(raw_json->'seo_title'->>'pt', '') AS seo_title,
            coalesce(raw_json->'seo_description'->>'pt', '') AS seo_description,
            coalesce(raw_json->'attributes', '[]'::jsonb) AS attributes_raw
     FROM products WHERE store_id = $1::uuid ORDER BY lower(name), id`,
    [storeId],
  );
  const variantes = await db.query<ProductDetail["variants"][number] & { product_id: string }>(
    `SELECT product_id::text AS product_id, id::text AS id, sku, price::text AS price, promotional_price::text AS promotional_price, weight::text AS weight,
            depth::text AS depth, width::text AS width, height::text AS height,
            raw_json->>'mpn' AS mpn, raw_json->>'age_group' AS age_group, raw_json->>'gender' AS gender,
            stock, stock_management, values, nullif(raw_json->>'image_id', '') AS image_id
     FROM variants WHERE store_id = $1::uuid ORDER BY product_id, position NULLS LAST, id`,
    [storeId],
  );
  const porProduto = new Map<string, ProductDetail["variants"]>();
  for (const { product_id, ...v } of variantes) {
    const l = porProduto.get(product_id) ?? [];
    l.push(v);
    porProduto.set(product_id, l);
  }
  return produtos.map(({ attributes_raw, image_count, ...p }) => ({
    produto: { ...p, attributes: Array.isArray(attributes_raw) ? attributes_raw.map((a) => pt(a as I18n)) : [], variants: porProduto.get(p.id) ?? [] },
    fotos: image_count,
  }));
}

export function qualidadeDoProduto(produto: ProductDetail, fotos: number): ProdutoQualidade {
  const c = avaliarProntidao(produto, fotos, null);
  return {
    id: produto.id,
    nome: produto.name,
    publicado: produto.published,
    nota: notaDoChecklist(c),
    pronto: c.pronto,
    obrigatoriosFaltando: c.obrigatoriosFaltando,
    problemas: c.itens.filter((i) => i.status === "falta" || i.status === "atencao").map((i) => ({ chave: i.chave, rotulo: i.rotulo, obrigatorio: i.obrigatorio, detalhe: i.detalhe })),
  };
}

/* ---------- verificações entre produtos ---------- */

export interface RefProduto {
  id: string;
  nome: string;
}
export interface Duplicado {
  valor: string;
  produtos: RefProduto[];
}
export interface CruzadasDoCatalogo {
  skusRepetidos: Duplicado[];
  nomesRepetidos: Duplicado[];
  promocaoSemDesconto: RefProduto[];
  precosMuitoDiferentes: RefProduto[];
  /** Não publicados que já cumprem todos os obrigatórios: é só publicar. */
  prontosNaoPublicados: RefProduto[];
}

const num = (v: string | null) => (v === null || v === "" ? 0 : Number(v));
const normalizaNome = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function verificacoesCruzadas(itens: Array<{ produto: ProductDetail; q: ProdutoQualidade }>): CruzadasDoCatalogo {
  const ref = (p: ProductDetail): RefProduto => ({ id: p.id, nome: p.name });
  const porSku = new Map<string, { sku: string; produtos: Map<string, RefProduto>; vezes: number }>();
  const porNome = new Map<string, { nome: string; produtos: RefProduto[] }>();
  const promocao: RefProduto[] = [];
  const dispares: RefProduto[] = [];
  const prontos: RefProduto[] = [];
  for (const { produto: p, q } of itens) {
    const n = normalizaNome(p.name);
    if (n) {
      const e = porNome.get(n) ?? { nome: p.name, produtos: [] };
      e.produtos.push(ref(p));
      porNome.set(n, e);
    }
    for (const v of p.variants) {
      const sku = (v.sku ?? "").trim();
      if (sku) {
        const e = porSku.get(sku.toLowerCase()) ?? { sku, produtos: new Map(), vezes: 0 };
        e.produtos.set(p.id, ref(p));
        e.vezes += 1;
        porSku.set(sku.toLowerCase(), e);
      }
    }
    if (p.variants.some((v) => num(v.promotional_price) > 0 && num(v.price) > 0 && num(v.promotional_price) >= num(v.price))) promocao.push(ref(p));
    const precos = p.variants.map((v) => num(v.price)).filter((x) => x > 0);
    if (precos.length > 1 && Math.max(...precos) / Math.min(...precos) > 3) dispares.push(ref(p));
    if (!p.published && q.pronto) prontos.push(ref(p));
  }
  return {
    skusRepetidos: [...porSku.values()].filter((e) => e.vezes > 1).map((e) => ({ valor: e.sku, produtos: [...e.produtos.values()] })).sort((a, b) => a.valor.localeCompare(b.valor, "pt-BR")),
    nomesRepetidos: [...porNome.values()].filter((e) => e.produtos.length > 1).map((e) => ({ valor: e.nome, produtos: e.produtos })).sort((a, b) => a.valor.localeCompare(b.valor, "pt-BR")),
    promocaoSemDesconto: promocao,
    precosMuitoDiferentes: dispares,
    prontosNaoPublicados: prontos,
  };
}

/* ---------- relatório ---------- */

export interface ContagemProblema {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  produtos: number;
}

export interface RelatorioQualidade {
  produtos: ProdutoQualidade[];
  notaMedia: number;
  prontos: number;
  porFaixa: Record<Faixa, number>;
  porProblema: ContagemProblema[];
  cruzadas: CruzadasDoCatalogo;
}

export function montarRelatorio(itens: Array<{ produto: ProductDetail; fotos: number }>): RelatorioQualidade {
  const avaliados = itens.map(({ produto, fotos }) => ({ produto, q: qualidadeDoProduto(produto, fotos) }));
  const produtos = avaliados.map((a) => a.q).sort((a, b) => a.nota - b.nota || a.nome.localeCompare(b.nome, "pt-BR"));
  const porFaixa: Record<Faixa, number> = { otimo: 0, bom: 0, regular: 0, fraco: 0 };
  for (const p of produtos) porFaixa[faixaDaNota(p.nota)] += 1;
  const contagem = new Map<string, ContagemProblema>();
  for (const p of produtos) for (const pr of p.problemas) {
    const c = contagem.get(pr.chave) ?? { chave: pr.chave, rotulo: pr.rotulo, obrigatorio: pr.obrigatorio, produtos: 0 };
    c.produtos += 1;
    contagem.set(pr.chave, c);
  }
  return {
    produtos,
    notaMedia: produtos.length === 0 ? 0 : Math.round(produtos.reduce((s, p) => s + p.nota, 0) / produtos.length),
    prontos: produtos.filter((p) => p.pronto).length,
    porFaixa,
    porProblema: [...contagem.values()].sort((a, b) => Number(b.obrigatorio) - Number(a.obrigatorio) || b.produtos - a.produtos),
    cruzadas: verificacoesCruzadas(avaliados),
  };
}

export const relatorioDeQualidade = async (db: Db, storeId: string): Promise<RelatorioQualidade> => montarRelatorio(await detalhesDosProdutos(db, storeId));
