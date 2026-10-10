import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { ehModeloBloco, MODELOS_BLOCO } from "@/lib/content/modelos";
import { BlocoForm } from "../bloco-form";

export default async function NovoBlocoPage({ searchParams }: { searchParams: Promise<{ modelo?: string }> }) {
  await requireAdmin();
  const { modelo } = await searchParams;
  const m = ehModeloBloco(modelo) ? MODELOS_BLOCO[modelo] : undefined;
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/conteudo" className="text-sm text-muted hover:underline">
          ← Conteúdo
        </Link>
        <h1 className="text-xl font-semibold">Novo bloco</h1>
        {!m && (
          <p className="text-sm text-muted">
            Modelos:{" "}
            {Object.entries(MODELOS_BLOCO).map(([k, x], i) => (
              <span key={k}>
                {i > 0 && " · "}
                <Link className="underline" href={`/conteudo/novo?modelo=${k}`}>
                  {x.rotulo}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <BlocoForm key={modelo ?? "vazio"} inicial={m ? { nome: m.nome, html: m.html } : undefined} />
    </main>
  );
}
