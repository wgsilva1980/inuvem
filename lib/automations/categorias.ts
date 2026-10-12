import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { visibilidadeDe } from "@/lib/nuvemshop/categories";
import { pt, type Category } from "@/lib/nuvemshop/types";
import { upsertCategories, type Db } from "@/lib/sync/repo";

export const ACAO_OCULTAR = "categoria.ocultar_sem_produtos";
export const ACAO_EXIBIR = "categoria.exibir_com_produtos";
export const ATOR_CATEGORIAS = "Automação (categorias vazias)";
/** Teto de categorias ocultadas por rodada: se o espelho estiver incompleto, o estrago fica limitado. */
export const MAX_OCULTAR_POR_RODADA = 5;

export async function autoOcultarCategoriasLigado(db: Db, storeId: string): Promise<boolean> {
  const [r] = await db.query<{ ligado: boolean }>("SELECT auto_hide_empty_categories AS ligado FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.ligado === true;
}

export async function salvarAutoOcultarCategorias(db: Db, storeId: string, ligado: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (store_id, auto_hide_empty_categories, updated_by) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (store_id) DO UPDATE SET auto_hide_empty_categories = $2, updated_by = $3, updated_at = now()`,
    [storeId, ligado, actor],
  );
}

export interface ItemCategoria {
  id: string;
  nome: string;
}

export interface PlanoCategorias {
  /** Visíveis hoje e sem nenhum produto publicado nelas nem nas subcategorias (menos as que você mostrou à mão). */
  ocultar: ItemCategoria[];
  /** Ocultadas pela regra que voltaram a ter produto publicado. */
  exibir: ItemCategoria[];
  /** Ocultadas pela regra que continuam vazias. */
  ocultasPelaRegra: ItemCategoria[];
  /** O espelho não tem nenhum produto publicado: provavelmente está incompleto, então nada é ocultado. */
  espelhoSemProdutos: boolean;
}

interface Linha {
  id: string;
  nome: string;
  oculta: boolean;
  publicados: string;
  automatica: boolean;
  fixa: boolean;
}

/**
 * Situação de cada categoria no espelho. Uma categoria "tem produto" se algum produto PUBLICADO está nela ou em qualquer subcategoria (uma categoria
 * pai de subcategorias com produtos continua visível). Categorias que a regra ocultou e que não existem mais ou já estão visíveis saem da lista da regra.
 */
export async function planejarCategorias(db: Db, storeId: string): Promise<PlanoCategorias> {
  const linhas = await db.query<Linha>(
    `WITH RECURSIVE arvore(raiz, no) AS (
       SELECT id, id FROM categories WHERE store_id = $1::uuid
       UNION
       SELECT a.raiz, c.id FROM arvore a JOIN categories c ON c.store_id = $1::uuid AND c.parent_id = a.no
     )
     SELECT c.id::text AS id, c.name AS nome, coalesce(c.raw_json->>'visibility', 'visible') = 'hidden' AS oculta,
            (SELECT count(DISTINCT p.id) FROM arvore a JOIN products p ON p.store_id = $1::uuid AND p.published
               AND p.categories @> jsonb_build_array(jsonb_build_object('id', a.no)) WHERE a.raiz = c.id)::text AS publicados,
            EXISTS (SELECT 1 FROM auto_hidden_categories h WHERE h.store_id = c.store_id AND h.category_id = c.id) AS automatica,
            EXISTS (SELECT 1 FROM category_rule_exceptions e WHERE e.store_id = c.store_id AND e.category_id = c.id) AS fixa
     FROM categories c WHERE c.store_id = $1::uuid ORDER BY c.name, c.id`,
    [storeId],
  );
  const [pub] = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM products WHERE store_id = $1::uuid AND published", [storeId]);
  const espelhoSemProdutos = Number(pub?.n ?? 0) === 0;
  const item = (l: Linha): ItemCategoria => ({ id: l.id, nome: l.nome });
  return {
    espelhoSemProdutos,
    ocultar: espelhoSemProdutos ? [] : linhas.filter((l) => !l.oculta && !l.fixa && Number(l.publicados) === 0).map(item),
    exibir: linhas.filter((l) => l.automatica && l.oculta && Number(l.publicados) > 0).map(item),
    ocultasPelaRegra: linhas.filter((l) => l.automatica && l.oculta && Number(l.publicados) === 0).map(item),
  };
}

export interface ApiCategorias {
  getCategory(id: number): Promise<Category>;
  setVisibility(id: number, visibility: "visible" | "hidden"): Promise<Category>;
}

export interface ResultadoCategorias {
  desligada?: boolean;
  ocultadas: number;
  exibidas: number;
  falhas: Array<{ id: string; categoria: string; mensagem: string }>;
  /** Havia mais categorias a ocultar do que o teto da rodada; as outras ficam para a próxima. */
  restantes: number;
}

const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

async function auditar(db: Db, storeId: string, ator: string, acao: string, c: ItemCategoria, de: string, para: string, sucesso: boolean, resultado: unknown) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'categoria', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [storeId, ator, acao, c.id, JSON.stringify({ visibility: de }), JSON.stringify({ visibility: para, nome: c.nome, motivo: para === "hidden" ? "nenhum produto publicado na categoria" : "voltou a ter produto publicado" }), JSON.stringify(resultado), sucesso],
  );
}

/**
 * Aplica a regra: reexibe as categorias que ela ocultou e que voltaram a ter produto publicado e oculta as visíveis sem produto publicado.
 * Cada categoria é lida na loja antes (o espelho pode estar velho) e a resposta da loja é conferida depois: se a visibilidade não mudou de verdade,
 * conta como falha. Só reexibe o que ela mesma ocultou. Segura de repetir. `forcar` ignora a opção (ação manual).
 */
export async function aplicarRegraCategorias(
  db: Db,
  api: ApiCategorias,
  args: { storeId: string; ator?: string; forcar?: boolean; maxOcultar?: number },
): Promise<ResultadoCategorias> {
  const { storeId } = args;
  const ator = args.ator ?? ATOR_CATEGORIAS;
  const out: ResultadoCategorias = { ocultadas: 0, exibidas: 0, falhas: [], restantes: 0 };
  if (!args.forcar && !(await autoOcultarCategoriasLigado(db, storeId))) return { ...out, desligada: true };

  // quem a regra marcou mas já não está oculto (a pessoa reexibiu) ou não existe mais deixa de ser da regra
  await db.query(
    `DELETE FROM auto_hidden_categories h WHERE h.store_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.store_id = h.store_id AND c.id = h.category_id AND coalesce(c.raw_json->>'visibility', 'visible') = 'hidden')`,
    [storeId],
  );
  const plano = await planejarCategorias(db, storeId);
  const max = args.maxOcultar ?? MAX_OCULTAR_POR_RODADA;
  // uma categoria que a loja recusou nas últimas horas não é tentada a cada aviso de produto (a ação manual tenta de novo)
  const recusadas = args.forcar
    ? new Set<string>()
    : new Set((await db.query<{ id: string }>("SELECT DISTINCT entidade_id AS id FROM audit_log WHERE store_id = $1::uuid AND acao = ANY($2::text[]) AND NOT sucesso AND created_at > now() - interval '6 hours'", [storeId, [ACAO_OCULTAR, ACAO_EXIBIR]])).map((r) => r.id));
  const ocultar = plano.ocultar.filter((c) => !recusadas.has(c.id));
  const fila = [
    ...plano.exibir.filter((c) => !recusadas.has(c.id)).map((c) => ({ c, para: "visible" as const })),
    ...ocultar.slice(0, max).map((c) => ({ c, para: "hidden" as const })),
  ];
  out.restantes = Math.max(0, ocultar.length - max);

  for (const { c, para } of fila) {
    const de = para === "hidden" ? "visible" : "hidden";
    const id = Number(c.id);
    try {
      const atual = await api.getCategory(id);
      if (visibilidadeDe(atual) !== de) {
        // a loja já está como queremos (ou mudou por fora): só alinha o espelho
        await upsertCategories(db, storeId, [atual]);
        if (para === "visible") await db.query("DELETE FROM auto_hidden_categories WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
        continue;
      }
      if (para === "hidden") {
        // marca antes de ocultar: se algo falhar no meio, nunca fica uma categoria oculta que a regra não saiba que é dela
        await db.query("INSERT INTO auto_hidden_categories (store_id, category_id) VALUES ($1::uuid, $2::bigint) ON CONFLICT (store_id, category_id) DO UPDATE SET hidden_at = now()", [storeId, id]);
      }
      const depois = await api.setVisibility(id, para);
      if (visibilidadeDe(depois) !== para) throw new Error("a loja não aplicou a mudança de visibilidade da categoria");
      await upsertCategories(db, storeId, [depois]);
      if (para === "visible") await db.query("DELETE FROM auto_hidden_categories WHERE store_id = $1::uuid AND category_id = $2::bigint", [storeId, id]);
      await auditar(db, storeId, ator, para === "hidden" ? ACAO_OCULTAR : ACAO_EXIBIR, { id: c.id, nome: pt(depois.name) || c.nome }, de, para, true, { status: "ok" });
      if (para === "hidden") out.ocultadas++;
      else out.exibidas++;
    } catch (err) {
      if (para === "hidden") await db.query("DELETE FROM auto_hidden_categories WHERE store_id = $1::uuid AND category_id = $2::bigint AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.store_id = $1::uuid AND c.id = $2::bigint AND coalesce(c.raw_json->>'visibility','visible') = 'hidden')", [storeId, id]).catch(() => undefined);
      const mensagem = mensagemDe(err);
      out.falhas.push({ id: c.id, categoria: c.nome, mensagem });
      await auditar(db, storeId, ator, para === "hidden" ? ACAO_OCULTAR : ACAO_EXIBIR, c, de, para, false, err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break; // sem permissão: não adianta insistir
    }
  }
  return out;
}

export interface AcaoCategoria {
  id: string;
  acao: string;
  created_at: string;
  categoria: string;
  sucesso: boolean;
  mensagem: string | null;
}

export async function ultimasAcoesCategorias(db: Db, storeId: string, limite = 15): Promise<AcaoCategoria[]> {
  return db.query<AcaoCategoria>(
    `SELECT id::text, acao, created_at::text, coalesce(depois->>'nome', entidade_id) AS categoria, sucesso, resultado_api->>'mensagem' AS mensagem
     FROM audit_log WHERE store_id = $1::uuid AND acao = ANY($2::text[]) ORDER BY id DESC LIMIT $3`,
    [storeId, [ACAO_OCULTAR, ACAO_EXIBIR], limite],
  );
}
