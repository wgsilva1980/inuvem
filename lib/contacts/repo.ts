import type { Db } from "@/lib/sync/repo";
import type { ContactInput } from "./schema";

export interface Contact {
  id: string;
  kind: string | null;
  person_type: "fisica" | "juridica";
  name: string;
  trade_name: string | null;
  document: string | null;
  state_registration: string | null;
  ie_exempt: boolean;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contact_person: string | null;
  zip: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  birth_date: string | null;
  gender: string | null;
  marital_status: string | null;
  profession: string | null;
  nationality: string | null;
  customer_since: string | null;
  active: boolean;
  notes: string | null;
}

const COLUMNS = `id::text AS id, kind, person_type, name, trade_name, document, state_registration, ie_exempt, email, phone, mobile, contact_person,
  zip, street, number, complement, district, city, state, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, gender, marital_status, profession,
  nationality, to_char(customer_since, 'YYYY-MM-DD') AS customer_since, active, notes`;

export const ORIGENS = ["loja", "manual"] as const;
export const SEGMENTOS = ["compraram", "sem_compra", "melhores", "novos", "marketing"] as const;
export type Origem = (typeof ORIGENS)[number];
export type Segmento = (typeof SEGMENTOS)[number];
export const SEGMENTO_LABEL: Record<Segmento, string> = {
  compraram: "Já compraram",
  sem_compra: "Cadastradas sem compra",
  melhores: "Melhores clientes (20% que mais gastaram)",
  novos: "Novas (últimos 30 dias)",
  marketing: "Aceitam receber novidades",
};

export interface ContactFilters {
  q?: string;
  kind?: string;
  status?: "todos" | "ativos" | "inativos";
  /** Contatos que vieram da loja (clientes sincronizados) ou cadastrados à mão. */
  origem?: Origem;
  /** Recortes dos clientes da loja (só valem para quem está ligado a um cliente). */
  segmento?: Segmento;
  sort?: "nome" | "gasto";
  page?: number;
}

export const CONTACTS_PAGE_SIZE = 25;

export interface ContactListItem {
  id: string;
  name: string;
  trade_name: string | null;
  kind: string | null;
  person_type: string;
  city: string | null;
  state: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  /** Veio da loja (cliente sincronizado). */
  from_store: boolean;
  /** Total gasto na loja (R$, texto do banco); null se não está ligado a um cliente. */
  total_spent: string | null;
}

/** Contato com os dados do cliente da loja, para exportar. */
export type ContactExport = Contact & { from_store: boolean; total_spent: string | null; accepts_marketing: boolean | null; store_customer_since: string | null };

/** Contatos já com os dados do cliente da loja ao lado (prefixo `cu_`), para filtrar e ordenar sem ambiguidade de colunas. */
const BASE = `WITH base AS (
  SELECT c.*, cu.total_spent AS cu_total_spent, cu.accepts_marketing AS cu_marketing, cu.created_at_remote AS cu_created
  FROM contacts c LEFT JOIN customers cu ON cu.store_id = c.store_id AND cu.id = c.nuvemshop_customer_id
)`;

