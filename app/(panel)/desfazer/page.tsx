import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { acaoLabel } from "@/lib/history/labels";
import { getActiveStore } from "@/lib/stores";
import { listarDesfaziveis } from "@/lib/undo/service";
import { Lista, type ItemVista } from "./lista";

export const dynamic = "force-dynamic";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ROTULO = { "produto.atualizar": "Produto", "variante.atualizar": "Variação", "categoria.atualizar": "Categoria" } as const;

export default async function DesfazerPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const itens = await listarDesfaziveis({ query }, store.id);
  const vistas: ItemVista[] = itens.map((i) => ({ id: i.id, rotulo: ROTULO[i.acao] ?? acaoLabel(i.acao), quando: quando(i.criadoEm), ator: i.ator, nome: i.nome, link: i.link, mudancas: i.mudancas, estado: i.estado }));
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Desfazer alterações</h1>
        <p className="text-sm text-muted">
          As edições dos últimos 30 dias em produtos, variações (preço, promoção, estoque, SKU…) e categorias, com o valor de antes. “Desfazer” devolve esses campos à loja, mas só se o valor ainda estiver como a alteração o deixou (senão passaria por cima de algo mais novo). Cada reversão entra no <Link href="/historico" className="underline">Histórico</Link> como uma edição comum, então também pode ser desfeita. Lotes, promoções, imagens e exclusões têm o seu próprio caminho de reversão (Lotes, Promoções, Imagens) ou não podem ser desfeitos.
        </p>
      </div>
      <Lista itens={vistas} />
    </main>
  );
}
