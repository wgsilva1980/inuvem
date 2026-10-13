import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { listaOculta, montarArquivo } from "@/lib/menu/arquivo";
import { ARQUIVO_DE_REFERENCIA, enviarArquivoFtp, lerConfigFtp, mensagemFtp, type ClienteFtp, type ConfigFtp } from "@/lib/menu/ftp";
import { ACAO_ARQUIVO_MENU, atualizarMenuSeLigado, estadoDoMenu, restaurarVersaoAnterior, salvarMenuAutomatico, sincronizarArquivoDoMenu, type DepsMenu } from "@/lib/menu/service";
import { acaoLabel } from "@/lib/history/labels";
import type { Category } from "@/lib/nuvemshop/types";
import { upsertCategories, type Db } from "@/lib/sync/repo";
import { handleWebhook, type ResourceApi } from "@/lib/webhooks/handler";

let pg: PGlite;
let db: Db;
let storeId: string;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const cat = (id: number, nome: string, handle: string, parent = 0, visibility: "visible" | "hidden" = "visible"): Category =>
  ({ id, name: { pt: nome }, handle: { pt: handle }, parent, visibility }) as unknown as Category;

describe("montarArquivo", () => {
  it("segue o modelo exato, com a lista indentada, aspas simples e sem vírgula no fim", () => {
    expect(montarArquivo(["blusas-e-camisetas/casaco", "conjuntos"])).toBe(`{# Gerado pelo painel INuvem. Não edite à mão: o arquivo é sobrescrito a cada atualização. #}
{% macro is_hidden(url) %}
{% set hidden_menu_paths = [
    'blusas-e-camisetas/casaco',
    'conjuntos'
] %}
{% set menu_path = url | split('://') | last | split('/') | slice(1) | join('/') | trim('/') %}
{% if menu_path in hidden_menu_paths %}1{% endif %}
{% endmacro %}
`);
  });
  it("sem categorias ocultas a lista é []", () => {
    expect(montarArquivo([])).toContain("{% set hidden_menu_paths = [] %}");
  });
});

describe("listaOculta", () => {
  it("monta o caminho completo da subcategoria, ordena, ignora as visíveis e descarta endereços inválidos", async () => {
    await upsertCategories(db, storeId, [
      cat(1, "Blusas e Camisetas", "blusas-e-camisetas"),
      cat(2, "Casaco", "casaco", 1, "hidden"),
      cat(3, "Conjuntos", "conjuntos", 0, "hidden"),
      cat(4, "Macacões e Jardineiras", "macacoes-e-jardineiras", 0, "hidden"),
      cat(5, "Vestidos", "vestidos"),
      cat(6, "Acentuada", "Promoção Especial", 0, "hidden"),
      cat(7, "Sem endereço", "", 0, "hidden"),
    ]);
    const r = await listaOculta(db, storeId);
    expect(r.caminhos).toEqual(["blusas-e-camisetas/casaco", "conjuntos", "macacoes-e-jardineiras"]);
    expect(r.descartadas.sort()).toEqual(["Acentuada", "Sem endereço"]);
  });
  it("subcategoria cujo pai não está no espelho é descartada (caminho incompleto)", async () => {
    await upsertCategories(db, storeId, [cat(2, "Casaco", "casaco", 99, "hidden")]);
    expect((await listaOculta(db, storeId)).caminhos).toEqual([]);
  });
});

describe("lerConfigFtp", () => {
  it("lista o que falta e usa padrões (FTPS explícito na 21; implícito na 990)", () => {
    expect(lerConfigFtp({ FTP_HOST: "h" }).faltando).toEqual(["FTP_USER", "FTP_PASSWORD", "FTP_MENU_DIR"]);
    const base = { FTP_HOST: " ftp.x.com ", FTP_USER: "u", FTP_PASSWORD: "p w", FTP_MENU_DIR: "/tema/snipplets/navigation/" };
    expect(lerConfigFtp(base).config).toMatchObject({ host: "ftp.x.com", port: 21, secure: "explicit", dir: "/tema/snipplets/navigation", password: "p w", verificarCertificado: true });
    expect(lerConfigFtp({ ...base, FTP_SECURE: "implicit" }).config).toMatchObject({ port: 990, secure: "implicit" });
    expect(lerConfigFtp({ ...base, FTP_PORT: "2121", FTP_VERIFICAR_CERTIFICADO: "nao" }).config).toMatchObject({ port: 2121, verificarCertificado: false });
  });
  it("as mensagens de erro nunca trazem a senha", () => {
    expect(mensagemFtp({ code: 530, message: "530 Login incorrect for senha-secreta" })).not.toContain("senha-secreta");
    expect(mensagemFtp({ code: "ENOTFOUND" })).toMatch(/FTP_HOST/);
  });
});

