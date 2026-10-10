/** Regras puras de compras e reposição. */
export const JANELAS = [30, 60, 90] as const;
export const PRAZOS = [7, 15, 30, 45] as const;
export const COBERTURAS = [30, 45, 60] as const;
export const JANELA_PADRAO = 60;
export const PRAZO_PADRAO = 15;
export const COBERTURA_PADRAO = 30;
export const MAX_LINHAS_PEDIDO = 60;
export const QTD_MAX = 9999;

export const escolher = <T extends readonly number[]>(lista: T, valor: unknown, padrao: T[number]): T[number] => {
  const n = Number(valor);
  return (lista as readonly number[]).includes(n) ? n : padrao;
};

/**
 * Quantas unidades comprar: o que se vende até a mercadoria chegar (`prazo`) mais o que se quer ter em estoque depois (`cobertura`), no ritmo da janela,
 * menos o que já há na loja e o que já está a caminho em pedidos abertos. Nunca negativo.
 */
export function quantidadeSugerida(args: { ritmo: number; estoque: number; aCaminho: number; prazo: number; cobertura: number }): number {
  const precisa = Math.ceil(args.ritmo * (args.prazo + args.cobertura) - 1e-9);
  return Math.max(0, precisa - Math.max(args.estoque, 0) - Math.max(args.aCaminho, 0));
}

export interface ItemEntrada {
  variantId: string;
  qty: number;
}

export type Validacao<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PedidoEntrada {
  supplier: string;
  expectedOn: string | null;
  note: string | null;
  itens: ItemEntrada[];
}

/** Valida o que veio do formulário: fornecedor, data prevista (AAAA-MM-DD, entre hoje e 1 ano), observação e linhas (sem repetir a variação). */
export function validarPedido(raw: { supplier?: unknown; expectedOn?: unknown; note?: unknown; itens?: unknown }, hoje: string): Validacao<PedidoEntrada> {
  const supplier = typeof raw.supplier === "string" ? raw.supplier.replace(/\s+/g, " ").trim() : "";
  if (supplier.length < 2 || supplier.length > 80) return { ok: false, error: "Informe o fornecedor (2 a 80 caracteres)." };
  let expectedOn: string | null = null;
  if (typeof raw.expectedOn === "string" && raw.expectedOn.trim() !== "") {
    const d = raw.expectedOn.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return { ok: false, error: "A data prevista não é válida." };
    const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
    if (d < hoje) return { ok: false, error: "A data prevista não pode ser anterior a hoje." };
    if (d > limite) return { ok: false, error: "A data prevista está distante demais (máximo de 1 ano)." };
    expectedOn = d;
  }
  const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note.trim().slice(0, 500) : null;
  if (!Array.isArray(raw.itens) || raw.itens.length === 0) return { ok: false, error: "Escolha ao menos um item." };
  if (raw.itens.length > MAX_LINHAS_PEDIDO) return { ok: false, error: `Um pedido pode ter no máximo ${MAX_LINHAS_PEDIDO} itens.` };
  const vistos = new Set<string>();
  const itens: ItemEntrada[] = [];
  for (const i of raw.itens as Array<Record<string, unknown>>) {
    const variantId = typeof i?.variantId === "string" ? i.variantId : "";
    const qty = Number(i?.qty);
    if (!/^\d{1,15}$/.test(variantId)) return { ok: false, error: "Item inválido." };
    if (!Number.isInteger(qty) || qty < 1 || qty > QTD_MAX) return { ok: false, error: `A quantidade precisa ser um número inteiro de 1 a ${QTD_MAX}.` };
    if (vistos.has(variantId)) return { ok: false, error: "Há itens repetidos no pedido." };
    vistos.add(variantId);
    itens.push({ variantId, qty });
  }
  return { ok: true, value: { supplier, expectedOn, note, itens } };
}
