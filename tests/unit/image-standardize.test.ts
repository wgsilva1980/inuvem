import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FUNDO_PADRAO, MAX_ENVIO_BYTES, padronizarImagem } from "@/lib/images/standardize";

/** Retângulo colorido (a "peça") sobre fundo liso. */
const pecaSobreFundo = (w: number, h: number, fundo = "#ffffff") =>
  sharp({ create: { width: w, height: h, channels: 3, background: fundo } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h / 3), channels: 3, background: "#b0306a" } }, gravity: "centre" }])
    .jpeg()
    .toBuffer();

/** Foto "de ambiente": degradê, sem fundo uniforme. */
const degrade = (w: number, h: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#103060"/><stop offset="1" stop-color="#e0a040"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`))
    .jpeg()
    .toBuffer();

const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
const perto = (a: number[], b: number[], tol = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe("padronizarImagem", () => {
  it("peça solta em fundo liso: 1024×1024 JPEG, ajustada, com o fundo da própria foto", async () => {
    const r = await padronizarImagem(await pecaSobreFundo(2000, 1500, "#f0e8e0"));
    expect([r.tipo, r.enquadramento, r.largura, r.altura, r.fundoUniforme]).toEqual(["peca", "ajustar", 1024, 1024, true]);
    expect((await sharp(r.bytes).metadata()).format).toBe("jpeg");
    expect(r.fundo).toMatch(/^#F0E[78]E0$/); // a média das bordas pode variar 1 nível pela compressão do JPEG de entrada
    expect(perto(await pixel(r.bytes, 2, 2), [0xf0, 0xe8, 0xe0])).toBe(true); // sem emenda entre a margem e o fundo da foto
    expect(r.bytes.length).toBeLessThanOrEqual(MAX_ENVIO_BYTES);
  });

  it("foto em pé (2:3) vira modelo 820×1024; sem fundo uniforme, é cortada", async () => {
    const r = await padronizarImagem(await degrade(1000, 1500));
    expect([r.tipo, r.enquadramento, r.largura, r.altura, r.fundoUniforme]).toEqual(["modelo", "cortar", 820, 1024, false]);
  });

  it("respeita o tipo e o enquadramento escolhidos", async () => {
    const r = await padronizarImagem(await degrade(1500, 1000), { tipo: "modelo", enquadramento: "ajustar" });
    expect([r.tipo, r.enquadramento, r.largura, r.altura]).toEqual(["modelo", "ajustar", 820, 1024]);
    expect(r.fundo).toBe(FUNDO_PADRAO); // fundo não uniforme: usa o padrão nas bordas
    expect(perto(await pixel(r.bytes, 2, 2), [0xf5, 0xf1, 0xec])).toBe(true);
  });

  it("usa o fundo informado quando válido e ignora cor inválida", async () => {
    const a = await padronizarImagem(await degrade(900, 900), { enquadramento: "ajustar", fundo: "#EEEEEE" });
    expect(a.fundo).toBe("#EEEEEE");
    const b = await padronizarImagem(await degrade(900, 900), { enquadramento: "ajustar", fundo: "azul" });
    expect(b.fundo).toBe(FUNDO_PADRAO);
  });

  it("foto pequena: avisa e não amplia no modo ajustar", async () => {
    const r = await padronizarImagem(await pecaSobreFundo(500, 500));
    expect(r.avisos.join(" ")).toContain("Foto pequena (500×500)");
    expect([r.largura, r.altura]).toEqual([1024, 1024]);
  });

  it("ampliação grande no modo cortar gera aviso", async () => {
    const r = await padronizarImagem(await degrade(300, 300), { enquadramento: "cortar" });
    expect(r.avisos.some((a) => a.includes("ampliada"))).toBe(true);
  });

  it("transparência é preenchida com o fundo", async () => {
    const png = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 300, height: 300, channels: 4, background: "#b0306a" } }, gravity: "centre" }])
      .png()
      .toBuffer();
    const r = await padronizarImagem(png, { enquadramento: "ajustar" });
    expect(r.avisos.join(" ")).toContain("transparência");
    expect(perto(await pixel(r.bytes, 2, 2), [0xff, 0xff, 0xff], 14)).toBe(true); // fundo transparente vira branco (bordas lidas sobre branco) e não preto
  });

  it("rotação do celular (EXIF): foto deitada com orientação 6 é tratada como em pé", async () => {
    const deitada = await sharp(await degrade(1500, 1000)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await padronizarImagem(deitada);
    expect(r.tipo).toBe("modelo");
    expect([r.original.largura, r.original.altura]).toEqual([1000, 1500]);
  });

  it("textura pesada: baixa a qualidade até caber em 500 KB", async () => {
    const ruido = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 70 } } }).jpeg({ quality: 95 }).toBuffer();
    const r = await padronizarImagem(ruido, { enquadramento: "cortar" });
    expect(r.qualidade).toBeLessThan(92);
    expect(r.bytes.length <= MAX_ENVIO_BYTES || r.avisos.some((a) => a.includes("acima de 500 KB"))).toBe(true);
  });

  it("arquivo que não é imagem dá erro claro", async () => {
    await expect(padronizarImagem(Buffer.from("isto não é uma imagem"))).rejects.toThrow();
  });
});