const config: ConfigFtp = { host: "h", port: 21, user: "u", password: "senha-secreta", secure: "explicit", dir: "/tema/snipplets/navigation", verificarCertificado: true };

function ftpFalso(opcoes: { arquivos?: string[]; renameFalhaNaPrimeira?: boolean; tamanho?: number; falhaAcesso?: unknown } = {}) {
  const chamadas: string[] = [];
  const conteudos = new Map<string, string>();
  let renames = 0;
  const cliente: ClienteFtp = {
    access: async (o) => {
      chamadas.push(`access:${o.host}:${o.port}:${String(o.secure)}:${o.secureOptions?.rejectUnauthorized}`);
      if (opcoes.falhaAcesso) throw opcoes.falhaAcesso;
    },
    cd: async (d) => void chamadas.push(`cd:${d}`),
    list: async () => (opcoes.arquivos ?? [ARQUIVO_DE_REFERENCIA, "navigation.tpl"]).map((name) => ({ name })),
    uploadFrom: async (stream, destino) => {
      const partes: Buffer[] = [];
      for await (const p of stream) partes.push(Buffer.from(p));
      conteudos.set(destino, Buffer.concat(partes).toString("utf8"));
      chamadas.push(`upload:${destino}`);
    },
    size: async (nome) => opcoes.tamanho ?? Buffer.byteLength(conteudos.get(nome) ?? ""),
    rename: async (de, para) => {
      chamadas.push(`rename:${de}->${para}`);
      if (opcoes.renameFalhaNaPrimeira && renames++ === 0) throw new Error("550 destino existe");
      conteudos.set(para, conteudos.get(de) ?? "");
      conteudos.delete(de);
    },
    remove: async (nome) => {
      chamadas.push(`remove:${nome}`);
      conteudos.delete(nome);
    },
    close: () => void chamadas.push("close"),
  };
  return { cliente, chamadas, conteudos };
}

describe("enviarArquivoFtp", () => {
  it("confere a pasta, envia com .tmp, confere o tamanho e renomeia (UTF-8)", async () => {
    const f = ftpFalso();
    await enviarArquivoFtp(config, "hidden-menu-urls.tpl", "á é", () => f.cliente);
    expect(f.chamadas).toEqual(["access:h:21:true:true", "cd:/tema/snipplets/navigation", "upload:hidden-menu-urls.tpl.tmp", "rename:hidden-menu-urls.tpl.tmp->hidden-menu-urls.tpl", "close"]);
    expect(f.conteudos.get("hidden-menu-urls.tpl")).toBe("á é");
  });
  it("TLS implícito e certificado não verificado seguem a configuração", async () => {
    const f = ftpFalso();
    await enviarArquivoFtp({ ...config, secure: "implicit", port: 990, verificarCertificado: false }, "a.tpl", "x", () => f.cliente);
    expect(f.chamadas[0]).toBe("access:h:990:implicit:false");
  });
  it("pasta errada (sem navigation-top.tpl): não grava nada", async () => {
    const f = ftpFalso({ arquivos: ["outro.tpl"] });
    await expect(enviarArquivoFtp(config, "a.tpl", "x", () => f.cliente)).rejects.toThrow(/navigation-top\.tpl.*FTP_MENU_DIR/);
    expect(f.chamadas.some((c) => c.startsWith("upload"))).toBe(false);
    expect(f.chamadas.at(-1)).toBe("close");
  });
  it("servidor que não renomeia por cima: apaga o antigo e renomeia", async () => {
    const f = ftpFalso({ renameFalhaNaPrimeira: true });
    await enviarArquivoFtp(config, "a.tpl", "x", () => f.cliente);
    expect(f.chamadas).toContain("remove:a.tpl");
    expect(f.conteudos.get("a.tpl")).toBe("x");
  });
  it("tamanho diferente: apaga o .tmp e não publica", async () => {
    const f = ftpFalso({ tamanho: 1 });
    await expect(enviarArquivoFtp(config, "a.tpl", "conteúdo grande", () => f.cliente)).rejects.toThrow(/tamanho diferente/);
    expect(f.chamadas).toContain("remove:a.tpl.tmp");
    expect(f.chamadas.some((c) => c.startsWith("rename"))).toBe(false);
  });
  it("login recusado vira mensagem em português", async () => {
    const f = ftpFalso({ falhaAcesso: Object.assign(new Error("530 Login incorrect"), { code: 530 }) });
    await expect(enviarArquivoFtp(config, "a.tpl", "x", () => f.cliente)).rejects.toThrow(/usuário ou a senha/);
  });
});

