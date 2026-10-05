import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Product, ProductInput, VariantInput } from "@/lib/nuvemshop/types";
import { padronizarCor, padronizarTamanho, PROPRIEDADES_PADRAO } from "@/lib/bulk/operations";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { sanitizeDescription } from "./description";
import type { ProductEdit } from "./edit";

/** Máximo de variantes ao cadastrar (cores × tamanhos): mantém a tela e o envio em tamanho razoável. */
export const MAX_VARIANTS = 60;

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface CreateApi {
  create(input: ProductInput): Promise<Product>;
}

export class InvalidNewProductError extends Error {}

/**
 * "preta, azul claro\nPRETA" -> ["Preta", "Azul Claro"]: separa por vírgula, ponto e vírgula ou quebra de linha, padroniza a
 * grafia e tira os repetidos (sem diferenciar caixa), mantendo a ordem em que o usuário digitou.
 */
export function parseList(raw: string, padronizar: (valor: string) => string): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of raw.split(/[,;\n]+/)) {
    const valor = padronizar(parte);
    if (valor === "" || vistos.has(valor.toLowerCase())) continue;
    vistos.add(valor.toLowerCase());
    out.push(valor);
  }
  return out;
}
export const parseCores = (raw: string) => parseList(raw, padronizarCor);
export const parseTamanhos = (raw: string) => parseList(raw, padronizarTamanho);

/** Todas as combinações, uma linha por cor e dentro dela cada tamanho (a ordem em que a grade aparece na tela). */
export function gerarCombinacoes(cores: string[], tamanhos: string[]): Array<{ cor: string; tamanho: string }> {
  return cores.flatMap((cor) => tamanhos.map((tamanho) => ({ cor, tamanho })));
}

/** Dados de uma variante nova, já validados. `values` tem [] (produto simples) ou [cor, tamanho]. */
export interface NewVariantInput {
  values: string[];
  sku: string | null;
  price: string;
  promotional_price: string | null;
  stock_management: boolean;
  stock: number | null;
  weight: string | null;
}

/** Corpo do POST /products. */
export function buildCreateInput(product: ProductEdit, variants: NewVariantInput[]): ProductInput {
  const comPropriedades = variants.some((v) => v.values.length > 0);
  const input: ProductInput = {
    name: { pt: product.name },
    description: { pt: sanitizeDescription(product.description) },
    published: product.published,
    ...(product.tags ? { tags: product.tags } : {}),
    ...(product.categories.length > 0 ? { categories: product.categories } : {}),
    ...(product.seo_title ? { seo_title: { pt: product.seo_title } } : {}),
    ...(product.seo_description ? { seo_description: { pt: product.seo_description } } : {}),
    ...(comPropriedades ? { attributes: PROPRIEDADES_PADRAO.map((nome) => ({ pt: nome })) } : {}),
    variants: variants.map((v): VariantInput => ({
      price: v.price,
      stock_management: v.stock_management,
      ...(v.promotional_price !== null ? { promotional_price: v.promotional_price } : {}),
      ...(v.sku !== null ? { sku: v.sku } : {}),
      ...(v.stock_management && v.stock !== null ? { stock: v.stock } : {}),
      ...(v.weight !== null ? { weight: v.weight } : {}),
      ...(v.values.length > 0 ? { values: v.values.map((valor) => ({ pt: valor })) } : {}),
    })),
  };
  return input;
}

/** Confere as variantes antes de enviar. Devolve a mensagem de erro, ou null se está tudo certo. */
export function validateNewVariants(variants: NewVariantInput[]): string | null {
  if (variants.length === 0) return "Informe ao menos uma cor e um tamanho para criar as variantes.";
  if (variants.length > MAX_VARIANTS) return `São ${variants.length} variantes; o máximo ao cadastrar é ${MAX_VARIANTS}. Reduza as cores ou os tamanhos (você pode criar mais depois, na tela do produto).`;
  const comValores = variants.filter((v) => v.values.length > 0).length;
  if (comValores !== 0 && comValores !== variants.length) return "Todas as variantes precisam ter cor e tamanho.";
  if (comValores === 0 && variants.length !== 1) return "Um produto sem cores e tamanhos tem uma variante só.";
  if (comValores > 0) {
    if (variants.some((v) => v.values.length !== PROPRIEDADES_PADRAO.length || v.values.some((x) => x.trim() === ""))) return "Informe a cor e o tamanho de cada variante.";
    const chaves = variants.map((v) => JSON.stringify(v.values.map((x) => x.toLowerCase())));
    if (new Set(chaves).size !== chaves.length) return "Há duas variantes com a mesma cor e o mesmo tamanho.";
  }
  return null;
}

async function audit(db: Db, e: { storeId: string; actor: string; productId: number | null; depois: unknown; resultado: unknown; sucesso: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, 'produto.criar', 'produto', $3, $4::jsonb, $5::jsonb, $6)`,
    [e.storeId, e.actor, e.productId === null ? null : String(e.productId), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

export interface CreateResult {
  id: number;
  /** O que a loja devolveu diferente do enviado (o produto foi criado mesmo assim). */
  avisos: string[];
}

/** Cria o produto na Nuvemshop, grava o espelho e registra no histórico (também quando a loja recusa). */
export async function createProduct(
  db: Db,
  api: CreateApi,
  args: { storeId: string; actor: string; product: ProductEdit; variants: NewVariantInput[] },
): Promise<CreateResult> {
  const { storeId, actor, product, variants } = args;
  const problema = validateNewVariants(variants);
  if (problema) throw new InvalidNewProductError(problema);

  const input = buildCreateInput(product, variants);
  const depois = { nome: product.name, publicado: product.published, variantes: variants.length, propriedades: input.attributes ? PROPRIEDADES_PADRAO.join(" | ") : null };
  let criado: Product;
  try {
    criado = await api.create(input);
  } catch (err) {
    const resultado = err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await audit(db, { storeId, actor, productId: null, depois, resultado, sucesso: false });
    throw err;
  }

  await upsertProducts(db, storeId, [criado]);
  const avisos: string[] = [];
  if ((criado.variants ?? []).length !== variants.length) avisos.push(`a loja criou ${(criado.variants ?? []).length} variantes em vez de ${variants.length}`);
  if (input.attributes && (criado.attributes ?? []).length !== input.attributes.length) avisos.push("a loja não guardou as propriedades COR e TAMANHO");
  await audit(db, { storeId, actor, productId: criado.id, depois, resultado: { status: "ok", avisos }, sucesso: true });
  return { id: criado.id, avisos };
}
