import { describe, expect, it } from "vitest";
import { TAMANHOS_CDN, runFormatTest, urlDoTamanho, veredito, type FormatTestDeps, type ProbeResult } from "@/lib/images/format-test";
import { makeTestImages } from "@/lib/images/test-images";

const probe = (ok: boolean, url = "u"): ProbeResult => ({ url, ok, status: ok ? 200 : 404, contentType: ok ? "image/jpeg" : null, bytes: ok ? 1000 : null, width: ok ? 100 : null, height: ok ? 100 : null });

describe("urlDoTamanho", () => {
  it("troca o final -<largura>-<altura> mantendo a extensão", () => {
    expect(urlDoTamanho("https://cdn/x/products/foto-1024-1024.jpeg", 480)).toBe("https://cdn/x/products/foto-480-480.jpeg");
    expect(urlDoTamanho("https://cdn/x/foto-640-0.jpg?x=1", 50)).toBe("https://cdn/x/foto-50-50.jpg");
    expect(urlDoTamanho("https://cdn/x/foto.jpg", 50)).toBeNull();
  });
});

describe("runFormatTest", () => {
  const files = [
    { formato: "jpeg" as const, filename: "a.jpg", bytes: Buffer.from("a") },
    { formato: "webp" as const, filename: "a.webp", bytes: Buffer.from("b") },
  ];

  function deps(over: Partial<FormatTestDeps> = {}, existe: (url: string) => boolean = () => true) {
    const calls: string[] = [];
    const d: FormatTestDeps = {
      createProduct: async () => (calls.push("create"), 7),
      uploadImage: async (_p, f) => (calls.push(`upload ${f.filename}`), `https://cdn/p/${f.filename.split(".")[0]}-1024-1024.${f.filename.split(".")[1]}`),
      probe: async (url) => probe(existe(url), url),
      deleteProduct: async () => void calls.push("delete"),
      ...over,
    };
    return { d, calls };
  }

  it("envia os dois formatos, confere todas as versões e apaga o produto", async () => {
    const { d, calls } = deps();
    const r = await runFormatTest(d, files);
    expect(calls).toEqual(["create", "upload a.jpg", "upload a.webp", "delete"]);
    expect(r.produtoApagado).toBe(true);
    expect(r.relatorios.map((x) => x.tamanhos.length)).toEqual([TAMANHOS_CDN.length, TAMANHOS_CDN.length]);
    expect(r.relatorios.every((x) => veredito(x).bom)).toBe(true);
  });

  it("aponta as versões que faltam em WebP", async () => {
    const { d } = deps({}, (url) => !url.endsWith(".webp") || url.includes("-1024-1024"));
    const r = await runFormatTest(d, files);
    expect(veredito(r.relatorios[0]!).bom).toBe(true);
    expect(veredito(r.relatorios[1]!)).toEqual({ bom: false, texto: "WebP: faltam as versões de 50, 100, 240, 320, 480, 640 px." });
  });

  it("apaga o produto mesmo se o envio falhar", async () => {
    const { d, calls } = deps({ uploadImage: async () => Promise.reject(new Error("recusado")) });
    const r = await runFormatTest(d, files);
    expect(calls).toEqual(["create", "delete"]);
    expect(r.produtoApagado).toBe(true);
    expect(veredito(r.relatorios[0]!).texto).toContain("recusado");
  });

  it("avisa quando não consegue apagar o produto de teste", async () => {
    const { d } = deps({ deleteProduct: async () => Promise.reject(new Error("x")) });
    expect((await runFormatTest(d, files)).produtoApagado).toBe(false);
  });

  it("sem produto criado, não tenta apagar", async () => {
    const { d, calls } = deps({ createProduct: async () => Promise.reject(new Error("recusado")) });
    const r = await runFormatTest(d, files);
    expect(calls).toEqual([]);
    expect(r.erro).toBe("recusado");
  });
});

describe("imagens de teste", () => {
  it("gera JPEG e WebP 1200 × 1200 de verdade", async () => {
    const files = await makeTestImages();
    expect(files.map((f) => f.formato)).toEqual(["jpeg", "webp"]);
    const sharp = (await import("sharp")).default;
    for (const f of files) {
      const meta = await sharp(f.bytes).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([1200, 1200, f.formato]);
      expect(f.bytes.length).toBeLessThan(600 * 1024);
    }
  });
});
