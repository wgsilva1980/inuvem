import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import sharp from "sharp";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import {
  MENCIONA_MODELO,
  RevisaoConfigError,
  clienteAnthropic,
  criarRevisor,
  estimarCustoUsd,
  fotosPendentes,
  gerarCsvRevisao,
  linhasRevisao,
  resumoRevisao,
  revisarPendentes,
  type Revisao,
  type Revisor,
} from "@/lib/images/review";

let pg: PGlite;
let db: Db;
let storeId: string;
let jpeg: Buffer;

const ok = (alt = "Saia midi azul com fenda frontal", extra: Partial<Revisao> = {}): Revisao => ({ alt, qualidade: 4, problemas: [], observacao: "boa", entrada: 1000, saida: 100, ...extra });

async function produto(id: number, nome: string, imagens: Array<{ id: number; src: string; alt?: unknown }>) {
  await pg.query("INSERT INTO products (store_id, id, name, categories, raw_json) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)", [
    storeId,
    id,
    nome,
    JSON.stringify([{ id: 1, name: { pt: "Saias" } }]),
    JSON.stringify({ images: imagens.map((i, n) => ({ ...i, position: n + 1 })) }),
  ]);
}

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
  jpeg = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#88aacc" } }).jpeg().toBuffer();
});

const baixar = async () => jpeg;
const revisorOk: Revisor & { chamadas: string[] } = Object.assign(
  async (_i: unknown, ctx: { produto: string; posicao: number }) => {
    revisorOk.chamadas.push(`${ctx.produto}#${ctx.posicao}`);
    return ok(`Alt de ${ctx.produto} ${ctx.posicao}`);
  },
  { chamadas: [] as string[] },
);
beforeEach(() => {
  revisorOk.chamadas.length = 0;
});

describe("revisão em lote (só a foto principal)", () => {
  it("revisa uma foto por produto, a de menor posição, com o contexto do produto", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg" }]);
    await produto(2, "Blusa", [{ id: 20, src: "https://x/20.jpg" }]);
    const r = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    expect(r).toMatchObject({ revisadas: 2, erros: 0, restantes: false });
    expect(revisorOk.chamadas.sort()).toEqual(["Blusa#1", "Saia#1"]);
    const res = await resumoRevisao(db, storeId);
    expect(res).toMatchObject({ fotos: 2, revisadas: 2, comErro: 0, entrada: 2000, saida: 200 });
    expect(res.porQualidade[4]).toBe(2);
    expect(await fotosPendentes(db, storeId, 10)).toEqual([]);
  });

  it("a principal é a de menor posição, mesmo fora de ordem no cadastro", async () => {
    await pg.query("INSERT INTO products (store_id, id, name, raw_json) VALUES ($1, 7, 'Vestido', $2::jsonb)", [
      storeId,
      JSON.stringify({ images: [{ id: 71, src: "https://x/71.jpg", position: 3 }, { id: 72, src: "https://x/72.jpg", position: 1 }, { id: 73, src: "https://x/73.jpg", position: 2 }] }),
    ]);
    expect((await fotosPendentes(db, storeId, 10)).map((f) => f.image_id)).toEqual(["72"]);
  });

  it("produto sem foto não entra", async () => {
    await produto(1, "Sem foto", []);
    expect(await fotosPendentes(db, storeId, 10)).toEqual([]);
    expect((await resumoRevisao(db, storeId)).fotos).toBe(0);
  });

  it("manda a foto reduzida (JPEG até 768 px)", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }]);
    const grande = await sharp({ create: { width: 2000, height: 3000, channels: 3, background: "#fff" } }).png().toBuffer();
    let recebida: { bytes: Buffer; mediaType: string } | null = null;
    await revisarPendentes(db, { storeId, budgetMs: 10_000, baixar: async () => grande, revisor: async (img) => ((recebida = img), ok()) });
    const meta = await sharp(recebida!.bytes).metadata();
    expect(recebida!.mediaType).toBe("image/jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(768);
  });

  it("respeita maxFotos e continua depois", async () => {
    for (let n = 0; n < 5; n++) await produto(100 + n, `P${n}`, [{ id: 1000 + n, src: `https://x/${n}.jpg` }]);
    const r1 = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar, maxFotos: 2 });
    expect(r1).toMatchObject({ revisadas: 2, restantes: true });
    const r2 = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    expect(r2).toMatchObject({ revisadas: 3, restantes: false });
  });

  it("para no orçamento de tempo", async () => {
    for (let n = 0; n < 12; n++) await produto(100 + n, `P${n}`, [{ id: 1000 + n, src: `https://x/${n}.jpg` }]);
    let t = 0;
    const r = await revisarPendentes(db, { storeId, budgetMs: 150, revisor: revisorOk, baixar, concorrencia: 2, now: () => (t += 100) });
    expect(r.restantes).toBe(true);
    expect(r.revisadas).toBeGreaterThan(0);
    expect(r.revisadas).toBeLessThan(12);
  });

  it("erro numa foto não trava as outras; erro recente não é repetido, o antigo sim", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }]);
    await produto(2, "Blusa", [{ id: 20, src: "https://x/20.jpg" }]);
    const revisor: Revisor = async (_i, ctx) => {
      if (ctx.produto === "Saia") throw new Error("falhou");
      return ok();
    };
    const r = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor, baixar });
    expect(r).toMatchObject({ revisadas: 1, erros: 1, restantes: false });
    expect(await fotosPendentes(db, storeId, 10)).toEqual([]);
    await pg.query("UPDATE image_review SET reviewed_at = now() - interval '1 hour'");
    expect((await fotosPendentes(db, storeId, 10)).map((f) => f.image_id)).toEqual(["10"]);
    expect((await resumoRevisao(db, storeId)).comErro).toBe(1);
  });

  it("problema de configuração (chave) interrompe e propaga", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }]);
    await expect(
      revisarPendentes(db, { storeId, budgetMs: 10_000, baixar, revisor: async () => { throw new RevisaoConfigError("chave inválida"); } }),
    ).rejects.toThrow("chave inválida");
    expect((await pg.query("SELECT 1 FROM image_review")).rows).toHaveLength(0);
  });

  it("refaz a revisão se o endereço da foto mudar", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }]);
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    await pg.query("UPDATE products SET raw_json = jsonb_set(raw_json, '{images,0,src}', '\"https://x/novo.jpg\"')");
    expect((await fotosPendentes(db, storeId, 10)).map((f) => f.src)).toEqual(["https://x/novo.jpg"]);
  });

  it("o resumo só conta fotos principais, mas o custo soma todas as revisões já feitas", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg" }]);
    await pg.query(
      "INSERT INTO image_review (store_id, image_id, product_id, src, quality, input_tokens, output_tokens) VALUES ($1, 11, 1, 'https://x/11.jpg', 5, 500, 50)",
      [storeId],
    );
    const antes = await resumoRevisao(db, storeId);
    expect(antes).toMatchObject({ fotos: 1, revisadas: 0, entrada: 500, saida: 50 }); // a revisão da foto 11 (não principal) não conta como revisada
    expect(antes.porQualidade[5]).toBe(0);
  });

  it("estima o custo", () => {
    expect(estimarCustoUsd(1_000_000, 100_000)).toBeCloseTo(6);
  });
});

