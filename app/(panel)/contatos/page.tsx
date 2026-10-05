import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { fieldBase } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { listContacts } from "@/lib/contacts/repo";
import { KINDS, KIND_LABEL } from "@/lib/contacts/schema";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  tipo: z.string().optional().catch(undefined),
  situacao: z.enum(["todos", "ativos", "inativos"]).catch("ativos"),
  pagina: z.coerce.number().int().min(1).max(100000).catch(1),
  excluido: z.string().optional().catch(undefined),
});

export default async function ContatosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver os contatos.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const kind = sp.tipo && ([...KINDS, "sem_tipo"] as string[]).includes(sp.tipo) ? sp.tipo : undefined;
  const result = await listContacts({ query }, store.id, { q: sp.q, kind, status: sp.situacao, page: sp.pagina });

  const href = (page: number) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (kind) p.set("tipo", kind);
    if (sp.situacao !== "ativos") p.set("situacao", sp.situacao);
    if (page > 1) p.set("pagina", String(page));
    const qs = p.toString();
    return qs ? `/contatos?${qs}` : "/contatos";
  };

  return (
    <main className="flex flex-col gap-4 pb-20">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Contatos</h1>
          <p className="text-sm text-muted">
            {result.total} {result.total === 1 ? "contato" : "contatos"} · clientes e fornecedores
          </p>
        </div>
        <Link href="/contatos/novo" className={buttonClass("primary")}>
          Novo contato
        </Link>
      </div>
      {sp.excluido === "1" && <Alert tone="success">Contato excluído.</Alert>}

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Buscar</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Nome, e-mail, telefone, CPF/CNPJ ou cidade" className={fieldBase} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Tipo</span>
            <select name="tipo" defaultValue={kind ?? ""} className={fieldBase}>
              <option value="">Todos</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
              <option value="sem_tipo">Sem tipo</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Situação</span>
            <select name="situacao" defaultValue={sp.situacao} className={fieldBase}>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button type="submit" className={buttonClass("primary")}>
              Filtrar
            </button>
            <Link href="/contatos" className={buttonClass("outline")}>
              Limpar
            </Link>
          </div>
        </form>
      </Card>

      <Card className="p-0 sm:p-0">
        {result.items.length === 0 ? (
          <EmptyState title="Nenhum contato encontrado">
            <p className="text-muted">Mude a busca ou os filtros, ou cadastre um novo contato.</p>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {result.items.map((c) => (
              <li key={c.id}>
                <Link href={`/contatos/${c.id}`} className="flex flex-col gap-1 p-4 hover:bg-border/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {c.name}
                      {c.trade_name ? <span className="font-normal text-muted"> · {c.trade_name}</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[c.mobile || c.phone, c.email, [c.city, c.state].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "Sem dados de contato"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    {c.kind && <Badge>{KIND_LABEL[c.kind as keyof typeof KIND_LABEL] ?? c.kind}</Badge>}
                    {c.person_type === "juridica" && <Badge>PJ</Badge>}
                    {!c.active && <Badge tone="warning">Inativo</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Pagination page={result.page} pages={result.pages} href={href} />
    </main>
  );
}
