import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { createStorePage } from "@/lib/nuvemshop/pages";
import { sanitizeDescription } from "@/lib/catalog/description";
import type { Db } from "@/lib/sync/repo";
import { pendenciasNoTexto } from "./pagina-ia";

export class PaginaConteudoError extends Error {}

export const ACAO_PAGINA_CRIAR = "pagina.criar";

/** Cria a página na loja (por padrão como rascunho, não publicada) e registra no Histórico. Só publica se não restar nenhum “[preencher: …]”. */
export async function criarPaginaNaLoja(
  db: Db,
  c: NuvemshopClient,
  args: { storeId: string; actor: string; titulo: string; html: string; publicar: boolean },
): Promise<{ id: number; publicada: boolean }> {
  const titulo = args.titulo.replace(/\s+/g, " ").trim();
  if (titulo.length < 2 || titulo.length > 120) throw new PaginaConteudoError("O título precisa ter de 2 a 120 caracteres.");
  const html = sanitizeDescription(args.html).trim();
  if (html.replace(/<[^>]*>/g, "").trim() === "") throw new PaginaConteudoError("O texto da página está vazio.");
  const pendencias = pendenciasNoTexto(html);
  if (args.publicar && pendencias > 0) throw new PaginaConteudoError(`Ainda há ${pendencias} trecho(s) “[preencher: …]” no texto. Complete ou crie como rascunho.`);

  const criada = await createStorePage(c, { title: titulo, content: html, publish: args.publicar });
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, $3, 'pagina', $4, $5::jsonb, true)`,
    [args.storeId, args.actor, ACAO_PAGINA_CRIAR, String(criada.id), JSON.stringify({ titulo, publicada: args.publicar, pendencias, caracteres: html.length })],
  );
  return { id: criada.id, publicada: args.publicar };
}
