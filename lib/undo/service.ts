import { changedFields, toEdit, type ProductEdit } from "@/lib/catalog/edit";
import { getProductDetail } from "@/lib/catalog/query";
import { updateProduct, type ProductApi } from "@/lib/catalog/update";
import { edicaoDaVariante, updateVariant, type VariantApi } from "@/lib/catalog/update-variant";
import { changedVariantFields, type VariantEdit } from "@/lib/catalog/variants";
import { updateCategory, type CategoryApi } from "@/lib/categories/manage";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";
import { DIAS_PARA_DESFAZER, ACOES_DESFAZIVEIS, descreverMudancas, ehDesfazivel, temAntesEDepois, type AcaoDesfazivel, type Mudanca, type Rec } from "./descrever";

export class DesfazerError extends Error {}

export interface DesfazerApis {
  produto: ProductApi;
  variante: VariantApi;
  categoria: CategoryApi;
}

interface LinhaAuditoria {
  id: string;
  acao: string;
  entidade_id: string | null;
  antes: unknown;
  depois: unknown;
  sucesso: boolean;
  created_at: string;
  actor_email: string;
}

export interface EventoDesfazivel {
  id: string;
  acao: AcaoDesfazivel;
  entidadeId: string;
  antes: Rec;
  depois: Rec;
  criadoEm: string;
  ator: string;
}

export type EstadoEvento = "ok" | "mudou" | "sem_item";

function comoEvento(l: LinhaAuditoria): EventoDesfazivel | null {
  if (!l.sucesso || !ehDesfazivel(l.acao) || !l.entidade_id || !/^\d{1,15}$/.test(l.entidade_id) || !temAntesEDepois(l.antes, l.depois)) return null;
  return { id: l.id, acao: l.acao, entidadeId: l.entidade_id, antes: l.antes as Rec, depois: l.depois as Rec, criadoEm: l.created_at, ator: l.actor_email };
}

const mesclado = <T extends object>(atual: T, valores: Rec): T => ({ ...atual, ...valores });

