import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { descartar, editarReescrita, listarSugestoes, marcarColado } from "@/lib/emails/repo";
import { criarReescritor } from "@/lib/emails/rewrite";
import { reescreverEmail } from "@/lib/emails/service";
import { conferirCampo, estrutura, mascarar, restaurar, variaveisFaltando } from "@/lib/emails/tokens";
import { acaoLabel } from "@/lib/history/labels";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { listEmailTemplates, modeloDe } from "@/lib/nuvemshop/email-templates";
import { RevisaoConfigError } from "@/lib/images/review";

describe("variáveis do e-mail", () => {
  it("mascara e restaura, reaproveitando a numeração entre assunto e corpo", () => {
    const a = mascarar("Pedido {{ order.number }} enviado");
    const c = mascarar('<p>Oi {{ customer.name }}, veja {{ order.number }}. {% if x %}ok{% endif %}</p>', a.variaveis);
    expect(a.texto).toBe("Pedido ⟦0⟧ enviado");
    expect(c.texto).toBe("<p>Oi ⟦1⟧, veja ⟦0⟧. ⟦2⟧ok⟦3⟧</p>");
    expect(restaurar(c.texto, c.variaveis)).toBe('<p>Oi {{ customer.name }}, veja {{ order.number }}. {% if x %}ok{% endif %}</p>');
  });

  it("confere variáveis e estrutura HTML", () => {
    const o = mascarar("<p>Oi {{ nome }}, <a href='{{ url }}'>veja</a></p>");
    expect(conferirCampo("Corpo", o, "<p>Olá ⟦0⟧, <a href='⟦1⟧'>acompanhe</a></p>")).toEqual([]);
    expect(conferirCampo("Corpo", o, "<p>Olá, <a href='⟦1⟧'>acompanhe</a></p>")[0]).toMatch(/faltam as variáveis \{\{ nome \}\}/);
    expect(conferirCampo("Corpo", o, "<p>Olá ⟦0⟧ ⟦1⟧ ⟦7⟧</p>").join(" ")).toMatch(/apareceram variáveis|estrutura/);
    expect(conferirCampo("Corpo", o, "<div>Olá ⟦0⟧ <a href='⟦1⟧'>x</a></div>").join(" ")).toMatch(/estrutura/);
    expect(estrutura("<P class=a>x</P><br/>")).toBe("p,/p,br");
  });

  it("variaveisFaltando olha o texto final", () => {
    expect(variaveisFaltando("Oi {{ a }} {{ b }}", "Olá {{ a }}")).toEqual(["{{ b }}"]);
  });
});

/** Cliente Anthropic falso que devolve respostas em sequência. */
const claude = (respostas: Array<{ assunto: string; corpo: string }>) => {
  const pedidos: string[] = [];
  let i = 0;
  const c = {
    beta: {
      messages: {
        create: async (req: { messages: Array<{ content: Array<{ text: string }> }> }) => {
          pedidos.push(req.messages[0]!.content[0]!.text);
          const r = respostas[Math.min(i++, respostas.length - 1)]!;
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 5, output_tokens: 7 } };
        },
      },
    },
  };
  return { client: c as never, pedidos };
};

const original = { rotulo: "Pedido enviado", assunto: "Seu pedido {{ order.number }} saiu", corpo: "<p>Oi {{ customer.name }}, rastreie: <a href='{{ tracking.url }}'>aqui</a></p>" };

