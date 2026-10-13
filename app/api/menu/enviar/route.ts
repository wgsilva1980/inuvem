import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { depsDoAmbiente, restaurarVersaoAnterior, sincronizarArquivoDoMenu } from "@/lib/menu/service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ acao: z.enum(["enviar", "restaurar"]) });

/** “Enviar agora” (reenvia o arquivo mesmo sem mudança) ou “Voltar à versão anterior”, por FTP. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  const { deps, faltando } = depsDoAmbiente();
  if (!deps) return Response.json({ error: `Falta configurar o FTP na Vercel: ${faltando.join(", ")}.` }, { status: 409 });
  const r =
    parsed.data.acao === "enviar"
      ? await sincronizarArquivoDoMenu({ query }, deps, { storeId: store.id, actor: admin.email, forcar: true })
      : await restaurarVersaoAnterior({ query }, deps, { storeId: store.id, actor: admin.email });
  if (r.estado === "falhou") return Response.json({ error: r.erro ?? "Falha ao enviar." }, { status: 502 });
  if (r.estado === "em_andamento") return Response.json({ error: "Já há um envio em andamento. Aguarde um instante e tente de novo." }, { status: 409 });
  return Response.json(r);
}
