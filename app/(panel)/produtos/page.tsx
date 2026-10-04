import Link from "next/link";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { listCatalog, listCategoryOptions, type CatalogFilters } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

const paramsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(["todos", "publicados", "rascunhos"]).optional().catch(undefined),
  categoria: z.coerce.number().int().positive().optional().catch(undefined),
  sem_sku: z.literal("1").optional().catch(undefined),
  ordem: z.enum(["nome", "atualizados"]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).optional().catch(undefined),
});

const brl = (value: string | null) =>
  value === null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function priceRange(min: string | null, max: string | null) {
  return min === max ? brl(min) : `${brl(min)} – ${brl(max)}`;
}

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver o catálogo.</p>
      </Card>
    );
  }

  const sp = paramsSchema.parse(await searchParams);
  const filters: CatalogFilters = {
    q: sp.q,
    status: sp.status ?? "todos",
    categoryId: sp.categoria,
    semSku: sp.sem_sku === "1",
    sort: sp.ordem ?? "nome",
    page: sp.pagina,
  };
  const db = { query };
  const [result, categories] = await Promise.all([listCatalog(db, store.id, filters), listCategoryOptions(db, store.id)]);

  const href = (page: number) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.status && sp.status !== "todos") p.set("status", sp.status);
    if (sp.categoria) p.set("categoria", String(sp.categoria));
    if (sp.sem_sku) p.set("sem_sku", "1");
    if (sp.ordem && sp.ordem !== "nome") p.set("ordem", sp.ordem);
    if (page > 1) p.set("pagina", String(page));
    const qs = p.toString();
    return qs ? `/produtos?${qs}` : "/produtos";
  };

  const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary";

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Produtos</h1>
        <p className="text-sm text-muted">{result.total} {result.total === 1 ? "produto" : "produtos"}</p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Buscar</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Nome ou SKU" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Situação</span>
            <select name="status" defaultValue={filters.status} className={field}>
              <option value="todos">Todos</option>
              <option value="publicados">Publicados</option>
              <option value="rascunhos">Não publicados</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Categoria</span>
            <select name="categoria" defaultValue={sp.categoria ?? ""} className={field}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Ordenar por</span>
            <select name="ordem" defaultValue={filters.sort} className={field}>
              <option value="nome">Nome</option>
              <option value="atualizados">Atualizados</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="sem_sku" value="1" defaultChecked={filters.semSku} />
            <span>Com variante sem SKU</span>
          </label>
          <div className="flex gap-2 sm:col-span-6">
            <button type="submit" className={buttonClass("primary")}>
              Filtrar
            </button>
            <Link href="/produtos" className={buttonClass("outline")}>
              Limpar
            </Link>
          </div>
        </form>
      </Card>

      <Card className="p-0 sm:p-0">
        {result.items.length === 0 ? (
          <p className="p-6 text-sm text-muted">Nenhum produto encontrado com esses filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {result.items.map((p) => (
              <li key={p.id}>
                <Link href={`/produtos/${p.id}`} className="flex flex-col gap-1 p-4 hover:bg-border/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted">
                      {p.categories.map((c) => c.name).join(", ") || "Sem categoria"} · {p.variant_count} {p.variant_count === 1 ? "variante" : "variantes"} · {p.image_count} {p.image_count === 1 ? "imagem" : "imagens"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span>{priceRange(p.price_min, p.price_max)}</span>
                    <span className="text-muted">Estoque: {p.stock_total ?? "—"}</span>
                    <span className={p.published ? "text-success" : "text-muted"}>{p.published ? "Publicado" : "Não publicado"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {result.pages > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link href={href(result.page - 1)} className={buttonClass("outline")}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Página {result.page} de {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={href(result.page + 1)} className={buttonClass("outline")}>
              Próxima
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
