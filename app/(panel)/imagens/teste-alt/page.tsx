import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { AltTestRunner } from "./runner";

export const maxDuration = 60;

export default async function TesteAltPage() {
  await requireAdmin();
  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/imagens/revisao" className="text-sm text-muted hover:underline">
          ← Revisão das fotos
        </Link>
        <h1 className="text-xl font-semibold">Teste do texto alternativo na Nuvemshop</h1>
      </div>
      <Card className="flex flex-col gap-2 text-sm">
        <p>
          O envio do texto alternativo pelo PUT da foto é aceito mas a loja guarda o campo vazio. Este teste cria um produto <strong>não publicado</strong> chamado “ZZ teste de alt (apagar)”, tenta gravar o texto por outras rotas (enviar a foto já com o texto, trocar a origem junto com o texto e mandar as fotos dentro do PUT do produto), confere o que a loja guardou e <strong>apaga o produto</strong> no fim. Nada aparece na vitrine.
        </p>
      </Card>
      <AltTestRunner />
    </main>
  );
}
