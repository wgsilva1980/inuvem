import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { pt, type I18n, type Product, type Variant, type VariantInput } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { ProductMissingError } from "./images";
import { VariantNotFoundError, assertValidValues } from "./update-variant";
import { valuesToI18n, type VariantEdit } from "./variants";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface ManageApi {
  getProduct(productId: number): Promise<Product>;
  createVariant(productId: number, input: VariantInput): Promise<Variant>;
  deleteVariant(productId: number, variantId: number): Promise<void>;
  updateProduct(productId: number, input: { attributes: I18n[] }): Promise<Product>;
}

export class LastVariantError extends Error {
  constructor() {
    super("Um produto precisa ter ao menos uma variante. Para tirar o produto da loja, desmarque “Publicado”.");
  }
}

export class InvalidAttributesError extends Error {}

export class AttributesConflictError extends Error {
  constructor() {
    super("As propriedades deste produto foram alteradas na Nuvemshop depois que você abriu a página. Os dados foram atualizados: revise e salve de novo.");
  }
}

type Base = { storeId: string; actor: string; productId: number };

async function audit(db: Db, e: Base & { acao: string; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [e.storeId, e.actor, e.acao, String(e.productId), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

const failure = (err: unknown) =>
  err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };

async function assertProduct(db: Db, base: Base): Promise<void> {
  const rows = await db.query("SELECT 1 FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [base.storeId, base.productId]);
  if (rows.length === 0) throw new ProductMissingError();
}

/** Roda a operação na loja, rebusca o produto para regravar o espelho (variantes e propriedades) e registra o resultado. */
async function run(db: Db, api: ManageApi, base: Base, acao: string, antes: unknown, depois: unknown, op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
    await upsertProducts(db, base.storeId, [await api.getProduct(base.productId)]);
    await audit(db, { ...base, acao, antes, depois, resultado: { status: "ok" }, sucesso: true });
  } catch (err) {
    await audit(db, { ...base, acao, antes, depois, resultado: failure(err), sucesso: false });
    throw err;
  }
}

/** Dados de uma variante nova: um valor por propriedade do produto, mais preço e estoque. */
export type NewVariant = Pick<VariantEdit, "sku" | "price" | "promotional_price" | "stock_management" | "stock" | "weight"> & { values: string[] };

/** Cria uma variante. A combinação de valores precisa ser nova e ter um valor para cada propriedade. */
export async function createNewVariant(db: Db, api: ManageApi, args: Base & { variant: NewVariant }): Promise<void> {
  const { variant, ...base } = args;
  await assertProduct(db, base);
  await assertValidValues(db, { storeId: base.storeId, productId: base.productId, values: variant.values });

  const input: VariantInput = {
    values: valuesToI18n(variant.values, []),
    price: variant.price,
    stock_management: variant.stock_management,
    ...(variant.sku !== null ? { sku: variant.sku } : {}),
    ...(variant.promotional_price !== null ? { promotional_price: variant.promotional_price } : {}),
    ...(variant.stock_management && variant.stock !== null ? { stock: variant.stock } : {}),
    ...(variant.weight !== null && variant.weight !== undefined ? { weight: variant.weight } : {}),
  };
  await run(db, api, base, "variante.criar", { total: await variantCount(db, base) }, { values: variant.values, sku: variant.sku, price: variant.price, stock: variant.stock }, () =>
    api.createVariant(base.productId, input),
  );
}

async function variantCount(db: Db, base: Base): Promise<number> {
  const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM variants WHERE store_id = $1::uuid AND product_id = $2::bigint", [base.storeId, base.productId]);
  return rows[0]?.n ?? 0;
}

/** Exclui uma variante na loja (não dá para excluir a única que sobra). */
export async function deleteProductVariant(db: Db, api: ManageApi, args: Base & { variantId: number }): Promise<void> {
  const { variantId, ...base } = args;
  const rows = await db.query<{ id: string; sku: string | null; price: string | null; stock: number | null; values: unknown }>(
    "SELECT id::text AS id, sku, price::text AS price, stock, values FROM variants WHERE store_id = $1::uuid AND product_id = $2::bigint",
    [base.storeId, base.productId],
  );
  const target = rows.find((r) => Number(r.id) === variantId);
  if (!target) throw new VariantNotFoundError();
  if (rows.length <= 1) throw new LastVariantError();

  const values = Array.isArray(target.values) ? (target.values as I18n[]).map((v) => pt(v)) : [];
  await run(db, api, base, "variante.apagar", { id: variantId, values, sku: target.sku, price: target.price, stock: target.stock }, { total: rows.length - 1 }, () =>
    api.deleteVariant(base.productId, variantId),
  );
}

/** Nomes atuais das propriedades (ex.: ["Cor", "Tam"]) e os objetos originais, para preservar outros idiomas. */
export async function getAttributes(db: Db, storeId: string, productId: number): Promise<{ names: string[]; raw: I18n[] } | null> {
  const rows = await db.query<{ attributes: unknown }>(
    "SELECT coalesce(raw_json->'attributes', '[]'::jsonb) AS attributes FROM products WHERE store_id = $1::uuid AND id = $2::bigint",
    [storeId, productId],
  );
  if (!rows[0]) return null;
  const raw = Array.isArray(rows[0].attributes) ? (rows[0].attributes as I18n[]) : [];
  return { names: raw.map((a) => pt(a)), raw };
}

/** Renomeia as propriedades do produto (mesma quantidade e mesma ordem; os valores das variantes não mudam). */
export async function renameAttributes(db: Db, api: ManageApi, args: Base & { names: string[] }): Promise<{ changed: boolean }> {
  const { names: wanted, ...base } = args;
  const current = await getAttributes(db, base.storeId, base.productId);
  if (!current) throw new ProductMissingError();

  const names = wanted.map((n) => n.trim());
  if (current.names.length === 0) throw new InvalidAttributesError("Este produto não tem propriedades para renomear.");
  if (names.length !== current.names.length) throw new InvalidAttributesError("A quantidade de propriedades não pode mudar por aqui.");
  if (names.some((n) => n === "")) throw new InvalidAttributesError("Informe o nome de cada propriedade.");
  if (names.some((n) => n.length > 100)) throw new InvalidAttributesError("O nome da propriedade pode ter no máximo 100 caracteres.");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new InvalidAttributesError("Dê nomes diferentes às propriedades.");
  if (names.every((n, i) => n === current.names[i])) return { changed: false };

  const remote = await api.getProduct(base.productId);
  const remoteNames = (remote.attributes ?? []).map((a) => pt(a));
  if (remoteNames.length !== current.names.length || remoteNames.some((n, i) => n !== current.names[i])) {
    await upsertProducts(db, base.storeId, [remote]);
    throw new AttributesConflictError();
  }

  const attributes = names.map((n, i) => ({ ...(current.raw[i] ?? {}), pt: n }));
  await run(db, api, base, "produto.propriedades", { propriedades: current.names }, { propriedades: names }, () => api.updateProduct(base.productId, { attributes }));
  return { changed: true };
}
