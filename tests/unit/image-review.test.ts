import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import sharp from "sharp";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import {
  RevisaoConfigError,
  _resetFormaAltParaTeste,
  altDaImagem,
  aplicarAltPendentes,
  clienteAnthropic,
  criarRevisor,
  estimarCustoUsd,
  MENCIONA_MODELO,
  fotosPendentes,
  resumoRevisao,
  revisarPendentes,
  salvarAltEditado,
  type AltApi,
  type Revisao,
  type Revisor,
} from "@/lib/images/review";
import type { ProductImage } from "@/lib/nuvemshop/types";

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
  _resetFormaAltParaTeste();
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

describe("revisão em lote", () => {
  it("revisa as fotos pendentes com o contexto do produto e termina", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg" }]);
    await produto(2, "Blusa", [{ id: 20, src: "https://x/20.jpg" }]);
    const r = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    expect(r).toMatchObject({ revisadas: 3, erros: 0, restantes: false });
    expect(revisorOk.chamadas.sort()).toEqual(["Blusa#1", "Saia#1", "Saia#2"]);
    const res = await resumoRevisao(db, storeId);
    expect(res).toMatchObject({ fotos: 3, revisadas: 3, comErro: 0, entrada: 3000, saida: 300, semAltNaLoja: 3, altPendentes: 3 });
    expect(res.porQualidade[4]).toBe(3);
    expect(await fotosPendentes(db, storeId, 10)).toEqual([]);
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
    await produto(1, "Saia", Array.from({ length: 5 }, (_, n) => ({ id: 10 + n, src: `https://x/${n}.jpg` })));
    const r1 = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar, maxFotos: 2 });
    expect(r1).toMatchObject({ revisadas: 2, restantes: true });
    const r2 = await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    expect(r2).toMatchObject({ revisadas: 3, restantes: false });
  });

  it("para no orçamento de tempo", async () => {
    await produto(1, "Saia", Array.from({ length: 12 }, (_, n) => ({ id: 10 + n, src: `https://x/${n}.jpg` })));
    let t = 0;
    const r = await revisarPendentes(db, { storeId, budgetMs: 150, revisor: revisorOk, baixar, concorrencia: 2, now: () => (t += 100) });
    expect(r.restantes).toBe(true);
    expect(r.revisadas).toBeGreaterThan(0);
    expect(r.revisadas).toBeLessThan(12);
  });

  it("erro numa foto não trava as outras; erro recente não é repetido, o antigo sim", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg" }]);
    const revisor: Revisor = async (_i, ctx) => {
      if (ctx.posicao === 1) throw new Error("falhou");
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

  it("estima o custo", () => {
    expect(estimarCustoUsd(1_000_000, 100_000)).toBeCloseTo(6);
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

/** Loja falsa: só guarda o alt por foto e aceita o formato escolhido. */
function lojaAlt(aceita: "objeto" | "lista" | "nenhum") {
  const alts = new Map<number, unknown>();
  const chamadas: string[] = [];
  const api: AltApi = {
    esperar: async () => {},
    async updateAlt(_p, id, alt) {
      chamadas.push(Array.isArray(alt) ? "lista" : "objeto");
      if (aceita === "objeto" && !Array.isArray(alt)) alts.set(id, alt);
      if (aceita === "lista" && Array.isArray(alt)) alts.set(id, alt);
      return { id, product_id: 1, src: "", alt: (alts.get(id) ?? {}) as never } as ProductImage;
    },
    async getImage(_p, id) {
      return { id, product_id: 1, src: "", alt: (alts.get(id) ?? {}) as never } as ProductImage;
    },
  };
  return { api, alts, chamadas };
}

describe("texto alternativo na loja", () => {
  it("lê o alt nas duas formas", () => {
    expect(altDaImagem({ alt: { pt: "a" } })).toBe("a");
    expect(altDaImagem({ alt: ["b"] })).toBe("b");
    expect(altDaImagem({ alt: {} })).toBe("");
  });

  it("envia só onde a loja está sem texto, atualiza o espelho e registra no histórico", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg", alt: { pt: "texto da loja" } }, { id: 12, src: "https://x/12.jpg", alt: {} }]);
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    expect((await resumoRevisao(db, storeId)).altPendentes).toBe(2);
    const { api, alts } = lojaAlt("objeto");
    const r = await aplicarAltPendentes(db, api, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r).toMatchObject({ aplicados: 2, falhas: [], restantes: false });
    expect([...alts.keys()].sort()).toEqual([10, 12]); // a 11 já tinha texto: fica
    const espelho = await pg.query<{ a: string }>("SELECT jsonb_path_query_array(raw_json, '$.images[*].alt.pt')::text AS a FROM products WHERE id = 1");
    expect(JSON.parse(espelho.rows[0]!.a)).toEqual(["Alt de Saia 1", "texto da loja", "Alt de Saia 3"]);
    expect((await resumoRevisao(db, storeId)).altPendentes).toBe(0);
    const log = await pg.query<{ acao: string; sucesso: boolean }>("SELECT acao, sucesso FROM audit_log ORDER BY id");
    expect(log.rows).toEqual([{ acao: "imagem.alt", sucesso: true }, { acao: "imagem.alt", sucesso: true }]);
    expect((await aplicarAltPendentes(db, api, { storeId, actor: "a@b.c", budgetMs: 10_000 })).aplicados).toBe(0);
  });

  it("descobre o formato: tenta objeto, confere, e usa lista se a loja só aceitar lista (e lembra)", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }, { id: 11, src: "https://x/11.jpg" }]);
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    const { api, chamadas } = lojaAlt("lista");
    const r = await aplicarAltPendentes(db, api, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r.aplicados).toBe(2);
    expect(chamadas).toEqual(["objeto", "lista", "lista"]); // 1ª foto: objeto (não pegou) e lista; 2ª: direto lista
  });

  it("aceita quando a loja só reflete o texto na segunda leitura (demora a gravar)", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg" }]);
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    let leituras = 0;
    let gravado = "";
    const esperas: number[] = [];
    const api: AltApi = {
      esperar: async (ms) => void esperas.push(ms),
      async updateAlt(_p, id, alt) {
        gravado = Array.isArray(alt) ? "" : alt.pt!; // grava, mas a resposta do PUT vem sem o alt
        return { id, product_id: 1, src: "", alt: {} as never } as ProductImage;
      },
      async getImage(_p, id) {
        leituras++;
        return { id, product_id: 1, src: "", alt: (leituras >= 2 ? { pt: gravado } : {}) as never } as ProductImage;
      },
    };
    const r = await aplicarAltPendentes(db, api, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r).toMatchObject({ aplicados: 1, falhas: [] });
    expect(leituras).toBe(2);
    expect(esperas).toEqual([700, 2500]);
  });

  it("se a loja não gravar de nenhum jeito, falha com mensagem e para cedo", async () => {
    await produto(1, "Saia", Array.from({ length: 6 }, (_, n) => ({ id: 10 + n, src: `https://x/${n}.jpg` })));
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    const { api } = lojaAlt("nenhum");
    const r = await aplicarAltPendentes(db, api, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r.aplicados).toBe(0);
    expect(r.falhas).toHaveLength(3);
    expect(r.falhas[0]!.mensagem).toContain("não gravou");
    const log = await pg.query<{ sucesso: boolean }>("SELECT sucesso FROM audit_log");
    expect(log.rows.every((l) => !l.sucesso)).toBe(true);
  });

  it("texto editado por uma pessoa sobrescreve o da loja", async () => {
    await produto(1, "Saia", [{ id: 10, src: "https://x/10.jpg", alt: { pt: "antigo" } }]);
    await revisarPendentes(db, { storeId, budgetMs: 10_000, revisor: revisorOk, baixar });
    const { api, alts } = lojaAlt("objeto");
    await salvarAltEditado(db, api, { storeId, actor: "a@b.c", productId: 1, imageId: "10", texto: "  Saia midi   azul  " });
    expect(alts.get(10)).toEqual({ pt: "Saia midi azul" });
    const [linha] = (await pg.query<{ alt_pt: string; alt_editado: boolean; alt_aplicado: string }>("SELECT alt_pt, alt_editado, alt_aplicado FROM image_review")).rows;
    expect(linha).toEqual({ alt_pt: "Saia midi azul", alt_editado: true, alt_aplicado: "Saia midi azul" });
    await expect(salvarAltEditado(db, api, { storeId, actor: "a@b.c", productId: 1, imageId: "10", texto: "   " })).rejects.toThrow("vazio");
    await expect(salvarAltEditado(db, api, { storeId, actor: "a@b.c", productId: 1, imageId: "999", texto: "x" })).rejects.toThrow("não está mais");
  });
});


