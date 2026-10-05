import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { NewProductForm } from "./new-product-form";

export default async function NovoProdutoPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para cadastrar produtos.</p>
      </Card>
    );
  }
  const categories = await listCategoryOptions({ query }, store.id);

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">Novo produto</h1>
        <p className="text-sm text-muted">O produto é criado direto na Nuvemshop. As fotos você adiciona na tela do produto, logo depois de criar.</p>
      </div>
      <NewProductForm categories={categories} />
    </main>
  );
}
