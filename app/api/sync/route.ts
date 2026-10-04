import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { NuvemshopError } from "@/lib/nuvemshop";
import { NoStoreError, summarize, syncStep } from "@/lib/sync/service";

export const maxDuration = 60;

const bodySchema = z.object({ tipo: z.enum(["full", "incremental", "auto"]).default("auto") });

/** Executa um lote. A UI chama repetidamente até `done: true` (sync retomável). */
export async function POST(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Requisição inválida." }, { status: 400 });

  try {
    const { run, done } = await syncStep(parsed.data.tipo);
    return Response.json({ done, run: summarize(run) });
  } catch (err) {
    if (err instanceof NoStoreError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "sync.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao sincronizar." }, { status: 500 });
  }
}
