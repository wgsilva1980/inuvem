import type { Db } from "@/lib/sync/repo";

/** Mínimo de letras para procurar produtos, categorias e clientes (com menos, a lista seria quase a loja toda). */
export const MIN_LETRAS = 2;
export const MAX_Q = 80;

export interface ResultadoProduto {
  id: string;
  nome: string;
  publicado: boolean;
  sku: string | null;
}
export interface ResultadoPedido {
  id: string;
  numero: number | null;
  criadoEm: string;
  total: number;
  pagamento: string | null;
  envio: string | null;
  /** Ainda precisa ser enviado: leva para a Expedição. */
  aEnviar: boolean;
}
export interface ResultadoCliente {
  id: string;
  nome: string;
  local: string | null;
}
export interface ResultadoCategoria {
  id: string;
  nome: string;
}
export interface ResultadoBusca {
  produtos: ResultadoProduto[];
  pedidos: ResultadoPedido[];
  clientes: ResultadoCliente[];
  categorias: ResultadoCategoria[];
}

const escapar = (s: string) => s.replace(/[%_\\]/g, "\\$&");

/** Número do pedido digitado (“1234” ou “#1234”), ou null. */
export const numeroDoPedido = (q: string): number | null => (/^#?\d{1,9}$/.test(q.trim()) ? Number(q.trim().replace("#", "")) : null);

/**
 * Procura em tudo que o painel já tem no banco (nada de chamadas à Nuvemshop): produtos por nome ou SKU, pedidos pelo número, clientes por nome ou
 * começo do e-mail e categorias por nome. O resultado de cliente traz só o nome e a cidade (o contato fica em Contatos); o de pedido, nenhum dado pessoal.
 */
export async function buscar(db: Db, storeId: string, textoBruto: string): Promise<ResultadoBusca> {
  const q = textoBruto.replace(/\s+/g, " ").trim().slice(0, MAX_Q);
  const vazio: ResultadoBusca = { produtos: [], pedidos: [], clientes: [], categorias: [] };
  const numero = numeroDoPedido(q);
  if (q.length < MIN_LETRAS && numero === null) return vazio;
  const like = `%${escapar(q)}%`;
  const comeco = `${escapar(q)}%`;

  const [produtos, pedidos, clientes, categorias] = await Promise.all([
    q.length < MIN_LETRAS
      ? []
      : db.query<{ id: string; name: string; published: boolean; sku: string | null }>(
          `SELECT p.id::text AS id, p.name, p.published,
                  (SELECT v.sku FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.sku ILIKE $2 ORDER BY v.sku LIMIT 1) AS sku
           FROM products p
           WHERE p.store_id = $1::uuid AND (p.name ILIKE $2 OR EXISTS (SELECT 1 FROM variants v WHERE v.store_id = p.store_id AND v.product_id = p.id AND v.sku ILIKE $2))
           ORDER BY (lower(p.name) LIKE lower($3)) DESC, p.published DESC, lower(p.name), p.id LIMIT 6`,
          [storeId, like, comeco],
        ),
    numero === null
      ? []
      : db.query<{ id: string; number: number | null; created: string; total: string; payment_status: string | null; shipping_status: string | null; a_enviar: boolean }>(
          `SELECT o.id::text AS id, o.number, o.created_at_remote::text AS created, o.total::text AS total, o.payment_status, o.shipping_status,
                  (o.payment_status = 'paid' AND coalesce(o.status, 'open') = 'open' AND coalesce(o.shipping_status, '') NOT IN ('shipped', 'delivered', 'fulfilled')) AS a_enviar
           FROM orders o WHERE o.store_id = $1::uuid AND (o.number = $2::int OR o.number::text LIKE $3)
           ORDER BY (o.number = $2::int) DESC, o.created_at_remote DESC LIMIT 5`,
          [storeId, numero, `${numero}%`],
        ),
    q.length < MIN_LETRAS || numero !== null
      ? []
      : db.query<{ id: string; name: string | null; city: string | null; state: string | null }>(
          `SELECT c.id::text AS id, c.name, c.city, c.state FROM customers c
           WHERE c.store_id = $1::uuid AND coalesce(c.ignored, false) = false AND (c.name ILIKE $2 OR c.email ILIKE $3)
           ORDER BY (lower(c.name) LIKE lower($3)) DESC, lower(c.name), c.id LIMIT 5`,
          [storeId, like, comeco],
        ),
    q.length < MIN_LETRAS || numero !== null
      ? []
      : db.query<{ id: string; name: string }>(`SELECT id::text AS id, name FROM categories WHERE store_id = $1::uuid AND name ILIKE $2 ORDER BY lower(name), id LIMIT 4`, [storeId, like]),
  ]);

  return {
    produtos: produtos.map((p) => ({ id: p.id, nome: p.name, publicado: p.published, sku: p.sku })),
    pedidos: pedidos.map((o) => ({ id: o.id, numero: o.number, criadoEm: o.created, total: Number(o.total), pagamento: o.payment_status, envio: o.shipping_status, aEnviar: o.a_enviar })),
    clientes: clientes.map((c) => ({ id: c.id, nome: c.name ?? `Cliente ${c.id}`, local: [c.city, c.state].filter(Boolean).join("/") || null })),
    categorias: categorias.map((c) => ({ id: c.id, nome: c.name })),
  };
}
