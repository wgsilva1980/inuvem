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

export interface ContactFilters {
  q?: string;
  kind?: string;
  status?: "todos" | "ativos" | "inativos";
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
}

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
  return { clause: where.join(" AND "), params };
}

/** Lista com busca (nome, fantasia, e-mail, telefone, CPF/CNPJ), tipo e situação, paginada. */
export async function listContacts(db: Db, storeId: string, f: ContactFilters): Promise<{ items: ContactListItem[]; total: number; page: number; pages: number }> {
  const { clause, params } = buildContactsWhere(storeId, f);
  const total = Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM contacts WHERE ${clause}`, params))[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  const items = await db.query<ContactListItem>(
    `SELECT id::text AS id, name, trade_name, kind, person_type, city, state, mobile, phone, email, active
     FROM contacts WHERE ${clause} ORDER BY lower(name), id LIMIT ${CONTACTS_PAGE_SIZE} OFFSET ${(page - 1) * CONTACTS_PAGE_SIZE}`,
    params,
  );
  return { items, total, page, pages };
}

/** Todos os contatos que casam com os filtros (sem paginação), no limite pedido, para exportar. */
export async function listContactsForExport(db: Db, storeId: string, f: ContactFilters, limit: number): Promise<{ items: Contact[]; truncated: boolean }> {
  const { clause, params } = buildContactsWhere(storeId, f);
  const rows = await db.query<Contact>(`SELECT ${COLUMNS} FROM contacts WHERE ${clause} ORDER BY lower(name), id LIMIT ${limit + 1}`, params);
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
  const rows = await db.query<{ name: string }>("DELETE FROM contacts WHERE store_id = $1::uuid AND id = $2::bigint RETURNING name", [args.storeId, args.id]);
  if (rows.length === 0) return false;
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "contato.apagar", id: args.id, depois: { nome: rows[0]!.name } });
  return true;
}
