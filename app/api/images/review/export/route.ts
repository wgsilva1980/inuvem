import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { gerarCsvRevisao, linhasRevisao } from "@/lib/images/review";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Planilha com os textos alternativos sugeridos das fotos principais (para colar à mão no painel da Nuvemshop). */
export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const csv = gerarCsvRevisao(await linhasRevisao({ query }, store.id));
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="textos-alternativos.csv"', "cache-control": "no-store" },
  });
}
