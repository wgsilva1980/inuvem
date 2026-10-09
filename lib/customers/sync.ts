import type { Customer } from "@/lib/nuvemshop/customers";
import type { Db } from "@/lib/sync/repo";
import { mapearCliente, type ClienteMapeado } from "./map";

const COLUNAS_JSON = `id bigint, name text, email text, phone text, mobile text, document text, person_type text, zip text, street text, number text,
  complement text, district text, city text, state text, total_spent numeric, last_order_id bigint, accepts_marketing boolean,
  created_at_remote timestamptz, updated_at_remote timestamptz`;
const RECORDSET = `jsonb_to_recordset($2::jsonb) AS m(${COLUNAS_JSON})`;

export interface ResultadoPagina {
  novos: number;
  atualizados: number;
  vinculados: number;
  preenchidos: number;
  criados: number;
}

/**
 * Grava uma página de clientes: (1) espelho em `customers`; (2) liga a contatos que já existem (mesmo CPF/CNPJ ou e-mail); (3) preenche só os
 * campos que estão vazios nesses contatos (nunca sobrescreve o que a pessoa digitou); (4) cria contato para quem ainda não tem, salvo os que
 * a pessoa apagou antes (`ignored`). Tudo em lote (4 consultas por página, não uma por cliente).
 */
export async function gravarClientes(db: Db, storeId: string, clientes: ClienteMapeado[]): Promise<ResultadoPagina> {
  const vazio: ResultadoPagina = { novos: 0, atualizados: 0, vinculados: 0, preenchidos: 0, criados: 0 };
  if (clientes.length === 0) return vazio;
  const json = JSON.stringify(clientes);

  const espelho = await db.query<{ novo: boolean }>(
    `INSERT INTO customers (store_id, id, name, email, phone, document, zip, city, state, total_spent, last_order_id, accepts_marketing, created_at_remote, updated_at_remote, synced_at)
     SELECT $1::uuid, m.id, m.name, m.email, coalesce(m.mobile, m.phone), m.document, m.zip, m.city, m.state, coalesce(m.total_spent, 0), m.last_order_id,
            m.accepts_marketing, m.created_at_remote, m.updated_at_remote, now()
     FROM ${RECORDSET}
     ON CONFLICT (store_id, id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, document = EXCLUDED.document, zip = EXCLUDED.zip,
       city = EXCLUDED.city, state = EXCLUDED.state, total_spent = EXCLUDED.total_spent, last_order_id = EXCLUDED.last_order_id,
       accepts_marketing = EXCLUDED.accepts_marketing, created_at_remote = EXCLUDED.created_at_remote, updated_at_remote = EXCLUDED.updated_at_remote, synced_at = now()
     RETURNING (xmax = 0) AS novo`,
    [storeId, json],
  );

  const vinculados = await db.query(
    `WITH m AS (SELECT * FROM ${RECORDSET}),
     alvo AS (
       SELECT DISTINCT ON (m.id) m.id AS customer_id, c.id AS contact_id
       FROM m JOIN contacts c ON c.store_id = $1::uuid AND c.nuvemshop_customer_id IS NULL
         AND ((m.document IS NOT NULL AND c.document = m.document) OR (m.email IS NOT NULL AND lower(c.email) = m.email))
       WHERE NOT EXISTS (SELECT 1 FROM contacts x WHERE x.store_id = $1::uuid AND x.nuvemshop_customer_id = m.id)
       ORDER BY m.id, (c.document = m.document) DESC NULLS LAST, c.id
     ),
     unico AS (SELECT DISTINCT ON (contact_id) customer_id, contact_id FROM alvo ORDER BY contact_id, customer_id)
     UPDATE contacts SET nuvemshop_customer_id = unico.customer_id, updated_at = now() FROM unico WHERE contacts.id = unico.contact_id RETURNING contacts.id`,
    [storeId, json],
  );

  const preenchidos = await db.query(
    `WITH m AS (SELECT * FROM ${RECORDSET})
     UPDATE contacts c SET
       email = coalesce(nullif(c.email, ''), m.email), document = coalesce(nullif(c.document, ''), m.document),
       phone = coalesce(nullif(c.phone, ''), m.phone), mobile = coalesce(nullif(c.mobile, ''), m.mobile),
       zip = coalesce(nullif(c.zip, ''), m.zip), street = coalesce(nullif(c.street, ''), m.street), number = coalesce(nullif(c.number, ''), m.number),
       complement = coalesce(nullif(c.complement, ''), m.complement), district = coalesce(nullif(c.district, ''), m.district),
       city = coalesce(nullif(c.city, ''), m.city), state = coalesce(c.state, m.state), updated_at = now()
     FROM m
     WHERE c.store_id = $1::uuid AND c.nuvemshop_customer_id = m.id AND (
       (nullif(c.email, '') IS NULL AND m.email IS NOT NULL) OR (nullif(c.document, '') IS NULL AND m.document IS NOT NULL) OR
       (nullif(c.phone, '') IS NULL AND m.phone IS NOT NULL) OR (nullif(c.mobile, '') IS NULL AND m.mobile IS NOT NULL) OR
       (nullif(c.zip, '') IS NULL AND m.zip IS NOT NULL) OR (nullif(c.street, '') IS NULL AND m.street IS NOT NULL) OR
       (nullif(c.number, '') IS NULL AND m.number IS NOT NULL) OR (nullif(c.complement, '') IS NULL AND m.complement IS NOT NULL) OR
       (nullif(c.district, '') IS NULL AND m.district IS NOT NULL) OR (nullif(c.city, '') IS NULL AND m.city IS NOT NULL) OR
       (c.state IS NULL AND m.state IS NOT NULL))
     RETURNING c.id`,
    [storeId, json],
  );

  const criados = await db.query(
    `WITH m AS (SELECT * FROM ${RECORDSET})
     INSERT INTO contacts (store_id, nuvemshop_customer_id, kind, person_type, name, document, email, phone, mobile, zip, street, number, complement, district, city, state, customer_since, active)
     SELECT $1::uuid, m.id, 'cliente', coalesce(m.person_type, 'fisica'), m.name, m.document, m.email, m.phone, m.mobile, m.zip, m.street, m.number, m.complement,
            m.district, m.city, m.state, (m.created_at_remote AT TIME ZONE 'America/Sao_Paulo')::date, true
     FROM m JOIN customers cu ON cu.store_id = $1::uuid AND cu.id = m.id
     WHERE NOT cu.ignored AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.store_id = $1::uuid AND x.nuvemshop_customer_id = m.id)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [storeId, json],
  );

  return {
    novos: espelho.filter((r) => r.novo).length,
    atualizados: espelho.filter((r) => !r.novo).length,
    vinculados: vinculados.length,
    preenchidos: preenchidos.length,
    criados: criados.length,
  };
}

/** Quando os clientes foram sincronizados pela última vez (início da última execução completa), ou null. */
export async function ultimaSincronizacao(db: Db, storeId: string): Promise<string | null> {
  const [r] = await db.query<{ quando: string | null }>("SELECT customers_synced_at::text AS quando FROM store_settings WHERE store_id = $1::uuid", [storeId]);
  return r?.quando ?? null;
}

async function marcarSincronizacao(db: Db, storeId: string, instante: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (store_id, customers_synced_at) VALUES ($1::uuid, $2::timestamptz)
     ON CONFLICT (store_id) DO UPDATE SET customers_synced_at = EXCLUDED.customers_synced_at`,
    [storeId, instante],
  );
}

