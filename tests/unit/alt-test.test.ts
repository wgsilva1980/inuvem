import { describe, expect, it } from "vitest";
import { rodarAltTeste, type AltTestApi } from "@/lib/images/alt-test";

type Foto = { id: number; src: string; alt: unknown };

/** Loja falsa: `aceita` define por qual rota o alt é gravado. */
function loja(aceita: "nenhuma" | "post-lista" | "put-produto-lista") {
  const fotos: Foto[] = [];
  let proximo = 100;
  let apagado = false;
  const log: string[] = [];
  const api: AltTestApi = {
    criarProduto: async () => 1,
    async post(caminho, corpo) {
      log.push(`POST ${caminho}`);
      const c = corpo as { alt?: unknown };
      const f: Foto = { id: proximo++, src: `https://cdn/x-${proximo}-1024-1024.jpg`, alt: [] };
      if (aceita === "post-lista" && Array.isArray(c.alt)) f.alt = c.alt;
      fotos.push(f);
      return { ...f };
    },
    async put(caminho, corpo) {
      log.push(`PUT ${caminho}`);
      const c = corpo as { images?: Array<{ id: number; alt: unknown }> };
      if (caminho.endsWith("/products/1") && aceita === "put-produto-lista") {
        for (const i of c.images ?? []) if (Array.isArray(i.alt)) fotos.find((f) => f.id === i.id)!.alt = i.alt;
      }
      return { id: 1, images: fotos.map((f) => ({ ...f })) };
    },
    async get(caminho) {
      const m = /\/images\/(\d+)$/.exec(caminho);
      if (m) return { ...fotos.find((f) => f.id === Number(m[1]))! };
      return { id: 1, images: fotos.map((f) => ({ ...f })) };
    },
    async apagarProduto() {
      apagado = true;
    },
    esperar: async () => {},
  };
  return { api, log, apagado: () => apagado };
}

describe("teste do texto alternativo na loja", () => {
  it("quando nenhuma rota grava, diz isso e apaga o produto de teste", async () => {
    const l = loja("nenhuma");
    const r = await rodarAltTeste(l.api, "AAAA");
    expect(r.formaQueGravou).toBeNull();
    expect(r.produtoApagado).toBe(true);
    expect(l.apagado()).toBe(true);
    expect(r.passos).toHaveLength(6);
    expect(r.passos.every((p) => !p.gravou)).toBe(true);
  });

  it("aponta a rota que grava (enviar a foto já com o alt em lista)", async () => {
    const r = await rodarAltTeste(loja("post-lista").api, "AAAA");
    expect(r.formaQueGravou).toBe("POST foto com alt = [texto]");
    expect(r.passos.filter((p) => p.gravou).map((p) => p.tentativa)).toEqual(["POST foto com alt = [texto]"]);
  });

  it("aponta a rota que grava (images no PUT do produto)", async () => {
    const r = await rodarAltTeste(loja("put-produto-lista").api, "AAAA");
    expect(r.formaQueGravou).toBe("PUT produto { images: [{ id, alt: [texto] }] }");
  });

  it("erro de uma rota vira linha do relatório e o teste segue; o produto é apagado mesmo assim", async () => {
    const l = loja("nenhuma");
    const original = l.api.put;
    l.api.put = async (c, b) => {
      if (/images\/\d+$/.test(c)) throw Object.assign(new Error("x"), { status: 422, apiMessage: "alt não permitido" });
      return original(c, b);
    };
    const r = await rodarAltTeste(l.api, "AAAA");
    expect(r.passos.find((p) => p.tentativa.startsWith("PUT foto { src, alt: { pt"))!.resposta).toContain("ERRO 422: alt não permitido");
    expect(r.passos).toHaveLength(6);
    expect(r.produtoApagado).toBe(true);
  });

  it("falha ao criar o produto: erro explicado e nada a apagar", async () => {
    const l = loja("nenhuma");
    l.api.criarProduto = async () => {
      throw new Error("sem permissão");
    };
    const r = await rodarAltTeste(l.api, "AAAA");
    expect(r.erro).toContain("sem permissão");
    expect(r.produtoApagado).toBe(false);
  });
});
