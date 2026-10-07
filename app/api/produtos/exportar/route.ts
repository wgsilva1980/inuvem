import { requireAdminApi } from "@/lib/auth/admin";
import { listarProdutosParaExportar } from "@/lib/catalog/export";
import { catalogParamsSchema, paramsToFilters } from "@/lib/catalog/params";
import { query } from "@/lib/db";
import { COLUNAS_PRODUTOS } from "@/lib/export/colunas";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Planilha dos produtos com os mesmos filtros e ordem da tela /produtos (uma linha por variação). */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const sp = catalogParamsSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { linhas, truncado } = await listarProdutosParaExportar({ query }, store.id, paramsToFilters(sp));
  const buf = await gerarXlsx("Produtos", COLUNAS_PRODUTOS, linhas);
  const res = respostaXlsx(buf, "produtos");
  if (truncado) res.headers.set("x-export-truncado", "1");
  return res;
}
