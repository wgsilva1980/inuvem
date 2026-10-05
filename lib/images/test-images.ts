import sharp from "sharp";
import type { TestFile } from "./format-test";

const quadro = (largura: number, altura: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b8a6"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>
  <rect width="${largura}" height="${altura}" fill="url(#g)"/>
  <rect x="60" y="60" width="${largura - 120}" height="${altura - 120}" fill="none" stroke="#fff" stroke-width="8"/>
  <text x="${largura / 2}" y="${altura / 2 + 220}" font-size="640" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">T</text>
</svg>`;

/**
 * Imagens de teste: 1200×1200 em JPEG e em WebP (degradê com um "T", para ver se a loja mexeu na imagem) e uma 1080×1350 (4:5)
 * em JPEG com textura de ruído, que pesa como uma foto de verdade (o degradê limpo pesa muito pouco).
 */
export async function makeTestImages(): Promise<TestFile[]> {
  const quadrada = sharp(Buffer.from(quadro(1200, 1200))).resize(1200, 1200);
  const [jpeg, webp] = await Promise.all([quadrada.clone().jpeg({ quality: 85 }).toBuffer(), quadrada.clone().webp({ quality: 80 }).toBuffer()]);

  const ruido = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .blur(0.8)
    .composite([{ input: Buffer.from(quadro(1080, 1350)), blend: "overlay" }])
    .jpeg({ quality: 88 })
    .toBuffer();

  return [
    { rotulo: "JPEG 1200 × 1200", formato: "jpeg", filename: "teste-jpeg.jpg", bytes: jpeg, largura: 1200, altura: 1200 },
    { rotulo: "WebP 1200 × 1200", formato: "webp", filename: "teste-webp.webp", bytes: webp, largura: 1200, altura: 1200 },
    { rotulo: "JPEG 1080 × 1350 (4:5, com textura de foto)", formato: "jpeg", filename: "teste-45.jpg", bytes: ruido, largura: 1080, altura: 1350 },
  ];
}
