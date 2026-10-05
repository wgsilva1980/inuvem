import sharp from "sharp";
import { TAMANHO, type Enquadramento, type Tipo } from "./standard";

export { ENQUADRAMENTO_LABEL, TAMANHO, TIPO_LABEL, type Enquadramento, type Tipo } from "./standard";

/** Fundo das bordas quando a foto não tem fundo uniforme. */
export const FUNDO_PADRAO = "#F5F1EC";
/** Teto do arquivo enviado (a loja recomprime, então o que ela guarda pode pesar mais). */
export const MAX_ENVIO_BYTES = 500 * 1024;
const QUALIDADES = [92, 88, 84, 80, 74] as const;
/** Margem em volta da peça no enquadramento "ajustar" (fração de cada lado). */
const MARGEM = 0.04;
const MIN_LADO_BOM = 800;

export interface PadronizarOpcoes {
  tipo?: Tipo | "auto";
  enquadramento?: Enquadramento | "auto";
  fundo?: string;
}

export interface Padronizada {
  bytes: Buffer;
  largura: number;
  altura: number;
  tipo: Tipo;
  enquadramento: Enquadramento;
  /** Cor usada nas bordas (a da foto, se o fundo for uniforme; senão, o fundo padrão). */
  fundo: string;
  fundoUniforme: boolean;
  qualidade: number;
  original: { largura: number; altura: number; bytes: number };
  avisos: string[];
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const parseHex = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** Fundo uniforme = as bordas da foto (miniatura de 48 px) quase da mesma cor. Devolve a cor média das bordas. */
async function analisarBordas(buf: Buffer, rotate: boolean): Promise<{ uniforme: boolean; cor: string }> {
  const lado = 48;
  let img = sharp(buf, { failOn: "none" });
  if (rotate) img = img.rotate();
  const { data } = await img.resize(lado, lado, { fit: "fill" }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: number[][] = [];
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      if (x === 0 || y === 0 || x === lado - 1 || y === lado - 1) {
        const i = (y * lado + x) * 3;
        px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
      }
    }
  }
  const media = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c]!, 0) / px.length);
  const desvio = [0, 1, 2].map((c) => Math.sqrt(px.reduce((s, p) => s + (p[c]! - media[c]!) ** 2, 0) / px.length));
  return { uniforme: Math.max(...desvio) < 10, cor: hex(media[0]!, media[1]!, media[2]!) };
}

/**
 * Enquadra a foto no padrão: corrige a rotação, escolhe o tipo (peça solta ou modelo, pela proporção) e o enquadramento
 * (ajustar se o fundo é uniforme, cortar se não é), gera o JPEG e baixa a qualidade até caber no teto de envio.
 */
export async function padronizarImagem(input: Buffer, opcoes: PadronizarOpcoes = {}): Promise<Padronizada> {
  const avisos: string[] = [];
  const meta = await sharp(input, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new Error("Não foi possível ler a imagem.");
  const girada = (meta.orientation ?? 1) >= 5; // EXIF 5–8: o navegador mostra de lado, a foto em pé
  const largOrig = girada ? meta.height : meta.width;
  const altOrig = girada ? meta.width : meta.height;
  const original = { largura: largOrig, altura: altOrig, bytes: input.length };

  const tipo: Tipo = !opcoes.tipo || opcoes.tipo === "auto" ? (altOrig / largOrig >= 1.15 ? "modelo" : "peca") : opcoes.tipo;
  const { largura: W, altura: H } = TAMANHO[tipo];

  const bordas = await analisarBordas(input, true);
  const enquadramento: Enquadramento = !opcoes.enquadramento || opcoes.enquadramento === "auto" ? (bordas.uniforme ? "ajustar" : "cortar") : opcoes.enquadramento;
  const fundoPadrao = parseHex(opcoes.fundo ?? FUNDO_PADRAO) ? (opcoes.fundo ?? FUNDO_PADRAO) : FUNDO_PADRAO;
  const fundo = enquadramento === "ajustar" && bordas.uniforme ? bordas.cor : fundoPadrao.toUpperCase();
  const rgb = parseHex(fundo)!;

  if (Math.max(largOrig, altOrig) < MIN_LADO_BOM) avisos.push(`Foto pequena (${largOrig}×${altOrig}): abaixo de ${MIN_LADO_BOM} px no lado maior a imagem pode ficar sem nitidez na loja.`);
  if (meta.hasAlpha) avisos.push("A imagem tinha transparência; ela foi preenchida com a cor de fundo.");

  // base: orientada e sem transparência
  const base = sharp(input, { failOn: "none" }).rotate().flatten({ background: rgb });

  let quadro: Buffer;
  if (enquadramento === "cortar") {
    const escala = Math.max(W / largOrig, H / altOrig);
    if (escala > 1.6) avisos.push(`A foto foi ampliada ${escala.toFixed(1)}× para preencher o quadro e pode ficar borrada.`);
    quadro = await base.resize(W, H, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
  } else {
    const dentro = await base
      .resize(Math.round(W * (1 - 2 * MARGEM)), Math.round(H * (1 - 2 * MARGEM)), { fit: "inside", withoutEnlargement: true })
      .toBuffer();
    quadro = await sharp({ create: { width: W, height: H, channels: 3, background: rgb } })
      .composite([{ input: dentro, gravity: "centre" }])
      .png({ compressionLevel: 1 }) // quadro intermediário sem perda (sem formato definido, o sharp devolveria pixels crus)
      .toBuffer();
  }

  let bytes: Buffer = Buffer.alloc(0);
  let qualidade: number = QUALIDADES[0];
  for (const q of QUALIDADES) {
    qualidade = q;
    bytes = await sharp(quadro).toColourspace("srgb").jpeg({ quality: q, mozjpeg: true, progressive: true }).toBuffer();
    if (bytes.length <= MAX_ENVIO_BYTES) break;
  }
  if (bytes.length > MAX_ENVIO_BYTES) avisos.push(`Mesmo na qualidade mais baixa o arquivo ficou com ${Math.round(bytes.length / 1024)} KB (acima de 500 KB).`);

  return { bytes, largura: W, altura: H, tipo, enquadramento, fundo, fundoUniforme: bordas.uniforme, qualidade, original, avisos };
}
