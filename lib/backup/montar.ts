import { csv } from "./csv";
import { montarZip, type ArquivoZip } from "./zip";
import { gerarXlsx } from "@/lib/export/xlsx";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { Db } from "@/lib/sync/repo";

export interface OpcoesBackup {
  /** Inclui nome, e-mail, telefone e cidade dos clientes (dados pessoais). Desligado por padrão. */
  incluirClientes: boolean;
}

export interface ResumoBackup {
  produtos: number;
  variacoes: number;
  categorias: number;
  pedidos: number;
  clientes: number | null;
  custos: number;
  blocos: number;
  pedidosDeCompra: number;
  arquivos: number;
  bytes: number;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const consulta = async <T>(db: Db, sql: string, params: unknown[]): Promise<T[]> => db.query<T>(sql, params);

/** Reúne tudo o que o painel guarda da loja num ZIP: dados completos em JSON (para recuperar), planilhas para ler e um LEIAME. Só lê o banco; não chama a Nuvemshop. */
export async function montarBackup(db: Db, args: { storeId: string; nomeDaLoja: string | null; opcoes: OpcoesBackup; agora?: Date }): Promise<{ zip: Buffer; resumo: ResumoBackup; nomeSugerido: string }> {
  const { storeId, opcoes } = args;
  const agora = args.agora ?? new Date();
  const arquivos: ArquivoZip[] = [];

  const produtos = await consulta<{ id: string; name: string; published: boolean; raw_json: unknown; synced_at: string }>(db, "SELECT id::text, name, published, raw_json, synced_at::text FROM products WHERE store_id = $1::uuid ORDER BY id", [storeId]);
  const variacoes = await consulta<{ id: string; product_id: string; sku: string | null; price: string | null; promotional_price: string | null; stock: number | null; stock_management: boolean; values: I18n[] | null; raw_json: unknown }>(
    db, "SELECT id::text, product_id::text, sku, price::text, promotional_price::text, stock, stock_management, values, raw_json FROM variants WHERE store_id = $1::uuid ORDER BY product_id, position NULLS LAST, id", [storeId]);
  const categorias = await consulta<{ id: string; raw_json: unknown }>(db, "SELECT id::text, raw_json FROM categories WHERE store_id = $1::uuid ORDER BY id", [storeId]);
  const custos = await consulta<{ product_id: string; nome: string | null; cost: string; source: string }>(db, "SELECT c.product_id::text, p.name AS nome, c.cost::text, c.source FROM product_costs c LEFT JOIN products p ON p.store_id = c.store_id AND p.id = c.product_id WHERE c.store_id = $1::uuid ORDER BY c.product_id", [storeId]);
  const blocos = await consulta<{ name: string; html: string; updated_at: string }>(db, "SELECT name, html, updated_at::text FROM content_blocks WHERE store_id = $1::uuid ORDER BY lower(name)", [storeId]);
  const compras = await consulta<{ id: string; supplier: string; expected_on: string | null; note: string | null; status: string; created_at: string }>(db, "SELECT id::text, supplier, expected_on::text, note, status, created_at::text FROM purchase_orders WHERE store_id = $1::uuid ORDER BY id", [storeId]);
  const itensCompra = await consulta<{ order_id: string; seq: number; product_id: string; variant_id: string; product_name: string; variation: string; sku: string | null; qty: number; unit_cost: string | null }>(
    db, "SELECT i.order_id::text, i.seq, i.product_id::text, i.variant_id::text, i.product_name, i.variation, i.sku, i.qty, i.unit_cost::text FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.order_id WHERE p.store_id = $1::uuid ORDER BY i.order_id, i.seq", [storeId]);
  const pedidos = await consulta<{ id: string; number: number | null; created_at_remote: string; total: string; discount: string; status: string | null; payment_status: string | null; shipping_status: string | null; customer_id: string | null }>(
    db, "SELECT id::text, number, created_at_remote::text, total::text, discount::text, status, payment_status, shipping_status, customer_id::text FROM orders WHERE store_id = $1::uuid ORDER BY created_at_remote, id", [storeId]);
  const itensPedido = await consulta<{ order_id: string; product_id: string | null; variant_id: string | null; name: string | null; quantity: number; unit_price: string }>(
    db, "SELECT order_id::text, product_id::text, variant_id::text, name, quantity, unit_price::text FROM order_items WHERE store_id = $1::uuid ORDER BY order_id, seq", [storeId]);

  const configuracoes = {
    custos: (await consulta(db, "SELECT min_margin::text AS margem_minima FROM cost_settings WHERE store_id = $1::uuid", [storeId]))[0] ?? null,
    cashback: (await consulta(db, "SELECT percent::text, min_order::text, min_purchase::text, max_value::text, valid_days, wait_days, month_budget::text FROM cashback_settings WHERE store_id = $1::uuid", [storeId]))[0] ?? null,
    selos: (await consulta(db, "SELECT enabled, low_stock_enabled, low_stock_max, countdown_enabled, whatsapp_enabled, whatsapp_message FROM badge_settings WHERE store_id = $1::uuid", [storeId]))[0] ?? null,
  };

  // --- dados completos (para recuperar) ---
  const porProduto = new Map<string, unknown[]>();
  for (const v of variacoes) porProduto.set(v.product_id, [...(porProduto.get(v.product_id) ?? []), v.raw_json]);
  arquivos.push({ nome: "dados/produtos.json", conteudo: json(produtos.map((p) => ({ ...(p.raw_json as object), variants: porProduto.get(p.id) ?? (p.raw_json as { variants?: unknown }).variants ?? [] }))) });
  arquivos.push({ nome: "dados/categorias.json", conteudo: json(categorias.map((c) => c.raw_json)) });
  arquivos.push({ nome: "dados/custos-dos-produtos.json", conteudo: json(custos.map((c) => ({ produto_id: c.product_id, produto: c.nome, custo: Number(c.cost), origem: c.source }))) });
  arquivos.push({ nome: "dados/blocos-de-conteudo.json", conteudo: json(blocos) });
  arquivos.push({ nome: "dados/pedidos-de-compra.json", conteudo: json(compras.map((c) => ({ ...c, itens: itensCompra.filter((i) => i.order_id === c.id) }))) });
  arquivos.push({ nome: "dados/configuracoes.json", conteudo: json(configuracoes) });

  // --- planilhas para ler ---
  const prodPorId = new Map(produtos.map((p) => [p.id, p]));
  const custoPorProduto = new Map(custos.map((c) => [c.product_id, Number(c.cost)]));
  const linhasCatalogo = variacoes.map((v) => {
    const p = prodPorId.get(v.product_id);
    const cats = ((p?.raw_json as { categories?: Array<{ name?: I18n }> } | undefined)?.categories ?? []).map((c) => pt(c.name)).filter(Boolean).join(", ");
    return { produtoId: v.product_id, produto: p?.name ?? "", publicado: p?.published ?? false, categorias: cats, varId: v.id, sku: v.sku, variacao: (Array.isArray(v.values) ? v.values : []).map((x) => pt(x)).filter(Boolean).join(" / "), preco: v.price === null ? null : Number(v.price), promo: v.promotional_price === null ? null : Number(v.promotional_price), estoque: v.stock_management ? v.stock : null, custo: custoPorProduto.get(v.product_id) ?? null };
  });
  arquivos.push({
    nome: "planilhas/catalogo.xlsx",
    conteudo: await gerarXlsx("Catálogo", [
      { titulo: "ID do produto", valor: (l) => l.produtoId, largura: 14 }, { titulo: "Produto", valor: (l) => l.produto, largura: 40 }, { titulo: "Publicado", valor: (l) => (l.publicado ? "Sim" : "Não"), largura: 10 },
      { titulo: "Categorias", valor: (l) => l.categorias, largura: 30 }, { titulo: "ID da variação", valor: (l) => l.varId, largura: 14 }, { titulo: "SKU", valor: (l) => l.sku, largura: 18 },
      { titulo: "Variação", valor: (l) => l.variacao, largura: 22 }, { titulo: "Preço", valor: (l) => l.preco, formato: "#,##0.00" }, { titulo: "Preço promocional", valor: (l) => l.promo, formato: "#,##0.00" },
      { titulo: "Estoque", valor: (l) => l.estoque, largura: 10 }, { titulo: "Custo do produto", valor: (l) => l.custo, formato: "#,##0.00" },
    ], linhasCatalogo),
  });
  arquivos.push({ nome: "planilhas/pedidos.csv", conteudo: csv(["ID", "Número", "Data", "Total", "Desconto", "Situação", "Pagamento", "Envio", "ID do cliente"], pedidos.map((p) => [p.id, p.number, p.created_at_remote, Number(p.total), Number(p.discount), p.status, p.payment_status, p.shipping_status, p.customer_id])) });
  arquivos.push({ nome: "planilhas/itens-dos-pedidos.csv", conteudo: csv(["ID do pedido", "ID do produto", "ID da variação", "Produto", "Quantidade", "Preço unitário"], itensPedido.map((i) => [i.order_id, i.product_id, i.variant_id, i.name, i.quantity, Number(i.unit_price)])) });
  arquivos.push({ nome: "planilhas/custos.csv", conteudo: csv(["ID do produto", "Produto", "Custo", "Origem"], custos.map((c) => [c.product_id, c.nome, Number(c.cost), c.source])) });

  let clientes: number | null = null;
  if (opcoes.incluirClientes) {
    const cl = await consulta<{ id: string; name: string; email: string | null; phone: string | null; city: string | null; state: string | null; total_spent: string; accepts_marketing: boolean | null }>(
      db, "SELECT id::text, name, email, phone, city, state, total_spent::text, accepts_marketing FROM customers WHERE store_id = $1::uuid ORDER BY id", [storeId]);
    clientes = cl.length;
    arquivos.push({ nome: "planilhas/clientes.csv", conteudo: csv(["ID", "Nome", "E-mail", "Telefone", "Cidade", "UF", "Total gasto", "Aceita marketing"], cl.map((c) => [c.id, c.name, c.email, c.phone, c.city, c.state, Number(c.total_spent), c.accepts_marketing === null ? "" : c.accepts_marketing ? "Sim" : "Não"])) });
  }

  const resumoSemZip = { produtos: produtos.length, variacoes: variacoes.length, categorias: categorias.length, pedidos: pedidos.length, clientes, custos: custos.length, blocos: blocos.length, pedidosDeCompra: compras.length };
  arquivos.unshift({ nome: "LEIAME.txt", conteudo: leiame({ nome: args.nomeDaLoja, agora, resumo: resumoSemZip, incluirClientes: opcoes.incluirClientes }) });
  const zip = montarZip(arquivos, agora);
  const dia = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return { zip, resumo: { ...resumoSemZip, arquivos: arquivos.length, bytes: zip.length }, nomeSugerido: `backup-inuvem-${dia}.zip` };
}

function leiame(a: { nome: string | null; agora: Date; resumo: Omit<ResumoBackup, "arquivos" | "bytes">; incluirClientes: boolean }): string {
  const r = a.resumo;
  return [
    `BACKUP DO PAINEL INUVEM${a.nome ? ` — ${a.nome}` : ""}`,
    `Gerado em ${a.agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de Brasília).`,
    "",
    "O que é: uma cópia dos dados da loja como o painel os tinha na última sincronização, mais o que só existe no painel (custos, blocos de conteúdo, pedidos de compra, configurações).",
    "O que NÃO é: um backup da própria Nuvemshop. Ele não restaura a loja sozinho; serve para consultar, comparar e recuperar dados à mão (ou com ajuda). Imagens (arquivos de foto) não estão incluídas, só os endereços delas dentro de dados/produtos.json.",
    "",
    `Conteúdo: ${r.produtos} produtos, ${r.variacoes} variações, ${r.categorias} categorias, ${r.custos} custos, ${r.blocos} blocos de conteúdo, ${r.pedidosDeCompra} pedidos de compra, ${r.pedidos} pedidos${r.clientes !== null ? `, ${r.clientes} clientes` : ""}.`,
    "",
    "dados/        arquivos completos em JSON (produtos com variações, categorias, custos, blocos, pedidos de compra, configurações).",
    "planilhas/    o mesmo em planilhas para abrir no Excel (CSV com ponto e vírgula; catálogo em .xlsx).",
    "",
    "Pedidos: só números e situação, sem nome, e-mail, telefone nem endereço de quem comprou (só o ID do cliente).",
    a.incluirClientes
      ? "ATENÇÃO — planilhas/clientes.csv tem DADOS PESSOAIS (nome, e-mail, telefone, cidade). Guarde em local protegido, não envie por e-mail nem compartilhe, e apague quando não precisar mais (LGPD)."
      : "Dados pessoais de clientes NÃO foram incluídos neste backup.",
    "",
    "Guarde uma cópia fora do computador (por exemplo, no Google Drive) e gere outra de tempos em tempos.",
    "",
  ].join("\r\n");
}
