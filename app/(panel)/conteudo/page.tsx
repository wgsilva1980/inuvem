import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listarBlocos, usoDosBlocos } from "@/lib/content/blocks";
import { MODELOS_BLOCO } from "@/lib/content/modelos";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { ConteudoTabs } from "./conteudo-tabs";

export const dynamic = "force-dynamic";

export default async function ConteudoPage({ searchParams }: { searchParams: Promise<{ salvo?: string; excluido?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para usar o conteúdo padrão.</p>
      </Card>
    );
  }
  const db = { query };
  const blocos = await listarBlocos(db, store.id);
  const uso = await usoDosBlocos(db, store.id, blocos.map((b) => b.id));

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Conteúdo padrão</h1>
          <p className="text-sm text-muted">Textos que se repetem nas descrições (tabela de medidas, trocas, cuidados) escritos uma vez e aplicados em lote.</p>
        </div>
        <Link href="/conteudo/novo" className={buttonClass("primary")}>
          Novo bloco
        </Link>
      </div>
      <ConteudoTabs atual="/conteudo" />
      {sp.salvo === "1" && <Alert tone="success">Bloco salvo.</Alert>}
      {sp.excluido === "1" && <Alert tone="success">Bloco excluído.</Alert>}

      <Card className="p-0 sm:p-0">
        {blocos.length === 0 ? (
          <EmptyState title="Nenhum bloco ainda">
            <p className="text-muted">
              Comece por um modelo:{" "}
              {Object.entries(MODELOS_BLOCO).map(([k, m], i) => (
                <span key={k}>
                  {i > 0 && " · "}
                  <Link className="underline" href={`/conteudo/novo?modelo=${k}`}>
                    {m.rotulo}
                  </Link>
                </span>
              ))}
              .
            </p>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {blocos.map((b) => (
              <li key={b.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/conteudo/${b.id}`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {uso.get(b.id) ? `Em ${uso.get(b.id)} ${uso.get(b.id) === 1 ? "produto" : "produtos"}` : "Ainda não aplicado em nenhum produto"}
                  </p>
                </div>
                <Link href="/produtos" className="text-sm underline">
                  Escolher produtos e aplicar
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Como aplicar</h2>
        <ol className="list-decimal pl-5 text-sm text-muted">
          <li>Em Produtos, filtre pela categoria (por exemplo Vestidos) e marque os produtos, ou use todos os resultados.</li>
          <li>Abra “Operação em massa” e escolha “Aplicar bloco de conteúdo na descrição”.</li>
          <li>Confira a pré-visualização: o painel mostra quais produtos recebem o bloco e quais já o têm. Só então confirme. O lote pode ser revertido.</li>
        </ol>
      </Card>
    </main>
  );
}
