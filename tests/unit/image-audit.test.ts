import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { auditarProdutos, contarPendentes, medirPendentes, problemasDaImagem, proporcaoTexto, resumirAuditoria, type Medida, type Medidor } from "@/lib/images/audit";

let pg: PGlite;
let db: Db;
let storeId: string;

const medida = (w: number, h: number, bytes = 200_000, format = "jpeg"): Medida => ({ width: w, height: h, bytes, format, error: null });

async function produto(id: number, nome: string, imagens: Array<{ id: number; src: string; position?: number }>) {
  await pg.query("INSERT INTO products (store_id, id, name, raw_json) VALUES ($1, $2, $3, $4::jsonb)", [
    storeId,
    id,
    nome,
    JSON.stringify({ images: imagens.map((i, n) => ({ ...i, position: i.position ?? n + 1 })) }),
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
});

describe("classificação", () => {
  it("1024×1024 e 820×1024 leves em JPEG estão no padrão", () => {
    expect(problemasDaImagem(medida(1024, 1024))).toEqual([]);
    expect(problemasDaImagem(medida(819, 1024))).toEqual([]);
  });
  it("aponta pequena, proporção, pesada e formato", () => {
    expect(problemasDaImagem(medida(600, 600))).toEqual(["pequena"]);
    expect(problemasDaImagem(medida(1024, 768))).toEqual(["proporcao"]);
    expect(problemasDaImagem(medida(1024, 1024, 700_000))).toEqual(["pesada"]);
    expect(problemasDaImagem(medida(1024, 1024, 100_000, "png"))).toEqual(["formato"]);
  });
  it("erro de medição vira 'erro'", () => {
    expect(problemasDaImagem({ width: null, height: null, bytes: null, format: null, error: "x" })).toEqual(["erro"]);
  });
  it("texto de proporção", () => {
    expect(proporcaoTexto(1000, 1000)).toBe("1:1");
    expect(proporcaoTexto(800, 1000)).toBe("4:5");
    expect(proporcaoTexto(750, 1000)).toBe("0,75");
    expect(proporcaoTexto(null, 10)).toBe("—");
  });
});

describe("medição em lote", () => {
  const medidor: Medidor & { chamadas: string[] } = Object.assign(
    async (url: string) => {
      medidor.chamadas.push(url);
      return url.includes("grande") ? medida(1024, 1024) : medida(500, 500);
    },
    { chamadas: [] as string[] },
  );
  beforeEach(() => {
    medidor.chamadas.length = 0;
  });

  it("mede só o que falta e é retomável", async () => {
    await produto(1, "A", [{ id: 10, src: "https://x/grande-1.jpg" }, { id: 11, src: "https://x/pequena-2.jpg" }]);
    await produto(2, "B", [{ id: 20, src: "https://x/grande-3.jpg" }]);
    expect(await contarPendentes(db, storeId)).toEqual({ total: 3, medidas: 0 });

    const r = await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor });
    expect(r).toEqual({ medidas: 3, restantes: false });
    expect(await contarPendentes(db, storeId)).toEqual({ total: 3, medidas: 3 });

    medidor.chamadas.length = 0;
    expect((await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor })).medidas).toBe(0);
    expect(medidor.chamadas).toEqual([]);
  });

  it("para no orçamento de tempo e continua na próxima chamada", async () => {
    await produto(1, "A", Array.from({ length: 6 }, (_, n) => ({ id: 100 + n, src: `https://x/grande-${n}.jpg` })));
    let t = 0;
    const now = () => (t += 100);
    const r1 = await medirPendentes(db, { storeId, budgetMs: 150, medir: medidor, concorrencia: 1, now });
    expect(r1.restantes).toBe(true);
    const feitas = (await contarPendentes(db, storeId)).medidas;
    expect(feitas).toBeGreaterThan(0);
    expect(feitas).toBeLessThan(6);
    const r2 = await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor });
    expect(r2.restantes).toBe(false);
    expect((await contarPendentes(db, storeId)).medidas).toBe(6);
  });

  it("remede quando o endereço da imagem muda e com 'todas'", async () => {
    await produto(1, "A", [{ id: 10, src: "https://x/grande-1.jpg" }]);
    await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor });
    await pg.query("UPDATE products SET raw_json = jsonb_set(raw_json, '{images,0,src}', '\"https://x/grande-novo.jpg\"') WHERE id = 1");
    expect(await contarPendentes(db, storeId)).toEqual({ total: 1, medidas: 0 });
    await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor });
    medidor.chamadas.length = 0;
    const r = await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor, todas: true });
    expect(r).toEqual({ medidas: 1, restantes: false });
    expect(medidor.chamadas).toHaveLength(1);
  });

  it("tenta de novo falhas antigas, mas não as recentes", async () => {
    await produto(1, "A", [{ id: 10, src: "https://x/grande-1.jpg" }]);
    const falho: Medidor = async () => ({ width: null, height: null, bytes: null, format: null, error: "timeout" });
    await medirPendentes(db, { storeId, budgetMs: 10_000, medir: falho });
    expect((await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor })).medidas).toBe(0);
    await pg.query("UPDATE image_audit SET checked_at = now() - interval '1 hour'");
    expect((await medirPendentes(db, { storeId, budgetMs: 10_000, medir: medidor })).medidas).toBe(1);
  });
});

describe("relatório", () => {
  it("resume por problema, proporções misturadas e produtos sem imagem", async () => {
    await produto(1, "Misto", [{ id: 10, src: "https://x/a.jpg" }, { id: 11, src: "https://x/b.jpg" }]);
    await produto(2, "Padrão", [{ id: 20, src: "https://x/c.jpg" }]);
    await produto(3, "Sem foto", []);
    const medidas: Record<string, Medida> = { "https://x/a.jpg": medida(1024, 1024), "https://x/b.jpg": medida(820, 1024, 700_000), "https://x/c.jpg": medida(1024, 1024) };
    await medirPendentes(db, { storeId, budgetMs: 10_000, medir: async (u) => medidas[u]! });

    const produtos = await auditarProdutos(db, storeId);
    expect(produtos.map((p) => p.name)).toEqual(["Misto", "Padrão", "Sem foto"]);
    const r = resumirAuditoria(produtos);
    expect(r).toMatchObject({ produtos: 3, semImagem: 1, imagens: 3, medidas: 3, noPadrao: 2, proporcoesMisturadas: 1 });
    expect(r.porProblema).toEqual({ pequena: 0, proporcao: 0, pesada: 1, formato: 0, erro: 0 });
  });

  it("imagem não medida aparece sem problemas e sem medida", async () => {
    await produto(1, "A", [{ id: 10, src: "https://x/a.jpg" }]);
    const [p] = await auditarProdutos(db, storeId);
    expect(p!.imagens[0]).toMatchObject({ medida: null, problemas: [] });
  });
});
