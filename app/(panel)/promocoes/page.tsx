import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { STATUS_LABEL, listPromotions, type PromoStatus } from "@/lib/promotions/repo";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const TONE: Record<PromoStatus, "success" | "neutral" | "warning" | "danger"> = { agendada: "neutral", aplicando: "warning", ativa: "success", encerrando: "warning", encerrada: "neutral", cancelada: "neutral" };

export default async function PromocoesPage() {
  await requireAdmin();
  const store = await getActiveStore();
  const promos = store ? await listPromotions({ query }, store.id) : [];
  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Promoções</h1>
          <p className="text-sm text-muted">Descontos com início e fim: o preço promocional entra na hora marcada e volta ao que era no fim.</p>
        </div>
        <Link href="/produtos" className={buttonClass("primary")}>
          Escolher produtos
        </Link>
      </div>
      <Card className="p-0 sm:p-0">
        {promos.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            Nenhuma promoção ainda. Em Produtos, marque os produtos (ou filtre) e use <strong>Agendar promoção</strong>.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {promos.map((p) => (
              <li key={p.id}>
                <Link href={`/promocoes/${p.id}`} className="flex flex-col gap-1 p-4 hover:bg-border/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.nome}</p>
                    <p className="text-xs text-muted">
                      {fmt(p.starts_at)} → {fmt(p.ends_at)} · {p.product_ids.length} {p.product_ids.length === 1 ? "produto" : "produtos"}
                    </p>
                  </div>
                  <Badge tone={TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
