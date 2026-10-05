import { describe, expect, it } from "vitest";
import { normalizeNewlines, prepareDescription, sanitizeDescription } from "@/lib/catalog/description";
import { changedFields, productEditSchema, remoteToEdit, toEdit } from "@/lib/catalog/edit";
import type { ProductDetail } from "@/lib/catalog/query";
import type { Product } from "@/lib/nuvemshop/types";

describe("sanitizeDescription", () => {
  it("mantém a formatação do editor (títulos, listas, tabela, alinhamento, cor, link, imagem)", () => {
    const html =
      '<h2 style="text-align:center">Título</h2><p>Texto <strong>forte</strong>, <em>itálico</em> e <u>sublinhado</u> ' +
      '<span style="color: #ff0000">vermelho</span> <a href="https://loja.com/x" target="_blank">link</a></p>' +
      "<ul><li><p>um</p></li><li>dois</li></ul><ol><li>a</li></ol><blockquote>cita</blockquote>" +
      '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>' +
      '<img src="https://cdn.loja.com/a.jpg" alt="foto">';
    const out = sanitizeDescription(html);
    for (const piece of ["<h2", "text-align:center", "<strong>forte</strong>", "<em>", "<u>", "color:#ff0000", 'href="https://loja.com/x"', "<ul>", "<ol>", "<blockquote>", "<table>", 'colspan="2"', 'src="https://cdn.loja.com/a.jpg"']) {
      expect(out).toContain(piece);
    }
  });

  it("remove script, iframe, manipuladores de evento e links/imagens perigosos", () => {
    const out = sanitizeDescription(
      '<p onclick="x()">oi</p><script>alert(1)</script><iframe src="https://evil"></iframe>' +
        '<a href="javascript:alert(1)">a</a><img src="x" onerror="alert(1)"><img src="data:image/png;base64,AAAA"><a href="//evil.com">b</a>',
    );
    expect(out).not.toMatch(/script|iframe|onclick|onerror|javascript:|data:|\/\/evil/i);
    expect(out).toContain("oi");
  });

  it("descarta estilos além de cor e alinhamento", () => {
    const out = sanitizeDescription('<p style="position:fixed;top:0;background:url(http://x/y);color:red;text-align:right">x</p>');
    expect(out).toContain("color:red");
    expect(out).toContain("text-align:right");
    expect(out).not.toMatch(/position|background|url\(/);
  });

  it("links com target=_blank ganham rel seguro", () => {
    expect(sanitizeDescription('<a href="https://a.com" target="_blank">a</a>')).toContain('rel="noopener noreferrer"');
  });
});

describe("prepareDescription", () => {
  const original = '<div class="x"><iframe src="https://video"></iframe>texto</div>\n<p>fim</p>';

  it("não mexe no HTML que ninguém editou (nem a quebra de linha conta)", () => {
    expect(prepareDescription(original.replace(/\n/g, "\r\n"), original)).toBe(original);
    expect(prepareDescription(original, original)).toBe(original);
  });

  it("limpa quando foi editado", () => {
    const out = prepareDescription(original + "<script>x</script><p>novo</p>", original);
    expect(out).not.toContain("script");
    expect(out).toContain("<p>novo</p>");
  });

  it("descrição vazia no espelho e vazia no formulário = sem mudança", () => {
    expect(prepareDescription("", null)).toBe("");
  });
});

describe("quebras de linha não geram falsa alteração", () => {
  const detail = (description: string): ProductDetail => ({
    id: "1", name: "A", description, tags: "", published: true, categories: [], seo_title: "", seo_description: "", updated_at_remote: null, attributes: [], variants: [],
  });
  const form = (description: string) =>
    productEditSchema.parse({ name: "A", description, tags: "", published: true, seo_title: "", seo_description: "", categories: [] });

  it("CRLF vindo do navegador é igual ao \\n do espelho", () => {
    const mirror = "<p>a</p>\n<p>b</p>";
    expect(changedFields(toEdit(detail(mirror)), form(mirror.replace(/\n/g, "\r\n")))).toEqual([]);
  });

  it("a descrição da loja também é normalizada na comparação", () => {
    const remote = { id: 1, name: { pt: "A" }, description: { pt: "<p>a</p>\r\n<p>b</p>" }, published: true } as Product;
    expect(changedFields(toEdit(detail("<p>a</p>\n<p>b</p>")), remoteToEdit(remote))).toEqual([]);
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
  });
});
