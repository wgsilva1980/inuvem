import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PainelDoDia, Tarefa } from "@/lib/dashboard/hoje";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const TOM: Record<Tarefa["tom"], "danger" | "warning" | "neutral"> = { danger: "danger", warning: "warning", info: "neutral" };

/** O que pede ação hoje (vindo do banco, sem chamar a Nuvemshop) e as vendas do dia. */
export function PainelDoDiaCard({ painel }: { painel: PainelDoDia }) {
  const { tarefas, vendas, pedidosLidosEm, pedidosDesatualizados } = painel;
  const dataHoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Hoje</h2>
        <p className="text-sm capitalize text-muted">{dataHoje}</p>
      </div>

      {vendas && (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Pedidos pagos hoje</dt>
            <dd className="text-2xl font-semibold">{vendas.hoje.pedidos}</dd>
          </div>
          <div>
            <dt className="text-muted">Faturamento hoje</dt>
            <dd className="text-2xl font-semibold">{brl(vendas.hoje.faturamento)}</dd>
          </div>
          <div>
            <dt className="text-muted">Ontem</dt>
            <dd className="text-lg font-medium">
              {vendas.ontem.pedidos} {vendas.ontem.pedidos === 1 ? "pedido" : "pedidos"} · {brl(vendas.ontem.faturamento)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Média dos últimos 7 dias</dt>
            <dd className="text-lg font-medium">{brl(vendas.mediaDiaria)} por dia</dd>
          </div>
        </dl>
      )}
      {pedidosLidosEm && (
        <p className={`mt-2 text-xs ${pedidosDesatualizados ? "text-warning" : "text-muted"}`}>
          Pedidos lidos da loja em {quando(pedidosLidosEm)}
          {pedidosDesatualizados ? " (desatualizado: os números de hoje podem estar incompletos)" : ""}. A leitura automática roda uma vez por dia; use <Link href="/vendas" className="underline">Vendas</Link> para atualizar.
        </p>
      )}

      <h3 className="mt-4 text-sm font-medium">Precisa de ação</h3>
      {tarefas.length === 0 ? (
        <p className="mt-2 text-sm text-success">Nada pendente agora: expedição, estoque, promoções, lotes e cashback em dia.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {tarefas.map((t) => (
            <li key={t.id}>
              <Link href={t.href} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border-strong px-3 py-2 hover:bg-border/40">
                <span className="min-w-0">
                  <span className="block">{t.titulo}</span>
                  {t.detalhe && <span className="block text-xs text-muted">{t.detalhe}</span>}
                </span>
                <Badge tone={TOM[t.tom]}>{t.quantidade}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
