import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { Baixar } from "./baixar";

export const dynamic = "force-dynamic";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function BackupPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const [ultimo] = await query<{ quando: string; quem: string; produtos: number | null; clientes: boolean | null }>(
    `SELECT created_at::text AS quando, actor_email AS quem, (depois->>'produtos')::int AS produtos, (depois->>'clientesIncluidos')::boolean AS clientes
     FROM audit_log WHERE store_id = $1::uuid AND acao = 'backup.gerar' ORDER BY id DESC LIMIT 1`,
    [store.id],
  );
  return (
    <main className="flex max-w-3xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Backup</h1>
        <p className="text-sm text-muted">Baixe uma cópia (.zip) de tudo o que o painel guarda da loja, para ter uma cópia sua, fora daqui e da Nuvemshop. Só lê os dados; nada é alterado na loja.</p>
      </div>
      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">O que vem no arquivo</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>Produtos com variações e categorias, completos, como a loja os tinha na última sincronização (JSON) e o catálogo em planilha (.xlsx), com preço, promoção, estoque e custo.</li>
          <li>O que só existe no painel: custos dos produtos, blocos de conteúdo, pedidos de compra e configurações (custos, cashback, selos).</li>
          <li>Pedidos e itens dos pedidos (CSV), sem nome, e-mail, telefone nem endereço de quem comprou.</li>
          <li>Um LEIAME com a data e as contagens.</li>
        </ul>
        <p className="text-muted">Não é um backup da Nuvemshop: não restaura a loja sozinho e não inclui os arquivos das fotos (só os endereços delas). Serve para consultar, comparar e recuperar dados à mão. O Histórico de alterações fica guardado no próprio painel.</p>
      </Card>
      <Card className="flex flex-col gap-2 text-sm">
        <p className="text-muted">{ultimo ? `Último backup: ${quando(ultimo.quando)}, por ${ultimo.quem}${ultimo.clientes ? " (com clientes)" : ""}.` : "Nenhum backup baixado ainda."} Os dados são os da última sincronização: sincronize o catálogo e os pedidos antes, se quiser a cópia mais recente.</p>
        <Baixar />
      </Card>
    </main>
  );
}
