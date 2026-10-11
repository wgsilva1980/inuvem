/** Como mostrar o que mudou num registro do Histórico (puro). */
export type Rec = Record<string, unknown>;
export type AcaoDesfazivel = "produto.atualizar" | "variante.atualizar" | "categoria.atualizar";
export const ACOES_DESFAZIVEIS: readonly AcaoDesfazivel[] = ["produto.atualizar", "variante.atualizar", "categoria.atualizar"];
export const ehDesfazivel = (a: string): a is AcaoDesfazivel => (ACOES_DESFAZIVEIS as readonly string[]).includes(a);
/** Só dá para desfazer o que foi feito nos últimos dias (depois disso o estado da loja já é outro). */
export const DIAS_PARA_DESFAZER = 90;

const ROTULOS: Record<AcaoDesfazivel, Record<string, string>> = {
  "produto.atualizar": { name: "Nome", description: "Descrição", tags: "Tags", published: "Publicado", seo_title: "Título de SEO", seo_description: "Descrição de SEO", categories: "Categorias" },
  "variante.atualizar": {
    sku: "SKU", price: "Preço", promotional_price: "Preço promocional", stock_management: "Controle de estoque", stock: "Estoque", image_id: "Foto da variação", weight: "Peso (kg)",
    depth: "Profundidade (cm)", width: "Largura (cm)", height: "Altura (cm)", mpn: "MPN", age_group: "Faixa etária", gender: "Sexo", values: "Cor / tamanho",
  },
  "categoria.atualizar": { name: "Nome", parent: "Categoria pai" },
};

export const rotuloDoCampo = (acao: AcaoDesfazivel, campo: string): string => ROTULOS[acao][campo] ?? campo;

const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const semHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const reais = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

/** Texto curto de um valor para a tela. `nomes` traduz IDs de categoria. */
export function formatarValor(acao: AcaoDesfazivel, campo: string, valor: unknown, nomes: Map<number, string> = new Map()): string {
  if (valor === null || valor === undefined || valor === "") return "(vazio)";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (campo === "categories" && Array.isArray(valor)) return valor.length === 0 ? "(nenhuma)" : valor.map((id) => nomes.get(Number(id)) ?? `#${String(id)}`).join(", ");
  if (campo === "parent") return nomes.get(Number(valor)) ?? `#${String(valor)}`;
  if (campo === "values" && Array.isArray(valor)) return valor.map(String).join(" / ") || "(vazio)";
  if ((campo === "price" || campo === "promotional_price") && /^-?\d+(\.\d+)?$/.test(String(valor))) return reais(String(valor));
  if (campo === "description") return corta(semHtml(String(valor)) || "(vazio)", 120);
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "string") return corta(valor.replace(/\s+/g, " ").trim(), 100);
  return corta(JSON.stringify(valor), 100);
}

export interface Mudanca {
  campo: string;
  /** O que está na loja agora (o que o registro gravou). */
  agora: string;
  /** Para o que volta se desfizer. */
  volta: string;
}

/** Linhas "campo: agora → volta para", só dos campos que o registro realmente alterou (alguns registros gravam também os que ficaram iguais). */
export function descreverMudancas(acao: AcaoDesfazivel, antes: Rec, depois: Rec, nomes: Map<number, string> = new Map()): Mudanca[] {
  return Object.keys(depois).filter((c) => JSON.stringify(antes[c] ?? null) !== JSON.stringify(depois[c] ?? null)).map((campo) => ({ campo: rotuloDoCampo(acao, campo), agora: formatarValor(acao, campo, depois[campo], nomes), volta: formatarValor(acao, campo, antes[campo], nomes) }));
}

/** O registro tem o que é preciso para desfazer: `antes` e `depois` com os mesmos campos. */
export function temAntesEDepois(antes: unknown, depois: unknown): antes is Rec {
  if (!antes || !depois || typeof antes !== "object" || typeof depois !== "object" || Array.isArray(antes) || Array.isArray(depois)) return false;
  const campos = Object.keys(depois as Rec);
  return campos.length > 0 && campos.every((c) => c in (antes as Rec));
}
