import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { BackupStorage } from "@/lib/images/storage";
import {
  MAX_FOTOS_RASCUNHO,
  RascunhoInvalidoError,
  RascunhoNaoEncontradoError,
  adicionarFoto,
  contarRascunhos,
  definirFotos,
  descartarRascunho,
  lerFoto,
  listarRascunhos,
  marcarCriado,
  obterRascunho,
  removerFotoEnviada,
  salvarRascunho,
} from "@/lib/catalog/drafts";

let pg: PGlite;
let db: Db;
let storeId: string;
let outraLoja: string;

class FakeStorage implements BackupStorage {
  files = new Map<string, Buffer>();
  async put(p: string, b: Buffer) {
    this.files.set(p, b);
  }
  async get(p: string) {
    const f = this.files.get(p);
    if (!f) throw new Error("sem arquivo");
    return f;
  }
  async del(ps: string[]) {
    for (const p of ps) this.files.delete(p);
  }
}

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const ins = async (n: number) => (await pg.query<{ id: string }>(`INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (${n}, 'x') RETURNING id`)).rows[0]!.id;
  storeId = await ins(1);
  outraLoja = await ins(2);
});

const form = (over: Record<string, unknown> = {}) => ({
  name: "Vestido Midi Azul",
  description: "<p>Texto</p>",
  tags: "vestido",
  categorias: [10],
  modo: "variacoes",
  cores: "Azul",
  tamanhos: "P, M",
  preco: "189,90",
  promocional: "",
  peso: "0,4",
  controlar: true,
  estoque: "5",
  seoTitulo: "Vestido Midi Azul | Donatelle Concept",
  seoDescricao: "Descrição",
  iaMarcados: ["name", "description"],
  ...over,
});
const salvar = (id: number | null = null, f: unknown = form(), extra: Record<string, unknown> = {}) =>
  salvarRascunho(db, { storeId, actor: "a@b.c", id, entrada: { notas: "viscose", form: f, ia: null, ...extra } });
const foto = (storage: FakeStorage, id: number, nome = "foto.jpg", tipo = "image/jpeg") => adicionarFoto(db, storage, { storeId, id, nome, contentType: tipo, bytes: Buffer.from(nome) });

