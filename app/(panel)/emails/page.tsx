import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { listarSugestoes } from "@/lib/emails/repo";
import { NuvemshopError, listEmailTemplates, type ListaModelos } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { EmailsView } from "./emails-view";

export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para reescrever os e-mails.</p>
      </Card>
    );
  }
  let modelos: ListaModelos | null = null;
  let erroModelos: string | null = null;
  try {
    modelos = await listEmailTemplates(await clientForStore(store));
  } catch (err) {
    erroModelos = err instanceof NuvemshopError ? err.userMessage : "Não foi possível ler os modelos de e-mail da loja.";
  }
  const sugestoes = await listarSugestoes({ query }, store.id);
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">E-mails da loja</h1>
        <p className="text-sm text-muted">
          A IA reescreve os e-mails automáticos (pedido, pagamento, envio, carrinho) no tom da loja, mantendo as variáveis e o HTML. A Nuvemshop não deixa o painel gravar esses modelos: você confere o texto novo e o cola no editor de e-mails da loja.
        </p>
      </div>
      <EmailsView modelos={modelos?.items ?? []} campos={modelos?.campos ?? []} semTexto={modelos?.semTexto ?? 0} erroModelos={erroModelos} sugestoes={sugestoes} />
    </main>
  );
}
