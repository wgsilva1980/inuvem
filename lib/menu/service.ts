import type { Db } from "@/lib/sync/repo";
import { NOME_ARQUIVO, listaOculta, montarArquivo } from "./arquivo";
import { enviarArquivoFtp, lerConfigFtp, mensagemFtp } from "./ftp";

export const ACAO_ARQUIVO_MENU = "menu.arquivo_enviado";
export const ATOR_MENU = "Automação (menu)";
/** Depois de uma falha, as atualizações automáticas esperam este tempo antes de tentar de novo (o botão “Enviar agora” tenta na hora). */
const ESPERA_APOS_FALHA = "5 minutes";

export interface DepsMenu {
  enviar(nome: string, conteudo: string): Promise<void>;
}

export type EstadoEnvio = "enviado" | "sem_mudanca" | "falhou" | "em_andamento" | "aguardando";

export interface ResultadoMenu {
  estado: EstadoEnvio;
  caminhos: number;
  erro?: string;
}

/** Cliente do ambiente (variáveis FTP_*); null se faltar alguma. */
export function depsDoAmbiente(env: Record<string, string | undefined> = process.env): { deps: DepsMenu | null; faltando: string[] } {
  const { config, faltando } = lerConfigFtp(env);
  if (!config) return { deps: null, faltando };
  return { deps: { enviar: (nome, conteudo) => enviarArquivoFtp(config, nome, conteudo) }, faltando: [] };
}

export async function menuAutomaticoLigado(db: Db, storeId: string): Promise<boolean> {
  const [r] = await db.query<{ ligado: boolean }>("SELECT auto_menu_file AS ligado FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.ligado === true;
}

export async function salvarMenuAutomatico(db: Db, storeId: string, ligado: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (store_id, auto_menu_file, updated_by) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (store_id) DO UPDATE SET auto_menu_file = $2, updated_by = $3, updated_at = now()`,
    [storeId, ligado, actor],
  );
}

export interface EstadoMenu {
  conteudo: string | null;
  anterior: string | null;
  enviadoEm: string | null;
  erro: string | null;
  tentativaEm: string | null;
}

export async function estadoDoMenu(db: Db, storeId: string): Promise<EstadoMenu> {
  const [r] = await db.query<{ content: string | null; previous_content: string | null; sent_at: string | null; last_error: string | null; last_attempt_at: string | null }>(
    "SELECT content, previous_content, sent_at::text, last_error, last_attempt_at::text FROM menu_file_state WHERE store_id = $1::uuid",
    [storeId],
  );
  return { conteudo: r?.content ?? null, anterior: r?.previous_content ?? null, enviadoEm: r?.sent_at ?? null, erro: r?.last_error ?? null, tentativaEm: r?.last_attempt_at ?? null };
}

async function auditar(db: Db, storeId: string, actor: string, depois: unknown, sucesso: boolean, resultado: unknown) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'menu', $4, $5::jsonb, $6::jsonb, $7)`,
    [storeId, actor, ACAO_ARQUIVO_MENU, NOME_ARQUIVO, JSON.stringify(depois), JSON.stringify(resultado), sucesso],
  );
}

/** Pega a trava do envio (90 s); false se outro envio está em andamento. */
async function pegarTrava(db: Db, storeId: string): Promise<boolean> {
  await db.query("INSERT INTO menu_file_state (store_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING", [storeId]);
  const rows = await db.query(
    "UPDATE menu_file_state SET lock_until = now() + interval '90 seconds' WHERE store_id = $1::uuid AND (lock_until IS NULL OR lock_until < now()) RETURNING store_id",
    [storeId],
  );
  return rows.length > 0;
}

/**
 * Gera o arquivo com as categorias ocultas hoje e o envia por FTP se mudou desde o último envio (ou se `forcar`). Segue enquanto o conteúdo pedido
 * muda durante o envio (no máximo 2 voltas). Depois de uma falha, as chamadas automáticas esperam 5 minutos. Nunca lança: o resultado diz o que houve.
 */
