import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { Customer } from "@/lib/nuvemshop/customers";
import { mapearCliente, separarTelefone, ufDe } from "@/lib/customers/map";
import { gravarClientes, passoClientes, ultimaSincronizacao, type FonteClientes } from "@/lib/customers/sync";
import { createContact, deleteContact, getClienteDaLoja, listContacts, listContactsForExport } from "@/lib/contacts/repo";
import { parseContactForm } from "@/lib/contacts/form";
import { redactCustomer } from "@/lib/privacy";
import { formatBRL } from "@/lib/contacts/format";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (77, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const cli = (id: number, over: Partial<Customer> = {}): Customer => ({ id, name: `Cliente ${id}`, email: `c${id}@x.com`, total_spent: "0", ...over }) as Customer;
const gravar = (cs: Customer[]) => gravarClientes(db, storeId, cs.map(mapearCliente));

describe("mapeamento", () => {
  it("UF por nome ou sigla", () => {
    expect(ufDe("São Paulo")).toBe("SP");
    expect(ufDe("rj")).toBe("RJ");
    expect(ufDe("Xyz")).toBeNull();
    expect(ufDe(null)).toBeNull();
  });
  it("separa celular e fixo, tirando o +55", () => {
    expect(separarTelefone("+55 (11) 98888-7777")).toEqual({ phone: null, mobile: "11988887777" });
    expect(separarTelefone("(11) 3333-4444")).toEqual({ phone: "1133334444", mobile: null });
    expect(separarTelefone("123")).toEqual({ phone: null, mobile: null });
  });
  it("normaliza um cliente", () => {
    const m = mapearCliente(cli(5, { name: " ", email: "ANA@X.COM", identification: "123.456.789-09", total_spent: "150.456", default_address: { zipcode: "01310-100", province: "São Paulo", address: "Av X" } } as Partial<Customer>));
    expect(m).toMatchObject({ name: "ana", email: "ana@x.com", document: "12345678909", person_type: "fisica", zip: "01310100", state: "SP", total_spent: 150.46, street: "Av X" });
    expect(mapearCliente(cli(6, { name: null, email: null })).name).toBe("Cliente 6");
    expect(mapearCliente(cli(7, { identification: "12345678000199" })).person_type).toBe("juridica");
  });
});

describe("gravarClientes", () => {
  it("espelha e cria contatos; reexecutar não duplica", async () => {
    const r = await gravar([cli(1, { total_spent: "100" }), cli(2)]);
    expect(r).toMatchObject({ novos: 2, atualizados: 0, criados: 2 });
    const again = await gravar([cli(1, { total_spent: "250" }), cli(2)]);
    expect(again).toMatchObject({ novos: 0, atualizados: 2, criados: 0 });
    expect((await pg.query("SELECT 1 FROM contacts")).rows).toHaveLength(2);
    expect((await pg.query<{ total_spent: string }>("SELECT total_spent::text FROM customers WHERE id = 1")).rows[0]!.total_spent).toBe("250.00");
  });

  it("liga contato existente por CPF ou e-mail e só preenche o que está vazio", async () => {
    const porDoc = await createContact(db, { storeId, actor: "a@b.c", input: mk("Maria Digitada", { document: "12345678909" }) });
    const porEmail = await createContact(db, { storeId, actor: "a@b.c", input: mk("João", { email: "c2@x.com", city: "Minha Cidade" }) });
    const r = await gravar([
      cli(1, { identification: "123.456.789-09", email: "outro@x.com", default_address: { city: "Loja City" } } as Partial<Customer>),
      cli(2, { default_address: { city: "Loja City", zipcode: "01310100" } } as Partial<Customer>),
    ]);
    expect(r).toMatchObject({ vinculados: 2, criados: 0, preenchidos: 2 });
    const rows = (await pg.query<{ id: string; name: string; email: string | null; city: string | null; zip: string | null; cid: string }>("SELECT id::text, name, email, city, zip, nuvemshop_customer_id::text AS cid FROM contacts ORDER BY id")).rows;
    expect(rows[0]).toMatchObject({ name: "Maria Digitada", email: "outro@x.com", city: "Loja City", cid: "1" });
    expect(rows[1]).toMatchObject({ name: "João", city: "Minha Cidade", zip: "01310100", cid: "2" });
    expect(porDoc).toBeGreaterThan(0);
    expect(porEmail).toBeGreaterThan(0);
  });

  it("não recria o contato que a pessoa apagou", async () => {
    await gravar([cli(1)]);
    const id = (await pg.query<{ id: string }>("SELECT id FROM contacts")).rows[0]!.id;
    expect(await deleteContact(db, { storeId, actor: "a@b.c", id: Number(id) })).toBe(true);
    expect((await pg.query<{ ignored: boolean }>("SELECT ignored FROM customers WHERE id = 1")).rows[0]!.ignored).toBe(true);
    const r = await gravar([cli(1, { total_spent: "10" })]);
    expect(r.criados).toBe(0);
    expect((await pg.query("SELECT 1 FROM contacts")).rows).toHaveLength(0);
  });
});

function mk(name: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ kind: "cliente", person_type: "fisica", name, active: "on", ...extra })) f.set(k, v);
  const r = parseContactForm(f);
  if (!r.input) throw new Error(JSON.stringify(r.fieldErrors));
  return r.input;
}

