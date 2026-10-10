import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { MAGIC_LINK_LIMITS, checkMagicLinkLimits, clientIp, hit } from "@/lib/rate-limit";
import { isSameOrigin, mayConnectStore } from "@/lib/security";
import { MAX_UPLOAD_BYTES, safeFilename, sniffImageType, validateImageUpload } from "@/lib/catalog/images";
import { readFileSync } from "node:fs";
import type { Db } from "@/lib/sync/repo";

const req = (headers: Record<string, string>) => new Request("https://painel.example/api/sync", { method: "POST", headers });

describe("isSameOrigin (CSRF em rotas POST)", () => {
  it("aceita a própria origem e requisições sem Origin (curl, servidor)", () => {
    expect(isSameOrigin(req({ origin: "https://painel.example", host: "painel.example" }))).toBe(true);
    expect(isSameOrigin(req({ host: "painel.example" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://painel.example", "x-forwarded-host": "painel.example", host: "interno:3000" }))).toBe(true);
  });
  it("recusa outro site, Sec-Fetch-Site cross-site e Origin inválido", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "painel.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://painel.example.evil.com", host: "painel.example" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site", host: "painel.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "não é url", host: "painel.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "painel.example" }))).toBe(false);
  });
});

describe("mayConnectStore (callback do OAuth)", () => {
  it("só aceita a mesma loja depois de conectada", () => {
    expect(mayConnectStore(null, 123)).toBe(true);
    expect(mayConnectStore(undefined, 123)).toBe(true);
    expect(mayConnectStore("123", 123)).toBe(true); // bigint chega como string
    expect(mayConnectStore("123", 999)).toBe(false);
  });
});

describe("upload de imagem: o conteúdo manda, não o tipo declarado", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("reconhece JPEG, PNG, GIF e WEBP pelos primeiros bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0]))).toBe("image/webp");
  });
  it("recusa o que se passa por imagem", () => {
    const text = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00);
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0]); // RIFF, mas não WEBP
    expect(sniffImageType(text)).toBeNull();
    expect(sniffImageType(exe)).toBeNull();
    expect(sniffImageType(wav)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
  it("o nome do arquivo usa a extensão do tipo real e não deixa caminho nem script", () => {
    expect(safeFilename("../../etc/passwd.php", "image/jpeg")).toBe("passwd.jpg");
    expect(safeFilename("<script>.svg", "image/png")).toBe("script.png");
    expect(validateImageUpload({ type: "image/svg+xml", size: 10 })).toMatch(/Formato/);
    expect(validateImageUpload({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/4 MB/);
  });
});

describe("filtro de sessão (proxy.ts)", () => {
  // O `matcher` precisa ser um literal estático no proxy.ts (o Next não aceita importar), então lemos o literal do arquivo.
  // O Next compila o matcher como expressão regular ancorada; aqui fazemos o mesmo.
  const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  const literal = /matcher: \[\s*(?:\/\/[^\n]*\n\s*)?("(?:[^"\\]|\\.)*"),\s*\]/s.exec(source)?.[1];
  const re = new RegExp(`^${JSON.parse(literal ?? '"(?!)"')}$`);
  it("encontra o matcher no proxy.ts", () => expect(literal).toBeTruthy());
  const protegido = (path: string) => re.test(path);

  it("protege as páginas e as rotas do painel", () => {
    for (const p of ["/", "/produtos", "/produtos/12", "/lote/novo", "/lote/abc", "/categorias", "/historico", "/api/bulk/abc/step", "/api/nuvemshop/register-webhooks", "/api/nuvemshop/connect"]) {
      expect(protegido(p), p).toBe(true);
    }
  });
  it("só exclui o que tem autenticação própria, e só o caminho exato (sem prefixo solto)", () => {
    for (const p of ["/login", "/login/", "/api/auth/sign-in/magic-link", "/api/cron/sync", "/api/health", "/api/sync", "/api/webhooks/nuvemshop", "/api/nuvemshop/webhooks/store-redact", "/api/nuvemshop/callback", "/api/loja/selos", "/api/loja/selos.js", "/_next/static/a.js", "/favicon.ico"]) {
      expect(protegido(p), p).toBe(false);
    }
    for (const p of ["/login-qualquer-coisa", "/loginx", "/api/syncx", "/api/healthz", "/api/authx", "/api/webhooksx", "/api/nuvemshop/callbackx", "/api/lojax", "/api/lojas", "/favicon.icon"]) {
      expect(protegido(p), p).toBe(true);
    }
  });
});

describe("limite de pedidos de link de acesso", () => {
  let db: Db;
  let pg: PGlite;
  beforeEach(async () => {
    pg = new PGlite();
    db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
    await runMigrations(
      { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
      loadMigrations(join(process.cwd(), "db/migrations")),
    );
  });

  it("conta por janela fixa e reinicia quando a janela passa", async () => {
    expect(await hit(db, "k", 60)).toBe(1);
    expect(await hit(db, "k", 60)).toBe(2);
    expect(await hit(db, "outra", 60)).toBe(1);
    await pg.query("UPDATE rate_limits SET window_start = now() - interval '2 minutes' WHERE key = 'k'");
    expect(await hit(db, "k", 60)).toBe(1);
  });

  it("bloqueia o IP depois do limite, sem consumir o limite global", async () => {
    const { perIp } = MAGIC_LINK_LIMITS;
    for (let i = 0; i < perIp.max; i++) expect((await checkMagicLinkLimits(db, "1.1.1.1")).ok).toBe(true);
    expect(await checkMagicLinkLimits(db, "1.1.1.1")).toEqual({ ok: false, retryAfterSeconds: perIp.windowSeconds });
    expect((await checkMagicLinkLimits(db, "2.2.2.2")).ok).toBe(true); // outro IP segue livre
    const g = await pg.query<{ hits: number }>("SELECT hits FROM rate_limits WHERE key = 'magic:global'");
    expect(g.rows[0]!.hits).toBe(perIp.max + 1); // só os pedidos aceitos por IP contam no global
  });

  it("bloqueia no teto global mesmo com IPs diferentes", async () => {
    const { global } = MAGIC_LINK_LIMITS;
    await pg.query("INSERT INTO rate_limits (key, window_start, hits) VALUES ('magic:global', now(), $1)", [global.max]);
    expect(await checkMagicLinkLimits(db, "9.9.9.9")).toEqual({ ok: false, retryAfterSeconds: global.windowSeconds });
  });

  it("limpa janelas antigas e extrai o IP do cabeçalho", async () => {
    await pg.query("INSERT INTO rate_limits (key, window_start, hits) VALUES ('velha', now() - interval '3 days', 1)");
    await checkMagicLinkLimits(db, "3.3.3.3");
    expect((await pg.query("SELECT 1 FROM rate_limits WHERE key = 'velha'")).rows).toHaveLength(0);
    expect(clientIp(new Request("https://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }))).toBe("203.0.113.7");
    expect(clientIp(new Request("https://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("https://x"))).toBe("desconhecido");
    expect(clientIp(new Request("https://x", { headers: { "x-forwarded-for": "a".repeat(200) } })).length).toBe(64);
  });
});
