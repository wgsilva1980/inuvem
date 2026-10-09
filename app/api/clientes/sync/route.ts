import { requireAdminApi } from "@/lib/auth/admin";
import { NuvemshopError } from "@/lib/nuvemshop";
import { SemLojaError, passoClientesDaLoja } from "@/lib/customers/service";
import { isSameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Traz os clientes da loja para os Contatos (um pedaço por chamada; a tela repete com `proxima` até `concluido`).
 * Só lê da Nuvemshop: nada é alterado na loja.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => ({}))) as { page?: unknown; completo?: unknown; inicio?: unknown };
  const page = Number.isInteger(body.page) && (body.page as number) > 0 ? (body.page as number) : undefined;
  const inicio = typeof body.inicio === "string" && Number.isFinite(Date.parse(body.inicio)) ? new Date(body.inicio).toISOString() : undefined;
  try {
    return Response.json(await passoClientesDaLoja({ page, completo: body.completo === true, inicio, budgetMs: 25_000, actor: admin.email }));
  } catch (err) {
    if (err instanceof SemLojaError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "customers.sync.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao sincronizar os clientes." }, { status: 500 });
  }
}
