import { describe, expect, it, vi } from "vitest";
import { NuvemshopClient, backoffMs, parseNextPage, type Logger } from "@/lib/nuvemshop/client";
import { NuvemshopError } from "@/lib/nuvemshop/errors";

const silent: Logger = { info() {}, warn() {}, error() {} };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function makeClient(fetchMock: typeof fetch, extra: Partial<ConstructorParameters<typeof NuvemshopClient>[0]> = {}) {
  const sleeps: number[] = [];
  const client = new NuvemshopClient({
    storeId: 123,
    accessToken: "tok_secret",
    userAgent: "INuvem (contato@exemplo.com)",
    limiter: null,
    logger: silent,
    fetch: fetchMock,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { client, sleeps };
}

describe("NuvemshopClient", () => {
  it("envia os headers corretos (Authentication, User-Agent) e monta a URL", async () => {
    const fetchMock = vi.fn(async () => json({ id: 1 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    await client.get("/products/1");
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.nuvemshop.com.br/v1/123/products/1");
    const h = init.headers as Record<string, string>;
    expect(h.Authentication).toBe("bearer tok_secret");
    expect(h["User-Agent"]).toBe("INuvem (contato@exemplo.com)");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h).not.toHaveProperty("Authorization");
  });

  it("repete em 429 usando x-rate-limit-reset e depois tem sucesso", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "slow down" }, { status: 429, headers: { "x-rate-limit-reset": "1500" } }))
      .mockResolvedValueOnce(json({ ok: true })) as unknown as typeof fetch;
    const { client, sleeps } = makeClient(fetchMock);
    expect(await client.get("/products")).toEqual({ ok: true });
    expect(sleeps).toEqual([1500]);
  });

  it("repete GET em 5xx com backoff e desiste após maxRetries", async () => {
    const fetchMock = vi.fn(async () => json({ message: "boom" }, { status: 503 })) as unknown as typeof fetch;
    const { client, sleeps } = makeClient(fetchMock, { maxRetries: 2 });
    await expect(client.get("/products")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it("NÃO repete POST em 5xx (evita duplicar criação)", async () => {
    const fetchMock = vi.fn(async () => json({ message: "boom" }, { status: 502 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    await expect(client.post("/products", { name: { pt: "x" } })).rejects.toBeInstanceOf(NuvemshopError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repete POST em 429 (requisição foi rejeitada, não aplicada)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, { status: 429 }))
      .mockResolvedValueOnce(json({ id: 9 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    expect(await client.post("/products", {})).toEqual({ id: 9 });
  });

  it("não repete 4xx e expõe a mensagem da API em pt-BR", async () => {
    const fetchMock = vi.fn(async () =>
      json({ code: 422, message: "Unprocessable", description: "sku já existe" }, { status: 422 }),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    const err = (await client.post("/products", {}).catch((e) => e)) as NuvemshopError;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(422);
    expect(err.userMessage).toContain("sku já existe");
  });

  it("nunca vaza o token em erros ou logs", async () => {
    const logs: string[] = [];
    const logger: Logger = {
      info: (e) => logs.push(JSON.stringify(e)),
      warn: (e) => logs.push(JSON.stringify(e)),
      error: (e) => logs.push(JSON.stringify(e)),
    };
    const fetchMock = vi.fn(async () => json({ message: "no" }, { status: 401 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock, { logger });
    const err = (await client.get("/products").catch((e) => e)) as NuvemshopError;
    expect(JSON.stringify([logs, err.message, err.userMessage])).not.toContain("tok_secret");
  });

  it("pagina até acabar usando o header Link e devolve x-total-count", async () => {
    const link = (p: number) => `<https://api.nuvemshop.com.br/v1/123/products?page=${p}&per_page=2>; rel="next"`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([{ id: 1 }, { id: 2 }], { headers: { link: link(2), "x-total-count": "3" } }))
      .mockResolvedValueOnce(json([{ id: 3 }], { headers: { "x-total-count": "3" } })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    const ids: number[] = [];
    for await (const page of client.paginate<{ id: number }>("/products", {}, 2)) ids.push(...page.items.map((i) => i.id));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("trata 404 em listagem como página vazia", async () => {
    const fetchMock = vi.fn(async () => json({ description: "Last page is 0" }, { status: 404 })) as unknown as typeof fetch;
    const { client } = makeClient(fetchMock);
    expect((await client.getPage("/products")).items).toEqual([]);
  });

  it("pausa as próximas chamadas quando o balde está quase vazio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([], { headers: { "x-rate-limit-remaining": "0", "x-rate-limit-reset": "800" } }))
      .mockResolvedValueOnce(json([])) as unknown as typeof fetch;
    const { client, sleeps } = makeClient(fetchMock);
    await client.get("/a");
    await client.get("/b");
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(800);
  });
});

describe("helpers", () => {
  it("parseNextPage", () => {
    expect(parseNextPage(null)).toBeNull();
    expect(parseNextPage('<https://x/y?page=3&per_page=50>; rel="next", <https://x/y?page=9>; rel="last"')).toBe(3);
    expect(parseNextPage('<https://x/y?page=9>; rel="last"')).toBeNull();
  });
  it("backoff cresce e é limitado", () => {
    expect(backoffMs(0, () => 0)).toBe(250);
    expect(backoffMs(10, () => 1)).toBe(8000);
  });
});