describe("rascunhos de produto", () => {
  it("cria e atualiza os campos, com o título vindo do nome", async () => {
    const id = await salvar();
    let r = (await obterRascunho(db, storeId, id))!;
    expect(r).toMatchObject({ titulo: "Vestido Midi Azul", notas: "viscose", status: "rascunho", productId: null });
    expect(r.form).toMatchObject({ name: "Vestido Midi Azul", modo: "variacoes", categorias: [10], preco: "189,90", controlar: true });
    await salvar(id, form({ name: "Vestido Novo", preco: "200,00" }), { notas: "outra nota", ia: { avisos: ["Confira"], fotos: [] } });
    r = (await obterRascunho(db, storeId, id))!;
    expect(r.titulo).toBe("Vestido Novo");
    expect(r.notas).toBe("outra nota");
    expect(r.form!.preco).toBe("200,00");
    expect(r.ia).toEqual({ avisos: ["Confira"], fotos: [] });
  });

  it("campos inválidos viram valores padrão em vez de quebrar", async () => {
    const id = await salvar(null, { name: 123, categorias: "x", modo: "estranho", controlar: "sim", tags: "ok" });
    const r = (await obterRascunho(db, storeId, id))!;
    expect(r.form).toMatchObject({ name: "", categorias: [], modo: "simples", controlar: false, tags: "ok" });
    expect((await listarRascunhos(db, storeId))[0]!.titulo).toBe("(sem nome)");
  });

  it("atualizar rascunho que não existe, de outra loja ou já criado dá erro", async () => {
    await expect(salvar(999)).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
    const id = await salvar();
    await expect(salvarRascunho(db, { storeId: outraLoja, actor: "x", id, entrada: { notas: "", form: form(), ia: null } })).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
    await marcarCriado(db, { storeId, id, productId: 77 });
    await expect(salvar(id)).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
  });

  it("fotos: guarda no armazenamento, acrescenta na ordem e respeita o limite e o formato", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    const a = await foto(st, id, "a.jpg");
    const b = await foto(st, id, "b.png", "image/png");
    expect(a.pathname).toMatch(new RegExp(`^rascunhos/${storeId}/${id}/.+\\.jpg$`));
    expect(b.pathname.endsWith(".png")).toBe(true);
    expect(st.files.size).toBe(2);
    expect((await obterRascunho(db, storeId, id))!.fotos.map((f) => f.name)).toEqual(["a.jpg", "b.png"]);
    await expect(foto(st, id, "x.bmp", "image/bmp")).rejects.toBeInstanceOf(RascunhoInvalidoError);
    for (let i = 2; i < MAX_FOTOS_RASCUNHO; i++) await foto(st, id, `f${i}.jpg`);
    await expect(foto(st, id, "extra.jpg")).rejects.toThrow(`no máximo ${MAX_FOTOS_RASCUNHO}`);
    expect(st.files.size).toBe(MAX_FOTOS_RASCUNHO);
  });

  it("definirFotos reordena, ignora desconhecidas e apaga as removidas do armazenamento", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    const [a, b, c] = [await foto(st, id, "a.jpg"), await foto(st, id, "b.jpg"), await foto(st, id, "c.jpg")];
    const r = await definirFotos(db, st, { storeId, id, ordem: [c.pathname, "rascunhos/x/y/falsa.jpg", a.pathname, c.pathname] });
    expect(r.map((f) => f.name)).toEqual(["c.jpg", "a.jpg"]);
    expect(st.files.has(b.pathname)).toBe(false);
    expect(st.files.has(a.pathname) && st.files.has(c.pathname)).toBe(true);
  });

  it("lerFoto só devolve fotos que estão na lista do rascunho", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    const a = await foto(st, id, "a.jpg");
    st.files.set("rascunhos/de/outro.jpg", Buffer.from("segredo"));
    expect((await lerFoto(db, st, { storeId, id, pathname: a.pathname }))!.bytes.toString()).toBe("a.jpg");
    expect(await lerFoto(db, st, { storeId, id, pathname: "rascunhos/de/outro.jpg" })).toBeNull();
    expect(await lerFoto(db, st, { storeId: outraLoja, id, pathname: a.pathname })).toBeNull();
  });

  it("marcar como criado tira da lista de abertos, guarda o produto e trava novas fotos", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    const outro = await salvar(null, form({ name: "Saia" }));
    await foto(st, id, "a.jpg");
    expect(await contarRascunhos(db, storeId)).toBe(2);
    await marcarCriado(db, { storeId, id, productId: 555 });
    expect(await contarRascunhos(db, storeId)).toBe(1);
    expect((await listarRascunhos(db, storeId)).map((r) => r.id)).toEqual([outro]);
    const todos = await listarRascunhos(db, storeId, true);
    expect(todos.find((r) => r.id === id)).toMatchObject({ status: "criado", productId: 555, fotos: 1 });
    await expect(foto(st, id, "b.jpg")).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
  });

  it("foto já enviada à loja sai do rascunho e do armazenamento", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    const a = await foto(st, id, "a.jpg");
    const b = await foto(st, id, "b.jpg");
    await marcarCriado(db, { storeId, id, productId: 1 });
    await removerFotoEnviada(db, st, { storeId, id, pathname: a.pathname });
    expect((await obterRascunho(db, storeId, id))!.fotos.map((f) => f.name)).toEqual(["b.jpg"]);
    expect(st.files.has(a.pathname)).toBe(false);
    expect(st.files.has(b.pathname)).toBe(true);
  });

  it("descartar apaga o rascunho e as fotos; só a loja dona pode", async () => {
    const st = new FakeStorage();
    const id = await salvar();
    await foto(st, id, "a.jpg");
    await expect(descartarRascunho(db, st, { storeId: outraLoja, id })).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
    expect(st.files.size).toBe(1);
    await descartarRascunho(db, st, { storeId, id });
    expect(st.files.size).toBe(0);
    expect(await obterRascunho(db, storeId, id)).toBeNull();
    await expect(descartarRascunho(db, st, { storeId, id })).rejects.toBeInstanceOf(RascunhoNaoEncontradoError);
  });

  it("a lista mostra o mais recente primeiro e não mistura lojas", async () => {
    const a = await salvar(null, form({ name: "A" }));
    const b = await salvar(null, form({ name: "B" }));
    await salvarRascunho(db, { storeId: outraLoja, actor: "x", id: null, entrada: { notas: "", form: form({ name: "De outra loja" }), ia: null } });
    await salvar(a, form({ name: "A2" })); // mexeu no A: vai para o topo
    expect((await listarRascunhos(db, storeId)).map((r) => r.titulo)).toEqual(["A2", "B"]);
    expect(b).toBeGreaterThan(a);
  });
});
