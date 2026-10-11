/**
 * Simulador de preço: a partir do preço, do custo e das despesas da venda, mostra lucro, margem, ponto de equilíbrio e o efeito de uma promoção.
 * Contas em centavos (arredondadas só no fim) para não acumular erro de ponto flutuante.
 */
const cents = (n: number) => Math.round(n * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface EntradaSimulador {
  /** Preço de venda sem desconto, em reais. */
  preco: number;
  /** Custo da peça, em reais. */
  custo: number;
  /** Taxa de pagamento/gateway sobre o preço, em %. */
  taxaPct: number;
  /** Impostos sobre o preço, em %. */
  impostoPct: number;
  /** Despesa fixa por peça vendida (embalagem, frete absorvido…), em reais. */
  extra: number;
  /** Margem que se quer ter, em % do preço (opcional). */
  margemAlvoPct?: number | null;
}

export interface Cenario {
  /** Desconto sobre o preço, em %. */
  desconto: number;
  preco: number;
  /** Quanto sobra do preço depois das taxas e impostos, antes do custo e do extra. */
  receitaLiquida: number;
  lucro: number;
  /** Lucro sobre o preço de venda, em %. */
  margem: number | null;
  /** Lucro sobre o custo, em %. */
  markup: number | null;
  /** Quantas vezes mais peças precisa vender para ganhar o mesmo lucro total do preço cheio. null quando não dá lucro nesse preço (ou não havia lucro antes). */
  vendasParaIgualar: number | null;
}

export interface ResultadoSimulador {
  base: Cenario;
  /** Preço mínimo para não ter prejuízo. */
  equilibrio: number;
  /** Preço para atingir a margem alvo; null sem margem alvo, ou inviável. */
  precoMargemAlvo: number | null;
  /** Maior desconto (%) sobre o preço que ainda não dá prejuízo. */
  descontoMaximoSemPrejuizo: number;
  cenarios: Cenario[];
}

export class SimuladorErro extends Error {}

export const DESCONTOS_PADRAO = [5, 10, 15, 20, 25, 30, 40, 50] as const;

/** Parte do preço que fica depois das taxas e impostos (0 a 1). */
const fatorLiquido = (e: Pick<EntradaSimulador, "taxaPct" | "impostoPct">) => 1 - (e.taxaPct + e.impostoPct) / 100;

export function validar(e: EntradaSimulador): void {
  const bom = (n: number) => Number.isFinite(n);
  if (![e.preco, e.custo, e.taxaPct, e.impostoPct, e.extra].every(bom)) throw new SimuladorErro("Informe números válidos.");
  if (!(e.preco > 0)) throw new SimuladorErro("Informe um preço maior que zero.");
  if (e.custo < 0 || e.extra < 0) throw new SimuladorErro("Custo e despesas não podem ser negativos.");
  if (e.taxaPct < 0 || e.impostoPct < 0) throw new SimuladorErro("Taxas e impostos não podem ser negativos.");
  if (!(fatorLiquido(e) > 0)) throw new SimuladorErro("Taxas e impostos somados precisam ficar abaixo de 100%.");
  if (e.margemAlvoPct !== null && e.margemAlvoPct !== undefined && (e.margemAlvoPct < 0 || e.margemAlvoPct + e.taxaPct + e.impostoPct >= 100)) {
    throw new SimuladorErro("A margem desejada, somada às taxas e impostos, precisa ficar abaixo de 100%.");
  }
}

function cenario(e: EntradaSimulador, desconto: number, lucroBase: number | null): Cenario {
  const preco = cents(e.preco) * (1 - desconto / 100);
  const liquida = preco * fatorLiquido(e);
  const lucro = liquida - cents(e.custo) - cents(e.extra);
  return {
    desconto,
    preco: r2(preco / 100),
    receitaLiquida: r2(liquida / 100),
    lucro: r2(lucro / 100),
    margem: preco > 0 ? r2((lucro / preco) * 100) : null,
    markup: e.custo > 0 ? r2((lucro / cents(e.custo)) * 100) : null,
    vendasParaIgualar: lucroBase !== null && lucroBase > 0 && lucro > 0 ? Math.ceil((lucroBase / lucro) * 100) / 100 : null,
  };
}

/** Menor preço (em reais, arredondado para cima ao centavo) em que o lucro por peça é pelo menos `lucroMinimoPct` do preço. */
function precoPara(e: EntradaSimulador, lucroMinimoPct: number): number {
  const divisor = 1 - (e.taxaPct + e.impostoPct + lucroMinimoPct) / 100;
  return Math.ceil((cents(e.custo) + cents(e.extra)) / divisor) / 100;
}

export function simular(e: EntradaSimulador, descontos: readonly number[] = DESCONTOS_PADRAO): ResultadoSimulador {
  validar(e);
  const base = cenario(e, 0, null);
  const lucroBase = base.lucro * 100;
  const equilibrio = precoPara(e, 0);
  const margemAlvo = e.margemAlvoPct ?? null;
  const descontoMax = Math.max(0, Math.floor(((cents(e.preco) - cents(equilibrio)) * 10_000) / cents(e.preco)) / 100); // em centavos inteiros: sem erro de ponto flutuante
  return {
    base,
    equilibrio,
    precoMargemAlvo: margemAlvo !== null ? precoPara(e, margemAlvo) : null,
    descontoMaximoSemPrejuizo: descontoMax,
    cenarios: descontos.map((d) => cenario(e, d, lucroBase)),
  };
}

/** Número digitado no formato brasileiro ("89,90", "1.299,90") ou com ponto decimal ("89.90"); vazio ou inválido = null. */
export function numeroBR(texto: string | null | undefined): number | null {
  const t = (texto ?? "").trim().replace(/[R$\s%]/g, "");
  if (t === "") return null;
  const normal = /,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}