describe("planilha dos textos", () => {
  it("lista só as principais revisadas, com `;`, aspas escapadas e BOM", async () => {
    await produto(1, 'Saia "midi"; azul', [{ id: 10, src: "https://x/10.jpg" }]);
    await produto(2, "Blusa", [{ id: 20, src: "https://x/20.jpg" }]);
    await produto(3, "Sem revisão", [{ id: 30, src: "https://x/30.jpg" }]);
    const revisor: Revisor = async (_i, ctx) =>
      ctx.produto === "Sem revisão" ? Promise.reject(new Error("x")) : ok(ctx.produto === "Blusa" ? "Blusa regata branca com laço" : "Saia midi azul de cintura alta", { problemas: ["escura"], qualidade: 3, observacao: "foto escura" });
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor, baixar });
    const linhas = await linhasRevisao(db, storeId);
    expect(linhas.map((l) => [l.produto, l.error === null])).toEqual([["Blusa", true], ["Saia \"midi\"; azul", true], ["Sem revisão", false]]); // a que deu erro fica de fora da planilha
    const csv = gerarCsvRevisao(linhas);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = csv.slice(1).trim().split("\r\n");
    expect(rows).toHaveLength(3); // cabeçalho + 2 revisadas
    expect(rows[0]).toBe("Produto;ID do produto;Nota (1 a 5);Problemas;Texto alternativo sugerido;Observação;Foto (endereço)");
    expect(rows[1]).toBe("Blusa;2;3;Escura;Blusa regata branca com laço;foto escura;https://x/20.jpg");
    expect(rows[2]).toContain('"Saia ""midi""; azul";1;3;Escura;Saia midi azul de cintura alta');
  });
});

