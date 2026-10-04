import { describe, expect, it } from "vitest";
import { pageItems } from "@/lib/pagination";

describe("pageItems (paginação numerada)", () => {
  it("poucas páginas: mostra todas", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageItems(1, 0)).toEqual([]);
  });

  it("muitas páginas: primeira, última e vizinhas da atual, com reticências nos vãos", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, "…", 20]);
    expect(pageItems(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(pageItems(20, 20)).toEqual([1, "…", 19, 20]);
  });

  it("um vão de uma página só mostra a página em vez de reticências", () => {
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
    expect(pageItems(17, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
  });

  it("nunca repete nem sai da faixa", () => {
    for (let total = 1; total <= 30; total++) {
      for (let cur = 1; cur <= total; cur++) {
        const nums = pageItems(cur, total).filter((x): x is number => typeof x === "number");
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums).toContain(cur);
        expect(Math.min(...nums)).toBe(1);
        expect(Math.max(...nums)).toBe(total);
      }
    }
  });
});
