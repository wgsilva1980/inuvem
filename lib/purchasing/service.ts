import { edicaoDaVariante, updateVariant, VariantConflictError, type VariantApi } from "@/lib/catalog/update-variant";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";
import { obterPedido, type PedidoCompra } from "./repo";
import type { PedidoEntrada } from "./rules";

export class CompraError extends Error {}

async function auditar(db: Db, e: { storeId: string; actor: string; acao: string; id: string; depois: unknown; sucesso?: boolean }) {
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, $3, 'compra', $4, $5::jsonb, $6)`, [e.storeId, e.actor, e.acao, e.id, JSON.stringify(e.depois), e.sucesso ?? true]);
}

/** Cria o pedido de compra. As variações precisam existir no espelho e ter controle de estoque; o nome e o custo ficam gravados no pedido. */
export async function criarPedidoDeCompra(db: Db, args: { storeId: string; actor: string; pedido: PedidoEntrada }): Promise<PedidoCompra> {
  const { storeId, actor, pedido } = args;
  const ids = pedido.itens.map((i) => i.variantId);
  const rows = await db.query<{ variant_id: string; product_id: string; produto: string; sku: string | null; valores: I18n[] | null; stock_management: boolean; cost: string | null }>(
    `SELECT v.id::text AS variant_id, v.product_id::text AS product_id, p.name AS produto, v.sku, v.values AS valores, v.stock_management, c.cost::text AS cost
     FROM variants v JOIN products p ON p.store_id = v.store_id AND p.id = v.product_id
     LEFT JOIN product_costs c ON c.store_id = v.store_id AND c.product_id = v.product_id
     WHERE v.store_id = $1::uuid AND v.id::text = ANY($2::text[])`,
    [storeId, ids],
  );
  const porId = new Map(rows.map((r) => [r.variant_id, r]));
  const faltam = ids.filter((id) => !porId.has(id));
  if (faltam.length > 0) throw new CompraError("Alguma variação do pedido não existe mais no catálogo. Atualize a página e escolha de novo.");
  const semControle = rows.filter((r) => !r.stock_management);
  if (semControle.length > 0) throw new CompraError(`${semControle[0]!.produto} não tem controle de estoque; o painel só compra o que controla estoque.`);

  const linhas = pedido.itens.map((i, n) => {
    const r = porId.get(i.variantId)!;
    return { seq: n + 1, product_id: r.product_id, variant_id: r.variant_id, product_name: r.produto, variation: (Array.isArray(r.valores) ? r.valores : []).map((x) => pt(x)).filter(Boolean).join(" / ") || "Padrão", sku: r.sku, qty: i.qty, unit_cost: r.cost };
  });
  const [novo] = await db.query<{ id: string }>(
    "INSERT INTO purchase_orders (store_id, supplier, expected_on, note, created_by) VALUES ($1::uuid, $2, $3::date, $4, $5) RETURNING id::text",
    [storeId, pedido.supplier, pedido.expectedOn, pedido.note, actor],
  );
  try {
    await db.query(
      `INSERT INTO purchase_order_items (order_id, seq, product_id, variant_id, product_name, variation, sku, qty, unit_cost)
       SELECT $1::bigint, x.seq, x.product_id, x.variant_id, x.product_name, x.variation, x.sku, x.qty, x.unit_cost
       FROM jsonb_to_recordset($2::jsonb) AS x(seq int, product_id bigint, variant_id bigint, product_name text, variation text, sku text, qty int, unit_cost numeric)`,
      [novo!.id, JSON.stringify(linhas)],
    );
  } catch (err) {
    await db.query("DELETE FROM purchase_orders WHERE id = $1::bigint", [novo!.id]);
    throw err;
  }
  const criado = (await obterPedido(db, storeId, novo!.id))!;
  await auditar(db, { storeId, actor, acao: "compra.criar", id: criado.id, depois: { fornecedor: pedido.supplier, itens: criado.itens.length, unidades: criado.itens.reduce((s, i) => s + i.qty, 0), previsto: pedido.expectedOn, total: criado.total } });
  return criado;
}

/** Cancela um pedido aberto. Se parte dele já foi somada ao estoque da loja, não cancela (o estoque já mudou). */
export async function cancelarPedidoDeCompra(db: Db, args: { storeId: string; actor: string; id: string }): Promise<void> {
  const p = await obterPedido(db, args.storeId, args.id);
  if (!p) throw new CompraError("Pedido não encontrado.");
  if (p.status !== "aberto") throw new CompraError("Só dá para cancelar um pedido aberto.");
  if (p.itens.some((i) => i.recebido)) throw new CompraError("Parte deste pedido já foi somada ao estoque da loja; conclua o recebimento em vez de cancelar.");
  const r = await db.query<{ id: string }>("UPDATE purchase_orders SET status = 'cancelado', closed_at = now(), closed_by = $3 WHERE store_id = $1::uuid AND id = $2::bigint AND status = 'aberto' RETURNING id::text", [args.storeId, args.id, args.actor]);
  if (r.length === 0) throw new CompraError("Este pedido acabou de mudar de situação. Atualize a página.");
  await auditar(db, { storeId: args.storeId, actor: args.actor, acao: "compra.cancelar", id: args.id, depois: { fornecedor: p.fornecedor, itens: p.itens.length } });
}

export interface ResultadoRecebimento {
  status: "recebido" | "parcial";
  somados: number;
  pendentes: number;
  erros: string[];
  /** Acabou o tempo do passo: chame de novo para continuar. */
  continua: boolean;
}

async function somarNaLoja(db: Db, api: VariantApi, args: { storeId: string; actor: string; productId: number; variantId: number; qty: number }): Promise<void> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const antes = await edicaoDaVariante(db, args.storeId, args.productId, args.variantId);
    if (!antes) throw new CompraError("variação não encontrada no catálogo (sincronize)");
    if (!antes.stock_management) throw new CompraError("a variação não tem mais controle de estoque");
    try {
      await updateVariant(db, api, { storeId: args.storeId, actor: args.actor, productId: args.productId, variantId: args.variantId, after: { ...antes, stock: (antes.stock ?? 0) + args.qty } });
      return;
    } catch (err) {
      // alterada por fora: o espelho foi atualizado, então uma segunda tentativa soma sobre o estoque certo
      if (err instanceof VariantConflictError && tentativa === 0) continue;
      throw err;
    }
  }
}

/**
 * Recebe o pedido. Com `somarEstoque`, soma cada linha ao estoque da loja (confere alteração por fora, grava no Histórico e atualiza o espelho);
 * cada linha é "reservada" antes de enviar, então duas chamadas ao mesmo tempo nunca somam duas vezes. Linhas que falham ficam pendentes e podem ser
 * tentadas de novo; o pedido só fecha quando todas entraram. Sem `somarEstoque`, apenas fecha o pedido (o estoque foi lançado por outro caminho).
 */
export async function receberPedidoDeCompra(
  db: Db,
  api: VariantApi,
  args: { storeId: string; actor: string; id: string; somarEstoque: boolean; budgetMs?: number; agora?: () => number },
): Promise<ResultadoRecebimento> {
  const { storeId, actor, id } = args;
  const agora = args.agora ?? Date.now;
  const limite = agora() + (args.budgetMs ?? 45_000);
  const p = await obterPedido(db, storeId, id);
  if (!p) throw new CompraError("Pedido não encontrado.");
  if (p.status !== "aberto") throw new CompraError("Este pedido já foi fechado.");

  if (!args.somarEstoque) {
    const r = await db.query<{ id: string }>("UPDATE purchase_orders SET status = 'recebido', stock_updated = false, closed_at = now(), closed_by = $3 WHERE store_id = $1::uuid AND id = $2::bigint AND status = 'aberto' RETURNING id::text", [storeId, id, actor]);
    if (r.length === 0) throw new CompraError("Este pedido acabou de mudar de situação. Atualize a página.");
    await auditar(db, { storeId, actor, acao: "compra.receber", id, depois: { fornecedor: p.fornecedor, itens: p.itens.length, estoqueSomado: false } });
    return { status: "recebido", somados: 0, pendentes: 0, erros: [], continua: false };
  }

  let somados = 0;
  const erros: string[] = [];
  let continua = false;
  for (const item of p.itens) {
    if (item.recebido) continue;
    if (agora() >= limite) {
      continua = true;
      break;
    }
    const reservou = await db.query<{ seq: number }>("UPDATE purchase_order_items SET received_at = now() WHERE order_id = $1::bigint AND seq = $2 AND received_at IS NULL RETURNING seq", [id, item.seq]);
    if (reservou.length === 0) continue; // outra chamada já cuidou desta linha
    try {
      await somarNaLoja(db, api, { storeId, actor, productId: Number(item.productId), variantId: Number(item.variantId), qty: item.qty });
      somados++;
    } catch (err) {
      await db.query("UPDATE purchase_order_items SET received_at = NULL WHERE order_id = $1::bigint AND seq = $2", [id, item.seq]);
      erros.push(`${item.produto} (${item.variacao}): ${err instanceof Error ? err.message : "falha ao somar o estoque"}`);
    }
  }
  const [resta] = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM purchase_order_items WHERE order_id = $1::bigint AND received_at IS NULL", [id]);
  const pendentes = Number(resta?.n ?? 0);
  if (pendentes === 0) {
    await db.query("UPDATE purchase_orders SET status = 'recebido', stock_updated = true, closed_at = now(), closed_by = $3 WHERE store_id = $1::uuid AND id = $2::bigint AND status = 'aberto'", [storeId, id, actor]);
  }
  await auditar(db, { storeId, actor, acao: "compra.receber", id, sucesso: erros.length === 0, depois: { fornecedor: p.fornecedor, somados, pendentes, falhas: erros.length, estoqueSomado: true } });
  return { status: pendentes === 0 ? "recebido" : "parcial", somados, pendentes, erros, continua };
}
