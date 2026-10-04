import sanitizeHtml from "sanitize-html";

/** O navegador normaliza quebras de linha ao enviar o formulário (CRLF); comparamos e guardamos sempre com \n. */
export const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, "\n");

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-zA-Z]{3,20})$/;

/**
 * Limpa o HTML da descrição antes de ir para a loja: só formatação de texto. Remove scripts, iframes, manipuladores
 * de evento (onclick...), links `javascript:` e estilos além de cor e alinhamento. É uma defesa em profundidade: o editor
 * já só gera esses elementos, mas o servidor não confia no que o navegador manda.
 */
export function sanitizeDescription(html: string): string {
  return sanitizeHtml(normalizeNewlines(html), {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "span",
      "h1", "h2", "h3", "h4", "blockquote",
      "ul", "ol", "li",
      "a", "img",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
      th: ["colspan", "rowspan", "colwidth", "style"],
      td: ["colspan", "rowspan", "colwidth", "style"],
      col: ["span", "style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      span: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [COLOR],
        "text-align": [/^(left|right|center|justify)$/],
      },
      col: { width: [/^\d+(\.\d+)?(px|%)$/] },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] }, // sem data: (arquivo embutido pesaria na descrição)
    allowProtocolRelative: false,
    transformTags: {
      // links abertos em nova aba sem dar acesso à janela de origem
      a: (tagName, attribs) => ({
        tagName,
        attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs,
      }),
    },
  });
}

/**
 * Decide o que enviar como descrição. Se o texto recebido é o mesmo do espelho (só a quebra de linha pode variar), mantém o
 * original sem mexer — assim abrir e salvar um produto nunca reescreve um HTML que ninguém editou. Se mudou, limpa.
 */
export function prepareDescription(posted: string, current: string | null): string {
  const before = normalizeNewlines(current ?? "");
  const after = normalizeNewlines(posted);
  return after === before ? before : sanitizeDescription(after);
}
