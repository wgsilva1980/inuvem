import { requireAdminApi } from "@/lib/auth/admin";
import { montarGuia } from "@/lib/content/medidas";
import { isSameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Monta o guia de medidas em HTML a partir da tabela digitada. Não usa IA nem grava nada: os números são exatamente os informados. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => ({}))) as { texto?: unknown; tipo?: unknown; comoMedir?: unknown };
  if (typeof body.texto !== "string") return Response.json({ error: "Informe a tabela." }, { status: 400 });
  return Response.json(montarGuia(body.texto, { tipo: body.tipo === "peca" ? "peca" : "corpo", comoMedir: body.comoMedir !== false }));
}
