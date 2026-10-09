import { requireAdminApi } from "@/lib/auth/admin";
import { NuvemshopError } from "@/lib/nuvemshop";
import { SemLojaError, passoVendasDaLoja } from "@/lib/sales/service";
import { isSameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lê os pedidos pagos da loja (só leitura) para saber o que vende e o que está parado. Um pedaço por chamada; a tela repete até `concluido`. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => ({}))) as { page?: unknown; runId?: unknown; dias?: unknown };
  const page = Number.isInteger(body.page) && (body.page as number) > 0 ? (body.page as number) : undefined;
  const runId = typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : undefined;
  const janelaDias = Number.isInteger(body.dias) && (body.dias as number) >= 30 && (body.dias as number) <= 730 ? (body.dias as number) : undefined;
  try {
    return Response.json(await passoVendasDaLoja({ page, runId, janelaDias, budgetMs: 25_000, actor: admin.email }));
  } catch (err) {
    if (err instanceof SemLojaError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "sales.sync.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao ler as vendas." }, { status: 500 });
  }
}