function depsFalsas(opcoes: { falha?: string; espera?: Promise<void> } = {}) {
  const enviados: Array<{ nome: string; conteudo: string }> = [];
  const deps: DepsMenu = {
    enviar: async (nome, conteudo) => {
      await opcoes.espera;
      if (opcoes.falha) throw new Error(opcoes.falha);
      enviados.push({ nome, conteudo });
    },
  };
  return { deps, enviados };
}

describe("sincronizarArquivoDoMenu", () => {
  it("envia na primeira vez, não reenvia sem mudança, guarda a versão anterior e registra no Histórico", async () => {
    await upsertCategories(db, storeId, [cat(1, "Conjuntos", "conjuntos", 0, "hidden"), cat(2, "Vestidos", "vestidos")]);
    const { deps, enviados } = depsFalsas();
    expect(await sincronizarArquivoDoMenu(db, deps, { storeId })).toMatchObject({ estado: "enviado", caminhos: 1 });
    expect(await sincronizarArquivoDoMenu(db, deps, { storeId })).toMatchObject({ estado: "sem_mudanca" });
    expect(enviados).toHaveLength(1);

    await upsertCategories(db, storeId, [cat(2, "Vestidos", "vestidos", 0, "hidden")]);
    expect(await sincronizarArquivoDoMenu(db, deps, { storeId })).toMatchObject({ estado: "enviado", caminhos: 2 });
    const estado = await estadoDoMenu(db, storeId);
    expect(estado.conteudo).toContain("'vestidos'");
    expect(estado.anterior).toBe(montarArquivo(["conjuntos"]));
    expect(estado.erro).toBeNull();
    const log = (await pg.query<{ acao: string; sucesso: boolean }>("SELECT acao, sucesso FROM audit_log ORDER BY id")).rows;
    expect(log).toEqual([{ acao: ACAO_ARQUIVO_MENU, sucesso: true }, { acao: ACAO_ARQUIVO_MENU, sucesso: true }]);
    expect(acaoLabel(ACAO_ARQUIVO_MENU)).not.toBe(ACAO_ARQUIVO_MENU);
  });

  it("forcar reenvia mesmo sem mudança", async () => {
    const { deps, enviados } = depsFalsas();
    await sincronizarArquivoDoMenu(db, deps, { storeId });
    await sincronizarArquivoDoMenu(db, deps, { storeId, forcar: true });
    expect(enviados).toHaveLength(2);
  });

  it("falha: registra o erro e não marca como enviado; as automáticas esperam 5 min, a manual tenta na hora", async () => {
    await upsertCategories(db, storeId, [cat(1, "Conjuntos", "conjuntos", 0, "hidden")]);
    const ruim = depsFalsas({ falha: "530 Login incorrect" });
    expect(await sincronizarArquivoDoMenu(db, ruim.deps, { storeId })).toMatchObject({ estado: "falhou", erro: expect.stringContaining("usuário ou a senha") });
    expect((await estadoDoMenu(db, storeId)).conteudo).toBeNull();
    expect(await sincronizarArquivoDoMenu(db, ruim.deps, { storeId })).toMatchObject({ estado: "aguardando" });
    const bom = depsFalsas();
    expect(await sincronizarArquivoDoMenu(db, bom.deps, { storeId, forcar: true })).toMatchObject({ estado: "enviado" });
    expect((await estadoDoMenu(db, storeId)).erro).toBeNull();
    expect((await pg.query("SELECT 1 FROM audit_log WHERE NOT sucesso")).rows).toHaveLength(1);
  });

  it("dois envios ao mesmo tempo: o segundo vê a trava e não envia", async () => {
    let liberar!: () => void;
    const espera = new Promise<void>((r) => (liberar = r));
    const lento = depsFalsas({ espera });
    const primeiro = sincronizarArquivoDoMenu(db, lento.deps, { storeId, forcar: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(await sincronizarArquivoDoMenu(db, depsFalsas().deps, { storeId, forcar: true })).toMatchObject({ estado: "em_andamento" });
    liberar();
    expect((await primeiro).estado).toBe("enviado");
    // a trava é liberada no fim
    expect((await sincronizarArquivoDoMenu(db, depsFalsas().deps, { storeId })).estado).toBe("sem_mudanca");
  });

  it("restaurarVersaoAnterior reenvia o conteúdo anterior e troca os dois", async () => {
    await upsertCategories(db, storeId, [cat(1, "Conjuntos", "conjuntos", 0, "hidden")]);
    const { deps, enviados } = depsFalsas();
    expect(await restaurarVersaoAnterior(db, deps, { storeId, actor: "dono@exemplo.com" })).toMatchObject({ estado: "falhou", erro: expect.stringContaining("versão anterior") });
    await sincronizarArquivoDoMenu(db, deps, { storeId });
    await upsertCategories(db, storeId, [cat(1, "Conjuntos", "conjuntos", 0, "visible")]);
    await sincronizarArquivoDoMenu(db, deps, { storeId });
    expect(await restaurarVersaoAnterior(db, deps, { storeId, actor: "dono@exemplo.com" })).toMatchObject({ estado: "enviado" });
    expect(enviados.at(-1)!.conteudo).toBe(montarArquivo(["conjuntos"]));
    expect((await estadoDoMenu(db, storeId)).anterior).toBe(montarArquivo([]));
  });
});

describe("atualizarMenuSeLigado", () => {
  it("não faz nada com a opção desligada nem sem FTP configurado; com tudo pronto, envia", async () => {
    const { deps, enviados } = depsFalsas();
    expect(await atualizarMenuSeLigado(db, storeId, "x", deps)).toBeNull();
    await salvarMenuAutomatico(db, storeId, true, "dono@exemplo.com");
    expect(await atualizarMenuSeLigado(db, storeId, "x", null)).toBeNull();
    expect(await atualizarMenuSeLigado(db, storeId, "x", deps)).toMatchObject({ estado: "enviado" });
    expect(enviados).toHaveLength(1);
  });
  it("nunca lança, mesmo com o banco falhando", async () => {
    const quebrado: Db = { query: async () => { throw new Error("banco fora"); } };
    expect(await atualizarMenuSeLigado(quebrado, storeId, "x", depsFalsas().deps)).toBeNull();
  });
});

describe("webhook de categoria", () => {
  const SECRET = "segredo";
  it("depois de atualizar a categoria (ex.: ocultada no admin da loja) avisa para atualizar o arquivo de menu", async () => {
    await upsertCategories(db, storeId, [cat(1, "Conjuntos", "conjuntos")]);
    const api: ResourceApi = { getProduct: async () => { throw new Error("x"); }, getCategory: async () => cat(1, "Conjuntos", "conjuntos", 0, "hidden") };
    const avisos: string[] = [];
    const raw = JSON.stringify({ store_id: 1, event: "category/updated", id: 1 });
    const r = await handleWebhook(
      { db, clientSecret: SECRET, findStore: async () => ({ id: storeId, nuvemshop_store_id: "1" }), apiFor: async () => api, aoMudarCategorias: async (s) => void avisos.push(s.id), log: () => undefined },
      raw,
      createHmac("sha256", SECRET).update(raw).digest("hex"),
    );
    expect(r.status).toBe(200);
    expect(avisos).toEqual([storeId]);
    expect((await listaOculta(db, storeId)).caminhos).toEqual(["conjuntos"]);
  });
});
