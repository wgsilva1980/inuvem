import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { carrinhosParaTrabalhar } from "@/lib/carts/logic";
import { JANELA_CARRINHOS_DIAS, contatosDosCarrinhos, listarCarrinhos } from "@/lib/carts/service";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { CarrinhoCard } from "./carrinho-card";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  filtro: z.enum(["pendentes", "contatados", "todos"]).catch("pendentes"),
  min: z.coerce.number().int().refine((n) => [30, 60, 180, 1440].includes(n)).catch(60),
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function CarrinhosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver os carrinhos.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  let erro: string | null = null;
  let truncado = false;
  let campos: string[] = [];
  let todos = [] as Awaited<ReturnType<typeof listarCarrinhos>>["carrinhos"];
  try {
    const r = await listarCarrinhos(await clientForStore(store));
    todos = r.carrinhos;
    truncado = r.truncado;
    campos = r.campos;
  } catch (err) {
    erro = err instanceof NuvemshopError ? err.userMessage : "Não foi possível ler os carrinhos da loja agora.";
  }
  const lista = carrinhosParaTrabalhar(todos, { minMinutos: sp.min, maxDias: JANELA_CARRINHOS_DIAS });
  const contatos = await contatosDosCarrinhos({ query }, store.id, lista.map((c) => c.id));
  const mostrados = lista.filter((c) => (sp.filtro === "todos" ? true : sp.filtro === "contatados" ? Boolean(contatos.get(c.id)?.contatadoEm) : !contatos.get(c.id)?.contatadoEm));
  const pendentes = lista.filter((c) => !contatos.get(c.id)?.contatadoEm);
  const valorPendente = pendentes.reduce((s, c) => s + c.total, 0);

  const href = (over: Partial<typeof sp>) => {
    const n = { ...sp, ...over };
    return `/carrinhos?filtro=${n.filtro}&min=${n.min}`;
  };
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;
  const MINS: Array<[number, string]> = [[30, "30 min"], [60, "1 hora"], [180, "3 horas"], [1440, "1 dia"]];

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Carrinhos abandonados</h1>
        <p className="text-sm text-muted">
          Clientes que começaram a comprar e pararam (últimos {JANELA_CARRINHOS_DIAS} dias). O painel escreve a mensagem; você abre o WhatsApp com o texto pronto e decide enviar. Os dados das clientes são lidos da loja na hora e não ficam guardados aqui.
        </p>
      </div>

      {erro && (
        <Alert tone="danger">
          {erro} Se for falta de permissão, o app precisa ser reautorizado com acesso aos carrinhos (checkouts) da loja.
        </Alert>
      )}
      {truncado && <Alert tone="info">A loja tem muitos carrinhos; mostro só os mais recentes.</Alert>}

      {!erro && (
        <>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">Para contatar</p>
              <p className="text-2xl font-semibold">{pendentes.length}</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-muted">Valor nos carrinhos</p>
              <p className="text-2xl font-semibold">{brl(valorPendente)}</p>
            </Card>
          </section>

          <Card className="flex flex-col gap-3">
            <nav aria-label="Situação" className="flex flex-wrap items-center gap-2 text-sm">
              {([["pendentes", "Para contatar"], ["contatados", "Já contatados"], ["todos", "Todos"]] as const).map(([f, rotulo]) => (
                <Link key={f} href={href({ filtro: f })} aria-current={sp.filtro === f ? "page" : undefined} className={pill(sp.filtro === f)}>
                  {rotulo}
                </Link>
              ))}
            </nav>
            <nav aria-label="Parado há pelo menos" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Parado há pelo menos:</span>
              {MINS.map(([m, rotulo]) => (
                <Link key={m} href={href({ min: m })} aria-current={sp.min === m ? "page" : undefined} className={pill(sp.min === m)}>
                  {rotulo}
                </Link>
              ))}
            </nav>
            <p className="text-xs text-muted">Uma cliente com vários carrinhos aparece uma vez (o mais recente). Carrinhos sem telefone nem e-mail não aparecem.</p>
          </Card>

          {mostrados.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">{todos.length === 0 ? "Nenhum carrinho abandonado encontrado nos últimos dias." : "Nenhum carrinho neste filtro."}</p>
              {todos.length === 0 && campos.length > 0 && <p className="mt-1 text-xs text-muted">Campos recebidos da loja: {campos.join(", ")}.</p>}
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {mostrados.map((c) => (
                <li key={c.id}>
                  <CarrinhoCard
                    carrinho={{ id: c.id, nome: c.nome, tem_whatsapp: c.whatsapp !== null, email: c.email, total: c.total, criadoEm: c.criadoEm, itens: c.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade })) }}
                    contato={contatos.get(c.id) ?? null}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
