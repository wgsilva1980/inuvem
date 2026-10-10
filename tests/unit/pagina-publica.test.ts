import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { LIMITE_BYTES, PaginaPublicaError, extrairPagina, hostPermitido, hostsDaLoja, itemDaPagina, lerPaginaPublica, validarEndereco } from "@/lib/seo/pagina-publica";

const HOSTS = ["donatelleconcept.com.br"];

describe("endereço da página", () => {
  it("aceita só o domínio da loja (com ou sem www, com ou sem https)", () => {
    expect(validarEndereco("donatelleconcept.com.br/quem-somos/", HOSTS).toString()).toBe("https://donatelleconcept.com.br/quem-somos/");
    expect(validarEndereco("http://www.donatelleconcept.com.br/termos-de-uso/?utm=1#x", HOSTS).toString()).toBe("https://www.donatelleconcept.com.br/termos-de-uso/");
    expect(hostPermitido("WWW.DonatelleConcept.com.br", HOSTS)).toBe(true);
  });

  it("recusa outros domínios, parecidos, IPs, usuário, porta e esquemas estranhos", () => {
    const ruins = [
      "https://evil.com/quem-somos",
      "https://donatelleconcept.com.br.evil.com/",
      "https://evildonatelleconcept.com.br/",
      "https://donatelleconcept.com.br@evil.com/",
      "https://user:pw@donatelleconcept.com.br/",
      "https://donatelleconcept.com.br:8443/",
      "https://169.254.169.254/latest/meta-data",
      "http://localhost:3000/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "",
      "x".repeat(301),
    ];
    for (const r of ruins) expect(() => validarEndereco(r, HOSTS), r).toThrow(PaginaPublicaError);
    expect(() => validarEndereco("https://donatelleconcept.com.br/", [])).toThrow(PaginaPublicaError);
  });
});

const PAGINA = `<!doctype html><html><head><title>Quem Somos | Donatelle Concept</title><meta name="description" content="Conheça a Donatelle &amp; sua história." /><meta content="Quem somos - Donatelle" property="og:title"><style>.x{}</style><script>var a = 1;</script></head>
<body><header><nav>Menu Produtos</nav></header><main><h1>Quem Somos</h1><p>Somos uma loja de moda feminina.</p><p>Nascemos em 2020 &#38; crescemos.</p><script>x()</script></main><footer>Rodapé Políticas</footer></body></html>`;

describe("extração do texto da página", () => {
  it("tira menu, rodapé, scripts e estilos; lê título e descrição atuais", () => {
    const p = extrairPagina(PAGINA);
    expect(p.nome).toBe("Quem Somos");
    expect(p.tituloAtual).toBe("Quem somos - Donatelle");
    expect(p.descricaoAtual).toBe("Conheça a Donatelle & sua história.");
    expect(p.texto).toBe("Quem Somos\nSomos uma loja de moda feminina.\nNascemos em 2020 & crescemos.");
    expect(p.texto).not.toMatch(/Menu|Rodapé|var a|x\(\)/);
  });

  it("sem <main> usa o corpo; sem h1 usa o <title>; limita o tamanho", () => {
    const p = extrairPagina(`<html><head><title>Trocas | Loja</title></head><body><div>${"palavra ".repeat(1000)}</div></body></html>`);
    expect(p.nome).toBe("Trocas");
    expect(p.texto.length).toBeLessThanOrEqual(3000);
  });

  it("monta o item para o gerador com o conteúdo como referência", () => {
    const i = itemDaPagina({ nome: "Quem Somos", tituloAtual: "T", descricaoAtual: "D", texto: "Olá" });
    expect(i).toMatchObject({ nome: "Quem Somos", seoTituloAtual: "T", seoDescricaoAtual: "D", linhas: ["Conteúdo da página: Olá"] });
    expect(itemDaPagina({ nome: "X", texto: " " }).linhas).toEqual(["Conteúdo da página: (vazio)"]);
  });
});

const html = (corpo: string, init: ResponseInit = {}) => new Response(corpo, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const url = (s: string) => new URL(s);

describe("leitura da página pública", () => {
  it("lê uma página normal e não segue cookies nem envia nada além do pedido", async () => {
    const chamadas: Array<{ u: string; init?: RequestInit }> = [];
    const f = (async (u: string, init?: RequestInit) => (chamadas.push({ u, init }), html(PAGINA))) as unknown as typeof fetch;
    const p = await lerPaginaPublica(url("https://donatelleconcept.com.br/quem-somos/"), HOSTS, f);
    expect(p.nome).toBe("Quem Somos");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.init?.redirect).toBe("manual");
  });

  it("segue redirecionamento dentro do domínio, mas recusa para outro domínio", async () => {
    const dentro = (async (u: string) => (u.endsWith("/antiga/") ? new Response(null, { status: 301, headers: { location: "/quem-somos/" } }) : html(PAGINA))) as unknown as typeof fetch;
    expect((await lerPaginaPublica(url("https://donatelleconcept.com.br/antiga/"), HOSTS, dentro)).nome).toBe("Quem Somos");
    const fora = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } })) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, fora)).rejects.toThrow(/domínio da loja/);
    const loop = (async () => new Response(null, { status: 302, headers: { location: "/y/" } })) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, loop)).rejects.toThrow(/Redirecionamentos demais/);
  });

  it("erros claros: 404, não-HTML, sem texto e falha de rede", async () => {
    const f404 = (async () => html("nada", { status: 404 })) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, f404)).rejects.toThrow(/respondeu 404/);
    const pdf = (async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, pdf)).rejects.toThrow(/não veio HTML/);
    const vazia = (async () => html("<html><body></body></html>")) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, vazia)).rejects.toThrow(/Cole o texto/);
    const cai = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, cai)).rejects.toThrow(/Não consegui abrir/);
  });

  it("não lê além do limite de tamanho", async () => {
    const enorme = (async () => html(`<html><head><title>Grande</title></head><body><main><p>texto</p></main>${"a".repeat(LIMITE_BYTES * 2)}</body></html>`)) as unknown as typeof fetch;
    const p = await lerPaginaPublica(url("https://donatelleconcept.com.br/x/"), HOSTS, enorme);
    expect(p.nome).toBe("Grande");
  });
});

describe("domínio da loja", () => {
  let pg: PGlite;
  let db: Db;
  let storeId: string;
  beforeEach(async () => {
    pg = new PGlite();
    db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
    await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
    storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
  });
  const produto = (id: number, canonical: string | null) => pg.query("INSERT INTO products (store_id, id, name, raw_json) VALUES ($1, $2, 'P', $3::jsonb)", [storeId, id, JSON.stringify(canonical ? { canonical_url: canonical } : {})]);

  it("tira o domínio dos endereços dos produtos, do mais comum ao menos", async () => {
    await produto(1, "https://donatelleconcept.com.br/produtos/a/");
    await produto(2, "https://donatelleconcept.com.br/produtos/b/");
    await produto(3, "https://outra.com.br/produtos/c/");
    await produto(4, null);
    expect(await hostsDaLoja(db, storeId)).toEqual(["donatelleconcept.com.br", "outra.com.br"]);
  });

  it("sem produtos (ou com endereço estranho) devolve vazio", async () => {
    expect(await hostsDaLoja(db, storeId)).toEqual([]);
    await produto(1, "https://exemplo/");
    await produto(2, "https://a b.com/");
    expect(await hostsDaLoja(db, storeId)).toEqual([]);
  });
});
