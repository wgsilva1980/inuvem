import { z } from "zod";

/* ---------- dinheiro (em centavos, para não acumular erro de ponto flutuante) ---------- */

export const toCents = (value: number | string): number => Math.round(Number(value) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

export type Rounding = "nenhum" | "90" | "00";

/** Arredonda um valor em centavos: "90" = o mais próximo terminado em ,90; "00" = o real mais próximo. */
export function applyRounding(cents: number, rounding: Rounding): number {
  if (rounding === "00") return Math.round(cents / 100) * 100;
  if (rounding === "90") return (Math.round((cents - 90) / 100) * 100) + 90;
  return Math.round(cents);
}

/* ---------- operações ---------- */

const rounding = z.enum(["nenhum", "90", "00"]).default("nenhum");

export const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("preco"),
    /** percentual: +10 aumenta 10%, -10 diminui 10%. valor: soma (ou subtrai, se negativo) em reais. definir: novo valor. */
    mode: z.enum(["percentual", "valor", "definir"]),
    value: z.number().finite().min(-1_000_000).max(1_000_000),
    target: z.enum(["preco", "promocional"]).default("preco"),
    rounding,
  }),
  z.object({
    type: z.literal("promocao"),
    mode: z.enum(["desconto", "remover"]),
    /** desconto (%) sobre o preço; ignorado ao remover. */
    percent: z.number().finite().gt(0).lt(100).optional(),
    rounding,
  }),
  z.object({
    type: z.literal("estoque"),
    mode: z.enum(["definir", "somar"]),
    value: z.number().int().min(-1_000_000).max(1_000_000),
  }),
  z.object({ type: z.literal("publicar"), published: z.boolean() }),
  z.object({ type: z.literal("categoria"), mode: z.enum(["adicionar", "remover"]), categoryId: z.number().int().positive() }),
  /** Padroniza os nomes das propriedades das variações para COR e TAMANHO (só renomeia; não mexe nos valores das variantes). */
  z.object({ type: z.literal("propriedades") }),
]);
export type BulkOperation = z.infer<typeof operationSchema>;

/** Nomes padrão das propriedades das variações, na ordem. */
export const PROPRIEDADES_PADRAO = ["COR", "TAMANHO"] as const;

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** "Cor", "COR,", " cores " -> "cor": para reconhecer o que a propriedade significa, ignorando caixa, acento e vírgula sobrando. */
const chave = (nome: string) => semAcento(nome).toLowerCase().replace(/[\s,;.:]+$/g, "").replace(/^[\s,;.:]+/g, "");
const ehCor = (nome: string) => ["cor", "cores"].includes(chave(nome));
const ehTamanho = (nome: string) => ["tam", "tamanho", "tamanhos", "tamamho"].includes(chave(nome));

/** O que fazer com as propriedades de um produto: renomear (e para quê), ou deixar de fora (com o motivo). */
export function planAtributos(atuais: string[]): { depois: string[] } | { motivo: string } {
  if (atuais.length === PROPRIEDADES_PADRAO.length && atuais.every((n, i) => n === PROPRIEDADES_PADRAO[i])) return { motivo: "já está com COR e TAMANHO" };
  if (atuais.length === 0) return { motivo: "não tem propriedades (variante única)" };
  if (atuais.length === 1) return { motivo: `só tem uma propriedade (${atuais[0]})` };
  if (atuais.length !== 2) return { motivo: `tem ${atuais.length} propriedades (${atuais.join(" | ")})` };
  const [a, b] = atuais as [string, string];
  if (ehCor(a) && ehTamanho(b)) return { depois: [...PROPRIEDADES_PADRAO] };
  if (ehTamanho(a) && ehCor(b)) return { motivo: `ordem invertida (${atuais.join(" | ")}): renomear não basta, porque os valores das variantes seguem a ordem das propriedades` };
  return { motivo: `nomes não reconhecidos (${atuais.join(" | ")})` };
}