/** WHERE (e parâmetros) dos filtros de contatos: busca (nome, fantasia, e-mail, telefone, CPF/CNPJ, cidade), tipo e situação. */
export function buildContactsWhere(storeId: string, f: ContactFilters): { clause: string; params: unknown[] } {
  const where = ["store_id = $1::uuid"];
  const params: unknown[] = [storeId];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const q = f.q?.trim();
  if (q) {
    const like = add(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const digits = q.replace(/\D/g, "");
    const parts = [`name ILIKE ${like}`, `trade_name ILIKE ${like}`, `email ILIKE ${like}`, `phone ILIKE ${like}`, `mobile ILIKE ${like}`, `city ILIKE ${like}`];
    if (digits.length >= 3) parts.push(`document LIKE ${add(`%${digits}%`)}`, `regexp_replace(coalesce(mobile, '') || coalesce(phone, ''), '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`);
    where.push(`(${parts.join(" OR ")})`);
  }
  if (f.kind === "sem_tipo") where.push("kind IS NULL");
  else if (f.kind) where.push(`kind = ${add(f.kind)}`);
  if (f.status === "ativos") where.push("active");
  else if (f.status === "inativos") where.push("NOT active");
  if (f.origem === "loja") where.push("nuvemshop_customer_id IS NOT NULL");
  else if (f.origem === "manual") where.push("nuvemshop_customer_id IS NULL");
  switch (f.segmento) {
    case "compraram":
      where.push("cu_total_spent > 0");
      break;
    case "sem_compra":
      where.push("nuvemshop_customer_id IS NOT NULL AND coalesce(cu_total_spent, 0) = 0");
      break;
    case "melhores":
      where.push("cu_total_spent > 0 AND cu_total_spent >= (SELECT percentile_cont(0.8) WITHIN GROUP (ORDER BY total_spent) FROM customers WHERE store_id = $1::uuid AND total_spent > 0)");
      break;
    case "novos":
      where.push("cu_created >= now() - interval '30 days'");
      break;
    case "marketing":
      where.push("cu_marketing IS TRUE");
      break;
  }
  return { clause: where.join(" AND "), params };
}

const ordem = (f: ContactFilters) => (f.sort === "gasto" ? "cu_total_spent DESC NULLS LAST, lower(name), id" : "lower(name), id");

/** Lista com busca (nome, fantasia, e-mail, telefone, CPF/CNPJ), tipo e situação, paginada. */
export async function listContacts(db: Db, storeId: string, f: ContactFilters): Promise<{ items: ContactListItem[]; total: number; page: number; pages: number }> {
  const { clause, params } = buildContactsWhere(storeId, f);
  const total = Number((await db.query<{ n: string }>(`${BASE} SELECT count(*)::text AS n FROM base WHERE ${clause}`, params))[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  const items = await db.query<ContactListItem>(
    `${BASE}
     SELECT id::text AS id, name, trade_name, kind, person_type, city, state, mobile, phone, email, active,
            nuvemshop_customer_id IS NOT NULL AS from_store, cu_total_spent::text AS total_spent
     FROM base WHERE ${clause} ORDER BY ${ordem(f)} LIMIT ${CONTACTS_PAGE_SIZE} OFFSET ${(page - 1) * CONTACTS_PAGE_SIZE}`,
    params,
  );
  return { items, total, page, pages };
}

/** Todos os contatos que casam com os filtros (sem paginação), no limite pedido, para exportar. */
export async function listContactsForExport(db: Db, storeId: string, f: ContactFilters, limit: number): Promise<{ items: ContactExport[]; truncated: boolean }> {
  const { clause, params } = buildContactsWhere(storeId, f);
  const rows = await db.query<ContactExport>(
    `${BASE}
     SELECT ${COLUMNS}, nuvemshop_customer_id IS NOT NULL AS from_store, cu_total_spent::text AS total_spent, cu_marketing AS accepts_marketing,
            to_char(cu_created AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS store_customer_since
     FROM base WHERE ${clause} ORDER BY ${ordem(f)} LIMIT ${limit + 1}`,
    params,
  );
  return { items: rows.slice(0, limit), truncated: rows.length > limit };
}

export async function getContact(db: Db, storeId: string, id: number): Promise<Contact | null> {
  const rows = await db.query<Contact>(`SELECT ${COLUMNS} FROM contacts WHERE store_id = $1::uuid AND id = $2::bigint`, [storeId, id]);
  return rows[0] ?? null;
}

const FIELDS = [
  "kind", "person_type", "name", "trade_name", "document", "state_registration", "ie_exempt", "email", "phone", "mobile", "contact_person",
  "zip", "street", "number", "complement", "district", "city", "state", "birth_date", "gender", "marital_status", "profession",
  "nationality", "customer_since", "active", "notes",
] as const;

/** Histórico sem dados pessoais: só quem fez, o quê e o nome do contato (CPF, telefone etc. não são copiados para o log). */
async function audit(db: Db, a: { storeId: string; actor: string; acao: string; id: number; depois: unknown; sucesso?: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso)
     VALUES ($1::uuid, $2, $3, 'contato', $4, $5::jsonb, $6)`,
    [a.storeId, a.actor, a.acao, String(a.id), JSON.stringify(a.depois), a.sucesso ?? true],
  );
}

export async function createContact(db: Db, args: { storeId: string; actor: string; input: ContactInput }): Promise<number> {
  const values = FIELDS.map((f) => args.input[f]);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO contacts (store_id, ${FIELDS.join(", ")})
     VALUES ($1::uuid, ${FIELDS.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id::text AS id`,
    [args.storeId, ...values],
  );
  const id = Number(rows[0]!.id);
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "contato.criar", id, depois: { nome: args.input.name } });
  return id;
}

/** Atualiza e devolve false se o contato não existe. O histórico guarda só os nomes dos campos que mudaram. */
export async function updateContact(db: Db, args: { storeId: string; actor: string; id: number; input: ContactInput }): Promise<boolean> {
  const before = await getContact(db, args.storeId, args.id);
  if (!before) return false;
  const changed = FIELDS.filter((f) => (before[f] ?? null) !== (args.input[f] ?? null));
  if (changed.length === 0) return true;
  await db.query(
    `UPDATE contacts SET ${FIELDS.map((f, i) => `${f} = $${i + 3}`).join(", ")}, updated_at = now() WHERE store_id = $1::uuid AND id = $2::bigint`,
    [args.storeId, args.id, ...FIELDS.map((f) => args.input[f])],
  );
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "contato.atualizar", id: args.id, depois: { nome: args.input.name, campos: changed } });
  return true;
}

export async function deleteContact(db: Db, args: { storeId: string; actor: string; id: number }): Promise<boolean> {
  const rows = await db.query<{ name: string; customer_id: string | null }>(
    "DELETE FROM contacts WHERE store_id = $1::uuid AND id = $2::bigint RETURNING name, nuvemshop_customer_id::text AS customer_id",
    [args.storeId, args.id],
  );
  if (rows.length === 0) return false;
  // contato que veio da loja: a sincronização não o recria
  if (rows[0]!.customer_id !== null) await db.query("UPDATE customers SET ignored = true WHERE store_id = $1::uuid AND id = $2::bigint", [args.storeId, rows[0]!.customer_id]);
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "contato.apagar", id: args.id, depois: { nome: rows[0]!.name } });
  return true;
}

export interface ClienteDaLoja {
  customer_id: string;
  total_spent: string;
  last_order_id: string | null;
  accepts_marketing: boolean | null;
  created_at_remote: string | null;
  email: string | null;
}

/** Dados do cliente da loja ligado a este contato (null se o contato é só do painel). */
export async function getClienteDaLoja(db: Db, storeId: string, contactId: number): Promise<ClienteDaLoja | null> {
  const rows = await db.query<ClienteDaLoja>(
    `SELECT cu.id::text AS customer_id, cu.total_spent::text AS total_spent, cu.last_order_id::text AS last_order_id, cu.accepts_marketing,
            to_char(cu.created_at_remote AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS created_at_remote, cu.email
     FROM contacts c JOIN customers cu ON cu.store_id = c.store_id AND cu.id = c.nuvemshop_customer_id
     WHERE c.store_id = $1::uuid AND c.id = $2::bigint`,
    [storeId, contactId],
  );
  return rows[0] ?? null;
}
