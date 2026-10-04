import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { notFound } from "next/navigation";
import { getProductImages } from "@/lib/catalog/images";
import { getProductDetail, listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { ImagesPanel } from "./images-panel";
import { ProductForm } from "./product-form";
import { VariantsEditor } from "./variants-editor";

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) notFound();

  const store = await getActiveStore();
  if (!store) notFound();
  const db = { query };
  const [product, categories, images] = await Promise.all([
    getProductDetail(db, store.id, productId),
    listCategoryOptions(db, store.id),
    getProductImages(db, store.id, productId),
  ]);
  if (!product) notFound();

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <Link href={`/historico?produto=${product.id}`} className="text-sm text-muted underline hover:text-foreground">
          Ver histórico deste produto
        </Link>
      </div>

      <ProductForm product={product} categories={categories} />

      <VariantsEditor productId={productId} variants={product.variants} images={images} />

      <ImagesPanel productId={productId} images={images} />
    </main>
  );
}
