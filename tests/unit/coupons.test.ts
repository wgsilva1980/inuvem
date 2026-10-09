import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ALFABETO, codigoValido, gerarCodigos, hojeEmBrasilia, loteSchema, payloadDoCupom, situacaoDoCupom } from "@/lib/coupons/lote";
import { couponSchema, createCoupon, listCoupons, updateCoupon, type Coupon } from "@/lib/nuvemshop/coupons";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { COLUNAS_CUPONS } from "@/lib/export/colunas";
import { gerarXlsx } from "@/lib/export/xlsx";

const lote = (over: Record<string, unknown> = {}) =>
  loteSchema.parse({ prefixo: "verao", quantidade: 5, tipo: "percentual", valor: 10, inicio: "", fim: "2026-12-31", usosPorCupom: 1, minimo: null, primeiraCompra: false, combina: false, ...over });

describe("lote de cupons", () => {
  it("normaliza o prefixo e valida os limites", () => {
    expect(lote().prefixo).toBe("VERAO");
    expect(lote().inicio).toBeNull();
    expect(() => lote({ prefixo: "a" })).toThrow();
    expect(() => lote({ prefixo: "VER AO" })).toThrow();
    expect(() => lote({ quantidade: 0 })).toThrow();
    expect(() => lote({ quantidade: 201 })).toThrow();
    expect(() => lote({ valor: 0 })).toThrow();
    expect(() => lote({ valor: 101 })).toThrow(/100/);
    expect(lote({ tipo: "valor", valor: 150 }).valor).toBe(150);
    expect(() => lote({ inicio: "2026-12-01", fim: "2026-11-01" })).toThrow(/depois do início/);
    expect(lote({ usosPorCupom: null }).usosPorCupom).toBeNull();
  });

  it("gera códigos únicos, só com o alfabeto sem ambiguidade, evitando os que já existem", () => {
    const codigos = gerarCodigos("VERAO", 200, ["VERAOAAAAAA"]);
    expect(new Set(codigos).size).toBe(200);
    for (const c of codigos) {
      expect(c).toMatch(/^VERAO[A-Z0-9]{6}$/);
      expect([...c.slice(5)].every((ch) => ALFABETO.includes(ch))).toBe(true);
      expect(codigoValido(c, "VERAO")).toBe(true);
    }
    // sorteio fixo: o primeiro código colide com o existente (comparação sem diferenciar maiúsculas) e é pulado
    let i = 0;
    const seq = () => (i++ < 6 ? 0 : i);
    const out = gerarCodigos("AB", 1, ["abAAAAAA"], seq);
    expect(out[0]).not.toBe("ABAAAAAA");
    expect(() => gerarCodigos("AB", 2, [], () => 0)).toThrow(/outro prefixo/);
  });

  it("recusa código fora do padrão do lote", () => {
    expect(codigoValido("OUTROABC123", "VERAO")).toBe(false);
    expect(codigoValido("VERAO-12", "VERAO")).toBe(false);
    expect(codigoValido("verao123", "VERAO")).toBe(false);
  });

  it("monta o payload da loja", () => {
    expect(payloadDoCupom(lote({ minimo: 99.9, primeiraCompra: true }), "VERAOABCDEF")).toEqual({
      code: "VERAOABCDEF",
      type: "percentage",
      value: "10.00",
      valid: true,
      max_uses: 1,
      start_date: null,
      end_date: "2026-12-31",
      min_price: "99.90",
      first_consumer_purchase: true,
      combines_with_other_discounts: false,
    });
    expect(payloadDoCupom(lote({ tipo: "valor", valor: 25, usosPorCupom: null }), "X").type).toBe("absolute");
    expect(payloadDoCupom(lote({ tipo: "valor", valor: 25, usosPorCupom: null }), "X").max_uses).toBeNull();
  });
});

describe("situação do cupom", () => {
  const c = (over: Record<string, unknown>) => couponSchema.parse({ id: 1, code: "A", valid: true, ...over }) as Coupon;
  it("classifica ativo, desativado, vencido, esgotado e agendado", () => {
    const hoje = "2026-10-10";
    expect(situacaoDoCupom(c({}), hoje)).toBe("ativo");
    expect(situacaoDoCupom(c({ valid: false }), hoje)).toBe("inativo");
    expect(situacaoDoCupom(c({ end_date: "2026-10-09" }), hoje)).toBe("vencido");
    expect(situacaoDoCupom(c({ end_date: "2026-10-10" }), hoje)).toBe("ativo");
    expect(situacaoDoCupom(c({ max_uses: 3, used: 3 }), hoje)).toBe("esgotado");
    expect(situacaoDoCupom(c({ max_uses: "3", used: "2" }), hoje)).toBe("ativo");
    expect(situacaoDoCupom(c({ max_uses: null, used: 99 }), hoje)).toBe("ativo");
    expect(situacaoDoCupom(c({ start_date: "2026-11-01" }), hoje)).toBe("agendado");
  });
  it("a data de hoje usa o horário de Brasília", () => {
    expect(hojeEmBrasilia(new Date("2026-10-10T02:30:00Z"))).toBe("2026-10-09");
    expect(hojeEmBrasilia(new Date("2026-10-10T15:00:00Z"))).toBe("2026-10-10");
  });
});

describe("API de cupons", () => {
  it("lista tolerando itens estranhos e conta os campos", async () => {
    const client = { getPage: async () => ({ items: [{ id: 1, code: "A", extra: 1 }, { id: "x" }, { id: 2, code: "B", valid: true }], total: 3, nextPage: null }) } as unknown as NuvemshopClient;
    const r = await listCoupons(client);
    expect(r.items.map((x) => x.code)).toEqual(["A", "B"]);
    expect(r.invalidos).toBe(1);
    expect(r.campos).toContain("extra");
  });
  it("cria com POST /coupons e desativa com PUT /coupons/{id}", async () => {
    const calls: string[] = [];
    const client = {
      post: async (p: string, b: unknown) => (calls.push(`POST ${p} ${JSON.stringify(b)}`), { id: 9, code: "A" }),
      put: async (p: string, b: unknown) => (calls.push(`PUT ${p} ${JSON.stringify(b)}`), { id: 9, code: "A", valid: false }),
    } as unknown as NuvemshopClient;
    expect((await createCoupon(client, { code: "A", type: "percentage", value: "10.00" })).id).toBe(9);
    expect((await updateCoupon(client, 9, { valid: false })).valid).toBe(false);
    expect(calls).toEqual(['POST /coupons {"code":"A","type":"percentage","value":"10.00"}', 'PUT /coupons/9 {"valid":false}']);
  });
});

describe("exportação", () => {
  it("gera a planilha com tipo, situação, usos e datas em português", async () => {
    const itens = [couponSchema.parse({ id: 1, code: "VERAOABC", type: "percentage", value: "10.00", valid: true, used: 2, max_uses: 5, end_date: "2026-12-31", min_price: "50.00", first_consumer_purchase: true }) as Coupon];
    const buf = await gerarXlsx("Cupons", COLUNAS_CUPONS("2026-10-10"), itens);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("Cupons")!;
    const cab = (ws.getRow(1).values as string[]).slice(1);
    expect(cab.slice(0, 4)).toEqual(["Código", "Tipo", "Valor", "Situação"]);
    const linha = (ws.getRow(2).values as unknown[]).slice(1);
    expect(linha.slice(0, 8)).toEqual(["VERAOABC", "Percentual", 10, "Ativo", 2, 5, "", "31/12/2026"]);
    expect(linha[9]).toBe("Sim");
  });
});
