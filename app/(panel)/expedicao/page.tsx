import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { coberturaDosPedidos } from "@/lib/orders/stats";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { filaDeExpedicao } from "@/lib/shipping/queue";
import { getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../vendas/sincronizar-pedidos";
import { FilaExpedicao } from "./fila-expedicao";

export const dynamic = "force-dynamic";

const ATRASOS = [1, 2, 3, 5] as const;
const paramsSchema = z.object({
  atraso: z.coerce.number().int().refine((n) => (ATRASOS as readonly number[]).includes(n)).catch(2),
  filtro: z.enum(["todos", "atrasados"]).catch("todos"),
});

export default async function ExpedicaoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver a expedição.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const cobertura = await coberturaDosPedidos(db, store.id);
  const fila = ultima ? await filaDeExpedicao(db, store.id, sp.atraso) : [];
  const atrasados = fila.filter((p) => p.atrasado);
  const mostrados = sp.filtro === "atrasados" ? atrasados : fila;
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;
  const href = (over: Partial<typeof sp>) => {
    const n = { ...sp, ...over };
    return `/expedicao?atraso=${n.atraso}&filtro=${n.filtro}`;
  };

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Expedição</h1>
        <p className="text-sm text-muted">Pedidos pagos que ainda não foram enviados, a lista de separação com a foto das peças e o código de rastreio em lote. Atualize os pedidos antes de começar, para a fila refletir a loja.</p>
      </div>

      <Card className="flex flex-col gap-2">
        <SincronizarPedidos ultima={ultima} />
        {cobertura.ultimo && <p className="text-xs text-muted">Pedidos lidos até {cobertura.ultimo.split("-").reverse().join("/")}.</p>}
      </Card>

      {!ultima ? (
        <Card>
          <p className="text-sm text-muted">Leia os pedidos da loja para montar a fila. É só leitura: nada é alterado na loja até você marcar um pedido como enviado.</p>
        </Card>
      ) : (
        <>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">A enviar</p>
              <p className="text-2xl font-semibold">{fila.length}</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">Atrasados (há {sp.atraso}+ {sp.atraso === 1 ? "dia" : "dias"})</p>
              <p className={`text-2xl font-semibold ${atrasados.length > 0 ? "text-danger" : ""}`}>{atrasados.length}</p>
            </Card>
          </section>

          <Card className="flex flex-col gap-3">
            <nav aria-label="Filtro" className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={href({ filtro: "todos" })} aria-current={sp.filtro === "todos" ? "page" : undefined} className={pill(sp.filtro === "todos")}>
                Todos
              </Link>
              <Link href={href({ filtro: "atrasados" })} aria-current={sp.filtro === "atrasados" ? "page" : undefined} className={pill(sp.filtro === "atrasados")}>
                Só atrasados
              </Link>
            </nav>
            <nav aria-label="Atraso" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Conta como atrasado a partir de:</span>
              {ATRASOS.map((d) => (
                <Link key={d} href={href({ atraso: d })} aria-current={sp.atraso === d ? "page" : undefined} className={pill(sp.atraso === d)}>
                  {d} {d === 1 ? "dia" : "dias"}
                </Link>
              ))}
            </nav>
            <p className="text-xs text-muted">Os dias contam da criação do pedido (dias corridos). Pedidos para retirar na loja não têm como ser identificados aqui: marque como enviado só os que vão pelo correio ou transportadora.</p>
          </Card>

          <FilaExpedicao
            pedidos={mostrados.map((p) => ({
              id: p.id,
              numero: p.numero,
              criadoEm: p.criadoEm,
              diasParado: p.diasParado,
              atrasado: p.atrasado,
              total: p.total,
              rastreio: p.rastreio,
              unidades: p.unidades,
              itens: p.itens.map((i) => ({ nome: i.nome, variacao: i.variacao, quantidade: i.quantidade, foto: i.foto })),
            }))}
          />
        </>
      )}
    </main>
  );
}
