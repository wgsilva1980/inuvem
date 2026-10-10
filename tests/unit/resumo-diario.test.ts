import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import type { PainelDoDia, Tarefa } from "@/lib/dashboard/hoje";
import { EmailConfigError, EmailEnvioError, REMETENTE_PADRAO, configDoEmail, emailConfigurado, enviarEmail } from "@/lib/digest/enviar";
import { montarResumo } from "@/lib/digest/montar";
import { ResumoConfigError, enviarResumoDoDia, obterConfigResumo, salvarConfigResumo } from "@/lib/digest/service";
import { acaoLabel } from "@/lib/history/labels";

const tarefa = (id: string, tom: Tarefa["tom"], quantidade: number, titulo = `Tarefa ${id}`): Tarefa => ({ id, titulo, quantidade, tom, href: `/${id}` });
const painel = (tarefas: Tarefa[], over: Partial<PainelDoDia> = {}): PainelDoDia => ({
  tarefas,
  vendas: { hoje: { pedidos: 0, faturamento: 0, unidades: 0, ticket: 0 }, ontem: { pedidos: 3, faturamento: 1234.5, unidades: 4, ticket: 411.5 }, mediaDiaria: 900 },
  pedidosLidosEm: "2026-10-10T09:00:00Z",
  pedidosDesatualizados: false,
  ...over,
});

