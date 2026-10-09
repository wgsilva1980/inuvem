import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { MAX_PRODUCTS_PER_JOB } from "@/lib/bulk/operations";
import { resolveSelection } from "@/lib/bulk/selection";
import { catalogParamsSchema, filtersQueryString } from "@/lib/catalog/params";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { PromoForm } from "./promo-form";

export default async function NovaPromocaoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
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
  const selection = await resolveSelection({ query }, store.id, sp);
  const selecao = sp.ids ? `ids=${selection.ids.join(",")}` : filtersQueryString(catalogParamsSchema.parse(sp));

  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/promocoes" className="text-sm text-muted hover:underline">
          ← Promoções
        </Link>
        <h1 className="text-xl font-semibold">Nova promoção</h1>
        <p className="text-sm text-muted">
          {selection.ids.length} {selection.ids.length === 1 ? "produto" : "produtos"} ({selection.origem}).
        </p>
      </div>
      <Card>
        {selection.ids.length === 0 ? (
          <p className="text-sm text-muted">Nenhum produto selecionado. Em Produtos, marque os produtos (ou ajuste o filtro) e use “Agendar promoção”.</p>
        ) : selection.truncated ? (
          <p role="alert" className="text-sm text-danger">
            Esta seleção passa de {MAX_PRODUCTS_PER_JOB} produtos. Refine o filtro ou marque menos produtos.
          </p>
        ) : (
          <PromoForm selecao={selecao} total={selection.ids.length} />
        )}
      </Card>
    </main>
  );
}
