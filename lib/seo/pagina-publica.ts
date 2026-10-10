import type { Db } from "@/lib/sync/repo";
import type { ItemParaSeo } from "./item-generate";

/**
 * A API da Nuvemshop não tem recurso de páginas (GET /pages dá 404), então o SEO das páginas institucionais é "assistido": o painel lê o endereço
 * PÚBLICO da página (o mesmo que qualquer visitante abre), a IA escreve o título e a descrição e a pessoa cola no admin da Nuvemshop.
 * Para não virar um leitor de endereços qualquer, só aceita endereços do domínio da própria loja.
 */
export class PaginaPublicaError extends Error {}

export const LIMITE_BYTES = 1_500_000;
export const TEXTO_MAX = 3000;
const MAX_REDIRECTS = 3;
const HOST_VALIDO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Domínio(s) público(s) da loja, tirados dos endereços dos produtos já lidos (dados da própria loja, não digitados). */
export async function hostsDaLoja(db: Db, storeId: string): Promise<string[]> {
  const rows = await db.query<{ host: string | null }>(
    `SELECT split_part(split_part(raw_json->>'canonical_url', '://', 2), '/', 1) AS host, count(*) AS n
     FROM products WHERE store_id = $1::uuid AND raw_json->>'canonical_url' IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 3`,
    [storeId],
  );
  return [...new Set(rows.map((r) => (r.host ?? "").toLowerCase().trim()).filter((h) => HOST_VALIDO.test(h)))];
}

const semWww = (h: string) => h.replace(/^www\./, "");
export const hostPermitido = (host: string, hosts: string[]): boolean => hosts.some((h) => semWww(h) === semWww(host.toLowerCase()));

/** Aceita "dominio.com.br/pagina/" ou o endereço completo; só https (http vira https), sem usuário, porta nem parâmetros, só o domínio da loja. */
export function validarEndereco(entrada: string, hosts: string[]): URL {
  const bruto = entrada.trim();
  if (bruto.length === 0 || bruto.length > 300) throw new PaginaPublicaError("Informe o endereço da página (até 300 caracteres).");
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  } catch {
    throw new PaginaPublicaError("Esse endereço não parece válido.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PaginaPublicaError("Use um endereço da página da loja (https://…).");
  if (u.username || u.password || u.port) throw new PaginaPublicaError("Esse endereço não é aceito (sem usuário nem porta).");
  if (!hostPermitido(u.hostname, hosts)) throw new PaginaPublicaError(`Só aceito endereços do domínio da loja (${hosts.join(", ") || "não identificado"}).`);
  u.protocol = "https:";
  u.hash = "";
  u.search = "";
  return u;
}

const ENTIDADES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decodificar = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&([a-z]+|#39);/gi, (m, n: string) => ENTIDADES[n.toLowerCase()] ?? m);
const limpar = (s: string) => decodificar(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function meta(html: string, nome: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\b(name|property)=["']${nome}["']`, "i").test(tag)) continue;
    const c = tag.match(/\bcontent=("([^"]*)"|'([^']*)')/i);
    if (c) return limpar(c[2] ?? c[3] ?? "");
  }
  return "";
}

export interface PaginaLida {
  nome: string;
  tituloAtual: string;
  descricaoAtual: string;
  texto: string;
}

/** Título, descrição de SEO atuais e o texto da página (sem menus, rodapé, scripts nem estilos). */
export function extrairPagina(html: string): PaginaLida {
  const tituloTag = limpar(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const h1 = limpar(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  let corpo = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const t of ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "form", "aside"]) corpo = corpo.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}>`, "gi"), " ");
  const principal = corpo.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? corpo.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? corpo.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? corpo;
  const texto = decodificar(principal.replace(/<\/(p|div|li|h[1-6]|tr|br)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, TEXTO_MAX);
  return { nome: h1 || tituloTag.split(/\s[|–-]\s/)[0]?.trim() || "Página", tituloAtual: meta(html, "og:title") || tituloTag, descricaoAtual: meta(html, "description") || meta(html, "og:description"), texto };
}

async function lerCorpo(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, LIMITE_BYTES);
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  while (total < LIMITE_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    partes.push(value);
    total += value.length;
  }
  void reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8").decode(Buffer.concat(partes));
}

/** Baixa a página pública. Redirecionamentos são seguidos à mão (até 3) e cada destino precisa ser do domínio da loja. */
export async function lerPaginaPublica(url: URL, hosts: string[], fetchImpl: typeof fetch = fetch): Promise<PaginaLida> {
  let atual = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res: Response;
    try {
      res = await fetchImpl(atual.toString(), { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { accept: "text/html", "user-agent": "INuvem-painel/1.0 (leitura da própria loja)" } });
    } catch {
      throw new PaginaPublicaError("Não consegui abrir a página agora. Tente de novo ou cole o texto dela.");
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      if (!destino) throw new PaginaPublicaError("A página redirecionou sem dizer para onde.");
      atual = validarEndereco(new URL(destino, atual).toString(), hosts);
      continue;
    }
    if (!res.ok) throw new PaginaPublicaError(`A loja respondeu ${res.status} para esse endereço. Confira se a página está publicada e o endereço está certo.`);
    if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("html")) throw new PaginaPublicaError("Esse endereço não é uma página da loja (não veio HTML).");
    const pagina = extrairPagina(await lerCorpo(res));
    if (pagina.texto.length < 20 && !pagina.tituloAtual) throw new PaginaPublicaError("Não encontrei texto nessa página. Cole o texto dela.");
    return pagina;
  }
  throw new PaginaPublicaError("Redirecionamentos demais nesse endereço.");
}

/** Formato que o gerador de SEO já usa (as linhas são fatos da loja, referência e não instruções). */
export function itemDaPagina(p: { nome: string; tituloAtual?: string; descricaoAtual?: string; texto: string }): ItemParaSeo {
  return {
    id: "assistido",
    nome: p.nome.slice(0, 200),
    seoTituloAtual: (p.tituloAtual ?? "").slice(0, 300),
    seoDescricaoAtual: (p.descricaoAtual ?? "").slice(0, 500),
    linhas: [p.texto.trim() ? `Conteúdo da página: ${p.texto.trim().slice(0, 1500)}` : "Conteúdo da página: (vazio)"],
  };
}
