import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { obterConfig } from "@/lib/badges/settings";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { SelosForm } from "./selos-form";
import { TestarProduto } from "./testar-produto";

export const dynamic = "force-dynamic";

export default async function SelosPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para configurar os selos.</p>
      </Card>
    );
  }
  const config = await obterConfig({ query }, store.id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "inuvem.vercel.app";
  const trecho = `<script async src="https://${host}/api/loja/selos.js?store=${store.nuvemshop_store_id}"></script>`;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Selos na vitrine</h1>
        <p className="text-sm text-muted">“Últimas unidades”, contagem regressiva da promoção e botão de WhatsApp na página do produto da loja.</p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">1. Colocar o código na loja (uma vez)</h2>
        <p className="text-sm text-muted">
          No painel da Nuvemshop, abra a área de códigos externos (Configurações → Códigos externos ou equivalente, o nome pode variar) e cole este trecho no campo de scripts do final da página. Para tirar tudo, apague o trecho ou desligue o interruptor abaixo.
        </p>
        <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 text-xs select-all">{trecho}</pre>
        <p className="text-xs text-muted">O script é pequeno, não usa cookies nem guarda dados da cliente, e só atua em páginas de produto (/produtos/…). Se algo falhar, a vitrine continua normal.</p>
      </Card>

      <h2 className="text-lg font-semibold">2. Escolher os selos</h2>
      <SelosForm config={config} />

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">3. Conferir um produto</h2>
        <TestarProduto nuvemshopStoreId={store.nuvemshop_store_id} />
      </Card>
    </main>
  );
}
