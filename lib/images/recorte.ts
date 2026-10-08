/**
 * Enquadramento manual: o recorte é um retângulo no sistema de coordenadas da foto já girada (EXIF aplicado), em frações do tamanho dela.
 * `x`/`y` = canto superior esquerdo; `w` = largura do recorte (fração da largura da foto). A altura vem da proporção do quadro final,
 * então basta guardar três números. O recorte pode passar das bordas da foto (zoom menor que "preencher"): o que sobra vira fundo.
 * Sem dependências do sharp: roda no navegador (editor) e no servidor (padronização).
 */
export interface Recorte {
  x: number;
  y: number;
  w: number;
}

/** Quanto o zoom pode passar do "preencher" (3 = o recorte chega a 1/3 da largura que preenche o quadro). */
export const ZOOM_MAXIMO = 3;

/** Altura do recorte (fração da altura da foto). `fotoAspecto` e `quadroAspecto` = largura/altura. */
export const alturaDoRecorte = (w: number, fotoAspecto: number, quadroAspecto: number): number => (w * fotoAspecto) / quadroAspecto;

/** Larguras (fração da foto) que dão o zoom mínimo (foto inteira visível, com margem) e o máximo. */
export function limitesDeLargura(fotoAspecto: number, quadroAspecto: number): { inteira: number; preencher: number; minima: number } {
  const inteira = Math.max(1, quadroAspecto / fotoAspecto);
  const preencher = Math.min(1, quadroAspecto / fotoAspecto);
  return { inteira, preencher, minima: preencher / ZOOM_MAXIMO };
}

const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Mantém a largura nos limites e o centro do recorte dentro da foto (para não "perder" a foto de vista). */
export function limitarRecorte(r: Recorte, fotoAspecto: number, quadroAspecto: number): Recorte {
  const { inteira, minima } = limitesDeLargura(fotoAspecto, quadroAspecto);
  const w = entre(r.w, minima, inteira);
  const h = alturaDoRecorte(w, fotoAspecto, quadroAspecto);
  return { w, x: entre(r.x, -w / 2, 1 - w / 2), y: entre(r.y, -h / 2, 1 - h / 2) };
}

/** Recorte inicial: a foto preenche o quadro, centralizada (igual ao "Cortar"). */
export function recorteInicial(fotoAspecto: number, quadroAspecto: number): Recorte {
  const { preencher } = limitesDeLargura(fotoAspecto, quadroAspecto);
  const h = alturaDoRecorte(preencher, fotoAspecto, quadroAspecto);
  return { w: preencher, x: (1 - preencher) / 2, y: (1 - h) / 2 };
}

/** Muda o zoom mantendo o ponto (fx, fy) do quadro (0–1) parado na tela. */
export function aplicarZoom(r: Recorte, novaLargura: number, fx: number, fy: number, fotoAspecto: number, quadroAspecto: number): Recorte {
  const h = alturaDoRecorte(r.w, fotoAspecto, quadroAspecto);
  const px = r.x + fx * r.w;
  const py = r.y + fy * h;
  const { inteira, minima } = limitesDeLargura(fotoAspecto, quadroAspecto);
  const w = entre(novaLargura, minima, inteira);
  const nh = alturaDoRecorte(w, fotoAspecto, quadroAspecto);
  return limitarRecorte({ w, x: px - fx * w, y: py - fy * nh }, fotoAspecto, quadroAspecto);
}

/** Valida o que vem do formulário (o navegador não é confiável). Devolve null se não for um recorte plausível. */
export function lerRecorte(raw: unknown): Recorte | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const { x, y, w } = v as Record<string, unknown>;
  if (![x, y, w].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [nx, ny, nw] = [x as number, y as number, w as number];
  if (nw < 0.02 || nw > 10 || Math.abs(nx) > 10 || Math.abs(ny) > 10) return null;
  return { x: nx, y: ny, w: nw };
}
