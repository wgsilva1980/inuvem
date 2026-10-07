import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ProductList } from "./product-list";
import { buttonClass } from "@/components/ui/button";
import { activeFilters, catalogParamsSchema, filtersQueryString, paramsToFilters } from "@/lib/catalog/params";
import { listCatalog, listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { fieldBase } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver o catálogo.</p>
      </Card>
    );
  }

  const raw = await searchParams;
  const excluido = raw.excluido === "1";
  const sp = catalogParamsSchema.parse(raw);
  const filters = paramsToFilters(sp);
  const db = { query };
  const [result, categories] = await Promise.all([listCatalog(db, store.id, filters), listCategoryOptions(db, store.id)]);

  const chips = activeFilters(sp, (id) => categories.find((c) => c.id === id)?.name);

  const href = (page: number) => {
    const p = new URLSearchParams(filtersQueryString(sp));
    if (sp.ordem && sp.ordem !== "nome") p.set("ordem", sp.ordem);
    if (page > 1) p.set("pagina", String(page));
    const qs = p.toString();
    return qs ? `/produtos?${qs}` : "/produtos";
  };

  const exportParams = new URLSearchParams(filtersQueryString(sp));
  if (sp.ordem && sp.ordem !== "nome") exportParams.set("ordem", sp.ordem);
  const exportHref = `/api/produtos/exportar${exportParams.size ? `?${exportParams}` : ""}`;

  return (
    <main className="flex flex-col gap-4 pb-20">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Produtos</h1>
          <p className="text-sm text-muted">{result.total} {result.total === 1 ? "produto" : "produtos"}</p>
        </div>
        <div className="flex gap-2">
          <a href={exportHref} className={buttonClass("outline")} download>
            Exportar Excel
          </a>
          <Link href="/produtos/novo" className={buttonClass("primary")}>
            Novo produto
          </Link>
        </div>
      </div>
      {excluido && <Alert tone="success">Produto excluído da Nuvemshop.</Alert>}

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Buscar</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Nome ou SKU" className={fieldBase} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Situação</span>
            <select name="status" defaultValue={filters.status} className={fieldBase}>
              <option value="todos">Todos</option>
              <option value="publicados">Publicados</option>
              <option value="rascunhos">Não publicados</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Categoria</span>
            <select name="categoria" defaultValue={sp.categoria ?? ""} className={fieldBase}>
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
            <select name="ordem" defaultValue={filters.sort} className={fieldBase}>
              <option value="nome">Nome</option>
              <option value="atualizados">Atualizados</option>
            </select>
          </label>
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:col-span-6">
            <legend className="mb-1 font-medium">Mostrar só produtos…</legend>
            {(
              [
                ["sem_sku", "com variante sem SKU", filters.semSku],
                ["sem_imagem", "sem imagem", filters.semImagem],
                ["sem_categoria", "sem categoria", filters.semCategoria],
                ["sem_estoque", "com variante sem estoque", filters.semEstoque],
                ["sem_descricao", "sem descrição", filters.semDescricao],
              ] as const
            ).map(([name, text, checked]) => (
              <label key={name} className="flex items-center gap-2">
                <input type="checkbox" name={name} value="1" defaultChecked={checked} />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>
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

      {chips.length > 0 && (
        <ul aria-label="Filtros ativos" className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={c.removeQuery ? `/produtos?${c.removeQuery}` : "/produtos"}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 text-sm hover:bg-border/40"
                aria-label={`Remover filtro: ${c.label}`}
              >
                {c.label}
                <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ProductList items={result.items} total={result.total} filterQuery={filtersQueryString(sp)} />

      <Pagination page={result.page} pages={result.pages} href={href} />
    </main>
  );
}
