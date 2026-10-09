import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { autoRepublicarLigado, listarAguardandoEstoque } from "@/lib/automations/in-stock";
import { autoDespublicarLigado, contarPublicadosSemEstoque, ultimasAcoesAutomaticas } from "@/lib/automations/out-of-stock";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { AutomacaoForm } from "./automacao-form";
import { AguardandoEstoque } from "./aguardando-estoque";
import { DespublicarAgora } from "./despublicar-agora";
import { RepublicarForm } from "./republicar-form";

export const dynamic = "force-dynamic";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function AutomacoesPage() {
  await requireAdmin();
  const store = await getActiveStore();
  const db = { query };
  const ligado = store ? await autoDespublicarLigado(db, store.id) : false;
  const semEstoque = store ? await contarPublicadosSemEstoque(db, store.id) : 0;
  const republicar = store ? await autoRepublicarLigado(db, store.id) : false;
  const espera = store ? await listarAguardandoEstoque(db, store.id) : [];
  const acoes = store ? await ultimasAcoesAutomaticas(db, store.id) : [];

  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Automações</h1>
        <p className="text-sm text-muted">Regras que o painel aplica sozinho quando a Nuvemshop avisa de uma mudança. Cada ação automática aparece no Histórico.</p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Produto sem estoque sai da loja</h2>
        <AutomacaoForm ligado={ligado} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Só despublica quando <strong>todas</strong> as variações têm controle de estoque e estoque zero. Se qualquer variação tiver estoque ou não controlar estoque (ilimitado), o produto fica como está.</li>
          <li>Muda só o campo “Publicado na loja” para falso. O produto continua no painel e dá para publicar de novo quando houver estoque.</li>
          <li>Para o produto voltar sozinho quando o estoque voltar, use a regra logo abaixo.</li>
          <li>Se você publicar de propósito um produto sem estoque (por exemplo, sob encomenda), a regra o despublicará na próxima atualização dele. Nesse caso, deixe a regra desligada.</li>
          <li>A regra age quando chega um aviso do produto. Produtos que já estão publicados sem estoque hoje só são despublicados quando receberem uma atualização; para tirá-los agora, use o botão abaixo.</li>
        </ul>
        <p className="text-sm">
          Agora há <strong>{semEstoque}</strong> produto(s) publicado(s) com todas as variações sem estoque.
        </p>
        <DespublicarAgora quantos={semEstoque} />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Produto volta à loja quando o estoque volta</h2>
        <RepublicarForm ligado={republicar} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Só volta o produto que <strong>a regra acima despublicou</strong>. Produtos que você despublicou por conta própria nunca são publicados por esta regra.</li>
          <li>Volta quando pelo menos uma variação tiver estoque (ou deixar de controlar estoque). Quem você marcar como “Manter despublicado” fica fora.</li>
          <li>Se você publicar o produto à mão, ele sai da lista de espera.</li>
        </ul>
        <h3 className="text-sm font-semibold">Despublicados por falta de estoque ({espera.length})</h3>
        <AguardandoEstoque linhas={espera.map((e) => ({ product_id: e.product_id, produto: e.produto ?? `Produto ${e.product_id}`, desde: e.desde, manter: e.manter, comEstoque: e.comEstoque }))} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Últimas ações automáticas</h2>
        {acoes.length === 0 ? (
          <EmptyState title="Nenhuma ação automática ainda" />
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {acoes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-muted">{quando(a.created_at)}</span>
                <Link href={`/produtos/${a.product_id}`} className="font-medium hover:underline">
                  {a.produto ?? `Produto ${a.product_id}`}
                </Link>
                {a.sucesso ? <Badge tone="success">{a.acao === "produto.republicar_com_estoque" ? "Publicado de novo" : "Despublicado"}</Badge> : <Badge tone="danger">Falhou</Badge>}
                {a.mensagem && <span className="text-danger">{a.mensagem}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