/** O item ainda está como o registro o deixou (nos campos que ele alterou)? Se mudou depois, desfazer passaria por cima da alteração mais recente. */
export async function estadoDoEvento(db: Db, storeId: string, ev: EventoDesfazivel): Promise<EstadoEvento> {
  if (ev.acao === "produto.atualizar") {
    const d = await getProductDetail(db, storeId, Number(ev.entidadeId));
    if (!d) return "sem_item";
    const atual = toEdit(d);
    return changedFields(atual, mesclado(atual, ev.depois) as ProductEdit).length === 0 ? "ok" : "mudou";
  }
  if (ev.acao === "variante.atualizar") {
    const [v] = await db.query<{ product_id: string }>("SELECT product_id::text FROM variants WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, ev.entidadeId]);
    if (!v) return "sem_item";
    const atual = await edicaoDaVariante(db, storeId, Number(v.product_id), Number(ev.entidadeId));
    if (!atual) return "sem_item";
    return changedVariantFields(atual, mesclado(atual, ev.depois) as VariantEdit).length === 0 ? "ok" : "mudou";
  }
  const [c] = await db.query<{ name: string; parent_id: string | null }>("SELECT name, parent_id::text FROM categories WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, ev.entidadeId]);
  if (!c) return "sem_item";
  const atual: Rec = { name: c.name, parent: c.parent_id === null ? null : Number(c.parent_id) };
  return Object.keys(ev.depois).every((k) => (atual[k] ?? null) === (ev.depois[k] ?? null)) ? "ok" : "mudou";
}

export interface ItemDesfazer {
  id: string;
  acao: AcaoDesfazivel;
  criadoEm: string;
  ator: string;
  nome: string;
  link: string | null;
  mudancas: Mudanca[];
  estado: EstadoEvento;
}

/** Alterações recentes que dá para desfazer (ainda não desfeitas), da mais nova para a mais antiga, com o estado atual de cada item. */
export async function listarDesfaziveis(db: Db, storeId: string, opts: { dias?: number; limite?: number } = {}): Promise<ItemDesfazer[]> {
  const dias = opts.dias ?? 30;
  const limite = opts.limite ?? 40;
  const linhas = await db.query<LinhaAuditoria>(
    `SELECT a.id::text, a.acao, a.entidade_id, a.antes, a.depois, a.sucesso, a.created_at::text, a.actor_email
     FROM audit_log a LEFT JOIN undo_marks m ON m.audit_id = a.id
     WHERE a.store_id = $1::uuid AND a.sucesso AND a.acao = ANY($2::text[]) AND a.created_at >= now() - make_interval(days => $3::int) AND m.audit_id IS NULL
     ORDER BY a.id DESC LIMIT 200`,
    [storeId, ACOES_DESFAZIVEIS, dias],
  );
  const eventos = linhas.map(comoEvento).filter((e): e is EventoDesfazivel => e !== null).slice(0, limite);
  if (eventos.length === 0) return [];

  const ids = (acao: AcaoDesfazivel) => eventos.filter((e) => e.acao === acao).map((e) => e.entidadeId);
  const produtos = new Map((await db.query<{ id: string; name: string }>("SELECT id::text, name FROM products WHERE store_id = $1::uuid AND id::text = ANY($2::text[])", [storeId, ids("produto.atualizar")])).map((r) => [r.id, r.name]));
  const variantes = new Map(
    (await db.query<{ id: string; product_id: string; name: string; values: I18n[] | null }>(
      "SELECT v.id::text, v.product_id::text, p.name, v.values FROM variants v JOIN products p ON p.store_id = v.store_id AND p.id = v.product_id WHERE v.store_id = $1::uuid AND v.id::text = ANY($2::text[])",
      [storeId, ids("variante.atualizar")],
    )).map((r) => [r.id, r]),
  );
  const categorias = await db.query<{ id: string; name: string }>("SELECT id::text, name FROM categories WHERE store_id = $1::uuid", [storeId]);
  const nomesCategoria = new Map(categorias.map((c) => [Number(c.id), c.name]));

  const out: ItemDesfazer[] = [];
  for (const ev of eventos) {
    let nome: string;
    let link: string | null = null;
    if (ev.acao === "produto.atualizar") {
      nome = produtos.get(ev.entidadeId) ?? `Produto ${ev.entidadeId}`;
      link = produtos.has(ev.entidadeId) ? `/produtos/${ev.entidadeId}` : null;
    } else if (ev.acao === "variante.atualizar") {
      const v = variantes.get(ev.entidadeId);
      nome = v ? `${v.name} — ${(Array.isArray(v.values) ? v.values : []).map((x) => pt(x)).filter(Boolean).join(" / ") || "Padrão"}` : `Variação ${ev.entidadeId}`;
      link = v ? `/produtos/${v.product_id}` : null;
    } else {
      nome = nomesCategoria.get(Number(ev.entidadeId)) ?? `Categoria ${ev.entidadeId}`;
      link = null;
    }
    out.push({ id: ev.id, acao: ev.acao, criadoEm: ev.criadoEm, ator: ev.ator, nome, link, mudancas: descreverMudancas(ev.acao, ev.antes, ev.depois, nomesCategoria), estado: await estadoDoEvento(db, storeId, ev) });
  }
  return out;
}

/**
 * Desfaz um registro do Histórico: devolve os campos que ele alterou ao valor de antes. Confere antes que o item ainda está como o registro o deixou
 * (senão recusa, para não passar por cima de uma alteração mais nova) e que a loja não mudou por fora (a edição normal já faz essa conferência).
 * O registro é "reservado" antes de agir, então nunca é desfeito duas vezes; se a loja recusar, a reserva é desfeita e dá para tentar de novo.
 * A reversão é gravada no Histórico como uma edição comum (e portanto também pode ser desfeita, o que "refaz" a alteração).
 */
export async function desfazerEvento(db: Db, apis: DesfazerApis, args: { storeId: string; actor: string; id: string }): Promise<{ acao: AcaoDesfazivel; nome: string }> {
  const { storeId, actor, id } = args;
  const [linha] = await db.query<LinhaAuditoria>("SELECT id::text, acao, entidade_id, antes, depois, sucesso, created_at::text, actor_email FROM audit_log WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, id]);
  if (!linha) throw new DesfazerError("Registro não encontrado.");
  const ev = comoEvento(linha);
  if (!ev) throw new DesfazerError("Este registro não pode ser desfeito (falhou, não guardou o valor de antes ou é de um tipo que o painel não desfaz).");
  if (Date.now() - Date.parse(ev.criadoEm) > DIAS_PARA_DESFAZER * 86_400_000) throw new DesfazerError(`Só dá para desfazer alterações dos últimos ${DIAS_PARA_DESFAZER} dias.`);

  const reservou = await db.query<{ audit_id: string }>("INSERT INTO undo_marks (audit_id, store_id, undone_by) VALUES ($1::bigint, $2::uuid, $3) ON CONFLICT DO NOTHING RETURNING audit_id::text", [id, storeId, actor]);
  if (reservou.length === 0) throw new DesfazerError("Esta alteração já foi desfeita.");
  try {
    const estado = await estadoDoEvento(db, storeId, ev);
    if (estado === "sem_item") throw new DesfazerError("O item não existe mais.");
    if (estado === "mudou") throw new DesfazerError("Esse valor já foi alterado depois desta mudança. Para não passar por cima da alteração mais recente, desfaça primeiro a mais nova (ou edite o item à mão).");

    if (ev.acao === "produto.atualizar") {
      const d = (await getProductDetail(db, storeId, Number(ev.entidadeId)))!;
      await updateProduct(db, apis.produto, { storeId, actor, productId: Number(ev.entidadeId), after: mesclado(toEdit(d), ev.antes) as ProductEdit });
    } else if (ev.acao === "variante.atualizar") {
      const [v] = await db.query<{ product_id: string }>("SELECT product_id::text FROM variants WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, ev.entidadeId]);
      const atual = (await edicaoDaVariante(db, storeId, Number(v!.product_id), Number(ev.entidadeId)))!;
      await updateVariant(db, apis.variante, { storeId, actor, productId: Number(v!.product_id), variantId: Number(ev.entidadeId), after: mesclado(atual, ev.antes) as VariantEdit });
    } else {
      const nome = ev.antes.name;
      const pai = ev.antes.parent ?? null;
      if (typeof nome !== "string" || (pai !== null && typeof pai !== "number")) throw new DesfazerError("O registro não tem o nome ou a categoria pai de antes.");
      await updateCategory(db, apis.categoria, { storeId, actor, id: Number(ev.entidadeId), edit: { name: nome, parent: pai } });
    }
  } catch (err) {
    await db.query("DELETE FROM undo_marks WHERE audit_id = $1::bigint", [id]);
    throw err;
  }
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'desfazer.executar', $3, $4, $5::jsonb, true)`, [
    storeId, actor, ev.acao.split(".")[0], ev.entidadeId, JSON.stringify({ desfaz: id, acao: ev.acao, campos: Object.keys(ev.depois) }),
  ]);
  const itens = await listarNome(db, storeId, ev);
  return { acao: ev.acao, nome: itens };
}

async function listarNome(db: Db, storeId: string, ev: EventoDesfazivel): Promise<string> {
  if (ev.acao === "produto.atualizar") return (await db.query<{ name: string }>("SELECT name FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, ev.entidadeId]))[0]?.name ?? `Produto ${ev.entidadeId}`;
  if (ev.acao === "variante.atualizar") return (await db.query<{ name: string }>("SELECT p.name FROM variants v JOIN products p ON p.store_id = v.store_id AND p.id = v.product_id WHERE v.store_id = $1::uuid AND v.id = $2::bigint", [storeId, ev.entidadeId]))[0]?.name ?? `Variação ${ev.entidadeId}`;
  return (await db.query<{ name: string }>("SELECT name FROM categories WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, ev.entidadeId]))[0]?.name ?? `Categoria ${ev.entidadeId}`;
}
