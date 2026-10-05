/**
 * Teste de imagem na Nuvemshop (Fase 0 da padronização): envia imagens de teste (JPEG, WebP e um 4:5) para um produto de teste
 * (rascunho), confere o que a loja guardou e quais versões redimensionadas ela gera, e apaga o produto no fim.
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

export interface TestFile {
  rotulo: string;
  formato: "jpeg" | "webp";
  filename: string;
  bytes: Buffer;
  largura: number;
  altura: number;
}

export interface FormatTestDeps {
  /** Cria o produto de teste (rascunho) e devolve o id. */
  createProduct(): Promise<number>;
  /** Envia a imagem ao produto e devolve o endereço (`src`) que a loja deu. */
  uploadImage(productId: number, file: { filename: string; bytes: Buffer }): Promise<string>;
  /** Baixa a URL e descreve o que veio (a loja entrega as versões pela CDN). */
  probe(url: string): Promise<ProbeResult>;
  /** Espera (a loja pode processar a imagem depois de aceitar o envio). */
  esperar(ms: number): Promise<void>;
  deleteProduct(productId: number): Promise<void>;
}

export type PadraoUrl = "-S-0" | "-S-S";

export interface FormatReport {
  rotulo: string;
  formato: "jpeg" | "webp";
  enviadoBytes: number;
  enviadoLargura: number;
  enviadoAltura: number;
  src: string | null;
  original: ProbeResult | null;
  /** Mesmo endereço com outra extensão (a documentação diz que, para WebP, só existe a versão JPEG). */
  alternativas: ProbeResult[];
  /** Versões da CDN: tamanho pedido -> padrão de endereço que funcionou (ou null) e resultado. */
  tamanhos: Array<{ tamanho: number; padrao: PadraoUrl | null; resultado: ProbeResult }>;
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

const FINAL = /^(.*)-\d+-\d+(\.[A-Za-z0-9]+)(\?.*)?$/;

/**
 * Endereços possíveis de uma versão. A Nuvemshop termina o endereço em `-<largura>-<altura>.<ext>`; a documentação mostra
 * `-640-0` e `-1024-1024`, então testamos os dois padrões. Sem esse final, não há candidatos.
 */
export function candidatosDoTamanho(src: string, tamanho: number): Array<{ padrao: PadraoUrl; url: string }> {
  const m = src.match(FINAL);
  if (!m) return [];
  return [
    { padrao: "-S-0", url: `${m[1]}-${tamanho}-0${m[2]}` },
    { padrao: "-S-S", url: `${m[1]}-${tamanho}-${tamanho}${m[2]}` },
  ];
}

/** Endereço com outra extensão (jpeg e jpg), para ver o que existe quando a loja não serve o formato enviado. */
export function urlsComOutraExtensao(src: string): string[] {
  const m = src.match(/^(.*)(\.[A-Za-z0-9]+)(\?.*)?$/);
  if (!m) return [];
  return ["jpeg", "jpg"].filter((e) => `.${e}` !== m[2]!.toLowerCase()).map((e) => `${m[1]}.${e}`);
}

const ESPERAS_MS = [0, 2500, 5000];

export async function runFormatTest(deps: FormatTestDeps, files: TestFile[]): Promise<FormatTestResult> {
  // a loja pode demorar para publicar a imagem depois de aceitar o envio: tenta de novo antes de dar a versão por inexistente
  const sondar = async (url: string): Promise<ProbeResult> => {
    let ultimo!: ProbeResult;
    for (const espera of ESPERAS_MS) {
      if (espera > 0) await deps.esperar(espera);
      ultimo = await deps.probe(url);
      if (ultimo.ok) return ultimo;
    }
    return ultimo;
  };

  const relatorios: FormatReport[] = [];
  let productId: number | null = null;
  let produtoApagado = false;
  let erro: string | undefined;
  try {
    productId = await deps.createProduct();
    for (const file of files) {
      const r: FormatReport = {
        rotulo: file.rotulo,
        formato: file.formato,
        enviadoBytes: file.bytes.length,
        enviadoLargura: file.largura,
        enviadoAltura: file.altura,
        src: null,
        original: null,
        alternativas: [],
        tamanhos: [],
      };
      relatorios.push(r);
      try {
        r.src = await deps.uploadImage(productId, { filename: file.filename, bytes: file.bytes });
        r.original = await sondar(r.src);
        if (!r.original.ok || file.formato === "webp") for (const url of urlsComOutraExtensao(r.src)) r.alternativas.push(await deps.probe(url));
        for (const tamanho of TAMANHOS_CDN) {
          const candidatos = candidatosDoTamanho(r.src, tamanho);
          let escolhido: { tamanho: number; padrao: PadraoUrl | null; resultado: ProbeResult } | null = null;
          for (const c of candidatos) {
            const resultado = await deps.probe(c.url);
            escolhido = { tamanho, padrao: resultado.ok ? c.padrao : null, resultado };
            if (resultado.ok) break;
          }
          r.tamanhos.push(
            escolhido ?? { tamanho, padrao: null, resultado: { url: r.src, ok: false, status: null, contentType: null, bytes: null, width: null, height: null, erro: "endereço sem o final -<largura>-<altura>" } },
          );
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

/** Resumo em português do que a loja fez com uma imagem enviada. */
export function veredito(r: FormatReport): { bom: boolean; texto: string } {
  if (r.erro) return { bom: false, texto: `Não foi possível testar: ${r.erro}` };
  if (!r.original?.ok) {
    const alt = r.alternativas.find((a) => a.ok);
    if (alt) return { bom: false, texto: `A loja não serve o arquivo no formato enviado; só existe a versão JPEG (${alt.width}×${alt.height}).` };
    return { bom: false, texto: "A loja aceitou o envio, mas a imagem não pôde ser baixada (nem depois de esperar)." };
  }
  const dim = `${r.original.width}×${r.original.height}`;
  const faltam = r.tamanhos.filter((t) => !t.resultado.ok).map((t) => t.tamanho);
  if (faltam.length === 0) return { bom: true, texto: `Guardada em ${dim}; a loja gerou todas as versões (${TAMANHOS_CDN.join(", ")} px).` };
  if (faltam.length === TAMANHOS_CDN.length) return { bom: false, texto: `Guardada em ${dim}; nenhuma versão redimensionada foi encontrada.` };
  return { bom: false, texto: `Guardada em ${dim}; não encontrei as versões de ${faltam.join(", ")} px.` };
}