export interface FonteClientes {
  listPage(page: number, atualizadosDesde?: string): Promise<{ items: Customer[]; nextPage: number | null; invalidos: number; campos: string[] }>;
}

export interface PassoClientes extends ResultadoPagina {
  /** Próxima página a pedir; null = terminou. */
  proxima: number | null;
  concluido: boolean;
  lidos: number;
  invalidos: number;
  /** Nomes dos campos que a API devolveu (sem valores): serve para conferir o que a loja envia. */
  campos: string[];
  /** Instante em que a sincronização começou: o cliente devolve nos passos seguintes. */
  inicio: string;
  incremental: boolean;
}

/** Margem para pegar clientes alterados enquanto a sincronização anterior rodava. */
const MARGEM_MS = 10 * 60 * 1000;

/**
 * Sincroniza clientes até acabar o tempo (a tela repete com `proxima`). Incremental (só os alterados desde a última vez) quando já houve uma
 * sincronização e `completo` é falso; senão lê todos. Ao terminar guarda o instante do início como "última sincronização".
 */
export async function passoClientes(
  db: Db,
  fonte: FonteClientes,
  args: { storeId: string; page?: number; completo?: boolean; inicio?: string; budgetMs: number; now?: () => number },
): Promise<PassoClientes> {
  const now = args.now ?? Date.now;
  const comeco = now();
  const inicio = args.inicio ?? new Date(now()).toISOString();
  const anterior = args.completo ? null : await ultimaSincronizacao(db, args.storeId);
  const desde = anterior ? new Date(new Date(anterior).getTime() - MARGEM_MS).toISOString() : undefined;
  const out: PassoClientes = { proxima: args.page ?? 1, concluido: false, lidos: 0, invalidos: 0, campos: [], inicio, incremental: desde !== undefined, novos: 0, atualizados: 0, vinculados: 0, preenchidos: 0, criados: 0 };
  const campos = new Set<string>();
  let page = args.page ?? 1;
  while (true) {
    const r = await fonte.listPage(page, desde);
    out.lidos += r.items.length;
    out.invalidos += r.invalidos;
    for (const c of r.campos) campos.add(c);
    const g = await gravarClientes(db, args.storeId, r.items.map(mapearCliente));
    out.novos += g.novos;
    out.atualizados += g.atualizados;
    out.vinculados += g.vinculados;
    out.preenchidos += g.preenchidos;
    out.criados += g.criados;
    if (r.nextPage === null) {
      out.proxima = null;
      out.concluido = true;
      await marcarSincronizacao(db, args.storeId, inicio);
      break;
    }
    page = r.nextPage;
    out.proxima = page;
    if (now() - comeco >= args.budgetMs) break;
  }
  out.campos = [...campos].sort();
  return out;
}
