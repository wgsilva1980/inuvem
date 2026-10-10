import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { query } from "@/lib/db";
import { hostsDaLoja } from "@/lib/seo/pagina-publica";
import { getActiveStore } from "@/lib/stores";
import { SeoTabs } from "../seo-tabs";
import { Assistente } from "./assistente";

export const dynamic = "force-dynamic";

export default async function SeoPaginasPage() {
  await requireAdmin();
  const store = await getActiveStore();
  const dominio = store ? ((await hostsDaLoja({ query }, store.id))[0] ?? null) : null;
  const configurado = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">SEO das páginas</h1>
        <p className="text-sm text-muted">Título e descrição de SEO fiéis ao conteúdo de cada página institucional (Quem somos, Termos de uso, Política de privacidade…).</p>
      </div>
      <SeoTabs atual="/seo/paginas" />
      {!store ? (
        <Card>
          <p className="text-sm text-muted">Conecte a loja na página inicial para usar esta tela.</p>
        </Card>
      ) : !configurado ? (
        <Card className="text-sm">
          <p className="font-medium">Falta configurar a chave da API da Anthropic.</p>
          <p className="text-muted">
            Cadastre <code>ANTHROPIC_API_KEY</code> na Vercel (Settings → Environment Variables) e faça um novo deploy.
          </p>
        </Card>
      ) : (
        <Assistente dominio={dominio} />
      )}
    </main>
  );
}
