import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { POR_PAGINA, listarCustos, margemMinima, resumoDeCustos } from "@/lib/costs/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { Ferramentas } from "./ferramentas";
import { MargemForm } from "./margem-form";
import { TabelaCustos } from "./tabela-custos";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  filtro: z.enum(["todos", "sem_custo", "margem_baixa", "abaixo_do_custo"]).catch("todos"),
  pagina: z.coerce.number().int().min(1).max(100000).catch(1),
});

const FILTRO_LABEL = { todos: "Todos", sem_custo: "Sem custo", margem_baixa: "Margem baixa", abaixo_do_custo: "Abaixo do custo" } as const;

export default async function CustosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para cadastrar custos.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const db = { query };
  const minimo = await margemMinima(db, store.id);
  const [resumo, lista] = await Promise.all([resumoDeCustos(db, store.id), listarCustos(db, store.id, { q: sp.q, filtro: sp.filtro, margemMinima: minimo, pagina: sp.pagina })]);
  const pages = Math.max(1, Math.ceil(lista.total / POR_PAGINA));

  const base = (over: Partial<{ q: string; filtro: string; pagina: number }>) => {
    const p = new URLSearchParams();
    const q = "q" in over ? over.q : sp.q;
    const filtro = over.filtro ?? sp.filtro;
    const pagina = over.pagina ?? 1;
    if (q) p.set("q", q);
    if (filtro !== "todos") p.set("filtro", filtro);
    if (pagina > 1) p.set("pagina", String(pagina));
    const qs = p.toString();
    return qs ? `/custos?${qs}` : "/custos";
  };
  const exportParams = new URLSearchParams();
  if (sp.q) exportParams.set("q", sp.q);
  if (sp.filtro !== "todos") exportParams.set("filtro", sp.filtro);
  const exportHref = `/api/custos/exportar${exportParams.size ? `?${exportParams}` : ""}`;
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Custos e margem</h1>
        <p className="text-sm text-muted">
          Informe o custo de cada produto para ver a margem, o lucro das vendas e para o painel não deixar um lote, uma promoção ou a liquidação vender abaixo do custo. Os custos ficam só no painel.
        </p>
      </div>

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Produtos com custo</p>
          <p className="text-2xl font-semibold">
            {resumo.comCusto} <span className="text-base font-normal text-muted">de {resumo.produtos}</span>
          </p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Publicados sem custo</p>
          <p className="text-2xl font-semibold">{resumo.publicadosSemCusto}</p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Vendendo abaixo do custo</p>
          <p className={`text-2xl font-semibold ${resumo.abaixoDoCusto > 0 ? "text-danger" : ""}`}>{resumo.abaixoDoCusto}</p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-muted">Margem mínima</p>
          <p className="text-2xl font-semibold">{minimo.toLocaleString("pt-BR")}%</p>
        </Card>
      </section>

      <Card>
        <MargemForm margem={minimo} />
      </Card>
      <Card>
        <Ferramentas exportHref={exportHref} />
      </Card>

      <Card className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">Buscar produto ou SKU</span>
            <input name="q" defaultValue={sp.q ?? ""} className={fieldBase} />
          </label>
          {sp.filtro !== "todos" && <input type="hidden" name="filtro" value={sp.filtro} />}
          <button type="submit" className={buttonClass("primary")}>
            Buscar
          </button>
        </form>
        <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(FILTRO_LABEL) as Array<keyof typeof FILTRO_LABEL>).map((f) => (
            <Link key={f} href={base({ filtro: f })} aria-current={sp.filtro === f ? "page" : undefined} className={pill(sp.filtro === f)}>
              {FILTRO_LABEL[f]}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted">
          {lista.total} {lista.total === 1 ? "produto" : "produtos"}. Digite o custo e saia do campo (ou aperte Enter) para salvar; deixe vazio para apagar. A margem usa o menor preço de venda do produto hoje (o promocional, se houver).
        </p>
        {lista.itens.length === 0 ? <p className="text-sm text-muted">Nenhum produto encontrado.</p> : <TabelaCustos linhas={lista.itens} margemMinima={minimo} />}
        <Pagination page={Math.min(sp.pagina, pages)} pages={pages} href={(n) => base({ pagina: n })} />
      </Card>
    </main>
  );
}
