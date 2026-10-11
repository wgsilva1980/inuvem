import { requireAdmin } from "@/lib/auth/admin";
import { listAdmins } from "@/lib/auth/admin-users";
import { Card } from "@/components/ui/card";
import { getEnv } from "@/lib/env";
import { query } from "@/lib/db";
import { REMETENTE_PADRAO, emailConfigurado } from "@/lib/digest/enviar";
import { mesAnterior, relatorioDoMes } from "@/lib/digest/mensal";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { obterConfigResumo, resumoDeHoje } from "@/lib/digest/service";
import Link from "next/link";
import { getActiveStore } from "@/lib/stores";
import { ResumoForm } from "./resumo-form";

export const dynamic = "force-dynamic";

const dia = (iso: string) => iso.split("-").reverse().join("/");

export default async function ResumoPage({ searchParams }: { searchParams: Promise<{ previa?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para configurar o resumo diário.</p>
      </Card>
    );
  }
  const db = { query };
  const [cfg, admins, previa] = await Promise.all([obterConfigResumo(db, store.id), listAdmins(db), resumoDeHoje(db, store.id, getEnv().APP_URL)]);
  const mostrarMensal = (await searchParams).previa === "mensal";
  const mensal = mostrarMensal ? await relatorioDoMes(db, store.id, getEnv().APP_URL, mesAnterior(hojeEmBrasilia())) : null;
  const pronto = emailConfigurado();
  const remetente = process.env.RESEND_FROM?.trim() || REMETENTE_PADRAO;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Resumo diário por e-mail</h1>
        <p className="text-sm text-muted">Todo dia de manhã, as vendas de ontem e o que precisa de ação hoje (expedição, estoque, promoções, lotes, cashback), com links para o painel. Só números do negócio: nenhum dado de cliente.</p>
      </div>

      <ResumoForm enabled={cfg.enabled} recipients={cfg.recipients} onlyIfAction={cfg.onlyIfAction} monthly={cfg.monthly} admins={admins.filter((a) => a.perfil === "admin").map((a) => a.email)} emailPronto={pronto} />

      {(cfg.lastSentOn || cfg.lastError || cfg.monthly || cfg.monthlyLastMonth) && (
        <Card className="flex flex-col gap-1 text-sm">
          {cfg.lastSentOn && <p>Último envio automático: {dia(cfg.lastSentOn)}.</p>}
          {cfg.lastError && <p className="text-danger">O último envio falhou: {cfg.lastError}</p>}
          {cfg.monthlyLastMonth && <p>Último relatório mensal enviado: {cfg.monthlyLastMonth.split("-").reverse().join("/")}.</p>}
          {cfg.monthlyLastError && <p className="text-danger">O último relatório mensal teve falha: {cfg.monthlyLastError}</p>}
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium">Como o e-mail fica hoje</h2>
        <p className="text-sm">
          <span className="text-muted">Assunto:</span> {previa.assunto}
        </p>
        <iframe title="Prévia do resumo diário" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={previa.html.replace("<body", '<head><base target="_blank"></head><body')} className="h-[28rem] w-full rounded-md border border-border bg-white" />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium">Relatório mensal</h2>
        {mensal ? (
          <>
            <p className="text-sm">
              <span className="text-muted">Assunto:</span> {mensal.assunto}
            </p>
            <iframe title="Prévia do relatório mensal" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mensal.html.replace("<body", '<head><base target="_blank"></head><body')} className="h-[32rem] w-full rounded-md border border-border bg-white" />
            <Link href="/resumo" className="text-sm underline">
              Fechar a prévia
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted">
            No dia 1º de cada mês (e até o dia 3, se o dia 1 falhar), os destinatários acima recebem os números do mês que passou, comparados com o mês anterior: faturamento, pedidos, ticket médio, lucro e margem estimados, descontos, cashback emitido, mais vendidos e melhor dia. <Link href="/resumo?previa=mensal" className="underline">Ver como ficaria o do mês passado</Link>.
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Configuração do envio</h2>
        <p className="text-muted">
          O painel envia pelo serviço <strong>Resend</strong> (gratuito para este volume). Estado: {pronto ? <span className="text-success">chave configurada</span> : <span className="text-danger">falta a chave</span>}. Remetente atual: <span className="font-mono text-xs">{remetente}</span>.
        </p>
        <ol className="list-decimal pl-5 text-muted">
          <li>Crie uma conta em resend.com e gere uma chave de API.</li>
          <li>Na Vercel, cadastre a variável <span className="font-mono text-xs">RESEND_API_KEY</span> com a chave e faça um novo deploy.</li>
          <li>Sem domínio verificado, o Resend só entrega para o e-mail dono da conta (use esse e-mail como destinatário). Para enviar a outras pessoas, verifique um domínio no Resend e defina <span className="font-mono text-xs">RESEND_FROM</span>, por exemplo <span className="font-mono text-xs">INuvem &lt;resumo@seudominio.com.br&gt;</span>.</li>
        </ol>
        <p className="text-xs text-muted">O envio automático roda junto da leitura diária dos pedidos, perto de 7h de Brasília, no máximo uma vez por dia.</p>
      </Card>
    </main>
  );
}
