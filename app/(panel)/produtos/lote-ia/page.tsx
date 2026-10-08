import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { getActiveStore } from "@/lib/stores";
import { LoteIa } from "./lote-ia";

export const dynamic = "force-dynamic";

export default async function CadastroEmLotePage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para cadastrar produtos.</p>
      </Card>
    );
  }
  const semBlob = !process.env.BLOB_READ_WRITE_TOKEN;
  const semIa = !process.env.ANTHROPIC_API_KEY;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <Link href="/produtos" className="text-sm text-muted hover:underline">
          ← Produtos
        </Link>
        <h1 className="text-xl font-semibold">Cadastro em lote</h1>
        <p className="text-sm text-muted">
          Suba as fotos de várias peças de uma vez. A IA separa por peça e prepara um <strong>rascunho</strong> de cada uma (nome, descrição, categoria, SEO…); você revisa e cria cada produto depois, em{" "}
          <Link href="/produtos/rascunhos" className="underline">
            Rascunhos
          </Link>
          . Nada vai para a loja agora.
        </p>
      </div>
      {semBlob && <Alert tone="danger">O armazenamento das fotos (Blob) não está configurado: sem ele os rascunhos não guardam as fotos.</Alert>}
      {semIa && <Alert tone="danger">Falta a chave da API da Anthropic (ANTHROPIC_API_KEY na Vercel): sem ela a IA não agrupa nem analisa as fotos.</Alert>}
      <LoteIa />
    </main>
  );
}
