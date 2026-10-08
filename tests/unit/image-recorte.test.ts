import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { alturaDoRecorte, aplicarZoom, lerRecorte, limitarRecorte, limitesDeLargura, recorteInicial } from "@/lib/images/recorte";
import { FUNDO_PADRAO, padronizarImagem } from "@/lib/images/standardize";

const perto = (a: number[], b: number[], tol = 14) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
/** 400×400: metade esquerda vermelha, direita azul. */
const metades = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: "#0000ff" } })
    .composite([{ input: { create: { width: 200, height: 400, channels: 3, background: "#ff0000" } }, left: 0, top: 0 }])
    .png()
    .toBuffer();

describe("matemática do recorte", () => {
  it("recorte inicial preenche o quadro, centralizado", () => {
    // foto deitada 3:2 em quadro 1:1: a altura inteira, 2/3 da largura
    const r = recorteInicial(1.5, 1);
    expect(r.w).toBeCloseTo(2 / 3);
    expect(r.x).toBeCloseTo(1 / 6);
    expect(r.y).toBeCloseTo(0);
    expect(alturaDoRecorte(r.w, 1.5, 1)).toBeCloseTo(1);
  });

  it("zoom mínimo mostra a foto inteira; o máximo é 3× o 'preencher'", () => {
    const l = limitesDeLargura(1.5, 1);
    expect(l.inteira).toBe(1);
    expect(l.preencher).toBeCloseTo(2 / 3);
    expect(l.minima).toBeCloseTo(2 / 9);
    const retrato = limitesDeLargura(0.5, 1); // foto em pé 1:2 em quadro quadrado: precisa de 2× a largura para caber inteira
    expect(retrato.inteira).toBe(2);
    expect(retrato.preencher).toBe(1);
  });

  it("limitar mantém o centro dentro da foto e a largura nos limites", () => {
    const r = limitarRecorte({ x: 5, y: -5, w: 50 }, 1, 1);
    expect(r.w).toBe(1);
    expect(r.x).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(-0.5);
  });

  it("zoom mantém parado o ponto sob o cursor", () => {
    const antes = { x: 0.1, y: 0.1, w: 0.8 };
    const depois = aplicarZoom(antes, 0.4, 0.5, 0.5, 1, 1);
    expect(depois.w).toBeCloseTo(0.4);
    // o centro do quadro continua apontando para o mesmo ponto da foto
    expect(depois.x + depois.w / 2).toBeCloseTo(0.5);
    expect(depois.y + depois.w / 2).toBeCloseTo(0.5);
  });

  it("lerRecorte aceita JSON válido e recusa lixo", () => {
    expect(lerRecorte('{"x":0.1,"y":0.2,"w":0.5}')).toEqual({ x: 0.1, y: 0.2, w: 0.5 });
    expect(lerRecorte("não é json")).toBeNull();
    expect(lerRecorte('{"x":"a","y":0,"w":1}')).toBeNull();
    expect(lerRecorte('{"x":0,"y":0,"w":0}')).toBeNull();
    expect(lerRecorte({ x: 0, y: 0, w: 999 })).toBeNull();
    expect(lerRecorte(null)).toBeNull();
  });
});

describe("padronizarImagem com enquadramento manual", () => {
  it("recorta a região escolhida e entrega o tamanho do padrão", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual", recorte: { x: 0, y: 0, w: 0.5 } });
    expect(r.enquadramento).toBe("manual");
    expect([r.largura, r.altura]).toEqual([1024, 1024]);
    const m = await sharp(r.bytes).metadata();
    expect([m.width, m.height]).toEqual([1024, 1024]);
    expect(perto(await pixel(r.bytes, 512, 512), [255, 0, 0])).toBe(true);
    expect(perto(await pixel(r.bytes, 20, 20), [255, 0, 0])).toBe(true);
    expect(perto(await pixel(r.bytes, 1000, 1000), [255, 0, 0])).toBe(true);
  });

  it("a outra metade aparece quando o recorte vai para a direita", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual", recorte: { x: 0.5, y: 0, w: 0.5 } });
    expect(perto(await pixel(r.bytes, 512, 512), [0, 0, 255])).toBe(true);
  });

  it("zoom menor que a foto inteira deixa margem com a cor de fundo", async () => {
    // recorte com o dobro da largura da foto, centralizado: a foto ocupa o meio do quadro
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual", recorte: { x: -0.5, y: -0.5, w: 2 } });
    const fundo = [0xf5, 0xf1, 0xec];
    expect(FUNDO_PADRAO.toLowerCase()).toBe("#f5f1ec");
    expect(perto(await pixel(r.bytes, 10, 10), fundo)).toBe(true);
    expect(perto(await pixel(r.bytes, 1010, 1010), fundo)).toBe(true);
    expect(perto(await pixel(r.bytes, 400, 512), [255, 0, 0])).toBe(true); // metade esquerda da foto, dentro do quadro
    expect(perto(await pixel(r.bytes, 620, 512), [0, 0, 255])).toBe(true);
  });

  it("modelo (4:5): o recorte usa a proporção 820×1024", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "modelo", enquadramento: "manual", recorte: { x: 0, y: 0, w: 0.4 } });
    expect([r.largura, r.altura]).toEqual([820, 1024]);
    const m = await sharp(r.bytes).metadata();
    expect([m.width, m.height]).toEqual([820, 1024]);
    expect(perto(await pixel(r.bytes, 410, 512), [255, 0, 0])).toBe(true);
  });

  it("sem recorte, o manual se comporta como 'preencher' centralizado", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual" });
    expect(perto(await pixel(r.bytes, 100, 512), [255, 0, 0])).toBe(true);
    expect(perto(await pixel(r.bytes, 900, 512), [0, 0, 255])).toBe(true);
  });

  it("recorte totalmente fora da foto gera só o fundo, sem erro", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual", recorte: { x: 5, y: 5, w: 0.5 } });
    expect(perto(await pixel(r.bytes, 512, 512), [0xf5, 0xf1, 0xec])).toBe(true);
  });

  it("ampliação forte avisa", async () => {
    const r = await padronizarImagem(await metades(), { tipo: "peca", enquadramento: "manual", recorte: { x: 0, y: 0, w: 0.2 } });
    expect(r.avisos.some((a) => a.includes("ampliada"))).toBe(true);
  });
});
