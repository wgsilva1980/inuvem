import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { visibilidadeDe } from "@/lib/nuvemshop/categories";
import { pt, type Category } from "@/lib/nuvemshop/types";
import { upsertCategories, type Db } from "@/lib/sync/repo";
import { CategoryNotFoundError, CategoryRuleError } from "./manage";

export const ACAO_VISIBILIDADE = "categoria.visibilidade";

export interface EstadoVisibilidade {
  oculta: boolean;
  /** Foi a automação das categorias vazias que a ocultou (ela a mostra de novo sozinha). */
  daAutomacao: boolean;
  /** Você a mostrou à mão: a automação não a oculta. */
  fixa: boolean;
}

/** Visibilidade de cada categoria no espelho, com o papel da automação. */
export async function estadoDeVisibilidade(db: Db, storeId: string): Promise<Map<number, EstadoVisibilidade>> {
  const rows = await db.query<{ id: string; oculta: boolean; automatica: boolean; fixa: boolean }>(
    `SELECT c.id::text AS id, coalesce(c.raw_json->>'visibility', 'visible') = 'hidden' AS oculta,
            EXISTS (SELECT 1 FROM auto_hidden_categories h WHERE h.store_id = c.store_id AND h.category_id = c.id) AS automatica,
            EXISTS (SELECT 1 FROM category_rule_exceptions e WHERE e.store_id = c.store_id AND e.category_id = c.id) AS fixa
     FROM categories c WHERE c.store_id = $1::uuid`,
    [storeId],
  );
  return new Map(rows.map((r) => [Number(r.id), { oculta: r.oculta, daAutomacao: r.automatica && r.oculta, fixa: r.fixa }]));
}

export interface ApiVisibilidade {
  get(id: number): Promise<Category>;
  setVisibility(id: number, visibility: "visible" | "hidden"): Promise<Category>;
}

const failure = (err: unknown) =>
  err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };

/**
 * Oculta ou mostra a categoria na loja, à mão. Ocultar tira a categoria da lista da automação (ela nunca a mostra de volta sozinha). Mostrar a
 * marca como "fixa": a automação não a oculta mais, mesmo vazia, até você devolvê-la à automação. A loja é lida antes e conferida depois.
 */
export async function definirVisibilidade(
  db: Db,
  api: ApiVisibilidade,
  args: { storeId: string; actor: string; id: number; visibility: "visible" | "hidden" },
): Promise<{ changed: boolean }> {
  const { storeId, actor, id, visibility } = args;
  const [existe] = await db.query("SELECT 1 FROM categories WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, id]);
  if (!existe) throw new CategoryNotFoundError();
  const atual = await api.get(id);
  const de = visibilidadeDe(atual);
  const marcas = async () => {
    if (visibility === "hidden") {
      await db.query("DELETE FROM auto_hidden_categories WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
      await db.query("DELETE FROM category_rule_exceptions WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
    } else {
      await db.query("DELETE FROM auto_hidden_categories WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
      await db.query("INSERT INTO category_rule_exceptions (store_id, category_id) VALUES ($1::uuid, $2::bigint) ON CONFLICT DO NOTHING", [storeId, id]);
    }
  };
  if (de === visibility) {
    // a loja já está assim (o espelho estava velho): alinha o espelho e guarda a escolha
    await upsertCategories(db, storeId, [atual]);
    await marcas();
    return { changed: false };
  }
  try {
    const depois = await api.setVisibility(id, visibility);
    if (visibilidadeDe(depois) !== visibility) throw new CategoryRuleError("A loja não aplicou a mudança de visibilidade da categoria.");
    await upsertCategories(db, storeId, [depois]);
    await marcas();
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'categoria', $4, $5::jsonb, $6::jsonb, $7::jsonb, true)`,
      [storeId, actor, ACAO_VISIBILIDADE, String(id), JSON.stringify({ visibility: de }), JSON.stringify({ visibility, nome: pt(depois.name) }), JSON.stringify({ status: "ok" })],
    );
    return { changed: true };
  } catch (err) {
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, $3, 'categoria', $4, $5::jsonb, $6::jsonb, $7::jsonb, false)`,
      [storeId, actor, ACAO_VISIBILIDADE, String(id), JSON.stringify({ visibility: de }), JSON.stringify({ visibility, nome: pt(atual.name) }), JSON.stringify(failure(err))],
    );
    throw err;
  }
}

/** A automação volta a poder ocultar esta categoria quando ficar sem produto publicado. */
export async function devolverAAutomacao(db: Db, storeId: string, id: number): Promise<void> {
  await db.query("DELETE FROM category_rule_exceptions WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
}
