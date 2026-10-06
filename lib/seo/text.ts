/** Regras do SEO da loja: título até 70 caracteres e descrição até 320; o título termina com o nome da loja. */
export const SUFIXO_TITULO = " | Donatelle Concept";
export const TITULO_MAX = 70;
export const DESCRICAO_MAX = 320;
/** Quanto sobra para a parte própria do produto no título. */
export const PARTE_TITULO_MAX = TITULO_MAX - SUFIXO_TITULO.length;

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Corta em `max` caracteres sem partir palavra e sem deixar pontuação solta no fim. */
export function cortarEmPalavra(texto: string, max: number): string {
  const t = limpar(texto);
  if (t.length <= max) return t;
  let corte = t.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  const cortouNoMeioDaPalavra = !/[\s,;.:!?]/.test(t[max]!);
  if (cortouNoMeioDaPalavra && espaco >= max * 0.6) corte = corte.slice(0, espaco);
  return corte.replace(/[\s,;:|\-–—(]+$/u, "");
}

/** Título final: parte do produto (sem o nome da loja, se o modelo o repetiu) + sufixo, sempre ≤ 70 caracteres. */
export function montarTitulo(parte: string): string {
  const semLoja = limpar(parte).replace(/\s*\|\s*Donatelle Concept\s*$/i, "");
  return `${cortarEmPalavra(semLoja, PARTE_TITULO_MAX)}${SUFIXO_TITULO}`;
}

/** Descrição final, ≤ 320 caracteres; se precisou cortar, termina na última frase completa quando houver uma razoável. */
export function ajustarDescricao(descricao: string): string {
  const t = limpar(descricao);
  if (t.length <= DESCRICAO_MAX) return t;
  const corte = t.slice(0, DESCRICAO_MAX);
  const fim = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("! "), corte.lastIndexOf("? "));
  if (fim >= DESCRICAO_MAX * 0.6) return corte.slice(0, fim + 1);
  const palavra = cortarEmPalavra(t, DESCRICAO_MAX - 1);
  return `${palavra}.`.replace(/[.,;:]+\.$/, ".");
}

/** HTML da descrição do produto -> texto simples (para dar contexto ao Claude). */
export function textoDaDescricao(html: string | null | undefined, max = 1200): string {
  const t = limpar(
    (html ?? "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h\d|br)>|<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-z]+;/gi, " "),
  );
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
