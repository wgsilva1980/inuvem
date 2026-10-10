import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { getActiveStore } from "@/lib/stores";
import { ConteudoTabs } from "../conteudo-tabs";
import { PaginaIa } from "./pagina-ia";

export const dynamic = "force-dynamic";

export default async function PaginasIaPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para criar páginas.</p>
      </Card>
    );
  }
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Páginas da loja com a IA</h1>
        <p className="text-sm text-muted">Você diz os fatos; a IA escreve o rascunho e você cola no admin da Nuvemshop (a API não deixa o painel criar páginas). O que faltar vira “[preencher: …]”: ela não inventa prazo, valor nem política.</p>
      </div>
      <ConteudoTabs atual="/conteudo/paginas" />
      <PaginaIa />
    </main>
  );
}
