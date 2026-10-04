import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { MAX_PRODUCTS_PER_JOB } from "@/lib/bulk/operations";
import { resolveSelection } from "@/lib/bulk/selection";
import { catalogParamsSchema, filtersQueryString } from "@/lib/catalog/params";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { OperationForm } from "./operation-form";

export default async function NovoLotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const db = { query };
  const selection = await resolveSelection(db, store.id, sp);
  const categories = await listCategoryOptions(db, store.id);
  const selecao = sp.ids ? `ids=${selection.ids.join(",")}` : filtersQueryString(catalogParamsSchema.parse(sp));

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">Operação em massa</h1>
        <p className="text-sm text-muted">
          {selection.ids.length} {selection.ids.length === 1 ? "produto" : "produtos"} ({selection.origem}).
        </p>
      </div>

      {selection.ids.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nenhum produto selecionado. Volte à lista e marque os produtos ou ajuste o filtro.</p>
        </Card>
      ) : selection.truncated ? (
        <Card>
          <p role="alert" className="text-sm text-danger">
            Esta seleção passa de {MAX_PRODUCTS_PER_JOB} produtos. Refine o filtro ou marque menos produtos.
          </p>
        </Card>
      ) : (
        <OperationForm selecao={selecao} total={selection.ids.length} categories={categories} />
      )}
    </main>
  );
}
