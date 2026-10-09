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
  /** Padroniza a grafia dos valores das propriedades COR (inicial maiúscula em cada palavra) e TAMANHO (maiúsculas; ÚNICO). */
  z.object({ type: z.literal("valores") }),
  /** Dá SKU às variantes sem código e renumera os códigos repetidos (o primeiro dono fica com o dele). Segue a numeração da loja. */
  z.object({ type: z.literal("sku") }),
  /** Preenche faixa etária (Adulto) e sexo (Feminino) onde estão vazios, para Instagram e Google Shopping. Não mexe no que já está preenchido. */
  z.object({ type: z.literal("google") }),
  /** Exclui os produtos da loja (irreversível: o lote de exclusão não pode ser revertido). */
  z.object({ type: z.literal("excluir") }),
  /** Corrige a ordem das propriedades para COR e TAMANHO, trocando também os dois valores de cada variante. */
  z.object({ type: z.literal("ordem") }),
  /**
   * Completa COR e/ou TAMANHO em produtos que só têm uma das duas propriedades, ou nenhuma. Os valores que faltam
   * vêm digitados pelo usuário (a loja não tem como saber a cor ou o tamanho): chave = id do produto.
   */
  z.object({
    type: z.literal("completar"),
    valores: z.record(
      z.string().regex(/^\d{1,15}$/),
      z.object({ cor: z.string().trim().min(1).max(100).optional(), tamanho: z.string().trim().min(1).max(100).optional() }),
    ),
  }),
]);
export type BulkOperation = z.infer<typeof operationSchema>;

/** Nomes padrão das propriedades das variações, na ordem. */
export const PROPRIEDADES_PADRAO = ["COR", "TAMANHO"] as const;

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** "Cor", "COR,", " cores " -> "cor": para reconhecer o que a propriedade significa, ignorando caixa, acento e vírgula sobrando. */
const chave = (nome: string) => semAcento(nome).toLowerCase().replace(/[\s,;.:]+$/g, "").replace(/^[\s,;.:]+/g, "");
export const ehCor = (nome: string) => ["cor", "cores"].includes(chave(nome));
export const ehTamanho = (nome: string) => ["tam", "tamanho", "tamanhos", "tamamho"].includes(chave(nome));

/** Conectivos que ficam em minúsculas no meio do nome de uma cor ("Verde de Água"). */
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "com", "em"]);
const SEPARADORES = /([\s/()-]+)/;

/** Cor com inicial maiúscula em cada palavra: "AZUL CLARO", "azul claro" e "Azul claro" viram "Azul Claro". */
export function padronizarCor(valor: string): string {
  const texto = valor.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  let primeira = true;
  return texto
    .split(SEPARADORES)
    .map((parte) => {
      if (parte === "" || SEPARADORES.test(parte)) return parte;
      const ficaMinuscula = !primeira && CONECTIVOS.has(parte);
      primeira = false;
      return ficaMinuscula ? parte : parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1);
    })
    .join("");
}

/** Tamanho sempre em maiúsculas ("pp" → "PP"), e o tamanho único numa grafia só: UNICO, Único, único → "ÚNICO". */
export function padronizarTamanho(valor: string): string {
  const texto = valor.trim().replace(/\s+/g, " ");
  if (chave(texto) === "unico") return "ÚNICO";
  return texto.toLocaleUpperCase("pt-BR");
}

