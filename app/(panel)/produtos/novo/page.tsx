import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { Alert } from "@/components/ui/alert";
import { contarRascunhos, obterRascunho } from "@/lib/catalog/drafts";
import { NovoProduto } from "./novo-produto";

export default async function NovoProdutoPage({ searchParams }: { searchParams: Promise<{ rascunho?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para cadastrar produtos.</p>
      </Card>
    );
  }
  const { rascunho: rascunhoParam } = await searchParams;
  const pedido = Number(rascunhoParam);
  const [categories, rascunho, abertos] = await Promise.all([
    listCategoryOptions({ query }, store.id),
    Number.isInteger(pedido) && pedido > 0 ? obterRascunho({ query }, store.id, pedido) : Promise.resolve(null),
    contarRascunhos({ query }, store.id),
  ]);
  const aberto = rascunho && rascunho.status === "rascunho" ? rascunho : null;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">Novo produto</h1>
        <p className="text-sm text-muted">
          <Link href="/produtos/rascunhos" className="underline">
            Rascunhos salvos{abertos > 0 ? ` (${abertos})` : ""}
          </Link>
        </p>
        <p className="text-sm text-muted">O produto é criado direto na Nuvemshop, sempre como rascunho até você marcar “Publicar”. Comece pelas fotos para a IA preencher o cadastro, ou preencha tudo à mão.</p>
      </div>
      {rascunhoParam && !aberto && <Alert tone="danger">Esse rascunho não existe mais (foi descartado ou já virou produto). O cadastro abaixo começa em branco.</Alert>}
      {/* a chave refaz a tela inteira ao abrir outro rascunho */}
      <NovoProduto key={aberto?.id ?? "novo"} categories={categories} rascunho={aberto} />
    </main>
  );
}
