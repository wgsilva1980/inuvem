import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { ORIGENS, SEGMENTOS, listContactsForExport } from "@/lib/contacts/repo";
import { KINDS } from "@/lib/contacts/schema";
import { COLUNAS_CONTATOS } from "@/lib/export/colunas";
import { gerarXlsx, respostaXlsx } from "@/lib/export/xlsx";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 20000;

/** Planilha dos contatos com os mesmos filtros da tela /contatos. Registra no Histórico (só a contagem e os filtros, sem dados pessoais). */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 100) || undefined;
  const tipo = p.get("tipo") ?? "";
  const kind = ([...KINDS, "sem_tipo"] as string[]).includes(tipo) ? tipo : undefined;
  const sit = p.get("situacao");
  const status = sit === "todos" || sit === "inativos" ? sit : "ativos";

  const o = p.get("origem");
  const origem = ORIGENS.find((x) => x === o);
  const sg = p.get("segmento");
  const segmento = SEGMENTOS.find((x) => x === sg);
  const sort = p.get("ordem") === "gasto" ? "gasto" : "nome";

  const { items, truncated } = await listContactsForExport({ query }, store.id, { q, kind, status, origem, segmento, sort }, MAX);
  const buf = await gerarXlsx("Contatos", COLUNAS_CONTATOS, items);
  await query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois) VALUES ($1::uuid, $2, 'contato.exportar', 'contato', $3::jsonb)`,
    [store.id, admin.email, JSON.stringify({ linhas: items.length, filtros: { q: q ? "(busca)" : null, tipo: kind ?? null, situacao: status, origem: origem ?? null, segmento: segmento ?? null } })],
  );
  const res = respostaXlsx(buf, "contatos");
  if (truncated) res.headers.set("x-export-truncado", "1");
  return res;
}