/** Aplica a padronização a cada valor de uma variante, conforme a propriedade (por nome) em que ele está. Outras propriedades ficam como estão. */
export function padronizarValores(atributos: string[], valores: string[]): string[] {
  return valores.map((valor, i) => {
    const nome = atributos[i] ?? "";
    if (ehCor(nome)) return padronizarCor(valor);
    if (ehTamanho(nome)) return padronizarTamanho(valor);
    return valor;
  });
}

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
    case "completar": {
      const n = Object.keys(op.valores).length;
      return `Completar COR e TAMANHO em ${n} ${n === 1 ? "produto" : "produtos"} (valores informados por você)`;
    }
    case "sku":
      return "Ajustar os SKUs: numerar as variantes sem código e renumerar os códigos repetidos (os demais ficam como estão)";
    case "google":
      return "Preencher faixa etária (Adulto) e sexo (Feminino) onde estão vazios, para Instagram e Google Shopping";
    case "excluir":
      return "EXCLUIR os produtos da loja (não dá para desfazer)";
    case "ordem":
      return "Corrigir a ordem das propriedades para COR e TAMANHO (troca também os valores de cada variante)";
    case "valores":
      return "Padronizar a grafia dos valores: cores com inicial maiúscula em cada palavra, tamanhos em maiúsculas (ÚNICO)";
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
  age_group?: string | null;
  gender?: string | null;
  /** Valor de cada propriedade, na ordem das propriedades do produto (ex.: ["AZUL CLARO", "P"]). */
  values: string[];
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
  /** Novo código (SKU). `antes` null = estava sem código. */
  skuNovo?: { antes: string | null; depois: string };
  /** Faixa etária e sexo (Instagram / Google Shopping): só os campos que mudam. */
  google?: { age_group?: { antes: string | null; depois: string | null }; gender?: { antes: string | null; depois: string | null } };
  /** `trocar`: os dois valores trocam de lugar (os objetos multi-idioma andam junto). */
  values?: { antes: string[]; depois: string[]; trocar?: boolean; de?: Array<number | null> };
}

