/** CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) a partir dos dígitos. Outros tamanhos ficam como estão. */
export function formatDocument(doc: string | null): string {
  if (!doc) return "";
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

/** CEP 00000-000 a partir dos dígitos. */
export function formatZip(zip: string | null): string {
  return zip && zip.length === 8 ? zip.replace(/(\d{5})(\d{3})/, "$1-$2") : (zip ?? "");
}

/** Data ISO (aaaa-mm-dd, como vem do banco) -> dd/mm/aaaa, sem passar por fuso horário. */
export function formatDate(iso: string | null): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Valor em reais (R$ 1.234,56) a partir de "1234.56". */
export function formatBRL(v: string | number | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  return n === null || n === undefined || Number.isNaN(n) ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
