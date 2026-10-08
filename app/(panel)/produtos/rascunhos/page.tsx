import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listarRascunhos } from "@/lib/catalog/drafts";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { DescartarRascunho } from "./descartar-rascunho";

export const dynamic = "force-dynamic";

export default async function RascunhosPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver os rascunhos.</p>
      </Card>
    );
  }
  const rascunhos = await listarRascunhos({ query }, store.id);

  return (
    <main className="flex max-w-3xl flex-col gap-4 pb-20">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/produtos" className="text-sm text-muted hover:underline">
            ← Produtos
          </Link>
          <h1 className="text-xl font-semibold">Rascunhos de produto</h1>
          <p className="text-sm text-muted">Cadastros começados e ainda não criados na loja. Nada aqui aparece na vitrine.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/produtos/lote-ia" className={buttonClass("outline")}>
            Cadastro em lote
          </Link>
          <Link href="/produtos/novo" className={buttonClass("primary")}>
            Novo produto
          </Link>
        </div>
      </div>

      <Card className="p-0 sm:p-0">
        {rascunhos.length === 0 ? (
          <EmptyState title="Nenhum rascunho">
            <p className="text-muted">Em “Novo produto”, use “Salvar como rascunho” para continuar depois.</p>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {rascunhos.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.titulo}</p>
                  <p className="text-xs text-muted">
                    {r.fotos} {r.fotos === 1 ? "foto" : "fotos"} · atualizado em {r.atualizadoEm}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>Rascunho</Badge>
                  <Link href={`/produtos/novo?rascunho=${r.id}`} className={buttonClass("outline")}>
                    Continuar
                  </Link>
                  <DescartarRascunho id={r.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
