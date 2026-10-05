import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Variant, VariantInput } from "@/lib/nuvemshop/types";
import { mapVariant } from "@/lib/sync/mappers";
import { upsertVariantRows, type Db } from "@/lib/sync/repo";
import { buildVariantInput, changedVariantFields, pickVariant, remoteVariantToEdit, valuesToStrings, variantToEdit, type VariantEdit } from "./variants";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface VariantApi {
  get(productId: number, variantId: number): Promise<Variant>;
  put(productId: number, variantId: number, input: VariantInput): Promise<Variant>;
}

export class VariantNotFoundError extends Error {
  constructor() {
    super("Variante não encontrada no espelho. Sincronize o catálogo e tente de novo.");
  }
}

export class VariantConflictError extends Error {
  constructor() {
    super("Esta variante foi alterada na Nuvemshop depois que você abriu a página. Os dados foram atualizados: revise e salve de novo.");
  }
}

export class InvalidVariantImageError extends Error {
  constructor() {
    super("A imagem escolhida não pertence a este produto.");
  }
}

export class InvalidVariantValuesError extends Error {
  constructor(message = "Informe um valor para cada propriedade do produto.") {
    super(message);
  }
}

export class DuplicateVariantError extends Error {
  constructor() {
    super("Já existe uma variante com essa combinação de valores neste produto.");
  }
}

export type VariantUpdateResult = { changed: false } | { changed: true; fields: string[] };

interface MirrorRow {
  sku: string | null;
  price: string | null;
  promotional_price: string | null;
  stock: number | null;
  stock_management: boolean;
  image_id: string | null;
  weight: string | null;
  values: unknown;
}

async function audit(
  db: Db,
  e: { storeId: string; actor: string; variantId: number; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean },
) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, 'variante.atualizar', 'variante', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
    [e.storeId, e.actor, String(e.variantId), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

/** Quantas propriedades o produto tem (nomes em `attributes`, ex.: Cor e Tam). */
export async function attributeCount(db: Db, storeId: string, productId: number): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT coalesce(jsonb_array_length(raw_json->'attributes'), 0)::int AS n FROM products WHERE store_id = $1::uuid AND id = $2::bigint",
    [storeId, productId],
  );
  return rows[0]?.n ?? 0;
}

/** Confere que há um valor por propriedade e que a combinação não repete a de outra variante do produto. */
export async function assertValidValues(
  db: Db,
  args: { storeId: string; productId: number; values: string[]; exceptVariantId?: number },
): Promise<void> {
  const n = await attributeCount(db, args.storeId, args.productId);
  if (n === 0) throw new InvalidVariantValuesError("Este produto não tem propriedades (como Cor ou Tam); defina as propriedades antes.");
  if (args.values.length !== n || args.values.some((v) => v.trim() === "")) throw new InvalidVariantValuesError();
  const key = (values: string[]) => JSON.stringify(values.map((v) => v.trim().toLowerCase()));
  const others = await db.query<{ id: string; values: unknown }>(
    "SELECT id::text AS id, values FROM variants WHERE store_id = $1::uuid AND product_id = $2::bigint",
    [args.storeId, args.productId],
  );
  const wanted = key(args.values);
  for (const o of others) {
    if (args.exceptVariantId !== undefined && Number(o.id) === args.exceptVariantId) continue;
    if (key(valuesToStrings(o.values)) === wanted) throw new DuplicateVariantError();
  }
}

/** Salva uma variante: confere alteração por fora, envia só o que mudou, atualiza o espelho e registra no histórico. */
export async function updateVariant(
  db: Db,
  api: VariantApi,
  args: { storeId: string; actor: string; productId: number; variantId: number; after: VariantEdit },
): Promise<VariantUpdateResult> {
  const { storeId, actor, productId, variantId, after } = args;
  const rows = await db.query<MirrorRow>(
    `SELECT sku, price::text AS price, promotional_price::text AS promotional_price, stock, stock_management,
            nullif(raw_json->>'image_id', '') AS image_id, weight::text AS weight, values
     FROM variants WHERE store_id = $1::uuid AND product_id = $2::bigint AND id = $3::bigint`,
    [storeId, productId, variantId],
  );
  if (!rows[0]) throw new VariantNotFoundError();

  const before = variantToEdit({ ...rows[0], image_id: rows[0].image_id === null ? null : Number(rows[0].image_id) });
  const fields = changedVariantFields(before, after);
  if (fields.length === 0) return { changed: false };

  if (fields.includes("values") && after.values) {
    await assertValidValues(db, { storeId, productId, values: after.values, exceptVariantId: variantId });
  }

  if (fields.includes("image_id") && after.image_id !== null) {
    const owned = await db.query(
      `SELECT 1 FROM products p, jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) i
       WHERE p.store_id = $1::uuid AND p.id = $2::bigint AND (i->>'id') = $3`,
      [storeId, productId, String(after.image_id)],
    );
    if (owned.length === 0) throw new InvalidVariantImageError();
  }

  const remote = await api.get(productId, variantId);
  if (changedVariantFields(before, remoteVariantToEdit(remote)).length > 0) {
    await upsertVariantRows(db, storeId, [mapVariant(remote, productId)]);
    throw new VariantConflictError();
  }

  const antes = pickVariant(before, fields);
  const depois = pickVariant(after, fields);
  try {
    const updated = await api.put(productId, variantId, buildVariantInput(after, fields, rows[0].values));
    await upsertVariantRows(db, storeId, [mapVariant(updated, productId)]);
    await audit(db, { storeId, actor, variantId, antes, depois, resultado: { status: "ok" }, sucesso: true });
    return { changed: true, fields };
  } catch (err) {
    const resultado =
      err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await audit(db, { storeId, actor, variantId, antes, depois, resultado, sucesso: false });
    throw err;
  }
}
