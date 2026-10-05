import { describe, expect, it } from "vitest";
import { TAMANHOS_CDN, candidatosDoTamanho, runFormatTest, urlsComOutraExtensao, veredito, type FormatTestDeps, type ProbeResult, type TestFile } from "@/lib/images/format-test";
import { makeTestImages } from "@/lib/images/test-images";

const probe = (ok: boolean, url = "u", w = 100, h = 100): ProbeResult => ({ url, ok, status: ok ? 200 : 403, contentType: ok ? "image/jpeg" : "application/xml", bytes: ok ? 1000 : null, width: ok ? w : null, height: ok ? h : null });

describe("endereços", () => {
  it("candidatos: os dois finais -<tamanho>-0 e -<tamanho>-<tamanho>, mantendo a extensão", () => {
    expect(candidatosDoTamanho("https://cdn/x/foto-1024-1024.jpeg", 480)).toEqual([
      { padrao: "-S-0", url: "https://cdn/x/foto-480-0.jpeg" },
      { padrao: "-S-S", url: "https://cdn/x/foto-480-480.jpeg" },
    ]);
    expect(candidatosDoTamanho("https://cdn/x/foto-640-0.jpg?x=1", 50)[0]!.url).toBe("https://cdn/x/foto-50-0.jpg");
    expect(candidatosDoTamanho("https://cdn/x/foto.jpg", 50)).toEqual([]);
  });

  it("outras extensões: jpeg e jpg, menos a própria", () => {
    expect(urlsComOutraExtensao("https://cdn/foto-1024-1024.webp")).toEqual(["https://cdn/foto-1024-1024.jpeg", "https://cdn/foto-1024-1024.jpg"]);
    expect(urlsComOutraExtensao("https://cdn/foto.jpg")).toEqual(["https://cdn/foto.jpeg"]);
  });
});

describe("runFormatTest", () => {
  const files: TestFile[] = [
    { rotulo: "JPEG", formato: "jpeg", filename: "a.jpg", bytes: Buffer.from("a"), largura: 1200, altura: 1200 },
    { rotulo: "WebP", formato: "webp", filename: "a.webp", bytes: Buffer.from("b"), largura: 1200, altura: 1200 },
  ];

  function deps(over: Partial<FormatTestDeps> = {}, existe: (url: string) => boolean = () => true) {
    const calls: string[] = [];
    const d: FormatTestDeps = {
      createProduct: async () => (calls.push("create"), 7),
      uploadImage: async (_p, f) => (calls.push(`upload ${f.filename}`), `https://cdn/p/${f.filename.split(".")[0]}-1024-1024.${f.filename.split(".")[1]}`),
      probe: async (url) => probe(existe(url), url, 1024, 1024),
      esperar: async () => void calls.push("espera"),
      deleteProduct: async () => void calls.push("delete"),
      ...over,
    };
    return { d, calls };
  }

  it("envia os arquivos, confere todas as versões (padrão -S-0) e apaga o produto", async () => {
    const { d, calls } = deps({}, (url) => !url.endsWith("-1024-1024.jpg") || true);
    const r = await runFormatTest(d, files);
    expect(calls.filter((c) => c !== "espera")).toEqual(["create", "upload a.jpg", "upload a.webp", "delete"]);
    expect(r.produtoApagado).toBe(true);
    expect(r.relatorios[0]!.tamanhos.every((t) => t.padrao === "-S-0")).toBe(true);
    expect(r.relatorios[0]!.tamanhos).toHaveLength(TAMANHOS_CDN.length);
    expect(veredito(r.relatorios[0]!)).toMatchObject({ bom: true });
  });

  it("usa o segundo padrão quando o primeiro não existe", async () => {
    const { d } = deps({}, (url) => !/-\d+-0\./.test(url));
    const r = await runFormatTest(d, files);
    expect(r.relatorios[0]!.tamanhos.every((t) => t.padrao === "-S-S")).toBe(true);
  });

  it("WebP não servido: tenta de novo, acha a versão JPEG e explica", async () => {
    const { d, calls } = deps({}, (url) => !url.endsWith(".webp"));
    const r = await runFormatTest(d, files);
    expect(calls.filter((c) => c === "espera")).toHaveLength(2); // 2 novas tentativas do original do WebP
    expect(veredito(r.relatorios[1]!)).toEqual({ bom: false, texto: "A loja não serve o arquivo no formato enviado; só existe a versão JPEG (1024×1024)." });
  });

  it("aponta as versões que faltam", async () => {
    const { d } = deps({}, (url) => !/-(50|100)-/.test(url));
    const r = await runFormatTest(d, [files[0]!]);
    expect(veredito(r.relatorios[0]!).texto).toBe("Guardada em 1024×1024; não encontrei as versões de 50, 100 px.");
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
  it("gera as três imagens com o tamanho e o formato certos", async () => {
    const files = await makeTestImages();
    const sharp = (await import("sharp")).default;
    expect(files.map((f) => [f.formato, f.largura, f.altura])).toEqual([["jpeg", 1200, 1200], ["webp", 1200, 1200], ["jpeg", 1080, 1350]]);
    for (const f of files) {
      const meta = await sharp(f.bytes).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([f.largura, f.altura, f.formato]);
    }
  });
});