describe("passoClientes", () => {
  const fonte = (paginas: Customer[][], visto: Array<string | undefined> = []): FonteClientes => ({
    listPage: async (page, desde) => {
      visto.push(desde);
      return { items: paginas[page - 1] ?? [], nextPage: page < paginas.length ? page + 1 : null, invalidos: 0, campos: ["id", "name"] };
    },
  });

  it("percorre as páginas, marca a sincronização e depois fica incremental", async () => {
    const visto: Array<string | undefined> = [];
    const p = await passoClientes(db, fonte([[cli(1)], [cli(2)]], visto), { storeId, budgetMs: 10_000 });
    expect(p).toMatchObject({ concluido: true, proxima: null, lidos: 2, criados: 2, incremental: false, campos: ["id", "name"] });
    expect(await ultimaSincronizacao(db, storeId)).not.toBeNull();
    const q = await passoClientes(db, fonte([[cli(1)]], visto), { storeId, budgetMs: 10_000 });
    expect(q.incremental).toBe(true);
    expect(visto.at(-1)).toBeTruthy();
    const full = await passoClientes(db, fonte([[cli(1)]], visto), { storeId, budgetMs: 10_000, completo: true });
    expect(full.incremental).toBe(false);
  });

  it("para ao estourar o tempo e devolve a próxima página sem marcar a sincronização", async () => {
    let t = 0;
    const p = await passoClientes(db, fonte([[cli(1)], [cli(2)], [cli(3)]]), { storeId, budgetMs: 5, now: () => (t += 10) });
    expect(p.concluido).toBe(false);
    expect(p.proxima).toBe(2);
    expect(await ultimaSincronizacao(db, storeId)).toBeNull();
    const rest = await passoClientes(db, fonte([[cli(1)], [cli(2)], [cli(3)]]), { storeId, page: 2, inicio: p.inicio, budgetMs: 10_000 });
    expect(rest.concluido).toBe(true);
    expect(await ultimaSincronizacao(db, storeId)).toBe((await pg.query<{ q: string }>("SELECT customers_synced_at::text AS q FROM store_settings")).rows[0]!.q);
  });
});

describe("contatos com clientes da loja", () => {
  beforeEach(async () => {
    const cs = Array.from({ length: 10 }, (_, i) => cli(i + 1, { total_spent: String((i + 1) * 100), accepts_marketing: i % 2 === 0 }));
    cs.push(cli(11, { total_spent: "0" }));
    await gravar(cs);
    await createContact(db, { storeId, actor: "a@b.c", input: mk("Fornecedor Manual", { kind: "fornecedor" }) });
  });
  const lista = async (f: Parameters<typeof listContacts>[2]) => (await listContacts(db, storeId, f)).items;

  it("filtra por origem e segmento", async () => {
    expect(await lista({ origem: "loja" })).toHaveLength(11);
    expect(await lista({ origem: "manual" })).toHaveLength(1);
    expect(await lista({ segmento: "compraram" })).toHaveLength(10);
    expect(await lista({ segmento: "sem_compra" })).toHaveLength(1);
    expect(await lista({ segmento: "novos" })).toHaveLength(0);
    expect((await lista({ segmento: "marketing" })).length).toBe(5);
    const top = await lista({ segmento: "melhores" });
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((c) => Number(c.total_spent) >= 800)).toBe(true);
  });

  it("ordena pelo maior gasto e informa origem e total", async () => {
    const itens = await lista({ sort: "gasto" });
    expect(itens[0]).toMatchObject({ from_store: true, total_spent: "1000.00" });
    expect(itens.at(-1)!.from_store).toBe(false);
  });

  it("a exportação traz as colunas da loja e respeita os filtros", async () => {
    const { items } = await listContactsForExport(db, storeId, { segmento: "marketing" }, 100);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ from_store: true, accepts_marketing: true });
  });

  it("detalhe do cliente da loja", async () => {
    const id = Number((await pg.query<{ id: string }>("SELECT id FROM contacts WHERE nuvemshop_customer_id = 3")).rows[0]!.id);
    expect(await getClienteDaLoja(db, storeId, id)).toMatchObject({ customer_id: "3", total_spent: "300.00" });
    const manual = Number((await pg.query<{ id: string }>("SELECT id FROM contacts WHERE nuvemshop_customer_id IS NULL")).rows[0]!.id);
    expect(await getClienteDaLoja(db, storeId, manual)).toBeNull();
  });
});

describe("LGPD customers/redact", () => {
  it("apaga cliente e contato ligado, é idempotente e ignora loja desconhecida", async () => {
    await gravar([cli(1), cli(2)]);
    expect(await redactCustomer(db, 77, 1)).toBe(1);
    expect((await pg.query("SELECT 1 FROM customers")).rows).toHaveLength(1);
    expect((await pg.query("SELECT 1 FROM contacts")).rows).toHaveLength(1);
    expect(await redactCustomer(db, 77, 1)).toBe(0);
    expect(await redactCustomer(db, 999, 2)).toBe(0);
    expect((await pg.query("SELECT 1 FROM customers")).rows).toHaveLength(1);
  });
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL("1234.5").replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatBRL(null)).toBe("");
  });
});
