import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { FormatTestRunner } from "./runner";

export const maxDuration = 60;

export default async function TesteImagensPage() {
  await requireAdmin();
  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">Teste de formato de imagem</h1>
      </div>
      <Card className="flex flex-col gap-2 text-sm">
        <p>
          Antes de padronizar as fotos, precisamos saber como a Nuvemshop trata cada formato. A documentação diz que, para imagens enviadas em <strong>WebP</strong>, só existe a versão JPEG de 1024 px (as miniaturas menores podem não ser geradas), o que afetaria a vitrine.
        </p>
        <p>
          O teste cria um produto <strong>não publicado</strong> chamado “ZZ teste de imagem (apagar)”, envia a mesma imagem 1200 × 1200 em JPEG e em WebP, confere as versões de 50 a 1024 px e <strong>apaga o produto</strong> no fim. Nada aparece na vitrine.
        </p>
      </Card>
      <FormatTestRunner />
    </main>
  );
}
