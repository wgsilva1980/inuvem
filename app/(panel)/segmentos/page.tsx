import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { brl } from "@/lib/costs/math";
import { query } from "@/lib/db";
import { ultimaSincronizacaoPedidos } from "@/lib/orders/sync";
import { SEGMENTOS, SEGMENTO_IDS, classificar, ehSegmento, resumir, ticketMedio, alcancavel } from "@/lib/segments/regras";
import { clientesAgregadas, MAX_CLIENTES } from "@/lib/segments/repo";
import { getActiveStore } from "@/lib/stores";
import { SincronizarPedidos } from "../vendas/sincronizar-pedidos";
import { Exportar } from "./exportar";

export const dynamic = "force-dynamic";

const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const PREVIA = 15;

export default async function SegmentosPage({ searchParams }: { searchParams: Promise<{ segmento?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver os segmentos de clientes.</p>
      </Card>
    );
  }
  const db = { query };
  const ultima = await ultimaSincronizacaoPedidos(db, store.id);
  const escolhido = (await searchParams).segmento;
  const atual = ehSegmento(escolhido) ? escolhido : SEGMENTO_IDS[0]!;
  const clientes = ultima ? await clientesAgregadas(db, store.id) : [];
  const por = classificar(clientes);
  const resumo = resumir(por);
  const lista = por[atual];
  const r = resumo.find((x) => x.id === atual)!;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Segmentos de clientes</h1>
        <p className="text-sm text-muted">
          Grupos de clientes montados com os pedidos pagos que o painel já leu, com a lista para baixar e usar em campanhas (WhatsApp, e-mail). Uma cliente pode estar em mais de um grupo. Quem recusou receber contato não entra nas listas com contatos.
        </p>
      </div>

      {!ultima && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-muted">Os pedidos ainda não foram lidos. Leia os pedidos para montar os segmentos.</p>
          <SincronizarPedidos ultima={ultima} />
        </Card>
      )}

      {ultima && (
        <>
          <nav aria-label="Segmentos" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {resumo.map((s) => (
              <Link key={s.id} href={`/segmentos?segmento=${s.id}`} aria-current={s.id === atual ? "page" : undefined} className={`flex flex-col gap-1 rounded-lg border p-4 ${s.id === atual ? "border-foreground" : "border-border hover:bg-border/40"}`}>
                <span className="text-sm font-medium">{SEGMENTOS[s.id].rotulo}</span>
                <span className="text-2xl font-semibold">{s.clientes}</span>
                <span className="text-xs text-muted">
                  {brl(s.gasto)} no total · ticket médio {brl(s.ticket)} · {s.alcancaveis} com contato
                </span>
              </Link>
            ))}
          </nav>

          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="font-medium">{SEGMENTOS[atual].rotulo}</h2>
              <p className="text-sm text-muted">{SEGMENTOS[atual].descricao}</p>
              <p className="mt-1 text-sm">{SEGMENTOS[atual].ideia}</p>
            </div>
            {lista.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma cliente neste grupo ainda.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="py-1 pr-3 font-medium">Cliente</th>
                        <th className="py-1 pr-3 font-medium">Pedidos</th>
                        <th className="py-1 pr-3 font-medium">Total</th>
                        <th className="py-1 pr-3 font-medium">Ticket médio</th>
                        <th className="py-1 pr-3 font-medium">Última compra</th>
                        <th className="py-1 font-medium">Contato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.slice(0, PREVIA).map((c) => (
                        <tr key={c.id} className="border-t border-border">
                          <td className="py-2 pr-3">
                            {c.nome}
                            {c.cidade && <span className="text-xs text-muted"> · {[c.cidade, c.uf].filter(Boolean).join("/")}</span>}
                          </td>
                          <td className="py-2 pr-3">{c.pedidos}</td>
                          <td className="py-2 pr-3">{brl(c.gasto)}</td>
                          <td className="py-2 pr-3">{brl(ticketMedio(c))}</td>
                          <td className="py-2 pr-3">{dia(c.ultimaCompra)}</td>
                          <td className="py-2 text-xs text-muted">{c.recusouContato ? "recusou" : alcancavel(c) ? "sim" : "sem telefone/e-mail"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {lista.length > PREVIA && <p className="text-xs text-muted">Mostrando as {PREVIA} que mais gastaram, de {lista.length}. A lista para baixar traz todas.</p>}
                <Exportar segmento={atual} alcancaveis={r.alcancaveis} />
              </>
            )}
          </Card>
          {clientes.length >= MAX_CLIENTES && <p className="text-xs text-muted">A loja tem mais clientes do que o painel analisa de uma vez ({MAX_CLIENTES}); os grupos consideram as que mais gastaram.</p>}
          <p className="text-xs text-muted">Contam só pedidos pagos e não cancelados lidos pelo painel; clientes sem cadastro sincronizado em Contatos aparecem sem nome e sem contato. As listas baixadas têm no máximo 10.000 linhas.</p>
        </>
      )}
    </main>
  );
}
