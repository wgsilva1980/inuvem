import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getProductDetail, listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { ProductForm } from "./product-form";

const brl = (value: string | null) =>
  value === null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) notFound();

  const store = await getActiveStore();
  if (!store) notFound();
  const db = { query };
  const [product, categories] = await Promise.all([getProductDetail(db, store.id, productId), listCategoryOptions(db, store.id)]);
  if (!product) notFound();

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">{product.name}</h1>
      </div>

      <ProductForm product={product} categories={categories} />

      <Card>
        <h2 className="text-base font-semibold">Variantes</h2>
        <p className="mt-1 text-sm text-muted">Somente leitura por enquanto. A edição de preço, estoque e SKU chega na Fase 3.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Variação</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Preço</th>
                <th className="py-2 pr-4 font-medium">Promocional</th>
                <th className="py-2 font-medium">Estoque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 pr-4">{v.values.map((x) => Object.values(x)[0]).filter(Boolean).join(" / ") || "Padrão"}</td>
                  <td className="py-2 pr-4">{v.sku || "—"}</td>
                  <td className="py-2 pr-4">{brl(v.price)}</td>
                  <td className="py-2 pr-4">{brl(v.promotional_price)}</td>
                  <td className="py-2">{v.stock_management ? (v.stock ?? 0) : "Sem controle"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
