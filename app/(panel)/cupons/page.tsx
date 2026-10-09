import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { SITUACAO_LABEL, hojeEmBrasilia, situacaoDoCupom, type SituacaoCupom } from "@/lib/coupons/lote";
import { todosOsCupons } from "@/lib/coupons/service";
import { NuvemshopError } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { CuponsLista, type LinhaCupom } from "./cupons-lista";
import { CuponsLote } from "./cupons-lote";

export const dynamic = "force-dynamic";

const SITUACOES = Object.keys(SITUACAO_LABEL) as SituacaoCupom[];
const paramsSchema = z.object({
  q: z.string().trim().max(40).optional().catch(undefined),
  situacao: z.enum(SITUACOES as [SituacaoCupom, ...SituacaoCupom[]]).optional().catch(undefined),
});

export default async function CuponsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver os cupons.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const hoje = hojeEmBrasilia();
  let linhas: LinhaCupom[] = [];
  let total = 0;
  let truncado = false;
  let erro: string | null = null;
  try {
    const r = await todosOsCupons(await clientForStore(store));
    truncado = r.truncado;
    const todos = r.itens.map((c) => ({ c, s: situacaoDoCupom(c, hoje) }));
    total = todos.length;
    linhas = todos
      .filter(({ c, s }) => (sp.q ? c.code.toUpperCase().includes(sp.q.toUpperCase()) : true) && (sp.situacao ? s === sp.situacao : true))
      .sort((a, b) => b.c.id - a.c.id)
      .slice(0, 300)
      .map(({ c, s }) => ({
        id: c.id,
        code: c.code,
        tipo: c.type === "percentage" ? "%" : c.type === "absolute" ? "R$" : "",
        valor: c.value == null ? "" : String(Number(c.value)),
        situacao: s,
        usos: c.used == null ? 0 : Number(c.used),
        limite: c.max_uses == null || c.max_uses === "" ? null : Number(c.max_uses),
        inicio: c.start_date?.slice(0, 10) ?? null,
        fim: c.end_date?.slice(0, 10) ?? null,
      }));
  } catch (err) {
    erro = err instanceof NuvemshopError ? err.userMessage : "Não foi possível ler os cupons da loja agora.";
  }

  const exportParams = new URLSearchParams();
  if (sp.q) exportParams.set("q", sp.q);
  if (sp.situacao) exportParams.set("situacao", sp.situacao);

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Cupons</h1>
        <p className="text-sm text-muted">Crie vários códigos de uma vez (um por influenciadora, por exemplo), acompanhe o uso e desative os que não valem mais.</p>
      </div>

      <Card>
        <CuponsLote />
      </Card>

      {erro && <Alert tone="danger">{erro}</Alert>}
      {truncado && <Alert tone="info">A loja tem muitos cupons; mostro só os primeiros. Use a busca para achar um código.</Alert>}

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Buscar código</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Ex.: VERAO" className={`${fieldBase} w-48`} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Situação</span>
            <select name="situacao" defaultValue={sp.situacao ?? ""} className={fieldBase}>
              <option value="">Todas</option>
              {SITUACOES.map((s) => (
                <option key={s} value={s}>
                  {SITUACAO_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Filtrar
          </button>
          <a href="/cupons" className={buttonClass("outline")}>
            Limpar
          </a>
          <a href={`/api/cupons/exportar${exportParams.size ? `?${exportParams}` : ""}`} className={buttonClass("outline")} download>
            Exportar Excel
          </a>
        </form>
      </Card>

      <Card className="p-0 sm:p-0">
        <CuponsLista linhas={linhas} total={total} />
      </Card>
    </main>
  );
}
