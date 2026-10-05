import sharp from "sharp";

/** Imagem de teste 1200 × 1200 (degradê com um "T" grande, para ver se a loja mexeu na imagem), em JPEG e em WebP. */
export async function makeTestImages(): Promise<Array<{ formato: "jpeg" | "webp"; filename: string; bytes: Buffer }>> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9b8a6"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>
    <rect width="1200" height="1200" fill="url(#g)"/>
    <rect x="100" y="100" width="1000" height="1000" fill="none" stroke="#fff" stroke-width="8"/>
    <text x="600" y="780" font-size="640" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">T</text>
  </svg>`;
  const base = sharp(Buffer.from(svg)).resize(1200, 1200);
  const [jpeg, webp] = await Promise.all([base.clone().jpeg({ quality: 85 }).toBuffer(), base.clone().webp({ quality: 80 }).toBuffer()]);
  return [
    { formato: "jpeg", filename: "teste-formato.jpg", bytes: jpeg },
    { formato: "webp", filename: "teste-formato.webp", bytes: webp },
  ];
}
