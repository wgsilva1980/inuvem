/** Contas de custo e margem, todas em centavos para não acumular erro de ponto flutuante. */
const cents = (n: number) => Math.round(n * 100);

/** Margem sobre o preço de venda, em % ((preço − custo) / preço). null se o preço não é positivo. */
export function margemPercent(preco: number, custo: number): number | null {
  if (!(preco > 0)) return null;
  return Math.round(((cents(preco) - cents(custo)) / cents(preco)) * 10_000) / 100;
}

/** Menor preço de venda que ainda respeita a margem mínima: custo ÷ (1 − margem). Com margem mínima 0, é o próprio custo. Arredondado para cima ao centavo. */
export function precoMinimo(custo: number, margemMinima: number): number {
  if (!(custo > 0)) return 0;
  return Math.ceil(cents(custo) / (1 - margemMinima / 100)) / 100;
}

/** Um preço novo respeita o custo e a margem mínima? Sem custo conhecido, sempre sim. */
export function precoPermitido(novoPreco: number, custo: number | null | undefined, margemMinima: number): boolean {
  if (custo === null || custo === undefined || !(custo > 0)) return true;
  return cents(novoPreco) >= cents(precoMinimo(custo, margemMinima));
}

/** Maior desconto (%) sobre `preco` que ainda respeita o custo e a margem mínima; 0 se nem o preço atual respeita. null = sem custo (sem limite). */
export function descontoMaximo(preco: number, custo: number | null | undefined, margemMinima: number): number | null {
  if (custo === null || custo === undefined || !(custo > 0)) return null;
  if (!(preco > 0)) return 0;
  const piso = cents(precoMinimo(custo, margemMinima));
  const max = Math.floor((1 - piso / cents(preco)) * 10_000) / 100;
  return Math.max(0, max);
}

/** Desconto limitado ao máximo permitido pela margem, em múltiplos de 5 para baixo (o que a liquidação usa). Sem custo, devolve o desconto como veio. */
export function limitarDesconto(percent: number, preco: number, custo: number | null | undefined, margemMinima: number): { percent: number; limitado: boolean } {
  const max = descontoMaximo(preco, custo, margemMinima);
  if (max === null || percent <= max) return { percent, limitado: false };
  return { percent: Math.max(0, Math.floor(max / 5) * 5), limitado: true };
}

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
