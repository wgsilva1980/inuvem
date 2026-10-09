import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { describeOperation, planOperation } from "@/lib/bulk/operations";
import { loadMirrorProducts } from "@/lib/bulk/repo";
import { query } from "@/lib/db";
import { STATUS_LABEL, getPromotion } from "@/lib/promotions/repo";
import { getActiveStore } from "@/lib/stores";
import { PromoAcoes } from "../promo-acoes";

export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const brl = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default async function PromocaoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const store = await getActiveStore();
  if (!store) notFound();
  const db = { query };
  const p = await getPromotion(db, store.id, id);
  if (!p) notFound();

  // enquanto não começou, mostra o que seria aplicado com os preços de agora
  const plano = p.status === "agendada" ? planOperation(p.operation, await loadMirrorProducts(db, store.id, p.product_ids.map(Number))) : null;
  const variantes = plano ? plano.items.reduce((n, it) => n + it.changes.variants.length, 0) : 0;

  return (
    <main className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/promocoes" className="text-sm text-muted hover:underline">
          ← Promoções
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{p.nome}</h1>
          <Badge tone={p.status === "ativa" ? "success" : p.status === "aplicando" || p.status === "encerrando" ? "warning" : "neutral"}>{STATUS_LABEL[p.status]}</Badge>
        </div>
        <p className="text-sm text-muted">{describeOperation(p.operation)}</p>
      </div>

      <Card>
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Começa</dt>
              <dd className="font-medium">{fmt(p.starts_at)}</dd>
            </div>
            <div>
              <dt className="text-muted">Termina</dt>
              <dd className="font-medium">{fmt(p.ends_at)}</dd>
            </div>
            <div>
              <dt className="text-muted">Produtos</dt>
              <dd className="font-medium">{p.product_ids.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Criada por</dt>
              <dd className="font-medium">{p.created_by}</dd>
            </div>
          </dl>
          {p.nota && <p className="text-sm">{p.nota}</p>}
          <PromoAcoes id={p.id} status={p.status} nome={p.nome} />
          <p className="text-xs text-muted">
            {p.apply_job_id && (
              <>
                <Link href={`/lote/${p.apply_job_id}`} className="underline">
                  Ver o lote que aplicou
                </Link>{" "}
              </>
            )}
            {p.revert_job_id && (
              <Link href={`/lote/${p.revert_job_id}`} className="underline">
                Ver o lote que restaurou os preços
              </Link>
            )}
          </p>
          {p.status === "agendada" && (
            <p className="text-xs text-muted">
              O sistema confere a agenda uma vez por dia (por volta das 04:20, horário de Brasília). Para entrar ou sair em outro horário, use Iniciar agora / Encerrar agora.
            </p>
          )}
        </div>
      </Card>

      {plano && (
        <Card>
          <h2 className="mb-2 font-medium">Como ficaria agora</h2>
          <p className="mb-3 text-sm text-muted">
            {plano.items.length} {plano.items.length === 1 ? "produto" : "produtos"} e {variantes} {variantes === 1 ? "variação" : "variações"} com preço promocional novo
            {plano.ignorados.length ? `; ${plano.ignorados.length} item(ns) ficam de fora (${[...new Set(plano.ignorados.map((i) => i.motivo))].slice(0, 3).join("; ")})` : ""}. Os valores são recalculados na hora de iniciar.
          </p>
          <ul className="divide-y divide-border text-sm">
            {plano.items.slice(0, 30).map((it) => (
              <li key={it.productId} className="flex flex-col gap-0.5 py-2">
                <span className="font-medium">{it.productName}</span>
                <span className="text-xs text-muted">
                  {it.changes.variants.slice(0, 3).map((v) => `${v.label}: ${brl(v.promotional_price?.antes ?? null)} → ${brl(v.promotional_price?.depois ?? null)}`).join(" · ")}
                  {it.changes.variants.length > 3 ? ` · +${it.changes.variants.length - 3}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {plano.items.length > 30 && <p className="mt-2 text-xs text-muted">Mostrando 30 de {plano.items.length} produtos.</p>}
        </Card>
      )}
    </main>
  );
}
