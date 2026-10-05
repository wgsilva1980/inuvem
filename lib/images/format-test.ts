/**
 * Teste de formato de imagem na Nuvemshop (Fase 0 da padronização de imagens): envia a mesma foto em JPEG e em WebP para um
 * produto de teste (rascunho), confere quais versões redimensionadas a loja gera e apaga o produto no fim.
 * Tudo injetado em `deps`, para testar sem rede.
 */
export interface ProbeResult {
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  erro?: string;
}

export interface FormatTestDeps {
  /** Cria o produto de teste (rascunho) e devolve o id. */
  createProduct(): Promise<number>;
  /** Envia a imagem ao produto e devolve o endereço (`src`) que a loja deu. */
  uploadImage(productId: number, file: { filename: string; bytes: Buffer }): Promise<string>;
  /** Baixa a URL e descreve o que veio (a loja entrega as versões pela CDN). */
  probe(url: string): Promise<ProbeResult>;
  deleteProduct(productId: number): Promise<void>;
}

export interface FormatReport {
  formato: "jpeg" | "webp";
  enviadoBytes: number;
  src: string | null;
  original: ProbeResult | null;
  /** Versões da CDN: tamanho pedido -> resultado. */
  tamanhos: Array<{ tamanho: number; resultado: ProbeResult }>;
  erro?: string;
}

export interface FormatTestResult {
  productId?: number;
  relatorios: FormatReport[];
  produtoApagado: boolean;
  erro?: string;
}

/** Tamanhos que a documentação da Nuvemshop diz existir na CDN. */
export const TAMANHOS_CDN = [50, 100, 240, 320, 480, 640, 1024] as const;

/**
 * URL de uma versão pelo tamanho. A Nuvemshop termina o endereço em `-<largura>-<altura>.<ext>` (ex.: `...-640-0.jpg`):
 * troca esse final, mantendo a extensão do endereço devolvido. Sem esse padrão, devolve null.
 */
export function urlDoTamanho(src: string, tamanho: number): string | null {
  const m = src.match(/^(.*)-\d+-\d+(\.[A-Za-z0-9]+)(\?.*)?$/);
  return m ? `${m[1]}-${tamanho}-${tamanho}${m[2]}` : null;
}

export async function runFormatTest(deps: FormatTestDeps, files: Array<{ formato: "jpeg" | "webp"; filename: string; bytes: Buffer }>): Promise<FormatTestResult> {
  const relatorios: FormatReport[] = [];
  let productId: number | null = null;
  let produtoApagado = false;
  let erro: string | undefined;
  try {
    productId = await deps.createProduct();
    for (const file of files) {
      const r: FormatReport = { formato: file.formato, enviadoBytes: file.bytes.length, src: null, original: null, tamanhos: [] };
      relatorios.push(r);
      try {
        r.src = await deps.uploadImage(productId, { filename: file.filename, bytes: file.bytes });
        r.original = await deps.probe(r.src);
        for (const tamanho of TAMANHOS_CDN) {
          const url = urlDoTamanho(r.src, tamanho);
          r.tamanhos.push({
            tamanho,
            resultado: url ? await deps.probe(url) : { url: r.src, ok: false, status: null, contentType: null, bytes: null, width: null, height: null, erro: "endereço sem o padrão -<largura>-<altura>" },
          });
        }
      } catch (err) {
        r.erro = err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
  } finally {
    if (productId !== null) {
      try {
        await deps.deleteProduct(productId);
        produtoApagado = true;
      } catch {
        produtoApagado = false;
      }
    }
  }
  return { relatorios, produtoApagado, ...(erro ? { erro } : {}), ...(productId !== null ? { productId } : {}) };
}

/** Resumo em português do que a loja fez com um formato: as versões que faltam e se a loja trocou o formato do original. */
export function veredito(r: FormatReport): { bom: boolean; texto: string } {
  if (r.erro) return { bom: false, texto: `Não foi possível testar: ${r.erro}` };
  if (!r.original?.ok) return { bom: false, texto: "A loja aceitou o envio, mas a imagem não pôde ser baixada." };
  const faltam = r.tamanhos.filter((t) => !t.resultado.ok).map((t) => t.tamanho);
  const nome = r.formato === "webp" ? "WebP" : "JPEG";
  if (faltam.length === 0) return { bom: true, texto: `${nome}: a loja gerou todas as versões (${TAMANHOS_CDN.join(", ")} px).` };
  if (faltam.length === TAMANHOS_CDN.length) return { bom: false, texto: `${nome}: nenhuma versão redimensionada foi gerada; só a imagem original.` };
  return { bom: false, texto: `${nome}: faltam as versões de ${faltam.join(", ")} px.` };
}
