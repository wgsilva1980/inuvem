import type { Db } from "@/lib/sync/repo";

/** Situações de envio da loja que significam "já saiu". O resto (não embalado, embalado) ainda precisa ser enviado. */
export const JA_ENVIADO = ["shipped", "delivered", "fulfilled"] as const;

/** Pedido na fila de expedição: pago, aberto (não cancelado nem arquivado) e ainda não enviado. */
export const SQL_A_ENVIAR = `(o.payment_status = 'paid' AND coalesce(o.status, 'open') = 'open' AND coalesce(o.shipping_status, '') NOT IN ('shipped', 'delivered', 'fulfilled'))`;

export interface ItemDoPedido {
  product_id: string | null;
  nome: string;
  variacao: string;
  sku: string | null;
  quantidade: number;
  foto: string | null;
}

export interface PedidoParaEnviar {
  id: string;
  numero: number | null;
  criadoEm: string;
  /** Dias inteiros desde a criação do pedido. */
  diasParado: number;
  atrasado: boolean;
  total: number;
  situacaoEnvio: string | null;
  rastreio: string | null;
  itens: ItemDoPedido[];
  unidades: number;
}

interface Linha {
  id: string;
  numero: number | null;
  criado_em: string;
  dias: string;
  total: string;
  situacao_envio: string | null;
  rastreio: string | null;
  itens: Array<{ product_id: string | null; nome: string | null; valores: string[] | null; sku: string | null; quantidade: number; foto: string | null }> | null;
}

/**
 * Fila de expedição, do pedido mais antigo para o mais novo, com as peças de cada um (nome, variação, SKU e foto). `atrasoDias` = a partir de quantos
 * dias sem enviar o pedido conta como atrasado. Só lê o espelho dos pedidos.
 */
export async function filaDeExpedicao(db: Db, storeId: string, atrasoDias: number, ids?: string[]): Promise<PedidoParaEnviar[]> {
  const rows = await db.query<Linha>(
    `SELECT o.id::text AS id, o.number AS numero, o.created_at_remote::text AS criado_em,
            floor(extract(epoch FROM now() - o.created_at_remote) / 86400)::text AS dias,
            o.total::text AS total, o.shipping_status AS situacao_envio, o.tracking_code AS rastreio,
            (SELECT jsonb_agg(jsonb_build_object(
                'product_id', i.product_id::text, 'nome', coalesce(p.name, i.name), 'valores', i.variant_values,
                'sku', v.sku, 'quantidade', i.quantity, 'foto', p.raw_json->'images'->0->>'src') ORDER BY i.seq)
             FROM order_items i
             LEFT JOIN products p ON p.store_id = i.store_id AND p.id = i.product_id
             LEFT JOIN variants v ON v.store_id = i.store_id AND v.id = i.variant_id
             WHERE i.store_id = o.store_id AND i.order_id = o.id) AS itens
     FROM orders o
     WHERE o.store_id = $1::uuid AND ${SQL_A_ENVIAR} AND ($2::text[] IS NULL OR o.id::text = ANY($2::text[]))
     ORDER BY o.created_at_remote, o.id`,
    [storeId, ids ?? null],
  );
  return rows.map((r) => {
    const itens = (r.itens ?? []).map((i): ItemDoPedido => ({
      product_id: i.product_id,
      nome: i.nome ?? "Produto",
      variacao: (i.valores ?? []).join(" / "),
      sku: i.sku,
      quantidade: i.quantidade,
      foto: i.foto,
    }));
    const dias = Number(r.dias);
    return {
      id: r.id,
      numero: r.numero,
      criadoEm: r.criado_em,
      diasParado: dias,
      atrasado: dias >= atrasoDias,
      total: Number(r.total),
      situacaoEnvio: r.situacao_envio,
      rastreio: r.rastreio,
      itens,
      unidades: itens.reduce((s, i) => s + i.quantidade, 0),
    };
  });
}

export interface LinhaSeparacao {
  chave: string;
  nome: string;
  variacao: string;
  sku: string | null;
  foto: string | null;
  quantidade: number;
  /** Números dos pedidos que levam esta peça. */
  pedidos: Array<number | null>;
}

/** Lista de separação: as mesmas peças de vários pedidos somadas, em ordem alfabética (produto e variação), com os pedidos de cada uma. */
export function listaDeSeparacao(pedidos: PedidoParaEnviar[]): LinhaSeparacao[] {
  const mapa = new Map<string, LinhaSeparacao>();
  for (const p of pedidos) {
    for (const i of p.itens) {
      const chave = `${i.product_id ?? i.nome}|${i.variacao}|${i.sku ?? ""}`;
      const l = mapa.get(chave) ?? { chave, nome: i.nome, variacao: i.variacao, sku: i.sku, foto: i.foto, quantidade: 0, pedidos: [] };
      l.quantidade += i.quantidade;
      if (!l.pedidos.includes(p.numero)) l.pedidos.push(p.numero);
      if (!l.foto && i.foto) l.foto = i.foto;
      mapa.set(chave, l);
    }
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.variacao.localeCompare(b.variacao, "pt-BR", { numeric: true }));
}

export interface EntradaRastreio {
  numero: number;
  codigo: string;
}

export interface LeituraRastreio {
  validos: EntradaRastreio[];
  /** Linhas que não deu para entender ou que repetem um pedido, com o motivo. */
  problemas: Array<{ linha: string; motivo: string }>;
}

const CODIGO = /^[A-Z0-9][A-Z0-9._-]{4,39}$/;

/**
 * Lê o texto colado (uma linha por pedido: "número;código", "número código", "número<TAB>código" ou "número,código"), aceitando "#1234".
 * O código é guardado em maiúsculas e sem espaços. Pedido repetido com códigos diferentes vira problema (não se adivinha qual vale).
 */
export function lerRastreios(texto: string): LeituraRastreio {
  const validos: EntradaRastreio[] = [];
  const problemas: LeituraRastreio["problemas"] = [];
  const vistos = new Map<number, string>();
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (linha === "") continue;
    const partes = linha.split(/[;\t,]|\s+/).map((x) => x.trim()).filter(Boolean);
    if (partes.length !== 2) {
      problemas.push({ linha, motivo: "use “número do pedido” e “código de rastreio” na mesma linha" });
      continue;
    }
    const numero = Number(partes[0]!.replace(/^#/, ""));
    const codigo = partes[1]!.toUpperCase();
    if (!Number.isInteger(numero) || numero <= 0) {
      problemas.push({ linha, motivo: "número do pedido inválido" });
      continue;
    }
    if (!CODIGO.test(codigo)) {
      problemas.push({ linha, motivo: "código de rastreio inválido (5 a 40 letras e números)" });
      continue;
    }
    const anterior = vistos.get(numero);
    if (anterior !== undefined) {
      if (anterior !== codigo) problemas.push({ linha, motivo: `o pedido ${numero} aparece com dois códigos diferentes` });
      continue;
    }
    vistos.set(numero, codigo);
    validos.push({ numero, codigo });
  }
  // pedido que apareceu com dois códigos diferentes não vale nenhum dos dois
  const conflitantes = new Set(problemas.filter((p) => p.motivo.includes("dois códigos")).map((p) => Number(p.motivo.match(/\d+/)![0])));
  return { validos: validos.filter((v) => !conflitantes.has(v.numero)), problemas };
}
