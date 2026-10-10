import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { pendentesDeRestauracao } from "@/lib/categories/restore";
import { loadCategories, productCountsByCategory } from "@/lib/categories/manage";
import { descendantIds, flattenTree } from "@/lib/categories/tree";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { RestaurarCategorias } from "./restaurar-categorias";
import { CreateCategoryForm, DeleteCategoryButton, EditCategoryForm, type ParentOption } from "./category-forms";

export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const db = { query };
  const [rows, counts] = await Promise.all([loadCategories(db, store.id), productCountsByCategory(db, store.id)]);
  const pendentes = await pendentesDeRestauracao(db, store.id);
  const flat = flattenTree(rows);
  const label = (r: { name: string; depth: number }) => `${"— ".repeat(r.depth)}${r.name}`;
  const allOptions: ParentOption[] = flat.map((r) => ({ id: r.id, label: label(r) }));

  return (
    <main className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Categorias</h1>
        <p className="text-sm text-muted">{rows.length} {rows.length === 1 ? "categoria" : "categorias"}</p>
      </div>

      {pendentes.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Restaurar categorias</h2>
          <p className="text-sm text-muted">
            Há {pendentes.length} categoria(s) com os dados originais guardados (nome, endereço, descrição e categoria pai). Restaurar devolve esses dados à loja e mantém o SEO que está lá agora.
          </p>
          <RestaurarCategorias quantas={pendentes.length} />
        </Card>
      )}

      <Card>
        <h2 className="text-base font-semibold">Nova categoria</h2>
        <div className="mt-3">
          <CreateCategoryForm options={allOptions} />
        </div>
      </Card>

      <Card className="p-0 sm:p-0">
        {flat.length === 0 ? (
          <p className="p-6 text-sm text-muted">Nenhuma categoria sincronizada.</p>
        ) : (
          <ul className="divide-y divide-border">
            {flat.map((c) => {
              const blocked = descendantIds(rows, c.id);
              blocked.add(c.id);
              const options = allOptions.filter((o) => !blocked.has(o.id)); // não pode ficar dentro de si mesma nem das filhas
              const n = counts.get(c.id) ?? 0;
              const hasChildren = rows.some((r) => r.parent_id === c.id);
              return (
                <li key={c.id} className="p-4" style={{ paddingLeft: `${1 + c.depth * 1.5}rem` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      <Link href={`/produtos?categoria=${c.id}`} className="ml-3 text-sm text-muted underline hover:text-foreground">
                        {n} {n === 1 ? "produto" : "produtos"}
                      </Link>
                    </div>
                    <DeleteCategoryButton id={c.id} name={c.name} products={n} hasChildren={hasChildren} />
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Editar nome ou mover</summary>
                    <EditCategoryForm id={c.id} name={c.name} parent={c.parent_id} options={options} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </main>
  );
}
