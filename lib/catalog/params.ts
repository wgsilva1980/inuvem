import { z } from "zod";
import type { CatalogFilters } from "./query";

/** Parâmetros de URL dos filtros do catálogo (usados pela lista e pela seleção de produtos para lotes). */
export const catalogParamsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["todos", "publicados", "rascunhos"]).optional().catch(undefined),
  categoria: z.coerce.number().int().positive().optional().catch(undefined),
  sem_sku: z.literal("1").optional().catch(undefined),
  ordem: z.enum(["nome", "atualizados"]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).optional().catch(undefined),
});
export type CatalogParams = z.infer<typeof catalogParamsSchema>;

export function paramsToFilters(sp: CatalogParams): CatalogFilters {
  return { q: sp.q, status: sp.status ?? "todos", categoryId: sp.categoria, semSku: sp.sem_sku === "1", sort: sp.ordem ?? "nome", page: sp.pagina };
}

/** Só os filtros (sem página nem ordem) como query string, para ir junto de "selecionar todos os resultados". */
export function filtersQueryString(sp: CatalogParams): string {
  const p = new URLSearchParams();
  if (sp.q) p.set("q", sp.q);
  if (sp.status && sp.status !== "todos") p.set("status", sp.status);
  if (sp.categoria) p.set("categoria", String(sp.categoria));
  if (sp.sem_sku) p.set("sem_sku", "1");
  return p.toString();
}
