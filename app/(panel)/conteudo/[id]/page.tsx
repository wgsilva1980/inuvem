import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { obterBloco } from "@/lib/content/blocks";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { BlocoForm } from "../bloco-form";

export const dynamic = "force-dynamic";

export default async function BlocoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const store = await getActiveStore();
  if (!store) notFound();
  const bloco = await obterBloco({ query }, store.id, id);
  if (!bloco) notFound();
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/conteudo" className="text-sm text-muted hover:underline">
          ← Conteúdo
        </Link>
        <h1 className="text-xl font-semibold">{bloco.name}</h1>
      </div>
      <BlocoForm key={bloco.updated_at} bloco={bloco} />
    </main>
  );
}