/** Valida cada combinação que o schema sozinho não pega. Devolve a mensagem de erro, ou null. */
export function validateOperation(op: BulkOperation): string | null {
  if (op.type === "promocao" && op.mode === "desconto" && op.percent === undefined) return "Informe o percentual de desconto.";
  if (op.type === "preco" && op.mode === "definir" && op.value <= 0) return "O novo valor deve ser maior que zero.";
  if (op.type === "preco" && op.mode === "percentual" && op.value <= -100) return "A redução não pode ser de 100% ou mais.";
  if (op.type === "preco" && op.value === 0 && op.mode !== "definir") return "Informe um valor diferente de zero.";
  if (op.type === "estoque" && op.mode === "definir" && op.value < 0) return "O estoque não pode ser negativo.";
  if (op.type === "estoque" && op.mode === "somar" && op.value === 0) return "Informe uma quantidade diferente de zero.";
  return null;
}

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const roundingText = (r: Rounding) => (r === "90" ? ", arredondando para terminar em ,90" : r === "00" ? ", arredondando para reais inteiros" : "");

/** Frase que resume a operação (aparece na pré-visualização e no histórico). */
export function describeOperation(op: BulkOperation, categoryName?: (id: number) => string): string {
  switch (op.type) {
    case "preco": {
      const alvo = op.target === "promocional" ? "preço promocional" : "preço";
      if (op.mode === "definir") return `Definir o ${alvo} para ${brl(toCents(op.value))}${roundingText(op.rounding)}`;
      const sinal = op.value > 0 ? "Aumentar" : "Diminuir";
      const qtd = op.mode === "percentual" ? `${Math.abs(op.value).toLocaleString("pt-BR")}%` : brl(Math.abs(toCents(op.value)));
      return `${sinal} o ${alvo} em ${qtd}${roundingText(op.rounding)}`;
    }
    case "promocao":
      return op.mode === "remover"
        ? "Remover o preço promocional"
        : `Definir preço promocional com ${op.percent?.toLocaleString("pt-BR")}% de desconto sobre o preço${roundingText(op.rounding)}`;
    case "estoque":
      return op.mode === "definir" ? `Definir o estoque para ${op.value}` : `${op.value > 0 ? "Somar" : "Subtrair"} ${Math.abs(op.value)} ${Math.abs(op.value) === 1 ? "unidade" : "unidades"} do estoque`;
    case "publicar":
      return op.published ? "Publicar os produtos na loja" : "Despublicar os produtos (ocultar da loja)";
    case "propriedades":
      return `Padronizar as propriedades das variações para ${PROPRIEDADES_PADRAO.join(" e ")}`;
    case "categoria": {
      const nome = categoryName?.(op.categoryId) ?? `#${op.categoryId}`;
      return op.mode === "adicionar" ? `Adicionar à categoria "${nome}"` : `Remover da categoria "${nome}"`;
    }
  }
}

/* ---------- pré-visualização (plano) ---------- */

export interface MirrorVariant {
  id: number;
  sku: string | null;
  label: string;
  price: number | null;
  promotional_price: number | null;
  stock_management: boolean;
  stock: number | null;
}

export interface MirrorProduct {
  id: number;
  name: string;
  published: boolean;
  categoryIds: number[];
  /** Nomes das propriedades das variações (ex.: ["Cor", "Tam"]). */
  attributes: string[];
  variants: MirrorVariant[];
}

export interface VariantChange {
  id: number;
  label: string;
  sku: string | null;
  price?: { antes: string; depois: string };
  promotional_price?: { antes: string | null; depois: string | null };
  stock?: { antes: number | null; depois: number };
}

export interface ItemChanges {
  product?: {
    published?: { antes: boolean; depois: boolean };
    categories?: { antes: number[]; depois: number[] };
    attributes?: { antes: string[]; depois: string[] };
  };
  variants: VariantChange[];
}

export interface PlanItem {
  productId: number;
  productName: string;
  changes: ItemChanges;
}

export interface Skipped {
  productId: number;
  productName: string;
  variant?: string;
  motivo: string;
}

export interface Plan {
  items: PlanItem[];
  ignorados: Skipped[];
}

/** Máximo de produtos por lote: mantém a execução e a pré-visualização em tamanho razoável. */
export const MAX_PRODUCTS_PER_JOB = 500;

