import { requireAdminApi } from "@/lib/auth/admin";
import { gerarCodigos, loteSchema } from "@/lib/coupons/lote";
import { todosOsCupons } from "@/lib/coupons/service";
import { NuvemshopError } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Valida o lote e sorteia os códigos (sem repetir os que já existem na loja). Não cria nada. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = loteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados do lote inválidos." }, { status: 400 });
  try {
    const { itens, truncado } = await todosOsCupons(await clientForStore(store));
    const codigos = gerarCodigos(parsed.data.prefixo, parsed.data.quantidade, itens.map((c) => c.code));
    return Response.json({ codigos, aviso: truncado ? "A loja tem mais cupons do que consegui conferir; se algum código já existir, a loja vai recusá-lo e eu aviso." : null });
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    return Response.json({ error: err instanceof Error ? err.message : "Falha ao preparar o lote." }, { status: 500 });
  }
}
