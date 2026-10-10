import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { EXIGENCIAS, escopoConcedido } from "@/lib/diagnostico/sondas";
import { valoresDePedidos, type ValorObservado } from "@/lib/diagnostico/executar";
import { parseScopes } from "@/lib/nuvemshop/scopes";
import { getActiveStore } from "@/lib/stores";
import { RodarTeste } from "./rodar-teste";

export const dynamic = "force-dynamic";

/** Situações de envio que o painel trata como “já saiu” (o resto cai na fila de expedição). */
const ENVIADO = ["shipped", "delivered", "fulfilled"];

function Valores({ titulo, itens, destaque }: { titulo: string; itens: ValorObservado[]; destaque?: (v: string) => string | null }) {
  return (
    <div className="text-sm">
      <p className="font-medium">{titulo}</p>
      {itens.length === 0 ? (
        <p className="text-muted">Nenhum pedido lido ainda.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {itens.map((i) => (
            <li key={i.valor} className="flex justify-between gap-3">
              <span className="font-mono text-xs">{i.valor}</span>
              <span className="text-muted">
                {i.pedidos}
                {destaque?.(i.valor) ? ` · ${destaque(i.valor)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function DiagnosticoPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para rodar o diagnóstico.</p>
      </Card>
    );
  }
  const concedidos = parseScopes(store.scope);
  const valores = await valoresDePedidos({ query }, store.id);

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Diagnóstico da API</h1>
        <p className="text-sm text-muted">
          Confere, na sua loja de verdade, o que a Nuvemshop devolve e o que o painel assume: permissões do app, campos de cada recurso e avisos (webhooks). Serve para achar cedo o que não bate, antes de aparecer como erro em uma tela.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Permissões do app</h2>
        <p className="text-sm text-muted">Concedidas à loja: {concedidos.length === 0 ? "nenhuma informada" : concedidos.join(", ")}.</p>
        <ul className="flex flex-col gap-1 text-sm">
          {EXIGENCIAS.map((e) => {
            const falta = e.exige.filter((x) => !escopoConcedido(concedidos, x));
            return (
              <li key={e.funcionalidade} className="flex items-start justify-between gap-3">
                <span>
                  {e.funcionalidade} <span className="font-mono text-xs text-muted">({e.exige.join(", ")})</span>
                </span>
                {falta.length === 0 ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Falta</Badge>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">Se faltar alguma, ative a permissão no app (Portal de Parceiros da Nuvemshop) e reautorize a loja. Só leitura de carrinhos e de modelos de e-mail depende de permissões que o teste abaixo confirma na prática.</p>
      </Card>

      <RodarTeste />

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Situações que aparecem nos seus pedidos</h2>
        <p className="text-sm text-muted">Vindo dos pedidos já lidos (do banco, sem chamar a loja). Confira se o painel entende cada valor: ele considera “pago” só <span className="font-mono">paid</span> e “já enviado” as situações de envio {ENVIADO.map((e) => `“${e}”`).join(", ")}.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Valores titulo="Pagamento (payment_status)" itens={valores.pagamento} destaque={(v) => (v === "paid" ? "conta como venda" : null)} />
          <Valores titulo="Situação (status)" itens={valores.situacao} destaque={(v) => (v === "cancelled" ? "não conta" : null)} />
          <Valores titulo="Envio (shipping_status)" itens={valores.envio} destaque={(v) => (ENVIADO.includes(v) ? "já enviado" : "vai para a fila")} />
        </div>
      </Card>
    </main>
  );
}
