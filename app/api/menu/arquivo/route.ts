import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NOME_ARQUIVO, listaOculta, montarArquivo } from "@/lib/menu/arquivo";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Baixa o arquivo de menu gerado agora (para conferir ou copiar à mão pelo FTP). Não envia nada. */
export async function GET() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const lista = await listaOculta({ query }, store.id);
  return new Response(montarArquivo(lista.caminhos), {
    headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${NOME_ARQUIVO}"`, "cache-control": "no-store" },
  });
}
