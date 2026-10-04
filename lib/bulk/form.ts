import { operationSchema, validateOperation, type BulkOperation } from "./operations";

/** "10", "10,5", "1.234,56", "10.5" -> número. Só positivos: o sinal vem da escolha Aumentar/Diminuir. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (s === "") return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(normalized)) return null;
  return Number(normalized);
}

export type FormResult = { op: BulkOperation; error?: undefined } | { op?: undefined; error: string };

const fail = (error: string): FormResult => ({ error });

/** Converte os campos do formulário de operação em uma operação validada. */
export function operationFromForm(get: (name: string) => string): FormResult {
  const type = get("tipo");
  const rounding = get("arredondar") || "nenhum";
  let candidate: unknown;

  if (type === "preco") {
    const modo = get("preco_modo");
    const n = parseDecimal(get("preco_valor"));
    if (n === null) return fail("Informe um valor numérico positivo (por exemplo 10 ou 49,90).");
    const target = get("preco_alvo") === "promocional" ? "promocional" : "preco";
    if (modo === "definir") candidate = { type, mode: "definir", value: n, target, rounding };
    else if (modo === "aumentar" || modo === "diminuir") {
      const unidade = get("preco_unidade") === "valor" ? "valor" : "percentual";
      candidate = { type, mode: unidade, value: modo === "diminuir" ? -n : n, target, rounding };
    } else return fail("Escolha se quer aumentar, diminuir ou definir o preço.");
  } else if (type === "promocao") {
    if (get("promo_modo") === "remover") candidate = { type, mode: "remover", rounding };
    else {
      const n = parseDecimal(get("promo_percent"));
      if (n === null) return fail("Informe o percentual de desconto (por exemplo 15).");
      candidate = { type, mode: "desconto", percent: n, rounding };
    }
  } else if (type === "estoque") {
    const modo = get("estoque_modo");
    const raw = get("estoque_valor").trim();
    if (!/^\d{1,7}$/.test(raw)) return fail("Informe uma quantidade inteira, zero ou maior.");
    const n = Number(raw);
    if (modo === "definir") candidate = { type, mode: "definir", value: n };
    else if (modo === "aumentar" || modo === "diminuir") candidate = { type, mode: "somar", value: modo === "diminuir" ? -n : n };
    else return fail("Escolha se quer definir, aumentar ou diminuir o estoque.");
  } else if (type === "publicar") {
    const modo = get("publicar_modo");
    if (modo !== "publicar" && modo !== "despublicar") return fail("Escolha publicar ou despublicar.");
    candidate = { type, published: modo === "publicar" };
  } else if (type === "categoria") {
    const modo = get("categoria_modo");
    const id = Number(get("categoria_id"));
    if (!Number.isInteger(id) || id <= 0) return fail("Escolha a categoria.");
    if (modo !== "adicionar" && modo !== "remover") return fail("Escolha adicionar ou remover.");
    candidate = { type, mode: modo, categoryId: id };
  } else {
    return fail("Escolha o tipo de operação.");
  }

  const parsed = operationSchema.safeParse(candidate);
  if (!parsed.success) return fail("Valores inválidos para esta operação.");
  const problem = validateOperation(parsed.data);
  return problem ? fail(problem) : { op: parsed.data };
}
