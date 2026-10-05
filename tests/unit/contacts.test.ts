import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { parseContactForm } from "@/lib/contacts/form";
import { createContact, deleteContact, getContact, listContacts, updateContact } from "@/lib/contacts/repo";
import { formatDate, formatDocument, formatZip } from "@/lib/contacts/format";

let pg: PGlite;
let db: Db;
let storeId: string;
let otherStore: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const ins = async (n: number) => ((await pg.query<{ id: string }>(`INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (${n}, 'x') RETURNING id`)).rows[0] as { id: string }).id;
  storeId = await ins(1);
  otherStore = await ins(2);
});

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = { kind: "cliente", person_type: "fisica", name: "Maria Souza", active: "on", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}
const input = (over: Record<string, string> = {}) => {
  const r = parseContactForm(form(over));
  if (!r.input) throw new Error(JSON.stringify(r.fieldErrors));
  return r.input;
};

describe("formulário de contato", () => {
  it("normaliza CPF, CEP, e-mail e vazios", () => {
    const i = input({ document: "282.678.658-02", zip: "04693-130", email: " Maria@Exemplo.COM ", state: "sp", city: " ", birth_date: "" });
    expect(i).toMatchObject({ document: "28267865802", zip: "04693130", email: "maria@exemplo.com", state: "SP", city: null, birth_date: null, kind: "cliente" });
  });

  it("recusa nome vazio, documento com tamanho errado, CEP, e-mail, UF e data inválidos", () => {
    const r = parseContactForm(form({ name: " ", document: "123", zip: "123", email: "x", state: "XX", birth_date: "31/12/1990" }));
    expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["birth_date", "document", "email", "name", "state", "zip"]);
  });

  it("aceita CNPJ e tipo de contato em branco", () => {
    const i = input({ person_type: "juridica", document: "12.345.678/0001-95", kind: "" });
    expect(i).toMatchObject({ document: "12345678000195", kind: null, person_type: "juridica" });
  });
});

describe("máscaras", () => {
  it("formata CPF, CNPJ, CEP e data", () => {
    expect(formatDocument("28267865802")).toBe("282.678.658-02");
    expect(formatDocument("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatZip("04693130")).toBe("04693-130");
    expect(formatDate("1981-06-02")).toBe("02/06/1981");
    expect(formatDate(null)).toBe("");
  });
});

describe("contatos no banco", () => {
  it("cria, lê, atualiza e exclui, com histórico sem dados pessoais", async () => {
    const id = await createContact(db, { storeId, actor: "a@x", input: input({ document: "28267865802", mobile: "(11) 99999-0000", birth_date: "1981-06-02" }) });
    const c = await getContact(db, storeId, id);
    expect(c).toMatchObject({ name: "Maria Souza", document: "28267865802", birth_date: "1981-06-02", active: true });
    expect(await updateContact(db, { storeId, actor: "a@x", id, input: input({ name: "Maria S.", mobile: "(11) 98888-0000" }) })).toBe(true);
    expect((await getContact(db, storeId, id))?.name).toBe("Maria S.");
    expect(await deleteContact(db, { storeId, actor: "a@x", id })).toBe(true);
    expect(await getContact(db, storeId, id)).toBeNull();

    const log = (await pg.query<{ acao: string; depois: Record<string, unknown> }>("SELECT acao, depois FROM audit_log ORDER BY id")).rows;
    expect(log.map((l) => l.acao)).toEqual(["contato.criar", "contato.atualizar", "contato.apagar"]);
    const todos = JSON.stringify(log);
    expect(todos).not.toContain("99999");
    expect(todos).not.toContain("28267865802");
    expect(log[1]!.depois.campos).toEqual(expect.arrayContaining(["name", "mobile", "document", "birth_date"]));
  });

  it("não mexe em contatos de outra loja", async () => {
    const id = await createContact(db, { storeId, actor: "a@x", input: input() });
    expect(await getContact(db, otherStore, id)).toBeNull();
    expect(await deleteContact(db, { storeId: otherStore, actor: "a@x", id })).toBe(false);
    expect(await updateContact(db, { storeId: otherStore, actor: "a@x", id, input: input() })).toBe(false);
    expect((await listContacts(db, otherStore, {})).total).toBe(0);
  });

  it("busca por nome, telefone (só dígitos) e CPF; filtra por tipo e situação; pagina", async () => {
    await createContact(db, { storeId, actor: "a@x", input: input({ name: "Ana Lima", mobile: "(11) 99237-0198", document: "11122233344" }) });
    await createContact(db, { storeId, actor: "a@x", input: input({ name: "Casa Têxtil", kind: "fornecedor", person_type: "juridica", email: "vendas@casa.com" }) });
    await createContact(db, { storeId, actor: "a@x", input: input({ name: "Bia Inativa", active: "", kind: "" }) });
    const names = async (f: Parameters<typeof listContacts>[2]) => (await listContacts(db, storeId, f)).items.map((i) => i.name);
    expect(await names({ q: "ana" })).toEqual(["Ana Lima"]);
    expect(await names({ q: "992370198" })).toEqual(["Ana Lima"]);
    expect(await names({ q: "111.222.333" })).toEqual(["Ana Lima"]);
    expect(await names({ q: "casa.com" })).toEqual(["Casa Têxtil"]);
    expect(await names({ kind: "fornecedor" })).toEqual(["Casa Têxtil"]);
    expect(await names({ kind: "sem_tipo" })).toEqual(["Bia Inativa"]);
    expect(await names({ status: "ativos" })).toEqual(["Ana Lima", "Casa Têxtil"]);
    expect(await names({ status: "inativos" })).toEqual(["Bia Inativa"]);
    expect(await names({ q: "100%" })).toEqual([]); // % da busca não vira curinga
    for (let i = 0; i < 30; i++) await createContact(db, { storeId, actor: "a@x", input: input({ name: `Cliente ${String(i).padStart(2, "0")}` }) });
    const p2 = await listContacts(db, storeId, { status: "todos", page: 2 });
    expect(p2).toMatchObject({ total: 33, pages: 2, page: 2 });
    expect(p2.items).toHaveLength(8);
  });
});