describe("reescritor", () => {
  it("manda só marcadores à IA e devolve o texto com as variáveis originais", async () => {
    const { client, pedidos } = claude([{ assunto: "Seu pedido ⟦0⟧ está a caminho", corpo: "<p>Olá, ⟦1⟧! Acompanhe a entrega: <a href='⟦2⟧'>clique aqui</a></p>" }]);
    const r = await criarReescritor(client)(original);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).not.toContain("{{");
    expect(r.assunto).toBe("Seu pedido {{ order.number }} está a caminho");
    expect(r.corpo).toBe("<p>Olá, {{ customer.name }}! Acompanhe a entrega: <a href='{{ tracking.url }}'>clique aqui</a></p>");
    expect(r.avisos).toEqual([]);
  });

  it("se a IA perde uma variável, tenta de novo; se corrige, não há aviso", async () => {
    const { client, pedidos } = claude([
      { assunto: "Seu pedido ⟦0⟧ saiu", corpo: "<p>Olá! <a href='⟦2⟧'>Rastreie</a></p>" },
      { assunto: "Seu pedido ⟦0⟧ saiu", corpo: "<p>Olá, ⟦1⟧! <a href='⟦2⟧'>Rastreie</a></p>" },
    ]);
    const r = await criarReescritor(client)(original);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).toMatch(/ATENÇÃO.*faltam as variáveis/);
    expect(r.avisos).toEqual([]);
    expect(r.corpo).toContain("{{ customer.name }}");
  });

  it("se continua errado, devolve o aviso em vez de esconder", async () => {
    const { client } = claude([{ assunto: "Saiu ⟦0⟧", corpo: "<p>Olá!</p>" }]);
    const r = await criarReescritor(client)(original);
    expect(r.avisos.join(" ")).toMatch(/faltam as variáveis \{\{ customer\.name \}\}, \{\{ tracking\.url \}\}/);
  });

  it("sem assunto no original, devolve assunto vazio", async () => {
    const { client } = claude([{ assunto: "inventado", corpo: "<p>Oi ⟦0⟧</p>" }]);
    const r = await criarReescritor(client)({ rotulo: "x", assunto: "", corpo: "<p>Oi {{ a }}</p>" });
    expect(r.assunto).toBe("");
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

describe("reescritas guardadas", () => {
  const ok = async () => ({ assunto: "Novo {{ a }}", corpo: "<p>Novo {{ a }}</p>", avisos: [], entrada: 1, saida: 2 });

  it("guarda, audita, edita (recalcula o aviso), marca como colado e descarta", async () => {
    const s = await reescreverEmail(db, { storeId, actor: "a@b.c", key: "manual:pedido_enviado", label: "Pedido enviado", assunto: "Velho {{ a }}", corpo: "<p>Velho {{ a }}</p>", reescritor: ok });
    expect(s).toMatchObject({ subject: "Novo {{ a }}", warning: null, error: null, applied_at: null });
    expect((await pg.query("SELECT acao, sucesso FROM audit_log")).rows).toEqual([{ acao: "email.reescrever", sucesso: true }]);

    const e = await editarReescrita(db, storeId, s.key, "Novo", "<p>sem variável</p>");
    expect(e).toMatchObject({ edited: true, warning: "Faltam as variáveis {{ a }}" });
    const e2 = await editarReescrita(db, storeId, s.key, "Novo {{ a }}", "<p>{{ a }}</p>");
    expect(e2?.warning).toBeNull();

    expect(await marcarColado(db, storeId, s.key, true)).toBe(true);
    expect((await listarSugestoes(db, storeId))[0]!.applied_at).not.toBeNull();
    // reescrever de novo zera "colado"
    await reescreverEmail(db, { storeId, actor: "a@b.c", key: s.key, label: "Pedido enviado", assunto: "Velho {{ a }}", corpo: "<p>Velho {{ a }}</p>", reescritor: ok });
    expect((await listarSugestoes(db, storeId))[0]!.applied_at).toBeNull();
    expect(await descartar(db, storeId, s.key)).toBe(true);
    expect(await descartar(db, storeId, s.key)).toBe(false);
    expect(acaoLabel("email.reescrever")).toMatch(/E-mail/);
  });

  it("erro da IA fica gravado no item; erro de configuração sobe", async () => {
    const s = await reescreverEmail(db, { storeId, actor: "a", key: "k", label: "L", assunto: "", corpo: "<p>x</p>", reescritor: async () => { throw new Error("falhou"); } });
    expect(s.error).toBe("falhou");
    expect(await editarReescrita(db, storeId, "k", "", "<p>y</p>")).toBeNull(); // item com erro não é editável
    await expect(reescreverEmail(db, { storeId, actor: "a", key: "k2", label: "L", assunto: "", corpo: "x", reescritor: async () => { throw new RevisaoConfigError("sem chave"); } })).rejects.toBeInstanceOf(RevisaoConfigError);
  });
});

describe("modelos de e-mail da loja", () => {
  it("reconhece campos como string ou multi-idioma e ignora o que não tem texto", async () => {
    expect(modeloDe({ id: 1, name: { pt: "Pedido enviado" }, subject: { pt: "Saiu!" }, body: "<p>x</p>" })).toEqual({ id: "1", nome: "Pedido enviado", assunto: "Saiu!", corpo: "<p>x</p>" });
    expect(modeloDe({ id: 2, type: "order_paid", content: { es: "hola" } })).toMatchObject({ id: "2", nome: "order_paid", corpo: "hola" });
    expect(modeloDe({ id: 3 })).toBeNull();
    expect(modeloDe("x")).toBeNull();
    const c = { paginate: async function* () { yield { items: [{ id: 1, subject: "A", html: "<p>b</p>" }, { id: 2, foo: 1 }] }; } } as unknown as NuvemshopClient;
    const r = await listEmailTemplates(c);
    expect(r.items).toHaveLength(1);
    expect(r).toMatchObject({ semTexto: 1, campos: ["foo", "html", "id", "subject"] });
  });
});