describe("montagem do e-mail", () => {
  it("assunto com o que importa, grupos por urgência e links absolutos", () => {
    const r = montarResumo(painel([tarefa("a", "danger", 2, "2 pedidos atrasados"), tarefa("b", "warning", 1), tarefa("c", "info", 5)]), { appUrl: "https://painel.exemplo.com/", dataTexto: "sábado, 10 de outubro de 2026" });
    expect(r.assunto).toBe("INuvem · 1 urgente · 1 de atenção · ontem R$ 1.234,50");
    expect([r.urgentes, r.atencao, r.total]).toEqual([1, 1, 3]);
    expect(r.texto).toMatch(/Urgente:\n- 2 pedidos atrasados: https:\/\/painel\.exemplo\.com\/a/);
    expect(r.texto.indexOf("Urgente:")).toBeLessThan(r.texto.indexOf("Atenção:"));
    expect(r.texto.indexOf("Atenção:")).toBeLessThan(r.texto.indexOf("Para saber:"));
    expect(r.html).toContain('href="https://painel.exemplo.com/a"');
    expect(r.html).toMatch(/R\$\s?1\.234,50/);
  });

  it("tudo em dia e escapa HTML dos títulos", () => {
    expect(montarResumo(painel([]), { appUrl: "https://x.com", dataTexto: "hoje" }).texto).toMatch(/Nada pendente/);
    expect(montarResumo(painel([]), { appUrl: "https://x.com", dataTexto: "hoje" }).assunto).toBe("INuvem · ontem R$ 1.234,50");
    const r = montarResumo(painel([tarefa("a", "info", 1, '<script>alert("x")</script>')]), { appUrl: "https://x.com", dataTexto: "hoje" });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("sem vendas lidas e com pedidos desatualizados", () => {
    expect(montarResumo(painel([], { vendas: null }), { appUrl: "https://x.com", dataTexto: "hoje" }).assunto).toBe("INuvem · tudo em dia");
    expect(montarResumo(painel([], { pedidosDesatualizados: true }), { appUrl: "https://x.com", dataTexto: "hoje" }).texto).toMatch(/desatualizados/);
  });
});

describe("envio pelo Resend", () => {
  it("monta o pedido certo e trata os erros", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const ok = (async (url: string, init: RequestInit) => (chamadas.push({ url, init }), new Response(JSON.stringify({ id: "1" }), { status: 200 }))) as unknown as typeof fetch;
    await enviarEmail({ para: ["a@b.com"], assunto: "Oi", html: "<p>x</p>", texto: "x" }, { apiKey: "re_123", from: REMETENTE_PADRAO }, ok);
    expect(chamadas[0]!.url).toBe("https://api.resend.com/emails");
    expect((chamadas[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_123");
    expect(JSON.parse(chamadas[0]!.init.body as string)).toEqual({ from: REMETENTE_PADRAO, to: ["a@b.com"], subject: "Oi", html: "<p>x</p>", text: "x" });
    const negado = (async () => new Response(JSON.stringify({ message: "domínio não verificado" }), { status: 403 })) as unknown as typeof fetch;
    const parcial = (async (_u: unknown, init?: RequestInit) => (String(init?.body).includes("fora@x.com") ? new Response(JSON.stringify({ message: "só para o dono" }), { status: 403 }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const r = await enviarEmail({ para: ["dono@x.com", "fora@x.com"], assunto: "", html: "", texto: "" }, { apiKey: "k", from: "f" }, parcial);
    expect(r.enviados).toEqual(["dono@x.com"]);
    expect(r.falhas).toHaveLength(1);
    await expect(enviarEmail({ para: ["a@b.com"], assunto: "", html: "", texto: "" }, { apiKey: "k", from: "f" }, negado)).rejects.toThrow(/recusou \(403\).*domínio não verificado/);
    const caiu = (async () => { throw new Error("rede"); }) as unknown as typeof fetch;
    await expect(enviarEmail({ para: ["a@b.com"], assunto: "", html: "", texto: "" }, { apiKey: "k", from: "f" }, caiu)).rejects.toBeInstanceOf(EmailEnvioError);
    const erro500 = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await expect(enviarEmail({ para: ["a@b.com"], assunto: "", html: "", texto: "" }, { apiKey: "k", from: "f" }, erro500)).rejects.toThrow(/500/);
  });

  it("configuração: exige a chave e aceita remetente próprio", () => {
    expect(() => configDoEmail({})).toThrow(EmailConfigError);
    expect(emailConfigurado({ RESEND_API_KEY: " " })).toBe(false);
    expect(configDoEmail({ RESEND_API_KEY: "k" })).toEqual({ apiKey: "k", from: REMETENTE_PADRAO });
    expect(configDoEmail({ RESEND_API_KEY: "k", RESEND_FROM: "X <x@y.com>" }).from).toBe("X <x@y.com>");
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";
beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  await pg.query("INSERT INTO admins (email) VALUES ('dona@loja.com'), ('socio@loja.com')");
});

describe("configuração do resumo", () => {
  it("só aceita administradores, normaliza, limita e exige destinatário para ligar", async () => {
    const ok = await salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["  Dona@Loja.com ", "dona@loja.com"], onlyIfAction: true });
    expect(ok).toMatchObject({ enabled: true, recipients: ["dona@loja.com"], onlyIfAction: true });
    await expect(salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["estranho@fora.com"], onlyIfAction: false })).rejects.toThrow(/Só administradores.*estranho@fora\.com/);
    await expect(salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: [], onlyIfAction: false })).rejects.toThrow(ResumoConfigError);
    await expect(salvarConfigResumo(db, { storeId, actor, enabled: false, recipients: ["não é e-mail"], onlyIfAction: false })).rejects.toThrow(/não parece válido/);
    await expect(salvarConfigResumo(db, { storeId, actor, enabled: false, recipients: Array.from({ length: 6 }, (_, i) => `a${i}@x.com`), onlyIfAction: false })).rejects.toThrow(/No máximo 5/);
    expect((await obterConfigResumo(db, storeId)).recipients).toEqual(["dona@loja.com"]); // as tentativas ruins não mudaram nada
  });
});

describe("envio do resumo do dia", () => {
  const appUrl = "https://painel.exemplo.com";
  const agora = new Date("2026-10-10T10:00:00Z"); // 07:00 em Brasília
  const enviados: Array<{ para: string[]; assunto: string }> = [];
  const fetchFalso = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string) as { to: string[]; subject: string };
    enviados.push({ para: b.to, assunto: b.subject });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const config = { apiKey: "k", from: REMETENTE_PADRAO };
  const enviar = (extra: Record<string, unknown> = {}) => enviarResumoDoDia(db, { storeId, actor: "cron", appUrl, agora, config, fetchImpl: fetchFalso, ...extra });
  beforeEach(() => void (enviados.length = 0));

  it("desligado não envia; ligado envia uma vez por dia e registra", async () => {
    expect(await enviar()).toEqual({ enviado: false, motivo: "Resumo desligado." });
    await salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["dona@loja.com", "socio@loja.com"], onlyIfAction: false });
    const r = await enviar();
    expect(r).toMatchObject({ enviado: true, destinatarios: 2 });
    expect(enviados.map((e) => e.para)).toEqual([["dona@loja.com"], ["socio@loja.com"]]); // um e-mail por pessoa
    expect((await obterConfigResumo(db, storeId)).lastSentOn).toBe("2026-10-10");
    expect(await enviar()).toEqual({ enviado: false, motivo: "Já enviado hoje." });
    expect(enviados).toHaveLength(2);
    expect(await enviar({ agora: new Date("2026-10-11T10:00:00Z") })).toMatchObject({ enviado: true }); // no dia seguinte envia de novo
    expect((await pg.query("SELECT acao, sucesso FROM audit_log WHERE acao = 'resumo.enviar'")).rows).toHaveLength(2);
    expect(JSON.stringify((await pg.query("SELECT depois FROM audit_log")).rows)).not.toMatch(/dona@loja|socio@loja/); // o Histórico não guarda e-mails
    expect(acaoLabel("resumo.enviar")).toMatch(/Resumo diário/);
  });

  it("'só com ação' pula quando não há nada urgente nem de atenção", async () => {
    await salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["dona@loja.com"], onlyIfAction: true });
    const r = await enviar();
    expect(r).toMatchObject({ enviado: false, motivo: expect.stringMatching(/Nada urgente/) }); // banco vazio: sem pedidos lidos é só "para saber"
    expect(enviados).toEqual([]);
    expect((await obterConfigResumo(db, storeId)).lastSentOn).toBeNull(); // não conta como enviado
  });

  it("destinatário que deixou de ser administrador não recebe", async () => {
    await salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["dona@loja.com", "socio@loja.com"], onlyIfAction: false });
    await pg.query("DELETE FROM admins WHERE email = 'socio@loja.com'");
    await enviar();
    expect(enviados[0]!.para).toEqual(["dona@loja.com"]);
    await pg.query("DELETE FROM admins");
    expect(await enviar({ manual: true })).toEqual({ enviado: false, motivo: "Nenhum destinatário administrador." });
  });

  it("falha do serviço fica registrada e não marca o dia como enviado; teste manual não conta como o envio do dia", async () => {
    await salvarConfigResumo(db, { storeId, actor, enabled: true, recipients: ["dona@loja.com"], onlyIfAction: false });
    const falha = (async () => new Response(JSON.stringify({ message: "chave inválida" }), { status: 401 })) as unknown as typeof fetch;
    await expect(enviar({ fetchImpl: falha })).rejects.toThrow(/recusou \(401\)/);
    const cfg = await obterConfigResumo(db, storeId);
    expect(cfg.lastSentOn).toBeNull();
    expect(cfg.lastError).toMatch(/401/);
    expect((await pg.query("SELECT sucesso FROM audit_log WHERE acao = 'resumo.enviar'")).rows).toEqual([{ sucesso: false }]);
    // o teste manual envia mesmo desligado/já enviado, com [teste] no assunto, e não altera o dia do último envio automático
    await enviar();
    expect((await obterConfigResumo(db, storeId)).lastError).toBeNull();
    const antes = (await obterConfigResumo(db, storeId)).lastSentOn;
    await enviar({ manual: true });
    expect(enviados.at(-1)!.assunto).toMatch(/^\[teste\] INuvem/);
    expect((await obterConfigResumo(db, storeId)).lastSentOn).toBe(antes);
  });
});