describe("diagnóstico do alt", () => {
  it("mostra o que a loja devolve e para na primeira forma que grava", async () => {
    const { diagnosticarAlt } = await import("@/lib/images/review-api");
    const estado: { alt: unknown } = { alt: {} };
    const chamadas: string[] = [];
    const client = {
      get: async () => ({ id: 1, alt: estado.alt }),
      put: async (_p: string, corpo: { alt: unknown }) => {
        chamadas.push(JSON.stringify(corpo));
        if (Array.isArray(corpo.alt)) estado.alt = corpo.alt; // só a lista pega
        return { id: 1, alt: estado.alt };
      },
    } as never;
    vi.useFakeTimers();
    const p = diagnosticarAlt(client, 1, 1, "Saia midi azul");
    await vi.advanceTimersByTimeAsync(10_000);
    const passos = await p;
    vi.useRealTimers();
    expect(chamadas).toEqual(['{"alt":{"pt":"Saia midi azul"}}', '{"alt":["Saia midi azul"]}']);
    expect(passos.at(-1)).toEqual({ passo: "Conclusão", resultado: "o formato “PUT { alt: [texto] }” gravou o texto" });
    expect(passos.some((p) => p.passo === "GET antes" && p.resultado === "alt = {}")).toBe(true);
  });
});
