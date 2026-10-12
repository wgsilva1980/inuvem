/** Conferência de um pedido na expedição: cada leitura (código de barras ou SKU) soma uma peça ao item que bate. Só lógica, sem tela nem rede. */

export interface ItemConferencia {
  nome: string;
  variacao: string;
  sku: string | null;
  barras: string | null;
  quantidade: number;
}

export type Leitura =
  /** Conta uma peça no item `indice`. */
  | { tipo: "ok"; indice: number }
  /** O código é de uma peça do pedido, mas todas as unidades dela já foram lidas. */
  | { tipo: "excesso"; indice: number }
  | { tipo: "desconhecido" }
  | { tipo: "vazio" };

/** Tira espaços e passa para maiúsculas; leitores de código de barras às vezes mandam espaço ou quebra de linha no fim. */
export const limparCodigo = (s: string): string => s.replace(/\s+/g, "").toUpperCase();

/** Códigos de barras numéricos podem vir com zeros à esquerda (UPC-A lido como EAN-13): compara sem eles. */
const semZeros = (s: string): string => (/^\d+$/.test(s) ? s.replace(/^0+/, "") : s);

const confere = (codigo: string, alvo: string | null): boolean => {
  if (!alvo) return false;
  const a = limparCodigo(alvo);
  return a !== "" && (a === codigo || semZeros(a) === semZeros(codigo));
};

/**
 * Procura a leitura entre os itens do pedido, por SKU ou código de barras. Se o mesmo código aparece em mais de uma linha do pedido,
 * conta na primeira que ainda falta peça; se todas estão completas, é excesso.
 */
export function lerCodigo(itens: ItemConferencia[], contagens: number[], bruto: string): Leitura {
  const codigo = limparCodigo(bruto);
  if (codigo === "") return { tipo: "vazio" };
  const batem = itens.map((it, i) => (confere(codigo, it.sku) || confere(codigo, it.barras) ? i : -1)).filter((i) => i >= 0);
  if (batem.length === 0) return { tipo: "desconhecido" };
  const aberto = batem.find((i) => (contagens[i] ?? 0) < itens[i]!.quantidade);
  return aberto !== undefined ? { tipo: "ok", indice: aberto } : { tipo: "excesso", indice: batem[0]! };
}

export const contagensVazias = (itens: ItemConferencia[]): number[] => itens.map(() => 0);

/** Soma `delta` (+1/-1) ao item, sem passar do que o pedido pede nem ficar abaixo de zero. */
export function ajustar(itens: ItemConferencia[], contagens: number[], indice: number, delta: number): number[] {
  const it = itens[indice];
  if (!it) return contagens;
  const novo = Math.min(it.quantidade, Math.max(0, (contagens[indice] ?? 0) + delta));
  return contagens.map((c, i) => (i === indice ? novo : c));
}

export interface Progresso {
  lidas: number;
  total: number;
  completo: boolean;
  /** Itens que ainda faltam, com quantas peças. */
  faltando: Array<{ indice: number; faltam: number }>;
}

export function progresso(itens: ItemConferencia[], contagens: number[]): Progresso {
  const faltando = itens
    .map((it, indice) => ({ indice, faltam: it.quantidade - (contagens[indice] ?? 0) }))
    .filter((f) => f.faltam > 0);
  const total = itens.reduce((s, it) => s + it.quantidade, 0);
  const lidas = total - faltando.reduce((s, f) => s + f.faltam, 0);
  return { lidas, total, completo: itens.length > 0 && faltando.length === 0, faltando };
}