export interface ItemChanges {
  product?: {
    published?: { antes: boolean; depois: boolean };
    /** Exclusão do produto inteiro (com variantes e imagens). `nome` serve para conferir e mostrar. */
    excluir?: { nome: string; variantes: number };
    categories?: { antes: number[]; depois: number[] };
    /** `trocar`: as duas propriedades trocam de lugar (os objetos multi-idioma andam junto com o nome). */
    attributes?: { antes: string[]; depois: string[]; trocar?: boolean; de?: Array<number | null> };
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

export type Faltando = "COR" | "TAMANHO";

/**
 * O que falta a um produto para ter COR e TAMANHO. `null` = não se encaixa (já tem as duas, ou tem outras propriedades).
 * `de` diz de onde vem cada uma das duas posições novas (COR, TAMANHO): índice da propriedade antiga, ou null se é nova.
 */
export function faltaCorOuTamanho(atributos: string[]): { faltam: Faltando[]; de: [number | null, number | null] } | null {
  if (atributos.length === 0) return { faltam: ["COR", "TAMANHO"], de: [null, null] };
  if (atributos.length === 1 && ehTamanho(atributos[0] as string)) return { faltam: ["COR"], de: [null, 0] };
  if (atributos.length === 1 && ehCor(atributos[0] as string)) return { faltam: ["TAMANHO"], de: [0, null] };
  return null;
}

export interface ProdutoFaltando {
  id: number;
  name: string;
  published: boolean;
  atributos: string[];
  variantes: number;
  faltam: Faltando[];
}

/**
 * Produtos que podem ser completados na tela: os que estão sem COR e/ou TAMANHO. Produtos sem nome na loja (o painel
 * mostra "Produto <id>") ficam de fora e só são contados: antes de dar cor ou tamanho a eles, falta o nome.
 */
export function listarFaltando(products: MirrorProduct[]): { faltando: ProdutoFaltando[]; semNome: number } {
  const faltando: ProdutoFaltando[] = [];
  let semNome = 0;
  for (const p of products) {
    const falta = faltaCorOuTamanho(p.attributes);
    if (!falta) continue;
    if (p.name === `Produto ${p.id}`) semNome++;
    else faltando.push({ id: p.id, name: p.name, published: p.published, atributos: p.attributes, variantes: p.variants.length, faltam: falta.faltam });
  }
  return { faltando, semNome };
}

/** Completa COR/TAMANHO num produto com os valores digitados. O produto fica de fora, com motivo, se algo não fechar. */
function planCompletar(p: MirrorProduct, entrada: { cor?: string; tamanho?: string } | undefined): { attributes: NonNullable<NonNullable<ItemChanges["product"]>["attributes"]>; variants: VariantChange[] } | { motivo: string } {
  const falta = faltaCorOuTamanho(p.attributes);
  if (!falta) return { motivo: p.attributes.length === 0 ? "não precisa" : `já tem COR e TAMANHO ou outras propriedades (${p.attributes.join(" | ")})` };
  if (!entrada || (!entrada.cor && !entrada.tamanho)) return { motivo: "sem valor informado (deixado de fora)" };
  const precisa = (qual: Faltando) => falta.faltam.includes(qual);
  if (precisa("COR") && !entrada.cor) return { motivo: "informe a cor" };
  if (precisa("TAMANHO") && !entrada.tamanho) return { motivo: "informe o tamanho" };
  const nAntes = p.attributes.length;
  if (p.variants.some((v) => v.values.length !== nAntes)) return { motivo: "a quantidade de valores das variantes não bate com a de propriedades" };

  const cor = entrada.cor ? padronizarCor(entrada.cor) : null;
  const tamanho = entrada.tamanho ? padronizarTamanho(entrada.tamanho) : null;
  const [deCor, deTam] = falta.de;
  const novo = (v: string[]): string[] => [deCor === null ? (cor as string) : (v[deCor] as string), deTam === null ? (tamanho as string) : (v[deTam] as string)];

  const combinacoes = new Set<string>();
  const variants: VariantChange[] = [];
  for (const v of p.variants) {
    const depois = novo(v.values);
    const k = JSON.stringify(depois.map((x) => x.toLowerCase()));
    if (combinacoes.has(k)) return { motivo: `duas variantes ficariam iguais (${depois.join(" / ")}); corrija o produto antes` };
    combinacoes.add(k);
    variants.push({ id: v.id, label: v.label, sku: v.sku, values: { antes: [...v.values], depois, de: [deCor, deTam] } });
  }
  return { attributes: { antes: [...p.attributes], depois: [...PROPRIEDADES_PADRAO], de: [deCor, deTam] }, variants };
}

/**
 * Correção de ordem de um produto: TAMANHO antes de COR vira COR antes de TAMANHO, trocando também os dois valores de cada variante
 * (os valores seguem a ordem das propriedades, então só renomear deixaria cada valor sob a propriedade errada).
 */
function planOrdem(p: MirrorProduct): { attributes: { antes: string[]; depois: string[]; trocar: true }; variants: VariantChange[] } | { motivo: string } {
  const atuais = p.attributes;
  if (atuais.length !== 2) return { motivo: atuais.length === 0 ? "não tem propriedades" : `tem ${atuais.length} propriedade${atuais.length === 1 ? "" : "s"} (${atuais.join(" | ")}); só corrijo produtos com duas` };
  const [a, b] = atuais as [string, string];
  if (ehCor(a) && ehTamanho(b)) return { motivo: "já está na ordem COR, TAMANHO" };
  if (!(ehTamanho(a) && ehCor(b))) return { motivo: `nomes não reconhecidos (${atuais.join(" | ")})` };
  if (p.variants.some((v) => v.values.length !== 2)) return { motivo: "a quantidade de valores das variantes não bate com a de propriedades" };
  const variants: VariantChange[] = p.variants.map((v) => ({
    id: v.id,
    label: v.label,
    sku: v.sku,
    values: { antes: [...v.values], depois: [v.values[1] as string, v.values[0] as string], trocar: true },
  }));
  return { attributes: { antes: [...atuais], depois: [...PROPRIEDADES_PADRAO], trocar: true }, variants };
}

/**
 * Padronização dos valores de um produto. O produto inteiro fica de fora se a padronização deixasse duas variantes
 * com a mesma combinação de valores (a loja não distingue "Azul" de "AZUL" ao comparar, e isso viraria variante repetida).
 */
function planValores(p: MirrorProduct): { variants: VariantChange[] } | { motivo: string } {
  const algumaCorOuTamanho = p.attributes.some((a) => ehCor(a) || ehTamanho(a));
  if (!algumaCorOuTamanho) return { motivo: "não tem as propriedades COR ou TAMANHO" };
  if (p.variants.some((v) => v.values.length !== p.attributes.length)) return { motivo: "a quantidade de valores das variantes não bate com a de propriedades" };

  const variants: VariantChange[] = [];
  const combinacoes = new Map<string, string>();
  for (const v of p.variants) {
    const depois = padronizarValores(p.attributes, v.values);
    const chaveComb = JSON.stringify(depois.map((x) => x.toLowerCase()));
    const outra = combinacoes.get(chaveComb);
    if (outra !== undefined) return { motivo: `duas variantes ficariam iguais depois da padronização (${depois.join(" / ")}); corrija o produto antes` };
    combinacoes.set(chaveComb, v.label);
    if (depois.some((x, i) => x !== v.values[i])) variants.push({ id: v.id, label: v.label, sku: v.sku, values: { antes: [...v.values], depois } });
  }
  if (variants.length === 0) return { motivo: "a grafia dos valores já está padronizada" };
  return { variants };
}

/** Situação dos SKUs em toda a loja: o próximo número livre e quem é o dono de cada código repetido. */
export interface SkuContexto {
  proximo: number;
  /** código -> id da variante que fica com ele (a primeira, por produto e posição). */
  donos: Map<string, number>;
}

/** Calcula, a partir do espelho, o que cada produto/variante vai receber e o que fica de fora (com o motivo). */
export function planOperation(op: BulkOperation, products: MirrorProduct[], sku?: SkuContexto): Plan {
  let proximoSku = sku?.proximo ?? 0;
  const items: PlanItem[] = [];
  const ignorados: Skipped[] = [];

  for (const p of products) {
    const skip = (motivo: string, variant?: string) => ignorados.push({ productId: p.id, productName: p.name, variant, motivo });

    if (op.type === "publicar") {
      if (p.published === op.published) skip(op.published ? "já está publicado" : "já está despublicado");
      else items.push({ productId: p.id, productName: p.name, changes: { product: { published: { antes: p.published, depois: op.published } }, variants: [] } });
      continue;
    }

    if (op.type === "google") {
      const variants: VariantChange[] = [];
      for (const v of p.variants) {
        const google: NonNullable<VariantChange["google"]> = {};
        if (!v.age_group) google.age_group = { antes: v.age_group ?? null, depois: "adult" };
        if (!v.gender) google.gender = { antes: v.gender ?? null, depois: "female" };
        if (google.age_group || google.gender) variants.push({ id: v.id, label: v.label, sku: v.sku, google });
      }
      if (variants.length === 0) skip("faixa etária e sexo já estão preenchidos");
      else items.push({ productId: p.id, productName: p.name, changes: { variants } });
      continue;
    }

    if (op.type === "sku") {
      if (!sku) throw new Error("O lote de SKU precisa do contexto de códigos da loja.");
      const variants: VariantChange[] = [];
      for (const v of p.variants) {
        const atual = (v.sku ?? "").trim();
        if (atual !== "" && sku.donos.get(atual) === v.id) continue;
        variants.push({ id: v.id, label: v.label, sku: v.sku, skuNovo: { antes: v.sku, depois: String(proximoSku++) } });
      }
      if (variants.length === 0) skip("os SKUs já estão corretos");
      else items.push({ productId: p.id, productName: p.name, changes: { variants } });
      continue;
    }

    if (op.type === "excluir") {
      items.push({ productId: p.id, productName: p.name, changes: { product: { excluir: { nome: p.name, variantes: p.variants.length } }, variants: [] } });
      continue;
    }

    if (op.type === "completar") {
      const r = planCompletar(p, op.valores[String(p.id)]);
      if ("motivo" in r) skip(r.motivo);
      else items.push({ productId: p.id, productName: p.name, changes: { product: { attributes: r.attributes }, variants: r.variants } });
      continue;
    }

    if (op.type === "ordem") {
      const r = planOrdem(p);
      if ("motivo" in r) skip(r.motivo);
      else items.push({ productId: p.id, productName: p.name, changes: { product: { attributes: r.attributes }, variants: r.variants } });
      continue;
    }

    if (op.type === "valores") {
      const planejado = planValores(p);
      if ("motivo" in planejado) skip(planejado.motivo);
      else items.push({ productId: p.id, productName: p.name, changes: { variants: planejado.variants } });
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