function planVariant(op: BulkOperation, v: MirrorVariant): { change?: VariantChange; motivo?: string } {
  const base = { id: v.id, label: v.label, sku: v.sku };
  const price = v.price === null ? null : toCents(v.price);
  const promo = v.promotional_price === null ? null : toCents(v.promotional_price);

  if (op.type === "preco") {
    const current = op.target === "promocional" ? promo : price;
    if (op.mode !== "definir" && current === null) return { motivo: op.target === "promocional" ? "sem preço promocional" : "sem preço" };
    if (op.target === "promocional" && promo === null) return { motivo: "sem preço promocional" };
    let next: number;
    if (op.mode === "definir") next = toCents(op.value);
    else if (op.mode === "percentual") next = Math.round((current as number) * (1 + op.value / 100));
    else next = (current as number) + toCents(op.value);
    next = applyRounding(next, op.rounding);
    if (next <= 0) return { motivo: "o valor resultante seria zero ou negativo" };
    if (next === current) return { motivo: "sem alteração" };
    if (op.target === "promocional") {
      if (price !== null && next >= price) return { motivo: "o preço promocional ficaria maior ou igual ao preço" };
      return { change: { ...base, promotional_price: { antes: fromCents(promo as number), depois: fromCents(next) } } };
    }
    if (promo !== null && promo >= next) return { motivo: "o preço ficaria menor ou igual ao preço promocional" };
    return { change: { ...base, price: { antes: current === null ? "0.00" : fromCents(current), depois: fromCents(next) } } };
  }

  if (op.type === "promocao") {
    if (op.mode === "remover") {
      if (promo === null) return { motivo: "sem preço promocional" };
      return { change: { ...base, promotional_price: { antes: fromCents(promo), depois: null } } };
    }
    if (price === null || price <= 0) return { motivo: "sem preço" };
    const next = applyRounding(Math.round(price * (1 - (op.percent as number) / 100)), op.rounding);
    if (next <= 0 || next >= price) return { motivo: "o preço promocional resultante não fica menor que o preço" };
    if (next === promo) return { motivo: "sem alteração" };
    return { change: { ...base, promotional_price: { antes: promo === null ? null : fromCents(promo), depois: fromCents(next) } } };
  }

  if (op.type === "estoque") {
    if (!v.stock_management) return { motivo: "sem controle de estoque" };
    const current = v.stock ?? 0;
    const next = op.mode === "definir" ? op.value : current + op.value;
    if (next < 0) return { motivo: "o estoque ficaria negativo" };
    if (next === v.stock) return { motivo: "sem alteração" };
    return { change: { ...base, stock: { antes: v.stock, depois: next } } };
  }
  return {};
}

/** Calcula, a partir do espelho, o que cada produto/variante vai receber e o que fica de fora (com o motivo). */
export function planOperation(op: BulkOperation, products: MirrorProduct[]): Plan {
  const items: PlanItem[] = [];
  const ignorados: Skipped[] = [];

  for (const p of products) {
    const skip = (motivo: string, variant?: string) => ignorados.push({ productId: p.id, productName: p.name, variant, motivo });

    if (op.type === "publicar") {
      if (p.published === op.published) skip(op.published ? "já está publicado" : "já está despublicado");
      else items.push({ productId: p.id, productName: p.name, changes: { product: { published: { antes: p.published, depois: op.published } }, variants: [] } });
      continue;
    }

    if (op.type === "propriedades") {
      const r = planAtributos(p.attributes);
      if ("motivo" in r) skip(r.motivo);
      else items.push({ productId: p.id, productName: p.name, changes: { product: { attributes: { antes: [...p.attributes], depois: r.depois } }, variants: [] } });
      continue;
    }

    if (op.type === "categoria") {
      const has = p.categoryIds.includes(op.categoryId);
      if (op.mode === "adicionar" && has) skip("já está nessa categoria");
      else if (op.mode === "remover" && !has) skip("não está nessa categoria");
      else {
        const depois = op.mode === "adicionar" ? [...p.categoryIds, op.categoryId] : p.categoryIds.filter((c) => c !== op.categoryId);
        items.push({ productId: p.id, productName: p.name, changes: { product: { categories: { antes: [...p.categoryIds], depois } }, variants: [] } });
      }
      continue;
    }

    const variants: VariantChange[] = [];
    for (const v of p.variants) {
      const r = planVariant(op, v);
      if (r.change) variants.push(r.change);
      else if (r.motivo) skip(r.motivo, v.label);
    }
    if (variants.length > 0) items.push({ productId: p.id, productName: p.name, changes: { variants } });
  }
  return { items, ignorados };
}

export const countVariantChanges = (items: PlanItem[]) => items.reduce((n, i) => n + i.changes.variants.length, 0);
