import { requireAdmin } from "@/lib/auth/admin";
import { listAdmins } from "@/lib/auth/admin-users";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { alertasRecentes, obterConfigAlertas } from "@/lib/alerts/service";
import { query } from "@/lib/db";
import { REMETENTE_PADRAO, emailConfigurado } from "@/lib/digest/enviar";
import { getActiveStore } from "@/lib/stores";
import { AlertasForm } from "./alertas-form";

export const dynamic = "force-dynamic";

const TIPO: Record<string, string> = { pedido_pago: "Pedido pago", esgotado: "Esgotou", sync_falhou: "Sincronização", teste: "Teste" };
const quando = (iso: string) => new Date(iso.replace(" ", "T") + (/[zZ]|[+-]\d\d(:?\d\d)?$/.test(iso) ? "" : "Z")).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function AlertasPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para configurar os alertas.</p>
      </Card>
    );
  }
  const db = { query };
  const [cfg, admins, recentes] = await Promise.all([obterConfigAlertas(db, store.id), listAdmins(db), alertasRecentes(db, store.id)]);
  const pronto = emailConfigurado();
  const remetente = process.env.RESEND_FROM?.trim() || REMETENTE_PADRAO;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Alertas por e-mail</h1>
        <p className="text-sm text-muted">
          Um aviso na hora, por e-mail, quando entra um <strong>pedido pago</strong>, quando um produto publicado <strong>esgota</strong> ou quando a <strong>sincronização falha</strong>. Os e-mails só trazem dados do negócio (número do pedido, total, peças, nome do produto): nenhum dado de cliente. Cada fato avisa uma vez só, e no máximo 10 alertas por hora.
        </p>
      </div>

      <AlertasForm cfg={cfg} admins={admins.map((a) => a.email)} emailPronto={pronto} />

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium">Últimos alertas</h2>
        {recentes.length === 0 ? (
          <p className="text-sm text-muted">Nenhum alerta ainda.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {recentes.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{TIPO[a.kind] ?? a.kind}</Badge>
                  <span className="font-medium">{a.titulo}</span>
                  <span className="text-xs text-muted">{quando(a.created_at)}</span>
                </div>
                <span className={a.erro ? "text-danger" : "text-muted"}>
                  {a.suprimido ? "Não enviado: passou do limite de 10 por hora." : a.erro ? `${a.enviados > 0 ? `Enviado para ${a.enviados}, mas houve falha: ` : "Falhou: "}${a.erro}` : `Enviado para ${a.enviados} destinatário(s).`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Como funciona</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>
            <strong>Pedido pago</strong> depende de um aviso da Nuvemshop. Clique em “Ativar aviso de pedido pago” uma vez, depois de salvar.
          </li>
          <li>
            <strong>Esgotou</strong> avisa quando todas as variações de um produto <em>publicado</em> chegam a zero. Se o estoque voltar e zerar de novo, avisa de novo. Ao ligar, produtos que já estão zerados avisam na próxima atualização deles (limite de 10 por hora).
          </li>
          <li>
            <strong>Sincronização</strong> avisa, no máximo uma vez por dia, quando a leitura diária do catálogo falha.
          </li>
          <li>
            O envio usa o mesmo serviço do resumo diário (Resend). Remetente atual: <span className="font-mono text-xs">{remetente}</span>. Sem domínio verificado, o Resend só entrega ao e-mail dono da conta (veja Resumo diário).
          </li>
        </ul>
      </Card>
    </main>
  );
}
