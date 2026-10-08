import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { notFound } from "next/navigation";
import { getProductImages } from "@/lib/catalog/images";
import { getProductDetail, listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { fotosComOriginal } from "@/lib/images/reenquadrar";
import { getActiveStore } from "@/lib/stores";
import { Alert } from "@/components/ui/alert";
import { avaliarProntidao } from "@/lib/catalog/readiness";
import { auditarProdutos } from "@/lib/images/audit";
import { ImagesPanel } from "./images-panel";
import { ReadinessCard } from "./readiness-card";
import { ProductForm } from "./product-form";
import { DeleteProduct } from "./delete-product";
import { VariantFields, VariantsManage } from "./variants-editor";

export default async function ProdutoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { criado } = await searchParams;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) notFound();

  const store = await getActiveStore();
  if (!store) notFound();
  const db = { query };
  const [product, categories, images, comOriginal, auditoria] = await Promise.all([
    getProductDetail(db, store.id, productId),
    listCategoryOptions(db, store.id),
    getProductImages(db, store.id, productId),
    fotosComOriginal(db, store.id, productId),
    auditarProdutos(db, store.id, productId),
  ]);
  if (!product) notFound();
  const checklist = avaliarProntidao(product, images.length, auditoria[0] ?? null);

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <Link href={`/historico?produto=${product.id}`} className="text-sm text-muted underline hover:text-foreground">
          Ver histórico deste produto
        </Link>
      </div>

      {criado === "1" && (
        <Alert tone="success">
          Produto criado na Nuvemshop {product.published ? "e publicado" : "como rascunho (não aparece na vitrine)"}.{" "}
          {images.length === 0 ? "Falta adicionar as fotos, na seção “Imagens” mais abaixo." : "Confira o checklist abaixo antes de publicar."}
        </Alert>
      )}

      <ReadinessCard productId={productId} publicado={product.published} checklist={checklist} />

      <ProductForm product={product} categories={categories}>
        <VariantFields productId={productId} variants={product.variants} images={images} attributes={product.attributes} />
      </ProductForm>

      <VariantsManage productId={productId} attributes={product.attributes} />

      <div id="imagens" className="scroll-mt-4">
        <ImagesPanel productId={productId} images={images} comOriginal={comOriginal} />
      </div>

      <DeleteProduct productId={productId} name={product.name} />
    </main>
  );
}
