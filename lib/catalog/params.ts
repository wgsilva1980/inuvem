import { z } from "zod";
import type { CatalogFilters } from "./query";

/** Parâmetros de URL dos filtros do catálogo (usados pela lista e pela seleção de produtos para lotes). */
export const catalogParamsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["todos", "publicados", "rascunhos"]).optional().catch(undefined),
  categoria: z.coerce.number().int().positive().optional().catch(undefined),
  sem_sku: z.literal("1").optional().catch(undefined),
  sem_imagem: z.literal("1").optional().catch(undefined),
  sem_categoria: z.literal("1").optional().catch(undefined),
  sem_estoque: z.literal("1").optional().catch(undefined),
  sem_descricao: z.literal("1").optional().catch(undefined),
  ordem: z.enum(["nome", "atualizados"]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).optional().catch(undefined),
});
export type CatalogParams = z.infer<typeof catalogParamsSchema>;

export function paramsToFilters(sp: CatalogParams): CatalogFilters {
  return { q: sp.q, status: sp.status ?? "todos", categoryId: sp.categoria, semSku: sp.sem_sku === "1", semImagem: sp.sem_imagem === "1", semCategoria: sp.sem_categoria === "1", semEstoque: sp.sem_estoque === "1", semDescricao: sp.sem_descricao === "1", sort: sp.ordem ?? "nome", page: sp.pagina };
}

/** Só os filtros (sem página nem ordem) como query string, para ir junto de "selecionar todos os resultados". */
export function filtersQueryString(sp: CatalogParams): string {
  const p = new URLSearchParams();
  if (sp.q) p.set("q", sp.q);
  if (sp.status && sp.status !== "todos") p.set("status", sp.status);
  if (sp.categoria) p.set("categoria", String(sp.categoria));
  for (const k of ["sem_sku", "sem_imagem", "sem_categoria", "sem_estoque", "sem_descricao"] as const) if (sp[k]) p.set(k, "1");
  return p.toString();
}

export interface ActiveFilter {
  key: string;
  label: string;
  /** Query string dos filtros sem este (a ordem é mantida; a página volta para a primeira). */
  removeQuery: string;
}

const FLAG_LABELS = {
  sem_sku: "Variante sem SKU",
  sem_imagem: "Sem imagem",
  sem_categoria: "Sem categoria",
  sem_estoque: "Variante sem estoque",
  sem_descricao: "Sem descrição",
} as const;

/** Filtros em uso, para mostrar como chips removíveis acima da lista. */
export function activeFilters(sp: CatalogParams, categoryName?: (id: number) => string | undefined): ActiveFilter[] {
  const without = (omit: (keyof CatalogParams)[]) => {
    const p = new URLSearchParams(filtersQueryString({ ...sp, ...Object.fromEntries(omit.map((k) => [k, undefined])) }));
    if (sp.ordem && sp.ordem !== "nome") p.set("ordem", sp.ordem);
    return p.toString();
  };
  const out: ActiveFilter[] = [];
  if (sp.q) out.push({ key: "q", label: `Busca: ${sp.q}`, removeQuery: without(["q"]) });
  if (sp.status && sp.status !== "todos") out.push({ key: "status", label: sp.status === "publicados" ? "Publicados" : "Não publicados", removeQuery: without(["status"]) });
  if (sp.categoria) out.push({ key: "categoria", label: `Categoria: ${categoryName?.(sp.categoria) ?? sp.categoria}`, removeQuery: without(["categoria"]) });
  for (const k of Object.keys(FLAG_LABELS) as (keyof typeof FLAG_LABELS)[]) {
    if (sp[k]) out.push({ key: k, label: FLAG_LABELS[k], removeQuery: without([k]) });
  }
  return out;
}
