import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { CategoryInput } from "@/lib/nuvemshop/categories";
import type { Category } from "@/lib/nuvemshop/types";
import { upsertCategories, type Db } from "@/lib/sync/repo";

export interface RestauraApi {
  update(id: number, input: CategoryInput): Promise<Category>;
}

export interface Pendente {
  category_id: string;
  name: string;
  handle: string | null;
  parent_id: string | null;
}

export async function pendentesDeRestauracao(db: Db, storeId: string): Promise<Pendente[]> {
  return db.query<Pendente>(
    "SELECT category_id::text, name, handle, parent_id::text FROM category_restore WHERE store_id = $1::uuid AND restored_at IS NULL ORDER BY category_id",
    [storeId],
  );
}

export interface ResultadoRestauracao {
  restauradas: number;
  falhas: Array<{ id: string; nome: string; mensagem: string }>;
}

/**
 * Devolve à loja o nome, o endereço, a descrição e a categoria pai guardados em `category_restore`. O SEO atual da loja é mantido (a atualização lê a
 * categoria e só troca o que está aqui). Registra cada uma no Histórico e marca como restaurada.
 */
export async function restaurarCategorias(db: Db, api: RestauraApi, args: { storeId: string; actor: string }): Promise<ResultadoRestauracao> {
  const rows = await db.query<{ category_id: string; name: string; handle: string | null; description: string | null; parent_id: string | null }>(
    "SELECT category_id::text, name, handle, description, parent_id::text FROM category_restore WHERE store_id = $1::uuid AND restored_at IS NULL ORDER BY category_id",
    [args.storeId],
  );
  const out: ResultadoRestauracao = { restauradas: 0, falhas: [] };
  for (const r of rows) {
    const mudancas: CategoryInput = {
      name: { pt: r.name },
      ...(r.handle ? { handle: { pt: r.handle } } : {}),
      description: { pt: r.description ?? "" },
      parent: r.parent_id && Number(r.parent_id) > 0 ? Number(r.parent_id) : null,
    };
    try {
      const atualizada = await api.update(Number(r.category_id), mudancas);
      await upsertCategories(db, args.storeId, [atualizada]);
      await db.query("UPDATE category_restore SET restored_at = now() WHERE store_id = $1::uuid AND category_id = $2::bigint", [args.storeId, r.category_id]);
      await db.query(
        `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'categoria.restaurar', 'categoria', $3, $4::jsonb, true)`,
        [args.storeId, args.actor, r.category_id, JSON.stringify({ nome: r.name, handle: r.handle, pai: r.parent_id })],
      );
      out.restauradas++;
    } catch (err) {
      out.falhas.push({ id: r.category_id, nome: r.name, mensagem: err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err) });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break;
    }
  }
  return out;
}
