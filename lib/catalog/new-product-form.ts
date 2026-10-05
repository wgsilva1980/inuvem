import { padronizarCor, padronizarTamanho } from "@/lib/bulk/operations";
import { MAX_VARIANTS, validateNewVariants, type NewVariantInput } from "./create";
import { productEditSchema, type ProductEdit } from "./edit";
import { variantEditSchema } from "./variants";

export type NewProductParse =
  | { ok: true; product: ProductEdit; variants: NewVariantInput[] }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

/** Nomes dos campos de erro de cada campo da variante (produto simples: sem prefixo; variações: v_<linha>_…). */
const FIELD_NAMES = { price: "preco", promotional_price: "promo", stock: "estoque", sku: "sku" } as const;

/**
 * Lê o formulário de novo produto. Modo "simples": uma variante com os campos preco, promocional, sku, estoque, controlar_estoque
 * e peso. Modo "variacoes": uma linha por cor e tamanho (v_<i>_cor, v_<i>_tam, v_<i>_preco…), mais peso_v e controlar_estoque_v
 * para todas. Devolve os erros por nome de campo para a tela mostrar ao lado de cada um.
 */
export function parseNewProductForm(form: FormData): NewProductParse {
  const get = (name: string) => String(form.get(name) ?? "");
  const fieldErrors: Record<string, string> = {};

  const produto = productEditSchema.safeParse({
    name: get("name"),
    description: get("description"),
    tags: get("tags"),
    published: get("published") === "on",
    seo_title: get("seo_title"),
    seo_description: get("seo_description"),
    categories: form.getAll("categories").map(Number).filter((n) => Number.isInteger(n) && n > 0),
  });
  if (!produto.success) for (const issue of produto.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;

  const variants: NewVariantInput[] = [];
  const addVariant = (campos: { sku: string; preco: string; promo: string; estoque: string; controlar: boolean; peso: string; cor?: string; tamanho?: string }, prefixo: string, pesoCampo: string) => {
    const values = campos.cor !== undefined && campos.tamanho !== undefined ? [campos.cor, campos.tamanho] : [];
    const r = variantEditSchema.safeParse({
      sku: campos.sku,
      price: campos.preco,
      promotional_price: campos.promo,
      stock_management: campos.controlar,
      stock: campos.estoque,
      image_id: "",
      weight: campos.peso,
      values,
    });
    if (!r.success) {
      for (const issue of r.error.issues) {
        const chave = String(issue.path[0]);
        const nome = chave === "weight" ? pesoCampo : chave === "values" ? `${prefixo}cor` : `${prefixo}${FIELD_NAMES[chave as keyof typeof FIELD_NAMES] ?? chave}`;
        fieldErrors[nome] ??= issue.message;
      }
      return;
    }
    const v = r.data;
    variants.push({ values: v.values ?? [], sku: v.sku, price: v.price, promotional_price: v.promotional_price, stock_management: v.stock_management, stock: v.stock, weight: v.weight ?? null });
  };

  if (get("modo") === "variacoes") {
    const n = Math.floor(Number(get("vcount")));
    if (!Number.isFinite(n) || n < 0) fieldErrors.variantes = "Variantes inválidas.";
    else if (n > MAX_VARIANTS) fieldErrors.variantes = `São ${n} variantes; o máximo ao cadastrar é ${MAX_VARIANTS}.`;
    else {
      for (let i = 0; i < n; i++) {
        const p = `v_${i}_`;
        addVariant(
          {
            sku: get(`${p}sku`),
            preco: get(`${p}preco`),
            promo: get(`${p}promo`),
            estoque: get(`${p}estoque`),
            controlar: get("controlar_estoque_v") === "on",
            peso: get("peso_v"),
            cor: padronizarCor(get(`${p}cor`)),
            tamanho: padronizarTamanho(get(`${p}tam`)),
          },
          p,
          "peso_v",
        );
      }
    }
  } else {
    addVariant(
      { sku: get("sku"), preco: get("preco"), promo: get("promocional"), estoque: get("estoque"), controlar: get("controlar_estoque") === "on", peso: get("peso") },
      "",
      "peso",
    );
    // no modo simples os nomes dos campos são os do formulário (promocional, não promo)
    if (fieldErrors.promo) {
      fieldErrors.promocional = fieldErrors.promo;
      delete fieldErrors.promo;
    }
  }

  if (Object.keys(fieldErrors).length === 0) {
    const problema = validateNewVariants(variants);
    if (problema) fieldErrors.variantes = problema;
  }
  if (!produto.success || Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: fieldErrors.variantes ?? "Corrija os campos destacados.", fieldErrors };
  }
  return { ok: true, product: produto.data, variants };
}