export async function sincronizarArquivoDoMenu(db: Db, deps: DepsMenu, args: { storeId: string; actor?: string; forcar?: boolean }): Promise<ResultadoMenu> {
  const { storeId } = args;
  const actor = args.actor ?? ATOR_MENU;
  if (!(await pegarTrava(db, storeId))) return { estado: "em_andamento", caminhos: 0 };
  let caminhos = 0;
  try {
    if (!args.forcar) {
      const [espera] = await db.query("SELECT 1 FROM menu_file_state WHERE store_id = $1::uuid AND last_error IS NOT NULL AND last_attempt_at > now() - interval '" + ESPERA_APOS_FALHA + "'", [storeId]);
      if (espera) return { estado: "aguardando", caminhos: 0 };
    }
    let forcar = args.forcar === true;
    let enviou = false;
    for (let volta = 0; volta < 2; volta++) {
      const lista = await listaOculta(db, storeId);
      const conteudo = montarArquivo(lista.caminhos);
      caminhos = lista.caminhos.length;
      const estado = await estadoDoMenu(db, storeId);
      if (!forcar && conteudo === estado.conteudo) break;
      forcar = false;
      try {
        await deps.enviar(NOME_ARQUIVO, conteudo);
      } catch (err) {
        const erro = mensagemFtp(err);
        await db.query("UPDATE menu_file_state SET last_error = $2, last_attempt_at = now() WHERE store_id = $1::uuid", [storeId, erro]);
        await auditar(db, storeId, actor, { categorias: caminhos }, false, { mensagem: erro });
        return { estado: "falhou", caminhos, erro };
      }
      await db.query(
        `UPDATE menu_file_state SET previous_content = CASE WHEN content IS NOT NULL AND content <> $2 THEN content ELSE previous_content END,
                content = $2, sent_at = now(), last_error = NULL, last_attempt_at = now() WHERE store_id = $1::uuid`,
        [storeId, conteudo],
      );
      await auditar(db, storeId, actor, { categorias: caminhos, ocultas: lista.caminhos.slice(0, 60), descartadas: lista.descartadas.length }, true, { status: "ok" });
      enviou = true;
    }
    return { estado: enviou ? "enviado" : "sem_mudanca", caminhos };
  } finally {
    await db.query("UPDATE menu_file_state SET lock_until = NULL WHERE store_id = $1::uuid", [storeId]).catch(() => undefined);
  }
}

/** Devolve ao FTP a versão anterior do arquivo (a que estava antes do último envio). */
export async function restaurarVersaoAnterior(db: Db, deps: DepsMenu, args: { storeId: string; actor: string }): Promise<ResultadoMenu> {
  const { storeId, actor } = args;
  const estado = await estadoDoMenu(db, storeId);
  if (estado.anterior === null) return { estado: "falhou", caminhos: 0, erro: "não há versão anterior guardada" };
  if (!(await pegarTrava(db, storeId))) return { estado: "em_andamento", caminhos: 0 };
  try {
    try {
      await deps.enviar(NOME_ARQUIVO, estado.anterior);
    } catch (err) {
      const erro = mensagemFtp(err);
      await db.query("UPDATE menu_file_state SET last_error = $2, last_attempt_at = now() WHERE store_id = $1::uuid", [storeId, erro]);
      await auditar(db, storeId, actor, { restaurou: true }, false, { mensagem: erro });
      return { estado: "falhou", caminhos: 0, erro };
    }
    await db.query(
      "UPDATE menu_file_state SET previous_content = content, content = $2, sent_at = now(), last_error = NULL, last_attempt_at = now() WHERE store_id = $1::uuid",
      [storeId, estado.anterior],
    );
    await auditar(db, storeId, actor, { restaurou: true }, true, { status: "ok" });
    return { estado: "enviado", caminhos: 0 };
  } finally {
    await db.query("UPDATE menu_file_state SET lock_until = NULL WHERE store_id = $1::uuid", [storeId]).catch(() => undefined);
  }
}

/**
 * Atalho para depois de qualquer mudança de categoria: se o envio automático está ligado e o FTP configurado, atualiza o arquivo.
 * Nunca lança (uma falha do FTP não pode derrubar o webhook, o cron nem a ação da tela).
 */
export async function atualizarMenuSeLigado(db: Db, storeId: string, actor?: string, deps?: DepsMenu | null): Promise<ResultadoMenu | null> {
  try {
    if (!(await menuAutomaticoLigado(db, storeId))) return null;
    const d = deps === undefined ? depsDoAmbiente().deps : deps;
    if (!d) return null;
    return await sincronizarArquivoDoMenu(db, d, { storeId, actor });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "menu.arquivo_falhou", message: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}