describe("revisor (Claude)", () => {
  const cliente = (res: unknown) => ({ beta: { messages: { create: async (p: unknown) => ((cliente as unknown as { ultimo: unknown }).ultimo = p, res) } } }) as never;
  const foto = { bytes: Buffer.from("x"), mediaType: "image/jpeg" as const };
  const ctx = { produto: "Saia", categorias: [], variacoes: [], posicao: 1, total: 1 };

  it("lê o JSON, limita o alt a 125 caracteres e filtra problemas desconhecidos", async () => {
    const revisor = criarRevisor(
      cliente({
        stop_reason: "end_turn",
        usage: { input_tokens: 900, output_tokens: 80 },
        content: [{ type: "text", text: JSON.stringify({ alt: `  ${"a".repeat(200)}  `, qualidade: 3, problemas: ["escura", "inventado"], observacao: "x" }) }],
      }),
    );
    const r = await revisor(foto, ctx);
    expect(r.alt).toHaveLength(125);
    expect(r).toMatchObject({ qualidade: 3, problemas: ["escura"], entrada: 900, saida: 80 });
  });

  it("erro de workspace vira erro de configuração com orientação (e interrompe a revisão)", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const falha = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header" } }, "400 workspace", new Headers());
    const revisor = criarRevisor({ beta: { messages: { create: async () => { throw falha; } } } } as never);
    await expect(revisor(foto, ctx)).rejects.toBeInstanceOf(RevisaoConfigError);
    await expect(revisor(foto, ctx)).rejects.toThrow("ANTHROPIC_WORKSPACE_ID");
  });

  it("envia o cabeçalho do workspace só quando a variável existe", () => {
    const com = clienteAnthropic({ ANTHROPIC_API_KEY: "k", ANTHROPIC_WORKSPACE_ID: " wrkspc_123 " }) as unknown as { _options: { defaultHeaders?: Record<string, string> } };
    const sem = clienteAnthropic({ ANTHROPIC_API_KEY: "k" }) as unknown as { _options: { defaultHeaders?: Record<string, string> } };
    expect(com._options.defaultHeaders).toEqual({ "anthropic-workspace-id": "wrkspc_123" });
    expect(sem._options.defaultHeaders ?? {}).not.toHaveProperty("anthropic-workspace-id");
  });

  it("pede para descrever só a peça, sem falar da modelo", async () => {
    const c = cliente({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify({ alt: "Saia midi azul com fenda", qualidade: 5, problemas: [], observacao: "" }) }] });
    await criarRevisor(c)(foto, ctx);
    const sistema = String((cliente as unknown as { ultimo: Record<string, unknown> }).ultimo.system);
    expect(sistema).toContain("PEÇA DE ROUPA");
    expect(sistema).toMatch(/NUNCA mencione modelo/);
    expect(sistema).toMatch(/não avalie a modelo/);
  });

  it("se o texto falar da modelo, tenta de novo apontando o problema e soma os tokens", async () => {
    const respostas = [
      { alt: "Modelo veste saia azul com fenda", qualidade: 5, problemas: [], observacao: "ok" },
      { alt: "Saia midi azul de cintura alta com fenda frontal", qualidade: 5, problemas: [], observacao: "ok" },
    ];
    const pedidos: Array<Record<string, any>> = [];
    const c = { beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 50 }, content: [{ type: "text", text: JSON.stringify(respostas[pedidos.length - 1]) }] }) } } } as never;
    const r = await criarRevisor(c)(foto, ctx);
    expect(r.alt).toBe("Saia midi azul de cintura alta com fenda frontal");
    expect(r).toMatchObject({ entrada: 2000, saida: 100 });
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.messages[0].content[1].text).toContain("Modelo veste saia azul com fenda");
  });

  it("não repete a chamada quando o texto já fala só da peça", async () => {
    let chamadas = 0;
    const c = { beta: { messages: { create: async () => (chamadas++, { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify({ alt: "Blusa regata branca com laço no decote e modelagem solta", qualidade: 5, problemas: [], observacao: "" }) }] }) } } } as never;
    await criarRevisor(c)(foto, ctx);
    expect(chamadas).toBe(1);
  });

  it("o detector pega modelo/veste/usando mas não 'modelagem'", () => {
    for (const t of ["Modelo veste saia", "Mulher usando blusa", "Saia que a modelo usa", "Peça vestindo bem"]) expect(MENCIONA_MODELO.test(t)).toBe(true);
    for (const t of ["Saia midi de modelagem reta", "Blusa regata com laço no decote", "Vestido longo estampado"]) expect(MENCIONA_MODELO.test(t)).toBe(false);
  });

  it("recusa do Claude vira erro da foto", async () => {
    const revisor = criarRevisor(cliente({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, content: [] }));
    await expect(revisor(foto, ctx)).rejects.toThrow("recusou");
  });

  it("pede JSON estruturado, esforço baixo e o contexto do produto", async () => {
    const c = cliente({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify({ alt: "a", qualidade: 5, problemas: [], observacao: "" }) }] });
    await criarRevisor(c)(foto, { ...ctx, produto: "Saia midi", variacoes: ["Azul / P"] });
    const p = (cliente as unknown as { ultimo: Record<string, any> }).ultimo;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(p.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    expect(p.messages[0].content[1].text).toContain("Saia midi");
    expect(p.messages[0].content[1].text).toContain("Azul / P");
  });
});
