import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { filaDeExpedicao, listaDeSeparacao } from "@/lib/shipping/queue";
import { getActiveStore } from "@/lib/stores";
import { ImprimirBotao } from "./imprimir-botao";

export const dynamic = "force-dynamic";

const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Lista de separação para imprimir: as peças dos pedidos a enviar somadas (com foto) e, abaixo, o que leva cada pedido. */
export default async function SeparacaoPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) return null;
  const sp = await searchParams;
  const ids = sp.ids ? sp.ids.split(",").filter((s) => /^\d{1,15}$/.test(s)).slice(0, 300) : undefined;
  const pedidos = await filaDeExpedicao({ query }, store.id, 2, ids);
  const linhas = listaDeSeparacao(pedidos);
  const unidades = pedidos.reduce((s, p) => s + p.unidades, 0);

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20 print:max-w-none print:gap-3 print:pb-0">
      <div className="flex flex-col gap-1 print:hidden">
        <Link href="/expedicao" className="text-sm text-muted hover:underline">
          ← Expedição
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Lista de separação</h1>
          <ImprimirBotao />
        </div>
      </div>
      <h1 className="hidden text-lg font-semibold print:block">Lista de separação — {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</h1>
      <p className="text-sm text-muted">
        {pedidos.length} {pedidos.length === 1 ? "pedido" : "pedidos"} · {unidades} {unidades === 1 ? "peça" : "peças"}
        {ids ? " (os que você marcou)" : " (todos a enviar)"}
      </p>

      {pedidos.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nenhum pedido a enviar.</p>
        </Card>
      ) : (
        <>
          <section aria-label="Peças a separar">
            <h2 className="mb-2 font-medium">Peças a separar</h2>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {linhas.map((l) => (
                <li key={l.chave} className="flex items-center gap-3 p-2 [break-inside:avoid]">
                  <span className="h-5 w-5 shrink-0 rounded border border-border-strong" aria-hidden />
                  {l.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.foto} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded border border-border object-cover" />
                  ) : (
                    <span className="h-14 w-14 shrink-0 rounded border border-border" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.nome}</p>
                    <p className="text-sm text-muted">
                      {[l.variacao, l.sku ? `SKU ${l.sku}` : null].filter(Boolean).join(" · ") || "—"} · pedidos {l.pedidos.map((n) => `#${n ?? "?"}`).join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xl font-semibold">{l.quantidade}×</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Por pedido" className="[break-before:page]">
            <h2 className="mb-2 font-medium">Por pedido</h2>
            <ul className="flex flex-col gap-2">
              {pedidos.map((p) => (
                <li key={p.id} className="rounded-md border border-border p-2 text-sm [break-inside:avoid]">
                  <p className="font-medium">
                    Pedido #{p.numero ?? p.id} <span className="font-normal text-muted">· {dataBr(p.criadoEm)}</span>
                  </p>
                  <ul className="mt-1">
                    {p.itens.map((i, n) => (
                      <li key={n}>
                        {i.quantidade}× {i.nome}
                        {i.variacao ? ` — ${i.variacao}` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
