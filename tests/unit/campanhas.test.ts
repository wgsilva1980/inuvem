import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import type { Db } from "@/lib/sync/repo";
import { CAMPANHAS, blackFriday, enesimoDiaDaSemana, faseDa, periodosDoAnoPassado, proximasCampanhas } from "@/lib/campaigns/calendario";
import { historicoDaCampanha } from "@/lib/campaigns/historico";

describe("datas do calendário", () => {
  it("dias da semana móveis: Dia das Mães (2º domingo de maio) e Dia dos Pais (2º domingo de agosto)", () => {
    const def = (id: string) => CAMPANHAS.find((c) => c.id === id)!;
    expect(def("dia-das-maes").data(2026)).toBe("2026-05-10");
    expect(def("dia-das-maes").data(2027)).toBe("2027-05-09");
    expect(def("dia-dos-pais").data(2026)).toBe("2026-08-09");
    expect(enesimoDiaDaSemana(2026, 5, 0, 1)).toBe("2026-05-03");
  });

  it("Black Friday é a sexta depois da 4ª quinta de novembro (inclusive quando é a 5ª sexta)", () => {
    expect(blackFriday(2024)).toBe("2024-11-29"); // novembro começa numa sexta
    expect(blackFriday(2025)).toBe("2025-11-28");
    expect(blackFriday(2026)).toBe("2026-11-27");
  });

  it("datas fixas", () => {
    const d = Object.fromEntries(CAMPANHAS.map((c) => [c.id, c.data(2026)]));
    expect(d).toMatchObject({ "dia-da-mulher": "2026-03-08", "dia-dos-namorados": "2026-06-12", "dia-do-cliente": "2026-09-15", natal: "2026-12-25", reveillon: "2026-12-31" });
  });
});

describe("fases e próximas campanhas", () => {
  const bf = { janela: 7, compra: 90, promo: 30 };
  it("a fase muda nos limites certos", () => {
    expect([91, 90, 31, 30, 8, 7, 0].map((d) => faseDa(d, bf))).toEqual(["futura", "comprar", "comprar", "preparar", "preparar", "vendendo", "vendendo"]);
  });

  it("lista a partir de hoje, ordenada, com datas e fases", () => {
    const l = proximasCampanhas("2026-10-11");
    expect(l.slice(0, 3).map((c) => [c.id, c.data, c.dias, c.fase])).toEqual([
      ["black-friday", "2026-11-27", 47, "comprar"],
      ["natal", "2026-12-25", 75, "comprar"],
      ["reveillon", "2026-12-31", 81, "futura"],
    ]);
    expect(l.find((c) => c.id === "dia-das-maes")!.data).toBe("2027-05-09"); // já passou em 2026: vem a de 2027
    expect(l.every((c) => c.dias >= 0 && c.dias <= 366)).toBe(true);
    expect(l.map((c) => c.dias)).toEqual([...l.map((c) => c.dias)].sort((a, b) => a - b));
    const bfl = l[0]!;
    expect(bfl).toMatchObject({ prazoCompra: "2026-08-29", inicioPromo: "2026-10-28", inicioVendas: "2026-11-20" });
  });

  it("no dia da campanha ela ainda aparece, em vendas; no dia seguinte já vai para o ano que vem", () => {
    expect(proximasCampanhas("2026-11-27")[0]).toMatchObject({ id: "black-friday", dias: 0, fase: "vendendo" });
    expect(proximasCampanhas("2026-11-28").some((c) => c.id === "black-friday" && c.data === "2027-11-26")).toBe(true);
    expect(proximasCampanhas("2026-11-28").some((c) => c.data === "2026-11-27")).toBe(false);
  });

  it("virada de ano e janela do ano passado", () => {
    expect(proximasCampanhas("2026-12-30")[0]).toMatchObject({ id: "reveillon", dias: 1 });
    const bfl = proximasCampanhas("2026-10-11")[0]!;
    expect(periodosDoAnoPassado(bfl)).toEqual({ ano: 2025, janela: { de: "2025-11-21", ate: "2025-11-28" }, base: { de: "2025-09-22", ate: "2025-11-20" } });
  });

  it("toda campanha tem antecedências coerentes", () => {
    for (const c of CAMPANHAS) {
      expect(c.compra).toBeGreaterThan(c.promo);
      expect(c.promo).toBeGreaterThan(c.janela);
      expect([15, 30, 45]).toContain(c.prazoCompras);
    }
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

const pedidosPorDia = (inicio: string, dias: number, valor: number, idBase: number) =>
  pg.query(
    `INSERT INTO orders (store_id, id, number, created_at_remote, total, status, payment_status)
     SELECT $1::uuid, ${idBase} + n, ${idBase} + n, (('${inicio}'::date + n)::timestamp + interval '15 hours') AT TIME ZONE 'UTC', ${valor}, 'closed', 'paid' FROM generate_series(0, ${dias - 1}) n`,
    [storeId],
  );

describe("o que a campanha vendeu no ano passado", () => {
  const bf = () => proximasCampanhas("2026-10-11")[0]!;

  it("mede quantas vezes a janela superou o ritmo normal e lista os mais vendidos", async () => {
    await pedidosPorDia("2025-09-22", 60, 50, 1000); // ritmo normal: R$ 50 por dia
    await pedidosPorDia("2025-11-21", 8, 100, 5000); // janela da Black Friday: R$ 100 por dia
    await pg.query("INSERT INTO products (store_id, id, name, published, raw_json) VALUES ($1, 7, 'Vestido Azul', true, '{}'::jsonb)", [storeId]);
    await pg.query("INSERT INTO order_items (store_id, order_id, seq, product_id, name, quantity, unit_price) VALUES ($1, 5000, 1, 7, 'x', 3, 100)", [storeId]);
    const h = await historicoDaCampanha(db, storeId, bf());
    expect(h).toMatchObject({ ano: 2025, coberto: true, fator: 2, vendas: { pedidos: 8, faturamento: 800 } });
    expect(h.maisVendidos.map((p) => [p.nome, p.unidades])).toEqual([["Vestido Azul", 3]]);
  });

  it("sem pedidos daquela época diz que não há comparação", async () => {
    await pedidosPorDia("2026-01-01", 10, 100, 9000);
    const h = await historicoDaCampanha(db, storeId, bf());
    expect(h).toMatchObject({ coberto: false, fator: null, vendas: { pedidos: 0 }, maisVendidos: [] });
  });

  it("pedidos só da janela, sem os 60 dias anteriores: mostra as vendas mas não o fator", async () => {
    await pedidosPorDia("2025-11-21", 8, 100, 5000);
    const h = await historicoDaCampanha(db, storeId, bf());
    expect(h).toMatchObject({ coberto: true, fator: null, vendas: { faturamento: 800 } });
  });
});
