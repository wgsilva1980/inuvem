import { requireAdminApi } from "@/lib/auth/admin";
import { gerarPlanilhaCustos } from "@/lib/costs/planilha";
import { listarCustos, margemMinima, type FiltroCustos } from "@/lib/costs/repo";
import { query } from "@/lib/db";
import { respostaXlsx } from "@/lib/export/xlsx";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FILTROS: FiltroCustos[] = ["todos", "sem_custo", "margem_baixa", "abaixo_do_custo"];

/** Planilha de custos (ID, produto, SKU, preço de venda e custo) com os mesmos filtros da tela, para preencher e importar de volta. */
export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(request.url).searchParams;
  const filtro = FILTROS.find((f) => f === p.get("filtro")) ?? "todos";
  const q = (p.get("q") ?? "").trim().slice(0, 100) || undefined;
  const minimo = await margemMinima({ query }, store.id);
  const itens: Awaited<ReturnType<typeof listarCustos>>["itens"] = [];
  for (let pagina = 1; pagina <= 100; pagina++) {
    const r = await listarCustos({ query }, store.id, { q, filtro, margemMinima: minimo, pagina });
    itens.push(...r.itens);
    if (itens.length >= r.total) break;
  }
  return respostaXlsx(await gerarPlanilhaCustos(itens), "custos");
}
