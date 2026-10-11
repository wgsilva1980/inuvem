import { requireAdmin } from "@/lib/auth/admin";
import { ConteudoTabs } from "../conteudo-tabs";
import { GuiaMedidas } from "./guia-medidas";

export const dynamic = "force-dynamic";

export default async function MedidasPage() {
  await requireAdmin();
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Guia de medidas</h1>
        <p className="text-sm text-muted">
          Você informa as medidas de cada tamanho; o painel monta a tabela e o “como medir” prontos para colar na página “Guia de medidas” da Nuvemshop. Os números são exatamente os que você digitar: nada é calculado nem inventado.
        </p>
      </div>
      <ConteudoTabs atual="/conteudo/medidas" />
      <GuiaMedidas />
    </main>
  );
}
